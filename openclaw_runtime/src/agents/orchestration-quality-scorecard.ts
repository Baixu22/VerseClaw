import type { ObservabilityScorecard } from "../observability/types.js";
import {
  scoreWorkerQuality,
  summarizeQuality,
  type WorkerQualityScore,
} from "./orchestration-protocol.js";

export type OrdinaryOrchestrationQualityState = null | "shadow" | "active";

export type OrdinaryOrchestrationQualityScorecard = {
  state: OrdinaryOrchestrationQualityState;
  overall: WorkerQualityScore["overall"];
  worst: WorkerQualityScore["overall"];
  reason: string;
  evidenceRefs: string[];
  workerScores: WorkerQualityScore[];
  scorecardBacked: boolean;
  observabilityScore?: {
    traceId: string;
    grade: ObservabilityScorecard["grade"];
    score: number;
  };
  summary: ReturnType<typeof summarizeQuality>;
};

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
  allowActive?: boolean;
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

  return {
    state: scorecardBacked ? (input.allowActive ? "active" : "shadow") : null,
    overall,
    worst,
    reason: scorecardBacked
      ? `Ordinary orchestration scored from ${workerScores.length} worker attempt(s) and observability trace ${input.observabilityScorecard?.traceId}.`
      : "Ordinary orchestration has worker evidence but no observability scorecard.",
    evidenceRefs,
    workerScores,
    scorecardBacked,
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
