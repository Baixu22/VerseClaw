import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { canonicalPath } from "../../../../shared/task-system/identity.js";
import { TaskSystemStore } from "../../../../shared/task-system/store.js";
import type { TaskContract, TaskView } from "../../../../shared/task-system/types.js";
import { createExecutionTaskAccess } from "../execution-task-authority.js";
import { resolveSessionWorkspaceDir } from "../spawned-context.js";
import { getSessionEntry } from "../../config/sessions/store.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import type {
  MissionManagedTaskAcceptanceReceipt,
  MissionManagedTaskReference,
  MissionManagedTaskRuntime,
} from "./types.js";

export type BoundMissionManagedTask = {
  reference: MissionManagedTaskReference;
  contract: TaskContract;
  view: TaskView;
};

export type InspectedMissionManagedTask = BoundMissionManagedTask & {
  acceptanceReceipt?: MissionManagedTaskAcceptanceReceipt;
};

function requireText(value: string | undefined | null, code: string): string {
  const text = value?.trim();
  if (!text) throw new Error(code);
  return text;
}

function requireClaim(view: TaskView) {
  if (!view.claim) throw new Error("MISSION_MANAGED_TASK_CLAIM_MISSING");
  return view.claim;
}

function assertReferenceShape(reference: MissionManagedTaskReference): void {
  if (
    reference.schema !== 1 ||
    !reference.authorityBasis?.identityDigest ||
    !reference.taskNodeId ||
    !reference.digest ||
    !reference.sessionKey ||
    !reference.generation ||
    !reference.worktree ||
    !Number.isSafeInteger(reference.revision) ||
    reference.revision < 1 ||
    !Number.isSafeInteger(reference.epoch) ||
    reference.epoch < 1
  )
    throw new Error("MISSION_MANAGED_TASK_REFERENCE_INVALID");
}

function assertClaimMatchesReference(
  reference: MissionManagedTaskReference,
  view: TaskView,
): void {
  const claim = requireClaim(view);
  if (
    view.contract.taskNodeId !== reference.taskNodeId ||
    view.contract.revision !== reference.revision ||
    view.contract.digest !== reference.digest
  )
    throw new Error("MISSION_MANAGED_TASK_CONTRACT_STALE");
  if (
    claim.sessionKey !== reference.sessionKey ||
    claim.generation !== reference.generation ||
    claim.worktree !== reference.worktree ||
    claim.contractRevision !== reference.revision
  )
    throw new Error("MISSION_MANAGED_TASK_CLAIM_STALE");
  if (
    claim.state === "active"
      ? claim.epoch !== reference.epoch
      : !(view.contract.state === "done" && claim.epoch === reference.epoch + 1)
  )
    throw new Error("MISSION_MANAGED_TASK_CLAIM_STALE");
}

function findAcceptedReceipt(
  store: TaskSystemStore,
  reference: MissionManagedTaskReference,
  view: TaskView,
): MissionManagedTaskAcceptanceReceipt | undefined {
  if (view.contract.state !== "done") return undefined;
  const accepted = store
    .history(reference.taskNodeId, 0, 500)
    .toReversed()
    .find((event) => {
      if (event.kind !== "accepted") return false;
      try {
        const payload = JSON.parse(event.json) as { revision?: unknown; candidate?: unknown };
        return payload.revision === reference.revision && typeof payload.candidate === "string";
      } catch {
        return false;
      }
    });
  if (!accepted) return undefined;
  const payload = JSON.parse(accepted.json) as { candidate: string; revision: number };
  const replay = store.replayCompletedTask(
    reference.taskNodeId,
    reference.sessionKey,
    reference.generation,
    payload.candidate,
  );
  if (replay.contract.state !== "done")
    throw new Error("MISSION_MANAGED_TASK_ACCEPTANCE_MISSING");
  return {
    schema: 1,
    taskNodeId: reference.taskNodeId,
    revision: reference.revision,
    digest: reference.digest,
    epoch: reference.epoch,
    worktree: reference.worktree,
    acceptedEventSequence: accepted.seq,
    acceptedAt: accepted.at,
    candidateDigest: createHash("sha256").update(payload.candidate).digest("hex"),
  };
}

export function isManagedMissionBridgeEnabled(): boolean {
  return process.env.CLAWX_TASK_SCOPE_BRIDGE === "1";
}

/** Resolve the current session owner. Managed bridge mode requires complete provenance. */
export function resolveMissionManagedTaskRuntime(
  sessionKey: string,
  options: { required?: boolean } = {},
): MissionManagedTaskRuntime | undefined {
  const key = sessionKey.trim();
  if (!key) {
    if (options.required) throw new Error("MISSION_MANAGED_TASK_SESSION_MISSING");
    return undefined;
  }
  const agentId = resolveAgentIdFromSessionKey(key);
  const entry = getSessionEntry({ sessionKey: key, ...(agentId ? { agentId } : {}) });
  const generation = entry?.sessionId?.trim();
  const workspaceRoot = resolveSessionWorkspaceDir({
    spawnedWorkspaceDir: entry?.spawnedWorkspaceDir,
    persistedWorkspaceDir: entry?.workspaceDir,
  });
  if (!generation || !workspaceRoot) {
    if (options.required || isManagedMissionBridgeEnabled())
      throw new Error("MISSION_MANAGED_TASK_SESSION_CONTEXT_MISSING");
    return undefined;
  }
  return {
    workspaceRoot,
    sessionKey: key,
    sessionGeneration: generation,
    required: options.required === true || isManagedMissionBridgeEnabled(),
  };
}

/** Bind a Mission to the current TaskSystemStore claim. Optional mode keeps legacy Missions unchanged. */
export function bindMissionManagedTask(
  runtime: MissionManagedTaskRuntime,
  options: { optional?: boolean } = {},
): BoundMissionManagedTask | null {
  const workspaceRoot = requireText(
    runtime.workspaceRoot,
    "MISSION_MANAGED_TASK_WORKSPACE_MISSING",
  );
  const sessionKey = requireText(runtime.sessionKey, "MISSION_MANAGED_TASK_SESSION_MISSING");
  const generation = requireText(
    runtime.sessionGeneration,
    "MISSION_MANAGED_TASK_SESSION_GENERATION_MISSING",
  );
  const access = createExecutionTaskAccess(workspaceRoot);
  if (!existsSync(access.domain.database)) {
    if (options.optional) return null;
    throw new Error("MISSION_MANAGED_TASK_DATABASE_MISSING");
  }
  const store = new TaskSystemStore(access.domain, undefined, access);
  try {
    const binding = store.binding(sessionKey, generation);
    if (!binding) {
      if (options.optional) return null;
      throw new Error("MISSION_MANAGED_TASK_BINDING_MISSING");
    }
    if (binding.referenceOnly) throw new Error("MISSION_MANAGED_TASK_BINDING_NOT_OWNED");
    if (runtime.taskNodeId && binding.contract.taskNodeId !== runtime.taskNodeId)
      throw new Error("MISSION_MANAGED_TASK_BINDING_MISMATCH");
    const view = runtime.taskNodeId ? store.get(runtime.taskNodeId) : binding;
    const claim = requireClaim(view);
    if (claim.sessionKey !== sessionKey || claim.generation !== generation)
      throw new Error("MISSION_MANAGED_TASK_SESSION_STALE");
    if (claim.state !== "active") throw new Error("MISSION_MANAGED_TASK_CLAIM_NOT_ACTIVE");
    if (runtime.taskNodeId && view.contract.taskNodeId !== runtime.taskNodeId)
      throw new Error("MISSION_MANAGED_TASK_BINDING_MISMATCH");
    if (claim.worktree !== access.domain.worktree)
      throw new Error("MISSION_MANAGED_TASK_WORKTREE_MISMATCH");
    return {
      reference: {
        schema: 1,
        authorityBasis: access.basis,
        taskNodeId: view.contract.taskNodeId,
        revision: view.contract.revision,
        digest: view.contract.digest,
        sessionKey: claim.sessionKey,
        generation: claim.generation,
        epoch: claim.epoch,
        worktree: claim.worktree,
      },
      contract: view.contract,
      view,
    };
  } finally {
    store.close();
  }
}

/** Re-open the original authority/claim and verify every pinned field before a Mission effect. */
export function inspectMissionManagedTask(
  reference: MissionManagedTaskReference,
  runtime: MissionManagedTaskRuntime,
): InspectedMissionManagedTask {
  assertReferenceShape(reference);
  if (runtime.sessionKey !== reference.sessionKey || runtime.sessionGeneration !== reference.generation)
    throw new Error("MISSION_MANAGED_TASK_SESSION_STALE");
  if (canonicalPath(runtime.workspaceRoot) !== reference.worktree)
    throw new Error("MISSION_MANAGED_TASK_WORKTREE_STALE");
  const access = createExecutionTaskAccess(reference.worktree, reference.authorityBasis);
  if (!existsSync(access.domain.database))
    throw new Error("MISSION_MANAGED_TASK_DATABASE_MISSING");
  const store = new TaskSystemStore(access.domain, undefined, access);
  try {
    const view = store.get(reference.taskNodeId);
    assertClaimMatchesReference(reference, view);
    if (view.claim?.state === "active") {
      const binding = store.binding(reference.sessionKey, reference.generation);
      if (!binding || binding.referenceOnly || binding.contract.taskNodeId !== reference.taskNodeId)
        throw new Error("MISSION_MANAGED_TASK_BINDING_STALE");
    }
    return {
      reference,
      contract: view.contract,
      view,
      acceptanceReceipt: findAcceptedReceipt(store, reference, view),
    };
  } finally {
    store.close();
  }
}

/**
 * Read only the owner acceptance receipt after an inner task-loop effect.
 * Delegation may temporarily move the claim epoch, so this check pins the
 * contract identity and delegates final proof to TaskSystemStore replay.
 */
export function readMissionManagedTaskAcceptance(
  reference: MissionManagedTaskReference,
  runtime: MissionManagedTaskRuntime,
): MissionManagedTaskAcceptanceReceipt | undefined {
  assertReferenceShape(reference);
  if (runtime.sessionKey !== reference.sessionKey || runtime.sessionGeneration !== reference.generation)
    throw new Error("MISSION_MANAGED_TASK_SESSION_STALE");
  if (canonicalPath(runtime.workspaceRoot) !== reference.worktree)
    throw new Error("MISSION_MANAGED_TASK_WORKTREE_STALE");
  const access = createExecutionTaskAccess(reference.worktree, reference.authorityBasis);
  if (!existsSync(access.domain.database))
    throw new Error("MISSION_MANAGED_TASK_DATABASE_MISSING");
  const store = new TaskSystemStore(access.domain, undefined, access);
  try {
    const view = store.get(reference.taskNodeId);
    if (view.contract.revision !== reference.revision || view.contract.digest !== reference.digest)
      throw new Error("MISSION_MANAGED_TASK_CONTRACT_STALE");
    return findAcceptedReceipt(store, reference, view);
  } finally {
    store.close();
  }
}

/** The execution tick may start only from the exact active epoch bound by the Mission. */
export function requireMissionManagedTaskActive(
  snapshot: InspectedMissionManagedTask,
): InspectedMissionManagedTask {
  const claim = requireClaim(snapshot.view);
  if (
    snapshot.view.contract.state !== "doing" ||
    claim.state !== "active" ||
    claim.epoch !== snapshot.reference.epoch
  )
    throw new Error("MISSION_MANAGED_TASK_NOT_ACTIVE");
  return snapshot;
}

/** Reviewer completion is accepted only after replaying the original TaskSystemStore acceptance. */
export function verifyMissionManagedTaskAccepted(
  reference: MissionManagedTaskReference,
  runtime: MissionManagedTaskRuntime,
): MissionManagedTaskAcceptanceReceipt {
  const snapshot = inspectMissionManagedTask(reference, runtime);
  if (!snapshot.acceptanceReceipt)
    throw new Error("MISSION_MANAGED_TASK_ACCEPTANCE_RECEIPT_REQUIRED");
  return snapshot.acceptanceReceipt;
}
