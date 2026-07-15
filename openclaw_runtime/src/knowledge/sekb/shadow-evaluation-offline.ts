import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  isSekbShadowMetadataV1,
  type SekbCaptureQualityShadowV1,
  type SekbCompletionEvidenceV1,
} from "./shadow-evaluator.js";
import type { Trajectory, TrajectoryOutcome } from "./types.js";

export const SEKB_SHADOW_EVALUATION_ARTIFACT_DIRECTORY = path.join(
  "artifacts",
  "sekb-hermes-phase-a5",
);
export const SEKB_SHADOW_EVALUATION_EXPORT_FILE = "shadow-evaluation-export.v1.json";
export const SEKB_SHADOW_EVALUATION_REPORT_FILE = "shadow-evaluation-report.v1.json";
export const SEKB_MINIMUM_REVIEWED_TRAJECTORIES = 200;
export const SEKB_MINIMUM_COHENS_KAPPA = 0.7;
export const SEKB_MINIMUM_VALUABLE_RECALL = 0.95;
export const SEKB_MAXIMUM_PROJECTED_FALSE_DROP_RATE = 0.02;

const SEKB_SHADOW_SCORE_RETAIN_THRESHOLD = 50;
const LABELS = ["valuable", "not_valuable", "uncertain"] as const;

export type SekbEvaluationLabel = (typeof LABELS)[number];
export type SekbReviewSplit = "development" | "holdout";
export type SekbToolActivity = "none" | "observed";
export type SekbShadowScoreBand = "unavailable" | "low" | "high";
export type SekbErrorRecurrenceBand = "none" | "recurring";

export type SekbShadowEvaluationExportRecord = {
  trajectoryId: string;
  terminalOutcome: TrajectoryOutcome;
  counts: {
    steps: number;
    toolCalls: number;
    toolResults: number;
    toolErrors: number;
    retries: number;
  };
  shadow: {
    score: number | null;
    factors: SekbCaptureQualityShadowV1["factors"] | null;
    completionStatus: SekbCompletionEvidenceV1["status"] | null;
  };
  error: {
    signaturePresent: boolean;
    recurrenceCount: number;
  };
};

export type SekbShadowEvaluationExportArtifact = {
  schema: "sekb-shadow-evaluation-export.v1";
  authority: "offline_evaluation_evidence_not_runtime_source_of_truth";
  records: SekbShadowEvaluationExportRecord[];
};

export type BuildSekbShadowEvaluationExportOptions = {
  trajectories: readonly Trajectory[];
  pseudonymizationKey: string;
};

export type WriteSekbShadowEvaluationExportOptions = BuildSekbShadowEvaluationExportOptions & {
  workspaceRoot?: string;
};

export type SekbShadowEvaluationStratum = {
  terminalOutcome: TrajectoryOutcome;
  toolActivity: SekbToolActivity;
  shadowScore: SekbShadowScoreBand;
  errorRecurrence: SekbErrorRecurrenceBand;
};

export type SekbShadowEvaluationReviewSample = {
  trajectoryId: string;
  split: SekbReviewSplit;
  stratum: SekbShadowEvaluationStratum;
};

export type SekbShadowEvaluationReviewProtocol = {
  schema: "sekb-shadow-evaluation-review-protocol.v1";
  labels: readonly SekbEvaluationLabel[];
  minimumIndependentReviewers: 2;
  holdoutPolicy: {
    assignment: "deterministic_stratified";
    developmentAndHoldoutAreSeparate: true;
    holdoutTuning: "forbidden";
  };
  sample: SekbShadowEvaluationReviewSample[];
  strata: Array<SekbShadowEvaluationStratum & { population: number; sampled: number }>;
};

export type CreateSekbShadowEvaluationReviewProtocolOptions = {
  sampleSize?: number;
  holdoutFraction?: number;
};

export type SekbShadowEvaluationReview = {
  trajectoryId: string;
  reviewerId: string;
  split: SekbReviewSplit;
  label: SekbEvaluationLabel;
};

export type SekbConfidenceInterval = {
  level: 0.95;
  lower: number;
  upper: number;
};

export type SekbEvaluationMetric =
  | {
      status: "available";
      numerator: number;
      denominator: number;
      rate: number;
      confidenceInterval: SekbConfidenceInterval;
    }
  | {
      status: "unavailable";
      reason: "no_consensus_labels" | "no_valuable_trajectories" | "missing_shadow_projection";
    };

export type SekbCohensKappa =
  | {
      status: "available";
      pairedTrajectories: number;
      observedAgreement: number;
      expectedAgreement: number;
      value: number;
    }
  | {
      status: "unavailable";
      pairedTrajectories: number;
      reason: "no_independent_review_pairs" | "expected_agreement_is_one";
    };

export type SekbEvaluationMetricsBySplit = {
  consensusLabels: number;
  uncertainConsensusLabels: number;
  missingShadowProjection: number;
  projectedRetained: number;
  projectedDropped: number;
  valuableTrajectoryRecall: SekbEvaluationMetric;
  projectedFalseDropRate: SekbEvaluationMetric;
};

export type SekbOfflineEvaluationReport = {
  schema: "sekb-shadow-evaluation-report.v1";
  authority: "offline_evaluation_evidence_not_runtime_source_of_truth";
  status: "evaluated" | "insufficient_data" | "reviewer_disagreement" | "unavailable_metrics";
  labeling: {
    annotations: number;
    independentlyReviewedTrajectories: number;
    consensusTrajectories: number;
    unresolvedDisagreements: number;
    invalidAnnotations: number;
    categoryDistribution: Record<SekbEvaluationLabel, number>;
    consensusCategoryDistribution: Record<SekbEvaluationLabel, number>;
  };
  agreement: SekbCohensKappa;
  projectionPolicy: {
    id: "sekb-shadow-v1-score-gte-50";
    scoreThreshold: 50;
    configuredOn: "development_only";
    holdoutWeightOrThresholdTuning: "forbidden";
  };
  development: SekbEvaluationMetricsBySplit;
  holdout: SekbEvaluationMetricsBySplit;
  unavailableMetrics: Array<{
    metric: "historical_suggestion_acceptance_rate" | "historical_suggestion_edit_distance";
    reason: "not_persisted";
  }>;
  promotion: {
    status: "evaluable_for_promotion" | "shadow_only";
    blockers: string[];
  };
};

export type BuildSekbOfflineEvaluationReportOptions = {
  artifact: SekbShadowEvaluationExportArtifact;
  protocol: SekbShadowEvaluationReviewProtocol;
  reviews: readonly SekbShadowEvaluationReview[];
  reviewers: readonly [string, string];
};

export type WriteSekbOfflineEvaluationReportOptions = {
  report: SekbOfflineEvaluationReport;
  workspaceRoot?: string;
};

export function buildSekbShadowEvaluationExport(
  options: BuildSekbShadowEvaluationExportOptions,
): SekbShadowEvaluationExportArtifact {
  const key = options.pseudonymizationKey.trim();
  if (!key) {
    throw new Error("SEKB shadow evaluation export requires a non-empty pseudonymization key.");
  }

  const signatureCounts = countErrorSignatures(options.trajectories);
  const records = options.trajectories
    .map((trajectory) => toExportRecord(trajectory, key, signatureCounts))
    .toSorted((left, right) => left.trajectoryId.localeCompare(right.trajectoryId));

  return {
    schema: "sekb-shadow-evaluation-export.v1",
    authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    records,
  };
}

export function writeSekbShadowEvaluationExportArtifact(
  options: WriteSekbShadowEvaluationExportOptions,
): { artifactPath: string; artifact: SekbShadowEvaluationExportArtifact } {
  const artifact = buildSekbShadowEvaluationExport(options);
  const artifactPath = controlledArtifactPath(options.workspaceRoot, SEKB_SHADOW_EVALUATION_EXPORT_FILE);
  writeJsonArtifact(artifactPath, artifact);
  return { artifactPath, artifact };
}

export function createSekbShadowEvaluationReviewProtocol(
  artifact: SekbShadowEvaluationExportArtifact,
  options: CreateSekbShadowEvaluationReviewProtocolOptions = {},
): SekbShadowEvaluationReviewProtocol {
  const sampleSize = normalizeSampleSize(options.sampleSize, artifact.records.length);
  const holdoutFraction = normalizeHoldoutFraction(options.holdoutFraction);
  const groups = new Map<string, { stratum: SekbShadowEvaluationStratum; records: SekbShadowEvaluationExportRecord[] }>();

  for (const record of artifact.records) {
    const stratum = recordStratum(record);
    const key = stratumKey(stratum);
    const group = groups.get(key) ?? { stratum, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }

  const groupEntries = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => ({
      key,
      stratum: group.stratum,
      records: group.records.toSorted((left, right) => left.trajectoryId.localeCompare(right.trajectoryId)),
    }));
  const selected = selectRoundRobin(groupEntries, sampleSize);
  const selectedByStratum = new Map<string, SekbShadowEvaluationExportRecord[]>();
  for (const item of selected) {
    const records = selectedByStratum.get(item.key) ?? [];
    records.push(item.record);
    selectedByStratum.set(item.key, records);
  }

  const sample: SekbShadowEvaluationReviewSample[] = [];
  for (const group of groupEntries) {
    const selectedRecords = (selectedByStratum.get(group.key) ?? [])
      .toSorted((left, right) => left.trajectoryId.localeCompare(right.trajectoryId));
    const holdoutCount = selectedRecords.length < 2
      ? 0
      : Math.max(1, Math.floor(selectedRecords.length * holdoutFraction));
    for (const [index, record] of selectedRecords.entries()) {
      sample.push({
        trajectoryId: record.trajectoryId,
        split: index < holdoutCount ? "holdout" : "development",
        stratum: group.stratum,
      });
    }
  }
  if (sample.length >= 2 && !sample.some((item) => item.split === "holdout")) {
    const fallbackHoldout = sample.toSorted((left, right) => left.trajectoryId.localeCompare(right.trajectoryId)).at(-1);
    if (fallbackHoldout) {
      fallbackHoldout.split = "holdout";
    }
  }

  return {
    schema: "sekb-shadow-evaluation-review-protocol.v1",
    labels: LABELS,
    minimumIndependentReviewers: 2,
    holdoutPolicy: {
      assignment: "deterministic_stratified",
      developmentAndHoldoutAreSeparate: true,
      holdoutTuning: "forbidden",
    },
    sample: sample.toSorted((left, right) => left.trajectoryId.localeCompare(right.trajectoryId)),
    strata: groupEntries.map((group) => ({
      ...group.stratum,
      population: group.records.length,
      sampled: selectedByStratum.get(group.key)?.length ?? 0,
    })),
  };
}

export function buildSekbOfflineEvaluationReport(
  options: BuildSekbOfflineEvaluationReportOptions,
): SekbOfflineEvaluationReport {
  const [firstReviewer, secondReviewer] = options.reviewers;
  if (!firstReviewer || !secondReviewer || firstReviewer === secondReviewer) {
    throw new Error("SEKB offline evaluation requires two distinct independent reviewers.");
  }

  const recordsById = new Map(options.artifact.records.map((record) => [record.trajectoryId, record]));
  const sampleById = new Map(options.protocol.sample.map((sample) => [sample.trajectoryId, sample]));
  const annotations = new Map<string, Map<string, SekbEvaluationLabel>>();
  const categoryDistribution = emptyLabelDistribution();
  let invalidAnnotations = 0;

  for (const review of options.reviews) {
    const sample = sampleById.get(review.trajectoryId);
    if (
      !sample ||
      !recordsById.has(review.trajectoryId) ||
      sample.split !== review.split ||
      !isSekbEvaluationLabel(review.label) ||
      (review.reviewerId !== firstReviewer && review.reviewerId !== secondReviewer)
    ) {
      invalidAnnotations += 1;
      continue;
    }
    const byReviewer = annotations.get(review.trajectoryId) ?? new Map<string, SekbEvaluationLabel>();
    if (byReviewer.has(review.reviewerId)) {
      invalidAnnotations += 1;
      continue;
    }
    byReviewer.set(review.reviewerId, review.label);
    annotations.set(review.trajectoryId, byReviewer);
    categoryDistribution[review.label] += 1;
  }

  const pairedLabels: Array<{ sample: SekbShadowEvaluationReviewSample; left: SekbEvaluationLabel; right: SekbEvaluationLabel }> = [];
  const consensus = new Map<string, SekbEvaluationLabel>();
  const consensusCategoryDistribution = emptyLabelDistribution();
  let unresolvedDisagreements = 0;
  for (const sample of options.protocol.sample) {
    const byReviewer = annotations.get(sample.trajectoryId);
    const left = byReviewer?.get(firstReviewer);
    const right = byReviewer?.get(secondReviewer);
    if (!left || !right) {
      continue;
    }
    pairedLabels.push({ sample, left, right });
    if (left !== right) {
      unresolvedDisagreements += 1;
      continue;
    }
    consensus.set(sample.trajectoryId, left);
    consensusCategoryDistribution[left] += 1;
  }

  const agreement = calculateCohensKappa(pairedLabels);
  const development = evaluateSplit("development", options.artifact.records, options.protocol, consensus);
  const holdout = evaluateSplit("holdout", options.artifact.records, options.protocol, consensus);
  const status = reportStatus({
    independentlyReviewed: pairedLabels.length,
    unresolvedDisagreements,
    agreement,
    holdout,
  });
  const blockers = promotionBlockers({
    independentlyReviewed: pairedLabels.length,
    unresolvedDisagreements,
    agreement,
    holdout,
  });

  return {
    schema: "sekb-shadow-evaluation-report.v1",
    authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    status,
    labeling: {
      annotations: Object.values(categoryDistribution).reduce((sum, count) => sum + count, 0),
      independentlyReviewedTrajectories: pairedLabels.length,
      consensusTrajectories: consensus.size,
      unresolvedDisagreements,
      invalidAnnotations,
      categoryDistribution,
      consensusCategoryDistribution,
    },
    agreement,
    projectionPolicy: {
      id: "sekb-shadow-v1-score-gte-50",
      scoreThreshold: SEKB_SHADOW_SCORE_RETAIN_THRESHOLD,
      configuredOn: "development_only",
      holdoutWeightOrThresholdTuning: "forbidden",
    },
    development,
    holdout,
    unavailableMetrics: [
      { metric: "historical_suggestion_acceptance_rate", reason: "not_persisted" },
      { metric: "historical_suggestion_edit_distance", reason: "not_persisted" },
    ],
    promotion: {
      status: blockers.length === 0 ? "evaluable_for_promotion" : "shadow_only",
      blockers,
    },
  };
}

export function writeSekbOfflineEvaluationReportArtifact(
  options: WriteSekbOfflineEvaluationReportOptions,
): { artifactPath: string; report: SekbOfflineEvaluationReport } {
  const artifactPath = controlledArtifactPath(options.workspaceRoot, SEKB_SHADOW_EVALUATION_REPORT_FILE);
  writeJsonArtifact(artifactPath, options.report);
  return { artifactPath, report: options.report };
}

function toExportRecord(
  trajectory: Trajectory,
  pseudonymizationKey: string,
  signatureCounts: ReadonlyMap<string, number>,
): SekbShadowEvaluationExportRecord {
  let toolCalls = 0;
  let toolResults = 0;
  let toolErrors = 0;
  for (const step of trajectory.steps) {
    if (step.action === "tool.call") {
      toolCalls += 1;
    }
    if (step.action === "tool.result") {
      toolResults += 1;
      if (isRecord(step.output) && step.output.isError === true) {
        toolErrors += 1;
      }
    }
  }
  const shadow = sanitizedShadowProjection(trajectory.metadata.sekbShadow);
  const errorSignature = trajectory.error_signature;

  return {
    trajectoryId: pseudonymousTrajectoryId(trajectory.trajectory_id, pseudonymizationKey),
    terminalOutcome: trajectory.outcome,
    counts: {
      steps: trajectory.steps.length,
      toolCalls,
      toolResults,
      toolErrors,
      retries: Math.max(0, Math.trunc(trajectory.cost.retries)),
    },
    shadow,
    error: {
      signaturePresent: Boolean(errorSignature),
      recurrenceCount: errorSignature ? Math.max(0, (signatureCounts.get(errorSignature) ?? 1) - 1) : 0,
    },
  };
}

function sanitizedShadowProjection(value: unknown): SekbShadowEvaluationExportRecord["shadow"] {
  if (!isSekbShadowMetadataV1(value)) {
    return { score: null, factors: null, completionStatus: null };
  }
  return {
    score: boundedNumber(value.captureQuality.score),
    factors: sanitizedShadowFactors(value.captureQuality.factors),
    completionStatus: isCompletionStatus(value.completionEvidence.status)
      ? value.completionEvidence.status
      : null,
  };
}

function sanitizedShadowFactors(value: unknown): SekbCaptureQualityShadowV1["factors"] | null {
  if (!isRecord(value)) {
    return null;
  }
  const terminalOutcome = boundedNumber(value.terminalOutcome);
  const toolEvidence = boundedNumber(value.toolEvidence);
  if (terminalOutcome === null || toolEvidence === null) {
    return null;
  }
  return {
    terminalOutcome,
    toolEvidence,
    errorResolutionEvidence: boundedNullableNumber(value.errorResolutionEvidence),
    recurrenceEvidence: boundedNullableNumber(value.recurrenceEvidence),
    validationEvidence: null,
    userConfirmationEvidence: null,
  };
}

function countErrorSignatures(trajectories: readonly Trajectory[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const trajectory of trajectories) {
    if (trajectory.error_signature) {
      counts.set(trajectory.error_signature, (counts.get(trajectory.error_signature) ?? 0) + 1);
    }
  }
  return counts;
}

function pseudonymousTrajectoryId(trajectoryId: string, key: string): string {
  return `trj_${createHmac("sha256", key).update(trajectoryId).digest("hex").slice(0, 32)}`;
}

function recordStratum(record: SekbShadowEvaluationExportRecord): SekbShadowEvaluationStratum {
  return {
    terminalOutcome: record.terminalOutcome,
    toolActivity: record.counts.toolCalls > 0 || record.counts.toolResults > 0 ? "observed" : "none",
    shadowScore: record.shadow.score === null ? "unavailable" : record.shadow.score >= SEKB_SHADOW_SCORE_RETAIN_THRESHOLD ? "high" : "low",
    errorRecurrence: record.error.recurrenceCount > 0 ? "recurring" : "none",
  };
}

function stratumKey(stratum: SekbShadowEvaluationStratum): string {
  return [stratum.terminalOutcome, stratum.toolActivity, stratum.shadowScore, stratum.errorRecurrence].join("|");
}

function selectRoundRobin(
  groups: Array<{ key: string; stratum: SekbShadowEvaluationStratum; records: SekbShadowEvaluationExportRecord[] }>,
  sampleSize: number,
): Array<{ key: string; record: SekbShadowEvaluationExportRecord }> {
  const remaining = groups.map((group) => ({ ...group, records: [...group.records] }));
  const selected: Array<{ key: string; record: SekbShadowEvaluationExportRecord }> = [];
  while (selected.length < sampleSize) {
    let selectedThisRound = false;
    for (const group of remaining) {
      const record = group.records.shift();
      if (!record) {
        continue;
      }
      selected.push({ key: group.key, record });
      selectedThisRound = true;
      if (selected.length === sampleSize) {
        break;
      }
    }
    if (!selectedThisRound) {
      break;
    }
  }
  return selected;
}

function evaluateSplit(
  split: SekbReviewSplit,
  records: readonly SekbShadowEvaluationExportRecord[],
  protocol: SekbShadowEvaluationReviewProtocol,
  consensus: ReadonlyMap<string, SekbEvaluationLabel>,
): SekbEvaluationMetricsBySplit {
  const recordsById = new Map(records.map((record) => [record.trajectoryId, record]));
  const reviewed = protocol.sample
    .filter((sample) => sample.split === split)
    .flatMap((sample) => {
      const label = consensus.get(sample.trajectoryId);
      const record = recordsById.get(sample.trajectoryId);
      return label && record ? [{ label, record }] : [];
    });
  const valuable = reviewed.filter((item) => item.label === "valuable");
  const missingShadowProjection = reviewed.filter((item) => item.record.shadow.score === null).length;
  const projectedRetained = reviewed.filter((item) => item.record.shadow.score !== null && item.record.shadow.score >= SEKB_SHADOW_SCORE_RETAIN_THRESHOLD).length;
  const projectedDropped = reviewed.filter((item) => item.record.shadow.score !== null && item.record.shadow.score < SEKB_SHADOW_SCORE_RETAIN_THRESHOLD).length;
  const valuableMissingProjection = valuable.some((item) => item.record.shadow.score === null);
  const metricUnavailableReason = reviewed.length === 0
    ? "no_consensus_labels"
    : valuable.length === 0
      ? "no_valuable_trajectories"
      : valuableMissingProjection
        ? "missing_shadow_projection"
        : null;
  const retainedValuable = valuable.filter((item) => item.record.shadow.score !== null && item.record.shadow.score >= SEKB_SHADOW_SCORE_RETAIN_THRESHOLD).length;
  const droppedValuable = valuable.length - retainedValuable;

  return {
    consensusLabels: reviewed.length,
    uncertainConsensusLabels: reviewed.filter((item) => item.label === "uncertain").length,
    missingShadowProjection,
    projectedRetained,
    projectedDropped,
    valuableTrajectoryRecall: metricUnavailableReason
      ? { status: "unavailable", reason: metricUnavailableReason }
      : availableMetric(retainedValuable, valuable.length),
    projectedFalseDropRate: metricUnavailableReason
      ? { status: "unavailable", reason: metricUnavailableReason }
      : availableMetric(droppedValuable, valuable.length),
  };
}

function calculateCohensKappa(
  pairedLabels: ReadonlyArray<{ left: SekbEvaluationLabel; right: SekbEvaluationLabel }>,
): SekbCohensKappa {
  if (pairedLabels.length === 0) {
    return { status: "unavailable", pairedTrajectories: 0, reason: "no_independent_review_pairs" };
  }
  const leftCounts = emptyLabelDistribution();
  const rightCounts = emptyLabelDistribution();
  let agreements = 0;
  for (const pair of pairedLabels) {
    leftCounts[pair.left] += 1;
    rightCounts[pair.right] += 1;
    if (pair.left === pair.right) {
      agreements += 1;
    }
  }
  const total = pairedLabels.length;
  const observedAgreement = agreements / total;
  const expectedAgreement = LABELS.reduce(
    (sum, label) => sum + (leftCounts[label] / total) * (rightCounts[label] / total),
    0,
  );
  if (expectedAgreement === 1) {
    return { status: "unavailable", pairedTrajectories: total, reason: "expected_agreement_is_one" };
  }
  return {
    status: "available",
    pairedTrajectories: total,
    observedAgreement: round(observedAgreement),
    expectedAgreement: round(expectedAgreement),
    value: round((observedAgreement - expectedAgreement) / (1 - expectedAgreement)),
  };
}

function availableMetric(numerator: number, denominator: number): SekbEvaluationMetric {
  return {
    status: "available",
    numerator,
    denominator,
    rate: round(numerator / denominator),
    confidenceInterval: wilsonInterval(numerator, denominator),
  };
}

function wilsonInterval(successes: number, total: number): SekbConfidenceInterval {
  const z = 1.96;
  const proportion = successes / total;
  const denominator = 1 + z ** 2 / total;
  const center = (proportion + z ** 2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) + z ** 2 / (4 * total)) / total) / denominator;
  return { level: 0.95, lower: round(Math.max(0, center - margin)), upper: round(Math.min(1, center + margin)) };
}

function reportStatus(input: {
  independentlyReviewed: number;
  unresolvedDisagreements: number;
  agreement: SekbCohensKappa;
  holdout: SekbEvaluationMetricsBySplit;
}): SekbOfflineEvaluationReport["status"] {
  if (input.unresolvedDisagreements > 0) {
    return "reviewer_disagreement";
  }
  if (input.independentlyReviewed < SEKB_MINIMUM_REVIEWED_TRAJECTORIES) {
    return "insufficient_data";
  }
  if (
    input.agreement.status === "unavailable" ||
    input.holdout.valuableTrajectoryRecall.status === "unavailable" ||
    input.holdout.projectedFalseDropRate.status === "unavailable"
  ) {
    return "unavailable_metrics";
  }
  return "evaluated";
}

function promotionBlockers(input: {
  independentlyReviewed: number;
  unresolvedDisagreements: number;
  agreement: SekbCohensKappa;
  holdout: SekbEvaluationMetricsBySplit;
}): string[] {
  const blockers: string[] = [];
  if (input.independentlyReviewed < SEKB_MINIMUM_REVIEWED_TRAJECTORIES) {
    blockers.push(`reviewed_samples_below_${SEKB_MINIMUM_REVIEWED_TRAJECTORIES}`);
  }
  if (input.unresolvedDisagreements > 0) {
    blockers.push("unresolved_reviewer_disagreement");
  }
  if (input.agreement.status === "unavailable") {
    blockers.push(`cohens_kappa_${input.agreement.reason}`);
  } else if (input.agreement.value < SEKB_MINIMUM_COHENS_KAPPA) {
    blockers.push("cohens_kappa_below_0_70");
  }
  addMetricBlocker(
    blockers,
    input.holdout.valuableTrajectoryRecall,
    SEKB_MINIMUM_VALUABLE_RECALL,
    "valuable_recall",
    (rate, threshold) => rate < threshold,
  );
  addMetricBlocker(
    blockers,
    input.holdout.projectedFalseDropRate,
    SEKB_MAXIMUM_PROJECTED_FALSE_DROP_RATE,
    "projected_false_drop",
    (rate, threshold) => rate > threshold,
  );
  return blockers;
}

function addMetricBlocker(
  blockers: string[],
  metric: SekbEvaluationMetric,
  threshold: number,
  name: string,
  fails: (rate: number, threshold: number) => boolean,
): void {
  if (metric.status === "unavailable") {
    blockers.push(`${name}_${metric.reason}`);
  } else if (fails(metric.rate, threshold)) {
    blockers.push(`${name}_outside_gate`);
  }
}

function controlledArtifactPath(workspaceRoot: string | undefined, fileName: string): string {
  const root = path.resolve(workspaceRoot ?? process.cwd());
  const target = path.resolve(root, SEKB_SHADOW_EVALUATION_ARTIFACT_DIRECTORY, fileName);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("SEKB shadow evaluation artifact path escapes the workspace root.");
  }
  return target;
}

function writeJsonArtifact(artifactPath: string, value: unknown): void {
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeSampleSize(value: number | undefined, population: number): number {
  if (value === undefined) {
    return population;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("SEKB review sample size must be a non-negative finite number.");
  }
  return Math.min(population, Math.floor(value));
}

function normalizeHoldoutFraction(value: number | undefined): number {
  const fraction = value ?? 0.2;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) {
    throw new Error("SEKB review holdout fraction must be between zero and one.");
  }
  return fraction;
}

function emptyLabelDistribution(): Record<SekbEvaluationLabel, number> {
  return { valuable: 0, not_valuable: 0, uncertain: 0 };
}

function isSekbEvaluationLabel(value: unknown): value is SekbEvaluationLabel {
  return typeof value === "string" && (LABELS as readonly string[]).includes(value);
}

function isCompletionStatus(value: unknown): value is SekbCompletionEvidenceV1["status"] {
  return value === "supported" || value === "partial" || value === "unsupported" || value === "unknown";
}

function boundedNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(100, Math.max(0, value));
}

function boundedNullableNumber(value: unknown): number | null {
  return value === null ? null : boundedNumber(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
