// Runtime Lifecycle Governance Phase 1 — session scope drain.
//
// `drainScope` is the process/resource drain half of the canonical finalizer.
// It never falls back to an agent-wide kill and never uses `scopeKey` as the
// authoritative lifecycle identity.
import {
  deleteSession,
  getBashProcessRegistryState,
  snapshotProcessSessionsForLifecycle,
  type BashProcessSessionDrainHandle,
} from "../agents/bash-process-registry.js";
import { goalWakeController } from "../agents/goal-wake-controller.js";
import {
  cancelAndReapDurableHelpersForSession,
  snapshotDurableHelperPidsForSession,
} from "../agents/goal-wake-durable-cleanup.js";
import { resolveDurableHelperRoot } from "../agents/goal-wake-helper-protocol.js";
import { resolveConfigDir } from "../utils.js";
import {
  captureProcessTrees,
  verifyProcessTreesTerminated,
} from "../process/os-containment.js";
import { getProcessSupervisor } from "../process/supervisor/index.js";
import type { ProcessLifecycleIdentity } from "../process/supervisor/types.js";
import {
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from "../sessions/session-admission-registry.js";

export const SESSION_DRAIN_TIMEOUT_MS = 15_000;

export type DrainScopeFailureReason =
  | "fence-open"
  | "timeout"
  | "unknown-owner"
  | "os-containments-unknown"
  | "os-containments-residual"
  | "new-records"
  | "goal-rows-active"
  | "durable-helper-cleanup";

export type DrainScopeResult =
  | {
      ok: true;
      bashSessionsRemoved: number;
      supervisorRunsDrained: number;
      goalTaskFlowRows: number;
      helperClaimProtocol: number;
      osContainment: "empty";
    }
  | {
      ok: false;
      reason: DrainScopeFailureReason;
      message: string;
    };

type DurableOwnerInventory = {
  goalTaskFlowRows: number;
  helperClaimProtocol: number;
};

function normalizeIdentity(identity: SessionAdmissionIdentity): SessionAdmissionIdentity {
  return {
    agentId: identity.agentId.trim(),
    canonicalSessionKey: identity.canonicalSessionKey.trim(),
    expectedSessionId: identity.expectedSessionId.trim(),
  };
}

function assertLifecycleIdentity(identity: SessionAdmissionIdentity): SessionAdmissionIdentity {
  const normalized = normalizeIdentity(identity);
  if (!normalized.agentId || !normalized.canonicalSessionKey || !normalized.expectedSessionId) {
    throw new Error("drainScope requires a complete lifecycle identity");
  }
  return normalized;
}

function toSupervisorIdentity(identity: SessionAdmissionIdentity): ProcessLifecycleIdentity {
  return { ...identity };
}

function dedupePids(values: Array<number | undefined>): number[] {
  const pids = new Set<number>();
  for (const value of values) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      pids.add(value);
    }
  }
  return [...pids];
}

/**
 * Phase 1 has no durable goal task/flow row owner and no helper claim
 * protocol. This explicit empty-inventory check is vacuous by design; later
 * phases must extend the same drain success contract instead of introducing
 * parallel owners.
 */
function verifyDurableOwners(
  canonicalSessionKey: string,
  helperClaimProtocol = 0,
): DurableOwnerInventory {
  const active = goalWakeController.countActiveGoalWakeRowsForSession(canonicalSessionKey);
  return {
    goalTaskFlowRows: active.tasks + active.flows,
    helperClaimProtocol,
  };
}

function hasOnlyOriginalIds(
  current: BashProcessSessionDrainHandle[],
  originalIds: Set<string>,
): boolean {
  return current.every((handle) => originalIds.has(handle.id));
}

/**
 * Drains every Phase 1 process owner for one lifecycle identity.
 *
 * Success requires: the admission fence is closed, every snapshotted owner
 * handle cancelled and waited, Phase 1-absent durable owners verified empty,
 * OS process-tree containment empty with PID-reuse evidence, and no new owner
 * records after the wait.
 */
export async function drainScope(
  identity: SessionAdmissionIdentity,
  timeoutMs = SESSION_DRAIN_TIMEOUT_MS,
): Promise<DrainScopeResult> {
  const normalized = assertLifecycleIdentity(identity);
  if (!sessionAdmissionRegistry.isFenced(normalized)) {
    return {
      ok: false,
      reason: "fence-open",
      message: `refusing to drain ${normalized.canonicalSessionKey}: admission fence is not closed`,
    };
  }

  const supervisor = getProcessSupervisor();
  const bashHandles = snapshotProcessSessionsForLifecycle(normalized);
  const supervisorSnapshot = supervisor.snapshotRunsForLifecycle(toSupervisorIdentity(normalized));
  const originalBashIds = new Set(bashHandles.map((handle) => handle.id));
  const originalSupervisorRunIds = new Set(supervisorSnapshot.map((run) => run.runId));
  const durableRootDir = resolveDurableHelperRoot(resolveConfigDir());
  const durablePids = await snapshotDurableHelperPidsForSession(
    normalized.canonicalSessionKey,
    { rootDir: durableRootDir },
  );
  const rootPids = dedupePids([
    ...bashHandles.map((handle) => handle.pid),
    ...supervisorSnapshot.map((run) => run.pid),
    ...durablePids,
  ]);
  const osCapture = await captureProcessTrees(rootPids);
  const budgetMs = Math.max(1, Math.floor(timeoutMs));

  const cancelFailures: string[] = [];
  for (const handle of bashHandles) {
    if (handle.cancel() === "unknown") {
      cancelFailures.push(handle.id);
    }
  }
  const durableReapPromise = cancelAndReapDurableHelpersForSession({
    sessionKey: normalized.canonicalSessionKey,
    options: { rootDir: durableRootDir },
    timeoutMs: budgetMs,
  });

  const [supervisorDrain, bashWaits, durableReap] = await Promise.all([
    supervisor.drainRunsForLifecycle(toSupervisorIdentity(normalized), budgetMs),
    Promise.all(bashHandles.map((handle) => handle.wait(budgetMs))),
    durableReapPromise,
  ]);

  if (cancelFailures.length > 0) {
    return {
      ok: false,
      reason: "unknown-owner",
      message: `refusing to remove records for unknown bash process owner(s): ${cancelFailures.join(", ")}`,
    };
  }
  if (!supervisorDrain.drained) {
    return {
      ok: false,
      reason: "timeout",
      message: `supervised run drain timed out for ${normalized.canonicalSessionKey}`,
    };
  }
  for (const outcome of bashWaits) {
    if (outcome === "timeout") {
      return {
        ok: false,
        reason: "timeout",
        message: `bash process session drain timed out for ${normalized.canonicalSessionKey}`,
      };
    }
    if (outcome === "unknown") {
      return {
        ok: false,
        reason: "unknown-owner",
        message: `bash process session drain is in an unknown state for ${normalized.canonicalSessionKey}`,
      };
    }
  }
  if (!durableReap.ok) {
    return {
      ok: false,
      reason: durableReap.reason === "unknown-owner" ? "unknown-owner" : "durable-helper-cleanup",
      message: durableReap.message,
    };
  }

  const osCheck =
    osCapture.status === "ok"
      ? await verifyProcessTreesTerminated(osCapture)
      : { status: "unknown" as const, detail: osCapture.detail ?? "OS evidence unavailable" };
  if (osCheck.status === "unknown") {
    return {
      ok: false,
      reason: "os-containments-unknown",
      message: `OS containment evidence is unknown for ${normalized.canonicalSessionKey}: ${osCheck.detail}`,
    };
  }
  if (osCheck.status === "residual") {
    return {
      ok: false,
      reason: "os-containments-residual",
      message: `OS containment is not empty for ${normalized.canonicalSessionKey}: ${osCheck.detail}`,
    };
  }

  const durableOwners = verifyDurableOwners(
    normalized.canonicalSessionKey,
    durableReap.cancelled + durableReap.finalized,
  );
  if (durableOwners.goalTaskFlowRows > 0) {
    return {
      ok: false,
      reason: "goal-rows-active",
      message: `goal-owned task/flow rows are still active for ${normalized.canonicalSessionKey}: ${durableOwners.goalTaskFlowRows}`,
    };
  }
  const currentBashHandles = snapshotProcessSessionsForLifecycle(normalized);
  const currentSupervisorRuns = supervisor.snapshotRunsForLifecycle(toSupervisorIdentity(normalized));
  if (
    !hasOnlyOriginalIds(currentBashHandles, originalBashIds) ||
    currentSupervisorRuns.some((run) => !originalSupervisorRunIds.has(run.runId))
  ) {
    const state = getBashProcessRegistryState();
    return {
      ok: false,
      reason: "new-records",
      message: `owner registry gained new records while draining ${normalized.canonicalSessionKey} (bash running=${state.runningCount} finished=${state.finishedCount})`,
    };
  }

  for (const id of originalBashIds) {
    deleteSession(id);
  }

  return {
    ok: true,
    bashSessionsRemoved: originalBashIds.size,
    supervisorRunsDrained: originalSupervisorRunIds.size,
    goalTaskFlowRows: durableOwners.goalTaskFlowRows,
    helperClaimProtocol: durableOwners.helperClaimProtocol,
    osContainment: "empty",
  };
}
