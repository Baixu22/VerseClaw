import {
  type RuntimeFailureEvidenceReplayValidationIssue,
  type RuntimeFailureEvidenceReplayValidationResult,
} from "./failure-evidence-replay-contracts.js";
import {
  type RuntimeFailureReplayReport,
} from "./failure-replay-harness-core.js";
import {
  type RuntimeFailureTaskOutcomeScorecard,
  type RuntimeFailureTaskOutcomeScorecardMetric,
  type RuntimeFailureTaskOutcomeScorecardMetricId,
  type RuntimeFailureTaskOutcomeScorecardProvenance,
} from "./failure-task-outcome-scorecard.js";
import {
  createRuntimeFailureToolInvocationGovernanceAdvisoryReport,
  type RuntimeFailureToolInvocationGovernanceAdvisoryReport,
  type RuntimeFailureToolInvocationGovernanceFinding,
  type RuntimeFailureToolInvocationGovernanceOptions,
  type RuntimeFailureToolInvocationGovernanceProvenance,
} from "./failure-tool-invocation-governance-advisory.js";

export const RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_SCHEMA_VERSION = 1;
export const RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_AUTHORITY = "none";
export const RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_MAX_BYTES = 32_768;

export const RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_TRIGGER_SIGNALS = [
  "deleted_touched_path_metadata",
  "wrong_file_edit_scorecard_fail",
  "unnecessary_edit_scorecard_fail",
  "phase5_future_block_candidate",
] as const;

export type RuntimeFailureDestructiveOperationGuardTriggerSignal =
  (typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_TRIGGER_SIGNALS)[number];

export const RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_FALSE_BLOCK_CASES = [
  "expected_edit",
  "expected_deletion",
  "normal_completed_repair",
  "completed_test_repair",
  "sanitized_or_inconclusive_touched_path",
  "legitimate_fixture_mutation",
  "slow_test_command",
  "known_dev_server_like_long_running",
] as const;

export type RuntimeFailureDestructiveOperationGuardFalseBlockCase =
  (typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_FALSE_BLOCK_CASES)[number];

export type RuntimeFailureDestructiveOperationGuardEvidenceProofExpectation =
  | "trigger"
  | "false_block";

export type RuntimeFailureDestructiveOperationGuardEvidenceProofCaseInput = {
  id: string;
  expectation: RuntimeFailureDestructiveOperationGuardEvidenceProofExpectation;
  replayReport: RuntimeFailureReplayReport;
  scorecard: RuntimeFailureTaskOutcomeScorecard;
  falseBlockCase?: RuntimeFailureDestructiveOperationGuardFalseBlockCase;
  notes?: string[];
};

export type RuntimeFailureDestructiveOperationGuardMetricRef = {
  id: "wrong_file_edit" | "unnecessary_edit";
  status: RuntimeFailureTaskOutcomeScorecardMetric["status"] | "missing";
  ref: string;
  provenance: RuntimeFailureTaskOutcomeScorecardProvenance;
};

export type RuntimeFailureDestructiveOperationGuardEvidenceProofCaseOutcome =
  | "evidence_qualified_trigger"
  | "not_triggered";

export type RuntimeFailureDestructiveOperationGuardEvidenceProofCaseResult = {
  id: string;
  expectation: RuntimeFailureDestructiveOperationGuardEvidenceProofExpectation;
  falseBlockCase?: RuntimeFailureDestructiveOperationGuardFalseBlockCase;
  passed: boolean;
  outcome: RuntimeFailureDestructiveOperationGuardEvidenceProofCaseOutcome;
  triggerSignals: RuntimeFailureDestructiveOperationGuardTriggerSignal[];
  replay: {
    id: string;
    scenario: RuntimeFailureReplayReport["replay"]["scenario"];
    terminalStatus: RuntimeFailureReplayReport["replay"]["terminalStatus"];
    expectedTerminalStatus: RuntimeFailureReplayReport["replay"]["expectedTerminalStatus"];
  };
  scorecard: {
    aggregateDecision: RuntimeFailureTaskOutcomeScorecard["aggregate"]["decision"];
    wrongFileEdit: RuntimeFailureDestructiveOperationGuardMetricRef;
    unnecessaryEdit: RuntimeFailureDestructiveOperationGuardMetricRef;
  };
  phase5Finding: {
    id: string;
    ruleId: "destructive_operation_guard";
    level: RuntimeFailureToolInvocationGovernanceFinding["level"];
    recommendation: RuntimeFailureToolInvocationGovernanceFinding["recommendation"];
    futureActiveCandidate?: {
      action: "block";
      requiresAcceptedSpec: true;
    };
  };
  provenance: RuntimeFailureToolInvocationGovernanceProvenance;
  safety: {
    advisoryReportActiveBlocking: false;
    advisoryReportAuthority: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_AUTHORITY;
    completionProof: false;
    rawPayloadRetained: false;
  };
  notes: string[];
};

export type RuntimeFailureDestructiveOperationGuardEvidenceProofReport = {
  schemaVersion: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_SCHEMA_VERSION;
  diagnosticsOnly: true;
  completionProof: false;
  evaluationMetadataOnly: true;
  authority: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_AUTHORITY;
  governanceDecisionAuthority: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_AUTHORITY;
  activeBlocking: false;
  candidateRuleId: "destructive_operation_guard";
  source: {
    kind: "synthetic_replay_scorecard_governance_evidence_proof";
    caseCount: number;
    triggerCaseCount: number;
    falseBlockCaseCount: number;
  };
  cases: RuntimeFailureDestructiveOperationGuardEvidenceProofCaseResult[];
  coverage: {
    triggerSignals: Record<RuntimeFailureDestructiveOperationGuardTriggerSignal, boolean>;
    falseBlockCases: Record<RuntimeFailureDestructiveOperationGuardFalseBlockCase, boolean>;
    provenance: {
      replayScenarioTerminalStatusRefs: boolean;
      scorecardAggregateDecisionRefs: boolean;
      wrongFileEditMetricRefs: boolean;
      unnecessaryEditMetricRefs: boolean;
      failureRefs: boolean;
      evidenceRefs: boolean;
      touchedPathRefs: boolean;
    };
    safety: {
      diagnosticsEvaluationMetadataOnly: true;
      noActiveBlockingAuthority: true;
      noCompletionProof: true;
      noRawPromptProviderToolSecretEnvWorkspaceContent: true;
    };
    rollbackReadiness: {
      futureFlagDisableRollbackRequired: true;
      futureOwnerBoundary: "tool_invocation_preflight";
      activeConsumerBoundaryScanPlanned: true;
      checkpointLifecycleAuthorityWriteAllowed: false;
    };
  };
  readiness: {
    status: "evidence_conditions_met_not_active_runtime_ready" | "needs_more_evidence";
    activeRuntimeReady: false;
    defaultOffLimitedActiveGuardCanBeProposedByFutureSpec: boolean;
    reasons: string[];
  };
  safety: {
    advisoryReportsOnly: true;
    scorecardsEvaluationMetadataOnly: true;
    activeRuntimeConsumer: false;
    toolBlockingBehaviorChanged: false;
    checkpointLifecycleAuthorityWrite: false;
    completionProof: false;
    rawPayloadRetained: false;
  };
};

export type RuntimeFailureDestructiveOperationGuardEvidenceProofOptions =
  RuntimeFailureToolInvocationGovernanceOptions & {
    maxProofReportBytes?: number;
  };

type IssueSink = RuntimeFailureEvidenceReplayValidationIssue[];

const TEXT_MAX_CHARS = 260;
const REF_MAX_CHARS = 160;
const REF_LIMIT = 12;

const EMPTY_SCORECARD_PROVENANCE: RuntimeFailureTaskOutcomeScorecardProvenance = {
  replayRefs: [],
  failureRefs: [],
  evidenceRefs: [],
  touchedPathRefs: [],
};

const EMPTY_GOVERNANCE_PROVENANCE: RuntimeFailureToolInvocationGovernanceProvenance = {
  replayRefs: [],
  scorecardRefs: [],
  failureRefs: [],
  evidenceRefs: [],
  touchedPathRefs: [],
};

export function createRuntimeFailureDestructiveOperationGuardEvidenceProofReport(
  cases: RuntimeFailureDestructiveOperationGuardEvidenceProofCaseInput[],
  options: RuntimeFailureDestructiveOperationGuardEvidenceProofOptions = {},
): RuntimeFailureEvidenceReplayValidationResult<RuntimeFailureDestructiveOperationGuardEvidenceProofReport> {
  const issues: IssueSink = [];
  if (!Array.isArray(cases) || cases.length === 0) {
    return fail("cases", "missing_required", "At least one destructive-operation evidence proof case is required.");
  }

  const results: RuntimeFailureDestructiveOperationGuardEvidenceProofCaseResult[] = [];
  cases.forEach((caseInput, index) => {
    validateCaseInput(caseInput, index, issues);
    if (!isRecord(caseInput)) {
      return;
    }

    const governance = createRuntimeFailureToolInvocationGovernanceAdvisoryReport(
      caseInput.replayReport,
      caseInput.scorecard,
      options,
    );
    if (!governance.ok) {
      issues.push(...prefixIssues(`cases.${index}`, governance.errors));
      return;
    }

    const finding = governance.value.findings.find((entry) => entry.ruleId === "destructive_operation_guard");
    if (!finding) {
      addIssue(
        issues,
        `cases.${index}.phase5Finding`,
        "missing_required",
        "Phase 5 destructive_operation_guard finding is required for evidence proof.",
      );
      return;
    }

    results.push(buildCaseResult(caseInput, governance.value, finding));
  });

  if (issues.length) {
    return { ok: false, errors: issues };
  }

  const report: RuntimeFailureDestructiveOperationGuardEvidenceProofReport = {
    schemaVersion: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_SCHEMA_VERSION,
    diagnosticsOnly: true,
    completionProof: false,
    evaluationMetadataOnly: true,
    authority: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_AUTHORITY,
    governanceDecisionAuthority: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_AUTHORITY,
    activeBlocking: false,
    candidateRuleId: "destructive_operation_guard",
    source: {
      kind: "synthetic_replay_scorecard_governance_evidence_proof",
      caseCount: results.length,
      triggerCaseCount: results.filter((entry) => entry.expectation === "trigger").length,
      falseBlockCaseCount: results.filter((entry) => entry.expectation === "false_block").length,
    },
    cases: results,
    coverage: buildCoverage(results),
    readiness: buildReadiness(results),
    safety: {
      advisoryReportsOnly: true,
      scorecardsEvaluationMetadataOnly: true,
      activeRuntimeConsumer: false,
      toolBlockingBehaviorChanged: false,
      checkpointLifecycleAuthorityWrite: false,
      completionProof: false,
      rawPayloadRetained: false,
    },
  };

  return validateRuntimeFailureDestructiveOperationGuardEvidenceProofReport(report, options);
}

export function validateRuntimeFailureDestructiveOperationGuardEvidenceProofReport(
  report: unknown,
  options: RuntimeFailureDestructiveOperationGuardEvidenceProofOptions = {},
): RuntimeFailureEvidenceReplayValidationResult<RuntimeFailureDestructiveOperationGuardEvidenceProofReport> {
  const issues: IssueSink = [];
  const bytes = measureJsonBytes(report);
  if (bytes === undefined) {
    return fail("$", "payload_not_json", "Destructive-operation evidence proof report must be JSON-serializable.");
  }
  const maxBytes = options.maxProofReportBytes ?? RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_MAX_BYTES;
  if (bytes > maxBytes) {
    addIssue(
      issues,
      "$",
      "payload_oversized",
      `Destructive-operation evidence proof report must be at most ${maxBytes} JSON bytes.`,
    );
  }
  if (!isRecord(report)) {
    addIssue(issues, "$", "invalid_type", "Destructive-operation evidence proof report must be an object.");
    return { ok: false, errors: issues };
  }

  validateReportAuthority(report, issues);
  validateReportSource(report.source, report.cases, issues);
  validateReportCases(report.cases, issues);
  validateReportCoverage(report.coverage, issues);
  validateReportReadiness(report.readiness, issues);
  validateReportSafety(report.safety, issues);

  return issues.length
    ? { ok: false, errors: issues }
    : { ok: true, value: report as RuntimeFailureDestructiveOperationGuardEvidenceProofReport };
}

function validateCaseInput(
  value: unknown,
  index: number,
  issues: IssueSink,
): void {
  const path = `cases.${index}`;
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_type", "Evidence proof case must be an object.");
    return;
  }
  requireNonEmptyString(value, "id", issues, `${path}.id`);
  validateEnum(["trigger", "false_block"] as const, value.expectation, issues, `${path}.expectation`);
  if (value.expectation === "false_block") {
    validateEnum(
      RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_FALSE_BLOCK_CASES,
      value.falseBlockCase,
      issues,
      `${path}.falseBlockCase`,
    );
  }
  if (value.expectation === "trigger" && value.falseBlockCase !== undefined) {
    addIssue(
      issues,
      `${path}.falseBlockCase`,
      "invalid_type",
      "Trigger cases must not declare a false-block category.",
    );
  }
  if (value.notes !== undefined && !isStringArray(value.notes)) {
    addIssue(issues, `${path}.notes`, "invalid_type", "Case notes must be an array of strings when present.");
  }
}

function buildCaseResult(
  caseInput: RuntimeFailureDestructiveOperationGuardEvidenceProofCaseInput,
  advisoryReport: RuntimeFailureToolInvocationGovernanceAdvisoryReport,
  finding: RuntimeFailureToolInvocationGovernanceFinding,
): RuntimeFailureDestructiveOperationGuardEvidenceProofCaseResult {
  const triggerSignals = triggerSignalsFor(caseInput.replayReport, caseInput.scorecard, finding);
  const evidenceQualifiedTrigger = isEvidenceQualifiedTrigger(triggerSignals);
  const outcome = evidenceQualifiedTrigger ? "evidence_qualified_trigger" : "not_triggered";
  const passed = caseInput.expectation === "trigger" ? evidenceQualifiedTrigger : !evidenceQualifiedTrigger;
  const wrongFileEdit = metricRef(caseInput.scorecard, "wrong_file_edit");
  const unnecessaryEdit = metricRef(caseInput.scorecard, "unnecessary_edit");

  return {
    id: sanitizeIdentifier(caseInput.id, `case-${caseInput.expectation}`),
    expectation: caseInput.expectation,
    ...(caseInput.falseBlockCase ? { falseBlockCase: caseInput.falseBlockCase } : {}),
    passed,
    outcome,
    triggerSignals,
    replay: {
      id: sanitizeIdentifier(caseInput.replayReport.replay.id, "replay-unknown"),
      scenario: caseInput.replayReport.replay.scenario,
      terminalStatus: caseInput.replayReport.replay.terminalStatus,
      expectedTerminalStatus: caseInput.replayReport.replay.expectedTerminalStatus,
    },
    scorecard: {
      aggregateDecision: caseInput.scorecard.aggregate.decision,
      wrongFileEdit,
      unnecessaryEdit,
    },
    phase5Finding: {
      id: sanitizeIdentifier(finding.id, "governance:destructive_operation_guard"),
      ruleId: "destructive_operation_guard",
      level: finding.level,
      recommendation: finding.recommendation,
      ...(finding.futureActiveCandidate
        ? {
          futureActiveCandidate: {
            action: "block",
            requiresAcceptedSpec: true,
          },
        }
        : {}),
    },
    provenance: mergeGovernanceProvenance([
      finding.provenance,
      {
        replayRefs: [
          `replay:${caseInput.replayReport.replay.id}`,
          `scenario:${caseInput.replayReport.replay.scenario}`,
          `terminal:${caseInput.replayReport.replay.terminalStatus}->${caseInput.replayReport.replay.expectedTerminalStatus}`,
        ],
        scorecardRefs: [
          `scorecard:decision:${caseInput.scorecard.aggregate.decision}`,
          wrongFileEdit.ref,
          unnecessaryEdit.ref,
        ],
        failureRefs: [
          ...wrongFileEdit.provenance.failureRefs,
          ...unnecessaryEdit.provenance.failureRefs,
        ],
        evidenceRefs: [
          ...wrongFileEdit.provenance.evidenceRefs,
          ...unnecessaryEdit.provenance.evidenceRefs,
        ],
        touchedPathRefs: [
          ...wrongFileEdit.provenance.touchedPathRefs,
          ...unnecessaryEdit.provenance.touchedPathRefs,
        ],
      },
      governanceProvenanceFromScorecard(caseInput.scorecard.aggregate.provenance),
    ]),
    safety: {
      advisoryReportActiveBlocking: advisoryReport.activeBlocking,
      advisoryReportAuthority: advisoryReport.authority,
      completionProof: advisoryReport.completionProof,
      rawPayloadRetained: advisoryReport.safety.rawPayloadRetained,
    },
    notes: (caseInput.notes ?? []).map((note) => sanitizeText(note, TEXT_MAX_CHARS)).filter(isNonEmptyString),
  };
}

function triggerSignalsFor(
  replayReport: RuntimeFailureReplayReport,
  scorecard: RuntimeFailureTaskOutcomeScorecard,
  finding: RuntimeFailureToolInvocationGovernanceFinding,
): RuntimeFailureDestructiveOperationGuardTriggerSignal[] {
  const signals: RuntimeFailureDestructiveOperationGuardTriggerSignal[] = [];
  if (replayReport.touchedPathSummaries.some((summary) => summary.status === "deleted")) {
    signals.push("deleted_touched_path_metadata");
  }
  if (metricById(scorecard, "wrong_file_edit")?.status === "fail") {
    signals.push("wrong_file_edit_scorecard_fail");
  }
  if (metricById(scorecard, "unnecessary_edit")?.status === "fail") {
    signals.push("unnecessary_edit_scorecard_fail");
  }
  if (
    finding.futureActiveCandidate?.action === "block"
    && finding.futureActiveCandidate.requiresAcceptedSpec === true
  ) {
    signals.push("phase5_future_block_candidate");
  }
  return uniqueEnumValues(RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_TRIGGER_SIGNALS, signals);
}

function isEvidenceQualifiedTrigger(
  signals: RuntimeFailureDestructiveOperationGuardTriggerSignal[],
): boolean {
  return signals.includes("deleted_touched_path_metadata")
    && signals.includes("phase5_future_block_candidate")
    && (
      signals.includes("wrong_file_edit_scorecard_fail")
      || signals.includes("unnecessary_edit_scorecard_fail")
    );
}

function metricRef(
  scorecard: RuntimeFailureTaskOutcomeScorecard,
  id: "wrong_file_edit" | "unnecessary_edit",
): RuntimeFailureDestructiveOperationGuardMetricRef {
  const metric = metricById(scorecard, id);
  const status = metric?.status ?? "missing";
  return {
    id,
    status,
    ref: sanitizeText(`scorecard:metric:${id}:${status}`, REF_MAX_CHARS),
    provenance: metric ? sanitizeScorecardProvenance(metric.provenance) : EMPTY_SCORECARD_PROVENANCE,
  };
}

function metricById(
  scorecard: RuntimeFailureTaskOutcomeScorecard,
  id: RuntimeFailureTaskOutcomeScorecardMetricId,
): RuntimeFailureTaskOutcomeScorecardMetric | undefined {
  return scorecard.metrics.find((metric) => metric.id === id);
}

function buildCoverage(
  cases: RuntimeFailureDestructiveOperationGuardEvidenceProofCaseResult[],
): RuntimeFailureDestructiveOperationGuardEvidenceProofReport["coverage"] {
  const passedTriggerCases = cases.filter((entry) => entry.expectation === "trigger" && entry.passed);
  const passedFalseBlockCases = cases.filter((entry) => entry.expectation === "false_block" && entry.passed);
  return {
    triggerSignals: Object.fromEntries(
      RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_TRIGGER_SIGNALS.map((signal) => [
        signal,
        passedTriggerCases.some((entry) => entry.triggerSignals.includes(signal)),
      ]),
    ) as Record<RuntimeFailureDestructiveOperationGuardTriggerSignal, boolean>,
    falseBlockCases: Object.fromEntries(
      RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_FALSE_BLOCK_CASES.map((falseBlockCase) => [
        falseBlockCase,
        passedFalseBlockCases.some((entry) => entry.falseBlockCase === falseBlockCase),
      ]),
    ) as Record<RuntimeFailureDestructiveOperationGuardFalseBlockCase, boolean>,
    provenance: {
      replayScenarioTerminalStatusRefs: cases.every((entry) =>
        entry.provenance.replayRefs.some((ref) => ref.startsWith("replay:"))
        && entry.provenance.replayRefs.some((ref) => ref.startsWith("scenario:"))
        && entry.provenance.replayRefs.some((ref) => ref.startsWith("terminal:"))
      ),
      scorecardAggregateDecisionRefs: cases.every((entry) =>
        entry.provenance.scorecardRefs.some((ref) => ref.startsWith("scorecard:decision:"))
      ),
      wrongFileEditMetricRefs: cases.every((entry) =>
        entry.scorecard.wrongFileEdit.ref.startsWith("scorecard:metric:wrong_file_edit:")
      ),
      unnecessaryEditMetricRefs: cases.every((entry) =>
        entry.scorecard.unnecessaryEdit.ref.startsWith("scorecard:metric:unnecessary_edit:")
      ),
      failureRefs: cases.some((entry) => entry.provenance.failureRefs.length > 0),
      evidenceRefs: cases.some((entry) => entry.provenance.evidenceRefs.length > 0),
      touchedPathRefs: cases.some((entry) => entry.provenance.touchedPathRefs.length > 0),
    },
    safety: {
      diagnosticsEvaluationMetadataOnly: true,
      noActiveBlockingAuthority: true,
      noCompletionProof: true,
      noRawPromptProviderToolSecretEnvWorkspaceContent: true,
    },
    rollbackReadiness: {
      futureFlagDisableRollbackRequired: true,
      futureOwnerBoundary: "tool_invocation_preflight",
      activeConsumerBoundaryScanPlanned: true,
      checkpointLifecycleAuthorityWriteAllowed: false,
    },
  };
}

function buildReadiness(
  cases: RuntimeFailureDestructiveOperationGuardEvidenceProofCaseResult[],
): RuntimeFailureDestructiveOperationGuardEvidenceProofReport["readiness"] {
  const triggerCoverage = RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_TRIGGER_SIGNALS.every((signal) =>
    cases.some((entry) => entry.expectation === "trigger" && entry.passed && entry.triggerSignals.includes(signal))
  );
  const falseBlockCoverage = RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_FALSE_BLOCK_CASES.every((falseBlockCase) =>
    cases.some((entry) => entry.expectation === "false_block" && entry.passed && entry.falseBlockCase === falseBlockCase)
  );
  const allCasesPassed = cases.every((entry) => entry.passed);
  const evidenceConditionsMet = triggerCoverage && falseBlockCoverage && allCasesPassed;
  const reasons = [
    triggerCoverage ? "trigger_signals_covered" : "trigger_signals_missing",
    falseBlockCoverage ? "false_block_corpus_covered" : "false_block_corpus_missing",
    allCasesPassed ? "case_expectations_passed" : "case_expectations_failed",
    "active_runtime_readiness_not_claimed",
  ].map((reason) => sanitizeText(reason, TEXT_MAX_CHARS));

  return {
    status: evidenceConditionsMet
      ? "evidence_conditions_met_not_active_runtime_ready"
      : "needs_more_evidence",
    activeRuntimeReady: false,
    defaultOffLimitedActiveGuardCanBeProposedByFutureSpec: evidenceConditionsMet,
    reasons,
  };
}

function validateReportAuthority(
  report: Record<string, unknown>,
  issues: IssueSink,
): void {
  if (report.schemaVersion !== RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_SCHEMA_VERSION) {
    addIssue(issues, "schemaVersion", "invalid_enum", "Unsupported destructive-operation evidence proof schema version.");
  }
  if (report.diagnosticsOnly !== true) {
    addIssue(issues, "diagnosticsOnly", "invalid_authority", "Evidence proof report must remain diagnostics-only.");
  }
  if (report.completionProof !== false) {
    addIssue(issues, "completionProof", "invalid_authority", "Evidence proof report must not be completion proof.");
  }
  if (report.evaluationMetadataOnly !== true) {
    addIssue(
      issues,
      "evaluationMetadataOnly",
      "invalid_authority",
      "Evidence proof report must be evaluation metadata only.",
    );
  }
  if (report.authority !== RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_AUTHORITY) {
    addIssue(issues, "authority", "invalid_authority", "Evidence proof authority must be none.");
  }
  if (report.governanceDecisionAuthority !== RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_AUTHORITY) {
    addIssue(
      issues,
      "governanceDecisionAuthority",
      "invalid_authority",
      "Evidence proof governance decision authority must be none.",
    );
  }
  if (report.activeBlocking !== false) {
    addIssue(issues, "activeBlocking", "invalid_authority", "Evidence proof report must not actively block tools.");
  }
  if (report.candidateRuleId !== "destructive_operation_guard") {
    addIssue(issues, "candidateRuleId", "invalid_enum", "Evidence proof scope is limited to destructive_operation_guard.");
  }
}

function validateReportSource(
  source: unknown,
  cases: unknown,
  issues: IssueSink,
): void {
  if (!isRecord(source)) {
    addIssue(issues, "source", "missing_required", "Evidence proof source metadata is required.");
    return;
  }
  if (source.kind !== "synthetic_replay_scorecard_governance_evidence_proof") {
    addIssue(issues, "source.kind", "invalid_enum", "Evidence proof source must identify synthetic replay/scorecard metadata.");
  }
  const caseCount = Array.isArray(cases) ? cases.length : 0;
  if (source.caseCount !== caseCount) {
    addIssue(issues, "source.caseCount", "invalid_type", "source.caseCount must match evidence proof cases.");
  }
  for (const key of ["triggerCaseCount", "falseBlockCaseCount"] as const) {
    if (!Number.isInteger(source[key]) || Number(source[key]) < 0) {
      addIssue(issues, `source.${key}`, "invalid_type", `source.${key} must be a non-negative integer.`);
    }
  }
}

function validateReportCases(
  cases: unknown,
  issues: IssueSink,
): void {
  if (!Array.isArray(cases) || cases.length === 0) {
    addIssue(issues, "cases", "missing_required", "Evidence proof cases are required.");
    return;
  }
  cases.forEach((caseValue, index) => {
    const path = `cases.${index}`;
    if (!isRecord(caseValue)) {
      addIssue(issues, path, "invalid_type", "Evidence proof case result must be an object.");
      return;
    }
    requireNonEmptyString(caseValue, "id", issues, `${path}.id`);
    validateEnum(["trigger", "false_block"] as const, caseValue.expectation, issues, `${path}.expectation`);
    if (caseValue.expectation === "false_block") {
      validateEnum(
        RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_FALSE_BLOCK_CASES,
        caseValue.falseBlockCase,
        issues,
        `${path}.falseBlockCase`,
      );
    }
    if (typeof caseValue.passed !== "boolean") {
      addIssue(issues, `${path}.passed`, "invalid_type", "case passed must be boolean.");
    }
    validateEnum(["evidence_qualified_trigger", "not_triggered"] as const, caseValue.outcome, issues, `${path}.outcome`);
    validateTriggerSignals(caseValue.triggerSignals, issues, `${path}.triggerSignals`);
    validateCaseReplay(caseValue.replay, issues, `${path}.replay`);
    validateCaseScorecard(caseValue.scorecard, issues, `${path}.scorecard`);
    validatePhase5Finding(caseValue.phase5Finding, issues, `${path}.phase5Finding`);
    validateGovernanceProvenance(caseValue.provenance, issues, `${path}.provenance`);
    validateCaseSafety(caseValue.safety, issues, `${path}.safety`);
    validateStringArray(caseValue.notes, issues, `${path}.notes`);
  });
}

function validateTriggerSignals(
  value: unknown,
  issues: IssueSink,
  path: string,
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "invalid_type", "triggerSignals must be an array.");
    return;
  }
  value.forEach((signal, index) => {
    validateEnum(RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_TRIGGER_SIGNALS, signal, issues, `${path}.${index}`);
  });
}

function validateCaseReplay(
  value: unknown,
  issues: IssueSink,
  path: string,
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "missing_required", "case replay metadata is required.");
    return;
  }
  requireNonEmptyString(value, "id", issues, `${path}.id`);
  requireNonEmptyString(value, "scenario", issues, `${path}.scenario`);
  requireNonEmptyString(value, "terminalStatus", issues, `${path}.terminalStatus`);
  requireNonEmptyString(value, "expectedTerminalStatus", issues, `${path}.expectedTerminalStatus`);
}

function validateCaseScorecard(
  value: unknown,
  issues: IssueSink,
  path: string,
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "missing_required", "case scorecard metadata is required.");
    return;
  }
  requireNonEmptyString(value, "aggregateDecision", issues, `${path}.aggregateDecision`);
  validateMetricRef(value.wrongFileEdit, issues, `${path}.wrongFileEdit`, "wrong_file_edit");
  validateMetricRef(value.unnecessaryEdit, issues, `${path}.unnecessaryEdit`, "unnecessary_edit");
}

function validateMetricRef(
  value: unknown,
  issues: IssueSink,
  path: string,
  expectedId: "wrong_file_edit" | "unnecessary_edit",
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "missing_required", "edit metric ref is required.");
    return;
  }
  if (value.id !== expectedId) {
    addIssue(issues, `${path}.id`, "invalid_enum", `metric id must be ${expectedId}.`);
  }
  requireNonEmptyString(value, "status", issues, `${path}.status`);
  requireNonEmptyString(value, "ref", issues, `${path}.ref`);
  validateScorecardProvenance(value.provenance, issues, `${path}.provenance`);
}

function validatePhase5Finding(
  value: unknown,
  issues: IssueSink,
  path: string,
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "missing_required", "Phase 5 finding metadata is required.");
    return;
  }
  requireNonEmptyString(value, "id", issues, `${path}.id`);
  if (value.ruleId !== "destructive_operation_guard") {
    addIssue(issues, `${path}.ruleId`, "invalid_enum", "Phase 5 finding must be destructive_operation_guard.");
  }
  requireNonEmptyString(value, "level", issues, `${path}.level`);
  requireNonEmptyString(value, "recommendation", issues, `${path}.recommendation`);
  if (value.futureActiveCandidate !== undefined) {
    if (!isRecord(value.futureActiveCandidate)) {
      addIssue(issues, `${path}.futureActiveCandidate`, "invalid_type", "futureActiveCandidate must be an object.");
    } else {
      if (value.futureActiveCandidate.action !== "block") {
        addIssue(issues, `${path}.futureActiveCandidate.action`, "invalid_enum", "future active action must be block.");
      }
      if (value.futureActiveCandidate.requiresAcceptedSpec !== true) {
        addIssue(
          issues,
          `${path}.futureActiveCandidate.requiresAcceptedSpec`,
          "invalid_authority",
          "future active candidate must require an accepted spec.",
        );
      }
    }
  }
}

function validateCaseSafety(
  value: unknown,
  issues: IssueSink,
  path: string,
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "missing_required", "case safety metadata is required.");
    return;
  }
  const expected = {
    advisoryReportActiveBlocking: false,
    advisoryReportAuthority: "none",
    completionProof: false,
    rawPayloadRetained: false,
  } as const;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      addIssue(issues, `${path}.${key}`, "invalid_authority", `${path}.${key} must remain ${String(expectedValue)}.`);
    }
  }
}

function validateReportCoverage(
  value: unknown,
  issues: IssueSink,
): void {
  if (!isRecord(value)) {
    addIssue(issues, "coverage", "missing_required", "Evidence proof coverage metadata is required.");
    return;
  }
  validateBooleanRecord(value.triggerSignals, RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_TRIGGER_SIGNALS, issues, "coverage.triggerSignals");
  validateBooleanRecord(value.falseBlockCases, RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_FALSE_BLOCK_CASES, issues, "coverage.falseBlockCases");
  if (!isRecord(value.provenance)) {
    addIssue(issues, "coverage.provenance", "missing_required", "coverage provenance metadata is required.");
  }
  if (!isRecord(value.safety)) {
    addIssue(issues, "coverage.safety", "missing_required", "coverage safety metadata is required.");
  }
  if (!isRecord(value.rollbackReadiness)) {
    addIssue(issues, "coverage.rollbackReadiness", "missing_required", "coverage rollback readiness metadata is required.");
    return;
  }
  if (value.rollbackReadiness.futureFlagDisableRollbackRequired !== true) {
    addIssue(
      issues,
      "coverage.rollbackReadiness.futureFlagDisableRollbackRequired",
      "invalid_authority",
      "future active behavior must require a flag-disable rollback plan.",
    );
  }
  if (value.rollbackReadiness.futureOwnerBoundary !== "tool_invocation_preflight") {
    addIssue(
      issues,
      "coverage.rollbackReadiness.futureOwnerBoundary",
      "invalid_enum",
      "future owner boundary must remain tool invocation preflight.",
    );
  }
  if (value.rollbackReadiness.activeConsumerBoundaryScanPlanned !== true) {
    addIssue(
      issues,
      "coverage.rollbackReadiness.activeConsumerBoundaryScanPlanned",
      "missing_required",
      "future specs must include an active consumer boundary scan plan.",
    );
  }
  if (value.rollbackReadiness.checkpointLifecycleAuthorityWriteAllowed !== false) {
    addIssue(
      issues,
      "coverage.rollbackReadiness.checkpointLifecycleAuthorityWriteAllowed",
      "invalid_authority",
      "checkpoint/lifecycle authority writes must remain forbidden.",
    );
  }
}

function validateBooleanRecord<const T extends readonly string[]>(
  value: unknown,
  keys: T,
  issues: IssueSink,
  path: string,
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "missing_required", `${path} is required.`);
    return;
  }
  for (const key of keys) {
    if (typeof value[key] !== "boolean") {
      addIssue(issues, `${path}.${key}`, "invalid_type", `${path}.${key} must be boolean.`);
    }
  }
}

function validateReportReadiness(
  value: unknown,
  issues: IssueSink,
): void {
  if (!isRecord(value)) {
    addIssue(issues, "readiness", "missing_required", "Evidence proof readiness metadata is required.");
    return;
  }
  validateEnum(
    ["evidence_conditions_met_not_active_runtime_ready", "needs_more_evidence"] as const,
    value.status,
    issues,
    "readiness.status",
  );
  if (value.activeRuntimeReady !== false) {
    addIssue(issues, "readiness.activeRuntimeReady", "invalid_authority", "Evidence proof is not active runtime readiness.");
  }
  if (typeof value.defaultOffLimitedActiveGuardCanBeProposedByFutureSpec !== "boolean") {
    addIssue(
      issues,
      "readiness.defaultOffLimitedActiveGuardCanBeProposedByFutureSpec",
      "invalid_type",
      "future-spec proposal marker must be boolean.",
    );
  }
  validateStringArray(value.reasons, issues, "readiness.reasons");
}

function validateReportSafety(
  value: unknown,
  issues: IssueSink,
): void {
  if (!isRecord(value)) {
    addIssue(issues, "safety", "missing_required", "Evidence proof safety metadata is required.");
    return;
  }
  const expected = {
    advisoryReportsOnly: true,
    scorecardsEvaluationMetadataOnly: true,
    activeRuntimeConsumer: false,
    toolBlockingBehaviorChanged: false,
    checkpointLifecycleAuthorityWrite: false,
    completionProof: false,
    rawPayloadRetained: false,
  } as const;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      addIssue(issues, `safety.${key}`, "invalid_authority", `safety.${key} must remain ${String(expectedValue)}.`);
    }
  }
}

function governanceProvenanceFromScorecard(
  provenance: RuntimeFailureTaskOutcomeScorecardProvenance,
): RuntimeFailureToolInvocationGovernanceProvenance {
  return {
    replayRefs: provenance.replayRefs,
    scorecardRefs: [],
    failureRefs: provenance.failureRefs,
    evidenceRefs: provenance.evidenceRefs,
    touchedPathRefs: provenance.touchedPathRefs,
  };
}

function sanitizeScorecardProvenance(
  value: RuntimeFailureTaskOutcomeScorecardProvenance,
): RuntimeFailureTaskOutcomeScorecardProvenance {
  return {
    replayRefs: uniqueRefs(value.replayRefs),
    failureRefs: uniqueRefs(value.failureRefs),
    evidenceRefs: uniqueRefs(value.evidenceRefs),
    touchedPathRefs: uniqueRefs(value.touchedPathRefs),
  };
}

function mergeGovernanceProvenance(
  values: RuntimeFailureToolInvocationGovernanceProvenance[],
): RuntimeFailureToolInvocationGovernanceProvenance {
  if (!values.length) {
    return EMPTY_GOVERNANCE_PROVENANCE;
  }
  return {
    replayRefs: uniqueRefs(values.flatMap((value) => value.replayRefs)),
    scorecardRefs: uniqueRefs(values.flatMap((value) => value.scorecardRefs)),
    failureRefs: uniqueRefs(values.flatMap((value) => value.failureRefs)),
    evidenceRefs: uniqueRefs(values.flatMap((value) => value.evidenceRefs)),
    touchedPathRefs: uniqueRefs(values.flatMap((value) => value.touchedPathRefs)),
  };
}

function validateGovernanceProvenance(
  value: unknown,
  issues: IssueSink,
  path: string,
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "missing_required", "governance provenance is required.");
    return;
  }
  for (const key of ["replayRefs", "scorecardRefs", "failureRefs", "evidenceRefs", "touchedPathRefs"] as const) {
    validateStringArray(value[key], issues, `${path}.${key}`);
  }
}

function validateScorecardProvenance(
  value: unknown,
  issues: IssueSink,
  path: string,
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "missing_required", "scorecard provenance is required.");
    return;
  }
  for (const key of ["replayRefs", "failureRefs", "evidenceRefs", "touchedPathRefs"] as const) {
    validateStringArray(value[key], issues, `${path}.${key}`);
  }
}

function uniqueEnumValues<const T extends readonly string[]>(
  order: T,
  values: T[number][],
): T[number][] {
  const set = new Set(values);
  return order.filter((value) => set.has(value));
}

function uniqueRefs(values: string[]): string[] {
  return [...new Set(values.map((value) => sanitizeText(value, REF_MAX_CHARS)).filter(isNonEmptyString))]
    .slice(0, REF_LIMIT);
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

function validateStringArray(value: unknown, issues: IssueSink, path: string): void {
  if (!isStringArray(value)) {
    addIssue(issues, path, "invalid_type", `${path} must be an array of strings.`);
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sanitizeIdentifier(value: unknown, fallback: string): string {
  const sanitized = sanitizeText(value, REF_MAX_CHARS)
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9:._/-]/g, "")
    .slice(0, REF_MAX_CHARS);
  return sanitized || fallback;
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
