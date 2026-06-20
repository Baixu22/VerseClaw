import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import { expandPath } from '../utils/paths';
import { ensureClawXWorkspaceHarness } from '../utils/clawx-harness-template';
import { isRecord } from './payload-utils';
import { syncActiveWorkspacePermissionToRuntime } from './workspace-runtime-sync';
import type { TerminalSessionManager } from './terminal-session-manager';
import type { WebPreviewManager } from './web-preview-manager';
import type {
  WorkspacePermissionMode,
  WorkspaceAgentBinding,
  WorkspaceProfile,
  WorkspaceSnapshot,
  WorkspaceUiState,
} from '@shared/types/workspace';

type WorkspaceStoreDocument = {
  activeWorkspaceId: string | null;
  profiles: WorkspaceProfile[];
};

type WorkspaceCreateBody = {
  name?: unknown;
  rootPath?: unknown;
  agentId?: unknown;
  activeSessionKey?: unknown;
  permissionMode?: unknown;
};

type WorkspaceUpdateBody = WorkspaceCreateBody & {
  id?: unknown;
  state?: unknown;
  sessionKey?: unknown;
};

type WorkspaceIdBody = {
  id?: unknown;
};

type WorkspaceSaveStateBody = {
  id?: unknown;
  activeSessionKey?: unknown;
  state?: unknown;
  sessionKey?: unknown;
};

const DEFAULT_SESSION_KEY = 'agent:main:main';
const DEFAULT_PERMISSION_MODE: WorkspacePermissionMode = 'acceptEdits';
const VALID_PERMISSION_MODES = new Set<WorkspacePermissionMode>([
  'readOnly',
  'acceptEdits',
  'plan',
  'fullAccess',
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let workspaceStoreInstance: any = null;

async function getWorkspaceStore() {
  if (!workspaceStoreInstance) {
    const Store = (await import('electron-store')).default;
    workspaceStoreInstance = new Store<WorkspaceStoreDocument>({
      name: 'workspaces',
      defaults: {
        activeWorkspaceId: null,
        profiles: [],
      },
    });
  }
  return workspaceStoreInstance;
}

function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'workspace';
}

function createWorkspaceId(name: string, existingIds: Set<string>): string {
  const base = normalizeId(name);
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function normalizeRootPath(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('rootPath is required');
  }
  const expanded = expandPath(value.trim());
  const normalized = resolve(expanded);
  if (!(await pathExists(normalized))) {
    throw new Error('Workspace path does not exist');
  }
  const info = await stat(normalized);
  if (!info.isDirectory()) {
    throw new Error('Workspace path must be a directory');
  }
  return normalized;
}

function normalizeName(value: unknown, rootPath: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return basename(rootPath) || rootPath || 'Workspace';
}

function normalizeAgentId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'main';
}

function normalizeSessionKey(value: unknown, agentId: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return agentId === 'main' ? DEFAULT_SESSION_KEY : `agent:${agentId}:main`;
}

function createAgentBinding(
  workspaceId: string,
  agentId: string,
  sessionKey: string,
): WorkspaceAgentBinding {
  return {
    workspaceId,
    agentId,
    sessionKey,
  };
}

function normalizeWorkspaceProfile(profile: WorkspaceProfile): WorkspaceProfile {
  const selectedAgentId = profile.selectedAgentId || profile.agentId || 'main';
  const activeSessionKey = normalizeSessionKey(profile.activeSessionKey, selectedAgentId);
  const existingBindings = profile.agentBindings && typeof profile.agentBindings === 'object'
    ? profile.agentBindings
    : {};
  const selectedBinding = existingBindings[selectedAgentId] ?? createAgentBinding(profile.id, selectedAgentId, activeSessionKey);
  const agentBindings = {
    ...existingBindings,
    [selectedAgentId]: {
      ...selectedBinding,
      workspaceId: profile.id,
      agentId: selectedAgentId,
      sessionKey: selectedBinding.sessionKey || activeSessionKey,
    },
  };
  const normalizedActiveSessionKey = agentBindings[selectedAgentId].sessionKey;
  const legacyState = normalizeUiState(profile.state);
  const sessionStates = normalizeSessionStates({ ...profile, state: legacyState }, normalizedActiveSessionKey);
  const state = sessionStates[normalizedActiveSessionKey] ?? {};
  return {
    ...profile,
    agentId: selectedAgentId,
    selectedAgentId,
    activeSessionKey: normalizedActiveSessionKey,
    agentBindings,
    state,
    sessionStates,
  };
}

function normalizePermissionMode(value: unknown): WorkspacePermissionMode {
  if (typeof value === 'string' && VALID_PERMISSION_MODES.has(value as WorkspacePermissionMode)) {
    return value as WorkspacePermissionMode;
  }
  return DEFAULT_PERMISSION_MODE;
}

function normalizeUiState(value: unknown): WorkspaceUiState {
  if (!isRecord(value)) return {};
  return value as WorkspaceUiState;
}

function mergeWorkspaceUiState(
  current: WorkspaceUiState | undefined,
  patch: WorkspaceUiState | undefined,
): WorkspaceUiState {
  if (!patch) return current ?? {};
  return {
    ...(current ?? {}),
    ...patch,
    artifactPanel: patch.artifactPanel
      ? { ...(current?.artifactPanel ?? {}), ...patch.artifactPanel }
      : current?.artifactPanel,
    terminal: patch.terminal
      ? { ...(current?.terminal ?? {}), ...patch.terminal }
      : current?.terminal,
    webPreview: patch.webPreview
      ? { ...(current?.webPreview ?? {}), ...patch.webPreview }
      : current?.webPreview,
    chatFooter: patch.chatFooter
      ? { ...(current?.chatFooter ?? {}), ...patch.chatFooter }
      : current?.chatFooter,
    graphExpanded: patch.graphExpanded
      ? { ...(current?.graphExpanded ?? {}), ...patch.graphExpanded }
      : current?.graphExpanded,
    activeTopicId: Object.prototype.hasOwnProperty.call(patch, 'activeTopicId')
      ? patch.activeTopicId
      : current?.activeTopicId,
    recentFiles: patch.recentFiles ?? current?.recentFiles,
  };
}

function normalizeSessionStates(
  profile: WorkspaceProfile,
  activeSessionKey: string,
): Record<string, WorkspaceUiState> {
  const rawStates = isRecord(profile.sessionStates) ? profile.sessionStates : {};
  const hasStoredSessionStates = Object.keys(rawStates).length > 0;
  const sessionStates: Record<string, WorkspaceUiState> = {};
  for (const [sessionKey, state] of Object.entries(rawStates)) {
    if (sessionKey.trim()) {
      sessionStates[sessionKey] = normalizeUiState(state);
    }
  }
  if (!sessionStates[activeSessionKey]) {
    sessionStates[activeSessionKey] = hasStoredSessionStates ? {} : normalizeUiState(profile.state);
  }
  return sessionStates;
}

async function readDocument(): Promise<WorkspaceStoreDocument> {
  const store = await getWorkspaceStore();
  const rawProfiles = Array.isArray(store.get('profiles')) ? store.get('profiles') as WorkspaceProfile[] : [];
  const profiles = rawProfiles.map(normalizeWorkspaceProfile);
  const activeWorkspaceId = typeof store.get('activeWorkspaceId') === 'string'
    ? store.get('activeWorkspaceId') as string
    : null;
  const activeExists = activeWorkspaceId != null && profiles.some((profile) => profile.id === activeWorkspaceId);
  const defaultWorkspace = profiles.find((profile) => profile.id === 'default');
  return {
    activeWorkspaceId: activeExists ? activeWorkspaceId : defaultWorkspace?.id ?? profiles[0]?.id ?? null,
    profiles,
  };
}

async function writeDocument(document: WorkspaceStoreDocument): Promise<void> {
  const store = await getWorkspaceStore();
  store.set('profiles', document.profiles);
  store.set('activeWorkspaceId', document.activeWorkspaceId);
}

function toSnapshot(document: WorkspaceStoreDocument): WorkspaceSnapshot {
  const activeWorkspace = document.profiles.find((profile) => profile.id === document.activeWorkspaceId) ?? null;
  return {
    profiles: document.profiles,
    activeWorkspaceId: activeWorkspace?.id ?? null,
    activeWorkspace,
  };
}

function successSnapshot(document: WorkspaceStoreDocument) {
  return {
    success: true,
    ...toSnapshot(document),
  };
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('id is required');
  }
  return value.trim();
}

function makeDefaultProfile(): WorkspaceProfile {
  const now = Date.now();
  const rootPath = resolve(expandPath('~/.openclaw/workspace'));
  const state: WorkspaceUiState = {
    chatFooter: {
      contextRangeVisible: true,
      tokenUsageVisible: true,
    },
  };
  return {
    id: 'default',
    name: '默认工作区',
    rootPath: (rootPath.startsWith(homedir()) ? rootPath : resolve(rootPath)),
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: DEFAULT_SESSION_KEY,
    agentBindings: {
      main: createAgentBinding('default', 'main', DEFAULT_SESSION_KEY),
    },
    permissionMode: DEFAULT_PERMISSION_MODE,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    state,
    sessionStates: {
      [DEFAULT_SESSION_KEY]: state,
    },
  };
}

async function ensureDocumentWithDefault(): Promise<WorkspaceStoreDocument> {
  let document = await readDocument();
  if (document.profiles.length > 0) {
    const store = await getWorkspaceStore();
    const storedActiveWorkspaceId = typeof store.get('activeWorkspaceId') === 'string'
      ? store.get('activeWorkspaceId') as string
      : null;
    if (document.activeWorkspaceId) {
      if (storedActiveWorkspaceId !== document.activeWorkspaceId) {
        await writeDocument(document);
      }
      return document;
    }
    const defaultWorkspace = document.profiles.find((profile) => profile.id === 'default') ?? document.profiles[0];
    document = { ...document, activeWorkspaceId: defaultWorkspace?.id ?? null };
    await writeDocument(document);
    return document;
  }

  const profile = makeDefaultProfile();
  document = { activeWorkspaceId: profile.id, profiles: [profile] };
  await writeDocument(document);
  return document;
}

export async function getActiveWorkspaceProfile(): Promise<WorkspaceProfile | null> {
  const document = await ensureDocumentWithDefault();
  return document.profiles.find((profile) => profile.id === document.activeWorkspaceId) ?? null;
}

type WorkspacesApiContext = {
  gatewayManager?: GatewayManager;
  terminalManager?: TerminalSessionManager;
  webPreviewManager?: WebPreviewManager;
};

async function syncWorkspacePermissionBestEffort(gatewayManager: GatewayManager | undefined): Promise<void> {
  try {
    await syncActiveWorkspacePermissionToRuntime(gatewayManager);
  } catch (error) {
    console.warn('[workspaces] Failed to sync workspace permission to runtime:', error);
  }
}

export function createWorkspacesApi(ctx: WorkspacesApiContext = {}): CompleteHostServiceRegistry['workspaces'] {
  return {
    list: async () => {
      const document = await ensureDocumentWithDefault();
      return successSnapshot(document);
    },
    getActive: async () => {
      const document = await ensureDocumentWithDefault();
      const snapshot = toSnapshot(document);
      return {
        success: true,
        activeWorkspaceId: snapshot.activeWorkspaceId,
        activeWorkspace: snapshot.activeWorkspace,
      };
    },
    create: async (payload) => {
      const body = isRecord(payload) ? payload as WorkspaceCreateBody : {};
      const rootPath = await normalizeRootPath(body.rootPath);
      const name = normalizeName(body.name, rootPath);
      const agentId = normalizeAgentId(body.agentId);
      const activeSessionKey = normalizeSessionKey(body.activeSessionKey, agentId);
      const permissionMode = normalizePermissionMode(body.permissionMode);
      const document = await readDocument();
      const id = createWorkspaceId(name, new Set(document.profiles.map((profile) => profile.id)));
      const now = Date.now();
      const state: WorkspaceUiState = {
        chatFooter: {
          contextRangeVisible: true,
          tokenUsageVisible: true,
        },
      };
      const profile: WorkspaceProfile = {
        id,
        name,
        rootPath,
        agentId,
        selectedAgentId: agentId,
        activeSessionKey,
        agentBindings: {
          [agentId]: createAgentBinding(id, agentId, activeSessionKey),
        },
        permissionMode,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        state,
        sessionStates: {
          [activeSessionKey]: state,
        },
      };
      const nextDocument = {
        activeWorkspaceId: id,
        profiles: [...document.profiles, profile],
      };
      await ensureClawXWorkspaceHarness(rootPath);
      await writeDocument(nextDocument);
      ctx.terminalManager?.registerWorkspace(profile);
      ctx.webPreviewManager?.registerWorkspace(profile);
      await syncWorkspacePermissionBestEffort(ctx.gatewayManager);
      return successSnapshot(nextDocument);
    },
    update: async (payload) => {
      const body = isRecord(payload) ? payload as WorkspaceUpdateBody : {};
      const id = requireId(body.id);
      const document = await readDocument();
      const index = document.profiles.findIndex((profile) => profile.id === id);
      if (index === -1) throw new Error(`Workspace "${id}" not found`);
      const current = document.profiles[index];
      const rootPath = body.rootPath === undefined ? current.rootPath : await normalizeRootPath(body.rootPath);
      const agentId = body.agentId === undefined ? current.agentId : normalizeAgentId(body.agentId);
      const selectedAgentId = agentId;
      const requestedSessionKey = body.activeSessionKey === undefined
        ? current.agentBindings?.[selectedAgentId]?.sessionKey ?? current.activeSessionKey
        : normalizeSessionKey(body.activeSessionKey, selectedAgentId);
      const agentBindings = {
        ...(current.agentBindings ?? {}),
        [selectedAgentId]: {
          ...(current.agentBindings?.[selectedAgentId] ?? createAgentBinding(id, selectedAgentId, requestedSessionKey)),
          workspaceId: id,
          agentId: selectedAgentId,
          sessionKey: requestedSessionKey,
        },
      };
      const currentSessionStates = normalizeSessionStates(current, current.activeSessionKey);
      const statePatch = body.state === undefined ? undefined : normalizeUiState(body.state);
      const targetSessionKey = normalizeSessionKey(body.sessionKey ?? requestedSessionKey, selectedAgentId);
      const hasTargetSessionState = Object.prototype.hasOwnProperty.call(currentSessionStates, targetSessionKey);
      const nextSessionStates = statePatch
        ? {
          ...currentSessionStates,
          [targetSessionKey]: mergeWorkspaceUiState(currentSessionStates[targetSessionKey], statePatch),
        }
        : hasTargetSessionState
          ? currentSessionStates
          : {
            ...currentSessionStates,
            [targetSessionKey]: {},
          };
      const nextProfile: WorkspaceProfile = {
        ...current,
        name: body.name === undefined ? current.name : normalizeName(body.name, rootPath),
        rootPath,
        agentId,
        selectedAgentId,
        activeSessionKey: requestedSessionKey,
        agentBindings,
        permissionMode: body.permissionMode === undefined
          ? current.permissionMode
          : normalizePermissionMode(body.permissionMode),
        state: nextSessionStates[requestedSessionKey] ?? current.state,
        sessionStates: nextSessionStates,
        updatedAt: Date.now(),
      };
      const profiles = [...document.profiles];
      profiles[index] = nextProfile;
      const nextDocument = { ...document, profiles };
      const rootPathChanged = nextProfile.rootPath !== current.rootPath;
      if (rootPathChanged) {
        await ensureClawXWorkspaceHarness(rootPath);
      }
      await writeDocument(nextDocument);
      const permissionNowRestrictive = nextProfile.permissionMode === 'plan' || nextProfile.permissionMode === 'readOnly';
      if (rootPathChanged) {
        ctx.terminalManager?.unregisterWorkspace(id, 'workspace-delete');
        await ctx.webPreviewManager?.stopForWorkspace(id, 'workspace-delete');
        if (document.activeWorkspaceId === id) {
          ctx.terminalManager?.registerWorkspace(nextProfile);
          ctx.webPreviewManager?.registerWorkspace(nextProfile);
        }
      } else if (permissionNowRestrictive && nextProfile.permissionMode !== current.permissionMode) {
        ctx.terminalManager?.unregisterWorkspace(id, 'permission-change');
      }
      if (document.activeWorkspaceId === id && nextProfile.permissionMode !== current.permissionMode) {
        await syncWorkspacePermissionBestEffort(ctx.gatewayManager);
      }
      return successSnapshot(nextDocument);
    },
    delete: async (payload) => {
      const body = isRecord(payload) ? payload as WorkspaceIdBody : {};
      const id = requireId(body.id);
      const document = await readDocument();
      const profiles = document.profiles.filter((profile) => profile.id !== id);
      if (profiles.length === document.profiles.length) {
        throw new Error(`Workspace "${id}" not found`);
      }
      const activeWorkspaceId = document.activeWorkspaceId === id ? profiles[0]?.id ?? null : document.activeWorkspaceId;
      const nextDocument = { activeWorkspaceId, profiles };
      ctx.terminalManager?.unregisterWorkspace(id, 'workspace-delete');
      await ctx.webPreviewManager?.stopForWorkspace(id, 'workspace-delete');
      await writeDocument(nextDocument);
      const nextActiveWorkspace = profiles.find((profile) => profile.id === activeWorkspaceId) ?? null;
      if (nextActiveWorkspace) {
        ctx.terminalManager?.registerWorkspace(nextActiveWorkspace);
        ctx.webPreviewManager?.registerWorkspace(nextActiveWorkspace);
      }
      if (document.activeWorkspaceId === id || activeWorkspaceId !== document.activeWorkspaceId) {
        await syncWorkspacePermissionBestEffort(ctx.gatewayManager);
      }
      return successSnapshot(nextDocument);
    },
    switch: async (payload) => {
      const body = isRecord(payload) ? payload as WorkspaceIdBody : {};
      const id = requireId(body.id);
      const document = await readDocument();
      const index = document.profiles.findIndex((profile) => profile.id === id);
      if (index === -1) throw new Error(`Workspace "${id}" not found`);
      const profiles = [...document.profiles];
      profiles[index] = {
        ...profiles[index],
        lastOpenedAt: Date.now(),
        updatedAt: Date.now(),
      };
      const previousActiveWorkspace = document.profiles.find((profile) => profile.id === document.activeWorkspaceId) ?? null;
      const nextDocument = { activeWorkspaceId: id, profiles };
      if (previousActiveWorkspace?.id && previousActiveWorkspace.id !== id) {
        ctx.terminalManager?.unregisterWorkspace(previousActiveWorkspace.id, 'workspace-switch');
        await ctx.webPreviewManager?.stopForWorkspace(previousActiveWorkspace.id, 'workspace-switch');
      }
      await writeDocument(nextDocument);
      await syncWorkspacePermissionBestEffort(ctx.gatewayManager);
      const activeWorkspace = profiles[index];
      ctx.terminalManager?.registerWorkspace(activeWorkspace);
      ctx.webPreviewManager?.registerWorkspace(activeWorkspace);
      return {
        success: true,
        activeWorkspaceId: id,
        activeWorkspace,
      };
    },
    saveState: async (payload) => {
      const body = isRecord(payload) ? payload as WorkspaceSaveStateBody : {};
      const id = requireId(body.id);
      const document = await readDocument();
      const index = document.profiles.findIndex((profile) => profile.id === id);
      if (index === -1) throw new Error(`Workspace "${id}" not found`);
      const current = document.profiles[index];
      const selectedAgentId = current.selectedAgentId || current.agentId;
      const activeSessionKey = body.activeSessionKey === undefined
        ? current.activeSessionKey
        : normalizeSessionKey(body.activeSessionKey, selectedAgentId);
      const targetSessionKey = normalizeSessionKey(body.sessionKey ?? activeSessionKey, selectedAgentId);
      const currentSessionStates = normalizeSessionStates(current, current.activeSessionKey);
      const statePatch = body.state === undefined ? undefined : normalizeUiState(body.state);
      const nextSessionStates = statePatch
        ? {
          ...currentSessionStates,
          [targetSessionKey]: mergeWorkspaceUiState(currentSessionStates[targetSessionKey], statePatch),
        }
        : currentSessionStates;
      const agentBindings = {
        ...(current.agentBindings ?? {}),
        [selectedAgentId]: {
          ...(current.agentBindings?.[selectedAgentId] ?? createAgentBinding(id, selectedAgentId, activeSessionKey)),
          workspaceId: id,
          agentId: selectedAgentId,
          sessionKey: activeSessionKey,
        },
      };
      const profiles = [...document.profiles];
      profiles[index] = {
        ...current,
        agentId: selectedAgentId,
        selectedAgentId,
        activeSessionKey,
        agentBindings,
        state: nextSessionStates[activeSessionKey] ?? current.state,
        sessionStates: nextSessionStates,
        updatedAt: Date.now(),
      };
      await writeDocument({ ...document, profiles });
      return { success: true };
    },
  };
}
