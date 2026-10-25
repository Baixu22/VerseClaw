import type {
  DelegationAdmissionReceipt,
  DelegationCoordinatorScope,
  DelegationTaskRef,
} from "../../../shared/types/delegation-admission.js";
import type { RoleSpawnResult } from "./role-spawn.js";
import type { WorktreeBackend } from "../context-engine/coding-runtime-flags.js";
import type { SessionDelegationIsolation, SessionDelegationToolAuthorization } from "../../../shared/types/session-delegation.js";

export type DelegationAdmissionContext = {
  receiptId: string;
  idempotencyKey: string;
  requestDigest: string;
  coordinator: DelegationCoordinatorScope;
  taskRef: DelegationTaskRef;
  createdAt: string;
};

export type DelegationAdmissionReceiptInput = {
  admission: DelegationAdmissionContext;
  roleName: string;
  task: string;
  orchestrationRunId: string;
  taskNodeId: string | null;
  taskId: string | null;
  roleInstanceId: string | null;
  executionWave: number;
  concurrentSiblings: number;
  isWriter: boolean;
  writeSet: readonly string[];
  worktree?: { id: string; backend: WorktreeBackend } | null;
  spawn: RoleSpawnResult;
};

function resolveIsolation(input: DelegationAdmissionReceiptInput): DelegationAdmissionReceipt["isolation"] {
  const writeSet = [...input.writeSet];
  if (input.worktree) {
    const isGit = input.worktree.backend === "git";
    return {
      mode: "worktree",
      backend: input.worktree.backend,
      worktreeId: input.worktree.id,
      writeSet,
      parallelWritesAllowed: isGit || writeSet.length > 0,
      writeSetBasis: isGit
        ? "git-checkout"
        : writeSet.length > 0
          ? "explicit-disjoint-writeset"
          : "serialized",
    };
  }
  if (!input.isWriter) {
    return {
      mode: "inprocess-shared",
      backend: "inprocess",
      worktreeId: null,
      writeSet,
      parallelWritesAllowed: false,
      writeSetBasis: "read-only",
    };
  }
  if (writeSet.length > 0 && input.concurrentSiblings > 0) {
    return {
      mode: "inprocess-shared",
      backend: "inprocess",
      worktreeId: null,
      writeSet,
      parallelWritesAllowed: true,
      writeSetBasis: "explicit-disjoint-writeset",
    };
  }
  return {
    mode: "inprocess-shared",
    backend: "inprocess",
    worktreeId: null,
    writeSet,
    parallelWritesAllowed: false,
    writeSetBasis: writeSet.length > 0 ? "serialized" : "writer-without-proof",
  };
}

export function buildDelegationAdmissionReceipt(
  input: DelegationAdmissionReceiptInput,
): DelegationAdmissionReceipt {
  const now = new Date().toISOString();
  const childSessionKey = input.spawn.result?.childSessionKey?.trim() || null;
  const childRunId = input.spawn.result?.runId?.trim() || null;
  const accepted = input.spawn.status === "accepted" && Boolean(childSessionKey) && Boolean(childRunId);
  const rejectionReason = accepted
    ? null
    : input.spawn.error
      ?? input.spawn.result?.error
      ?? (input.spawn.status === "accepted"
        ? "accepted spawn did not return a child session/run identity"
        : input.spawn.status);
  return {
    schemaVersion: "DelegationAdmissionReceipt/v1",
    receiptId: input.admission.receiptId,
    idempotencyKey: input.admission.idempotencyKey,
    requestDigest: input.admission.requestDigest,
    coordinator: { ...input.admission.coordinator },
    taskRef: { ...input.admission.taskRef },
    roleName: input.roleName,
    task: input.task,
    state: accepted ? "accepted" : "rejected",
    acceptedIsNotCompletion: true,
    orchestrationRunId: input.orchestrationRunId,
    taskNodeId: input.taskNodeId,
    taskId: input.taskId,
    roleInstanceId: input.roleInstanceId,
    childSessionKey,
    childRunId,
    backend: input.spawn.backend ?? {
      kind: "unknown",
      provider: null,
      model: null,
      evidence: "spawn-result-missing-backend",
    },
    toolAuthorization: input.spawn.authorization ?? {
      allowlist: [],
      denylist: [],
      permissionDecisionCount: 0,
      source: "unresolved",
    },
    isolation: resolveIsolation(input),
    reason: rejectionReason,
    createdAt: input.admission.createdAt,
    updatedAt: now,
    acceptedAt: accepted ? now : null,
    rejectedAt: accepted ? null : now,
  };
}

export type DelegationWorkerExecution = {
  backend: "subagent";
  isolation: SessionDelegationIsolation;
  toolAuthorization: SessionDelegationToolAuthorization;
};
