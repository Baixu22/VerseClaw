import type {
  WorkspaceCoordinatorBinding,
  WorkspaceProfile,
  WorkspaceUiState,
} from '@shared/types/workspace';
import type { WorkspaceCoordinatorBindPayload } from '@shared/host-api/contract';
import { hostApi } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';

let navigationTail: Promise<unknown> = Promise.resolve();
let navigationIntent = 0;
let currentViewSave: { workspaceId: string | null; sessionKey: string; viewRevision: number | undefined; save: () => Promise<void> } | null = null;

/** The mounted Chat view supplies its current draft to the existing workspace save queue. */
export function registerWorkspaceSessionViewSave(view: NonNullable<typeof currentViewSave>): () => void {
  currentViewSave = view;
  return () => { if (currentViewSave === view) currentViewSave = null; };
}

export function workspaceOwnsSession(workspace: WorkspaceProfile | null | undefined, sessionKey: string): boolean {
  return Boolean(workspace && (workspace.activeSessionKey === sessionKey
    || Object.hasOwn(workspace.sessionStates ?? {}, sessionKey)
    || Object.hasOwn(workspace.coordinatorBindings ?? {}, sessionKey)
    || Object.values(workspace.agentBindings ?? {}).some((binding) => binding.sessionKey === sessionKey)));
}

/** Resolve a legacy session-only selection through the same scoped navigation queue. */
export function activateWorkspaceSession(sessionKey: string): Promise<boolean> {
  return activateWorkspaceScopedSession(null, sessionKey);
}

/** Serialize selections; a null workspace resolves explicit ownership before recorded parents. */
export function activateWorkspaceScopedSession(workspaceId: string | null, sessionKey: string, isCurrentIntent: () => boolean = () => true): Promise<boolean> {
  const intent = ++navigationIntent;
  const operation = navigationTail.catch(() => undefined).then(async () => {
    if (intent !== navigationIntent || !isCurrentIntent()) return false;
    const state = useWorkspacesStore.getState();
    let workspace = workspaceId === null
      ? state.profiles.find((profile) => workspaceOwnsSession(profile, sessionKey))
      : state.profiles.find((profile) => profile.id === workspaceId);
    if (workspaceId === null && !workspace) {
      const byKey = new Map((useChatStore.getState().sessions ?? []).map((session) => [session.key, session]));
      const seen = new Set([sessionKey]);
      let parent = byKey.get(sessionKey)?.parentSessionKey;
      while (!workspace && parent && !seen.has(parent)) {
        seen.add(parent);
        workspace = state.profiles.find((profile) => workspaceOwnsSession(profile, parent!));
        parent = byKey.get(parent)?.parentSessionKey;
      }
    }
    if (workspaceId !== null && !workspaceOwnsSession(workspace, sessionKey)) {
      throw new Error('SESSION_WORKSPACE_ASSOCIATION_MISSING');
    }
    if (workspace) {
      const inherited = !workspaceOwnsSession(workspace, sessionKey);
      if (state.activeWorkspaceId !== workspace.id) {
        const active = await state.switchWorkspace(workspace.id);
        if (intent !== navigationIntent || !isCurrentIntent()) return false;
        if (!active || active.id !== workspace.id) throw new Error('Workspace activation did not return the selected workspace');
      }
      if (intent !== navigationIntent || !isCurrentIntent()) return false;
      await useWorkspacesStore.getState().saveWorkspaceState({
        id: workspace.id, activeSessionKey: sessionKey, sessionKey,
        // An unfiled child starts with its own UI state; an existing child draft is merged unchanged.
        ...(inherited ? { state: {} } : {}),
      });
    }
    if (intent !== navigationIntent || !isCurrentIntent()) return false;
    useChatStore.getState().switchSession(sessionKey);
    return true;
  });
  navigationTail = operation;
  return operation;
}

export function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

export function getWorkspaceCoordinatorBinding(
  workspace: WorkspaceProfile,
  agentId: string,
  sessionKey: string,
): WorkspaceCoordinatorBinding | null {
  const binding = workspace.coordinatorBindings?.[sessionKey];
  return binding?.workspaceId === workspace.id && binding.agentId === agentId && binding.sessionKey === sessionKey
    ? binding
    : null;
}

export async function resolveWorkspaceCoordinatorBinding(
  workspace: WorkspaceProfile,
  agentId: string,
  sessionKey: string,
) {
  return hostApi.workspaces.resolveCoordinator({
    workspaceId: workspace.id,
    agentId,
    sessionKey,
  });
}

export async function bindWorkspaceCoordinator(input: WorkspaceCoordinatorBindPayload) {
  return hostApi.workspaces.bindCoordinator(input);
}

export function createFreshWorkspaceSessionKey(agentId: string): string {
  const normalizedAgentId = agentId.trim() || 'main';
  return `agent:${normalizedAgentId}:session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getWorkspaceAgentSessionKey(
  workspace: WorkspaceProfile,
  agentId: string,
): { sessionKey: string; isFresh: boolean } {
  const normalizedAgentId = agentId.trim() || 'main';
  const activeSessionKey = workspace.activeSessionKey;
  if (activeSessionKey && getAgentIdFromSessionKey(activeSessionKey) === normalizedAgentId) {
    return { sessionKey: activeSessionKey, isFresh: false };
  }
  const boundSessionKey = workspace.agentBindings?.[normalizedAgentId]?.sessionKey;
  if (boundSessionKey && getAgentIdFromSessionKey(boundSessionKey) === normalizedAgentId) {
    return { sessionKey: boundSessionKey, isFresh: false };
  }
  return { sessionKey: createFreshWorkspaceSessionKey(normalizedAgentId), isFresh: true };
}

function getSessionWorkgroupId(workspace: WorkspaceProfile, sessionKey: string): string | null {
  const folderId = workspace.sessionFolderAssignments?.[sessionKey];
  if (!folderId) return null;
  return (workspace.sessionFolders ?? []).some((folder) => folder.id === folderId) ? folderId : null;
}

async function inheritSessionWorkgroup(
  workspace: WorkspaceProfile,
  sourceSessionKey: string,
  targetSessionKey: string,
): Promise<void> {
  const folderId = getSessionWorkgroupId(workspace, sourceSessionKey);
  if (!folderId) return;
  try {
    await hostApi.workspaces.moveSessionToFolder({
      workspaceId: workspace.id,
      sessionKey: targetSessionKey,
      folderId,
    });
  } catch (error) {
    console.warn('Failed to inherit session workgroup:', error);
  }
}

export async function ensureActiveWorkspaceForSession(): Promise<WorkspaceProfile | null> {
  const workspaceState = useWorkspacesStore.getState();
  if (workspaceState.activeWorkspace) return workspaceState.activeWorkspace;

  await workspaceState.fetchWorkspaces();
  const loadedWorkspace = useWorkspacesStore.getState().activeWorkspace;
  if (loadedWorkspace) return loadedWorkspace;

  const active = await hostApi.workspaces.getActive();
  useWorkspacesStore.setState({
    profiles: active.activeWorkspace ? [active.activeWorkspace] : [],
    activeWorkspaceId: active.activeWorkspaceId ?? null,
    activeWorkspace: active.activeWorkspace ?? null,
  });
  return active.activeWorkspace ?? null;
}

export async function clearWorkspaceActiveTopicMarker(rootPath: string | undefined): Promise<void> {
  if (!rootPath) return;
  try {
    await hostApi.files.writeText(`${rootPath}/.clawx-active-topic`, '');
  } catch { /* Legacy topic reset is best-effort, as before. */ }
}

export function createWorkspaceScopedNewSession(targetWorkspaceId?: string): Promise<string | null> {
  const intent = ++navigationIntent;
  const chatState = useChatStore.getState();
  const currentAgentId = chatState.currentAgentId || getAgentIdFromSessionKey(chatState.currentSessionKey);
  const sourceSessionKey = chatState.currentSessionKey;
  const sourceRevision = chatState.viewRevision;
  const sourceWorkspaceId = useWorkspacesStore.getState().activeWorkspaceId;
  const sourceViewSave = currentViewSave;
  const isSourceCurrent = () => intent === navigationIntent && useChatStore.getState().currentSessionKey === sourceSessionKey
    && useChatStore.getState().viewRevision === sourceRevision
    && (!sourceWorkspaceId || useWorkspacesStore.getState().activeWorkspaceId === sourceWorkspaceId);
  const operation = navigationTail.catch(() => undefined).then(async () => {
    if (!isSourceCurrent()) return null;
    const workspace = await ensureActiveWorkspaceForSession();
    if (!isSourceCurrent()) return null;
    if (sourceViewSave && sourceViewSave !== currentViewSave) return null;
    if (sourceViewSave?.sessionKey === sourceSessionKey && sourceViewSave.workspaceId === workspace?.id
      && sourceViewSave.viewRevision === sourceRevision) {
      await sourceViewSave.save();
      if (!isSourceCurrent()) return null;
    }
    if (workspace?.id) await useWorkspacesStore.getState().saveWorkspaceState({
      id: workspace.id, sessionKey: sourceSessionKey, activeSessionKey: sourceSessionKey,
    });
    if (!isSourceCurrent()) return null;
    if (!workspace?.id) {
      if (targetWorkspaceId) throw new Error('SESSION_WORKSPACE_ASSOCIATION_MISSING');
      chatState.newSession({ deferSessionEntry: true });
      return useChatStore.getState().currentSessionKey;
    }
    const target = targetWorkspaceId && targetWorkspaceId !== workspace.id
      ? useWorkspacesStore.getState().profiles.find(profile => profile.id === targetWorkspaceId)
      : workspace;
    if (!target) throw new Error('SESSION_WORKSPACE_ASSOCIATION_MISSING');
    const targetAgentId = target.id === workspace.id ? currentAgentId : target.selectedAgentId || target.agentId;
    const sessionKey = createFreshWorkspaceSessionKey(targetAgentId);
    await hostApi.workspaces.update(target.id, {
      agentId: targetAgentId, activeSessionKey: sessionKey, sessionKey, state: { activeTopicId: null },
    });
    if (target.id === workspace.id) await inheritSessionWorkgroup(workspace, sourceSessionKey, sessionKey);
    if (!isSourceCurrent() || useWorkspacesStore.getState().activeWorkspaceId !== workspace.id) return null;
    if (target.id !== workspace.id) {
      const active = await useWorkspacesStore.getState().switchWorkspace(target.id);
      if (intent !== navigationIntent || !active || active.id !== target.id) return null;
      const current = useChatStore.getState();
      if (useWorkspacesStore.getState().activeWorkspaceId !== target.id
        || (current.currentSessionKey !== sessionKey
          && (current.currentSessionKey !== sourceSessionKey || current.viewRevision !== sourceRevision))) return null;
      useChatStore.getState().resetSessionView(sessionKey, { deferSessionEntry: true });
      await clearWorkspaceActiveTopicMarker(target.rootPath);
      return sessionKey;
    }
    await useWorkspacesStore.getState().fetchWorkspaces();
    await clearWorkspaceActiveTopicMarker(workspace.rootPath);
    if (!isSourceCurrent() || useWorkspacesStore.getState().activeWorkspaceId !== workspace.id) return null;
    chatState.resetSessionView(sessionKey, { deferSessionEntry: true });
    return sessionKey;
  });
  navigationTail = operation;
  return operation;
}

export async function createWorkspaceScopedHandoffSession(draftInput: string, options: { operationId?: string; sourceSessionKey?: string } = {}): Promise<string> {
  const chatState = useChatStore.getState();
  const startingSessionKey = chatState.currentSessionKey;
  const startingViewRevision = chatState.viewRevision;
  const currentAgentId = chatState.currentAgentId || getAgentIdFromSessionKey(chatState.currentSessionKey);
  const sourceSessionKey = options.sourceSessionKey ?? chatState.currentSessionKey;
  const workspace = await ensureActiveWorkspaceForSession();

  const result = await hostApi.sessions.createHandoff({
    sessionKey: sourceSessionKey, agentId: currentAgentId, workspaceId: workspace?.id ?? null, draftInput,
    ...(options.operationId ? { operationId: options.operationId } : {}),
  });
  if (!result.success || !result.sessionKey) throw new Error(result.error || 'Failed to create handoff session');
  const sessionKey = result.sessionKey;
  if (!workspace?.id) {
    chatState.resetSessionView(sessionKey);
    return sessionKey;
  }
  await inheritSessionWorkgroup(workspace, sourceSessionKey, sessionKey);
  await useWorkspacesStore.getState().fetchWorkspaces();
  await clearWorkspaceActiveTopicMarker(workspace.rootPath);
  await chatState.loadSessions({ force: true });
  const isCurrent = () => useChatStore.getState().currentSessionKey === startingSessionKey
    && useChatStore.getState().viewRevision === startingViewRevision && useWorkspacesStore.getState().activeWorkspaceId === workspace.id;
  if (!isCurrent()) return sessionKey;
  await activateWorkspaceScopedSession(workspace.id, sessionKey, isCurrent);
  return sessionKey;
}

function cloneForkableWorkspaceState(state: WorkspaceUiState | undefined): WorkspaceUiState {
  return {
    draftInput: state?.draftInput,
    selectedModelRef: state?.selectedModelRef,
    activeTopicId: state?.activeTopicId ?? null,
    knowledgeScope: state?.knowledgeScope,
    artifactPanel: state?.artifactPanel ? { ...state.artifactPanel } : undefined,
    recentFiles: state?.recentFiles ? [...state.recentFiles] : undefined,
  };
}

export async function createWorkspaceScopedForkSession(
  sourceSessionKey: string,
  options: { fromLeafId?: string; draftInput?: string } = {},
): Promise<string> {
  const chatState = useChatStore.getState();
  const startingSessionKey = chatState.currentSessionKey;
  const startingViewRevision = chatState.viewRevision;
  const currentAgentId = chatState.currentAgentId || getAgentIdFromSessionKey(sourceSessionKey || chatState.currentSessionKey);
  const workspace = await ensureActiveWorkspaceForSession();
  const result = await hostApi.sessions.fork({
    sessionKey: sourceSessionKey,
    agentId: currentAgentId,
    workspaceId: workspace?.id ?? null,
    // #180: fork from a specific transcript entry when the caller supplies one
    // (per-message fork). Omitted ⇒ whole-session fork, byte-identical to before.
    ...(options.fromLeafId ? { fromLeafId: options.fromLeafId } : {}),
  });

  if (!result.success || !result.sessionKey) {
    throw new Error(result.error || 'Failed to fork conversation');
  }

  if (!workspace?.id) {
    chatState.resetSessionView(result.sessionKey);
    return result.sessionKey;
  }

  const sourceState = workspace.sessionStates?.[sourceSessionKey] ?? workspace.state;
  await hostApi.workspaces.saveState({
    id: workspace.id,
    sessionKey: result.sessionKey,
    state: { ...cloneForkableWorkspaceState(sourceState), ...(options.draftInput !== undefined ? { draftInput: options.draftInput } : {}) },
  });
  await inheritSessionWorkgroup(workspace, sourceSessionKey, result.sessionKey);
  await useWorkspacesStore.getState().fetchWorkspaces();
  await chatState.loadSessions({ force: true });
  const isCurrent = () => useChatStore.getState().currentSessionKey === startingSessionKey
    && useChatStore.getState().viewRevision === startingViewRevision && useWorkspacesStore.getState().activeWorkspaceId === workspace.id;
  if (!isCurrent()) return result.sessionKey;
  await activateWorkspaceScopedSession(workspace.id, result.sessionKey, isCurrent);
  return result.sessionKey;
}
