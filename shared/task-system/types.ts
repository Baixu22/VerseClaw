import type { TaskId, SessionKey } from "../types/identity-scope.js";
import type { TaskAuthorityBasis } from './identity.js';

export const TASK_DELEGATION_DISPATCH_TOOLS: readonly string[] = ['sessions_spawn', 'team_orchestrate', 'mission_loop', 'task_loop'];

export type TaskCriterion = {
  id: string;
  description: string;
  verification:
    | { kind: "file-sha256"; path: string; sha256: string }
    | { kind: "tool-result"; tool: "exec"; command: string; files: string[]; exitCode: number }
    | { kind: "owner-receipt"; owner: string; requires?: string[]; files?: string[] };
};
export type TaskContractInput = {
  objective: string;
  constraints: string[];
  acceptance: TaskCriterion[];
  target: string;
  businessKey?: string;
  occurrenceKey?: string;
  dependencies?: string[];
  expectedOutcomes?: string[];
};
export type TaskContract = TaskContractInput & {
  origin: { source: string; requestId: string; sessionKey?: string };
  taskNodeId: TaskId;
  domain: string;
  revision: number;
  digest: string;
  state: "ready" | "doing" | "paused" | "review" | "cancelling" | "done" | "cancelled";
  createdAt: number;
  updatedAt: number;
};
export type TaskClaim = {
  taskNodeId: TaskId;
  sessionKey: SessionKey;
  generation: string;
  epoch: number;
  attemptId: string;
  worktree: string;
  contractRevision: number;
  expiresAt: number;
  state: "active" | "paused" | "recovery_required" | "released";
};
export type TaskCredential = Pick<TaskClaim, "taskNodeId" | "sessionKey" | "generation" | "epoch">;
export type TaskCheckpoint = {
  nextAction: string;
  completed: string[];
  unresolved: string[];
  artifacts: Array<{ path: string; sha256: string }>;
};
export type TaskEvidence = {
  receiptId: string;
  taskNodeId: TaskId;
  revision: number;
  epoch: number;
  candidate: string;
  criterionId: string;
  path: string;
  sha256: string;
  verifier: string;
  createdAt: number;
  inputArtifacts?: Array<{ path: string; sha256: string }>;
  ownerProof?: {
    verifierReceiptId: string;
    effectReceiptId: string;
    evidenceDigest: string;
    proposalDigest?: string;
  };
};
export type TaskView = {
  contract: TaskContract;
  claim: TaskClaim | null;
  checkpoint: TaskCheckpoint | null;
  pendingOperations: number;
  pendingOperationDetails?:Array<{operationId:string;tool:string;state:string;startedAt:number}>;
  /** A linked coordinator/observer can read the task without owning execution. */
  referenceOnly?: boolean;
  parentTaskNodeId?: string;
  childTaskNodeIds?: string[];
};
export type TaskQuery = {
  limit?: number;
  cursor?: string;
  query?: string;
  state?: TaskContract["state"];
  sessionKey?: string;
};
export type TaskPage = { tasks: TaskView[]; nextCursor?: string };
export type TaskSessionSnapshot = { task: TaskView | null; children: TaskView[]; verificationReceipts?: TaskEvidence[] };
export type TaskPlanItem = { key: string; contract: TaskContractInput; dependsOn?: string[] };
export type TaskWriterDelegation = {
  delegationId: string;
  taskNodeId: TaskId;
  parent: TaskCredential;
  parentWorktree: string;
  child: TaskCredential;
  childWorktree: string;
  childRunId: string;
  mode: "writer" | "observer";
  phase: "prepared" | "dispatched" | "unknown" | "returned" | "recovery_required";
  dispatchOperationIds: string[];
  terminalReceipt?: { runId: string; endedAt: number; outcome: string };
  contractRevision?: number;
  authorityBasis?: TaskAuthorityBasis;
  candidateArtifacts?: Array<{ path: string; sha256: string }>;
};
export type TaskDelegationIntent = {
  workspace: string;
  childWorkspace: string;
  parentSessionKey: string;
  parentGeneration: string;
  childSessionKey: string;
  childGeneration: string;
  childRunId: string;
  observer: boolean;
  expectedParent: TaskCredential;
  authorityBasis?: TaskAuthorityBasis;
};
export type TaskResolution = { kind: "created" | "existing" | "duplicate"; task: TaskView };
export type TaskSystemCommand =
  | { action: "history"; taskNodeId: string; afterSequence?: number; limit?: number }
  | { action: "readRetainedArtifact"; taskNodeId: string; receiptId: string; offset?: number; length?: number }
  | { action: "changes"; consumer: string; limit?: number }
  | { action: "acknowledge"; consumer: string; expectedSequence: number; throughSequence: number }
  | { action: "suggest"; query: string; target?: string; limit?: number }
  | { action: "decompose"; credential: TaskCredential; requestId: string; children: TaskPlanItem[] }
  | {
      action: "reconcile";
      credential: TaskCredential;
      operationId: string;
      effectReceiptId: string;
    }
  | { action: "create"; requestId: string; contract: TaskContractInput }
  | { action: "adopt"; taskNodeId: string; requestId: string; contract: TaskContractInput }
  | { action: "revise"; taskNodeId: string; expectedRevision: number; contract: TaskContractInput }
  | { action: "claim"; taskNodeId: string; sessionKey: string; requestId: string }
  | { action: "checkpoint"; credential: TaskCredential; checkpoint: TaskCheckpoint }
  | { action: "pause" | "release" | "cancel" | "renew"; credential: TaskCredential }
  | {
      action: "handoff";
      credential: TaskCredential;
      targetSessionKey: string;
      targetWorkspaceId?: string;
    }
  | { action: "recover"; taskNodeId: string; targetSessionKey: string }
  | { action: "submit"; credential: TaskCredential; candidate: string }
  | {
      action: "verifyFile";
      credential: TaskCredential;
      criterionId: string;
      path: string;
      expectedSha256: string;
      candidate: string;
    }
  | { action: "accept"; credential: TaskCredential; candidate: string };
