import type { KnowledgeStore } from "./knowledge-store.js";
import { isSekbShadowMetadataV1 } from "./shadow-evaluator.js";
import type {
  Principle,
  PrincipleCriticality,
  SekbBatchDistillationEvent,
  TrajectoryOutcome,
} from "./types.js";
import {
  RUNTIME_LINEAGE_SCHEMA,
  normalizeRuntimeLineage,
  type RuntimeLineage,
} from "../../runtime-core/lineage.js";

export type SekbOperatorReportOptions = {
  undistilledLimit?: number;
  now?: () => Date;
  shadowEvaluationEnabled?: boolean;
  batchDistillationAssistantEnabled?: boolean;
};

export type SekbOperatorEvidenceState =
  | "disabled"
  | "unavailable"
  | "insufficient_data"
  | "ready"
  | "unknown";

type NumericSummary = {
  min: number;
  max: number;
  average: number;
};

type OperatorMetric =
  | { status: "available"; value: number }
  | { status: "unavailable"; reason: string };

export type SekbOperatorReport = {
  lineageSchema: "runtime-lineage.v1";
  counts: {
    trajectories: number;
    undistilledTrajectories: number;
    activePrinciples: number;
  };
  undistilled: Array<{
    trajectory_id: string;
    created_at: string;
    task_intent: string;
    task_type: string;
    context_fingerprint: string[];
    outcome: TrajectoryOutcome;
    error_signature: string | null;
    lineage?: RuntimeLineage;
  }>;
  activePrinciples: Array<{
    principle_id: string;
    title: string;
    task_types: string[];
    context_tags: string[];
    criticality: PrincipleCriticality;
    retrieval_count: number;
    adoption_count: number;
    source_trajectories: string[];
    lineage?: RuntimeLineage;
  }>;
  indexPreview: string;
  evidence: {
    state: SekbOperatorEvidenceState;
    ageDistribution: {
      underHour: number;
      underDay: number;
      underWeek: number;
      older: number;
      invalid: number;
    };
    trajectoriesByOutcome: Record<TrajectoryOutcome, number>;
    steps: NumericSummary;
    durationSeconds: NumericSummary;
    errorSignatures: {
      withoutSignature: number;
      distinct: number;
      recurringTrajectories: number;
    };
    shadow: {
      evaluatedTrajectories: number;
      captureRecommendations: {
        retain: number;
        review_low_signal: number;
      };
      completionStatuses: {
        supported: number;
        partial: number;
        unsupported: number;
        unknown: number;
      };
    };
    feedback: {
      confirmedPrinciples: number;
      rejectedSuggestions: number;
      rejectionBreakdown: {
        general: number;
        batchAssisted: number;
      };
      retrievals: number;
      adoptions: number;
      postAdoptionSuccesses: number;
    };
    batchDistillationAssistant: {
      state: SekbOperatorEvidenceState;
      suggestionCount: OperatorMetric;
      acceptedCount: OperatorMetric;
      rejectedCount: OperatorMetric;
      normalizedEditDistance: OperatorMetric;
      duplicateSuggestionRate: OperatorMetric;
      sourceAttributionCompleteness: OperatorMetric;
      inputTokens: OperatorMetric;
      outputTokens: OperatorMetric;
      totalCostUsd: OperatorMetric;
      fallbackCount: OperatorMetric;
      subsequentAdoption: OperatorMetric;
    };
    metricsUnavailable: Array<{
      metric:
        | "historical_suggestion_count"
        | "suggestion_edit_distance"
        | "historical_acceptance_rate"
        | "duplicate_principle_rate";
      reason: "not_persisted" | "not_evaluated";
    }>;
  };
};

export function buildSekbOperatorReport(
  store: KnowledgeStore,
  options: SekbOperatorReportOptions = {},
): SekbOperatorReport {
  const trajectories = store.query_trajectories({});
  const undistilled = trajectories.filter((trajectory) => !trajectory.distilled);
  const allPrinciples = store.query_principles({});
  const activePrinciples = allPrinciples.filter((principle) => principle.status === "active");
  const evidence = buildEvidence({
    trajectories,
    allPrinciples,
    activePrinciples,
    generalRejectionCount: store.list_distillation_rejections().length,
    batchEvents: store.list_batch_distillation_events(),
    now: options.now?.() ?? new Date(),
    shadowEvaluationEnabled: options.shadowEvaluationEnabled,
    batchDistillationAssistantEnabled: options.batchDistillationAssistantEnabled,
  });
  return {
    lineageSchema: RUNTIME_LINEAGE_SCHEMA,
    counts: {
      trajectories: trajectories.length,
      undistilledTrajectories: undistilled.length,
      activePrinciples: activePrinciples.length,
    },
    undistilled: undistilled.slice(0, options.undistilledLimit ?? 20).map((trajectory) => ({
      trajectory_id: trajectory.trajectory_id,
      created_at: trajectory.created_at,
      task_intent: trajectory.task_intent,
      task_type: trajectory.task_type,
      context_fingerprint: trajectory.context_fingerprint,
      outcome: trajectory.outcome,
      error_signature: trajectory.error_signature,
      ...(normalizeRuntimeLineage(trajectory.metadata.runtimeLineage)
        ? { lineage: normalizeRuntimeLineage(trajectory.metadata.runtimeLineage) }
        : {}),
    })),
    activePrinciples: activePrinciples.map((principle) => ({
      principle_id: principle.principle_id,
      title: principle.title,
      task_types: principle.task_types,
      context_tags: principle.context_tags,
      criticality: principle.criticality,
      retrieval_count: principle.retrieval_count,
      adoption_count: principle.adoption_count,
      source_trajectories: principle.source_trajectories,
      ...(normalizeRuntimeLineage(principle.metadata.runtimeLineage)
        ? { lineage: normalizeRuntimeLineage(principle.metadata.runtimeLineage) }
        : {}),
    })),
    indexPreview: store.get_index(),
    evidence,
  };
}

function buildEvidence(input: {
  trajectories: ReturnType<KnowledgeStore["query_trajectories"]>;
  allPrinciples: ReturnType<KnowledgeStore["query_principles"]>;
  activePrinciples: ReturnType<KnowledgeStore["query_principles"]>;
  generalRejectionCount: number;
  batchEvents: SekbBatchDistillationEvent[];
  now: Date;
  shadowEvaluationEnabled: boolean | undefined;
  batchDistillationAssistantEnabled: boolean | undefined;
}): SekbOperatorReport["evidence"] {
  const trajectoriesByOutcome: Record<TrajectoryOutcome, number> = {
    success: 0,
    partial: 0,
    failure: 0,
  };
  const ageDistribution = { underHour: 0, underDay: 0, underWeek: 0, older: 0, invalid: 0 };
  const errorSignatureCounts = new Map<string, number>();
  const stepCounts: number[] = [];
  const durations: number[] = [];
  const shadow = {
    evaluatedTrajectories: 0,
    captureRecommendations: { retain: 0, review_low_signal: 0 },
    completionStatuses: { supported: 0, partial: 0, unsupported: 0, unknown: 0 },
  };

  for (const trajectory of input.trajectories) {
    trajectoriesByOutcome[trajectory.outcome] += 1;
    stepCounts.push(trajectory.steps.length);
    durations.push(trajectory.cost.duration_seconds);
    addAge(ageDistribution, trajectory.created_at, input.now);
    if (trajectory.error_signature) {
      errorSignatureCounts.set(
        trajectory.error_signature,
        (errorSignatureCounts.get(trajectory.error_signature) ?? 0) + 1,
      );
    }
    const shadowMetadata = trajectory.metadata.sekbShadow;
    if (isSekbShadowMetadataV1(shadowMetadata)) {
      shadow.evaluatedTrajectories += 1;
      shadow.captureRecommendations[shadowMetadata.captureQuality.recommendation] += 1;
      shadow.completionStatuses[shadowMetadata.completionEvidence.status] += 1;
    }
  }

  const recurringTrajectories = [...errorSignatureCounts.values()]
    .filter((count) => count > 1)
    .reduce((sum, count) => sum + count, 0);
  return {
    state: evidenceState(
      input.shadowEvaluationEnabled,
      input.trajectories.length,
      shadow.evaluatedTrajectories,
    ),
    ageDistribution,
    trajectoriesByOutcome,
    steps: numericSummary(stepCounts),
    durationSeconds: numericSummary(durations),
    errorSignatures: {
      withoutSignature:
        input.trajectories.length -
        [...errorSignatureCounts.values()].reduce((sum, count) => sum + count, 0),
      distinct: errorSignatureCounts.size,
      recurringTrajectories,
    },
    shadow,
    feedback: (() => {
      const general = input.generalRejectionCount;
      const batchAssisted = input.batchEvents.reduce(
        (sum, event) => sum + event.rejection_count,
        0,
      );
      return {
        confirmedPrinciples: input.activePrinciples.filter(
          (principle) => principle.created_by === "human",
        ).length,
        rejectedSuggestions: general + batchAssisted,
        rejectionBreakdown: {
          general,
          batchAssisted,
        },
        retrievals: input.activePrinciples.reduce(
          (sum, principle) => sum + principle.retrieval_count,
          0,
        ),
        adoptions: input.activePrinciples.reduce(
          (sum, principle) => sum + principle.adoption_count,
          0,
        ),
        postAdoptionSuccesses: input.activePrinciples.reduce(
          (sum, principle) => sum + principle.post_adoption_success,
          0,
        ),
      };
    })(),
    batchDistillationAssistant: buildBatchDistillationEvidence({
      events: input.batchEvents,
      principles: input.allPrinciples,
      enabled: input.batchDistillationAssistantEnabled,
    }),
    metricsUnavailable: [
      { metric: "historical_suggestion_count", reason: "not_persisted" },
      { metric: "suggestion_edit_distance", reason: "not_persisted" },
      { metric: "historical_acceptance_rate", reason: "not_persisted" },
      { metric: "duplicate_principle_rate", reason: "not_evaluated" },
    ],
  };
}

function buildBatchDistillationEvidence(input: {
  events: SekbBatchDistillationEvent[];
  principles: ReturnType<KnowledgeStore["query_principles"]>;
  enabled: boolean | undefined;
}): SekbOperatorReport["evidence"]["batchDistillationAssistant"] {
  if (input.events.length === 0) {
    return unavailableBatchDistillationEvidence(batchEvidenceState(input.enabled, 0));
  }
  const suggestionCount = input.events.reduce((sum, event) => sum + event.suggestion_count, 0);
  const acceptedCount = input.events.reduce((sum, event) => sum + event.confirmation_count, 0);
  const rejectedCount = input.events.reduce((sum, event) => sum + event.rejection_count, 0);
  const editDistanceCount = input.events.reduce((sum, event) => sum + event.edit_distance_count, 0);
  const editDistanceSum = input.events.reduce((sum, event) => sum + event.edit_distance_sum, 0);
  const duplicateCount = input.events.reduce(
    (sum, event) => sum + event.duplicate_suggestion_count,
    0,
  );
  const attributedCount = input.events.reduce(
    (sum, event) => sum + event.attributed_suggestion_count,
    0,
  );
  const attributionTotal = input.events.reduce((sum, event) => sum + event.attribution_total, 0);
  const knownBatchIds = new Set(input.events.map((event) => event.batch_id));
  const subsequentAdoption = input.principles
    .filter((principle) => isConfirmedBatchPrinciple(principle, knownBatchIds))
    .reduce((sum, principle) => sum + principle.adoption_count, 0);

  return {
    state: batchEvidenceState(input.enabled, input.events.length),
    suggestionCount: available(suggestionCount),
    acceptedCount: available(acceptedCount),
    rejectedCount: available(rejectedCount),
    normalizedEditDistance:
      editDistanceCount > 0
        ? available(Number((editDistanceSum / editDistanceCount).toFixed(4)))
        : unavailable("original_suggestion_or_confirmed_version_unavailable"),
    duplicateSuggestionRate:
      suggestionCount > 0
        ? available(Number((duplicateCount / suggestionCount).toFixed(4)))
        : unavailable("no_suggestions"),
    sourceAttributionCompleteness:
      attributionTotal > 0
        ? available(Number((attributedCount / attributionTotal).toFixed(4)))
        : unavailable("no_suggestions"),
    inputTokens: sumReportedMetric(input.events, "input_tokens"),
    outputTokens: sumReportedMetric(input.events, "output_tokens"),
    totalCostUsd: sumReportedMetric(input.events, "total_cost_usd"),
    fallbackCount: available(input.events.filter((event) => event.status === "fallback").length),
    subsequentAdoption: available(subsequentAdoption),
  };
}

function unavailableBatchDistillationEvidence(
  state: SekbOperatorEvidenceState,
): SekbOperatorReport["evidence"]["batchDistillationAssistant"] {
  const metric = unavailable("no_batch_evidence");
  return {
    state,
    suggestionCount: metric,
    acceptedCount: metric,
    rejectedCount: metric,
    normalizedEditDistance: metric,
    duplicateSuggestionRate: metric,
    sourceAttributionCompleteness: metric,
    inputTokens: metric,
    outputTokens: metric,
    totalCostUsd: metric,
    fallbackCount: metric,
    subsequentAdoption: metric,
  };
}

function batchEvidenceState(
  enabled: boolean | undefined,
  eventCount: number,
): SekbOperatorEvidenceState {
  if (enabled === false) return "disabled";
  if (enabled === undefined) return "unknown";
  return eventCount > 0 ? "ready" : "insufficient_data";
}

function sumReportedMetric(
  events: SekbBatchDistillationEvent[],
  field: "input_tokens" | "output_tokens" | "total_cost_usd",
): OperatorMetric {
  const values = events
    .map((event) => event[field])
    .filter((value): value is number => typeof value === "number");
  return values.length > 0
    ? available(values.reduce((sum, value) => sum + value, 0))
    : unavailable("not_reported_by_provider");
}

function isConfirmedBatchPrinciple(principle: Principle, knownBatchIds: Set<string>): boolean {
  const provenance = principle.metadata.sekbBatchDistillationAssistant;
  return (
    typeof provenance === "object" &&
    provenance !== null &&
    !Array.isArray(provenance) &&
    typeof (provenance as Record<string, unknown>).batch_id === "string" &&
    knownBatchIds.has((provenance as Record<string, unknown>).batch_id as string)
  );
}

function available(value: number): OperatorMetric {
  return { status: "available", value };
}

function unavailable(reason: string): OperatorMetric {
  return { status: "unavailable", reason };
}

function evidenceState(
  shadowEvaluationEnabled: boolean | undefined,
  trajectoryCount: number,
  evaluatedTrajectoryCount: number,
): SekbOperatorEvidenceState {
  if (shadowEvaluationEnabled === false) {
    return "disabled";
  }
  if (shadowEvaluationEnabled === undefined) {
    return "unknown";
  }
  if (trajectoryCount === 0 || evaluatedTrajectoryCount === 0) {
    return "insufficient_data";
  }
  return "ready";
}

function addAge(
  distribution: SekbOperatorReport["evidence"]["ageDistribution"],
  createdAt: string,
  now: Date,
): void {
  const createdMs = Date.parse(createdAt);
  const ageMs = now.getTime() - createdMs;
  if (!Number.isFinite(createdMs) || ageMs < 0) {
    distribution.invalid += 1;
  } else if (ageMs < 60 * 60 * 1_000) {
    distribution.underHour += 1;
  } else if (ageMs < 24 * 60 * 60 * 1_000) {
    distribution.underDay += 1;
  } else if (ageMs < 7 * 24 * 60 * 60 * 1_000) {
    distribution.underWeek += 1;
  } else {
    distribution.older += 1;
  }
}

function numericSummary(values: number[]): NumericSummary {
  if (values.length === 0) {
    return { min: 0, max: 0, average: 0 };
  }
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
  };
}
