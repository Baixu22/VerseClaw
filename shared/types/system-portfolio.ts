import type { SessionKey, TaskId, WorkspaceId } from './identity-scope';
import type { WorkspaceProfile } from './workspace';
import type { TaskContract, TaskEvidence } from '../task-system/types';

/** Only fields that change the project's owner identity invalidate an observation. */
export function systemProjectOwnerKey(profile: WorkspaceProfile): string {
  const key = profile.projectCoordinatorSessionKey;
  const binding = key ? profile.coordinatorBindings?.[key] : undefined;
  return JSON.stringify([profile.id, profile.rootPath, key ?? null,
    binding ? [binding.workspaceId, binding.sessionKey, binding.sessionGeneration, binding.bindingRevision,
      binding.state, binding.invalidationReason, binding.environment] : null,
    key ? profile.archivedSessionKeys?.includes(key) === true : false]);
}

export type SystemPortfolio = { scope: 'system'; profiles: Array<{ id: WorkspaceId; name: string; ownerKey: string }> };
export type SystemProjectRead = { workspaceId: string; expectedOwnerKey: string };
export type SystemProjectSnapshot = {
  scope: 'project';
  workspaceId: WorkspaceId;
  ownerKey: string;
  observedAt: number;
  coordinator: {
    sessionKey: SessionKey | null;
    generation: string | null;
    bindingRevision: number | null;
    state: 'ready' | 'paused' | 'unbound' | 'unavailable';
  };
  plan: {
    taskNodeId: TaskId;
    objective: string;
    state: TaskContract['state'];
    revision: number;
    nextAction: string;
    nextTaskNodeId: TaskId | null;
    pendingDecisions: string[];
    tasks: Array<{ taskNodeId: TaskId; objective: string; state: TaskContract['state']; revision: number }>;
  } | null;
  evidence: Array<Pick<TaskEvidence, 'taskNodeId' | 'receiptId' | 'candidate' | 'revision' | 'sha256' | 'verifier'>>;
  resources: {
    activeTaskClaims: number | null; pendingEffects: number | null; costUsd: null;
    observations: Array<{ id: string; owner: string; kind: string; activeSlots: number; queuedCount: number; observedAt: number }>;
  };
};
