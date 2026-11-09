import { access, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  WorkspaceCoordinatorArchiveRestorePolicy,
  WorkspaceCoordinatorBinding,
  WorkspaceCoordinatorEnvironmentBinding,
  WorkspaceCoordinatorRecovery,
  WorkspaceProfile,
  WorkspaceSnapshot,
  WorkspaceUiState,
  SessionFolder,
} from '@shared/types/workspace';
import type {
  WorkspaceCoordinatorBindingResult,
  WorkspaceCoordinatorPausePayload,
  WorkspaceCoordinatorResolvePayload,
  WorkspaceSessionTaskSelectPayload,
} from '@shared/host-api/contract';
import type { GitWorktree } from '@shared/types/git';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';
import {
  createTaskLedgerReference,
  isTaskLedgerReference,
} from '@shared/types/task-ledger-reference';
import {
  DEFAULT_WORKSPACE_PERMISSION_MODE,
  normalizeWorkspacePermissionMode,
} from '@shared/types/workspace';
import { createPermissionDecisionEvent } from '@shared/product-semantics';
import { recordPermissionDecisionEvent } from './permissions-api';
import { normalizeTaskLedgerWorkspaceId } from './task-ledger-service';
import { normalizeRunScope, normalizeTaskReference } from '@shared/types/identity-scope';
import type { SessionHandoffOperation } from '@shared/types/session-handoff';
import type { ExecutionMigrationOperation, WorkspaceExecutionMigrationPayload } from '@shared/types/execution-migration';
import {
  parseSessionTaskEffectRequest,
  type SessionTaskEffectRequest,
  type SessionTaskEffectAdmission,
  type SessionTaskWriterClaim,
  type SessionTaskRequesterReference,
} from '@shared/session-task-scope';


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

type CoordinatorBindBody = {
  workspaceId?: unknown;
  agentId?: unknown;
  sessionKey?: unknown;
  expectedRevision?: unknown;
  taskLedgerNodeIds?: unknown;
  environment?: unknown;
  archiveRestorePolicy?: unknown;
};

type CoordinatorResolveBody = Omit<WorkspaceCoordinatorResolvePayload, 'workspaceId' | 'agentId' | 'sessionKey'> & {
  workspaceId?: unknown;
  agentId?: unknown;
  sessionKey?: unknown;
};

type CoordinatorPauseBody = Omit<WorkspaceCoordinatorPausePayload, 'workspaceId' | 'agentId' | 'sessionKey' | 'expectedRevision'> & {
  workspaceId?: unknown;
  agentId?: unknown;
  sessionKey?: unknown;
  expectedRevision?: unknown;
};

export type WorkspaceCoordinatorLifecycleEvent =
  | { type: 'archive'; workspaceId?: string | null; sessionKey: string }
  | { type: 'restore'; workspaceId?: string | null; sessionKey: string }
  | { type: 'delete'; workspaceId?: string | null; sessionKey: string }
  | { type: 'handoff'; workspaceId?: string | null; sourceSessionKey: string; sessionKey: string; agentId: string };

export type WorkspaceCoordinatorLifecycleObserver = (event: WorkspaceCoordinatorLifecycleEvent) => Promise<void>;

const DEFAULT_SESSION_KEY = 'agent:main:main';
const DEFAULT_PERMISSION_MODE: WorkspacePermissionMode = DEFAULT_WORKSPACE_PERMISSION_MODE;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let workspaceStoreInstance: any = null;
let coordinatorMutationTail: Promise<void> = Promise.resolve();

async function withCoordinatorMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = coordinatorMutationTail;
  let release!: () => void;
  coordinatorMutationTail = new Promise<void>((resolveTail) => { release = resolveTail; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

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

function normalizeWriterClaim(value: unknown, workspaceId: string, sessionKey: string): SessionTaskWriterClaim {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id
    || typeof value.sessionGeneration !== 'string' || !value.sessionGeneration
    || typeof value.createdAt !== 'string') throw coordinatorError('TASK_SCOPE_CLAIM_INVALID', 'Invalid stored writer.');
  const run = normalizeRunScope(value.run);
  const task = normalizeTaskReference({ kind: 'ledger', taskNodeId: value.taskNodeId });
  if (run.scope.workspaceId !== workspaceId || run.scope.sessionKey !== sessionKey || task.kind !== 'ledger') {
    throw coordinatorError('TASK_SCOPE_CLAIM_INVALID', 'Stored writer scope does not match its owner.');
  }
  const credential = value.credential;
  if (credential !== undefined && (!isRecord(credential) || credential.taskNodeId !== task.taskNodeId
    || credential.sessionKey !== sessionKey || credential.generation !== value.sessionGeneration
    || typeof credential.epoch !== 'number' || !Number.isSafeInteger(credential.epoch) || credential.epoch < 1)) {
    throw coordinatorError('TASK_SCOPE_CLAIM_INVALID', 'Stored execution credential does not match its owner.');
  }
  if (value.executionRevision !== undefined && (!Number.isSafeInteger(value.executionRevision) || Number(value.executionRevision) < 1)) {
    throw coordinatorError('TASK_SCOPE_CLAIM_INVALID', 'Invalid captured execution binding.');
  }
  return { id: value.id, run, taskNodeId: task.taskNodeId, sessionGeneration: value.sessionGeneration, createdAt: value.createdAt,
    ...(value.executionRevision !== undefined ? { executionRevision: value.executionRevision as number } : {}),
    ...(isRecord(credential) ? { credential: { taskNodeId: task.taskNodeId, sessionKey: run.scope.sessionKey,
      generation: value.sessionGeneration, epoch: credential.epoch as number } } : {}) };
}

function normalizeCoordinatorBindings(
  value: unknown,
  workspaceId: string,
): Record<string, WorkspaceCoordinatorBinding> | undefined {
  if (!isRecord(value)) return undefined;
  const bindings: Record<string, WorkspaceCoordinatorBinding> = {};
  for (const [sessionKey, candidate] of Object.entries(value)) {
    if (!isRecord(candidate) || candidate.workspaceId !== workspaceId || sessionKey !== candidate.sessionKey) continue;
    const environment = isRecord(candidate.environment) ? candidate.environment : null;
    if (
      !environment
      || (environment.kind !== 'local' && environment.kind !== 'managed-worktree')
      || (environment.backend !== 'local-workspace' && environment.backend !== 'git')
      || typeof environment.canonicalRoot !== 'string'
      || typeof environment.detachedHead !== 'boolean'
    ) continue;
    const refs = Array.isArray(candidate.taskLedgerReferences)
      ? candidate.taskLedgerReferences.filter(isTaskLedgerReference)
      : [];
    if (!refs.length) continue;
    const bindingRevision = Number(candidate.bindingRevision);
    if (!Number.isInteger(bindingRevision) || bindingRevision < 1) continue;
    if (
      candidate.schemaVersion !== 1
      || (candidate.state !== 'active' && candidate.state !== 'paused' && candidate.state !== 'invalid')
      || (candidate.archiveRestorePolicy !== 'restore' && candidate.archiveRestorePolicy !== 'none')
      || typeof candidate.createdAt !== 'string'
      || typeof candidate.updatedAt !== 'string'
    ) continue;
    bindings[sessionKey] = {
      schemaVersion: 1,
      workspaceId,
      agentId: typeof candidate.agentId === 'string' ? candidate.agentId : '',
      sessionKey,
      sessionGeneration: typeof candidate.sessionGeneration === 'string' ? candidate.sessionGeneration : null,
      taskLedgerReferences: refs,
      ...(typeof candidate.activeTaskNodeId === 'string' ? { activeTaskNodeId: candidate.activeTaskNodeId } : {}),
      ...(candidate.writerClaim ? { writerClaim: normalizeWriterClaim(candidate.writerClaim, workspaceId, sessionKey) } : {}),
      environment: {
        kind: environment.kind,
        canonicalRoot: environment.canonicalRoot,
        backend: environment.backend,
        branch: typeof environment.branch === 'string' ? environment.branch : null,
        detachedHead: environment.detachedHead,
        setupProfile: typeof environment.setupProfile === 'string' ? environment.setupProfile : null,
      },
      archiveRestorePolicy: candidate.archiveRestorePolicy,
      state: candidate.state,
      bindingRevision,
      invalidationReason: typeof candidate.invalidationReason === 'string' ? candidate.invalidationReason : null,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    };
  }
  return Object.keys(bindings).length > 0 ? bindings : undefined;
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
  const coordinatorBindings = normalizeCoordinatorBindings(profile.coordinatorBindings, profile.id);
  return {
    ...profile,
    agentId: selectedAgentId,
    selectedAgentId,
    activeSessionKey: normalizedActiveSessionKey,
    agentBindings,
    ...(coordinatorBindings ? { coordinatorBindings } : {}),
    permissionMode: normalizePermissionMode(profile.permissionMode),
    state,
    sessionStates,
    sessionFolders,
    sessionFolderAssignments,
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

async function writeDocument(document: WorkspaceStoreDocument, coordinatorMutation = false,
  handoffTransfer?: { workspaceId?: string | null; agentId: string; sourceSessionKey: string; sessionKey: string }): Promise<void> {
  const store = await getWorkspaceStore();
  // A UI-state save may have read before a writer claim was issued. Only the
  // serialized coordinator owner replaces its own fields.
  const current = (store.get('profiles') ?? []) as WorkspaceProfile[];
  const profiles = coordinatorMutation ? current.map((profile) => {
    const updated = document.profiles.find((entry) => entry.id === profile.id);
    if (!updated) return profile;
    const priorAgent = handoffTransfer && (!handoffTransfer.workspaceId || handoffTransfer.workspaceId === profile.id)
      ? profile.agentBindings?.[handoffTransfer.agentId] : undefined;
    return { ...profile, coordinatorBindings: updated.coordinatorBindings, handoffOperations: updated.handoffOperations, executionMigrations: updated.executionMigrations,
      projectCoordinatorSessionKey: handoffTransfer && profile.projectCoordinatorSessionKey === handoffTransfer.sourceSessionKey
        ? handoffTransfer.sessionKey : updated.projectCoordinatorSessionKey,
      ...(handoffTransfer && priorAgent?.sessionKey === handoffTransfer.sourceSessionKey ? { agentBindings: {
        ...profile.agentBindings, [handoffTransfer.agentId]: { ...priorAgent, sessionKey: handoffTransfer.sessionKey },
      } } : {}), updatedAt: Math.max(profile.updatedAt, updated.updatedAt) };
  }) : document.profiles.map((profile) => {
    const latest = current.find((entry) => entry.id === profile.id);
    return latest ? { ...profile, coordinatorBindings: latest.coordinatorBindings, handoffOperations: latest.handoffOperations, executionMigrations: latest.executionMigrations,
      projectCoordinatorSessionKey: latest.projectCoordinatorSessionKey } : profile;
  });
  store.set('profiles', profiles);
  if (!coordinatorMutation) store.set('activeWorkspaceId', document.activeWorkspaceId);
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
export async function getPersistedCoordinatorBinding(
  workspaceId: string,
  sessionKey: string,
): Promise<WorkspaceCoordinatorBinding | null> {
  const document = await readDocument();
  const profile = document.profiles.find((candidate) => candidate.id === workspaceId);
  const binding = profile?.coordinatorBindings?.[sessionKey];
  return binding?.workspaceId === workspaceId && binding.sessionKey === sessionKey ? binding : null;
}

export async function readWorkspaceHandoffOperation(input: {
  workspaceId: string; sessionKey: string; operationId?: string;
}): Promise<SessionHandoffOperation | null> {
  const document = await readDocument();
  const profile = document.profiles.find((entry) => entry.id === input.workspaceId);
  const operations = Object.values(profile?.handoffOperations ?? {}).filter((operation) =>
    operation.workspaceId === input.workspaceId
    && (operation.sourceSessionKey === input.sessionKey || operation.sessionKey === input.sessionKey)
    && (!input.operationId || operation.id === input.operationId));
  return operations.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

export async function updateWorkspaceHandoffOperation(
  workspaceId: string,
  operationId: string,
  update: (current: SessionHandoffOperation | null) => SessionHandoffOperation,
): Promise<SessionHandoffOperation> {
  return withCoordinatorMutationLock(async () => {
    const document = await readDocument();
    const profile = document.profiles.find((entry) => entry.id === workspaceId);
    if (!profile) throw new Error('HANDOFF_WORKSPACE_MISSING');
    const current = profile.handoffOperations?.[operationId] ?? null;
    const next = update(current);
    if (next.id !== operationId || next.workspaceId !== workspaceId
      || (current && (current.sourceSessionKey !== next.sourceSessionKey || current.sourceGeneration !== next.sourceGeneration
        || current.sessionKey !== next.sessionKey || current.firstSendIdempotencyKey !== next.firstSendIdempotencyKey))) {
      throw new Error('HANDOFF_OPERATION_SCOPE_MISMATCH');
    }
    const updated = { ...next, updatedAt: new Date().toISOString() };
    await writeDocument(updateWorkspaceProfile(document, workspaceId, (entry) => ({
      ...entry, handoffOperations: { ...entry.handoffOperations, [operationId]: updated },
    })), true);
    return updated;
  });
}

export async function beginWorkspaceHandoffSend(input: {
  workspaceId: string; sessionKey: string; operationId: string; idempotencyKey: string; draftInput: string; requestDigest: string;
}): Promise<SessionHandoffOperation> {
  return updateWorkspaceHandoffOperation(input.workspaceId, input.operationId, (current) => {
    if (!current || current.sessionKey !== input.sessionKey || current.firstSendIdempotencyKey !== input.idempotencyKey
      || current.draftDigest !== createHash('sha256').update(input.draftInput).digest('hex')) throw new Error('HANDOFF_SEND_SCOPE_MISMATCH');
    if (!/^[a-f0-9]{64}$/.test(input.requestDigest)
      || (current.firstSendRequestDigest && current.firstSendRequestDigest !== input.requestDigest)) throw new Error('HANDOFF_SEND_PAYLOAD_CHANGED');
    if ((current.phase === 'accepted' || current.phase === 'sent') && current.receipt) return current;
    if (current.phase !== 'ready' && current.phase !== 'failed') throw new Error('HANDOFF_DELIVERY_REQUIRES_RECONCILIATION');
    return { ...current, firstSendRequestDigest: input.requestDigest, phase: 'sending', error: null };
  });
}

async function readExecutionMigrationOperation(workspaceId: string, sessionKey: string, operationId?: string): Promise<ExecutionMigrationOperation | null> {
  const document=await readDocument();
  const operations=Object.values(document.profiles.find(profile=>profile.id===workspaceId)?.executionMigrations??{})
    .filter(operation=>operation.sessionKey===sessionKey&&(!operationId||operation.id===operationId));
  return operations.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]??null;
}

async function migrateWorkspaceExecution(ctx: WorkspacesApiContext, input: WorkspaceExecutionMigrationPayload): Promise<ExecutionMigrationOperation> {
  if(!ctx.gatewayManager)throw new Error('MIGRATION_GATEWAY_UNAVAILABLE');
  const { migrateExecutionEnvironment }=await import('./execution-migration');
  return migrateExecutionEnvironment(input,{
    read:async()=>{
      const document=await readDocument();
      const source=document.profiles.find(profile=>profile.id===input.workspaceId);
      const target=document.profiles.find(profile=>profile.id===input.targetWorkspaceId);
      if(!source||!target)throw new Error('MIGRATION_WORKSPACE_UNAVAILABLE');
      const conflict=Object.values(source.executionMigrations??{}).find(operation=>operation.sessionKey===input.sessionKey
        &&operation.id!==input.operationId&&operation.phase!=='confirmed');
      if(conflict)throw new Error('MIGRATION_ALREADY_PENDING');
      return{source,target,operation:source.executionMigrations?.[input.operationId]??null};
    },
    save:async operation=>{
      const document=await readDocument();
      await writeDocument(updateWorkspaceProfile(document,operation.workspaceId,profile=>({...profile,
        executionMigrations:{...profile.executionMigrations,[operation.id]:structuredClone(operation)},updatedAt:Date.now()})),true);
    },
    fence:async operation=>{
      const document=await readDocument();
      await writeDocument(updateWorkspaceProfile(document,operation.workspaceId,profile=>{
        const binding=profile.coordinatorBindings?.[operation.sessionKey];
        if(!binding||binding.sessionGeneration!==operation.sourceGeneration)throw new Error('MIGRATION_SOURCE_BINDING_STALE');
        if(binding.invalidationReason===`execution-migration:${operation.id}`)return profile;
        if(binding.bindingRevision!==operation.sourceBindingRevision)throw new Error('MIGRATION_SOURCE_BINDING_STALE');
        return{...profile,coordinatorBindings:{...profile.coordinatorBindings,[operation.sessionKey]:{...binding,state:'invalid',
          invalidationReason:`execution-migration:${operation.id}`,bindingRevision:binding.bindingRevision+1,updatedAt:new Date().toISOString()}},updatedAt:Date.now()};
      }),true);
    },
    bind:async(operation,active)=>{
      const document=await readDocument();
      const source=document.profiles.find(profile=>profile.id===operation.workspaceId)!;
      const target=document.profiles.find(profile=>profile.id===operation.targetWorkspaceId)!;
      const environment=await resolveCoordinatorEnvironment(ctx,target,{kind:'local',rootPath:operation.targetRoot});
      const existing=target.coordinatorBindings?.[operation.sessionKey];
      const expected=operation.targetBindingRevision??(existing?.bindingRevision??0)+1;
      const binding:WorkspaceCoordinatorBinding={schemaVersion:1,workspaceId:target.id,agentId:operation.agentId,
        sessionKey:operation.sessionKey,sessionGeneration:operation.targetGeneration,activeTaskNodeId:operation.task.credential.taskNodeId,
        taskLedgerReferences:[createTaskLedgerReference({taskLedgerNodeId:operation.task.credential.taskNodeId,source:'runtime'})],environment,
        state:active?'active':'paused',bindingRevision:expected,invalidationReason:active?null:`execution-migration:${operation.id}`,
        archiveRestorePolicy:'restore',createdAt:existing?.createdAt??new Date().toISOString(),updatedAt:new Date().toISOString()};
      if(ctx.taskLedgerApi?.appendEvents)await ctx.taskLedgerApi.appendEvents({workspaceId:target.id,idempotencyKey:`migration:${operation.id}:target-link`,events:[{
        id:`migration:${operation.id}:target-link`,type:'session_linked',actor:'system',taskId:operation.task.credential.taskNodeId,sessionId:operation.sessionKey,
        payload:{sessionLink:{id:`migration:${operation.id}:target-link`,nodeId:operation.task.credential.taskNodeId,sessionKey:operation.sessionKey,
          sessionGeneration:operation.targetGeneration,agentId:operation.agentId,relation:'related',createdAt:operation.createdAt}},
      }]});
      const store=await getWorkspaceStore();
      const latest=(store.get('profiles')??[]) as WorkspaceProfile[];
      const sourceState=source.sessionStates?.[operation.sessionKey]??{};
      const activate=active&&store.get('activeWorkspaceId')===source.id&&source.activeSessionKey===operation.sessionKey;
      const profiles=latest.map(profile=>{
        if(profile.id===target.id)return{...profile,coordinatorBindings:{...profile.coordinatorBindings,[operation.sessionKey]:binding},
          ...(active&&source.id===target.id?{executionMigrations:{...profile.executionMigrations,[operation.id]:{...operation,phase:'confirmed' as const}}}:{}),
          ...(active?{
            sessionStates:{...profile.sessionStates,[operation.sessionKey]:{...sourceState,readingPosition:undefined}},
            projectCoordinatorSessionKey:profile.projectCoordinatorSessionKey??operation.sessionKey}:{}),updatedAt:Date.now()};
        if(active&&profile.id===source.id&&source.id!==target.id){
          const states={...profile.sessionStates};delete states[operation.sessionKey];
          const bindings={...profile.coordinatorBindings};delete bindings[operation.sessionKey];
          const assignments={...profile.sessionFolderAssignments};delete assignments[operation.sessionKey];
          const replacement=`agent:${operation.agentId}:session-migrated-${operation.id}`;
          return{...profile,sessionStates:states,coordinatorBindings:bindings,sessionFolderAssignments:assignments,
            executionMigrations:{...profile.executionMigrations,[operation.id]:{...operation,phase:'confirmed' as const}},
            activeSessionKey:profile.activeSessionKey===operation.sessionKey?replacement:profile.activeSessionKey,
            agentBindings:{...profile.agentBindings,...(profile.agentBindings?.[operation.agentId]?.sessionKey===operation.sessionKey
              ?{[operation.agentId]:{workspaceId:source.id,agentId:operation.agentId,sessionKey:replacement}}:{})},
            projectCoordinatorSessionKey:profile.projectCoordinatorSessionKey===operation.sessionKey?undefined:profile.projectCoordinatorSessionKey,updatedAt:Date.now()};
        }
        return profile;
      });
      if(activate){const destination=profiles.find(profile=>profile.id===target.id)!;
        destination.agentId=operation.agentId;destination.selectedAgentId=operation.agentId;destination.activeSessionKey=operation.sessionKey;
        destination.agentBindings={...destination.agentBindings,[operation.agentId]:{workspaceId:target.id,agentId:operation.agentId,sessionKey:operation.sessionKey}};
      }
      store.set('profiles',profiles);
      if(activate)store.set('activeWorkspaceId',target.id);
      return binding;
    },
  },ctx.gatewayManager);
}

export async function materializeCoordinatorSessionGeneration(input: {
  workspaceId: string;
  sessionKey: string;
  sessionId: string;
}): Promise<WorkspaceCoordinatorBinding | null> {
  return withCoordinatorMutationLock(async () => {
    const document = await readDocument();
    const profile = document.profiles.find((candidate) => candidate.id === input.workspaceId);
    const binding = profile?.coordinatorBindings?.[input.sessionKey];
    if (!profile || !binding) return null;
    if (binding.sessionGeneration && binding.sessionGeneration !== input.sessionId) {
      throw coordinatorError('COORDINATOR_GENERATION_MISMATCH', 'The bound session generation changed before materialization.');
    }
    if (binding.sessionGeneration === input.sessionId) return binding;
    return persistCoordinatorBinding(input.workspaceId, input.sessionKey, (current) => {
      const target = current ?? binding;
      return {
        ...target,
        sessionGeneration: input.sessionId,
        bindingRevision: target.bindingRevision + 1,
        updatedAt: new Date().toISOString(),
      };
    });
  });
}

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
  gitApi?: {
    status: CompleteHostServiceRegistry['git']['status'];
    worktrees: CompleteHostServiceRegistry['git']['worktrees'];
    statusForWorkspace?: (workspace: WorkspaceProfile) => ReturnType<CompleteHostServiceRegistry['git']['status']>;
    worktreesForWorkspace?: (workspace: WorkspaceProfile) => ReturnType<CompleteHostServiceRegistry['git']['worktrees']>;
  };
  taskLedgerApi?: Pick<CompleteHostServiceRegistry['taskLedger'], 'snapshot'> & Partial<Pick<CompleteHostServiceRegistry['taskLedger'], 'appendEvents'>>;
};

async function syncWorkspacePermissionBestEffort(): Promise<void> {
  // The workspace owner supplies its current reader. Sync must not import this
  // service or snapshot it earlier, before a create/switch/delete is persisted.
  try {
    await syncActiveWorkspacePermissionToRuntime(getActiveWorkspaceProfile);
  } catch (error) {
    console.warn('[workspaces] Failed to sync workspace permission to runtime:', error);
  }
  // FP-P1-02: also pin the gateway's agents.defaults.workspace to the active
  // profile so there is exactly one workspace authority.
  try {
    await syncActiveWorkspaceRootToRuntime(getActiveWorkspaceProfile);
  } catch (error) {
    console.warn('[workspaces] Failed to sync workspace root to runtime:', error);
  }
}

type CoordinatorSessionDescription = {
  session?: {
    key?: string;
    sessionId?: string;
    status?: string;
    hasActiveRun?: boolean;
  } | null;
};

function coordinatorError(code: string, reason: string): Error {
  return new Error(`${code}: ${reason}`);
}

function pathKey(value: string): string {
  const normalized = resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isSamePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function sessionAgentId(sessionKey: string): string | null {
  const parts = sessionKey.split(':');
  return parts[0] === 'agent' && parts[1] ? parts[1] : null;
}

function coordinatorRecovery(
  state: WorkspaceCoordinatorRecovery['state'],
  reason: string | null,
  binding: WorkspaceCoordinatorBinding | null,
): WorkspaceCoordinatorRecovery {
  return { state, reason, bindingRevision: binding?.bindingRevision ?? null };
}

function coordinatorResult(
  binding: WorkspaceCoordinatorBinding | null,
  recovery: WorkspaceCoordinatorRecovery,
): WorkspaceCoordinatorBindingResult {
  return { success: true, binding, recovery };
}

async function describeCoordinatorSession(
  ctx: WorkspacesApiContext,
  sessionKey: string,
  agentId: string,
): Promise<{ sessionId: string; sessionKey: string; status: string | null; hasActiveRun: boolean }> {
  if (!ctx.gatewayManager) {
    throw coordinatorError('COORDINATOR_GATEWAY_UNAVAILABLE', 'Gateway manager is unavailable.');
  }
  const result = await ctx.gatewayManager.rpc<CoordinatorSessionDescription>(
    'sessions.describe',
    { key: sessionKey },
    15_000,
  );
  const session = result?.session;
  if (!session?.sessionId) {
    throw coordinatorError('COORDINATOR_SESSION_MISSING', `Session ${sessionKey} does not exist.`);
  }
  if (session.key && session.key !== sessionKey) {
    throw coordinatorError('COORDINATOR_SESSION_SCOPE_MISMATCH', `Gateway resolved ${sessionKey} as ${session.key}.`);
  }
  if (sessionAgentId(sessionKey) !== agentId) {
    throw coordinatorError('COORDINATOR_AGENT_SCOPE_MISMATCH', `Session ${sessionKey} does not belong to agent ${agentId}.`);
  }
  return {
    sessionId: session.sessionId,
    sessionKey,
    status: typeof session.status === 'string' ? session.status : null,
    hasActiveRun: session.hasActiveRun === true,
  };
}

async function validateCoordinatorTaskReferences(
  ctx: WorkspacesApiContext,
  workspaceId: string,
  taskLedgerNodeIds: string[],
): Promise<WorkspaceCoordinatorBinding['taskLedgerReferences']> {
  if (!ctx.taskLedgerApi) {
    throw coordinatorError('COORDINATOR_TASK_LEDGER_UNAVAILABLE', 'Task Ledger service is unavailable.');
  }
  const requested = [...new Set(taskLedgerNodeIds.map((value) => value.trim()).filter(Boolean))];
  if (requested.length === 0) {
    throw coordinatorError('COORDINATOR_TASK_REF_REQUIRED', 'At least one existing Task Ledger node is required.');
  }
  const result = await ctx.taskLedgerApi.snapshot({ workspaceId });
  if (!result.success) {
    throw coordinatorError('COORDINATOR_TASK_LEDGER_UNAVAILABLE', result.error ?? 'Task Ledger snapshot failed.');
  }
  const snapshot: TaskLedgerSnapshot = result.snapshot;
  if (snapshot.workspaceId !== normalizeTaskLedgerWorkspaceId(workspaceId)) {
    throw coordinatorError('COORDINATOR_WORKSPACE_SCOPE_MISMATCH', 'Task Ledger returned a different workspace.');
  }
  if (snapshot.warnings.length > 0) {
    throw coordinatorError('COORDINATOR_TASK_LEDGER_INVALID', 'Task Ledger contains unresolved warnings.');
  }
  const nodes = new Set(snapshot.nodes.map((node) => node.id));
  const missing = requested.filter((nodeId) => !nodes.has(nodeId));
  if (missing.length > 0) {
    throw coordinatorError('COORDINATOR_TASK_REF_MISSING', `Unknown Task Ledger nodes: ${missing.join(', ')}.`);
  }
  return requested.map((taskLedgerNodeId) => createTaskLedgerReference({
    taskLedgerNodeId,
    source: 'runtime',
  }));
}

async function resolveCoordinatorEnvironment(
  ctx: WorkspacesApiContext,
  profile: WorkspaceProfile,
  selection: { kind: 'local' | 'managed-worktree'; rootPath: string; setupProfile?: string | null },
): Promise<WorkspaceCoordinatorEnvironmentBinding> {
  const rootPath = await normalizeRootPath(selection.rootPath);
  const setupProfile = typeof selection.setupProfile === 'string' && selection.setupProfile.trim()
    ? selection.setupProfile.trim().slice(0, 160)
    : null;
  if (selection.kind === 'local') {
    if (!isSamePath(await realpath(rootPath), await realpath(profile.rootPath))) {
      throw coordinatorError('COORDINATOR_ENVIRONMENT_SCOPE_MISMATCH', 'A local environment must be the bound workspace root.');
    }
    if (!ctx.gitApi) {
      throw coordinatorError('COORDINATOR_GIT_OWNER_UNAVAILABLE', 'Git owner is unavailable.');
    }
    const status = await (ctx.gitApi.statusForWorkspace?.(profile) ?? ctx.gitApi.status());
    if (!status.success) {
      throw coordinatorError('COORDINATOR_ENVIRONMENT_UNAVAILABLE', status.error ?? 'Could not read local checkout status.');
    }
    if (!isSamePath(await realpath(status.status.workspaceRoot), await realpath(rootPath))) {
      throw coordinatorError('COORDINATOR_ENVIRONMENT_SCOPE_MISMATCH', 'Git returned another workspace root.');
    }
    return {
      kind: 'local',
      canonicalRoot: rootPath,
      backend: status.status.isRepository ? 'git' : 'local-workspace',
      branch: status.status.isRepository ? status.status.branch?.trim() || null : null,
      detachedHead: status.status.isRepository ? status.status.detached === true : false,
      setupProfile,
    };
  }
  if (!ctx.gitApi) {
    throw coordinatorError('COORDINATOR_GIT_OWNER_UNAVAILABLE', 'Git owner is unavailable.');
  }
  const listed = await (ctx.gitApi.worktreesForWorkspace?.(profile) ?? ctx.gitApi.worktrees());
  if (!listed.success) {
    throw coordinatorError('COORDINATOR_ENVIRONMENT_UNAVAILABLE', listed.error ?? 'Could not list managed worktrees.');
  }
  const match = listed.worktrees.find((worktree) => isSamePath(worktree.path, rootPath));
  if (!match || match.bare || match.prunable) {
    throw coordinatorError('COORDINATOR_ENVIRONMENT_MISSING', 'The selected managed worktree is not registered by the Git owner.');
  }
  const branch = match.branch?.trim() || null;
  if (branch) {
    const owners = listed.worktrees.filter((worktree: GitWorktree) => worktree.branch === branch);
    if (owners.length !== 1 || !isSamePath(owners[0].path, match.path)) {
      throw coordinatorError('COORDINATOR_BRANCH_NOT_UNIQUE', `Branch ${branch} is checked out more than once.`);
    }
  }
  return {
    kind: 'managed-worktree',
    canonicalRoot: resolve(match.path),
    backend: 'git',
    branch,
    detachedHead: match.detached === true || !branch,
    setupProfile,
  };
}

async function validateStoredCoordinatorEnvironment(
  ctx: WorkspacesApiContext,
  profile: WorkspaceProfile,
  binding: WorkspaceCoordinatorBinding,
): Promise<{ ok: true; environment: WorkspaceCoordinatorEnvironmentBinding } | { ok: false; reason: string }> {
  try {
    const environment = await resolveCoordinatorEnvironment(ctx, profile, {
      kind: binding.environment.kind,
      rootPath: binding.environment.canonicalRoot,
      setupProfile: binding.environment.setupProfile,
    });
    if (
      environment.backend !== binding.environment.backend
      || environment.branch !== binding.environment.branch
      || environment.detachedHead !== binding.environment.detachedHead
    ) {
      return { ok: false, reason: 'environment-generation-changed' };
    }
    return { ok: true, environment };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'environment-unavailable' };
  }
}

async function persistCoordinatorBinding(
  workspaceId: string,
  sessionKey: string,
  updater: (current: WorkspaceCoordinatorBinding | undefined, profile: WorkspaceProfile) => WorkspaceCoordinatorBinding,
  projectEntry = false,
): Promise<WorkspaceCoordinatorBinding> {
  const document = await readDocument();
  let persisted: WorkspaceCoordinatorBinding | null = null;
  const nextDocument = updateWorkspaceProfile(document, workspaceId, (profile) => {
    const current = profile.coordinatorBindings?.[sessionKey];
    persisted = updater(current, profile);
    return {
      ...profile,
      ...(projectEntry && !profile.projectCoordinatorSessionKey ? { projectCoordinatorSessionKey: sessionKey } : {}),
      coordinatorBindings: {
        ...(profile.coordinatorBindings ?? {}),
        [sessionKey]: persisted,
      },
      updatedAt: Date.now(),
    };
  });
  await writeDocument(nextDocument, true);
  return persisted!;
}

async function markCoordinatorInvalid(
  workspaceId: string,
  sessionKey: string,
  reason: string,
): Promise<WorkspaceCoordinatorBinding | null> {
  const document = await readDocument();
  const profile = document.profiles.find((candidate) => candidate.id === workspaceId);
  const current = profile?.coordinatorBindings?.[sessionKey];
  if (!profile || !current) return null;
  return persistCoordinatorBinding(workspaceId, sessionKey, (existing) => {
    const binding = existing ?? current;
    return {
      ...binding,
      state: 'invalid',
      invalidationReason: reason,
      bindingRevision: binding.bindingRevision + 1,
      updatedAt: new Date().toISOString(),
    };
  });
}

function parseCoordinatorBindPayload(payload: unknown): {
  workspaceId: string;
  agentId: string;
  sessionKey: string;
  expectedRevision: number | undefined;
  taskLedgerNodeIds: string[];
  environment: { kind: 'local' | 'managed-worktree'; rootPath: string; setupProfile: string | null };
  archiveRestorePolicy: WorkspaceCoordinatorArchiveRestorePolicy;
} {
  const body: CoordinatorBindBody = isRecord(payload) ? payload as CoordinatorBindBody : {};
  const workspaceId = requireNonEmptyString(body.workspaceId, 'workspaceId');
  const agentId = requireNonEmptyString(body.agentId, 'agentId');
  const sessionKey = requireNonEmptyString(body.sessionKey, 'sessionKey');
  const expectedRevision = body.expectedRevision === undefined ? undefined : Number(body.expectedRevision);
  if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
    throw coordinatorError('COORDINATOR_REVISION_INVALID', 'expectedRevision must be a non-negative integer.');
  }
  if (!Array.isArray(body.taskLedgerNodeIds) || body.taskLedgerNodeIds.some((value) => typeof value !== 'string')) {
    throw coordinatorError('COORDINATOR_TASK_REFS_INVALID', 'taskLedgerNodeIds must be a string array.');
  }
  const environment = isRecord(body.environment) ? body.environment : null;
  if (
    !environment
    || (environment.kind !== 'local' && environment.kind !== 'managed-worktree')
    || typeof environment.rootPath !== 'string'
    || !environment.rootPath.trim()
  ) {
    throw coordinatorError('COORDINATOR_ENVIRONMENT_INVALID', 'environment.kind and environment.rootPath are required.');
  }
  if (body.archiveRestorePolicy !== 'restore' && body.archiveRestorePolicy !== 'none') {
    throw coordinatorError('COORDINATOR_ARCHIVE_POLICY_INVALID', 'archiveRestorePolicy must be restore or none.');
  }
  return {
    workspaceId,
    agentId,
    sessionKey,
    expectedRevision,
    taskLedgerNodeIds: body.taskLedgerNodeIds,
    environment: {
      kind: environment.kind,
      rootPath: environment.rootPath,
      setupProfile: typeof environment.setupProfile === 'string' ? environment.setupProfile : null,
    },
    archiveRestorePolicy: body.archiveRestorePolicy,
  };
}

function parseCoordinatorResolvePayload(payload: unknown): { workspaceId: string; agentId: string; sessionKey: string } {
  const body: CoordinatorResolveBody = isRecord(payload) ? payload as CoordinatorResolveBody : {};
  return {
    workspaceId: requireNonEmptyString(body.workspaceId, 'workspaceId'),
    agentId: requireNonEmptyString(body.agentId, 'agentId'),
    sessionKey: requireNonEmptyString(body.sessionKey, 'sessionKey'),
  };
}

async function resolveCoordinatorBinding(
  ctx: WorkspacesApiContext,
  payload: WorkspaceCoordinatorResolvePayload,
): Promise<WorkspaceCoordinatorBindingResult> {
  const input = parseCoordinatorResolvePayload(payload);
  const document = await readDocument();
  const profile = document.profiles.find((candidate) => candidate.id === input.workspaceId);
  if (!profile) {
    throw coordinatorError('COORDINATOR_WORKSPACE_MISSING', `Workspace ${input.workspaceId} does not exist.`);
  }
  const binding = profile.coordinatorBindings?.[input.sessionKey];
  if (!binding) {
    return coordinatorResult(null, { state: 'missing', reason: 'coordinator-binding-missing', bindingRevision: null });
  }
  if (binding.workspaceId !== input.workspaceId || binding.agentId !== input.agentId || binding.sessionKey !== input.sessionKey) {
    throw coordinatorError('COORDINATOR_SCOPE_MISMATCH', 'Coordinator binding belongs to another workspace, agent, or session.');
  }
  if (binding.state === 'paused') {
    return coordinatorResult(binding, coordinatorRecovery('paused', binding.invalidationReason ?? 'archive-restore-policy', binding));
  }
  if (binding.state === 'invalid') {
    return coordinatorResult(binding, coordinatorRecovery('invalid', binding.invalidationReason ?? 'binding-invalid', binding));
  }
  if (!ctx.gatewayManager) {
    return coordinatorResult(binding, coordinatorRecovery('unavailable', 'gateway-unavailable', binding));
  }
  let session: { sessionId: string; sessionKey: string };
  try {
    session = await describeCoordinatorSession(ctx, input.sessionKey, input.agentId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'session-unavailable';
    if (message.startsWith('COORDINATOR_SESSION_MISSING') && binding.sessionGeneration === null) {
      return coordinatorResult(binding, coordinatorRecovery('session-pending', 'session-not-materialized', binding));
    }
    if (message.startsWith('COORDINATOR_SESSION_MISSING')) {
      const invalid = await markCoordinatorInvalid(input.workspaceId, input.sessionKey, 'session-missing');
      return coordinatorResult(invalid, coordinatorRecovery('session-missing', 'session-missing', invalid));
    }
    return coordinatorResult(binding, coordinatorRecovery('unavailable', message, binding));
  }
  if (!binding.sessionGeneration) {
    const materialized = await persistCoordinatorBinding(input.workspaceId, input.sessionKey, (current) => {
      const target = current ?? binding;
      return {
        ...target,
        sessionGeneration: session.sessionId,
        bindingRevision: target.bindingRevision + 1,
        updatedAt: new Date().toISOString(),
      };
    });
    return coordinatorResult(materialized, coordinatorRecovery('ready', null, materialized));
  }
  if (binding.sessionGeneration !== session.sessionId) {
    const invalid = await markCoordinatorInvalid(input.workspaceId, input.sessionKey, 'session-generation-mismatch');
    return coordinatorResult(invalid, coordinatorRecovery('generation-mismatch', 'session-generation-mismatch', invalid));
  }
  const environment = await validateStoredCoordinatorEnvironment(ctx, profile, binding);
  if (!environment.ok) {
    const invalid = await markCoordinatorInvalid(input.workspaceId, input.sessionKey, environment.reason);
    return coordinatorResult(invalid, coordinatorRecovery('environment-missing', environment.reason, invalid));
  }
  return coordinatorResult(binding, coordinatorRecovery('ready', null, binding));
}

async function applyCoordinatorLifecycle(
  ctx: WorkspacesApiContext,
  event: WorkspaceCoordinatorLifecycleEvent,
): Promise<void> {
  const now = new Date().toISOString();
  if (event.type === 'restore') {
    const document = await readDocument();
    const matches = document.profiles.flatMap((profile) => {
      if (event.workspaceId && profile.id !== event.workspaceId) return [];
      const binding = profile.coordinatorBindings?.[event.sessionKey];
      return binding ? [{ profile, binding }] : [];
    });
    for (const { profile, binding } of matches) {
      if (binding.archiveRestorePolicy === 'none') {
        await markCoordinatorInvalid(profile.id, event.sessionKey, 'archive-retention-none');
        continue;
      }
      try {
        const session = await describeCoordinatorSession(ctx, event.sessionKey, binding.agentId);
        const environment = await validateStoredCoordinatorEnvironment(ctx, profile, binding);
        if (!environment.ok) {
          await markCoordinatorInvalid(profile.id, event.sessionKey, environment.reason);
          continue;
        }
        await persistCoordinatorBinding(profile.id, event.sessionKey, (current) => {
          const target = current ?? binding;
          return {
            ...target,
            sessionGeneration: session.sessionId,
            state: 'active',
            invalidationReason: null,
            bindingRevision: target.bindingRevision + 1,
            updatedAt: now,
          };
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'archive-restore-revalidation-failed';
        await markCoordinatorInvalid(profile.id, event.sessionKey, reason);
      }
    }
    return;
  }

  const document = await readDocument();
  let changed = false;
  const profiles = document.profiles.map((profile) => {
    if (event.workspaceId && profile.id !== event.workspaceId) return profile;
    const bindings = { ...(profile.coordinatorBindings ?? {}) };
    if (event.type === 'handoff') {
      const source = bindings[event.sourceSessionKey];
      if (!source) {
        if (profile.projectCoordinatorSessionKey === event.sourceSessionKey
          || profile.agentBindings?.[event.agentId]?.sessionKey === event.sourceSessionKey) changed = true;
        return profile;
      }
      if (source.agentId !== event.agentId || sessionAgentId(event.sessionKey) !== event.agentId) {
        throw coordinatorError('COORDINATOR_HANDOFF_SCOPE_MISMATCH', 'Handoff source and child must share the bound agent.');
      }
      changed = true;
      bindings[event.sourceSessionKey] = {
        ...source,
        state: 'paused',
        invalidationReason: 'handoff-to-new-session',
        bindingRevision: source.bindingRevision + 1,
        updatedAt: now,
      };
      bindings[event.sessionKey] = {
        ...source,
        sessionKey: event.sessionKey,
        writerClaim: undefined,
        sessionGeneration: null,
        state: 'active',
        invalidationReason: null,
        bindingRevision: source.bindingRevision + 1,
        createdAt: now,
        updatedAt: now,
        taskLedgerReferences: source.taskLedgerReferences.map((reference) => ({ ...reference })),
        environment: { ...source.environment },
      };
      const agentBinding = profile.agentBindings?.[event.agentId];
      return { ...profile, coordinatorBindings: bindings,
        ...(agentBinding?.sessionKey === event.sourceSessionKey ? { agentBindings: {
          ...profile.agentBindings, [event.agentId]: { ...agentBinding, sessionKey: event.sessionKey },
        } } : {}), updatedAt: Date.now() };
    }
    const binding = bindings[event.sessionKey];
    if (!binding) return profile;
    changed = true;
    const state = event.type === 'archive' && binding.archiveRestorePolicy === 'restore'
      ? 'paused'
      : 'invalid';
    const reason = event.type === 'archive'
      ? binding.archiveRestorePolicy === 'restore'
        ? 'archived-restore-requested'
        : 'archived-retention-none'
      : 'session-deleted';
    bindings[event.sessionKey] = {
      ...binding,
      state,
      invalidationReason: reason,
      bindingRevision: binding.bindingRevision + 1,
      updatedAt: now,
    };
    return { ...profile, coordinatorBindings: bindings, updatedAt: Date.now() };
  });
  if (changed) await writeDocument({ ...document, profiles }, true, event.type === 'handoff' ? event : undefined);
}

type TaskScopeRunState = {
  runId: string;
  sessionKey: string;
  sessionGeneration: string;
  currentGeneration: string | null;
  workspaceId: string | null;
  active: boolean;
  quiescent: boolean;
  inFlightEffects: number;
  inFlightProcesses: number;
  inFlightOperationIds?: string[];
  delegation?: { parentSessionKey: string; parentGeneration: string; workspaceDir: string | null; taskReference?: SessionTaskRequesterReference | null } | null;
  scheduled?: { jobId: string; workspaceDir: string; coordinator?: { workspaceId: string; sessionKey: string; generation: string; taskNodeId?: string } };
};

async function readTaskScopeRun(ctx: WorkspacesApiContext, input: {
  runId: string; sessionKey: string; sessionGeneration: string; processScope?: 'session';
}): Promise<TaskScopeRunState> {
  if (!ctx.gatewayManager) throw new Error('TASK_SCOPE_GATEWAY_UNAVAILABLE');
  const state = await ctx.gatewayManager.rpc<TaskScopeRunState>('taskScope.runState', input, 10_000);
  if (state?.runId !== input.runId || state.sessionKey !== input.sessionKey
    || state.sessionGeneration !== input.sessionGeneration) throw new Error('TASK_SCOPE_RUN_MISMATCH');
  return state;
}

async function admitSessionTaskEffect(ctx: WorkspacesApiContext, raw: SessionTaskEffectRequest): Promise<SessionTaskEffectAdmission> {
  const request = parseSessionTaskEffectRequest(raw);
  const live = await readTaskScopeRun(ctx, request);
  if (!live.active || live.currentGeneration !== request.sessionGeneration) throw new Error('TASK_SCOPE_RUN_STALE');
  const document = await readDocument();
  const candidates = document.profiles.filter((profile) => {
    const parent = live.delegation ? profile.coordinatorBindings?.[live.delegation.parentSessionKey] : null;
    const explicit = profile.activeSessionKey === request.sessionKey
      || Object.hasOwn(profile.sessionStates ?? {}, request.sessionKey)
      || Object.hasOwn(profile.coordinatorBindings ?? {}, request.sessionKey)
      || Object.values(profile.agentBindings ?? {}).some((binding) => binding.sessionKey === request.sessionKey)
      || Boolean(parent && parent.sessionGeneration === live.delegation?.parentGeneration)
      || Boolean(live.scheduled && profile.agentId === sessionAgentId(request.sessionKey)
        && isSamePath(profile.rootPath, live.scheduled.workspaceDir));
    return explicit && (!live.workspaceId || profile.id === live.workspaceId);
  });
  if (candidates.length !== 1) throw new Error('TASK_SCOPE_WORKSPACE_UNAVAILABLE');
  const profile = candidates[0];
  if (live.scheduled?.coordinator) {
    const scheduled = live.scheduled.coordinator;
    const binding = profile.coordinatorBindings?.[scheduled.sessionKey];
    if (!binding || binding.state !== 'active' || binding.workspaceId !== scheduled.workspaceId
      || binding.sessionGeneration !== scheduled.generation) throw new Error('TASK_SCOPE_SCHEDULE_STALE');
    const current = await ctx.gatewayManager!.rpc<CoordinatorSessionDescription>('sessions.describe', { key: scheduled.sessionKey }, 15_000);
    if (current.session?.sessionId !== scheduled.generation) throw new Error('TASK_SCOPE_SCHEDULE_STALE');
  }
  if (profile.archivedSessionKeys?.includes(request.sessionKey)) throw new Error('TASK_SCOPE_SESSION_ARCHIVED');
  const existing = profile.coordinatorBindings?.[request.sessionKey];
  const admittedBeforePause = existing?.state === 'paused' && existing.invalidationReason === 'user-paused'
    && existing.writerClaim?.run.runId === request.runId && existing.writerClaim.sessionGeneration === request.sessionGeneration;
  if (existing && existing.state !== 'active' && !admittedBeforePause) throw new Error('TASK_SCOPE_BINDING_NOT_READY');
  if (existing?.sessionGeneration && existing.sessionGeneration !== request.sessionGeneration) throw new Error('TASK_SCOPE_GENERATION_STALE');
  if (request.expectedClaimId && request.expectedClaimId !== existing?.writerClaim?.id) throw new Error('TASK_SCOPE_WRITER_FENCED');
  if (request.expectedExecutionRevision !== undefined
    && request.expectedExecutionRevision !== (existing?.writerClaim?.executionRevision ?? existing?.bindingRevision)) throw new Error('TASK_SCOPE_BINDING_FENCED');
  const taskOrigin = live.delegation?.taskReference;
  if (taskOrigin && (typeof taskOrigin.taskRef !== 'string' || !taskOrigin.taskRef.trim()
    || taskOrigin.coordinator.workspaceId !== profile.id || taskOrigin.coordinator.sessionKey !== live.delegation?.parentSessionKey
    || taskOrigin.coordinator.sessionGeneration !== live.delegation?.parentGeneration)) throw new Error('TASK_SCOPE_PARENT_TASK_MISMATCH');
  const delegatedParentTask = taskOrigin?.taskRef ?? live.scheduled?.coordinator?.taskNodeId;
  const delegatedRoot = live.delegation?.workspaceDir;
  const root = await realpath(existing?.environment.canonicalRoot ?? delegatedRoot ?? profile.rootPath);
  if (!isSamePath(root, await realpath(request.projectWorkspaceDir ?? request.workspaceDir))) throw new Error('TASK_SCOPE_WORKSPACE_MISMATCH');
  if (!ctx.taskLedgerApi?.appendEvents) throw new Error('TASK_SCOPE_LEDGER_UNAVAILABLE');
  const result = await ctx.taskLedgerApi.snapshot({ workspaceId: profile.id });
  if (!result.success || result.snapshot.workspaceId !== normalizeTaskLedgerWorkspaceId(profile.id)
    || result.snapshot.warnings.length) throw new Error('TASK_SCOPE_LEDGER_UNAVAILABLE');
  const snapshot = result.snapshot;
  if (delegatedParentTask && !snapshot.nodes.some((node) => node.id === delegatedParentTask && node.kind === 'task')) throw new Error('TASK_SCOPE_PARENT_TASK_MISSING');
  const parentSession = live.delegation?.parentSessionKey ?? live.scheduled?.coordinator?.sessionKey;
  const parentGeneration = live.delegation?.parentGeneration ?? live.scheduled?.coordinator?.generation;
  if (delegatedParentTask && !snapshot.sessionLinks.some((link) => link.sessionKey === parentSession
    && link.nodeId === delegatedParentTask && (!link.sessionGeneration || link.sessionGeneration === parentGeneration))) throw new Error('TASK_SCOPE_PARENT_TASK_LINK_STALE');
  const links = snapshot.sessionLinks.filter((link) => link.sessionKey === request.sessionKey && link.nodeId);
  const currentLinks = links.filter((link) => !link.sessionGeneration || link.sessionGeneration === request.sessionGeneration);
  const businessLinks = currentLinks.filter((link) => snapshot.nodes.some((node) => node.id === link.nodeId && node.kind === 'task'));
  const { readManagedSessionEffect, startManagedSessionEffect } = await import('./task-system-service');
  const managedTask = readManagedSessionEffect({ workspaceRoot: root, sessionKey: request.sessionKey,
    generation: request.sessionGeneration, fallbackTaskNodeId: existing?.activeTaskNodeId });
  const selectedIds = managedTask ? [managedTask.contract.taskNodeId] : existing?.activeTaskNodeId ? [existing.activeTaskNodeId]
    : existing ? existing.taskLedgerReferences.map((ref) => ref.taskLedgerNodeId)
      : [...new Set(businessLinks.map((link) => link.nodeId!))];
  if (selectedIds.length > 1) throw new Error('TASK_SCOPE_TASK_SELECTION_REQUIRED');
  const taskNodeId = selectedIds[0];
  const agentId = sessionAgentId(request.sessionKey);
  if (!agentId) throw new Error('TASK_SCOPE_AGENT_MISSING');
  const now = new Date().toISOString();
  const run = normalizeRunScope({ runId: request.runId, scope: { workspaceId: profile.id, sessionKey: request.sessionKey } });
  if (taskNodeId) {
    const node = snapshot.nodes.find((entry) => entry.id === taskNodeId);
    if (!node || node.kind !== 'task') throw new Error('TASK_SCOPE_TASK_NOT_FOUND');
    if (!currentLinks.some((link) => link.nodeId === taskNodeId)) throw new Error('TASK_SCOPE_TASK_LINK_STALE');
  } else throw new Error('TASK_CLAIM_REQUIRED');
  const otherWriters = Object.values(profile.coordinatorBindings ?? {}).filter((binding) => {
    const claim = binding.writerClaim;
    return claim?.taskNodeId === taskNodeId && (claim.run.runId !== request.runId
      || claim.run.scope.sessionKey !== request.sessionKey || claim.sessionGeneration !== request.sessionGeneration);
  });
  for (const owner of otherWriters) {
    const claim = owner.writerClaim!;
    const credential = claim.credential;
    if (credential && managedTask.claim && (credential.epoch !== managedTask.claim.epoch
      || credential.sessionKey !== managedTask.claim.sessionKey || credential.generation !== managedTask.claim.generation)) continue;
    const state = await readTaskScopeRun(ctx, { runId: claim.run.runId, sessionKey: owner.sessionKey, sessionGeneration: claim.sessionGeneration });
    if (state.quiescent !== true) throw new Error('TASK_SCOPE_WRITER_BUSY');
  }
  const environment = existing?.environment ?? await resolveCoordinatorEnvironment(ctx, profile, {
    kind: isSamePath(await realpath(profile.rootPath), root) ? 'local' : 'managed-worktree', rootPath: root,
  });
  if (existing && !(await validateStoredCoordinatorEnvironment(ctx, profile, existing)).ok) {
    throw new Error('TASK_SCOPE_ENVIRONMENT_STALE');
  }
  const rechecked = await readTaskScopeRun(ctx, request);
  if (!rechecked.active || rechecked.currentGeneration !== request.sessionGeneration) throw new Error('TASK_SCOPE_RUN_STALE');
  const confirmedTask = startManagedSessionEffect({ workspaceRoot: root, sessionKey: request.sessionKey,
    generation: request.sessionGeneration, taskNodeId, requestId: `session-effect:${request.sessionKey}:${request.sessionGeneration}:${request.runId}`,
    expectedContract: { revision: managedTask.contract.revision, digest: managedTask.contract.digest },
    expectedAuthority: managedTask.authorityBasis });
  if (!confirmedTask.claim || confirmedTask.contract.taskNodeId !== taskNodeId) throw new Error('TASK_SCOPE_TASK_SWITCH_BLOCKED');
  if (request.expectedClaimId && request.expectedClaimId !== confirmedTask.claim.attemptId) throw new Error('TASK_SCOPE_CLAIM_STALE');
  for (const owner of otherWriters) {
    if (owner.sessionKey === request.sessionKey) continue;
    await persistCoordinatorBinding(profile.id, owner.sessionKey, (current) => ({
      ...current!, writerClaim: undefined, bindingRevision: current!.bindingRevision + 1, updatedAt: now,
    }));
  }
  const sameWriter = existing?.writerClaim?.run.runId === request.runId
    && existing.writerClaim.sessionGeneration === request.sessionGeneration
    && existing.writerClaim.id === confirmedTask.claim.attemptId;
  const task = normalizeTaskReference({ kind: 'ledger', taskNodeId });
  if (task.kind !== 'ledger') throw new Error('TASK_SCOPE_TASK_NOT_FOUND');
  const claim: SessionTaskWriterClaim = sameWriter ? { ...existing!.writerClaim!,
    executionRevision: existing!.writerClaim!.executionRevision ?? existing!.bindingRevision } : {
    id: confirmedTask.claim.attemptId, taskNodeId: task.taskNodeId, run, sessionGeneration: request.sessionGeneration, createdAt: now,
    executionRevision: (existing?.bindingRevision ?? 0) + 1,
    credential: { taskNodeId: confirmedTask.claim.taskNodeId, sessionKey: confirmedTask.claim.sessionKey,
      generation: confirmedTask.claim.generation, epoch: confirmedTask.claim.epoch },
  };
  if (claim.taskNodeId !== taskNodeId) throw new Error('TASK_SCOPE_TASK_SWITCH_BLOCKED');
  const linkId = createHash('sha256').update(JSON.stringify([taskNodeId, request.sessionKey, request.sessionGeneration])).digest('hex');
  await ctx.taskLedgerApi.appendEvents({ workspaceId: profile.id, idempotencyKey: `execution-link:${linkId}`, events: [{
    id: `execution-link:${linkId}`, type: 'session_linked', actor: 'system', taskId: taskNodeId, sessionId: request.sessionKey,
    payload: { sessionLink: { id: `execution-link:${linkId}`, nodeId: taskNodeId, sessionKey: request.sessionKey,
      sessionGeneration: request.sessionGeneration, agentId, relation: 'related',
      createdAt: new Date(confirmedTask.contract.createdAt).toISOString() } },
  }] });
  const binding = await persistCoordinatorBinding(profile.id, request.sessionKey, () => ({
    schemaVersion: 1, workspaceId: profile.id, agentId, sessionKey: request.sessionKey,
    sessionGeneration: request.sessionGeneration, activeTaskNodeId: taskNodeId,
    taskLedgerReferences: [createTaskLedgerReference({ taskLedgerNodeId: taskNodeId, source: 'runtime' })],
    environment, writerClaim: claim, archiveRestorePolicy: existing?.archiveRestorePolicy ?? 'restore',
    state: admittedBeforePause ? 'paused' : 'active', bindingRevision: sameWriter ? existing!.bindingRevision : (existing?.bindingRevision ?? 0) + 1,
    invalidationReason: admittedBeforePause ? 'user-paused' : null, createdAt: existing?.createdAt ?? now, updatedAt: now,
  }), !live.delegation && !live.scheduled);
  if (request.checkoutAccess === 'write') {
    const { admitExecutionCheckout } = await import('../../openclaw_runtime/src/agents/execution-checkout-admission');
    const granted = await admitExecutionCheckout({ workspaceRoot: root, authority: managedTask.authorityBasis,
      task: confirmedTask, claim, agentId, operationId: request.operationId!,
      observeRun: owner => {
        if (!owner.run.scope.sessionKey) throw new Error('TASK_CHECKOUT_EXECUTION_IDENTITY_REQUIRED');
        return readTaskScopeRun(ctx, { runId: owner.run.runId, sessionKey: owner.run.scope.sessionKey,
          sessionGeneration: owner.sessionGeneration });
      },
    });
    try {
      const current = await readTaskScopeRun(ctx, request);
      if (!current.active || current.currentGeneration !== request.sessionGeneration) throw new Error('TASK_SCOPE_RUN_STALE');
    } catch (error) {
      if (granted.unused) {
        const { createWorktreeService } = await import('../../openclaw_runtime/src/agents/worktree-service');
        createWorktreeService(granted.checkout.baseRoot).releaseUnusedWriter(granted.checkout.credential);
      }
      throw error;
    }
    return { status: 'granted', claim, bindingRevision: binding.bindingRevision, checkout: { ...granted.checkout, unused: granted.unused } };
  }
  return { status: 'granted', claim, bindingRevision: binding.bindingRevision };
}

export function createWorkspacesApi(
  ctx: WorkspacesApiContext = {},
): CompleteHostServiceRegistry['workspaces'] & {
  coordinatorLifecycle: WorkspaceCoordinatorLifecycleObserver;
  admitTaskEffect: (request: SessionTaskEffectRequest) => Promise<SessionTaskEffectAdmission>;
} {
  return {
    migrateExecution: payload=>withCoordinatorMutationLock(async()=>({success:true,operation:await migrateWorkspaceExecution(ctx,payload)})),
    executionMigration: async payload=>({success:true,operation:await readExecutionMigrationOperation(payload.workspaceId,payload.sessionKey,payload.operationId)}),
    selectSessionTask: (payload: WorkspaceSessionTaskSelectPayload) => withCoordinatorMutationLock(async () => {
      const workspaceId = requireNonEmptyString(payload.workspaceId, 'workspaceId');
      const sessionKey = requireNonEmptyString(payload.sessionKey, 'sessionKey');
      const taskRef = normalizeTaskReference({ kind: 'ledger', taskNodeId: payload.taskNodeId });
      if (taskRef.kind !== 'ledger') throw new Error('TASK_SCOPE_TASK_NOT_FOUND');
      const document = await readDocument();
      const profile = document.profiles.find((entry) => entry.id === workspaceId);
      if (!profile || document.activeWorkspaceId !== workspaceId) throw new Error('TASK_SCOPE_WORKSPACE_UNAVAILABLE');
      const associated = profile.activeSessionKey === sessionKey || Object.hasOwn(profile.sessionStates ?? {}, sessionKey)
        || Object.hasOwn(profile.coordinatorBindings ?? {}, sessionKey)
        || Object.values(profile.agentBindings ?? {}).some((binding) => binding.sessionKey === sessionKey);
      if (!associated || !ctx.taskLedgerApi?.appendEvents || !ctx.gatewayManager) throw new Error('TASK_SCOPE_OWNER_UNAVAILABLE');
      const existing = profile.coordinatorBindings?.[sessionKey];
      if (payload.expectedRevision !== undefined && payload.expectedRevision !== (existing?.bindingRevision ?? 0)) throw new Error('COORDINATOR_REVISION_CONFLICT');
      const read = await ctx.taskLedgerApi.snapshot({ workspaceId });
      if (!read.success || read.snapshot.workspaceId !== normalizeTaskLedgerWorkspaceId(workspaceId)
        || read.snapshot.warnings.length || !read.snapshot.nodes.some((node) => node.id === taskRef.taskNodeId && node.kind === 'task')) throw new Error('TASK_SCOPE_TASK_NOT_FOUND');
      const agentId = sessionAgentId(sessionKey);
      if (!agentId) throw new Error('TASK_SCOPE_AGENT_MISSING');
      let described = await ctx.gatewayManager.rpc<CoordinatorSessionDescription>('sessions.describe', { key: sessionKey }, 15_000);
      if (!described.session && !payload.expectedSessionGeneration) {
        await ctx.gatewayManager.rpc('sessions.create', { key: sessionKey, agentId }, 30_000);
        described = await ctx.gatewayManager.rpc('sessions.describe', { key: sessionKey }, 15_000);
      }
      const generation = described.session?.sessionId;
      if (!generation || (payload.expectedSessionGeneration && payload.expectedSessionGeneration !== generation)) throw new Error('TASK_SCOPE_GENERATION_STALE');
      if (described.session?.hasActiveRun || described.session?.status === 'running') throw new Error('TASK_SCOPE_TASK_SWITCH_BLOCKED');
      const writer = await readTaskScopeRun(ctx, {
        runId: existing?.writerClaim?.run.runId ?? `task-selection:${sessionKey}`,
        sessionKey, sessionGeneration: existing?.writerClaim?.sessionGeneration ?? generation,
        processScope: 'session',
      });
      if (!writer.quiescent) throw new Error('TASK_SCOPE_WRITER_BUSY');
      if (existing && !(await validateStoredCoordinatorEnvironment(ctx, profile, existing)).ok) throw new Error('TASK_SCOPE_ENVIRONMENT_STALE');
      const environment = existing?.environment ?? await resolveCoordinatorEnvironment(ctx, profile, { kind: 'local', rootPath: profile.rootPath });
      const now = new Date().toISOString();
      const linkId = createHash('sha256').update(JSON.stringify([workspaceId, sessionKey, generation, taskRef.taskNodeId])).digest('hex');
      const rechecked = await ctx.gatewayManager.rpc<CoordinatorSessionDescription>('sessions.describe', { key: sessionKey }, 15_000);
      if (rechecked.session?.sessionId !== generation || rechecked.session?.hasActiveRun) throw new Error('TASK_SCOPE_GENERATION_STALE');
      const { selectManagedSessionTask } = await import('./task-system-service');
      selectManagedSessionTask({ workspaceRoot: environment.canonicalRoot, taskNodeId: taskRef.taskNodeId,
        sessionKey, generation, requestId: `task-selection:${linkId}` });
      await ctx.taskLedgerApi.appendEvents({ workspaceId, idempotencyKey: `task-selection:${linkId}`, events: [{
        id: `task-selection:${linkId}`, type: 'session_linked', actor: 'system', taskId: taskRef.taskNodeId, sessionId: sessionKey,
        payload: { sessionLink: { id: `task-selection:${linkId}`, nodeId: taskRef.taskNodeId, sessionKey, sessionGeneration: generation, agentId, relation: 'related', createdAt: now } },
      }] });
      const binding = await persistCoordinatorBinding(workspaceId, sessionKey, () => ({
        schemaVersion: 1, workspaceId, agentId, sessionKey, sessionGeneration: generation,
        taskLedgerReferences: [createTaskLedgerReference({ taskLedgerNodeId: taskRef.taskNodeId, source: 'runtime' })],
        activeTaskNodeId: taskRef.taskNodeId, environment, state: existing?.state === 'paused' ? 'paused' : 'active',
        archiveRestorePolicy: existing?.archiveRestorePolicy ?? 'restore', bindingRevision: (existing?.bindingRevision ?? 0) + 1,
        invalidationReason: existing?.state === 'paused' ? existing.invalidationReason : null,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      }));
      return coordinatorResult(binding, coordinatorRecovery(binding.state === 'paused' ? 'paused' : 'ready', binding.invalidationReason, binding));
    }),
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
        ...(typeof body.activeSessionKey === 'string' && body.activeSessionKey.trim() ? { projectCoordinatorSessionKey: activeSessionKey } : {}),
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
      await syncWorkspacePermissionBestEffort();
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
        const { reclaimBrowserSessionsForWorkspace, reclaimManagedPortsForWorkspace } = await import('./long-session-resource-reclamation');
        ctx.terminalManager?.unregisterWorkspace(id, 'workspace-delete');
        await ctx.webPreviewManager?.stopForWorkspace(id, 'workspace-delete');
        const browsers = await reclaimBrowserSessionsForWorkspace(id);
        const ports = await reclaimManagedPortsForWorkspace(id);
        if (browsers.reclaimed !== browsers.attempted || ports.failed > 0) {
          throw new Error(
            `Workspace resource cleanup is incomplete (browser ${browsers.reclaimed}/${browsers.attempted}, managed ports ${ports.failed} failed)`,
          );
        }
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
        await syncWorkspacePermissionBestEffort();
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
      const { reclaimBrowserSessionsForWorkspace, reclaimManagedPortsForWorkspace } = await import('./long-session-resource-reclamation');
      ctx.terminalManager?.unregisterWorkspace(id, 'workspace-delete');
      await ctx.webPreviewManager?.stopForWorkspace(id, 'workspace-delete');
      const browsers = await reclaimBrowserSessionsForWorkspace(id);
      const ports = await reclaimManagedPortsForWorkspace(id);
      if (browsers.reclaimed !== browsers.attempted || ports.failed > 0) {
        throw new Error(
          `Workspace resource cleanup is incomplete (browser ${browsers.reclaimed}/${browsers.attempted}, managed ports ${ports.failed} failed)`,
        );
      }
      await writeDocument(nextDocument);
      const nextActiveWorkspace = profiles.find((profile) => profile.id === activeWorkspaceId) ?? null;
      if (nextActiveWorkspace) {
        ctx.terminalManager?.registerWorkspace(nextActiveWorkspace);
        ctx.webPreviewManager?.registerWorkspace(nextActiveWorkspace);
      }
      if (document.activeWorkspaceId === id || activeWorkspaceId !== document.activeWorkspaceId) {
        await syncWorkspacePermissionBestEffort();
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
      const nextDocument = { activeWorkspaceId: id, profiles };
      // Workspace switching changes the active selection only. Long-lived
      // terminals, browser sessions and managed ports remain with their owner.
      await writeDocument(nextDocument);
      await syncWorkspacePermissionBestEffort();
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
      const selectedAgentId = typeof body.activeSessionKey === 'string'
        ? sessionAgentId(body.activeSessionKey) ?? current.selectedAgentId ?? current.agentId
        : current.selectedAgentId || current.agentId;
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
    bindCoordinator: (payload) => withCoordinatorMutationLock(async () => {
      const input = parseCoordinatorBindPayload(payload);
      const document = await readDocument();
      if (document.activeWorkspaceId !== input.workspaceId) {
        throw coordinatorError('COORDINATOR_WORKSPACE_SCOPE_MISMATCH', 'Coordinator binding is limited to the active workspace.');
      }
      const profile = document.profiles.find((candidate) => candidate.id === input.workspaceId);
      if (!profile) {
        throw coordinatorError('COORDINATOR_WORKSPACE_MISSING', `Workspace ${input.workspaceId} does not exist.`);
      }
      const agentBinding = profile.agentBindings?.[input.agentId];
      if (!agentBinding || agentBinding.workspaceId !== profile.id || agentBinding.agentId !== input.agentId) {
        throw coordinatorError('COORDINATOR_OWNER_MISSING', 'The Workspace/Assistant binding does not exist.');
      }
      if (agentBinding.sessionKey !== input.sessionKey) {
        throw coordinatorError('COORDINATOR_SESSION_SCOPE_MISMATCH', 'The selected session is not the Workspace/Assistant main session.');
      }
      const existing = profile.coordinatorBindings?.[input.sessionKey];
      if (existing && input.expectedRevision !== existing.bindingRevision) {
        throw coordinatorError('COORDINATOR_REVISION_CONFLICT', `Expected revision ${input.expectedRevision ?? 'missing'} but found ${existing.bindingRevision}.`);
      }
      if (!existing && input.expectedRevision !== undefined && input.expectedRevision !== 0) {
        throw coordinatorError('COORDINATOR_REVISION_CONFLICT', 'A new binding must start at revision 0.');
      }
      const session = await describeCoordinatorSession(ctx, input.sessionKey, input.agentId);
      const taskLedgerReferences = await validateCoordinatorTaskReferences(
        ctx,
        input.workspaceId,
        input.taskLedgerNodeIds,
      );
      const environment = await resolveCoordinatorEnvironment(ctx, profile, input.environment);
      const environmentChanged = Boolean(existing) && (
        existing!.environment.kind !== environment.kind
        || !isSamePath(existing!.environment.canonicalRoot, environment.canonicalRoot)
        || existing!.environment.branch !== environment.branch
        || existing!.environment.detachedHead !== environment.detachedHead
      );
      const tasksChanged = Boolean(existing) && JSON.stringify(existing!.taskLedgerReferences.map((ref) => ref.taskLedgerNodeId))
        !== JSON.stringify(taskLedgerReferences.map((ref) => ref.taskLedgerNodeId));
      if ((environmentChanged || tasksChanged) && (session.hasActiveRun || session.status === 'running')) {
        throw coordinatorError('COORDINATOR_BINDING_SWITCH_BLOCKED', 'A running session cannot switch environment or task.');
      }
      if (environmentChanged || tasksChanged) {
        const writer = await readTaskScopeRun(ctx, {
          runId: existing?.writerClaim?.run.runId ?? `binding-selection:${input.sessionKey}`,
          sessionKey: input.sessionKey, sessionGeneration: existing?.writerClaim?.sessionGeneration ?? session.sessionId,
          processScope: 'session',
        });
        if (!writer.quiescent) throw new Error('TASK_SCOPE_TASK_SWITCH_BLOCKED');
      }
      const now = new Date().toISOString();
      if (taskLedgerReferences.length === 1) {
        const { selectManagedSessionTask } = await import('./task-system-service');
        selectManagedSessionTask({ workspaceRoot: environment.canonicalRoot, sessionKey: input.sessionKey,
          generation: session.sessionId, taskNodeId: taskLedgerReferences[0].taskLedgerNodeId,
          requestId: `coordinator-selection:${input.sessionKey}:${session.sessionId}:${(existing?.bindingRevision ?? 0) + 1}` });
      }
      const binding: WorkspaceCoordinatorBinding = {
        schemaVersion: 1,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        sessionKey: input.sessionKey,
        sessionGeneration: session.sessionId,
        taskLedgerReferences,
        ...(taskLedgerReferences.length === 1 ? { activeTaskNodeId: taskLedgerReferences[0].taskLedgerNodeId } : {}),
        ...(!environmentChanged && !tasksChanged && existing?.writerClaim ? { writerClaim: existing.writerClaim } : {}),
        environment,
        archiveRestorePolicy: input.archiveRestorePolicy,
        state: 'active',
        bindingRevision: (existing?.bindingRevision ?? 0) + 1,
        invalidationReason: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const nextDocument = updateWorkspaceProfile(document, input.workspaceId, (current) => ({
        ...current,
        projectCoordinatorSessionKey: current.projectCoordinatorSessionKey ?? input.sessionKey,
        coordinatorBindings: {
          ...(current.coordinatorBindings ?? {}),
          [input.sessionKey]: binding,
        },
        updatedAt: Date.now(),
      }));
      await writeDocument(nextDocument, true);
      return coordinatorResult(binding, coordinatorRecovery('ready', null, binding));
    }),
    resolveCoordinator: (payload) => withCoordinatorMutationLock(() => resolveCoordinatorBinding(ctx, payload)),
    pauseCoordinator: (payload) => withCoordinatorMutationLock(async () => {
      const body = isRecord(payload) ? payload as CoordinatorPauseBody : {};
      const workspaceId = requireNonEmptyString(body.workspaceId, 'workspaceId');
      const agentId = requireNonEmptyString(body.agentId, 'agentId');
      const sessionKey = requireNonEmptyString(body.sessionKey, 'sessionKey');
      const expectedRevision = Number(body.expectedRevision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw coordinatorError('COORDINATOR_REVISION_INVALID', 'expectedRevision must be a positive integer.');
      }
      const document = await readDocument();
      const profile = document.profiles.find((candidate) => candidate.id === workspaceId);
      const binding = profile?.coordinatorBindings?.[sessionKey];
      if (!profile || !binding) {
        return coordinatorResult(null, { state: 'missing', reason: 'coordinator-binding-missing', bindingRevision: null });
      }
      if (binding.agentId !== agentId || binding.workspaceId !== workspaceId || binding.sessionKey !== sessionKey) {
        throw coordinatorError('COORDINATOR_SCOPE_MISMATCH', 'Coordinator binding belongs to another workspace, agent, or session.');
      }
      if (binding.bindingRevision !== expectedRevision) {
        throw coordinatorError('COORDINATOR_REVISION_CONFLICT', `Expected revision ${expectedRevision} but found ${binding.bindingRevision}.`);
      }
      const paused = await persistCoordinatorBinding(workspaceId, sessionKey, (current) => {
        const target = current ?? binding;
        return {
          ...target,
          state: 'paused',
          invalidationReason: 'user-paused',
          bindingRevision: target.bindingRevision + 1,
          updatedAt: new Date().toISOString(),
        };
      });
      return coordinatorResult(paused, coordinatorRecovery('paused', 'user-paused', paused));
    }),
    coordinatorLifecycle: (event) => withCoordinatorMutationLock(() => applyCoordinatorLifecycle(ctx, event)),
    admitTaskEffect: (request) => withCoordinatorMutationLock(() => admitSessionTaskEffect(ctx, request)),
  };
}
