import type { WorkspaceProfile, WorkspaceUiState } from '@shared/types/workspace';
import { hostApi } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';

export function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
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

export async function createWorkspaceScopedNewSession(): Promise<string> {
  const chatState = useChatStore.getState();
  const currentAgentId = chatState.currentAgentId || getAgentIdFromSessionKey(chatState.currentSessionKey);
  const sourceSessionKey = chatState.currentSessionKey;
  const workspace = await ensureActiveWorkspaceForSession();

  if (!workspace?.id) {
    chatState.newSession({ deferSessionEntry: true });
    return useChatStore.getState().currentSessionKey;
  }

  const sessionKey = createFreshWorkspaceSessionKey(currentAgentId);
  await hostApi.workspaces.update(workspace.id, {
    agentId: currentAgentId,
    activeSessionKey: sessionKey,
    sessionKey,
    state: { activeTopicId: null },
  });
  await inheritSessionWorkgroup(workspace, sourceSessionKey, sessionKey);
  await useWorkspacesStore.getState().fetchWorkspaces();
  chatState.resetSessionView(sessionKey, { deferSessionEntry: true });
  return sessionKey;
}

export async function createWorkspaceScopedHandoffSession(draftInput: string): Promise<string> {
  const chatState = useChatStore.getState();
  const currentAgentId = chatState.currentAgentId || getAgentIdFromSessionKey(chatState.currentSessionKey);
  const sourceSessionKey = chatState.currentSessionKey;
  const workspace = await ensureActiveWorkspaceForSession();

  if (!workspace?.id) {
    chatState.newSession({ deferSessionEntry: true });
    return useChatStore.getState().currentSessionKey;
  }

  const sessionKey = createFreshWorkspaceSessionKey(currentAgentId);
  await hostApi.workspaces.update(workspace.id, {
    agentId: currentAgentId,
    activeSessionKey: sessionKey,
    sessionKey,
    state: { activeTopicId: null, draftInput },
  });
  await inheritSessionWorkgroup(workspace, sourceSessionKey, sessionKey);
  await useWorkspacesStore.getState().fetchWorkspaces();
  chatState.resetSessionView(sessionKey);
  return sessionKey;
}

function cloneForkableWorkspaceState(state: WorkspaceUiState | undefined): WorkspaceUiState {
  return {
    draftInput: state?.draftInput,
    collapsedDraftInput: state?.collapsedDraftInput,
    selectedModelRef: state?.selectedModelRef,
    activeTopicId: state?.activeTopicId ?? null,
    knowledgeScope: state?.knowledgeScope,
    artifactPanel: state?.artifactPanel ? { ...state.artifactPanel } : undefined,
    recentFiles: state?.recentFiles ? [...state.recentFiles] : undefined,
  };
}

export async function createWorkspaceScopedForkSession(sourceSessionKey: string): Promise<string> {
  const chatState = useChatStore.getState();
  const currentAgentId = chatState.currentAgentId || getAgentIdFromSessionKey(sourceSessionKey || chatState.currentSessionKey);
  const workspace = await ensureActiveWorkspaceForSession();
  const result = await hostApi.sessions.fork({
    sessionKey: sourceSessionKey,
    agentId: currentAgentId,
    workspaceId: workspace?.id ?? null,
  });

  if (!result.success || !result.sessionKey) {
    throw new Error(result.error || 'Failed to fork conversation');
  }

  if (!workspace?.id) {
    chatState.resetSessionView(result.sessionKey);
    return result.sessionKey;
  }

  const sourceState = workspace.sessionStates?.[sourceSessionKey] ?? workspace.state;
  await hostApi.workspaces.update(workspace.id, {
    agentId: currentAgentId,
    activeSessionKey: result.sessionKey,
    sessionKey: result.sessionKey,
    state: cloneForkableWorkspaceState(sourceState),
  });
  await inheritSessionWorkgroup(workspace, sourceSessionKey, result.sessionKey);
  await useWorkspacesStore.getState().fetchWorkspaces();
  try {
    await hostApi.taskLedger.linkSession({
      workspaceId: workspace.id,
      sessionKey: result.sessionKey,
      agentId: currentAgentId,
      relation: 'forked_from',
      sourceSessionKey,
      summary: 'Forked conversation branch',
      idempotencyKey: `session-fork:${sourceSessionKey}:${result.sessionKey}`,
    });
  } catch (error) {
    console.warn('Failed to link forked session in Task Ledger:', error);
  }
  chatState.resetSessionView(result.sessionKey);
  return result.sessionKey;
}

