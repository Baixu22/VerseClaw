import {
  type FailureEvent,
  type RuntimeFailureEvidenceReplayValidationIssue,
  type RuntimeFailureEvidenceReplayValidationResult,
} from "./failure-evidence-replay-contracts.js";
import {
  RUNTIME_FAILURE_REPLAY_REPORT_MAX_BYTES,
  RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION,
  type RuntimeFailureReplayReport,
  type RuntimeFailureReplayTouchedPathSummary,
} from "./failure-replay-harness-core.js";
import {
  RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_MAX_BYTES,
  RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_SCHEMA_VERSION,
  createRuntimeFailureTaskOutcomeScorecardFromReplayReport,
  type RuntimeFailureTaskOutcomeScorecard,
  type RuntimeFailureTaskOutcomeScorecardMetric,
  type RuntimeFailureTaskOutcomeScorecardMetricId,
  type RuntimeFailureTaskOutcomeScorecardProvenance,
  validateRuntimeFailureTaskOutcomeScorecard,
} from "./failure-task-outcome-scorecard.js";

export const RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_SCHEMA_VERSION = 1;
export const RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_DIAGNOSTICS_ONLY = true;
export const RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_AUTHORITY = "none";
export const RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_MAX_BYTES = 14_336;
export const RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_INPUT_MAX_BYTES =
  RUNTIME_FAILURE_REPLAY_REPORT_MAX_BYTES + RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_MAX_BYTES;

export const RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RULE_IDS = [
  "destructive_operation_guard",
  "repeated_failure_backoff",
  "timeout_classification",
  "long_running_process_detection",
  "shell_environment_contamination_detection",
  "ask_user_vs_continue_policy",
  "tool_result_provenance",
] as const;

export type RuntimeFailureToolInvocationGovernanceRuleId =
  (typeof RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RULE_IDS)[number];

export const RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_FINDING_LEVELS = [
  "pass",
  "warn",
  "backoff",
  "ask_user",
  "inconclusive",
] as const;

export type RuntimeFailureToolInvocationGovernanceFindingLevel =
  (typeof RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_FINDING_LEVELS)[number];

export const RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RECOMMENDATIONS = [
  "advisory_pass",
  "advisory_warn",
  "advisory_backoff",
  "advisory_ask_user",
  "inconclusive",
] as const;

export type RuntimeFailureToolInvocationGovernanceRecommendation =
  (typeof RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RECOMMENDATIONS)[number];

export type RuntimeFailureToolInvocationGovernanceProvenance = {
  replayRefs: string[];
  scorecardRefs: string[];
  failureRefs: string[];
  evidenceRefs: string[];
  touchedPathRefs: string[];
};

export type RuntimeFailureToolInvocationGovernanceFutureActiveCandidate = {
  action: "block";
  requiresAcceptedSpec: true;
  reason: string;
};

export type RuntimeFailureToolInvocationGovernanceFinding = {
  id: string;
  ruleId: RuntimeFailureToolInvocationGovernanceRuleId;
  level: RuntimeFailureToolInvocationGovernanceFindingLevel;
  recommendation: RuntimeFailureToolInvocationGovernanceRecommendation;
  summary: string;
  provenance: RuntimeFailureToolInvocationGovernanceProvenance;
  futureActiveCandidate?: RuntimeFailureToolInvocationGovernanceFutureActiveCandidate;
};

export type RuntimeFailureToolInvocationGovernanceAdvisoryReport = {
  schemaVersion: typeof RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_SCHEMA_VERSION;
  diagnosticsOnly: true;
  completionProof: false;
  evaluationMetadataOnly: true;
  authority: typeof RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_AUTHORITY;
  governanceDecisionAuthority: typeof RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_AUTHORITY;
  advisoryOnly: true;
  activeBlocking: false;
  source: {
    kind: "runtime_failure_replay_report_and_task_outcome_scorecard";
    replayReportSchemaVersion: typeof RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION;
    scorecardSchemaVersion: typeof RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_SCHEMA_VERSION;
    replayId: string;
    scenario: RuntimeFailureReplayReport["replay"]["scenario"];
    terminalStatus: RuntimeFailureReplayReport["replay"]["terminalStatus"];
    expectedTerminalStatus: RuntimeFailureReplayReport["replay"]["expectedTerminalStatus"];
    scorecardDecision: RuntimeFailureTaskOutcomeScorecard["aggregate"]["decision"];
  };
  findings: RuntimeFailureToolInvocationGovernanceFinding[];
  aggregate: {
    recommendation: RuntimeFailureToolInvocationGovernanceRecommendation;
    reasons: string[];
    provenance: RuntimeFailureToolInvocationGovernanceProvenance;
  };
  safety: {
    sanitizedReplayReportOnly: true;
    scorecardEvaluationMetadataOnly: true;
    activeRuntimeConsumer: false;
    checkpointLifecycleAuthorityWrite: false;
    futureActiveSpecRequiredForBlocking: true;
    rawPayloadRetained: false;
  };
};

export type RuntimeFailureToolInvocationGovernanceOptions = {
  maxReplayReportBytes?: number;
  maxScorecardBytes?: number;
  maxGovernanceReportBytes?: number;
};

type IssueSink = RuntimeFailureEvidenceReplayValidationIssue[];

type ValidGovernanceInputs = {
  replayReport: RuntimeFailureReplayReport;
  scorecard: RuntimeFailureTaskOutcomeScorecard;
};

const TEXT_MAX_CHARS = 260;
const REF_MAX_CHARS = 160;
const REF_LIMIT = 12;
const LONG_RUNNING_BUDGET_MS = 5 * 60 * 1000;

const ASK_USER_FAILURE_KINDS = new Set<FailureEvent["kind"]>([
  "permission",
  "context_insufficient",
  "environment_contamination",
]);

const MUTATION_STATUSES = new Set<RuntimeFailureReplayTouchedPathSummary["status"]>([
  "created",
  "modified",
  "deleted",
]);

export function createRuntimeFailureToolInvocationGovernanceAdvisoryReport(
  replayReport: RuntimeFailureReplayReport,
  scorecard: RuntimeFailureTaskOutcomeScorecard,
  options: RuntimeFailureToolInvocationGovernanceOptions = {},
): RuntimeFailureEvidenceReplayValidationResult<RuntimeFailureToolInvocationGovernanceAdvisoryReport> {
  const inputValidation = validateGovernanceInputs(replayReport, scorecard, options);
  if (!inputValidation.ok) {
    return inputValidation;
  }

  const inputs = inputValidation.value;
  const findings = [
    buildDestructiveOperationGuard(inputs),
    buildRepeatedFailureBackoff(inputs),
    buildTimeoutClassification(inputs),
    buildLongRunningProcessDetection(inputs),
    buildShellEnvironmentContaminationDetection(inputs),
    buildAskUserVsContinuePolicy(inputs),
    buildToolResultProvenance(inputs),
  ];
  const aggregate = buildAggregate(inputs, findings);
  const report: RuntimeFailureToolInvocationGovernanceAdvisoryReport = {
    schemaVersion: RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_SCHEMA_VERSION,
    diagnosticsOnly: true,
    completionProof: false,
    evaluationMetadataOnly: true,
    authority: RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_AUTHORITY,
    governanceDecisionAuthority: RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_AUTHORITY,
    advisoryOnly: true,
    activeBlocking: false,
    source: {
      kind: "runtime_failure_replay_report_and_task_outcome_scorecard",
      replayReportSchemaVersion: RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION,
      scorecardSchemaVersion: RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_SCHEMA_VERSION,
      replayId: sanitizeIdentifier(inputs.replayReport.replay.id, "replay-unknown"),
      scenario: inputs.replayReport.replay.scenario,
      terminalStatus: inputs.replayReport.replay.terminalStatus,
      expectedTerminalStatus: inputs.replayReport.replay.expectedTerminalStatus,
      scorecardDecision: inputs.scorecard.aggregate.decision,
    },
    findings,
    aggregate,
    safety: {
      sanitizedReplayReportOnly: true,
      scorecardEvaluationMetadataOnly: true,
      activeRuntimeConsumer: false,
      checkpointLifecycleAuthorityWrite: false,
      futureActiveSpecRequiredForBlocking: true,
      rawPayloadRetained: false,
    },
  };

  return validateRuntimeFailureToolInvocationGovernanceAdvisoryReport(report, options);
}

export function validateRuntimeFailureToolInvocationGovernanceAdvisoryReport(
  report: unknown,
  options: RuntimeFailureToolInvocationGovernanceOptions = {},
): RuntimeFailureEvidenceReplayValidationResult<RuntimeFailureToolInvocationGovernanceAdvisoryReport> {
  const issues: IssueSink = [];
  const bytes = measureJsonBytes(report);
  if (bytes === undefined) {
    return fail("$", "payload_not_json", "Tool invocation governance report must be JSON-serializable.");
  }
  const maxBytes = options.maxGovernanceReportBytes
    ?? RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_MAX_BYTES;
  if (bytes > maxBytes) {
    addIssue(
      issues,
      "$",
      "payload_oversized",
      `Tool invocation governance report must be at most ${maxBytes} JSON bytes.`,
    );
  }
  if (!isRecord(report)) {
    addIssue(issues, "$", "invalid_type", "Tool invocation governance report must be an object.");
    return { ok: false, errors: issues };
  }

  if (report.schemaVersion !== RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_SCHEMA_VERSION) {
    addIssue(issues, "schemaVersion", "invalid_enum", "Unsupported tool invocation governance schema version.");
  }
  if (report.diagnosticsOnly !== true) {
    addIssue(issues, "diagnosticsOnly", "invalid_authority", "Governance report must remain diagnostics-only.");
  }
  if (report.completionProof !== false) {
    addIssue(issues, "completionProof", "invalid_authority", "Governance report must not be completion proof.");
  }
  if (report.evaluationMetadataOnly !== true) {
    addIssue(issues, "evaluationMetadataOnly", "invalid_authority", "Governance report must be evaluation metadata only.");
  }
  if (report.authority !== RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_AUTHORITY) {
    addIssue(issues, "authority", "invalid_authority", "Governance report authority must be none.");
  }
  if (report.governanceDecisionAuthority !== RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_AUTHORITY) {
    addIssue(
      issues,
      "governanceDecisionAuthority",
      "invalid_authority",
      "Governance decision authority must be diagnostics-only/none.",
    );
  }
  if (report.advisoryOnly !== true) {
    addIssue(issues, "advisoryOnly", "invalid_authority", "Governance report must be advisory-only.");
  }
  if (report.activeBlocking !== false) {
    addIssue(issues, "activeBlocking", "invalid_authority", "Governance report must not actively block tools.");
  }

  validateSource(report.source, issues);
  validateFindings(report.findings, issues);
  validateAggregate(report.aggregate, issues);
  validateSafety(report.safety, issues);

  return issues.length ? { ok: false, errors: issues } : { ok: true, value: report as RuntimeFailureToolInvocationGovernanceAdvisoryReport };
}

function validateGovernanceInputs(
  replayReport: unknown,
  scorecard: unknown,
  options: RuntimeFailureToolInvocationGovernanceOptions,
): RuntimeFailureEvidenceReplayValidationResult<ValidGovernanceInputs> {
  const issues: IssueSink = [];
  validateInputBudget(replayReport, options.maxReplayReportBytes ?? RUNTIME_FAILURE_REPLAY_REPORT_MAX_BYTES, "replayReport", issues);
  validateInputBudget(scorecard, options.maxScorecardBytes ?? RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_MAX_BYTES, "scorecard", issues);
  rejectActiveBlocking(replayReport, "replayReport", issues);
  rejectActiveBlocking(scorecard, "scorecard", issues);

  const replayValidation = createRuntimeFailureTaskOutcomeScorecardFromReplayReport(replayReport as RuntimeFailureReplayReport, {
    maxReplayReportBytes: options.maxReplayReportBytes,
    maxScorecardBytes: options.maxScorecardBytes,
  });
  if (!replayValidation.ok) {
    issues.push(...prefixIssues("replayReport", replayValidation.errors));
  }

  const scorecardValidation = validateRuntimeFailureTaskOutcomeScorecard(scorecard, {
    maxScorecardBytes: options.maxScorecardBytes,
  });
  if (!scorecardValidation.ok) {
    issues.push(...prefixIssues("scorecard", scorecardValidation.errors));
  }

  if (replayValidation.ok && scorecardValidation.ok) {
    validateInputAlignment(replayReport as RuntimeFailureReplayReport, scorecardValidation.value, issues);
  }

  if (issues.length) {
    return { ok: false, errors: issues };
  }
  return {
    ok: true,
    value: {
      replayReport: replayReport as RuntimeFailureReplayReport,
      scorecard: scorecardValidation.ok ? scorecardValidation.value : scorecard as RuntimeFailureTaskOutcomeScorecard,
    },
  };
}

function validateInputBudget(
  value: unknown,
  maxBytes: number,
  path: string,
  issues: IssueSink,
): void {
  const bytes = measureJsonBytes(value);
  if (bytes === undefined) {
    addIssue(issues, path, "payload_not_json", `${path} must be JSON-serializable.`);
    return;
  }
  if (bytes > maxBytes) {
    addIssue(issues, path, "payload_oversized", `${path} must be at most ${maxBytes} JSON bytes.`);
  }
}

function rejectActiveBlocking(value: unknown, path: string, issues: IssueSink): void {
  if (isRecord(value) && value.activeBlocking === true) {
    addIssue(issues, `${path}.activeBlocking`, "invalid_authority", `${path} must not carry active blocking authority.`);
  }
}

function validateInputAlignment(
  replayReport: RuntimeFailureReplayReport,
  scorecard: RuntimeFailureTaskOutcomeScorecard,
  issues: IssueSink,
): void {
  const source = scorecard.source;
  const checks: Array<[unknown, unknown, string]> = [
    [source.replayId, sanitizeIdentifier(replayReport.replay.id, "replay-unknown"), "scorecard.source.replayId"],
    [source.scenario, replayReport.replay.scenario, "scorecard.source.scenario"],
    [source.terminalStatus, replayReport.replay.terminalStatus, "scorecard.source.terminalStatus"],
    [source.expectedTerminalStatus, replayReport.replay.expectedTerminalStatus, "scorecard.source.expectedTerminalStatus"],
    [source.reportPassed, replayReport.status.passed, "scorecard.source.reportPassed"],
  ];
  for (const [actual, expected, path] of checks) {
    if (actual !== expected) {
      addIssue(issues, path, "invalid_type", `${path} must match the replay report metadata.`);
    }
  }
}

function buildDestructiveOperationGuard(
  inputs: ValidGovernanceInputs,
): RuntimeFailureToolInvocationGovernanceFinding {
  const metric = metricById(inputs.scorecard, "wrong_file_edit");
  const unnecessaryEdit = metricById(inputs.scorecard, "unnecessary_edit");
  const deletedPaths = inputs.replayReport.touchedPathSummaries.filter((summary) => summary.status === "deleted");
  const mutatedPaths = inputs.replayReport.touchedPathSummaries.filter((summary) => MUTATION_STATUSES.has(summary.status));

  if (deletedPaths.length > 0) {
    return finding(
      inputs,
      "destructive_operation_guard",
      "warn",
      "advisory_warn",
      "Deleted path metadata was present in the replay report; a future active spec may consider a narrow destructive-operation block candidate.",
      provenanceFor(inputs, ["wrong_file_edit", "unnecessary_edit"], { touched: true }),
      {
        action: "block",
        requiresAcceptedSpec: true,
        reason: "Only a later active governance spec may convert destructive-operation diagnostics into runtime blocking.",
      },
    );
  }

  if (metric?.status === "fail" || unnecessaryEdit?.status === "fail") {
    return finding(
      inputs,
      "destructive_operation_guard",
      "warn",
      "advisory_warn",
      "Scorecard edit metrics indicate a risky or unnecessary mutation pattern; keep this advisory until replay proof justifies a narrower guard.",
      provenanceFor(inputs, ["wrong_file_edit", "unnecessary_edit"], { failure: true, touched: true }),
    );
  }

  return finding(
    inputs,
    "destructive_operation_guard",
    "pass",
    "advisory_pass",
    mutatedPaths.length > 0
      ? "Touched path metadata is present, but Phase 4 edit metrics do not indicate a destructive operation."
      : "Replay metadata contains no created, modified, or deleted path requiring destructive-operation escalation.",
    provenanceFor(inputs, ["wrong_file_edit", "unnecessary_edit"], { touched: true }),
  );
}

function buildRepeatedFailureBackoff(
  inputs: ValidGovernanceInputs,
): RuntimeFailureToolInvocationGovernanceFinding {
  const retryMetric = metricById(inputs.scorecard, "retry_correctness");
  const repeated = repeatedFailureRefs(inputs.replayReport.failureEvents);
  if (repeated.length > 0 || retryMetric?.status === "fail") {
    return finding(
      inputs,
      "repeated_failure_backoff",
      "backoff",
      "advisory_backoff",
      "Repeated or retry-incorrect failure metadata suggests bounded backoff before another similar tool attempt.",
      provenanceFor(inputs, ["retry_correctness"], { failure: true, evidence: true }),
    );
  }

  return finding(
    inputs,
    "repeated_failure_backoff",
    "pass",
    "advisory_pass",
    "Replay and scorecard metadata do not show repeated failure loops requiring backoff.",
    provenanceFor(inputs, ["retry_correctness"], { failure: true, evidence: true }),
  );
}

function buildTimeoutClassification(
  inputs: ValidGovernanceInputs,
): RuntimeFailureToolInvocationGovernanceFinding {
  const timeoutEvents = inputs.replayReport.failureEvents.filter((event) => event.kind === "timeout");
  if (timeoutEvents.length > 0) {
    return finding(
      inputs,
      "timeout_classification",
      "backoff",
      "advisory_backoff",
      "Timeout failure metadata is present; governance should classify it separately from deterministic tool failure and recommend bounded retry/backoff diagnostics.",
      provenanceFor(inputs, ["retry_correctness"], { failure: true, evidence: true }),
    );
  }

  return finding(
    inputs,
    "timeout_classification",
    "pass",
    "advisory_pass",
    "Replay failure metadata does not include timeout classification signals.",
    provenanceFor(inputs, ["retry_correctness"], { failure: true, evidence: true }),
  );
}

function buildLongRunningProcessDetection(
  inputs: ValidGovernanceInputs,
): RuntimeFailureToolInvocationGovernanceFinding {
  const maxDurationMs = inputs.replayReport.replay.budgets.maxDurationMs ?? 0;
  const timeoutEvents = inputs.replayReport.failureEvents.filter((event) => event.kind === "timeout");
  if (timeoutEvents.length > 0 && maxDurationMs > 0) {
    return finding(
      inputs,
      "long_running_process_detection",
      "backoff",
      "advisory_backoff",
      "Timeout metadata with a replay duration budget should be treated as long-running-process evidence, not proof of a stuck runtime.",
      provenanceFor(inputs, ["retry_correctness"], { failure: true, evidence: true }),
    );
  }
  if (maxDurationMs >= LONG_RUNNING_BUDGET_MS && inputs.replayReport.replay.terminalStatus !== "completed") {
    return finding(
      inputs,
      "long_running_process_detection",
      "warn",
      "advisory_warn",
      "A non-completed replay used a long duration budget; keep detection advisory so normal test runners and dev servers are not blocked by default.",
      provenanceFor(inputs, [], { failure: true }),
    );
  }

  return finding(
    inputs,
    "long_running_process_detection",
    "pass",
    "advisory_pass",
    "Replay duration metadata does not indicate a long-running process requiring governance escalation.",
    provenanceFor(inputs, [], { failure: true }),
  );
}

function buildShellEnvironmentContaminationDetection(
  inputs: ValidGovernanceInputs,
): RuntimeFailureToolInvocationGovernanceFinding {
  const contaminationEvents = inputs.replayReport.failureEvents.filter((event) =>
    event.kind === "environment_contamination"
      || (event.stage === "tool_call" && event.kind === "permission")
  );
  const dirtyPaths = inputs.replayReport.touchedPathSummaries.filter((summary) => summary.status === "dirty");
  if (contaminationEvents.length > 0 || dirtyPaths.length > 0) {
    return finding(
      inputs,
      "shell_environment_contamination_detection",
      "ask_user",
      "advisory_ask_user",
      "Shell, permission, or dirty-workspace metadata indicates the next action should ask the user or refresh context before continuing.",
      provenanceFor(inputs, ["ask_user_appropriateness"], { failure: true, evidence: true, touched: true }),
    );
  }

  return finding(
    inputs,
    "shell_environment_contamination_detection",
    "pass",
    "advisory_pass",
    "Replay metadata does not show shell permission or environment contamination signals.",
    provenanceFor(inputs, ["ask_user_appropriateness"], { failure: true, evidence: true, touched: true }),
  );
}

function buildAskUserVsContinuePolicy(
  inputs: ValidGovernanceInputs,
): RuntimeFailureToolInvocationGovernanceFinding {
  const metric = metricById(inputs.scorecard, "ask_user_appropriateness");
  const askUserEvents = inputs.replayReport.failureEvents.filter((event) => ASK_USER_FAILURE_KINDS.has(event.kind));
  if (metric?.status === "fail" || askUserEvents.length > 0) {
    return finding(
      inputs,
      "ask_user_vs_continue_policy",
      "ask_user",
      "advisory_ask_user",
      "Failure kinds that require user confirmation are present or the ask-user scorecard metric failed; continuing automatically would be advisory-risky.",
      provenanceFor(inputs, ["ask_user_appropriateness"], { failure: true, evidence: true }),
    );
  }
  if (metric?.status === "inconclusive") {
    return finding(
      inputs,
      "ask_user_vs_continue_policy",
      "inconclusive",
      "inconclusive",
      "Ask-user appropriateness is inconclusive, so governance cannot safely prefer continue or ask-user from metadata alone.",
      provenanceFor(inputs, ["ask_user_appropriateness"], { failure: true, evidence: true }),
    );
  }

  return finding(
    inputs,
    "ask_user_vs_continue_policy",
    "pass",
    "advisory_pass",
    "Ask-user scorecard metadata supports continuing without an advisory ask-user recommendation.",
    provenanceFor(inputs, ["ask_user_appropriateness"], { failure: true, evidence: true }),
  );
}

function buildToolResultProvenance(
  inputs: ValidGovernanceInputs,
): RuntimeFailureToolInvocationGovernanceFinding {
  const failureIdsWithEvidence = new Set(
    inputs.replayReport.evidenceEnvelopeDecisions
      .map((decision) => decision.failureEventId)
      .filter(isNonEmptyString),
  );
  const failuresMissingEvidence = inputs.replayReport.failureEvents.filter((event) =>
    event.evidenceRefs.length === 0 && !failureIdsWithEvidence.has(event.id)
  );
  const rejectedEvidence = inputs.replayReport.evidenceEnvelopeDecisions.filter((decision) => decision.accepted !== true);
  if (failuresMissingEvidence.length > 0 || rejectedEvidence.length > 0) {
    return finding(
      inputs,
      "tool_result_provenance",
      "inconclusive",
      "inconclusive",
      "At least one failure or tool-result summary lacks accepted evidence provenance, so governance output remains inconclusive.",
      provenanceFor(inputs, [], { failure: true, evidence: true, touched: true }),
    );
  }

  return finding(
    inputs,
    "tool_result_provenance",
    "pass",
    "advisory_pass",
    inputs.replayReport.failureEvents.length > 0
      ? "Failure and tool-result metadata preserve accepted evidence provenance for advisory governance."
      : "No failure event required tool-result evidence provenance in this replay report.",
    provenanceFor(inputs, [], { failure: true, evidence: true, touched: true }),
  );
}

function buildAggregate(
  inputs: ValidGovernanceInputs,
  findings: RuntimeFailureToolInvocationGovernanceFinding[],
): RuntimeFailureToolInvocationGovernanceAdvisoryReport["aggregate"] {
  let recommendation: RuntimeFailureToolInvocationGovernanceRecommendation;
  if (findings.some((finding) => finding.recommendation === "advisory_ask_user")) {
    recommendation = "advisory_ask_user";
  } else if (findings.some((finding) => finding.recommendation === "advisory_backoff")) {
    recommendation = "advisory_backoff";
  } else if (
    inputs.scorecard.aggregate.decision === "inconclusive"
    || findings.some((finding) => finding.recommendation === "inconclusive")
  ) {
    recommendation = "inconclusive";
  } else if (
    inputs.scorecard.aggregate.decision === "regressed"
    || findings.some((finding) => finding.recommendation === "advisory_warn")
  ) {
    recommendation = "advisory_warn";
  } else {
    recommendation = "advisory_pass";
  }

  const reasons = [
    `scorecard:${inputs.scorecard.aggregate.decision}`,
    ...RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RECOMMENDATIONS.map((candidate) =>
      `${candidate}:${findings.filter((finding) => finding.recommendation === candidate).length}`
    ),
  ].map((reason) => sanitizeText(reason, TEXT_MAX_CHARS));

  return {
    recommendation,
    reasons,
    provenance: mergeProvenance(findings.map((finding) => finding.provenance)),
  };
}

function finding(
  inputs: ValidGovernanceInputs,
  ruleId: RuntimeFailureToolInvocationGovernanceRuleId,
  level: RuntimeFailureToolInvocationGovernanceFindingLevel,
  recommendation: RuntimeFailureToolInvocationGovernanceRecommendation,
  summary: string,
  provenance: RuntimeFailureToolInvocationGovernanceProvenance,
  futureActiveCandidate?: RuntimeFailureToolInvocationGovernanceFutureActiveCandidate,
): RuntimeFailureToolInvocationGovernanceFinding {
  return {
    id: `governance:${ruleId}`,
    ruleId,
    level,
    recommendation,
    summary: sanitizeText(summary, TEXT_MAX_CHARS),
    provenance: ensureProvenance(inputs, provenance),
    ...(futureActiveCandidate
      ? {
        futureActiveCandidate: {
          action: futureActiveCandidate.action,
          requiresAcceptedSpec: true,
          reason: sanitizeText(futureActiveCandidate.reason, TEXT_MAX_CHARS),
        },
      }
      : {}),
  };
}

function metricById(
  scorecard: RuntimeFailureTaskOutcomeScorecard,
  id: RuntimeFailureTaskOutcomeScorecardMetricId,
): RuntimeFailureTaskOutcomeScorecardMetric | undefined {
  return scorecard.metrics.find((metric) => metric.id === id);
}

function repeatedFailureRefs(failureEvents: FailureEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const event of failureEvents) {
    const key = `${event.stage}:${event.kind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
}

function provenanceFor(
  inputs: ValidGovernanceInputs,
  metricIds: RuntimeFailureTaskOutcomeScorecardMetricId[],
  include: { failure?: boolean; evidence?: boolean; touched?: boolean },
): RuntimeFailureToolInvocationGovernanceProvenance {
  const metricProvenance = metricIds
    .map((metricId) => metricById(inputs.scorecard, metricId)?.provenance)
    .filter((value): value is RuntimeFailureTaskOutcomeScorecardProvenance => Boolean(value));
  const mergedMetricProvenance = mergeScorecardProvenance(metricProvenance);
  return {
    replayRefs: uniqueRefs([
      `replay:${inputs.replayReport.replay.id}`,
      `scenario:${inputs.replayReport.replay.scenario}`,
      `terminal:${inputs.replayReport.replay.terminalStatus}->${inputs.replayReport.replay.expectedTerminalStatus}`,
      ...mergedMetricProvenance.replayRefs,
    ]),
    scorecardRefs: uniqueRefs([
      `scorecard:decision:${inputs.scorecard.aggregate.decision}`,
      ...metricIds.map((metricId) => {
        const metric = metricById(inputs.scorecard, metricId);
        return metric ? `scorecard:metric:${metric.id}:${metric.status}` : `scorecard:metric:${metricId}:missing`;
      }),
    ]),
    failureRefs: include.failure
      ? uniqueRefs([
        ...inputs.replayReport.failureEvents.map((event) => `failure:${event.id}:${event.kind}`),
        ...mergedMetricProvenance.failureRefs,
      ])
      : uniqueRefs(mergedMetricProvenance.failureRefs),
    evidenceRefs: include.evidence
      ? uniqueRefs([
        ...inputs.replayReport.evidenceEnvelopeDecisions.map((decision) => `evidence:${decision.id}`),
        ...mergedMetricProvenance.evidenceRefs,
      ])
      : uniqueRefs(mergedMetricProvenance.evidenceRefs),
    touchedPathRefs: include.touched
      ? uniqueRefs([
        ...inputs.replayReport.touchedPathSummaries.map((summary) => `path:${sanitizePath(summary.path)}:${summary.status}`),
        ...mergedMetricProvenance.touchedPathRefs,
      ])
      : uniqueRefs(mergedMetricProvenance.touchedPathRefs),
  };
}

function ensureProvenance(
  inputs: ValidGovernanceInputs,
  provenance: RuntimeFailureToolInvocationGovernanceProvenance,
): RuntimeFailureToolInvocationGovernanceProvenance {
  if (provenanceRefCount(provenance) > 0) {
    return sanitizeGovernanceProvenance(provenance);
  }
  return {
    replayRefs: uniqueRefs([`replay:${inputs.replayReport.replay.id}`]),
    scorecardRefs: uniqueRefs([`scorecard:decision:${inputs.scorecard.aggregate.decision}`]),
    failureRefs: [],
    evidenceRefs: [],
    touchedPathRefs: [],
  };
}

function mergeScorecardProvenance(
  values: RuntimeFailureTaskOutcomeScorecardProvenance[],
): RuntimeFailureTaskOutcomeScorecardProvenance {
  return {
    replayRefs: uniqueRefs(values.flatMap((value) => value.replayRefs)),
    failureRefs: uniqueRefs(values.flatMap((value) => value.failureRefs)),
    evidenceRefs: uniqueRefs(values.flatMap((value) => value.evidenceRefs)),
    touchedPathRefs: uniqueRefs(values.flatMap((value) => value.touchedPathRefs)),
  };
}

function mergeProvenance(
  values: RuntimeFailureToolInvocationGovernanceProvenance[],
): RuntimeFailureToolInvocationGovernanceProvenance {
  return {
    replayRefs: uniqueRefs(values.flatMap((value) => value.replayRefs)),
    scorecardRefs: uniqueRefs(values.flatMap((value) => value.scorecardRefs)),
    failureRefs: uniqueRefs(values.flatMap((value) => value.failureRefs)),
    evidenceRefs: uniqueRefs(values.flatMap((value) => value.evidenceRefs)),
    touchedPathRefs: uniqueRefs(values.flatMap((value) => value.touchedPathRefs)),
  };
}

function validateSource(value: unknown, issues: IssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "source", "missing_required", "governance source metadata is required.");
    return;
  }
  if (value.kind !== "runtime_failure_replay_report_and_task_outcome_scorecard") {
    addIssue(issues, "source.kind", "invalid_enum", "source kind must identify replay report and scorecard inputs.");
  }
  if (value.replayReportSchemaVersion !== RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION) {
    addIssue(issues, "source.replayReportSchemaVersion", "invalid_enum", "unsupported replay report schema version.");
  }
  if (value.scorecardSchemaVersion !== RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_SCHEMA_VERSION) {
    addIssue(issues, "source.scorecardSchemaVersion", "invalid_enum", "unsupported scorecard schema version.");
  }
  requireNonEmptyString(value, "replayId", issues, "source.replayId");
  requireNonEmptyString(value, "scenario", issues, "source.scenario");
  requireNonEmptyString(value, "terminalStatus", issues, "source.terminalStatus");
  requireNonEmptyString(value, "expectedTerminalStatus", issues, "source.expectedTerminalStatus");
  requireNonEmptyString(value, "scorecardDecision", issues, "source.scorecardDecision");
}

function validateFindings(value: unknown, issues: IssueSink): void {
  if (!Array.isArray(value)) {
    addIssue(issues, "findings", "missing_required", "governance findings are required.");
    return;
  }
  if (value.length !== RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RULE_IDS.length) {
    addIssue(issues, "findings", "missing_required", "governance report must include exactly the Phase 5 advisory rule set.");
  }
  const seen = new Set<string>();
  value.forEach((findingValue, index) => {
    const path = `findings.${index}`;
    if (!isRecord(findingValue)) {
      addIssue(issues, path, "invalid_type", "governance finding must be an object.");
      return;
    }
    requireNonEmptyString(findingValue, "id", issues, `${path}.id`);
    validateEnum(RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RULE_IDS, findingValue.ruleId, issues, `${path}.ruleId`);
    if (typeof findingValue.ruleId === "string") {
      seen.add(findingValue.ruleId);
    }
    validateEnum(RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_FINDING_LEVELS, findingValue.level, issues, `${path}.level`);
    validateEnum(RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RECOMMENDATIONS, findingValue.recommendation, issues, `${path}.recommendation`);
    requireNonEmptyString(findingValue, "summary", issues, `${path}.summary`);
    validateProvenance(findingValue.provenance, issues, `${path}.provenance`);
    validateFutureActiveCandidate(findingValue.futureActiveCandidate, issues, `${path}.futureActiveCandidate`);
  });
  for (const ruleId of RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RULE_IDS) {
    if (!seen.has(ruleId)) {
      addIssue(issues, "findings", "missing_required", `governance finding ${ruleId} is required.`);
    }
  }
}

function validateFutureActiveCandidate(value: unknown, issues: IssueSink, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_type", "future active candidate metadata must be an object when present.");
    return;
  }
  if (value.action !== "block") {
    addIssue(issues, `${path}.action`, "invalid_enum", "future active candidate action must be block.");
  }
  if (value.requiresAcceptedSpec !== true) {
    addIssue(issues, `${path}.requiresAcceptedSpec`, "invalid_authority", "block candidates require a future accepted spec.");
  }
  requireNonEmptyString(value, "reason", issues, `${path}.reason`);
}

function validateAggregate(value: unknown, issues: IssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "aggregate", "missing_required", "governance aggregate recommendation is required.");
    return;
  }
  validateEnum(RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RECOMMENDATIONS, value.recommendation, issues, "aggregate.recommendation");
  validateStringArray(value.reasons, issues, "aggregate.reasons");
  validateProvenance(value.provenance, issues, "aggregate.provenance");
}

function validateSafety(value: unknown, issues: IssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "safety", "missing_required", "governance safety metadata is required.");
    return;
  }
  const expected = {
    sanitizedReplayReportOnly: true,
    scorecardEvaluationMetadataOnly: true,
    activeRuntimeConsumer: false,
    checkpointLifecycleAuthorityWrite: false,
    futureActiveSpecRequiredForBlocking: true,
    rawPayloadRetained: false,
  } as const;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      addIssue(issues, `safety.${key}`, "invalid_authority", `safety.${key} must remain ${String(expectedValue)}.`);
    }
  }
}

function validateProvenance(value: unknown, issues: IssueSink, path: string): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "missing_required", "governance provenance is required.");
    return;
  }
  for (const key of ["replayRefs", "scorecardRefs", "failureRefs", "evidenceRefs", "touchedPathRefs"] as const) {
    validateStringArray(value[key], issues, `${path}.${key}`);
  }
  if (provenanceRefCount(value) === 0) {
    addIssue(issues, path, "missing_required", "governance finding must cite replay, scorecard, failure, evidence, or touched-path provenance.");
  }
}

function provenanceRefCount(value: unknown): number {
  if (!isRecord(value)) {
    return 0;
  }
  return ["replayRefs", "scorecardRefs", "failureRefs", "evidenceRefs", "touchedPathRefs"].reduce(
    (total, key) => total + (Array.isArray(value[key]) ? value[key].length : 0),
    0,
  );
}

function sanitizeGovernanceProvenance(
  value: RuntimeFailureToolInvocationGovernanceProvenance,
): RuntimeFailureToolInvocationGovernanceProvenance {
  return {
    replayRefs: uniqueRefs(value.replayRefs),
    scorecardRefs: uniqueRefs(value.scorecardRefs),
    failureRefs: uniqueRefs(value.failureRefs),
    evidenceRefs: uniqueRefs(value.evidenceRefs),
    touchedPathRefs: uniqueRefs(value.touchedPathRefs),
  };
}

function sanitizeIdentifier(value: unknown, fallback: string): string {
  const sanitized = sanitizeText(value, REF_MAX_CHARS)
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9:._/-]/g, "")
    .slice(0, REF_MAX_CHARS);
  return sanitized || fallback;
}

function sanitizePath(value: unknown): string {
  const text = sanitizeText(value, REF_MAX_CHARS);
  if (!text || text.includes("[redacted-path]")) {
    return "[redacted-path]";
  }
  return text.replace(/\\/g, "/");
}

function uniqueRefs(values: string[]): string[] {
  return [...new Set(values.map((value) => sanitizeText(value, REF_MAX_CHARS)).filter(isNonEmptyString))]
    .slice(0, REF_LIMIT);
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

function validateStringArray(value: unknown, issues: IssueSink, path: string): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    addIssue(issues, path, "invalid_type", `${path} must be an array of strings.`);
  }
}

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
