import type { SessionActivityCompletionBatch, SessionActivityCompletionBatchMember } from "../../../shared/types/session-activity.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const MAX_MEMBERS = 64;

function memberStatus(entry: SubagentRunRecord): SessionActivityCompletionBatchMember["status"] {
  if (typeof entry.endedAt !== "number") return "running";
  if (entry.endedReason === "subagent-killed") return "cancelled";
  if (entry.outcome?.status === "ok") return "completed";
  if (entry.outcome?.status === "error" || entry.outcome?.status === "timeout") return "failed";
  return "unknown";
}

function deliveryStatus(entry: SubagentRunRecord): SessionActivityCompletionBatchMember["deliveryStatus"] {
  return entry.delivery?.status ?? "pending";
}

function aggregateDelivery(members: readonly SubagentRunRecord[], projected: readonly SessionActivityCompletionBatchMember[]) {
  const delivered = projected.filter((member) => member.deliveryStatus === "delivered").length;
  const pending = projected.filter((member) => member.deliveryStatus === "pending" || member.deliveryStatus === "in_progress").length;
  const suspended = projected.filter((member) => member.deliveryStatus === "suspended").length;
  const failed = projected.filter((member) => member.deliveryStatus === "failed").length;
  const discarded = projected.filter((member) => member.deliveryStatus === "discarded").length;
  const notRequired = projected.filter((member) => member.deliveryStatus === "not_required").length;
  const state = members.some((entry) => entry.delivery?.status === "in_progress")
    ? "in_progress" as const
    : members.some((entry) => entry.delivery?.status === "pending")
      ? "pending" as const
      : members.some((entry) => entry.delivery?.status === "suspended")
        ? "suspended" as const
        : members.some((entry) => entry.delivery?.status === "failed")
          ? "failed" as const
          : members.some((entry) => entry.delivery?.status === "discarded")
            ? "discarded" as const
            : members.length > 0 && notRequired === members.length
              ? "not_required" as const
              : delivered === members.length
                ? "delivered" as const
                : "pending" as const;
  return {
    state,
    delivered,
    pending,
    suspended,
    failed,
    discarded,
    waitingForRequesterTurn: members.some((entry) => (
      entry.delivery?.lastDropReason === "waiting_for_requester_turn"
    )),
  };
}

export function buildOrchestrationCompletionBatches(params: {
  runs: readonly SubagentRunRecord[];
  requesterSessionKey: string;
  currentRequesterSessionId?: string | null;
}): SessionActivityCompletionBatch[] {
  const groups = new Map<string, SubagentRunRecord[]>();
  for (const entry of params.runs) {
    const meta = entry.orchestration;
    if (!meta || meta.phase !== "worker") continue;
    if (entry.requesterSessionKey !== params.requesterSessionKey) continue;
    const group = groups.get(meta.orchestrationRunId) ?? [];
    group.push(entry);
    groups.set(meta.orchestrationRunId, group);
  }

  return [...groups.entries()].map(([orchestrationRunId, records]) => {
    const ordered = records.toSorted((left, right) => left.createdAt - right.createdAt || left.runId.localeCompare(right.runId));
    const expectedRunIds = ordered[0]?.orchestration?.expectedWorkerRunIds?.length
      ? [...ordered[0].orchestration.expectedWorkerRunIds]
      : ordered.map((entry) => entry.runId);
    const boundedExpected = expectedRunIds.slice(0, MAX_MEMBERS);
    const byRunId = new Map(ordered.map((entry) => [entry.runId, entry]));
    const members = boundedExpected.flatMap((runId) => {
      const entry = byRunId.get(runId);
      if (!entry) return [];
      return [{
        runId,
        roleName: entry.orchestration?.roleName ?? entry.label ?? "worker",
        status: memberStatus(entry),
        deliveryStatus: deliveryStatus(entry),
      } satisfies SessionActivityCompletionBatchMember];
    });
    const projectedEntries = boundedExpected.flatMap((runId) => {
      const entry = byRunId.get(runId);
      return entry ? [entry] : [];
    });
    const terminal = expectedRunIds.length <= MAX_MEMBERS && projectedEntries.length === expectedRunIds.length && projectedEntries.every((entry) => typeof entry.endedAt === "number");
    const generations = [...new Set(projectedEntries.flatMap((entry) => entry.requesterSessionId ? [entry.requesterSessionId] : []))];
    const expectedGeneration = generations.length === 1 ? generations[0]! : null;
    const currentGeneration = params.currentRequesterSessionId?.trim() || null;
    const generationState = expectedGeneration && currentGeneration
      ? expectedGeneration === currentGeneration ? "matching" as const : "mismatch" as const
      : "unverified" as const;
    const completed = members.filter((member) => member.status === "completed").length;
    const failed = members.filter((member) => member.status === "failed").length;
    const cancelled = members.filter((member) => member.status === "cancelled").length;
    const unknown = members.filter((member) => member.status === "unknown").length;
    const settled = members.filter((member) => member.status !== "running").length;
    const terminalAt = terminal
      ? Math.max(...projectedEntries.map((entry) => entry.endedAt ?? entry.createdAt))
      : null;
    const status = terminal
      ? generationState === "mismatch" ? "fenced" as const : "terminal" as const
      : "collecting" as const;
    const outcome = status === "fenced"
      ? "fenced" as const
      : status === "collecting"
        ? "incomplete" as const
        : cancelled === expectedRunIds.length
          ? "cancelled" as const
          : completed === expectedRunIds.length
            ? "completed" as const
            : completed === 0
              ? "failed" as const
              : "partial" as const;
    const acceptedAt = Math.min(...ordered.map((entry) => entry.createdAt));
    const batchId = `${orchestrationRunId}:${params.requesterSessionKey}:${expectedGeneration ?? "legacy"}`;
    return {
      schemaVersion: "clawx.orchestration-completion-batch/v1",
      batchId,
      orchestrationRunId,
      requesterSessionKey: params.requesterSessionKey,
      requesterSessionGeneration: expectedGeneration,
      generationState,
      status,
      outcome,
      consolidatedReceiptId: status === "terminal" ? `${batchId}:consolidated:v1` : null,
      acceptedAt,
      terminalAt,
      counts: {
        expected: expectedRunIds.length,
        settled,
        completed,
        failed,
        cancelled,
        unknown,
      },
      delivery: aggregateDelivery(projectedEntries, members),
      members,
    } satisfies SessionActivityCompletionBatch;
  }).toSorted((left, right) => left.acceptedAt - right.acceptedAt || left.batchId.localeCompare(right.batchId));
}