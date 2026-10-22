import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import { expandPath } from '../utils/paths';
import { ensureVerseClawWorkspaceHarness } from '../utils/clawx-harness-template';
import { isRecord } from './payload-utils';
import { syncActiveWorkspacePermissionToRuntime, syncActiveWorkspaceRootToRuntime } from './workspace-runtime-sync';
import { runWorkspacePreflight } from './workspace-preflight';
import type { TerminalSessionManager } from './terminal-session-manager';
import type { WebPreviewManager } from './web-preview-manager';
import type {
  WorkspacePermissionMode,
  WorkspaceAgentBinding,
  WorkspaceCoordinatorBinding,
  WorkspaceCoordinatorInvalidationReason,
  WorkspaceCoordinatorTaskRef,
  WorkspaceProfile,
  WorkspaceSnapshot,
  WorkspaceUiState,
  SessionFolder,
} from '@shared/types/workspace';
import {
  DEFAULT_WORKSPACE_PERMISSION_MODE,
  normalizeWorkspacePermissionMode,
} from '@shared/types/workspace';
import { createPermissionDecisionEvent } from '@shared/product-semantics';
import { recordPermissionDecisionEvent } from './permissions-api';

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

type WorkspaceFolderCreateBody = {
  workspaceId?: unknown;
  name?: unknown;
  parentId?: unknown;
  kind?: unknown;
};

type WorkspaceFolderRenameBody = {
  workspaceId?: unknown;
  folderId?: unknown;
  name?: unknown;
};

type WorkspaceFolderDeleteBody = {
  workspaceId?: unknown;
  folderId?: unknown;
};

type WorkspaceFolderMoveSessionBody = {
  workspaceId?: unknown;
  sessionKey?: unknown;
  folderId?: unknown;
};

const DEFAULT_SESSION_KEY = 'agent:main:main';
const DEFAULT_PERMISSION_MODE: WorkspacePermissionMode = DEFAULT_WORKSPACE_PERMISSION_MODE;

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

function normalizeCoordinatorTaskRefs(value: unknown): WorkspaceCoordinatorTaskRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!isRecord(entry) || entry.kind !== 'task-ledger' || typeof entry.nodeId !== 'string') return [];
    const nodeId = entry.nodeId.trim();
    if (!nodeId || seen.has(nodeId)) return [];
    seen.add(nodeId);
    return [{ kind: 'task-ledger' as const, nodeId }];
  });
}

function normalizeCoordinatorBinding(
  value: unknown,
  workspaceId: string,
): WorkspaceCoordinatorBinding | null {
  if (!isRecord(value)) return null;
  const agentId = typeof value.agentId === 'string' ? value.agentId.trim() : '';
  const sessionKey = typeof value.sessionKey === 'string' ? value.sessionKey.trim() : '';
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : '';
  const revision = typeof value.revision === 'number' && Number.isInteger(value.revision)
    ? value.revision
    : 0;
  const state = value.state === 'invalidated' ? 'invalidated' : value.state === 'active' ? 'active' : null;
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : '';
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : '';
  const taskRefs = normalizeCoordinatorTaskRefs(value.taskRefs);
  if (!agentId || !sessionKey || !sessionId || !state || revision < 1 || !createdAt || !updatedAt || taskRefs.length === 0) {
    return null;
  }
  const allowedReasons = new Set<WorkspaceCoordinatorInvalidationReason>([
    'archived',
    'deleted',
    'reset',
    'session_missing',
    'session_key_changed',
  ]);
  return {
    schemaVersion: 'WorkspaceCoordinatorBinding/v1',
    workspaceId,
    agentId,
    sessionKey,
    sessionId,
    taskRefs,
    state,
    revision,
    createdAt,
    updatedAt,
    invalidatedAt: typeof value.invalidatedAt === 'string' ? value.invalidatedAt : null,
    invalidationReason: typeof value.invalidationReason === 'string'
      && allowedReasons.has(value.invalidationReason as WorkspaceCoordinatorInvalidationReason)
      ? value.invalidationReason as WorkspaceCoordinatorInvalidationReason
      : null,
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
  const sessionFolders = normalizeSessionFolders(profile.sessionFolders);
  const sessionFolderAssignments = normalizeSessionFolderAssignments(profile.sessionFolderAssignments, sessionFolders);
  const coordinatorBinding = normalizeCoordinatorBinding(profile.coordinatorBinding, profile.id);
  return {
    ...profile,
    agentId: selectedAgentId,
    selectedAgentId,
    activeSessionKey: normalizedActiveSessionKey,
    agentBindings,
    permissionMode: normalizePermissionMode(profile.permissionMode),
    state,
    sessionStates,
    sessionFolders,
    sessionFolderAssignments,
    ...(coordinatorBinding ? { coordinatorBinding } : {}),
  };
}

function normalizeSessionFolders(folders: unknown): SessionFolder[] {
  if (!Array.isArray(folders)) return [];
  return folders
    .filter((folder): folder is SessionFolder => Boolean(folder) && typeof folder === 'object'
      && typeof (folder as SessionFolder).id === 'string'
      && typeof (folder as SessionFolder).name === 'string')
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      // Legacy nested folders become independent project-level workgroups.
      parentId: null,
      order: typeof folder.order === 'number' && Number.isFinite(folder.order) ? folder.order : 0,
      kind: folder.kind === 'folder' || folder.kind === 'workgroup' ? folder.kind : undefined,
      createdAt: typeof folder.createdAt === 'number' ? folder.createdAt : Date.now(),
      updatedAt: typeof folder.updatedAt === 'number' ? folder.updatedAt : Date.now(),
    }));
}

function normalizeSessionFolderAssignments(
  assignments: unknown,
  folders: SessionFolder[],
): Record<string, string> {
  if (!isRecord(assignments)) return {};
  const folderIds = new Set(folders.map((folder) => folder.id));
  const result: Record<string, string> = {};
  for (const [sessionKey, folderId] of Object.entries(assignments)) {
    if (typeof folderId === 'string' && folderIds.has(folderId)) {
      result[sessionKey] = folderId;
    }
  }
  return result;
}

function normalizePermissionMode(value: unknown): WorkspacePermissionMode {
  return normalizeWorkspacePermissionMode(value);
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

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function createFolderId(name: string, folders: SessionFolder[]): string {
  const base = normalizeId(name) || 'folder';
  const existing = new Set(folders.map((folder) => folder.id));
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function folderExists(folders: SessionFolder[], folderId: string | null | undefined): boolean {
  return folderId == null || folders.some((folder) => folder.id === folderId);
}

function collectFolderDescendants(folders: SessionFolder[], folderId: string): Set<string> {
  const removed = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && removed.has(folder.parentId) && !removed.has(folder.id)) {
        removed.add(folder.id);
        changed = true;
      }
    }
  }
  return removed;
}

function updateWorkspaceProfile(
  document: WorkspaceStoreDocument,
  workspaceId: string,
  updater: (profile: WorkspaceProfile) => WorkspaceProfile,
): WorkspaceStoreDocument {
  const index = document.profiles.findIndex((profile) => profile.id === workspaceId);
  if (index === -1) throw new Error(`Workspace "${workspaceId}" not found`);
  const profiles = [...document.profiles];
  profiles[index] = updater(profiles[index]);
  return { ...document, profiles };
}

function makeDefaultProfile(): WorkspaceProfile {
  const now = Date.now();
  const rootPath = resolve(expandPath('~/.openclaw/workspace'));
  const state: WorkspaceUiState = {
    chatFooter: {
      contextRangeVisible: true,
      tokenUsageVisible: true,
      workContextVisible: true,
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

let coordinatorBindingMutationTail: Promise<void> = Promise.resolve();

function enqueueCoordinatorBindingMutation<T>(work: () => Promise<T>): Promise<T> {
  const run = coordinatorBindingMutationTail.then(work, work);
  coordinatorBindingMutationTail = run.then(() => undefined, () => undefined);
  return run;
}

/** Persist through the existing Workspace store with revision CAS. */
export async function saveWorkspaceCoordinatorBinding(input: {
  workspaceId: string;
  expectedRevision: number;
  binding: WorkspaceCoordinatorBinding;
}): Promise<WorkspaceCoordinatorBinding> {
  return enqueueCoordinatorBindingMutation(async () => {
    const document = await readDocument();
    const index = document.profiles.findIndex((profile) => profile.id === input.workspaceId);
    if (index === -1) throw new Error(`Workspace "${input.workspaceId}" not found`);
    const profile = document.profiles[index];
    if (profile.selectedAgentId !== input.binding.agentId || profile.activeSessionKey !== input.binding.sessionKey) {
      throw new Error('Coordinator binding must target the selected workspace assistant and session');
    }
    const currentRevision = profile.coordinatorBinding?.revision ?? 0;
    if (input.expectedRevision !== currentRevision) {
      throw new Error(`Coordinator binding revision conflict: expected ${currentRevision}, received ${input.expectedRevision}`);
    }
    if (input.binding.workspaceId !== profile.id
      || input.binding.revision !== currentRevision + 1
      || input.binding.taskRefs.length === 0
      || new Set(input.binding.taskRefs.map((ref) => ref.nodeId)).size !== input.binding.taskRefs.length) {
      throw new Error('Invalid coordinator binding revision or Task Ledger references');
    }
    const profiles = [...document.profiles];
    profiles[index] = {
      ...profile,
      coordinatorBinding: input.binding,
      updatedAt: Date.now(),
    };
    await writeDocument({ ...document, profiles });
    return input.binding;
  });
}

export async function readWorkspaceCoordinatorBinding(
  workspaceId?: string | null,
): Promise<{ workspace: WorkspaceProfile; binding: WorkspaceCoordinatorBinding | null } | null> {
  const document = await ensureDocumentWithDefault();
  const id = workspaceId?.trim() || document.activeWorkspaceId;
  if (!id) return null;
  const workspace = document.profiles.find((profile) => profile.id === id);
  return workspace ? { workspace, binding: workspace.coordinatorBinding ?? null } : null;
}

/**
 * A session mutation that succeeded makes any active long-session binding for
 * that logical key stale. Keep the metadata and increment its revision so the
 * invalidation is durable and visible to later readers.
 */
export async function invalidateWorkspaceCoordinatorBindingsForSession(
  sessionKey: string,
  reason: WorkspaceCoordinatorInvalidationReason,
  options: { workspaceId?: string | null } = {},
): Promise<number> {
  return enqueueCoordinatorBindingMutation(async () => {
    const document = await readDocument();
    const now = new Date().toISOString();
    let invalidated = 0;
    const profiles = document.profiles.map((profile) => {
      if (options.workspaceId && profile.id !== options.workspaceId) return profile;
      const binding = profile.coordinatorBinding;
      if (!binding || binding.sessionKey !== sessionKey || binding.state !== 'active') return profile;
      invalidated += 1;
      return {
        ...profile,
        coordinatorBinding: {
          ...binding,
          state: 'invalidated' as const,
          revision: binding.revision + 1,
          updatedAt: now,
          invalidatedAt: now,
          invalidationReason: reason,
        },
        updatedAt: Date.now(),
      };
    });
    if (invalidated > 0) await writeDocument({ ...document, profiles });
    return invalidated;
  });
}

/**
 * D3 closeout: resolve a workspace's rootPath by id without activating it.
 *
 * Used by `chat-api.ts` to compute the trusted `workspaceFingerprint` from
 * the workspace's normalized rootPath before forwarding it to Gateway via
 * `chat.send`. Returns `undefined` when the workspace id is unknown or the
 * profile has no rootPath; the caller must treat that as "no fingerprint"
 * (workspaceId is still forwarded for Task Ledger continuity).
 *
 * Reads only persisted state — never mutates the active workspace, never
 * triggers harness/terminal/web-preview side effects. Best-effort: errors
 * resolve to `undefined` so the chat-send path cannot throw from a stale
 * workspace store.
 */
export async function getWorkspaceRootPathById(workspaceId: string): Promise<string | undefined> {
  const id = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (!id) return undefined;
  try {
    const document = await readDocument();
    const profile = document.profiles.find((entry) => entry.id === id);
    return profile?.rootPath || undefined;
  } catch {
    return undefined;
  }
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
  // FP-P1-02: also pin the gateway's agents.defaults.workspace to the active
  // profile so there is exactly one workspace authority.
  try {
    await syncActiveWorkspaceRootToRuntime();
  } catch (error) {
    console.warn('[workspaces] Failed to sync workspace root to runtime:', error);
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
          workContextVisible: true,
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
      await ensureVerseClawWorkspaceHarness(rootPath);
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
        await ensureVerseClawWorkspaceHarness(rootPath);
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
      if (nextProfile.permissionMode !== current.permissionMode) {
        // P2-001 / F-AUTH-001: permission mode changes are visible and auditable.
        void recordPermissionDecisionEvent(createPermissionDecisionEvent({
          workspaceMode: nextProfile.permissionMode,
          tool: 'workspaces.updatePermissionMode',
          boundary: 'workspace-mode',
          decision: 'allow',
          reason: `permissionMode changed from ${current.permissionMode} to ${nextProfile.permissionMode}`,
          requestId: `workspace-mode:${id}:${current.permissionMode}->${nextProfile.permissionMode}`,
        })).catch(() => undefined);
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
    // FP-P1-02: preflight a directory before accepting it as the workspace.
    preflight: async (payload) => {
      const body = isRecord(payload) ? payload as { rootPath?: unknown } : {};
      const rootPath = typeof body.rootPath === 'string' ? body.rootPath.trim() : '';
      if (!rootPath) {
        return {
          success: false,
          rootPath: '',
          resolvedPath: '',
          ok: false,
          readOnlyOnly: false,
          isGitRepo: false,
          checks: [],
          error: 'rootPath is required',
        };
      }
      try {
        const result = await runWorkspacePreflight(rootPath);
        return { success: true, ...result };
      } catch (error) {
        return {
          success: false,
          rootPath,
          resolvedPath: rootPath,
          ok: false,
          readOnlyOnly: false,
          isGitRepo: false,
          checks: [],
          error: String(error),
        };
      }
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
    createFolder: async (payload) => {
      const body = isRecord(payload) ? payload as WorkspaceFolderCreateBody : {};
      const workspaceId = requireId(body.workspaceId);
      const name = requireNonEmptyString(body.name, 'name');
      // Session workgroups are project-local and intentionally one level deep.
      // Ignore legacy parentId input so new data cannot recreate nested groups.
      const parentId = null;
      const kind = body.kind === 'folder' || body.kind === 'workgroup'
        ? body.kind
        : 'workgroup';
      const document = await readDocument();
      let createdFolder: SessionFolder | undefined;
      const nextDocument = updateWorkspaceProfile(document, workspaceId, (profile) => {
        const folders = profile.sessionFolders ?? [];
        if (!folderExists(folders, parentId)) {
          throw new Error(`Parent folder "${parentId}" not found`);
        }
        const id = createFolderId(name, folders);
        const now = Date.now();
        const folder: SessionFolder = {
          id,
          name,
          parentId,
          order: folders.length,
          kind,
          createdAt: now,
          updatedAt: now,
        };
        createdFolder = folder;
        return {
          ...profile,
          sessionFolders: [...folders, folder],
          updatedAt: now,
        };
      });
      await writeDocument(nextDocument);
      return { ...successSnapshot(nextDocument), folder: createdFolder };
    },
    renameFolder: async (payload) => {
      const body = isRecord(payload) ? payload as WorkspaceFolderRenameBody : {};
      const workspaceId = requireId(body.workspaceId);
      const folderId = requireId(body.folderId);
      const name = requireNonEmptyString(body.name, 'name');
      const document = await readDocument();
      const nextDocument = updateWorkspaceProfile(document, workspaceId, (profile) => {
        const folders = profile.sessionFolders ?? [];
        if (!folders.some((folder) => folder.id === folderId)) {
          throw new Error(`Folder "${folderId}" not found`);
        }
        const now = Date.now();
        return {
          ...profile,
          sessionFolders: folders.map((folder) => folder.id === folderId
            ? { ...folder, name, updatedAt: now }
            : folder),
          updatedAt: now,
        };
      });
      await writeDocument(nextDocument);
      return successSnapshot(nextDocument);
    },
    deleteFolder: async (payload) => {
      const body = isRecord(payload) ? payload as WorkspaceFolderDeleteBody : {};
      const workspaceId = requireId(body.workspaceId);
      const folderId = requireId(body.folderId);
      const document = await readDocument();
      const nextDocument = updateWorkspaceProfile(document, workspaceId, (profile) => {
        const folders = profile.sessionFolders ?? [];
        const target = folders.find((folder) => folder.id === folderId);
        if (!target) throw new Error(`Folder "${folderId}" not found`);
        const removedIds = collectFolderDescendants(folders, folderId);
        const newParentId = target.parentId;
        const assignments = { ...(profile.sessionFolderAssignments ?? {}) };
        for (const [sessionKey, assignedFolderId] of Object.entries(assignments)) {
          if (typeof assignedFolderId === 'string' && removedIds.has(assignedFolderId)) {
            if (newParentId == null) {
              delete assignments[sessionKey];
            } else {
              assignments[sessionKey] = newParentId;
            }
          }
        }
        const now = Date.now();
        return {
          ...profile,
          sessionFolders: folders.filter((folder) => !removedIds.has(folder.id)),
          sessionFolderAssignments: assignments,
          updatedAt: now,
        };
      });
      await writeDocument(nextDocument);
      return successSnapshot(nextDocument);
    },
    moveSessionToFolder: async (payload) => {
      const body = isRecord(payload) ? payload as WorkspaceFolderMoveSessionBody : {};
      const workspaceId = requireId(body.workspaceId);
      const sessionKey = requireNonEmptyString(body.sessionKey, 'sessionKey');
      const folderId = typeof body.folderId === 'string' && body.folderId.trim()
        ? body.folderId.trim()
        : null;
      const document = await readDocument();
      const nextDocument = updateWorkspaceProfile(document, workspaceId, (profile) => {
        const folders = profile.sessionFolders ?? [];
        if (!folderExists(folders, folderId)) {
          throw new Error(`Folder "${folderId}" not found`);
        }
        const assignments = { ...(profile.sessionFolderAssignments ?? {}) };
        if (folderId == null) {
          delete assignments[sessionKey];
        } else {
          assignments[sessionKey] = folderId;
        }
        return {
          ...profile,
          sessionFolderAssignments: assignments,
          updatedAt: Date.now(),
        };
      });
      await writeDocument(nextDocument);
      return successSnapshot(nextDocument);
    },
  };
}
