import type { TaskAuthorityBasis } from '../task-system/identity.js';
import type { TaskCredential, TaskCheckpoint } from '../task-system/types.js';
import type { CheckoutWriterCredential } from '../checkout-ownership.js';

export type ExecutionMigrationPhase = 'intent' | 'fenced' | 'drained' | 'reserved' | 'session-committed' | 'task-committed' | 'binding-committed' | 'confirmed';
export type ExecutionMigrationOperation = {
  schema: 1; id: string; requestDigest: string; workspaceId: string; targetWorkspaceId: string;
  sessionKey: string; agentId: string; sourceGeneration: string; targetGeneration: string;
  sourceRoot: string; targetRoot: string; sourceBindingRevision: number;
  task: { credential: TaskCredential; revision: number; digest: string; authority: TaskAuthorityBasis; checkpoint: TaskCheckpoint | null };
  phase: ExecutionMigrationPhase; createdAt: string; updatedAt: string; error?: string;
  targetCredential?: TaskCredential;
  pausedCredential?: TaskCredential;
  reservation?: { baseRoot: string; worktreeId: string | null; credential: CheckoutWriterCredential };
  runtimeReceipt?: SessionExecutionMigrationReceipt;
  targetBindingRevision?: number;
  reservationReleased?: boolean;
  confirmation?: { targetDigest: string; candidateArtifacts: Array<{ path: string; sha256: string }>; pendingOperations: number; at: string };
};

export type WorkspaceExecutionMigrationPayload = {
  workspaceId: string; targetWorkspaceId: string; sessionKey: string; operationId: string;
  expectedSessionGeneration: string; expectedBindingRevision: number;
};
export type WorkspaceExecutionMigrationReadPayload = { workspaceId: string; sessionKey: string; operationId?: string };

export type SessionExecutionMigrationRequest = {
  operationId: string; sessionKey: string; agentId: string;
  sourceGeneration: string; targetGeneration: string; sourceRoot: string; targetRoot: string;
  taskNodeId: string; contractRevision: number; contractDigest: string;
};
export type SessionExecutionMigrationReceipt = {
  operationId: string; sessionKey: string; sourceGeneration: string; targetGeneration: string;
  sourceRoot: string; targetRoot: string; state: 'prepared' | 'confirmed';
  transcriptPath: string; transcriptSha256: string | null;
};
