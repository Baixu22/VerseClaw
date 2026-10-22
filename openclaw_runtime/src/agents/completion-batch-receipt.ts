import type {
  SessionCompletionBatch,
  SessionCompletionBatchDeliveryState,
  SessionCompletionBatchWorkerStatus,
} from "../../../shared/types/session-activity.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";
import { SUBAGENT_ENDED_REASON_KILLED } from "./subagent-lifecycle-events.js";

export const MAX_SESSION_COMPLETION_BATCH_WORKERS = 64;

function workerStatus(run: SubagentRunRecord): SessionCompletionBatchWorkerStatus {
  if (!run || typeof run.endedAt !== "number") return "pending";
  if (
    run.pauseReason === "sessions_yield" ||
    run.suppressAnnounceReason === "killed" ||
    run.endedReason === SUBAGENT_ENDED_REASON_KILLED
  ) {
    return "cancelled";
  }
  if (run.outcome?.status === "ok" && run.outcome.error == null) return "completed";
  if (run.outcome?.status === "error" || run.outcome?.status === "timeout") return "failed";
  return "unknown";
}

function mergeExpectedWorkerRunIds(workers: readonly SubagentRunRecord[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const append = (runId: string) => {
    const normalized = runId.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(normalized);
  };
  for (const worker of workers) {
    for (const runId of worker.orchestration?.expectedWorkerRunIds ?? []) append(runId);
  }
  for (const worker of workers) append(worker.runId);
  return merged;
}

function deliveryStatus(run: SubagentRunRecord | undefined): SessionCompletionBatchDeliveryState {
  if (!run) return "pending";
  const status = run.delivery?.status;
  return status === "not_required" ? "none" : (status ?? "none");
}

function summarizeDelivery(params: {
  expectedWorkerRunIds: readonly string[];
  workers: readonly SubagentRunRecord[];
  verifier: SubagentRunRecord | undefined;
  terminal: boolean;
}): SessionCompletionBatch["delivery"] {
  const byId = new Map(params.workers.map((run) => [run.runId, run]));
  const entries = [
    ...params.expectedWorkerRunIds.map((runId) => byId.get(runId)),
    ...(params.verifier ? [params.verifier] : []),
  ];
  let pendingCount = 0;
  let inProgressCount = 0;
  let deliveredCount = 0;
  let failedCount = 0;
  let suspendedCount = 0;
  let discardedCount = 0;
  for (const run of entries) {
    const status = deliveryStatus(run);
    if (status === "delivered") deliveredCount += 1;
    else if (status === "in_progress") inProgressCount += 1;
    else if (status === "failed") failedCount += 1;
    else if (status === "suspended") suspendedCount += 1;
    else if (status === "discarded") discardedCount += 1;
    else pendingCount += 1;
  }
  const state: SessionCompletionBatchDeliveryState = !params.terminal
    ? "pending"
    : inProgressCount > 0
      ? "in_progress"
      : suspendedCount > 0
        ? "suspended"
        : deliveredCount === entries.length && entries.length > 0
          ? "delivered"
          : failedCount > 0
            ? "failed"
            : discardedCount > 0
              ? "discarded"
              : "pending";
  return {
    state,
    pendingCount,
    inProgressCount,
    deliveredCount,
    failedCount,
    suspendedCount,
    discardedCount,
  };
}

export function buildCompletionBatchReceipts(
  runs: readonly SubagentRunRecord[],
  requesterSessionKey: string,
): SessionCompletionBatch[] {
  const key = requesterSessionKey.trim();
  if (!key) return [];
  const byOrchestration = new Map<string, SubagentRunRecord[]>();
  for (const run of runs) {
    if (run.requesterSessionKey !== key) continue;
    const orchestrationRunId = run.orchestration?.orchestrationRunId;
    if (!orchestrationRunId) continue;
    const group = byOrchestration.get(orchestrationRunId) ?? [];
    group.push(run);
    byOrchestration.set(orchestrationRunId, group);
  }

  const batches: SessionCompletionBatch[] = [];
  for (const [orchestrationRunId, group] of byOrchestration) {
    const workers = group.filter((run) => run.orchestration?.phase === "worker");
    if (workers.length === 0) continue;
    const meta = workers.find((run) => run.orchestration)?.orchestration;
    const expectedWorkerRunIds = mergeExpectedWorkerRunIds(workers);
    const workerById = new Map(workers.map((run) => [run.runId, run]));
    const presentWorkers = expectedWorkerRunIds
      .map((runId) => workerById.get(runId))
      .filter((run): run is SubagentRunRecord => Boolean(run));
    const verifier = group.find(
      (run) =>
        run.orchestration?.phase === "verifier" &&
        (run.runId === meta?.verifierStartedRunId || run.orchestration.isVerifier === true),
    );
    const verifierStatus = verifier ? workerStatus(verifier) : meta?.verifierRole && !meta.verifierSkippedReason
      ? "pending"
      : null;
    const missingWorkerCount = expectedWorkerRunIds.length - presentWorkers.length;
    const workersTerminal = missingWorkerCount === 0
      && presentWorkers.every((run) => typeof run.endedAt === "number");
    const verifierTerminal = !meta?.verifierRole
      || Boolean(meta.verifierSkippedReason)
      || (Boolean(verifier) && typeof verifier!.endedAt === "number");
    const bounded = expectedWorkerRunIds.length <= MAX_SESSION_COMPLETION_BATCH_WORKERS;
    const terminal = workersTerminal && verifierTerminal;
    const statuses = expectedWorkerRunIds.map((runId) => {
      const run = workerById.get(runId);
      return run ? workerStatus(run) : "missing" as const;
    });
    const completedWorkerCount = statuses.filter((status) => status === "completed").length;
    const failedWorkerCount = statuses.filter((status) => status === "failed").length;
    const cancelledWorkerCount = statuses.filter((status) => status === "cancelled").length;
    const pendingWorkerCount = statuses.filter((status) => status === "pending" || status === "missing").length;
    const delivery = summarizeDelivery({
      expectedWorkerRunIds,
      workers: presentWorkers,
      verifier,
      terminal,
    });
    const generationEntries = [...presentWorkers, ...(verifier ? [verifier] : [])];
    const workerSessionIds = new Set(
      generationEntries
        .map((run) => run.requesterSessionId?.trim())
        .filter((value): value is string => Boolean(value)),
    );
    const generationComplete =
      generationEntries.length > 0 &&
      generationEntries.every((run) => Boolean(run.requesterSessionId?.trim()));
    const generationState =
      workerSessionIds.size > 1
        ? "mismatch"
        : !generationComplete
          ? "unknown"
          : "consistent";
    const status = !terminal
      ? "collecting"
      : !bounded ||
          generationState !== "consistent" ||
          delivery.failedCount > 0 ||
          delivery.discardedCount > 0 ||
          (delivery.deliveredCount > 0 && delivery.state !== "delivered")
        ? "partial"
        : delivery.state === "in_progress" || delivery.state === "pending" || delivery.state === "suspended"
          ? "delivery-pending"
          : delivery.state === "delivered"
            ? "delivered"
            : "partial";
    const updatedAt = Math.max(
      ...group.map((run) => run.endedAt ?? run.startedAt ?? run.createdAt),
    );
    const batchId = `completion-batch:${orchestrationRunId}:${key}`;
    batches.push({
      id: batchId,
      idempotencyKey: batchId,
      orchestrationRunId,
      requesterSessionKey: key,
      requesterSessionId: workerSessionIds.size === 1 ? [...workerSessionIds][0]! : null,
      generationState,
      status,
      terminal,
      expectedWorkerCount: expectedWorkerRunIds.length,
      completedWorkerCount,
      failedWorkerCount,
      cancelledWorkerCount,
      pendingWorkerCount,
      workerRuns: expectedWorkerRunIds.slice(0, MAX_SESSION_COMPLETION_BATCH_WORKERS).map((runId) => {
        const run = workerById.get(runId);
        return {
          runId,
          roleName: run?.orchestration?.roleName ?? run?.label ?? null,
          taskNodeId: run?.orchestration?.taskNodeId ?? null,
          childSessionKey: run?.childSessionKey ?? null,
          status: run ? workerStatus(run) : "missing",
        };
      }),
      verifier: verifier ? { runId: verifier.runId, status: workerStatus(verifier) } : verifierStatus
        ? { runId: meta?.verifierStartedRunId ?? "pending", status: verifierStatus }
        : null,
      delivery,
      bounded,
      completionAuthority: "none",
      updatedAt,
    });
  }
  return batches.sort((left, right) => right.updatedAt - left.updatedAt);
}
