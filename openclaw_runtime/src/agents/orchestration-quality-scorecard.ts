import type { ObservabilityScorecard } from "../observability/types.js";
import {
  scoreWorkerQuality,
  summarizeQuality,
  type WorkerQualityScore,
} from "./orchestration-protocol.js";

export type OrdinaryOrchestrationQualityState = null | "shadow";

export type OrchestrationQualityAuthority =
  | {
      state: "unavailable";
      source: "none";
      qualityOverall: null;
      scorecardBacked: false;
      verified: false;
      routingEligible: false;
      reason: string;
      evidenceRefs: string[];
    }
  | {
      state: "shadow";
      source: "ordinary_orchestration_scorecard";
      qualityOverall: WorkerQualityScore["overall"];
      scorecardBacked: true;
      verified: false;
      routingEligible: false;
      reason: string;
      evidenceRefs: string[];
    }
  | {
      state: "active";
      source: "task_loop_verified_scorecard";
      qualityOverall: WorkerQualityScore["overall"];
      scorecardBacked: true;
      verified: true;
      routingEligible: true;
      reason: string;
      evidenceRefs: string[];
      loopRunId: string;
      sessionKey: string;
      traceId: string;
    };

export type OrdinaryOrchestrationQualityScorecard = {
  state: OrdinaryOrchestrationQualityState;
  overall: WorkerQualityScore["overall"];
  worst: WorkerQualityScore["overall"];
  reason: string;
  evidenceRefs: string[];
  workerScores: WorkerQualityScore[];
  scorecardBacked: boolean;
  authority: OrchestrationQualityAuthority;
  observabilityScore?: {
    traceId: string;
    grade: ObservabilityScorecard["grade"];
    score: number;
  };
  summary: ReturnType<typeof summarizeQuality>;
};

export function unavailableOrchestrationQualityAuthority(
  reason: string,
): Extract<OrchestrationQualityAuthority, { state: "unavailable" }> {
  return {
    state: "unavailable",
    source: "none",
    qualityOverall: null,
    scorecardBacked: false,
    verified: false,
    routingEligible: false,
    reason,
    evidenceRefs: [],
  };
}

const rank: Record<WorkerQualityScore["overall"], number> = {
  good: 0,
  needs_attention: 1,
  poor_attempt: 2,
};

function worstScore(scores: WorkerQualityScore[]): WorkerQualityScore["overall"] {
  return scores.reduce<WorkerQualityScore["overall"]>((worst, score) => (
    rank[score.overall] > rank[worst] ? score.overall : worst
  ), "good");
}

function overallFromScores(scores: WorkerQualityScore[]): WorkerQualityScore["overall"] {
  if (scores.some((score) => score.overall === "poor_attempt")) return "needs_attention";
  if (scores.some((score) => score.overall === "needs_attention")) return "needs_attention";
  return "good";
}

export function buildOrdinaryOrchestrationQualityScorecard(input: {
  orchestrationRunId: string;
  attempts: readonly {
    roleName: string;
    taskId?: string;
    childRunId?: string;
    childSessionKey?: string;
    status?: string;
    error?: string;
    resultText?: string;
    verifierVerdict?: WorkerQualityScore["verifierVerdict"];
  }[];
  observabilityScorecard?: ObservabilityScorecard;
}): OrdinaryOrchestrationQualityScorecard | null {
  if (input.attempts.length === 0 && !input.observabilityScorecard) return null;

  const workerScores = input.attempts.map((attempt, index) => scoreWorkerQuality({
    roleName: attempt.roleName,
    childRunId: attempt.childRunId ?? attempt.taskId ?? `${input.orchestrationRunId}:attempt:${index + 1}`,
    childSessionKey: attempt.childSessionKey,
    resultText: attempt.resultText,
    outcomeStatus: attempt.status,
    outcomeError: attempt.error,
    verifierOutcomeStatus: attempt.verifierVerdict === "accepted"
      ? "ok"
      : attempt.verifierVerdict === "refuted"
        ? "error"
        : undefined,
  }));

  const overall = workerScores.length > 0 ? overallFromScores(workerScores) : "needs_attention";
  const worst = workerScores.length > 0 ? worstScore(workerScores) : "needs_attention";
  const scorecardBacked = Boolean(input.observabilityScorecard);
  const evidenceRefs = [
    `orchestration:${input.orchestrationRunId}`,
    ...(input.observabilityScorecard ? [`trace:${input.observabilityScorecard.traceId}`] : []),
    ...workerScores.map((score) => `run:${score.childRunId}`),
  ];

  const reason = scorecardBacked
    ? `Ordinary orchestration scored from ${workerScores.length} worker attempt(s) and observability trace ${input.observabilityScorecard?.traceId}; this evidence is shadow-only and cannot change routing.`
    : "Ordinary orchestration has worker evidence but no observability scorecard.";
  const authority: OrchestrationQualityAuthority = scorecardBacked
    ? {
        state: "shadow",
        source: "ordinary_orchestration_scorecard",
        qualityOverall: overall,
        scorecardBacked: true,
        verified: false,
        routingEligible: false,
        reason,
        evidenceRefs,
      }
    : unavailableOrchestrationQualityAuthority(reason);

  return {
    state: scorecardBacked ? "shadow" : null,
    overall,
    worst,
    reason,
    evidenceRefs,
    workerScores,
    scorecardBacked,
    authority,
    observabilityScore: input.observabilityScorecard
      ? {
          traceId: input.observabilityScorecard.traceId,
          grade: input.observabilityScorecard.grade,
          score: input.observabilityScorecard.score,
        }
      : undefined,
    summary: summarizeQuality(workerScores),
  };
}

export function buildTaskLoopVerifiedQualityAuthority(input: {
  record: {
    loopRunId: string;
    sessionKey: string;
    status: "running" | "complete" | "blocked" | "error" | "cancelled";
    traceId?: string;
    evidenceGate?: { status: "pass" | "repair" | "blocked" };
    roleQualitySummary: {
      good: number;
      needsAttention: number;
      poorAttempt: number;
    };
    subagentEvidence: readonly { childRunId?: string }[];
  };
  scorecard?: ObservabilityScorecard;
}): OrchestrationQualityAuthority {
  const { record, scorecard } = input;
  if (record.status === "running") {
    return unavailableOrchestrationQualityAuthority("Task Loop quality is unavailable while the run is active.");
  }
  if (record.status === "error") {
    return unavailableOrchestrationQualityAuthority("Task Loop quality is unavailable because the run ended in error.");
  }
  if (!record.evidenceGate || record.subagentEvidence.length === 0) {
    return unavailableOrchestrationQualityAuthority(
      "Task Loop quality is unavailable without bounded worker evidence and an evidence-gate result.",
    );
  }
  if (!record.traceId || !scorecard || scorecard.traceId !== record.traceId) {
    return unavailableOrchestrationQualityAuthority(
      "Task Loop quality is unavailable without a matching runtime observability scorecard.",
    );
  }

  const qualityOverall =
    record.status === "blocked" ||
    record.evidenceGate.status === "blocked" ||
    record.roleQualitySummary.poorAttempt > 0
      ? "poor_attempt"
      : record.evidenceGate.status === "repair" || record.roleQualitySummary.needsAttention > 0
        ? "needs_attention"
        : "good";
  const evidenceRefs = [
    `task-loop:${record.loopRunId}`,
    `trace:${record.traceId}`,
    ...record.subagentEvidence.flatMap((entry) =>
      entry.childRunId ? [`run:${entry.childRunId}`] : [],
    ),
  ];

  return {
    state: "active",
    source: "task_loop_verified_scorecard",
    qualityOverall,
    scorecardBacked: true,
    verified: true,
    routingEligible: true,
    reason: `Task Loop ${record.loopRunId} supplied terminal evidence and matching observability scorecard ${record.traceId}.`,
    evidenceRefs,
    loopRunId: record.loopRunId,
    sessionKey: record.sessionKey,
    traceId: record.traceId,
  };
}
