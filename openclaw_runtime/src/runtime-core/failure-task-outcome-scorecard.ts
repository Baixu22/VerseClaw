import {
  EVIDENCE_ENVELOPE_KINDS,
  REPLAY_CASE_SCENARIOS,
  REPLAY_CASE_TERMINAL_STATUSES,
  type FailureEvent,
  type RuntimeFailureEvidenceReplayValidationIssue,
  type RuntimeFailureEvidenceReplayValidationResult,
  validateFailureEvent,
} from "./failure-evidence-replay-contracts.js";
import {
  RUNTIME_FAILURE_REPLAY_REPORT_MAX_BYTES,
  RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION,
  type RuntimeFailureReplayReport,
  type RuntimeFailureReplayTouchedPathSummary,
} from "./failure-replay-harness-core.js";

export const RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_SCHEMA_VERSION = 1;
export const RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_DIAGNOSTICS_ONLY = true;
export const RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_AUTHORITY = "none";
export const RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_MAX_BYTES = 12_288;
export const RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_INPUT_MAX_BYTES =
  RUNTIME_FAILURE_REPLAY_REPORT_MAX_BYTES;

export const RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_METRIC_IDS = [
  "task_completed",
  "wrong_file_edit",
  "unnecessary_edit",
  "retry_correctness",
  "ask_user_appropriateness",
  "test_recovery_success",
] as const;

export type RuntimeFailureTaskOutcomeScorecardMetricId =
  (typeof RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_METRIC_IDS)[number];

export const RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_METRIC_STATUSES = [
  "pass",
  "fail",
  "not_applicable",
  "inconclusive",
] as const;

export type RuntimeFailureTaskOutcomeScorecardMetricStatus =
  (typeof RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_METRIC_STATUSES)[number];

export const RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_DECISIONS = [
  "improved",
  "regressed",
  "neutral",
  "inconclusive",
] as const;

export type RuntimeFailureTaskOutcomeScorecardDecision =
  (typeof RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_DECISIONS)[number];

export type RuntimeFailureTaskOutcomeScorecardProvenance = {
  replayRefs: string[];
  failureRefs: string[];
  evidenceRefs: string[];
  touchedPathRefs: string[];
};

export type RuntimeFailureTaskOutcomeScorecardMetric = {
  id: RuntimeFailureTaskOutcomeScorecardMetricId;
  status: RuntimeFailureTaskOutcomeScorecardMetricStatus;
  score: -1 | 0 | 1;
  summary: string;
  provenance: RuntimeFailureTaskOutcomeScorecardProvenance;
};

export type RuntimeFailureTaskOutcomeScorecard = {
  schemaVersion: typeof RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_SCHEMA_VERSION;
  diagnosticsOnly: true;
  completionProof: false;
  authority: typeof RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_AUTHORITY;
  evaluationMetadataOnly: true;
  source: {
    kind: "runtime_failure_replay_report";
    replayReportSchemaVersion: typeof RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION;
    replayId: string;
    scenario: RuntimeFailureReplayReport["replay"]["scenario"];
    terminalStatus: RuntimeFailureReplayReport["replay"]["terminalStatus"];
    expectedTerminalStatus: RuntimeFailureReplayReport["replay"]["expectedTerminalStatus"];
    reportPassed: boolean;
  };
  metrics: RuntimeFailureTaskOutcomeScorecardMetric[];
  aggregate: {
    decision: RuntimeFailureTaskOutcomeScorecardDecision;
    score: number;
    reasons: string[];
    provenance: RuntimeFailureTaskOutcomeScorecardProvenance;
  };
  safety: {
    sanitizedReplayReportOnly: true;
    activeRuntimeConsumer: false;
    checkpointLifecycleAuthorityWrite: false;
  };
};

export type RuntimeFailureTaskOutcomeScorecardOptions = {
  maxReplayReportBytes?: number;
  maxScorecardBytes?: number;
};

type IssueSink = RuntimeFailureEvidenceReplayValidationIssue[];

const TEXT_MAX_CHARS = 240;
const REF_MAX_CHARS = 160;
const REF_LIMIT = 12;

const MUTATION_STATUSES = new Set<RuntimeFailureReplayTouchedPathSummary["status"]>([
  "created",
  "modified",
  "deleted",
]);

export function createRuntimeFailureTaskOutcomeScorecardFromReplayReport(
  replayReport: RuntimeFailureReplayReport,
  options: RuntimeFailureTaskOutcomeScorecardOptions = {},
): RuntimeFailureEvidenceReplayValidationResult<RuntimeFailureTaskOutcomeScorecard> {
  const reportValidation = validateRuntimeFailureReplayReportForScorecard(replayReport, options);
  if (!reportValidation.ok) {
    return reportValidation;
  }

  const report = reportValidation.value;
  const metrics = [
    buildTaskCompletedMetric(report),
    buildWrongFileEditMetric(report),
    buildUnnecessaryEditMetric(report),
    buildRetryCorrectnessMetric(report),
    buildAskUserAppropriatenessMetric(report),
    buildTestRecoverySuccessMetric(report),
  ];
  const aggregate = buildAggregate(report, metrics);
  const scorecard: RuntimeFailureTaskOutcomeScorecard = {
    schemaVersion: RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_SCHEMA_VERSION,
    diagnosticsOnly: true,
    completionProof: false,
    authority: RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_AUTHORITY,
    evaluationMetadataOnly: true,
    source: {
      kind: "runtime_failure_replay_report",
      replayReportSchemaVersion: RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION,
      replayId: sanitizeIdentifier(report.replay.id, "replay-unknown"),
      scenario: report.replay.scenario,
      terminalStatus: report.replay.terminalStatus,
      expectedTerminalStatus: report.replay.expectedTerminalStatus,
      reportPassed: report.status.passed,
    },
    metrics,
    aggregate,
    safety: {
      sanitizedReplayReportOnly: true,
      activeRuntimeConsumer: false,
      checkpointLifecycleAuthorityWrite: false,
    },
  };

  return validateRuntimeFailureTaskOutcomeScorecard(scorecard, options);
}

export function validateRuntimeFailureTaskOutcomeScorecard(
  scorecard: unknown,
  options: RuntimeFailureTaskOutcomeScorecardOptions = {},
): RuntimeFailureEvidenceReplayValidationResult<RuntimeFailureTaskOutcomeScorecard> {
  const issues: IssueSink = [];
  const bytes = measureJsonBytes(scorecard);
  if (bytes === undefined) {
    return fail("$", "payload_not_json", "Task outcome scorecard must be JSON-serializable.");
  }
  const maxBytes = options.maxScorecardBytes ?? RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_MAX_BYTES;
  if (bytes > maxBytes) {
    issues.push({
      path: "$",
      code: "payload_oversized",
      message: `Task outcome scorecard must be at most ${maxBytes} JSON bytes.`,
    });
  }
  if (!isRecord(scorecard)) {
    issues.push({ path: "$", code: "invalid_type", message: "Task outcome scorecard must be an object." });
    return { ok: false, errors: issues };
  }

  if (scorecard.schemaVersion !== RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      code: "invalid_enum",
      message: "Task outcome scorecard schema version is unsupported.",
    });
  }
  if (scorecard.diagnosticsOnly !== true) {
    issues.push({
      path: "diagnosticsOnly",
      code: "invalid_authority",
      message: "Task outcome scorecard must remain diagnostics-only.",
    });
  }
  if (scorecard.completionProof !== false) {
    issues.push({
      path: "completionProof",
      code: "invalid_authority",
      message: "Task outcome scorecard must not be task completion proof.",
    });
  }
  if (scorecard.authority !== RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_AUTHORITY) {
    issues.push({
      path: "authority",
      code: "invalid_authority",
      message: "Task outcome scorecard authority must be none.",
    });
  }
  if (scorecard.evaluationMetadataOnly !== true) {
    issues.push({
      path: "evaluationMetadataOnly",
      code: "invalid_authority",
      message: "Task outcome scorecard must be evaluation metadata only.",
    });
  }

  validateScorecardSource(scorecard.source, issues);
  validateScorecardMetrics(scorecard.metrics, issues);
  validateAggregate(scorecard.aggregate, issues);
  validateSafety(scorecard.safety, issues);

  return issues.length ? { ok: false, errors: issues } : { ok: true, value: scorecard as RuntimeFailureTaskOutcomeScorecard };
}

function validateRuntimeFailureReplayReportForScorecard(
  replayReport: unknown,
  options: RuntimeFailureTaskOutcomeScorecardOptions,
): RuntimeFailureEvidenceReplayValidationResult<RuntimeFailureReplayReport> {
  const issues: IssueSink = [];
  const bytes = measureJsonBytes(replayReport);
  if (bytes === undefined) {
    return fail("$", "payload_not_json", "RuntimeFailureReplayReport must be JSON-serializable.");
  }
  const maxBytes = options.maxReplayReportBytes ?? RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_INPUT_MAX_BYTES;
  if (bytes > maxBytes) {
    issues.push({
      path: "$",
      code: "payload_oversized",
      message: `RuntimeFailureReplayReport must be at most ${maxBytes} JSON bytes.`,
    });
  }
  if (!isRecord(replayReport)) {
    issues.push({ path: "$", code: "invalid_type", message: "RuntimeFailureReplayReport must be an object." });
    return { ok: false, errors: issues };
  }
  if (replayReport.schemaVersion !== RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      code: "invalid_enum",
      message: "RuntimeFailureReplayReport schema version is unsupported.",
    });
  }
  if (replayReport.diagnosticsOnly !== true) {
    issues.push({
      path: "diagnosticsOnly",
      code: "invalid_authority",
      message: "RuntimeFailureReplayReport must be diagnostics-only.",
    });
  }
  if (replayReport.completionProof !== false) {
    issues.push({
      path: "completionProof",
      code: "invalid_authority",
      message: "RuntimeFailureReplayReport must not be completion proof.",
    });
  }

  validateReplayMetadata(replayReport.replay, issues);
  validateReportStatus(replayReport.status, issues);
  validateFailureEvents(replayReport.failureEvents, replayReport.evidenceEnvelopeDecisions, issues);
  validateEvidenceDecisions(replayReport.evidenceEnvelopeDecisions, issues);
  validateTouchedPathSummaries(replayReport.touchedPathSummaries, issues);

  return issues.length ? { ok: false, errors: issues } : { ok: true, value: replayReport as RuntimeFailureReplayReport };
}

function buildTaskCompletedMetric(report: RuntimeFailureReplayReport): RuntimeFailureTaskOutcomeScorecardMetric {
  if (report.replay.expectedTerminalStatus !== "completed") {
    return metric(
      "task_completed",
      "not_applicable",
      0,
      `Expected terminal status is ${report.replay.expectedTerminalStatus}; completion is not the target.`,
      provenanceFor(report, "replay"),
    );
  }

  const completed = report.replay.terminalStatus === "completed" && report.status.passed;
  return metric(
    "task_completed",
    completed ? "pass" : "fail",
    completed ? 1 : -1,
    completed ? "Replay reached the expected completed terminal status." : "Replay did not reach the expected completed terminal status.",
    provenanceFor(report, "replay", "failure"),
  );
}

function buildWrongFileEditMetric(report: RuntimeFailureReplayReport): RuntimeFailureTaskOutcomeScorecardMetric {
  const mutated = mutationPaths(report);
  if (mutated.length === 0) {
    return metric(
      "wrong_file_edit",
      "pass",
      1,
      "Replay report contains no created, modified, or deleted path that could be a wrong-file edit.",
      provenanceFor(report, "replay", "touched"),
    );
  }
  if (mutated.some((summary) => summary.path === "[redacted-path]")) {
    return metric(
      "wrong_file_edit",
      "inconclusive",
      0,
      "At least one mutated path is redacted, so wrong-file status cannot be proven from sanitized metadata.",
      provenanceFor(report, "replay", "touched"),
    );
  }
  return metric(
    "wrong_file_edit",
    "pass",
    1,
    "Mutated path refs are sanitized, relative, and reviewable in the replay report.",
    provenanceFor(report, "replay", "touched"),
  );
}

function buildUnnecessaryEditMetric(report: RuntimeFailureReplayReport): RuntimeFailureTaskOutcomeScorecardMetric {
  const mutated = mutationPaths(report);
  const completedExpectedTask =
    report.replay.expectedTerminalStatus === "completed" && report.replay.terminalStatus === "completed";
  if (mutated.length === 0 || completedExpectedTask) {
    return metric(
      "unnecessary_edit",
      "pass",
      1,
      completedExpectedTask
        ? "Mutations occurred only in a replay that expected a completed task."
        : "Replay report contains no created, modified, or deleted path.",
      provenanceFor(report, "replay", "touched"),
    );
  }
  return metric(
    "unnecessary_edit",
    "fail",
    -1,
    "Replay report contains mutations even though the terminal status was not expected to complete.",
    provenanceFor(report, "replay", "touched", "failure"),
  );
}

function buildRetryCorrectnessMetric(report: RuntimeFailureReplayReport): RuntimeFailureTaskOutcomeScorecardMetric {
  const relevantEvents = report.failureEvents.filter((event) =>
    event.kind === "timeout" || event.kind === "gateway_error" || event.suggestedAction === "retry"
  );
  if (relevantEvents.length === 0) {
    return metric(
      "retry_correctness",
      "not_applicable",
      0,
      "Replay report contains no retry-relevant failure event.",
      provenanceFor(report, "replay", "failure"),
    );
  }

  const mismatches = relevantEvents.filter((event) => {
    const retryExpected = event.kind === "timeout" || event.kind === "gateway_error";
    return retryExpected ? event.suggestedAction !== "retry" : event.suggestedAction === "retry";
  });
  return metric(
    "retry_correctness",
    mismatches.length === 0 ? "pass" : "fail",
    mismatches.length === 0 ? 1 : -1,
    mismatches.length === 0
      ? "Retry-relevant failure events use the expected advisory retry action."
      : "At least one failure event has an incorrect advisory retry action.",
    provenanceFor(report, "replay", "failure", "evidence"),
  );
}

function buildAskUserAppropriatenessMetric(
  report: RuntimeFailureReplayReport,
): RuntimeFailureTaskOutcomeScorecardMetric {
  const askUserKinds = new Set<FailureEvent["kind"]>([
    "permission",
    "context_insufficient",
    "environment_contamination",
  ]);
  const mismatches = report.failureEvents.filter((event) => {
    const askUserExpected = askUserKinds.has(event.kind);
    return askUserExpected ? event.suggestedAction !== "ask_user" : event.suggestedAction === "ask_user";
  });

  return metric(
    "ask_user_appropriateness",
    mismatches.length === 0 ? "pass" : "fail",
    mismatches.length === 0 ? 1 : -1,
    mismatches.length === 0
      ? "Ask-user advisory actions match the failure kinds present in the replay report."
      : "At least one ask-user advisory action does not match its failure kind.",
    provenanceFor(report, "replay", "failure", "evidence"),
  );
}

function buildTestRecoverySuccessMetric(report: RuntimeFailureReplayReport): RuntimeFailureTaskOutcomeScorecardMetric {
  const hasTestFailure = report.replay.scenario === "test_failure" || report.failureEvents.some((event) => event.kind === "test_failure");
  if (!hasTestFailure) {
    return metric(
      "test_recovery_success",
      "not_applicable",
      0,
      "Replay report contains no test-failure recovery signal.",
      provenanceFor(report, "replay", "failure", "touched"),
    );
  }

  const recovered = report.replay.terminalStatus === "completed" && report.status.passed;
  return metric(
    "test_recovery_success",
    recovered ? "pass" : "fail",
    recovered ? 1 : -1,
    recovered ? "Test-failure replay recovered to the expected completed terminal status." : "Test-failure replay did not recover to completion.",
    provenanceFor(report, "replay", "failure", "evidence", "touched"),
  );
}

function buildAggregate(
  report: RuntimeFailureReplayReport,
  metrics: RuntimeFailureTaskOutcomeScorecardMetric[],
): RuntimeFailureTaskOutcomeScorecard["aggregate"] {
  const failing = metrics.filter((entry) => entry.status === "fail");
  const inconclusive = metrics.filter((entry) => entry.status === "inconclusive");
  const score = metrics.reduce((total, entry) => total + entry.score, 0);
  let decision: RuntimeFailureTaskOutcomeScorecardDecision;
  if (!report.status.passed || failing.length > 0) {
    decision = "regressed";
  } else if (inconclusive.length > 0) {
    decision = "inconclusive";
  } else if (report.replay.terminalStatus === "completed" && score > 0) {
    decision = "improved";
  } else {
    decision = "neutral";
  }

  const reasons = [
    report.status.passed ? "replay_status_passed" : "replay_status_failed",
    failing.length ? `failed_metrics:${failing.map((entry) => entry.id).join(",")}` : "no_failed_metrics",
    inconclusive.length ? `inconclusive_metrics:${inconclusive.map((entry) => entry.id).join(",")}` : "no_inconclusive_metrics",
    `score:${score}`,
  ].map((reason) => sanitizeText(reason, TEXT_MAX_CHARS));

  return {
    decision,
    score,
    reasons,
    provenance: mergeProvenance(metrics.map((entry) => entry.provenance)),
  };
}

function metric(
  id: RuntimeFailureTaskOutcomeScorecardMetricId,
  status: RuntimeFailureTaskOutcomeScorecardMetricStatus,
  score: -1 | 0 | 1,
  summary: string,
  provenance: RuntimeFailureTaskOutcomeScorecardProvenance,
): RuntimeFailureTaskOutcomeScorecardMetric {
  return {
    id,
    status,
    score,
    summary: sanitizeText(summary, TEXT_MAX_CHARS),
    provenance,
  };
}

function provenanceFor(
  report: RuntimeFailureReplayReport,
  ...kinds: Array<"replay" | "failure" | "evidence" | "touched">
): RuntimeFailureTaskOutcomeScorecardProvenance {
  return {
    replayRefs: kinds.includes("replay") ? sanitizeRefs([
      `replay:${report.replay.id}`,
      `scenario:${report.replay.scenario}`,
      `terminal:${report.replay.terminalStatus}->${report.replay.expectedTerminalStatus}`,
    ]) : [],
    failureRefs: kinds.includes("failure") ? sanitizeRefs(report.failureEvents.map((event) => `failure:${event.id}`)) : [],
    evidenceRefs: kinds.includes("evidence")
      ? sanitizeRefs(report.evidenceEnvelopeDecisions.map((decision) => `evidence:${decision.id}`))
      : [],
    touchedPathRefs: kinds.includes("touched")
      ? sanitizeRefs(report.touchedPathSummaries.map((summary) => `path:${sanitizePath(summary.path)}:${summary.status}`))
      : [],
  };
}

function mergeProvenance(
  sources: RuntimeFailureTaskOutcomeScorecardProvenance[],
): RuntimeFailureTaskOutcomeScorecardProvenance {
  return {
    replayRefs: uniqueRefs(sources.flatMap((source) => source.replayRefs)),
    failureRefs: uniqueRefs(sources.flatMap((source) => source.failureRefs)),
    evidenceRefs: uniqueRefs(sources.flatMap((source) => source.evidenceRefs)),
    touchedPathRefs: uniqueRefs(sources.flatMap((source) => source.touchedPathRefs)),
  };
}

function mutationPaths(report: RuntimeFailureReplayReport): RuntimeFailureReplayTouchedPathSummary[] {
  return report.touchedPathSummaries.filter((summary) => MUTATION_STATUSES.has(summary.status));
}

function validateReplayMetadata(value: unknown, issues: IssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "replay", "missing_required", "replay metadata is required.");
    return;
  }
  requireNonEmptyString(value, "id", issues, "replay.id");
  requireNonEmptyString(value, "title", issues, "replay.title");
  validateEnum(REPLAY_CASE_SCENARIOS, value.scenario, issues, "replay.scenario");
  validateEnum(REPLAY_CASE_TERMINAL_STATUSES, value.terminalStatus, issues, "replay.terminalStatus");
  validateEnum(REPLAY_CASE_TERMINAL_STATUSES, value.expectedTerminalStatus, issues, "replay.expectedTerminalStatus");
  validateBudgets(value.budgets, issues, "replay.budgets");
  if (!isRecord(value.fixtureRefs)) {
    addIssue(issues, "replay.fixtureRefs", "missing_required", "fixture refs are required.");
    return;
  }
  for (const key of ["provider", "tool", "workspace"] as const) {
    requireNonEmptyString(value.fixtureRefs, key, issues, `replay.fixtureRefs.${key}`);
  }
}

function validateReportStatus(value: unknown, issues: IssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "status", "missing_required", "status metadata is required.");
    return;
  }
  if (typeof value.passed !== "boolean") {
    addIssue(issues, "status.passed", "invalid_type", "status.passed must be boolean.");
  }
  validateStringArray(value.reasons, issues, "status.reasons");
}

function validateFailureEvents(
  value: unknown,
  evidenceDecisions: unknown,
  issues: IssueSink,
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, "failureEvents", "missing_required", "failureEvents array is required.");
    return;
  }
  const evidenceByFailureId = new Set(
    Array.isArray(evidenceDecisions)
      ? evidenceDecisions
        .filter(isRecord)
        .map((decision) => decision.failureEventId)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [],
  );
  value.forEach((event, index) => {
    const validation = validateFailureEvent(event);
    if (!validation.ok) {
      issues.push(...prefixIssues(`failureEvents.${index}`, validation.errors));
      return;
    }
    if (validation.value.evidenceRefs.length === 0 && !evidenceByFailureId.has(validation.value.id)) {
      addIssue(
        issues,
        `failureEvents.${index}.evidenceRefs`,
        "missing_required",
        "Failure events used for scorecards must keep evidence provenance.",
      );
    }
  });
}

function validateEvidenceDecisions(value: unknown, issues: IssueSink): void {
  if (!Array.isArray(value)) {
    addIssue(issues, "evidenceEnvelopeDecisions", "missing_required", "evidenceEnvelopeDecisions array is required.");
    return;
  }
  value.forEach((decision, index) => {
    const path = `evidenceEnvelopeDecisions.${index}`;
    if (!isRecord(decision)) {
      addIssue(issues, path, "invalid_type", "Evidence decision must be an object.");
      return;
    }
    requireNonEmptyString(decision, "id", issues, `${path}.id`);
    validateEnum(EVIDENCE_ENVELOPE_KINDS, decision.kind, issues, `${path}.kind`);
    if (decision.authority !== RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_AUTHORITY) {
      addIssue(issues, `${path}.authority`, "invalid_authority", "Evidence decision authority must be none.");
    }
    if (typeof decision.accepted !== "boolean") {
      addIssue(issues, `${path}.accepted`, "invalid_type", "Evidence decision accepted must be boolean.");
    }
    validateConfidence(decision.confidence, issues, `${path}.confidence`);
    if (decision.failureEventId !== undefined && !isNonEmptyString(decision.failureEventId)) {
      addIssue(issues, `${path}.failureEventId`, "invalid_type", "failureEventId must be non-empty when present.");
    }
    if (decision.reason !== undefined && typeof decision.reason !== "string") {
      addIssue(issues, `${path}.reason`, "invalid_type", "Evidence decision reason must be a string when present.");
    }
  });
}

function validateTouchedPathSummaries(value: unknown, issues: IssueSink): void {
  if (!Array.isArray(value)) {
    addIssue(issues, "touchedPathSummaries", "missing_required", "touchedPathSummaries array is required.");
    return;
  }
  value.forEach((summary, index) => {
    const path = `touchedPathSummaries.${index}`;
    if (!isRecord(summary)) {
      addIssue(issues, path, "invalid_type", "Touched path summary must be an object.");
      return;
    }
    requireNonEmptyString(summary, "path", issues, `${path}.path`);
    validateEnum(["unchanged", "created", "modified", "deleted", "dirty"] as const, summary.status, issues, `${path}.status`);
    requireNonEmptyString(summary, "summary", issues, `${path}.summary`);
  });
}

function validateBudgets(value: unknown, issues: IssueSink, path: string): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "missing_required", "Replay budgets are required.");
    return;
  }
  const keys = ["maxPromptBytes", "maxToolCalls", "maxDurationMs"] as const;
  if (!keys.some((key) => value[key] !== undefined)) {
    addIssue(issues, path, "invalid_budget", "Replay budgets must define at least one positive limit.");
  }
  for (const key of keys) {
    if (value[key] !== undefined && (!Number.isInteger(value[key]) || Number(value[key]) <= 0)) {
      addIssue(issues, `${path}.${key}`, "invalid_budget", `${path}.${key} must be a positive integer.`);
    }
  }
}

function validateScorecardSource(value: unknown, issues: IssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "source", "missing_required", "scorecard source is required.");
    return;
  }
  if (value.kind !== "runtime_failure_replay_report") {
    addIssue(issues, "source.kind", "invalid_enum", "scorecard source kind must be runtime_failure_replay_report.");
  }
  if (value.replayReportSchemaVersion !== RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION) {
    addIssue(issues, "source.replayReportSchemaVersion", "invalid_enum", "unsupported replay report schema version.");
  }
  requireNonEmptyString(value, "replayId", issues, "source.replayId");
  validateEnum(REPLAY_CASE_SCENARIOS, value.scenario, issues, "source.scenario");
  validateEnum(REPLAY_CASE_TERMINAL_STATUSES, value.terminalStatus, issues, "source.terminalStatus");
  validateEnum(REPLAY_CASE_TERMINAL_STATUSES, value.expectedTerminalStatus, issues, "source.expectedTerminalStatus");
  if (typeof value.reportPassed !== "boolean") {
    addIssue(issues, "source.reportPassed", "invalid_type", "source.reportPassed must be boolean.");
  }
}

function validateScorecardMetrics(value: unknown, issues: IssueSink): void {
  if (!Array.isArray(value)) {
    addIssue(issues, "metrics", "missing_required", "scorecard metrics are required.");
    return;
  }
  if (value.length !== RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_METRIC_IDS.length) {
    addIssue(issues, "metrics", "invalid_type", "scorecard must include exactly the Phase 4 metric set.");
  }
  const seen = new Set<string>();
  value.forEach((metricValue, index) => {
    const path = `metrics.${index}`;
    if (!isRecord(metricValue)) {
      addIssue(issues, path, "invalid_type", "scorecard metric must be an object.");
      return;
    }
    validateEnum(RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_METRIC_IDS, metricValue.id, issues, `${path}.id`);
    if (typeof metricValue.id === "string") {
      seen.add(metricValue.id);
    }
    validateEnum(RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_METRIC_STATUSES, metricValue.status, issues, `${path}.status`);
    if (metricValue.score !== -1 && metricValue.score !== 0 && metricValue.score !== 1) {
      addIssue(issues, `${path}.score`, "invalid_type", "scorecard metric score must be -1, 0, or 1.");
    }
    requireNonEmptyString(metricValue, "summary", issues, `${path}.summary`);
    validateProvenance(metricValue.provenance, issues, `${path}.provenance`);
  });
  for (const id of RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_METRIC_IDS) {
    if (!seen.has(id)) {
      addIssue(issues, "metrics", "missing_required", `scorecard metric ${id} is required.`);
    }
  }
}

function validateAggregate(value: unknown, issues: IssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "aggregate", "missing_required", "aggregate decision is required.");
    return;
  }
  validateEnum(RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_DECISIONS, value.decision, issues, "aggregate.decision");
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
    addIssue(issues, "aggregate.score", "invalid_type", "aggregate score must be a finite number.");
  }
  validateStringArray(value.reasons, issues, "aggregate.reasons");
  validateProvenance(value.provenance, issues, "aggregate.provenance");
}

function validateSafety(value: unknown, issues: IssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "safety", "missing_required", "scorecard safety metadata is required.");
    return;
  }
  for (const key of ["sanitizedReplayReportOnly", "activeRuntimeConsumer", "checkpointLifecycleAuthorityWrite"] as const) {
    if (typeof value[key] !== "boolean") {
      addIssue(issues, `safety.${key}`, "invalid_type", `safety.${key} must be boolean.`);
    }
  }
  if (value.sanitizedReplayReportOnly !== true) {
    addIssue(issues, "safety.sanitizedReplayReportOnly", "invalid_authority", "scorecard must consume sanitized reports only.");
  }
  if (value.activeRuntimeConsumer !== false) {
    addIssue(issues, "safety.activeRuntimeConsumer", "invalid_authority", "scorecard must not be an active runtime consumer.");
  }
  if (value.checkpointLifecycleAuthorityWrite !== false) {
    addIssue(
      issues,
      "safety.checkpointLifecycleAuthorityWrite",
      "invalid_authority",
      "scorecard must not write checkpoint or lifecycle authority state.",
    );
  }
}

function validateProvenance(value: unknown, issues: IssueSink, path: string): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "missing_required", "metric provenance is required.");
    return;
  }
  const keys = ["replayRefs", "failureRefs", "evidenceRefs", "touchedPathRefs"] as const;
  for (const key of keys) {
    validateStringArray(value[key], issues, `${path}.${key}`);
  }
  const totalRefs = keys.reduce((total, key) => total + (Array.isArray(value[key]) ? value[key].length : 0), 0);
  if (totalRefs === 0) {
    addIssue(issues, path, "missing_required", "metric provenance must include at least one replay, failure, evidence, or touched-path ref.");
  }
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  issues: IssueSink,
  path: string,
): void {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    addIssue(issues, path, "missing_required", `${path} is required.`);
    return;
  }
  if (!isNonEmptyString(record[key])) {
    addIssue(issues, path, "invalid_type", `${path} must be a non-empty string.`);
  }
}

function validateEnum<const T extends readonly string[]>(
  values: T,
  value: unknown,
  issues: IssueSink,
  path: string,
): void {
  if (typeof value !== "string" || !values.includes(value as T[number])) {
    addIssue(issues, path, "invalid_enum", `${path} must be one of: ${values.join(", ")}.`);
  }
}

function validateConfidence(value: unknown, issues: IssueSink, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    addIssue(issues, path, "invalid_confidence", `${path} must be a finite number from 0 to 1.`);
  }
}

function validateStringArray(value: unknown, issues: IssueSink, path: string): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    addIssue(issues, path, "invalid_type", `${path} must be an array of strings.`);
  }
}

function sanitizeIdentifier(value: unknown, fallback: string): string {
  const sanitized = sanitizeText(value, REF_MAX_CHARS)
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9:._/-]/g, "")
    .slice(0, REF_MAX_CHARS);
  return sanitized || fallback;
}

function sanitizeRefs(values: string[]): string[] {
  return uniqueRefs(values.map((value) => sanitizeText(value, REF_MAX_CHARS)).filter(isNonEmptyString));
}

function uniqueRefs(values: string[]): string[] {
  return [...new Set(values)].slice(0, REF_LIMIT);
}

function sanitizePath(value: unknown): string {
  const text = sanitizeText(value, REF_MAX_CHARS);
  if (!text || text.includes("[redacted-path]")) {
    return "[redacted-path]";
  }
  return text.replace(/\\/g, "/");
}

function sanitizeText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") {
    return "";
  }
  let sanitized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  if (sanitized.length <= maxChars) {
    return sanitized;
  }
  return `${sanitized.slice(0, maxChars - 3).trimEnd()}...`;
}

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|secret|password|passwd|pwd)\b\s*[:=]\s*["']?[^"',\s;]+/gi, "$1=[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[redacted-secret]"],
  [/\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{10,}\b/g, "[redacted-secret]"],
  [/\b[A-Z][A-Z0-9_]{2,}\s*=\s*[^\s]+/g, "[redacted-env]"],
  [/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/g, "[redacted-path]"],
  [/(?:\/Users|\/home|\/workspace|\/tmp|\/var\/folders)\/[^\s"',;]+/g, "[redacted-path]"],
  [/"(prompt|messages|providerPayload|provider_payload|toolArgs|tool_args|toolResult|tool_result|args|result|secret)"\s*:\s*(?:"[^"]*"|\{[^{}]*\}|\[[^\]]*\])/gi, "\"redactedPayload\":\"[redacted]\""],
  [/\b(prompt|messages|providerPayload|provider_payload|toolArgs|tool_args|toolResult|tool_result|args|result)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\{[^{}]*\}|\[[^\]]*\]|[^\s;]+)/gi, "[redacted-payload]"],
  [/\{[^{}\n]{24,}\}/g, "{redacted-object}"],
  [/\[[^[\]\n]{24,}\]/g, "[redacted-array]"],
];

function addIssue(
  issues: IssueSink,
  path: string,
  code: RuntimeFailureEvidenceReplayValidationIssue["code"],
  message: string,
): void {
  issues.push({ path, code, message });
}

function fail<T>(
  path: string,
  code: RuntimeFailureEvidenceReplayValidationIssue["code"],
  message: string,
): RuntimeFailureEvidenceReplayValidationResult<T> {
  return { ok: false, errors: [{ path, code, message }] };
}

function prefixIssues(
  prefix: string,
  issues: RuntimeFailureEvidenceReplayValidationIssue[],
): RuntimeFailureEvidenceReplayValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path === "$" ? prefix : `${prefix}.${issue.path}`,
  }));
}

function measureJsonBytes(value: unknown): number | undefined {
  try {
    const raw = JSON.stringify(value);
    if (raw === undefined) {
      return undefined;
    }
    return new TextEncoder().encode(raw).length;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
