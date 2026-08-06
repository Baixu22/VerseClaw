import {
  isEvidenceVerifierReport,
  type EvidenceVerifierDecision,
  type EvidenceVerifierFindingCode,
  type EvidenceVerifierReport,
} from "./evidence-verifier.js";
import {
  isRuntimeCoreJsonObject,
  type RuntimeCoreJsonObject,
} from "./types.js";

export const CODE_TASK_EVIDENCE_GATE_TASK_KINDS = [
  "code_edit",
  "non_code",
  "unknown",
] as const;

export type CodeTaskEvidenceGateTaskKind =
  (typeof CODE_TASK_EVIDENCE_GATE_TASK_KINDS)[number];

export const CODE_TASK_EVIDENCE_GATE_LEGACY_TERMINAL_STATUSES = [
  "complete",
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "error",
  "repair",
  "unknown",
] as const;

export type CodeTaskEvidenceGateLegacyTerminalStatus =
  (typeof CODE_TASK_EVIDENCE_GATE_LEGACY_TERMINAL_STATUSES)[number];

export const CODE_TASK_EVIDENCE_GATE_SHADOW_DECISIONS = [
  "would_allow",
  "would_block",
  "not_applicable",
  "invalid_input",
] as const;

export type CodeTaskEvidenceGateShadowDecision =
  (typeof CODE_TASK_EVIDENCE_GATE_SHADOW_DECISIONS)[number];

export const CODE_TASK_EVIDENCE_GATE_BLOCK_REASONS = [
  "missing_verifier_report",
  "verifier_failed",
  "verifier_blocked",
  "verifier_cancelled",
  "verifier_insufficient_evidence",
] as const;

export type CodeTaskEvidenceGateBlockReason =
  (typeof CODE_TASK_EVIDENCE_GATE_BLOCK_REASONS)[number];

export const CODE_TASK_EVIDENCE_GATE_EVIDENCE_CAPTURE_ISSUES = [
  "truly_missing_validation",
  "validation_done_but_not_captured",
  "external_validation_not_represented",
  "local_test_not_required",
  "report_task_id_or_shape_issue",
] as const;

export type CodeTaskEvidenceGateEvidenceCaptureIssue =
  (typeof CODE_TASK_EVIDENCE_GATE_EVIDENCE_CAPTURE_ISSUES)[number];

export const CODE_TASK_EVIDENCE_GATE_SEMANTIC_RISK_CODES = [
  "evidence_diff_mismatch",
  "weak_test_coverage",
  "changed_files_not_represented",
  "obligation_not_mapped_to_evidence",
  "semantic_regression_risk",
] as const;

export type CodeTaskEvidenceGateSemanticRiskCode =
  (typeof CODE_TASK_EVIDENCE_GATE_SEMANTIC_RISK_CODES)[number];

export const CODE_TASK_EVIDENCE_GATE_ALLOW_RISK_TIERS = [
  "clean_allow",
  "risky_allow",
] as const;

export type CodeTaskEvidenceGateAllowRiskTier =
  (typeof CODE_TASK_EVIDENCE_GATE_ALLOW_RISK_TIERS)[number];

export const CODE_TASK_EVIDENCE_GATE_SAMPLE_CATEGORIES = [
  "valid_full_evidence",
  "missing_validation_evidence",
  "tool_or_test_failure",
  "missing_verifier_report",
  "local_test_not_required",
  "external_validation_uncaptured",
  "non_code_task",
  "legacy_not_completed",
  "reviewer_inconclusive",
  "semantic_regression_with_complete_refs",
  "report_shape_issue",
  "other",
] as const;

export type CodeTaskEvidenceGateSampleCategory =
  (typeof CODE_TASK_EVIDENCE_GATE_SAMPLE_CATEGORIES)[number];

export const CODE_TASK_EVIDENCE_GATE_SHADOW_DIAGNOSTIC_CODES = [
  "invalid_shadow_input",
  "verifier_report_task_mismatch",
  "non_code_task",
  "legacy_not_completed",
  "missing_verifier_report",
  "verifier_completed",
  "verifier_failed",
  "verifier_blocked",
  "verifier_cancelled",
  "verifier_insufficient_evidence",
  "evidence_capture_truly_missing_validation",
  "evidence_capture_validation_done_but_not_captured",
  "evidence_capture_external_validation_not_represented",
  "evidence_capture_local_test_not_required",
  "evidence_capture_report_task_id_or_shape_issue",
  "evidence_diff_mismatch",
  "weak_test_coverage",
  "changed_files_not_represented",
  "obligation_not_mapped_to_evidence",
  "semantic_regression_risk",
] as const;

export type CodeTaskEvidenceGateShadowDiagnosticCode =
  (typeof CODE_TASK_EVIDENCE_GATE_SHADOW_DIAGNOSTIC_CODES)[number];

export type CodeTaskEvidenceGateShadowDiagnostic = {
  code: CodeTaskEvidenceGateShadowDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  verifierDecision?: EvidenceVerifierDecision;
  findingCodes?: EvidenceVerifierFindingCode[];
  evidenceCaptureIssue?: CodeTaskEvidenceGateEvidenceCaptureIssue;
  semanticRiskCodes?: CodeTaskEvidenceGateSemanticRiskCode[];
};

export type CodeTaskEvidenceGateShadowInput = {
  taskId: string;
  objective: string;
  taskKind: CodeTaskEvidenceGateTaskKind;
  legacyTerminalStatus: CodeTaskEvidenceGateLegacyTerminalStatus;
  verifierReport?: EvidenceVerifierReport;
  metadata?: RuntimeCoreJsonObject;
};

export type CodeTaskEvidenceGateShadowReport = {
  taskId: string;
  objective: string;
  decision: CodeTaskEvidenceGateShadowDecision;
  gateCandidate: boolean;
  wouldBlock: boolean;
  blockReason?: CodeTaskEvidenceGateBlockReason;
  evidenceCaptureIssue?: CodeTaskEvidenceGateEvidenceCaptureIssue;
  verifierDecision?: EvidenceVerifierDecision;
  verifierFindingCodes: EvidenceVerifierFindingCode[];
  allowRiskTier?: CodeTaskEvidenceGateAllowRiskTier;
  semanticRiskCodes: CodeTaskEvidenceGateSemanticRiskCode[];
  diagnostics: CodeTaskEvidenceGateShadowDiagnostic[];
  legacyDecisionUnaffected: true;
};

export type CodeTaskEvidenceGateShadowSummary = {
  sampleCount: number;
  gateCandidateCount: number;
  wouldAllowCount: number;
  wouldBlockCount: number;
  notApplicableCount: number;
  invalidInputCount: number;
  blockReasonCounts: Record<CodeTaskEvidenceGateBlockReason, number>;
  evidenceCaptureIssueCounts: Record<
    CodeTaskEvidenceGateEvidenceCaptureIssue,
    number
  >;
  allowRiskTierCounts: Record<CodeTaskEvidenceGateAllowRiskTier, number>;
  semanticRiskCounts: Record<CodeTaskEvidenceGateSemanticRiskCode, number>;
  verifierDecisionCounts: Record<EvidenceVerifierDecision | "missing_report", number>;
};

export const CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_MODES = [
  "disabled",
  "shadow_only",
] as const;

export type CodeTaskEvidenceGateShadowSamplerMode =
  (typeof CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_MODES)[number];

export const CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_OUTCOMES = [
  "not_sampled",
  "sampled",
  "invalid_input",
] as const;

export type CodeTaskEvidenceGateShadowSamplerOutcome =
  (typeof CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_OUTCOMES)[number];

export const CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_DIAGNOSTIC_CODES = [
  "sampler_disabled",
  "sampler_invalid_input",
  "sampler_shadow_sampled",
  "sampler_non_authoritative",
] as const;

export type CodeTaskEvidenceGateShadowSamplerDiagnosticCode =
  (typeof CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_DIAGNOSTIC_CODES)[number];

export type CodeTaskEvidenceGateShadowSamplerDiagnostic = {
  code: CodeTaskEvidenceGateShadowSamplerDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
};

export type CodeTaskEvidenceGateShadowSamplerInput = {
  samplerId: string;
  sampleId: string;
  mode?: CodeTaskEvidenceGateShadowSamplerMode;
  input: unknown;
  metadata?: RuntimeCoreJsonObject;
};

export type CodeTaskEvidenceGateShadowSamplerEvent = {
  eventKind: "code_task_evidence_gate_shadow_sample";
  samplerId: string;
  sampleId: string;
  taskId: string;
  mode: CodeTaskEvidenceGateShadowSamplerMode;
  outcome: CodeTaskEvidenceGateShadowSamplerOutcome;
  sampled: boolean;
  shadowDecision?: CodeTaskEvidenceGateShadowDecision;
  gateCandidate?: boolean;
  wouldBlock?: boolean;
  blockReason?: CodeTaskEvidenceGateBlockReason;
  evidenceCaptureIssue?: CodeTaskEvidenceGateEvidenceCaptureIssue;
  verifierDecision?: EvidenceVerifierDecision;
  verifierFindingCodes: EvidenceVerifierFindingCode[];
  allowRiskTier?: CodeTaskEvidenceGateAllowRiskTier;
  semanticRiskCodes: CodeTaskEvidenceGateSemanticRiskCode[];
  diagnosticCodes: CodeTaskEvidenceGateShadowSamplerDiagnosticCode[];
  diagnostics: CodeTaskEvidenceGateShadowSamplerDiagnostic[];
  nonAuthoritative: true;
  completionAuthority: false;
  retention: "caller_owned_non_persistent";
  legacyDecisionUnaffected: true;
};

export type CodeTaskEvidenceGateShadowSamplerSummary = {
  eventCount: number;
  sampledCount: number;
  notSampledCount: number;
  invalidSamplerInputCount: number;
  invalidShadowInputCount: number;
  gateCandidateCount: number;
  wouldAllowCount: number;
  wouldBlockCount: number;
  riskyAllowCount: number;
  modeCounts: Record<CodeTaskEvidenceGateShadowSamplerMode, number>;
  outcomeCounts: Record<CodeTaskEvidenceGateShadowSamplerOutcome, number>;
  shadowDecisionCounts: Record<
    CodeTaskEvidenceGateShadowDecision | "not_sampled",
    number
  >;
  blockReasonCounts: Record<CodeTaskEvidenceGateBlockReason, number>;
  evidenceCaptureIssueCounts: Record<
    CodeTaskEvidenceGateEvidenceCaptureIssue,
    number
  >;
  allowRiskTierCounts: Record<CodeTaskEvidenceGateAllowRiskTier, number>;
  semanticRiskCounts: Record<CodeTaskEvidenceGateSemanticRiskCode, number>;
  diagnosticCodeCounts: Record<
    CodeTaskEvidenceGateShadowSamplerDiagnosticCode,
    number
  >;
  nonAuthoritativeCount: number;
  completionAuthorityCount: 0;
  retention: "caller_owned_non_persistent";
  legacyDecisionUnaffected: true;
};

export const CODE_TASK_EVIDENCE_GATE_RUNTIME_CALLER_OUTCOMES = [
  "disabled",
  "sampled",
  "invalid_input",
] as const;

export type CodeTaskEvidenceGateRuntimeCallerOutcome =
  (typeof CODE_TASK_EVIDENCE_GATE_RUNTIME_CALLER_OUTCOMES)[number];

export const CODE_TASK_EVIDENCE_GATE_RUNTIME_CALLER_DIAGNOSTIC_CODES = [
  "runtime_shadow_sampler_disabled",
  "runtime_shadow_sampler_invalid_input",
  "runtime_shadow_sampler_sampled",
  "runtime_shadow_sampler_non_authoritative",
] as const;

export type CodeTaskEvidenceGateRuntimeCallerDiagnosticCode =
  (typeof CODE_TASK_EVIDENCE_GATE_RUNTIME_CALLER_DIAGNOSTIC_CODES)[number];

export type CodeTaskEvidenceGateRuntimeCallerDiagnostic = {
  code: CodeTaskEvidenceGateRuntimeCallerDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
};

export type CodeTaskEvidenceGateRuntimeCallerInput = {
  callerId: string;
  completionEventId: string;
  mode?: CodeTaskEvidenceGateShadowSamplerMode;
  samplerId?: string;
  sampleId?: string;
  shadowInput?: unknown;
  metadata?: RuntimeCoreJsonObject;
};

export type CodeTaskEvidenceGateRuntimeCallerResult = {
  callerId: string;
  completionEventId: string;
  mode: CodeTaskEvidenceGateShadowSamplerMode;
  outcome: CodeTaskEvidenceGateRuntimeCallerOutcome;
  sampled: boolean;
  taskId: string;
  samplerEvent?: CodeTaskEvidenceGateShadowSamplerEvent;
  diagnosticCodes: CodeTaskEvidenceGateRuntimeCallerDiagnosticCode[];
  diagnostics: CodeTaskEvidenceGateRuntimeCallerDiagnostic[];
  nonAuthoritative: true;
  completionAuthority: false;
  runtimeDecisionUnaffected: true;
  legacyDecisionUnaffected: true;
};

export type CodeTaskEvidenceGateRuntimeCallerSummary = {
  resultCount: number;
  sampledCount: number;
  disabledCount: number;
  invalidInputCount: number;
  modeCounts: Record<CodeTaskEvidenceGateShadowSamplerMode, number>;
  outcomeCounts: Record<CodeTaskEvidenceGateRuntimeCallerOutcome, number>;
  diagnosticCodeCounts: Record<
    CodeTaskEvidenceGateRuntimeCallerDiagnosticCode,
    number
  >;
  samplerSummary: CodeTaskEvidenceGateShadowSamplerSummary;
  nonAuthoritativeCount: number;
  completionAuthorityCount: 0;
  runtimeDecisionUnaffectedCount: number;
  legacyDecisionUnaffected: true;
};

export const CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_PRODUCER_OUTCOMES = [
  "disabled",
  "sampled",
  "invalid_input",
] as const;

export type CodeTaskEvidenceGateRuntimeShadowProducerOutcome =
  (typeof CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_PRODUCER_OUTCOMES)[number];

export const CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_PRODUCER_DIAGNOSTIC_CODES = [
  "runtime_shadow_producer_disabled",
  "runtime_shadow_producer_invalid_input",
  "runtime_shadow_producer_sampled",
  "runtime_shadow_producer_would_block",
  "runtime_shadow_producer_risky_allow",
  "runtime_shadow_producer_non_authoritative",
] as const;

export type CodeTaskEvidenceGateRuntimeShadowProducerDiagnosticCode =
  (typeof CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_PRODUCER_DIAGNOSTIC_CODES)[number];

export type CodeTaskEvidenceGateRuntimeShadowProducerDiagnostic = {
  code: CodeTaskEvidenceGateRuntimeShadowProducerDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
};

export type CodeTaskEvidenceGateRuntimeShadowProducerCompletion = {
  taskId: string;
  objective: string;
  taskKind: CodeTaskEvidenceGateTaskKind;
  legacyTerminalStatus: CodeTaskEvidenceGateLegacyTerminalStatus;
  verifierReport?: EvidenceVerifierReport;
  metadata?: RuntimeCoreJsonObject;
};

export type CodeTaskEvidenceGateRuntimeShadowProducerInput = {
  producerId: string;
  completionEventId: string;
  mode?: CodeTaskEvidenceGateShadowSamplerMode;
  samplerId?: string;
  sampleId?: string;
  completion?: CodeTaskEvidenceGateRuntimeShadowProducerCompletion;
  metadata?: RuntimeCoreJsonObject;
};

export type CodeTaskEvidenceGateRuntimeShadowProducerResult = {
  producerId: string;
  completionEventId: string;
  mode: CodeTaskEvidenceGateShadowSamplerMode;
  outcome: CodeTaskEvidenceGateRuntimeShadowProducerOutcome;
  sampled: boolean;
  taskId: string;
  callerInput?: CodeTaskEvidenceGateRuntimeCallerInput;
  callerResult?: CodeTaskEvidenceGateRuntimeCallerResult;
  shadowDecision?: CodeTaskEvidenceGateShadowDecision;
  blockReason?: CodeTaskEvidenceGateBlockReason;
  allowRiskTier?: CodeTaskEvidenceGateAllowRiskTier;
  semanticRiskCodes: CodeTaskEvidenceGateSemanticRiskCode[];
  diagnosticCodes: CodeTaskEvidenceGateRuntimeShadowProducerDiagnosticCode[];
  diagnostics: CodeTaskEvidenceGateRuntimeShadowProducerDiagnostic[];
  nonAuthoritative: true;
  completionAuthority: false;
  runtimeDecisionUnaffected: true;
  legacyDecisionUnaffected: true;
};

export const CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_DEFAULT_MAX_SAMPLES =
  20;

export const CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_OUTCOMES = [
  "disabled",
  "collected",
  "invalid_input",
] as const;

export type CodeTaskEvidenceGateRuntimeShadowCollectionOutcome =
  (typeof CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_OUTCOMES)[number];

export const CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_DIAGNOSTIC_CODES = [
  "runtime_shadow_collection_disabled",
  "runtime_shadow_collection_invalid_input",
  "runtime_shadow_collection_sample_limit_applied",
  "runtime_shadow_collection_collected",
  "runtime_shadow_collection_non_authoritative",
  "runtime_shadow_collection_active_pilot_still_requires_fresh_spec",
] as const;

export type CodeTaskEvidenceGateRuntimeShadowCollectionDiagnosticCode =
  (typeof CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_DIAGNOSTIC_CODES)[number];

export type CodeTaskEvidenceGateRuntimeShadowCollectionDiagnostic = {
  code: CodeTaskEvidenceGateRuntimeShadowCollectionDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
};

export type CodeTaskEvidenceGateRuntimeShadowCollectionSample = {
  collectionSampleId: string;
  producerInput: unknown;
  manualReviewLabel?: CodeTaskEvidenceGateManualReviewLabel;
  category?: CodeTaskEvidenceGateSampleCategory;
  notes?: string;
  metadata?: RuntimeCoreJsonObject;
};

export type CodeTaskEvidenceGateRuntimeShadowCollectionInput = {
  collectorId: string;
  mode?: CodeTaskEvidenceGateShadowSamplerMode;
  maxSamples?: number;
  samples?: CodeTaskEvidenceGateRuntimeShadowCollectionSample[];
  readinessThresholds?: Partial<
    CodeTaskEvidenceGateRuntimeReplayReadinessThresholds
  >;
  metadata?: RuntimeCoreJsonObject;
};

export type CodeTaskEvidenceGateRuntimeShadowCollectionEntry = {
  collectionSampleId: string;
  producerResult: CodeTaskEvidenceGateRuntimeShadowProducerResult;
  replaySample?: CodeTaskEvidenceGateRuntimeReplaySample;
};

export type CodeTaskEvidenceGateRuntimeShadowCollectionResult = {
  collectorId: string;
  mode: CodeTaskEvidenceGateShadowSamplerMode;
  outcome: CodeTaskEvidenceGateRuntimeShadowCollectionOutcome;
  requestedSampleCount: number;
  acceptedSampleCount: number;
  droppedSampleCount: number;
  sampledCount: number;
  disabledCount: number;
  invalidInputCount: number;
  replaySampleCount: number;
  entries: CodeTaskEvidenceGateRuntimeShadowCollectionEntry[];
  replayReport?: CodeTaskEvidenceGateRuntimeReplayReport;
  replayReadiness?: CodeTaskEvidenceGateRuntimeReplayReadinessReport;
  diagnosticCodes: CodeTaskEvidenceGateRuntimeShadowCollectionDiagnosticCode[];
  diagnostics: CodeTaskEvidenceGateRuntimeShadowCollectionDiagnostic[];
  nonAuthoritative: true;
  completionAuthority: false;
  runtimeDecisionUnaffected: true;
  legacyDecisionUnaffected: true;
};

export type CodeTaskEvidenceGateRuntimeShadowCollectionOptions = {
  buildProducerResult?: (
    input: unknown,
  ) => CodeTaskEvidenceGateRuntimeShadowProducerResult;
};

export const CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DEFAULT_MAX_COLLECTIONS =
  50;

export const CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_OUTCOMES = [
  "disabled",
  "observed",
  "invalid_input",
] as const;

export type CodeTaskEvidenceGateInternalShadowObservationOutcome =
  (typeof CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_OUTCOMES)[number];

export const CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DECISIONS = [
  "ready_for_limited_default_off_internal_shadow_observation_review",
  "continue_internal_shadow_observation_hardening",
  "stop_or_freeze_route",
] as const;

export type CodeTaskEvidenceGateInternalShadowObservationDecision =
  (typeof CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DECISIONS)[number];

export const CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DIAGNOSTIC_CODES = [
  "internal_shadow_observation_disabled",
  "internal_shadow_observation_invalid_input",
  "internal_shadow_observation_collection_limit_applied",
  "internal_shadow_observation_no_collections",
  "internal_shadow_observation_observed",
  "internal_shadow_observation_replay_ready_for_review",
  "internal_shadow_observation_replay_continue_hardening",
  "internal_shadow_observation_replay_blocked",
  "internal_shadow_observation_non_authoritative",
  "internal_shadow_observation_active_pilot_still_forbidden",
] as const;

export type CodeTaskEvidenceGateInternalShadowObservationDiagnosticCode =
  (typeof CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DIAGNOSTIC_CODES)[number];

export type CodeTaskEvidenceGateInternalShadowObservationDiagnostic = {
  code: CodeTaskEvidenceGateInternalShadowObservationDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
};

export type CodeTaskEvidenceGateInternalShadowObservationInput = {
  observerId: string;
  mode?: CodeTaskEvidenceGateShadowSamplerMode;
  maxCollections?: number;
  collections?: CodeTaskEvidenceGateRuntimeShadowCollectionResult[];
  readinessThresholds?: Partial<
    CodeTaskEvidenceGateRuntimeReplayReadinessThresholds
  >;
  metadata?: RuntimeCoreJsonObject;
};

export type CodeTaskEvidenceGateInternalShadowObservationResult = {
  observerId: string;
  mode: CodeTaskEvidenceGateShadowSamplerMode;
  outcome: CodeTaskEvidenceGateInternalShadowObservationOutcome;
  observationDecision: CodeTaskEvidenceGateInternalShadowObservationDecision;
  requestedCollectionCount: number;
  acceptedCollectionCount: number;
  droppedCollectionCount: number;
  collectedCollectionCount: number;
  disabledCollectionCount: number;
  invalidCollectionCount: number;
  requestedSampleCount: number;
  acceptedSampleCount: number;
  sampledCount: number;
  replaySampleCount: number;
  wouldBlockCount: number;
  riskyAllowCount: number;
  replayReadinessDecision?: CodeTaskEvidenceGateRuntimeReplayReadinessDecision;
  replayReport?: CodeTaskEvidenceGateRuntimeReplayReport;
  replayReadiness?: CodeTaskEvidenceGateRuntimeReplayReadinessReport;
  diagnosticCodes: CodeTaskEvidenceGateInternalShadowObservationDiagnosticCode[];
  diagnostics: CodeTaskEvidenceGateInternalShadowObservationDiagnostic[];
  nonAuthoritative: true;
  completionAuthority: false;
  runtimeDecisionUnaffected: true;
  legacyDecisionUnaffected: true;
  activePilotRequiresFreshSpec: true;
};

export const CODE_TASK_EVIDENCE_GATE_MANUAL_REVIEW_LABELS = [
  "valid_completion",
  "bad_completion",
  "inconclusive",
] as const;

export type CodeTaskEvidenceGateManualReviewLabel =
  (typeof CODE_TASK_EVIDENCE_GATE_MANUAL_REVIEW_LABELS)[number];

export const CODE_TASK_EVIDENCE_GATE_EVALUATION_OUTCOMES = [
  "true_allow",
  "useful_block",
  "false_block",
  "false_allow",
  "inconclusive",
  "not_evaluated",
] as const;

export type CodeTaskEvidenceGateEvaluationOutcome =
  (typeof CODE_TASK_EVIDENCE_GATE_EVALUATION_OUTCOMES)[number];

export type CodeTaskEvidenceGateEvaluationSample = {
  sampleId: string;
  input: CodeTaskEvidenceGateShadowInput;
  manualReviewLabel: CodeTaskEvidenceGateManualReviewLabel;
  category?: CodeTaskEvidenceGateSampleCategory;
  notes?: string;
  metadata?: RuntimeCoreJsonObject;
};

export type CodeTaskEvidenceGateEvaluationResult = {
  sampleId: string;
  manualReviewLabel: CodeTaskEvidenceGateManualReviewLabel;
  category?: CodeTaskEvidenceGateSampleCategory;
  outcome: CodeTaskEvidenceGateEvaluationOutcome;
  report: CodeTaskEvidenceGateShadowReport;
};

export type CodeTaskEvidenceGateEvaluationSummary = {
  sampleCount: number;
  gateCandidateCount: number;
  evaluatedCandidateCount: number;
  trueAllowCount: number;
  usefulBlockCount: number;
  falseBlockCount: number;
  falseAllowCount: number;
  inconclusiveCount: number;
  notEvaluatedCount: number;
  blockPrecision: number | undefined;
  blockRecall: number | undefined;
  falseBlockRate: number | undefined;
  falseAllowRate: number | undefined;
  usefulBlockFalseBlockRatio: number | undefined;
  riskyAllowCount: number;
  riskyFalseAllowCount: number;
  riskyFalseAllowShare: number | undefined;
  categoryCounts: Record<CodeTaskEvidenceGateSampleCategory, number>;
  falseBlockCauseCounts: Record<
    CodeTaskEvidenceGateEvidenceCaptureIssue,
    number
  >;
  shadowSummary: CodeTaskEvidenceGateShadowSummary;
};

export type CodeTaskEvidenceGateEvaluationReport = {
  summary: CodeTaskEvidenceGateEvaluationSummary;
  results: CodeTaskEvidenceGateEvaluationResult[];
  legacyDecisionUnaffected: true;
};

export type CodeTaskEvidenceGateRuntimeReplaySample = {
  replayId: string;
  callerInput: CodeTaskEvidenceGateRuntimeCallerInput;
  manualReviewLabel?: CodeTaskEvidenceGateManualReviewLabel;
  category?: CodeTaskEvidenceGateSampleCategory;
  notes?: string;
  metadata?: RuntimeCoreJsonObject;
};

export type CodeTaskEvidenceGateRuntimeReplayResult = {
  replayId: string;
  manualReviewLabel?: CodeTaskEvidenceGateManualReviewLabel;
  category?: CodeTaskEvidenceGateSampleCategory;
  outcome: CodeTaskEvidenceGateEvaluationOutcome;
  callerResult: CodeTaskEvidenceGateRuntimeCallerResult;
};

export type CodeTaskEvidenceGateRuntimeReplaySummary = {
  sampleCount: number;
  sampledCount: number;
  disabledCount: number;
  invalidInputCount: number;
  evaluatedCandidateCount: number;
  trueAllowCount: number;
  usefulBlockCount: number;
  falseBlockCount: number;
  falseAllowCount: number;
  inconclusiveCount: number;
  notEvaluatedCount: number;
  blockPrecision: number | undefined;
  blockRecall: number | undefined;
  falseBlockRate: number | undefined;
  falseAllowRate: number | undefined;
  usefulBlockFalseBlockRatio: number | undefined;
  riskyAllowCount: number;
  riskyFalseAllowCount: number;
  riskyFalseAllowShare: number | undefined;
  nonAuthoritativeCount: number;
  completionAuthorityCount: 0;
  runtimeDecisionUnaffectedCount: number;
  callerSummary: CodeTaskEvidenceGateRuntimeCallerSummary;
};

export type CodeTaskEvidenceGateRuntimeReplayReport = {
  summary: CodeTaskEvidenceGateRuntimeReplaySummary;
  results: CodeTaskEvidenceGateRuntimeReplayResult[];
  runtimeDecisionUnaffected: true;
  legacyDecisionUnaffected: true;
};

export const CODE_TASK_EVIDENCE_GATE_RUNTIME_REPLAY_READINESS_DECISIONS = [
  "ready_for_shadow_evidence_review",
  "continue_runtime_shadow_replay",
  "blocked",
] as const;

export type CodeTaskEvidenceGateRuntimeReplayReadinessDecision =
  (typeof CODE_TASK_EVIDENCE_GATE_RUNTIME_REPLAY_READINESS_DECISIONS)[number];

export const CODE_TASK_EVIDENCE_GATE_RUNTIME_REPLAY_READINESS_DIAGNOSTIC_CODES = [
  "runtime_replay_min_samples_not_met",
  "runtime_replay_min_evaluated_candidates_not_met",
  "runtime_replay_block_precision_missing",
  "runtime_replay_block_precision_below_threshold",
  "runtime_replay_false_block_rate_above_threshold",
  "runtime_replay_false_allow_rate_above_threshold",
  "runtime_replay_useful_block_ratio_missing",
  "runtime_replay_useful_block_ratio_below_threshold",
  "runtime_replay_risky_false_allow_share_below_threshold",
  "runtime_replay_non_authority_violation",
  "runtime_replay_active_pilot_still_requires_fresh_spec",
  "runtime_replay_thresholds_met",
] as const;

export type CodeTaskEvidenceGateRuntimeReplayReadinessDiagnosticCode =
  (typeof CODE_TASK_EVIDENCE_GATE_RUNTIME_REPLAY_READINESS_DIAGNOSTIC_CODES)[number];

export type CodeTaskEvidenceGateRuntimeReplayReadinessThresholds = {
  minSamples: number;
  minEvaluatedCandidates: number;
  minBlockPrecision: number;
  maxFalseBlockRate: number;
  maxFalseAllowRate: number;
  minUsefulBlockFalseBlockRatio: number;
  minRiskyFalseAllowShare?: number;
};

export type CodeTaskEvidenceGateRuntimeReplayReadinessDiagnostic = {
  code: CodeTaskEvidenceGateRuntimeReplayReadinessDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  actual?: number;
  threshold?: number;
};

export type CodeTaskEvidenceGateRuntimeReplayReadinessReport = {
  decision: CodeTaskEvidenceGateRuntimeReplayReadinessDecision;
  thresholds: CodeTaskEvidenceGateRuntimeReplayReadinessThresholds;
  metrics: {
    sampleCount: number;
    sampledCount: number;
    evaluatedCandidateCount: number;
    blockPrecision?: number;
    falseBlockRate?: number;
    falseAllowRate?: number;
    usefulBlockFalseBlockRatio?: number;
    riskyFalseAllowShare?: number;
    nonAuthoritativeCount: number;
    completionAuthorityCount: 0;
    runtimeDecisionUnaffectedCount: number;
  };
  diagnostics: CodeTaskEvidenceGateRuntimeReplayReadinessDiagnostic[];
  activePilotRequiresFreshSpec: true;
  runtimeDecisionUnaffected: true;
  legacyDecisionUnaffected: true;
};

export const CODE_TASK_EVIDENCE_GATE_READINESS_STAGES = [
  "offline_corpus",
  "shadow_sampler",
  "active_pilot",
] as const;

export type CodeTaskEvidenceGateReadinessStage =
  (typeof CODE_TASK_EVIDENCE_GATE_READINESS_STAGES)[number];

export const CODE_TASK_EVIDENCE_GATE_READINESS_DECISIONS = [
  "ready",
  "needs_more_evidence",
  "blocked",
] as const;

export type CodeTaskEvidenceGateReadinessDecision =
  (typeof CODE_TASK_EVIDENCE_GATE_READINESS_DECISIONS)[number];

export const CODE_TASK_EVIDENCE_GATE_READINESS_DIAGNOSTIC_CODES = [
  "min_samples_not_met",
  "min_candidates_not_met",
  "block_precision_missing",
  "block_precision_below_threshold",
  "block_recall_missing",
  "block_recall_below_threshold",
  "false_block_rate_above_threshold",
  "false_allow_rate_above_threshold",
  "useful_block_false_block_ratio_missing",
  "useful_block_false_block_ratio_below_threshold",
  "inconclusive_rate_above_threshold",
  "missing_report_share_above_threshold",
  "runtime_shadow_evidence_required",
  "runtime_shadow_samples_below_threshold",
  "readiness_thresholds_met",
] as const;

export type CodeTaskEvidenceGateReadinessDiagnosticCode =
  (typeof CODE_TASK_EVIDENCE_GATE_READINESS_DIAGNOSTIC_CODES)[number];

export type CodeTaskEvidenceGateReadinessThresholds = {
  minSamples: number;
  minEvaluatedCandidates: number;
  minBlockPrecision?: number;
  minBlockRecall?: number;
  maxFalseBlockRate?: number;
  maxFalseAllowRate?: number;
  minUsefulBlockFalseBlockRatio?: number;
  maxInconclusiveRate?: number;
  maxMissingReportShare?: number;
  minRuntimeShadowSamples?: number;
};

export type CodeTaskEvidenceGateRuntimeShadowEvidence = {
  sampleCount: number;
  evaluatedCandidateCount: number;
  usefulBlockCount: number;
  falseBlockCount: number;
  falseAllowCount: number;
};

export type CodeTaskEvidenceGateReadinessDiagnostic = {
  code: CodeTaskEvidenceGateReadinessDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  actual?: number;
  threshold?: number;
};

export type CodeTaskEvidenceGateReadinessReport = {
  stage: CodeTaskEvidenceGateReadinessStage;
  decision: CodeTaskEvidenceGateReadinessDecision;
  thresholds: CodeTaskEvidenceGateReadinessThresholds;
  diagnostics: CodeTaskEvidenceGateReadinessDiagnostic[];
  metrics: {
    sampleCount: number;
    evaluatedCandidateCount: number;
    blockPrecision?: number;
    blockRecall?: number;
    falseBlockRate?: number;
    falseAllowRate?: number;
    usefulBlockFalseBlockRatio?: number;
    riskyFalseAllowShare?: number;
    inconclusiveRate?: number;
    missingReportShare?: number;
    runtimeShadowSampleCount?: number;
  };
  legacyDecisionUnaffected: true;
};

export const CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_QUALITY_DECISIONS = [
  "ready_for_limited_default_off_readiness_review",
  "continue_internal_shadow_observation_hardening",
  "stop_or_freeze_route",
] as const;

export type CodeTaskEvidenceGateShadowEvidenceQualityDecision =
  (typeof CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_QUALITY_DECISIONS)[number];

export const CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_QUALITY_DIAGNOSTIC_CODES = [
  "shadow_evidence_quality_no_input",
  "shadow_evidence_quality_incomplete_inputs",
  "shadow_evidence_quality_false_block_causes_covered",
  "shadow_evidence_quality_false_block_causes_incomplete",
  "shadow_evidence_quality_risky_false_allows_covered",
  "shadow_evidence_quality_risky_false_allows_incomplete",
  "shadow_evidence_quality_runtime_replay_ready",
  "shadow_evidence_quality_runtime_replay_continue_hardening",
  "shadow_evidence_quality_runtime_replay_blocked",
  "shadow_evidence_quality_observation_ready",
  "shadow_evidence_quality_observation_continue_hardening",
  "shadow_evidence_quality_observation_stop_or_freeze",
  "shadow_evidence_quality_non_authoritative",
  "shadow_evidence_quality_active_pilot_still_requires_fresh_spec",
] as const;

export type CodeTaskEvidenceGateShadowEvidenceQualityDiagnosticCode =
  (typeof CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_QUALITY_DIAGNOSTIC_CODES)[number];

export type CodeTaskEvidenceGateShadowEvidenceQualityDiagnostic = {
  code: CodeTaskEvidenceGateShadowEvidenceQualityDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  actual?: number;
  threshold?: number;
};

export type CodeTaskEvidenceGateShadowEvidenceQualityInput = {
  evaluation?: CodeTaskEvidenceGateEvaluationReport;
  runtimeReplayReadiness?: CodeTaskEvidenceGateRuntimeReplayReadinessReport;
  internalObservation?: CodeTaskEvidenceGateInternalShadowObservationResult;
};

export type CodeTaskEvidenceGateShadowEvidenceQualityReport = {
  decision: CodeTaskEvidenceGateShadowEvidenceQualityDecision;
  metrics: {
    offlineSampleCount: number;
    offlineEvaluatedCandidateCount: number;
    falseBlockCount: number;
    falseBlockCauseClassifiedCount: number;
    falseBlockCauseCoverageRate?: number;
    falseAllowCount: number;
    riskyFalseAllowCount: number;
    riskyFalseAllowShare?: number;
    runtimeReplayDecision?: CodeTaskEvidenceGateRuntimeReplayReadinessDecision;
    runtimeReplaySampleCount: number;
    internalObservationDecision?: CodeTaskEvidenceGateInternalShadowObservationDecision;
    internalObservationSampleCount: number;
    nonAuthorityParity: boolean;
  };
  diagnosticCodes: CodeTaskEvidenceGateShadowEvidenceQualityDiagnosticCode[];
  diagnostics: CodeTaskEvidenceGateShadowEvidenceQualityDiagnostic[];
  nonAuthoritative: true;
  completionAuthority: false;
  runtimeDecisionUnaffected: true;
  legacyDecisionUnaffected: true;
  activePilotRequiresFreshSpec: true;
};

export const CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_REQUIRED_CATEGORIES = [
  "valid_full_evidence",
  "missing_validation_evidence",
  "tool_or_test_failure",
  "missing_verifier_report",
  "local_test_not_required",
  "external_validation_uncaptured",
  "non_code_task",
  "legacy_not_completed",
  "reviewer_inconclusive",
  "semantic_regression_with_complete_refs",
  "report_shape_issue",
] as const;

export const CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_DIAGNOSTIC_CODES = [
  "shadow_evidence_optimization_strategy_ready",
  "shadow_evidence_optimization_strategy_continue_hardening",
  "shadow_evidence_optimization_strategy_stop_or_freeze",
  "shadow_evidence_optimization_matrix_complete",
  "shadow_evidence_optimization_matrix_incomplete",
  "shadow_evidence_optimization_min_samples_not_met",
  "shadow_evidence_optimization_min_evaluated_candidates_not_met",
  "shadow_evidence_optimization_block_precision_missing",
  "shadow_evidence_optimization_block_precision_below_threshold",
  "shadow_evidence_optimization_false_block_rate_missing",
  "shadow_evidence_optimization_false_block_rate_above_threshold",
  "shadow_evidence_optimization_false_allow_rate_missing",
  "shadow_evidence_optimization_false_allow_rate_above_threshold",
  "shadow_evidence_optimization_non_authoritative",
  "shadow_evidence_optimization_active_pilot_still_forbidden",
] as const;

export type CodeTaskEvidenceGateShadowEvidenceOptimizationDiagnosticCode =
  (typeof CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_DIAGNOSTIC_CODES)[number];

export const CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_CAPABILITY_SHORTFALL_CODES = [
  "quality_strategy_not_ready",
  "sample_count_below_threshold",
  "evaluated_candidate_count_below_threshold",
  "fixture_matrix_incomplete",
  "block_precision_missing",
  "block_precision_below_threshold",
  "false_block_rate_missing",
  "false_block_rate_above_threshold",
  "false_allow_rate_missing",
  "false_allow_rate_above_threshold",
  "false_block_cause_coverage_incomplete",
  "risky_false_allow_share_below_threshold",
  "authority_parity_broken",
] as const;

export type CodeTaskEvidenceGateShadowEvidenceOptimizationCapabilityShortfallCode =
  (typeof CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_CAPABILITY_SHORTFALL_CODES)[number];

export type CodeTaskEvidenceGateShadowEvidenceOptimizationDiagnostic = {
  code: CodeTaskEvidenceGateShadowEvidenceOptimizationDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  actual?: number;
  threshold?: number;
};

export type CodeTaskEvidenceGateShadowEvidenceOptimizationFixtureMatrixSummary = {
  categoryCounts?: Partial<Record<CodeTaskEvidenceGateSampleCategory, number>>;
  runtimeReplayDecisionCounts?: Partial<
    Record<CodeTaskEvidenceGateRuntimeReplayReadinessDecision, number>
  >;
  internalObservationDecisionCounts?: Partial<
    Record<CodeTaskEvidenceGateInternalShadowObservationDecision, number>
  >;
  blockedOrFreezeReasons?: readonly string[];
};

export type CodeTaskEvidenceGateShadowEvidenceOptimizationInput =
  CodeTaskEvidenceGateShadowEvidenceQualityInput & {
    fixtureMatrix?: CodeTaskEvidenceGateShadowEvidenceOptimizationFixtureMatrixSummary;
  };

export type CodeTaskEvidenceGateShadowEvidenceOptimizationReport = {
  decision: CodeTaskEvidenceGateShadowEvidenceQualityDecision;
  qualityReport: CodeTaskEvidenceGateShadowEvidenceQualityReport;
  strategy: {
    qualityDecision: CodeTaskEvidenceGateShadowEvidenceQualityDecision;
    falseBlockCauseCoverageRate?: number;
    riskyFalseAllowShare?: number;
    nonAuthorityParity: boolean;
  };
  quantification: {
    sampleCount: number;
    evaluatedCandidateCount: number;
    blockPrecision?: number;
    blockRecall?: number;
    falseBlockRate?: number;
    falseAllowRate?: number;
    riskyFalseAllowShare?: number;
    falseBlockCauseCoverageRate?: number;
    falseBlockCauseCounts: Record<
      CodeTaskEvidenceGateEvidenceCaptureIssue,
      number
    >;
    riskyFalseAllowSignalCounts: Record<
      CodeTaskEvidenceGateSemanticRiskCode,
      number
    >;
    categoryCounts: Record<CodeTaskEvidenceGateSampleCategory, number>;
    coveredRequiredCategoryCount: number;
    requiredCategoryCount: number;
    matrixCoverageRate?: number;
    runtimeReplayDecisionCounts: Record<
      CodeTaskEvidenceGateRuntimeReplayReadinessDecision,
      number
    >;
    internalObservationDecisionCounts: Record<
      CodeTaskEvidenceGateInternalShadowObservationDecision,
      number
    >;
    blockedOrFreezeReasons: string[];
  };
  capabilityAssessment: {
    passed: boolean;
    thresholds: {
      minSamples: number;
      minEvaluatedCandidates: number;
      minBlockPrecision: number;
      maxFalseBlockRate: number;
      maxFalseAllowRate: number;
      minRiskyFalseAllowShare: number;
      requiredFalseBlockCauseCoverageRate: 1;
      requiredMatrixCoverageRate: 1;
    };
    metricMargins: {
      sampleCount: number;
      evaluatedCandidateCount: number;
      blockPrecision?: number;
      falseBlockRate?: number;
      falseAllowRate?: number;
      riskyFalseAllowShare?: number;
      falseBlockCauseCoverageRate?: number;
      matrixCoverageRate?: number;
    };
    categoryCoverage: Record<
      CodeTaskEvidenceGateSampleCategory,
      {
        count: number;
        covered: boolean;
        required: boolean;
      }
    >;
    shortfallCodes: CodeTaskEvidenceGateShadowEvidenceOptimizationCapabilityShortfallCode[];
    remediationTargets: {
      code: CodeTaskEvidenceGateShadowEvidenceOptimizationCapabilityShortfallCode;
      metric: string;
      actual?: number;
      target: number;
      action: string;
    }[];
  };
  diagnosticCodes: CodeTaskEvidenceGateShadowEvidenceOptimizationDiagnosticCode[];
  diagnostics: CodeTaskEvidenceGateShadowEvidenceOptimizationDiagnostic[];
  diagnosticOnly: true;
  taskCompletionEvidence: false;
  callerOwnedInMemoryOnly: true;
  nonAuthoritative: true;
  completionAuthority: false;
  runtimeDecisionUnaffected: true;
  legacyDecisionUnaffected: true;
  activePilotRequiresFreshSpec: true;
};

export function buildCodeTaskEvidenceGateShadowReport(
  input: unknown,
): CodeTaskEvidenceGateShadowReport {
  if (!isCodeTaskEvidenceGateShadowInput(input)) {
    return makeReport({
      taskId: taskIdFrom(input),
      objective: objectiveFrom(input),
      decision: "invalid_input",
      gateCandidate: false,
      wouldBlock: false,
      diagnostics: [
        makeDiagnostic({
          code: "invalid_shadow_input",
          severity: "error",
          message: "Code-task evidence gate shadow input is invalid.",
        }),
      ],
    });
  }

  if (
    input.verifierReport &&
    input.verifierReport.taskId !== input.taskId
  ) {
    return makeReport({
      taskId: input.taskId,
      objective: input.objective,
      decision: "invalid_input",
      gateCandidate: false,
      wouldBlock: false,
      verifierDecision: input.verifierReport.decision,
      verifierFindingCodes: findingCodes(input.verifierReport),
      diagnostics: [
        makeDiagnostic({
          code: "verifier_report_task_mismatch",
          severity: "error",
          message: "Verifier report task id does not match the shadow gate task id.",
          verifierDecision: input.verifierReport.decision,
          findingCodes: findingCodes(input.verifierReport),
          evidenceCaptureIssue: "report_task_id_or_shape_issue",
        }),
      ],
      evidenceCaptureIssue: "report_task_id_or_shape_issue",
    });
  }

  if (input.taskKind !== "code_edit") {
    return makeReport({
      taskId: input.taskId,
      objective: input.objective,
      decision: "not_applicable",
      gateCandidate: false,
      wouldBlock: false,
      diagnostics: [
        makeDiagnostic({
          code: "non_code_task",
          severity: "info",
          message: "Shadow gate applies only to code-edit tasks.",
        }),
      ],
    });
  }

  if (!isLegacyCompleted(input.legacyTerminalStatus)) {
    return makeReport({
      taskId: input.taskId,
      objective: input.objective,
      decision: "not_applicable",
      gateCandidate: false,
      wouldBlock: false,
      diagnostics: [
        makeDiagnostic({
          code: "legacy_not_completed",
          severity: "info",
          message: "Shadow gate evaluates only legacy-completed code tasks.",
        }),
      ],
    });
  }

  if (!input.verifierReport) {
    const evidenceCaptureIssue = evidenceCaptureIssueForBlock(
      input,
      "missing_verifier_report",
    );
    return makeReport({
      taskId: input.taskId,
      objective: input.objective,
      decision: "would_block",
      gateCandidate: true,
      wouldBlock: true,
      blockReason: "missing_verifier_report",
      evidenceCaptureIssue,
      diagnostics: [
        makeDiagnostic({
          code: "missing_verifier_report",
          severity: "warning",
          message: "A future code-task gate would block because no verifier report was supplied.",
        }),
        evidenceCaptureDiagnostic(evidenceCaptureIssue),
      ],
    });
  }

  if (input.verifierReport.decision === "completed") {
    const semanticRiskCodes = semanticRisksForCompletedReport(
      input,
      input.verifierReport,
    );
    return makeReport({
      taskId: input.taskId,
      objective: input.objective,
      decision: "would_allow",
      gateCandidate: true,
      wouldBlock: false,
      verifierDecision: "completed",
      verifierFindingCodes: findingCodes(input.verifierReport),
      allowRiskTier: semanticRiskCodes.length > 0 ? "risky_allow" : "clean_allow",
      semanticRiskCodes,
      diagnostics: [
        makeDiagnostic({
          code: "verifier_completed",
          severity: "info",
          message: "A future code-task gate would allow this legacy-completed task.",
          verifierDecision: "completed",
        }),
        ...semanticRiskCodes.map(semanticRiskDiagnostic),
      ],
    });
  }

  const blockReason = blockReasonForVerifierDecision(input.verifierReport.decision);
  const evidenceCaptureIssue = evidenceCaptureIssueForBlock(input, blockReason);
  return makeReport({
    taskId: input.taskId,
    objective: input.objective,
    decision: "would_block",
    gateCandidate: true,
    wouldBlock: true,
    blockReason,
    evidenceCaptureIssue,
    verifierDecision: input.verifierReport.decision,
    verifierFindingCodes: findingCodes(input.verifierReport),
    diagnostics: [
      makeDiagnostic({
        code: diagnosticCodeForBlockReason(blockReason),
        severity: "warning",
        message: `A future code-task gate would block because verifier decision is ${input.verifierReport.decision}.`,
        verifierDecision: input.verifierReport.decision,
        findingCodes: findingCodes(input.verifierReport),
      }),
      evidenceCaptureDiagnostic(evidenceCaptureIssue),
    ],
  });
}

export function summarizeCodeTaskEvidenceGateShadowReports(
  reports: readonly CodeTaskEvidenceGateShadowReport[],
): CodeTaskEvidenceGateShadowSummary {
  const summary: CodeTaskEvidenceGateShadowSummary = {
    sampleCount: reports.length,
    gateCandidateCount: 0,
    wouldAllowCount: 0,
    wouldBlockCount: 0,
    notApplicableCount: 0,
    invalidInputCount: 0,
    blockReasonCounts: emptyBlockReasonCounts(),
    evidenceCaptureIssueCounts: emptyEvidenceCaptureIssueCounts(),
    allowRiskTierCounts: emptyAllowRiskTierCounts(),
    semanticRiskCounts: emptySemanticRiskCounts(),
    verifierDecisionCounts: emptyVerifierDecisionCounts(),
  };

  for (const report of reports) {
    if (report.gateCandidate) {
      summary.gateCandidateCount += 1;
    }
    if (report.decision === "would_allow") {
      summary.wouldAllowCount += 1;
    }
    if (report.decision === "would_block") {
      summary.wouldBlockCount += 1;
    }
    if (report.decision === "not_applicable") {
      summary.notApplicableCount += 1;
    }
    if (report.decision === "invalid_input") {
      summary.invalidInputCount += 1;
    }
    if (report.blockReason) {
      summary.blockReasonCounts[report.blockReason] += 1;
    }
    if (report.evidenceCaptureIssue) {
      summary.evidenceCaptureIssueCounts[report.evidenceCaptureIssue] += 1;
    }
    if (report.allowRiskTier) {
      summary.allowRiskTierCounts[report.allowRiskTier] += 1;
    }
    for (const riskCode of report.semanticRiskCodes) {
      summary.semanticRiskCounts[riskCode] += 1;
    }
    if (report.verifierDecision) {
      summary.verifierDecisionCounts[report.verifierDecision] += 1;
    } else if (report.blockReason === "missing_verifier_report") {
      summary.verifierDecisionCounts.missing_report += 1;
    }
  }

  return summary;
}

export function buildCodeTaskEvidenceGateShadowSamplerEvent(
  input: unknown,
): CodeTaskEvidenceGateShadowSamplerEvent {
  if (!isCodeTaskEvidenceGateShadowSamplerInput(input)) {
    return makeSamplerEvent({
      samplerId: samplerIdFrom(input),
      sampleId: sampleIdFrom(input),
      taskId: taskIdFrom(samplerShadowInputFrom(input)),
      mode: "disabled",
      outcome: "invalid_input",
      sampled: false,
      diagnostics: [
        makeSamplerDiagnostic({
          code: "sampler_invalid_input",
          severity: "error",
          message: "Code-task evidence gate shadow sampler input is invalid.",
        }),
      ],
    });
  }

  const mode = input.mode ?? "disabled";
  if (mode === "disabled") {
    return makeSamplerEvent({
      samplerId: input.samplerId,
      sampleId: input.sampleId,
      taskId: taskIdFrom(input.input),
      mode,
      outcome: "not_sampled",
      sampled: false,
      diagnostics: [
        makeSamplerDiagnostic({
          code: "sampler_disabled",
          severity: "info",
          message: "Default-off shadow sampler is disabled for this explicit call.",
        }),
      ],
    });
  }

  const report = buildCodeTaskEvidenceGateShadowReport(input.input);
  return makeSamplerEvent({
    samplerId: input.samplerId,
    sampleId: input.sampleId,
    taskId: report.taskId,
    mode,
    outcome: "sampled",
    sampled: true,
    shadowDecision: report.decision,
    gateCandidate: report.gateCandidate,
    wouldBlock: report.wouldBlock,
    blockReason: report.blockReason,
    evidenceCaptureIssue: report.evidenceCaptureIssue,
    verifierDecision: report.verifierDecision,
    verifierFindingCodes: report.verifierFindingCodes,
    allowRiskTier: report.allowRiskTier,
    semanticRiskCodes: report.semanticRiskCodes,
    diagnostics: [
      makeSamplerDiagnostic({
        code: "sampler_shadow_sampled",
        severity: "info",
        message: "Default-off shadow sampler produced a diagnostic-only sample.",
      }),
      makeSamplerDiagnostic({
        code: "sampler_non_authoritative",
        severity: "info",
        message: "Sampler output is not completion evidence and has no authority.",
      }),
    ],
  });
}

export function summarizeCodeTaskEvidenceGateShadowSamplerEvents(
  events: readonly CodeTaskEvidenceGateShadowSamplerEvent[],
): CodeTaskEvidenceGateShadowSamplerSummary {
  const summary: CodeTaskEvidenceGateShadowSamplerSummary = {
    eventCount: events.length,
    sampledCount: 0,
    notSampledCount: 0,
    invalidSamplerInputCount: 0,
    invalidShadowInputCount: 0,
    gateCandidateCount: 0,
    wouldAllowCount: 0,
    wouldBlockCount: 0,
    riskyAllowCount: 0,
    modeCounts: emptySamplerModeCounts(),
    outcomeCounts: emptySamplerOutcomeCounts(),
    shadowDecisionCounts: emptySamplerShadowDecisionCounts(),
    blockReasonCounts: emptyBlockReasonCounts(),
    evidenceCaptureIssueCounts: emptyEvidenceCaptureIssueCounts(),
    allowRiskTierCounts: emptyAllowRiskTierCounts(),
    semanticRiskCounts: emptySemanticRiskCounts(),
    diagnosticCodeCounts: emptySamplerDiagnosticCodeCounts(),
    nonAuthoritativeCount: 0,
    completionAuthorityCount: 0,
    retention: "caller_owned_non_persistent",
    legacyDecisionUnaffected: true,
  };

  for (const event of events) {
    summary.modeCounts[event.mode] += 1;
    summary.outcomeCounts[event.outcome] += 1;
    if (event.sampled) {
      summary.sampledCount += 1;
    } else {
      summary.notSampledCount += 1;
    }
    if (event.outcome === "invalid_input") {
      summary.invalidSamplerInputCount += 1;
    }
    if (event.shadowDecision) {
      summary.shadowDecisionCounts[event.shadowDecision] += 1;
    } else {
      summary.shadowDecisionCounts.not_sampled += 1;
    }
    if (event.shadowDecision === "invalid_input") {
      summary.invalidShadowInputCount += 1;
    }
    if (event.gateCandidate) {
      summary.gateCandidateCount += 1;
    }
    if (event.shadowDecision === "would_allow") {
      summary.wouldAllowCount += 1;
    }
    if (event.shadowDecision === "would_block") {
      summary.wouldBlockCount += 1;
    }
    if (event.allowRiskTier === "risky_allow") {
      summary.riskyAllowCount += 1;
    }
    if (event.blockReason) {
      summary.blockReasonCounts[event.blockReason] += 1;
    }
    if (event.evidenceCaptureIssue) {
      summary.evidenceCaptureIssueCounts[event.evidenceCaptureIssue] += 1;
    }
    if (event.allowRiskTier) {
      summary.allowRiskTierCounts[event.allowRiskTier] += 1;
    }
    for (const riskCode of event.semanticRiskCodes) {
      summary.semanticRiskCounts[riskCode] += 1;
    }
    for (const diagnosticCode of event.diagnosticCodes) {
      summary.diagnosticCodeCounts[diagnosticCode] += 1;
    }
    if (event.nonAuthoritative) {
      summary.nonAuthoritativeCount += 1;
    }
  }

  return summary;
}

export function buildCodeTaskEvidenceGateRuntimeCallerResult(
  input: unknown,
): CodeTaskEvidenceGateRuntimeCallerResult {
  if (!isRuntimeCallerEnvelope(input)) {
    return makeRuntimeCallerResult({
      callerId: callerIdFrom(input),
      completionEventId: completionEventIdFrom(input),
      mode: "disabled",
      outcome: "invalid_input",
      sampled: false,
      taskId: taskIdFrom(runtimeCallerShadowInputFrom(input)),
      diagnostics: [
        makeRuntimeCallerDiagnostic({
          code: "runtime_shadow_sampler_invalid_input",
          severity: "error",
          message: "Runtime shadow sampler caller input is invalid.",
        }),
      ],
    });
  }

  const mode = input.mode ?? "disabled";
  if (mode === "disabled") {
    return makeRuntimeCallerResult({
      callerId: input.callerId,
      completionEventId: input.completionEventId,
      mode,
      outcome: "disabled",
      sampled: false,
      taskId: taskIdFrom(input.shadowInput),
      diagnostics: [
        makeRuntimeCallerDiagnostic({
          code: "runtime_shadow_sampler_disabled",
          severity: "info",
          message: "Runtime shadow sampler caller is disabled by default.",
        }),
      ],
    });
  }

  if (
    !isNonEmptyString(input.samplerId) ||
    !isNonEmptyString(input.sampleId) ||
    !("shadowInput" in input)
  ) {
    return makeRuntimeCallerResult({
      callerId: input.callerId,
      completionEventId: input.completionEventId,
      mode,
      outcome: "invalid_input",
      sampled: false,
      taskId: taskIdFrom(input.shadowInput),
      diagnostics: [
        makeRuntimeCallerDiagnostic({
          code: "runtime_shadow_sampler_invalid_input",
          severity: "error",
          message: "Explicit shadow-only caller input is missing sampler fields.",
        }),
      ],
    });
  }

  const samplerEvent = buildCodeTaskEvidenceGateShadowSamplerEvent({
    samplerId: input.samplerId,
    sampleId: input.sampleId,
    mode: "shadow_only",
    input: input.shadowInput,
  });

  return makeRuntimeCallerResult({
    callerId: input.callerId,
    completionEventId: input.completionEventId,
    mode,
    outcome: "sampled",
    sampled: true,
    taskId: samplerEvent.taskId,
    samplerEvent,
    diagnostics: [
      makeRuntimeCallerDiagnostic({
        code: "runtime_shadow_sampler_sampled",
        severity: "info",
        message: "Runtime shadow sampler caller produced a diagnostic sample.",
      }),
      makeRuntimeCallerDiagnostic({
        code: "runtime_shadow_sampler_non_authoritative",
        severity: "info",
        message: "Runtime shadow sampler caller has no completion authority.",
      }),
    ],
  });
}

export function summarizeCodeTaskEvidenceGateRuntimeCallerResults(
  results: readonly CodeTaskEvidenceGateRuntimeCallerResult[],
): CodeTaskEvidenceGateRuntimeCallerSummary {
  const summary: CodeTaskEvidenceGateRuntimeCallerSummary = {
    resultCount: results.length,
    sampledCount: 0,
    disabledCount: 0,
    invalidInputCount: 0,
    modeCounts: emptySamplerModeCounts(),
    outcomeCounts: emptyRuntimeCallerOutcomeCounts(),
    diagnosticCodeCounts: emptyRuntimeCallerDiagnosticCodeCounts(),
    samplerSummary: summarizeCodeTaskEvidenceGateShadowSamplerEvents(
      results.flatMap((result) => result.samplerEvent ? [result.samplerEvent] : []),
    ),
    nonAuthoritativeCount: 0,
    completionAuthorityCount: 0,
    runtimeDecisionUnaffectedCount: 0,
    legacyDecisionUnaffected: true,
  };

  for (const result of results) {
    summary.modeCounts[result.mode] += 1;
    summary.outcomeCounts[result.outcome] += 1;
    if (result.sampled) {
      summary.sampledCount += 1;
    }
    if (result.outcome === "disabled") {
      summary.disabledCount += 1;
    }
    if (result.outcome === "invalid_input") {
      summary.invalidInputCount += 1;
    }
    for (const diagnosticCode of result.diagnosticCodes) {
      summary.diagnosticCodeCounts[diagnosticCode] += 1;
    }
    if (result.nonAuthoritative) {
      summary.nonAuthoritativeCount += 1;
    }
    if (result.runtimeDecisionUnaffected) {
      summary.runtimeDecisionUnaffectedCount += 1;
    }
  }

  return summary;
}

export function buildCodeTaskEvidenceGateRuntimeShadowProducerResult(
  input: unknown,
): CodeTaskEvidenceGateRuntimeShadowProducerResult {
  if (!isRuntimeShadowProducerEnvelope(input)) {
    return makeRuntimeShadowProducerResult({
      producerId: producerIdFrom(input),
      completionEventId: completionEventIdFrom(input),
      mode: runtimeShadowProducerModeFrom(input),
      outcome: "invalid_input",
      sampled: false,
      taskId: taskIdFrom(runtimeShadowProducerCompletionFrom(input)),
      diagnostics: [
        makeRuntimeShadowProducerDiagnostic({
          code: "runtime_shadow_producer_invalid_input",
          severity: "error",
          message: "Runtime shadow producer input is invalid.",
        }),
      ],
    });
  }

  const mode = input.mode ?? "disabled";
  if (mode === "disabled") {
    return makeRuntimeShadowProducerResult({
      producerId: input.producerId,
      completionEventId: input.completionEventId,
      mode,
      outcome: "disabled",
      sampled: false,
      taskId: taskIdFrom(input.completion),
      diagnostics: [
        makeRuntimeShadowProducerDiagnostic({
          code: "runtime_shadow_producer_disabled",
          severity: "info",
          message: "Default-off runtime shadow producer is disabled.",
        }),
      ],
    });
  }

  if (
    !isNonEmptyString(input.samplerId) ||
    !isNonEmptyString(input.sampleId) ||
    !isRuntimeShadowProducerCompletion(input.completion)
  ) {
    return makeRuntimeShadowProducerResult({
      producerId: input.producerId,
      completionEventId: input.completionEventId,
      mode,
      outcome: "invalid_input",
      sampled: false,
      taskId: taskIdFrom(input.completion),
      diagnostics: [
        makeRuntimeShadowProducerDiagnostic({
          code: "runtime_shadow_producer_invalid_input",
          severity: "error",
          message:
            "Explicit shadow-only runtime shadow producer input is invalid.",
        }),
      ],
    });
  }

  const callerInput: CodeTaskEvidenceGateRuntimeCallerInput = {
    callerId: input.producerId,
    completionEventId: input.completionEventId,
    mode: "shadow_only",
    samplerId: input.samplerId,
    sampleId: input.sampleId,
    shadowInput: input.completion,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
  const callerResult = buildCodeTaskEvidenceGateRuntimeCallerResult(callerInput);

  return runtimeShadowProducerResultFromCaller({
    input,
    callerInput,
    callerResult,
  });
}

export function buildCodeTaskEvidenceGateRuntimeShadowCollectionResult(
  input: unknown,
  options: CodeTaskEvidenceGateRuntimeShadowCollectionOptions = {},
): CodeTaskEvidenceGateRuntimeShadowCollectionResult {
  if (!isRuntimeShadowCollectionEnvelope(input)) {
    return makeRuntimeShadowCollectionResult({
      collectorId: collectorIdFrom(input),
      mode: runtimeShadowCollectionModeFrom(input),
      outcome: "invalid_input",
      requestedSampleCount: runtimeShadowCollectionRequestedSampleCount(input),
      acceptedSampleCount: 0,
      droppedSampleCount: 0,
      entries: [],
      diagnostics: [
        makeRuntimeShadowCollectionDiagnostic({
          code: "runtime_shadow_collection_invalid_input",
          severity: "error",
          message: "Runtime shadow collection input is invalid.",
        }),
      ],
    });
  }

  const mode = input.mode ?? "disabled";
  const requestedSampleCount = runtimeShadowCollectionRequestedSampleCount(input);
  if (mode === "disabled") {
    return makeRuntimeShadowCollectionResult({
      collectorId: input.collectorId,
      mode,
      outcome: "disabled",
      requestedSampleCount,
      acceptedSampleCount: 0,
      droppedSampleCount: 0,
      entries: [],
      diagnostics: [
        makeRuntimeShadowCollectionDiagnostic({
          code: "runtime_shadow_collection_disabled",
          severity: "info",
          message: "Default-off runtime shadow collection is disabled.",
        }),
      ],
    });
  }

  if (
    !Array.isArray(input.samples) ||
    !isRuntimeShadowCollectionSampleLimit(input.maxSamples) ||
    !isRuntimeReplayReadinessThresholdPatch(input.readinessThresholds)
  ) {
    return makeRuntimeShadowCollectionResult({
      collectorId: input.collectorId,
      mode,
      outcome: "invalid_input",
      requestedSampleCount,
      acceptedSampleCount: 0,
      droppedSampleCount: 0,
      entries: [],
      diagnostics: [
        makeRuntimeShadowCollectionDiagnostic({
          code: "runtime_shadow_collection_invalid_input",
          severity: "error",
          message:
            "Explicit shadow-only runtime shadow collection input is invalid.",
        }),
      ],
    });
  }

  const maxSamples =
    input.maxSamples ?? CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_DEFAULT_MAX_SAMPLES;
  const acceptedSamples = input.samples.slice(0, maxSamples);
  if (!acceptedSamples.every(isRuntimeShadowCollectionSampleEnvelope)) {
    return makeRuntimeShadowCollectionResult({
      collectorId: input.collectorId,
      mode,
      outcome: "invalid_input",
      requestedSampleCount,
      acceptedSampleCount: 0,
      droppedSampleCount: 0,
      entries: [],
      diagnostics: [
        makeRuntimeShadowCollectionDiagnostic({
          code: "runtime_shadow_collection_invalid_input",
          severity: "error",
          message:
            "Runtime shadow collection sample envelope is invalid.",
        }),
      ],
    });
  }

  const buildProducerResult =
    options.buildProducerResult ?? buildCodeTaskEvidenceGateRuntimeShadowProducerResult;
  const entries = acceptedSamples.map((sample) => {
    const producerResult = buildProducerResult(sample.producerInput);
    return makeRuntimeShadowCollectionEntry({
      sample,
      producerResult,
    });
  });
  const replaySamples = entries.flatMap((entry) =>
    entry.replaySample ? [entry.replaySample] : []
  );
  const replayReport = evaluateCodeTaskEvidenceGateRuntimeReplaySamples(
    replaySamples,
  );
  const replayReadiness = evaluateCodeTaskEvidenceGateRuntimeReplayReadiness(
    replayReport,
    input.readinessThresholds ?? {},
  );

  return makeRuntimeShadowCollectionResult({
    collectorId: input.collectorId,
    mode,
    outcome: "collected",
    requestedSampleCount,
    acceptedSampleCount: acceptedSamples.length,
    droppedSampleCount: requestedSampleCount - acceptedSamples.length,
    entries,
    replayReport,
    replayReadiness,
    diagnostics: runtimeShadowCollectionDiagnostics({
      requestedSampleCount,
      acceptedSampleCount: acceptedSamples.length,
    }),
  });
}

export function buildCodeTaskEvidenceGateInternalShadowObservationResult(
  input: unknown,
): CodeTaskEvidenceGateInternalShadowObservationResult {
  if (!isInternalShadowObservationEnvelope(input)) {
    return makeInternalShadowObservationResult({
      observerId: observerIdFrom(input),
      mode: internalShadowObservationModeFrom(input),
      outcome: "invalid_input",
      observationDecision: "stop_or_freeze_route",
      requestedCollectionCount: internalShadowObservationRequestedCollectionCount(
        input,
      ),
      acceptedCollectionCount: 0,
      droppedCollectionCount: 0,
      collections: [],
      diagnostics: [
        makeInternalShadowObservationDiagnostic({
          code: "internal_shadow_observation_invalid_input",
          severity: "error",
          message: "Internal shadow observation input is invalid.",
        }),
      ],
    });
  }

  const mode = input.mode ?? "disabled";
  const requestedCollectionCount =
    internalShadowObservationRequestedCollectionCount(input);
  if (mode === "disabled") {
    return makeInternalShadowObservationResult({
      observerId: input.observerId,
      mode,
      outcome: "disabled",
      observationDecision: "continue_internal_shadow_observation_hardening",
      requestedCollectionCount,
      acceptedCollectionCount: 0,
      droppedCollectionCount: 0,
      collections: [],
      diagnostics: [
        makeInternalShadowObservationDiagnostic({
          code: "internal_shadow_observation_disabled",
          severity: "info",
          message: "Default-off internal shadow observation is disabled.",
        }),
      ],
    });
  }

  if (
    !Array.isArray(input.collections) ||
    !isInternalShadowObservationCollectionLimit(input.maxCollections) ||
    !isRuntimeReplayReadinessThresholdPatch(input.readinessThresholds)
  ) {
    return makeInternalShadowObservationResult({
      observerId: input.observerId,
      mode,
      outcome: "invalid_input",
      observationDecision: "stop_or_freeze_route",
      requestedCollectionCount,
      acceptedCollectionCount: 0,
      droppedCollectionCount: 0,
      collections: [],
      diagnostics: [
        makeInternalShadowObservationDiagnostic({
          code: "internal_shadow_observation_invalid_input",
          severity: "error",
          message:
            "Explicit shadow-only internal shadow observation input is invalid.",
        }),
      ],
    });
  }

  const maxCollections =
    input.maxCollections
    ?? CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DEFAULT_MAX_COLLECTIONS;
  const acceptedCollections = input.collections.slice(0, maxCollections);
  if (!acceptedCollections.every(isRuntimeShadowCollectionResult)) {
    return makeInternalShadowObservationResult({
      observerId: input.observerId,
      mode,
      outcome: "invalid_input",
      observationDecision: "stop_or_freeze_route",
      requestedCollectionCount,
      acceptedCollectionCount: 0,
      droppedCollectionCount: 0,
      collections: [],
      diagnostics: [
        makeInternalShadowObservationDiagnostic({
          code: "internal_shadow_observation_invalid_input",
          severity: "error",
          message:
            "Internal shadow observation collection result envelope is invalid.",
        }),
      ],
    });
  }

  const replaySamples = acceptedCollections.flatMap((collection) =>
    collection.entries.flatMap((entry) =>
      entry.replaySample ? [entry.replaySample] : []
    )
  );
  const replayReport = evaluateCodeTaskEvidenceGateRuntimeReplaySamples(
    replaySamples,
  );
  const replayReadiness = evaluateCodeTaskEvidenceGateRuntimeReplayReadiness(
    replayReport,
    input.readinessThresholds ?? {},
  );

  return makeInternalShadowObservationResult({
    observerId: input.observerId,
    mode,
    outcome: "observed",
    observationDecision: internalShadowObservationDecision(replayReadiness),
    requestedCollectionCount,
    acceptedCollectionCount: acceptedCollections.length,
    droppedCollectionCount: requestedCollectionCount - acceptedCollections.length,
    collections: acceptedCollections,
    replayReport,
    replayReadiness,
    diagnostics: internalShadowObservationDiagnostics({
      requestedCollectionCount,
      acceptedCollectionCount: acceptedCollections.length,
      replayReadiness,
    }),
  });
}

export function evaluateCodeTaskEvidenceGateRuntimeReplaySamples(
  samples: readonly CodeTaskEvidenceGateRuntimeReplaySample[],
): CodeTaskEvidenceGateRuntimeReplayReport {
  const results = samples.map((sample): CodeTaskEvidenceGateRuntimeReplayResult => {
    const callerResult = buildCodeTaskEvidenceGateRuntimeCallerResult(
      sample.callerInput,
    );
    return {
      replayId: sample.replayId,
      manualReviewLabel: sample.manualReviewLabel,
      category: sample.category,
      outcome: runtimeReplayOutcome(callerResult, sample.manualReviewLabel),
      callerResult,
    };
  });

  return {
    summary: summarizeRuntimeReplayResults(results),
    results,
    runtimeDecisionUnaffected: true,
    legacyDecisionUnaffected: true,
  };
}

export function evaluateCodeTaskEvidenceGateRuntimeReplayReadiness(
  report: CodeTaskEvidenceGateRuntimeReplayReport,
  thresholds: Partial<CodeTaskEvidenceGateRuntimeReplayReadinessThresholds> = {},
): CodeTaskEvidenceGateRuntimeReplayReadinessReport {
  const resolvedThresholds = {
    ...defaultRuntimeReplayReadinessThresholds(),
    ...thresholds,
  };
  const metrics = {
    sampleCount: report.summary.sampleCount,
    sampledCount: report.summary.sampledCount,
    evaluatedCandidateCount: report.summary.evaluatedCandidateCount,
    blockPrecision: report.summary.blockPrecision,
    falseBlockRate: report.summary.falseBlockRate,
    falseAllowRate: report.summary.falseAllowRate,
    usefulBlockFalseBlockRatio: report.summary.usefulBlockFalseBlockRatio,
    riskyFalseAllowShare: report.summary.riskyFalseAllowShare,
    nonAuthoritativeCount: report.summary.nonAuthoritativeCount,
    completionAuthorityCount: report.summary.completionAuthorityCount,
    runtimeDecisionUnaffectedCount: report.summary.runtimeDecisionUnaffectedCount,
  };
  const diagnostics = runtimeReplayReadinessDiagnostics({
    metrics,
    thresholds: resolvedThresholds,
  });

  return {
    decision: runtimeReplayReadinessDecision(diagnostics),
    thresholds: resolvedThresholds,
    metrics,
    diagnostics,
    activePilotRequiresFreshSpec: true,
    runtimeDecisionUnaffected: true,
    legacyDecisionUnaffected: true,
  };
}

export function evaluateCodeTaskEvidenceGateShadowSamples(
  samples: readonly CodeTaskEvidenceGateEvaluationSample[],
): CodeTaskEvidenceGateEvaluationReport {
  const results = samples.map((sample): CodeTaskEvidenceGateEvaluationResult => {
    const report = buildCodeTaskEvidenceGateShadowReport(sample.input);
    return {
      sampleId: sample.sampleId,
      manualReviewLabel: sample.manualReviewLabel,
      category: sample.category,
      outcome: evaluationOutcome(report, sample.manualReviewLabel),
      report,
    };
  });

  return {
    summary: summarizeEvaluationResults(results),
    results,
    legacyDecisionUnaffected: true,
  };
}

export function evaluateCodeTaskEvidenceGateReadiness(
  evaluation: CodeTaskEvidenceGateEvaluationReport,
  stage: CodeTaskEvidenceGateReadinessStage,
  options: {
    thresholds?: Partial<CodeTaskEvidenceGateReadinessThresholds>;
    runtimeShadowEvidence?: CodeTaskEvidenceGateRuntimeShadowEvidence;
  } = {},
): CodeTaskEvidenceGateReadinessReport {
  const thresholds = {
    ...defaultReadinessThresholds(stage),
    ...options.thresholds,
  };
  const metrics = readinessMetrics(evaluation, options.runtimeShadowEvidence);
  const diagnostics = readinessDiagnostics({
    stage,
    thresholds,
    metrics,
    runtimeShadowEvidence: options.runtimeShadowEvidence,
  });

  return {
    stage,
    decision: readinessDecision(diagnostics),
    thresholds,
    diagnostics,
    metrics,
    legacyDecisionUnaffected: true,
  };
}

export function buildCodeTaskEvidenceGateShadowEvidenceQualityReport(
  input: CodeTaskEvidenceGateShadowEvidenceQualityInput,
): CodeTaskEvidenceGateShadowEvidenceQualityReport {
  const offlineSummary = input.evaluation?.summary;
  const runtimeReadiness = input.runtimeReplayReadiness;
  const observation = input.internalObservation;
  const falseBlockCauseClassifiedCount = sumRecord(
    offlineSummary?.falseBlockCauseCounts,
  );
  const nonAuthorityParity =
    (runtimeReadiness === undefined ||
      (runtimeReadiness.metrics.nonAuthoritativeCount ===
        runtimeReadiness.metrics.sampleCount &&
        runtimeReadiness.metrics.completionAuthorityCount === 0 &&
        runtimeReadiness.metrics.runtimeDecisionUnaffectedCount ===
          runtimeReadiness.metrics.sampleCount &&
        runtimeReadiness.activePilotRequiresFreshSpec &&
        runtimeReadiness.runtimeDecisionUnaffected &&
        runtimeReadiness.legacyDecisionUnaffected)) &&
    (observation === undefined ||
      (observation.nonAuthoritative &&
        observation.completionAuthority === false &&
        observation.runtimeDecisionUnaffected &&
        observation.legacyDecisionUnaffected &&
        observation.activePilotRequiresFreshSpec));
  const metrics: CodeTaskEvidenceGateShadowEvidenceQualityReport["metrics"] = {
    offlineSampleCount: offlineSummary?.sampleCount ?? 0,
    offlineEvaluatedCandidateCount:
      offlineSummary?.evaluatedCandidateCount ?? 0,
    falseBlockCount: offlineSummary?.falseBlockCount ?? 0,
    falseBlockCauseClassifiedCount,
    falseBlockCauseCoverageRate: ratio(
      falseBlockCauseClassifiedCount,
      offlineSummary?.falseBlockCount ?? 0,
    ),
    falseAllowCount: offlineSummary?.falseAllowCount ?? 0,
    riskyFalseAllowCount: offlineSummary?.riskyFalseAllowCount ?? 0,
    riskyFalseAllowShare: offlineSummary?.riskyFalseAllowShare,
    runtimeReplayDecision: runtimeReadiness?.decision,
    runtimeReplaySampleCount: runtimeReadiness?.metrics.sampleCount ?? 0,
    internalObservationDecision: observation?.observationDecision,
    internalObservationSampleCount: observation?.replaySampleCount ?? 0,
    nonAuthorityParity,
  };
  const diagnostics = shadowEvidenceQualityDiagnostics({
    input,
    metrics,
  });

  return {
    decision: shadowEvidenceQualityDecision(diagnostics),
    metrics,
    diagnosticCodes: stableShadowEvidenceQualityDiagnosticCodes(
      diagnostics.map((diagnostic) => diagnostic.code),
    ),
    diagnostics,
    nonAuthoritative: true,
    completionAuthority: false,
    runtimeDecisionUnaffected: true,
    legacyDecisionUnaffected: true,
    activePilotRequiresFreshSpec: true,
  };
}

export function buildCodeTaskEvidenceGateShadowEvidenceOptimizationReport(
  input: CodeTaskEvidenceGateShadowEvidenceOptimizationInput,
): CodeTaskEvidenceGateShadowEvidenceOptimizationReport {
  const qualityReport = buildCodeTaskEvidenceGateShadowEvidenceQualityReport(input);
  const categoryCounts = optimizationCategoryCounts(input);
  const coveredRequiredCategoryCount =
    CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_REQUIRED_CATEGORIES
      .filter((category) => categoryCounts[category] > 0).length;
  const requiredCategoryCount =
    CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_REQUIRED_CATEGORIES.length;
  const quantification:
    CodeTaskEvidenceGateShadowEvidenceOptimizationReport["quantification"] = {
      sampleCount: input.evaluation?.summary.sampleCount ?? 0,
      evaluatedCandidateCount:
        input.evaluation?.summary.evaluatedCandidateCount ?? 0,
      blockPrecision: input.evaluation?.summary.blockPrecision,
      blockRecall: input.evaluation?.summary.blockRecall,
      falseBlockRate: input.evaluation?.summary.falseBlockRate,
      falseAllowRate: input.evaluation?.summary.falseAllowRate,
      riskyFalseAllowShare: qualityReport.metrics.riskyFalseAllowShare,
      falseBlockCauseCoverageRate:
        qualityReport.metrics.falseBlockCauseCoverageRate,
      falseBlockCauseCounts:
        input.evaluation?.summary.falseBlockCauseCounts ??
        emptyEvidenceCaptureIssueCounts(),
      riskyFalseAllowSignalCounts: optimizationRiskyFalseAllowSignalCounts(input),
      categoryCounts,
      coveredRequiredCategoryCount,
      requiredCategoryCount,
      matrixCoverageRate: ratio(coveredRequiredCategoryCount, requiredCategoryCount),
      runtimeReplayDecisionCounts: optimizationRuntimeReplayDecisionCounts(input),
      internalObservationDecisionCounts:
        optimizationInternalObservationDecisionCounts(input),
      blockedOrFreezeReasons: optimizationBlockedOrFreezeReasons(qualityReport, input),
    };
  const diagnostics = shadowEvidenceOptimizationDiagnostics({
    qualityReport,
    quantification,
  });
  const capabilityAssessment =
    buildShadowEvidenceOptimizationCapabilityAssessment({
      qualityReport,
      quantification,
    });

  return {
    decision: shadowEvidenceOptimizationDecision(diagnostics),
    qualityReport,
    strategy: {
      qualityDecision: qualityReport.decision,
      falseBlockCauseCoverageRate:
        qualityReport.metrics.falseBlockCauseCoverageRate,
      riskyFalseAllowShare: qualityReport.metrics.riskyFalseAllowShare,
      nonAuthorityParity: qualityReport.metrics.nonAuthorityParity,
    },
    quantification,
    capabilityAssessment,
    diagnosticCodes: stableShadowEvidenceOptimizationDiagnosticCodes(
      diagnostics.map((diagnostic) => diagnostic.code),
    ),
    diagnostics,
    diagnosticOnly: true,
    taskCompletionEvidence: false,
    callerOwnedInMemoryOnly: true,
    nonAuthoritative: true,
    completionAuthority: false,
    runtimeDecisionUnaffected: true,
    legacyDecisionUnaffected: true,
    activePilotRequiresFreshSpec: true,
  };
}

function shadowEvidenceQualityDiagnostics(params: {
  input: CodeTaskEvidenceGateShadowEvidenceQualityInput;
  metrics: CodeTaskEvidenceGateShadowEvidenceQualityReport["metrics"];
}): CodeTaskEvidenceGateShadowEvidenceQualityDiagnostic[] {
  const diagnostics: CodeTaskEvidenceGateShadowEvidenceQualityDiagnostic[] = [];
  const hasEvaluation = params.input.evaluation !== undefined;
  const hasRuntimeReplay = params.input.runtimeReplayReadiness !== undefined;
  const hasObservation = params.input.internalObservation !== undefined;

  if (!hasEvaluation && !hasRuntimeReplay && !hasObservation) {
    diagnostics.push({
      code: "shadow_evidence_quality_no_input",
      severity: "warning",
      message: "Shadow evidence quality report has no input reports.",
    });
  } else if (!hasEvaluation || !hasRuntimeReplay || !hasObservation) {
    diagnostics.push({
      code: "shadow_evidence_quality_incomplete_inputs",
      severity: "warning",
      message:
        "Shadow evidence quality report is missing evaluation, runtime replay, or observation input.",
    });
  }

  if (hasEvaluation) {
    if (
      params.metrics.falseBlockCount > 0 &&
      params.metrics.falseBlockCauseCoverageRate !== 1
    ) {
      diagnostics.push({
        code: "shadow_evidence_quality_false_block_causes_incomplete",
        severity: "warning",
        message: "False-block causes are not fully classified.",
        actual: params.metrics.falseBlockCauseCoverageRate ?? 0,
        threshold: 1,
      });
    } else {
      diagnostics.push({
        code: "shadow_evidence_quality_false_block_causes_covered",
        severity: "info",
        message: "False-block causes are fully classified or absent.",
        actual: params.metrics.falseBlockCauseCoverageRate ?? 1,
        threshold: 1,
      });
    }

    if (
      params.metrics.falseAllowCount > 0 &&
      (params.metrics.riskyFalseAllowShare ?? 0) <
        defaultRuntimeReplayReadinessThresholds().minRiskyFalseAllowShare!
    ) {
      diagnostics.push({
        code: "shadow_evidence_quality_risky_false_allows_incomplete",
        severity: "warning",
        message: "Risky false-allow coverage is below the shadow evidence threshold.",
        actual: params.metrics.riskyFalseAllowShare ?? 0,
        threshold:
          defaultRuntimeReplayReadinessThresholds().minRiskyFalseAllowShare,
      });
    } else {
      diagnostics.push({
        code: "shadow_evidence_quality_risky_false_allows_covered",
        severity: "info",
        message: "Risky false-allow coverage is sufficient or absent.",
        actual: params.metrics.riskyFalseAllowShare ?? 1,
        threshold:
          defaultRuntimeReplayReadinessThresholds().minRiskyFalseAllowShare,
      });
    }
  }

  if (params.input.runtimeReplayReadiness) {
    if (
      params.input.runtimeReplayReadiness.decision ===
      "ready_for_shadow_evidence_review"
    ) {
      diagnostics.push({
        code: "shadow_evidence_quality_runtime_replay_ready",
        severity: "info",
        message: "Runtime replay evidence is ready for shadow evidence review.",
      });
    } else if (
      params.input.runtimeReplayReadiness.decision ===
      "continue_runtime_shadow_replay"
    ) {
      diagnostics.push({
        code: "shadow_evidence_quality_runtime_replay_continue_hardening",
        severity: "warning",
        message: "Runtime replay evidence requires continued hardening.",
      });
    } else {
      diagnostics.push({
        code: "shadow_evidence_quality_runtime_replay_blocked",
        severity: "error",
        message: "Runtime replay evidence is blocked.",
      });
    }
  }

  if (params.input.internalObservation) {
    if (
      params.input.internalObservation.observationDecision ===
      "ready_for_limited_default_off_internal_shadow_observation_review"
    ) {
      diagnostics.push({
        code: "shadow_evidence_quality_observation_ready",
        severity: "info",
        message: "Internal observation is ready for limited default-off review.",
      });
    } else if (
      params.input.internalObservation.observationDecision ===
      "continue_internal_shadow_observation_hardening"
    ) {
      diagnostics.push({
        code: "shadow_evidence_quality_observation_continue_hardening",
        severity: "warning",
        message: "Internal observation requires continued hardening.",
      });
    } else {
      diagnostics.push({
        code: "shadow_evidence_quality_observation_stop_or_freeze",
        severity: "error",
        message: "Internal observation requires stopping or freezing the route.",
      });
    }
  }

  diagnostics.push({
    code: "shadow_evidence_quality_non_authoritative",
    severity: params.metrics.nonAuthorityParity ? "info" : "error",
    message: params.metrics.nonAuthorityParity
      ? "Shadow evidence quality inputs preserve non-authority."
      : "Shadow evidence quality inputs contain authority drift.",
  });
  diagnostics.push({
    code: "shadow_evidence_quality_active_pilot_still_requires_fresh_spec",
    severity: "info",
    message: "Active pilot still requires a later fresh accepted spec.",
  });

  return diagnostics;
}

function shadowEvidenceQualityDecision(
  diagnostics: readonly CodeTaskEvidenceGateShadowEvidenceQualityDiagnostic[],
): CodeTaskEvidenceGateShadowEvidenceQualityDecision {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "stop_or_freeze_route";
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return "continue_internal_shadow_observation_hardening";
  }
  return "ready_for_limited_default_off_readiness_review";
}

function optimizationCategoryCounts(
  input: CodeTaskEvidenceGateShadowEvidenceOptimizationInput,
): Record<CodeTaskEvidenceGateSampleCategory, number> {
  const counts = {
    ...emptySampleCategoryCounts(),
    ...input.evaluation?.summary.categoryCounts,
  };
  for (const [category, count] of Object.entries(
    input.fixtureMatrix?.categoryCounts ?? {},
  )) {
    if (isSampleCategory(category)) {
      counts[category] += count ?? 0;
    }
  }
  return counts;
}

function optimizationRuntimeReplayDecisionCounts(
  input: CodeTaskEvidenceGateShadowEvidenceOptimizationInput,
): Record<CodeTaskEvidenceGateRuntimeReplayReadinessDecision, number> {
  const counts = emptyRuntimeReplayReadinessDecisionCounts();
  if (input.runtimeReplayReadiness) {
    counts[input.runtimeReplayReadiness.decision] += 1;
  }
  for (const [decision, count] of Object.entries(
    input.fixtureMatrix?.runtimeReplayDecisionCounts ?? {},
  )) {
    if (isRuntimeReplayReadinessDecision(decision)) {
      counts[decision] += count ?? 0;
    }
  }
  return counts;
}

function optimizationInternalObservationDecisionCounts(
  input: CodeTaskEvidenceGateShadowEvidenceOptimizationInput,
): Record<CodeTaskEvidenceGateInternalShadowObservationDecision, number> {
  const counts = emptyInternalShadowObservationDecisionCounts();
  if (input.internalObservation) {
    counts[input.internalObservation.observationDecision] += 1;
  }
  for (const [decision, count] of Object.entries(
    input.fixtureMatrix?.internalObservationDecisionCounts ?? {},
  )) {
    if (isInternalShadowObservationDecision(decision)) {
      counts[decision] += count ?? 0;
    }
  }
  return counts;
}

function optimizationBlockedOrFreezeReasons(
  qualityReport: CodeTaskEvidenceGateShadowEvidenceQualityReport,
  input: CodeTaskEvidenceGateShadowEvidenceOptimizationInput,
): string[] {
  const reasons: string[] = qualityReport.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
  for (const reason of input.fixtureMatrix?.blockedOrFreezeReasons ?? []) {
    if (isNonEmptyString(reason)) {
      reasons.push(reason.slice(0, 120));
    }
  }
  return reasons.slice(0, 20);
}

function optimizationRiskyFalseAllowSignalCounts(
  input: CodeTaskEvidenceGateShadowEvidenceOptimizationInput,
): Record<CodeTaskEvidenceGateSemanticRiskCode, number> {
  const counts = emptySemanticRiskCounts();
  for (const result of input.evaluation?.results ?? []) {
    if (result.outcome !== "false_allow") {
      continue;
    }
    for (const riskCode of result.report.semanticRiskCodes) {
      counts[riskCode] += 1;
    }
  }
  return counts;
}

function buildShadowEvidenceOptimizationCapabilityAssessment(params: {
  qualityReport: CodeTaskEvidenceGateShadowEvidenceQualityReport;
  quantification: CodeTaskEvidenceGateShadowEvidenceOptimizationReport["quantification"];
}): CodeTaskEvidenceGateShadowEvidenceOptimizationReport["capabilityAssessment"] {
  const runtimeThresholds = defaultRuntimeReplayReadinessThresholds();
  const thresholds = {
    minSamples: runtimeThresholds.minSamples,
    minEvaluatedCandidates: runtimeThresholds.minEvaluatedCandidates,
    minBlockPrecision: runtimeThresholds.minBlockPrecision,
    maxFalseBlockRate: runtimeThresholds.maxFalseBlockRate,
    maxFalseAllowRate: runtimeThresholds.maxFalseAllowRate,
    minRiskyFalseAllowShare:
      runtimeThresholds.minRiskyFalseAllowShare ?? 0,
    requiredFalseBlockCauseCoverageRate: 1 as const,
    requiredMatrixCoverageRate: 1 as const,
  };
  const { qualityReport, quantification } = params;
  const shortfalls =
    new Set<CodeTaskEvidenceGateShadowEvidenceOptimizationCapabilityShortfallCode>();

  if (
    qualityReport.decision !==
    "ready_for_limited_default_off_readiness_review"
  ) {
    shortfalls.add("quality_strategy_not_ready");
  }
  if (quantification.sampleCount < thresholds.minSamples) {
    shortfalls.add("sample_count_below_threshold");
  }
  if (
    quantification.evaluatedCandidateCount <
    thresholds.minEvaluatedCandidates
  ) {
    shortfalls.add("evaluated_candidate_count_below_threshold");
  }
  if (
    quantification.coveredRequiredCategoryCount <
    quantification.requiredCategoryCount
  ) {
    shortfalls.add("fixture_matrix_incomplete");
  }
  if (quantification.blockPrecision === undefined) {
    shortfalls.add("block_precision_missing");
  } else if (quantification.blockPrecision < thresholds.minBlockPrecision) {
    shortfalls.add("block_precision_below_threshold");
  }
  if (quantification.falseBlockRate === undefined) {
    shortfalls.add("false_block_rate_missing");
  } else if (quantification.falseBlockRate > thresholds.maxFalseBlockRate) {
    shortfalls.add("false_block_rate_above_threshold");
  }
  if (quantification.falseAllowRate === undefined) {
    shortfalls.add("false_allow_rate_missing");
  } else if (quantification.falseAllowRate > thresholds.maxFalseAllowRate) {
    shortfalls.add("false_allow_rate_above_threshold");
  }
  if (
    qualityReport.metrics.falseBlockCount > 0 &&
    quantification.falseBlockCauseCoverageRate !==
      thresholds.requiredFalseBlockCauseCoverageRate
  ) {
    shortfalls.add("false_block_cause_coverage_incomplete");
  }
  if (
    qualityReport.metrics.falseAllowCount > 0 &&
    (quantification.riskyFalseAllowShare ?? 0) <
      thresholds.minRiskyFalseAllowShare
  ) {
    shortfalls.add("risky_false_allow_share_below_threshold");
  }
  if (!qualityReport.metrics.nonAuthorityParity) {
    shortfalls.add("authority_parity_broken");
  }

  const orderedShortfalls =
    CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_CAPABILITY_SHORTFALL_CODES
      .filter((code) => shortfalls.has(code));

  return {
    passed: orderedShortfalls.length === 0,
    thresholds,
    metricMargins: {
      sampleCount: quantification.sampleCount - thresholds.minSamples,
      evaluatedCandidateCount:
        quantification.evaluatedCandidateCount -
        thresholds.minEvaluatedCandidates,
      blockPrecision:
        quantification.blockPrecision === undefined
          ? undefined
          : quantification.blockPrecision - thresholds.minBlockPrecision,
      falseBlockRate:
        quantification.falseBlockRate === undefined
          ? undefined
          : thresholds.maxFalseBlockRate - quantification.falseBlockRate,
      falseAllowRate:
        quantification.falseAllowRate === undefined
          ? undefined
          : thresholds.maxFalseAllowRate - quantification.falseAllowRate,
      riskyFalseAllowShare:
        quantification.riskyFalseAllowShare === undefined
          ? undefined
          : quantification.riskyFalseAllowShare -
            thresholds.minRiskyFalseAllowShare,
      falseBlockCauseCoverageRate:
        qualityReport.metrics.falseBlockCount > 0
          ? (quantification.falseBlockCauseCoverageRate ?? 0) -
            thresholds.requiredFalseBlockCauseCoverageRate
          : 0,
      matrixCoverageRate:
        (quantification.matrixCoverageRate ?? 0) -
        thresholds.requiredMatrixCoverageRate,
    },
    categoryCoverage: sampleCategoryCoverage(quantification.categoryCounts),
    shortfallCodes: orderedShortfalls,
    remediationTargets: orderedShortfalls.map((code) =>
      optimizationCapabilityRemediationTarget(code, {
        qualityReport,
        quantification,
        thresholds,
      }),
    ),
  };
}

function sampleCategoryCoverage(
  categoryCounts: Record<CodeTaskEvidenceGateSampleCategory, number>,
): CodeTaskEvidenceGateShadowEvidenceOptimizationReport["capabilityAssessment"]["categoryCoverage"] {
  const coverage =
    {} as CodeTaskEvidenceGateShadowEvidenceOptimizationReport["capabilityAssessment"]["categoryCoverage"];
  for (const category of CODE_TASK_EVIDENCE_GATE_SAMPLE_CATEGORIES) {
    const count = categoryCounts[category];
    coverage[category] = {
      count,
      covered: count > 0,
      required: isRequiredOptimizationCategory(category),
    };
  }
  return coverage;
}

function isRequiredOptimizationCategory(
  category: CodeTaskEvidenceGateSampleCategory,
): boolean {
  return CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_REQUIRED_CATEGORIES
    .some((requiredCategory) => requiredCategory === category);
}

function optimizationCapabilityRemediationTarget(
  code: CodeTaskEvidenceGateShadowEvidenceOptimizationCapabilityShortfallCode,
  params: {
    qualityReport: CodeTaskEvidenceGateShadowEvidenceQualityReport;
    quantification: CodeTaskEvidenceGateShadowEvidenceOptimizationReport["quantification"];
    thresholds: CodeTaskEvidenceGateShadowEvidenceOptimizationReport["capabilityAssessment"]["thresholds"];
  },
): CodeTaskEvidenceGateShadowEvidenceOptimizationReport["capabilityAssessment"]["remediationTargets"][number] {
  const { qualityReport, quantification, thresholds } = params;
  switch (code) {
    case "quality_strategy_not_ready":
      return {
        code,
        metric: "qualityDecision",
        actual:
          qualityReport.decision ===
          "ready_for_limited_default_off_readiness_review"
            ? 1
            : 0,
        target: 1,
        action: "Resolve quality diagnostics before readiness review.",
      };
    case "sample_count_below_threshold":
      return {
        code,
        metric: "sampleCount",
        actual: quantification.sampleCount,
        target: thresholds.minSamples,
        action: "Add caller-supplied in-memory evaluation samples.",
      };
    case "evaluated_candidate_count_below_threshold":
      return {
        code,
        metric: "evaluatedCandidateCount",
        actual: quantification.evaluatedCandidateCount,
        target: thresholds.minEvaluatedCandidates,
        action: "Add evaluated code-task gate candidates.",
      };
    case "fixture_matrix_incomplete":
      return {
        code,
        metric: "matrixCoverageRate",
        actual: quantification.matrixCoverageRate ?? 0,
        target: thresholds.requiredMatrixCoverageRate,
        action: "Cover every required synthetic/sanitized fixture category.",
      };
    case "block_precision_missing":
      return {
        code,
        metric: "blockPrecision",
        target: thresholds.minBlockPrecision,
        action: "Add block outcomes so block precision can be measured.",
      };
    case "block_precision_below_threshold":
      return {
        code,
        metric: "blockPrecision",
        actual: quantification.blockPrecision,
        target: thresholds.minBlockPrecision,
        action: "Reduce false blocks or improve block classification.",
      };
    case "false_block_rate_missing":
      return {
        code,
        metric: "falseBlockRate",
        target: thresholds.maxFalseBlockRate,
        action: "Add block outcomes so false-block rate can be measured.",
      };
    case "false_block_rate_above_threshold":
      return {
        code,
        metric: "falseBlockRate",
        actual: quantification.falseBlockRate,
        target: thresholds.maxFalseBlockRate,
        action: "Reduce benign cases classified as would_block.",
      };
    case "false_allow_rate_missing":
      return {
        code,
        metric: "falseAllowRate",
        target: thresholds.maxFalseAllowRate,
        action: "Add allow outcomes so false-allow rate can be measured.",
      };
    case "false_allow_rate_above_threshold":
      return {
        code,
        metric: "falseAllowRate",
        actual: quantification.falseAllowRate,
        target: thresholds.maxFalseAllowRate,
        action: "Improve risky allow detection before readiness review.",
      };
    case "false_block_cause_coverage_incomplete":
      return {
        code,
        metric: "falseBlockCauseCoverageRate",
        actual: quantification.falseBlockCauseCoverageRate ?? 0,
        target: thresholds.requiredFalseBlockCauseCoverageRate,
        action: "Classify every false-block evidence capture cause.",
      };
    case "risky_false_allow_share_below_threshold":
      return {
        code,
        metric: "riskyFalseAllowShare",
        actual: quantification.riskyFalseAllowShare ?? 0,
        target: thresholds.minRiskyFalseAllowShare,
        action: "Add semantic risk signals for false allows.",
      };
    case "authority_parity_broken":
      return {
        code,
        metric: "nonAuthorityParity",
        actual: qualityReport.metrics.nonAuthorityParity ? 1 : 0,
        target: 1,
        action: "Remove authority drift before continuing this route.",
      };
  }
}

function shadowEvidenceOptimizationDiagnostics(params: {
  qualityReport: CodeTaskEvidenceGateShadowEvidenceQualityReport;
  quantification: CodeTaskEvidenceGateShadowEvidenceOptimizationReport["quantification"];
}): CodeTaskEvidenceGateShadowEvidenceOptimizationDiagnostic[] {
  const diagnostics: CodeTaskEvidenceGateShadowEvidenceOptimizationDiagnostic[] = [];
  if (params.qualityReport.decision === "ready_for_limited_default_off_readiness_review") {
    diagnostics.push({
      code: "shadow_evidence_optimization_strategy_ready",
      severity: "info",
      message: "Shadow evidence quality strategy is ready for readiness review.",
    });
  } else if (
    params.qualityReport.decision ===
    "continue_internal_shadow_observation_hardening"
  ) {
    diagnostics.push({
      code: "shadow_evidence_optimization_strategy_continue_hardening",
      severity: "warning",
      message: "Shadow evidence quality strategy requires continued hardening.",
    });
  } else {
    diagnostics.push({
      code: "shadow_evidence_optimization_strategy_stop_or_freeze",
      severity: "error",
      message: "Shadow evidence quality strategy requires stop or freeze.",
    });
  }

  if (
    params.quantification.coveredRequiredCategoryCount <
    params.quantification.requiredCategoryCount
  ) {
    diagnostics.push({
      code: "shadow_evidence_optimization_matrix_incomplete",
      severity: "warning",
      message: "Synthetic in-memory fixture matrix is missing required categories.",
      actual: params.quantification.coveredRequiredCategoryCount,
      threshold: params.quantification.requiredCategoryCount,
    });
  } else {
    diagnostics.push({
      code: "shadow_evidence_optimization_matrix_complete",
      severity: "info",
      message: "Synthetic in-memory fixture matrix covers required categories.",
      actual: params.quantification.coveredRequiredCategoryCount,
      threshold: params.quantification.requiredCategoryCount,
    });
  }

  const thresholds = defaultRuntimeReplayReadinessThresholds();
  if (
    params.quantification.sampleCount < thresholds.minSamples
  ) {
    diagnostics.push({
      code: "shadow_evidence_optimization_min_samples_not_met",
      severity: "warning",
      message: "Optimization matrix does not contain enough samples.",
      actual: params.quantification.sampleCount,
      threshold: thresholds.minSamples,
    });
  }
  if (
    params.quantification.evaluatedCandidateCount <
    thresholds.minEvaluatedCandidates
  ) {
    diagnostics.push({
      code: "shadow_evidence_optimization_min_evaluated_candidates_not_met",
      severity: "warning",
      message: "Optimization matrix does not contain enough evaluated candidates.",
      actual: params.quantification.evaluatedCandidateCount,
      threshold: thresholds.minEvaluatedCandidates,
    });
  }
  if (params.quantification.blockPrecision === undefined) {
    diagnostics.push({
      code: "shadow_evidence_optimization_block_precision_missing",
      severity: "warning",
      message: "Optimization matrix block precision is unavailable.",
      threshold: thresholds.minBlockPrecision,
    });
  } else if (
    params.quantification.blockPrecision < thresholds.minBlockPrecision
  ) {
    diagnostics.push({
      code: "shadow_evidence_optimization_block_precision_below_threshold",
      severity: "warning",
      message: "Optimization matrix block precision is below threshold.",
      actual: params.quantification.blockPrecision,
      threshold: thresholds.minBlockPrecision,
    });
  }
  if (params.quantification.falseBlockRate === undefined) {
    diagnostics.push({
      code: "shadow_evidence_optimization_false_block_rate_missing",
      severity: "warning",
      message: "Optimization matrix false-block rate is unavailable.",
      threshold: thresholds.maxFalseBlockRate,
    });
  } else if (params.quantification.falseBlockRate > thresholds.maxFalseBlockRate) {
    diagnostics.push({
      code: "shadow_evidence_optimization_false_block_rate_above_threshold",
      severity: "warning",
      message: "Optimization matrix false-block rate is above threshold.",
      actual: params.quantification.falseBlockRate,
      threshold: thresholds.maxFalseBlockRate,
    });
  }
  if (params.quantification.falseAllowRate === undefined) {
    diagnostics.push({
      code: "shadow_evidence_optimization_false_allow_rate_missing",
      severity: "warning",
      message: "Optimization matrix false-allow rate is unavailable.",
      threshold: thresholds.maxFalseAllowRate,
    });
  } else if (params.quantification.falseAllowRate > thresholds.maxFalseAllowRate) {
    diagnostics.push({
      code: "shadow_evidence_optimization_false_allow_rate_above_threshold",
      severity: "warning",
      message: "Optimization matrix false-allow rate is above threshold.",
      actual: params.quantification.falseAllowRate,
      threshold: thresholds.maxFalseAllowRate,
    });
  }

  diagnostics.push({
    code: "shadow_evidence_optimization_non_authoritative",
    severity: params.qualityReport.metrics.nonAuthorityParity ? "info" : "error",
    message: params.qualityReport.metrics.nonAuthorityParity
      ? "Optimization report inputs preserve non-authority."
      : "Optimization report inputs contain authority drift.",
  });
  diagnostics.push({
    code: "shadow_evidence_optimization_active_pilot_still_forbidden",
    severity: "info",
    message: "Active pilot remains forbidden and requires a later fresh spec.",
  });
  return diagnostics;
}

function shadowEvidenceOptimizationDecision(
  diagnostics: readonly CodeTaskEvidenceGateShadowEvidenceOptimizationDiagnostic[],
): CodeTaskEvidenceGateShadowEvidenceQualityDecision {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "stop_or_freeze_route";
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return "continue_internal_shadow_observation_hardening";
  }
  return "ready_for_limited_default_off_readiness_review";
}

function summarizeRuntimeReplayResults(
  results: readonly CodeTaskEvidenceGateRuntimeReplayResult[],
): CodeTaskEvidenceGateRuntimeReplaySummary {
  let sampledCount = 0;
  let disabledCount = 0;
  let invalidInputCount = 0;
  let evaluatedCandidateCount = 0;
  let trueAllowCount = 0;
  let usefulBlockCount = 0;
  let falseBlockCount = 0;
  let falseAllowCount = 0;
  let inconclusiveCount = 0;
  let notEvaluatedCount = 0;
  let riskyAllowCount = 0;
  let riskyFalseAllowCount = 0;
  let nonAuthoritativeCount = 0;
  let runtimeDecisionUnaffectedCount = 0;

  for (const result of results) {
    const samplerEvent = result.callerResult.samplerEvent;
    if (result.callerResult.sampled) {
      sampledCount += 1;
    }
    if (result.callerResult.outcome === "disabled") {
      disabledCount += 1;
    }
    if (result.callerResult.outcome === "invalid_input") {
      invalidInputCount += 1;
    }
    if (samplerEvent?.allowRiskTier === "risky_allow") {
      riskyAllowCount += 1;
    }
    if (result.callerResult.nonAuthoritative) {
      nonAuthoritativeCount += 1;
    }
    if (result.callerResult.runtimeDecisionUnaffected) {
      runtimeDecisionUnaffectedCount += 1;
    }

    switch (result.outcome) {
      case "true_allow":
        evaluatedCandidateCount += 1;
        trueAllowCount += 1;
        break;
      case "useful_block":
        evaluatedCandidateCount += 1;
        usefulBlockCount += 1;
        break;
      case "false_block":
        evaluatedCandidateCount += 1;
        falseBlockCount += 1;
        break;
      case "false_allow":
        evaluatedCandidateCount += 1;
        falseAllowCount += 1;
        if (samplerEvent?.allowRiskTier === "risky_allow") {
          riskyFalseAllowCount += 1;
        }
        break;
      case "inconclusive":
        inconclusiveCount += 1;
        break;
      case "not_evaluated":
        notEvaluatedCount += 1;
        break;
    }
  }

  return {
    sampleCount: results.length,
    sampledCount,
    disabledCount,
    invalidInputCount,
    evaluatedCandidateCount,
    trueAllowCount,
    usefulBlockCount,
    falseBlockCount,
    falseAllowCount,
    inconclusiveCount,
    notEvaluatedCount,
    blockPrecision: ratio(usefulBlockCount, usefulBlockCount + falseBlockCount),
    blockRecall: ratio(usefulBlockCount, usefulBlockCount + falseAllowCount),
    falseBlockRate: ratio(falseBlockCount, usefulBlockCount + falseBlockCount),
    falseAllowRate: ratio(falseAllowCount, trueAllowCount + falseAllowCount),
    usefulBlockFalseBlockRatio: ratio(usefulBlockCount, falseBlockCount),
    riskyAllowCount,
    riskyFalseAllowCount,
    riskyFalseAllowShare: ratio(riskyFalseAllowCount, falseAllowCount),
    nonAuthoritativeCount,
    completionAuthorityCount: 0,
    runtimeDecisionUnaffectedCount,
    callerSummary: summarizeCodeTaskEvidenceGateRuntimeCallerResults(
      results.map((result) => result.callerResult),
    ),
  };
}

function summarizeEvaluationResults(
  results: readonly CodeTaskEvidenceGateEvaluationResult[],
): CodeTaskEvidenceGateEvaluationSummary {
  let evaluatedCandidateCount = 0;
  let gateCandidateCount = 0;
  let trueAllowCount = 0;
  let usefulBlockCount = 0;
  let falseBlockCount = 0;
  let falseAllowCount = 0;
  let inconclusiveCount = 0;
  let notEvaluatedCount = 0;
  let riskyAllowCount = 0;
  let riskyFalseAllowCount = 0;
  const categoryCounts = emptySampleCategoryCounts();
  const falseBlockCauseCounts = emptyEvidenceCaptureIssueCounts();

  for (const result of results) {
    if (result.report.gateCandidate) {
      gateCandidateCount += 1;
    }
    if (result.category) {
      categoryCounts[result.category] += 1;
    }
    if (result.report.allowRiskTier === "risky_allow") {
      riskyAllowCount += 1;
    }
    switch (result.outcome) {
      case "true_allow":
        evaluatedCandidateCount += 1;
        trueAllowCount += 1;
        break;
      case "useful_block":
        evaluatedCandidateCount += 1;
        usefulBlockCount += 1;
        break;
      case "false_block":
        evaluatedCandidateCount += 1;
        falseBlockCount += 1;
        if (result.report.evidenceCaptureIssue) {
          falseBlockCauseCounts[result.report.evidenceCaptureIssue] += 1;
        }
        break;
      case "false_allow":
        evaluatedCandidateCount += 1;
        falseAllowCount += 1;
        if (result.report.allowRiskTier === "risky_allow") {
          riskyFalseAllowCount += 1;
        }
        break;
      case "inconclusive":
        inconclusiveCount += 1;
        break;
      case "not_evaluated":
        notEvaluatedCount += 1;
        break;
    }
  }

  return {
    sampleCount: results.length,
    gateCandidateCount,
    evaluatedCandidateCount,
    trueAllowCount,
    usefulBlockCount,
    falseBlockCount,
    falseAllowCount,
    inconclusiveCount,
    notEvaluatedCount,
    blockPrecision: ratio(usefulBlockCount, usefulBlockCount + falseBlockCount),
    blockRecall: ratio(usefulBlockCount, usefulBlockCount + falseAllowCount),
    falseBlockRate: ratio(falseBlockCount, usefulBlockCount + falseBlockCount),
    falseAllowRate: ratio(falseAllowCount, trueAllowCount + falseAllowCount),
    usefulBlockFalseBlockRatio: ratio(usefulBlockCount, falseBlockCount),
    riskyAllowCount,
    riskyFalseAllowCount,
    riskyFalseAllowShare: ratio(riskyFalseAllowCount, falseAllowCount),
    categoryCounts,
    falseBlockCauseCounts,
    shadowSummary: summarizeCodeTaskEvidenceGateShadowReports(
      results.map((result) => result.report),
    ),
  };
}

function isCodeTaskEvidenceGateShadowInput(
  value: unknown,
): value is CodeTaskEvidenceGateShadowInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<CodeTaskEvidenceGateShadowInput>;
  return (
    isNonEmptyString(record.taskId) &&
    isNonEmptyString(record.objective) &&
    isTaskKind(record.taskKind) &&
    isLegacyTerminalStatus(record.legacyTerminalStatus) &&
    (record.verifierReport === undefined ||
      isEvidenceVerifierReport(record.verifierReport))
  );
}

function isTaskKind(value: unknown): value is CodeTaskEvidenceGateTaskKind {
  return CODE_TASK_EVIDENCE_GATE_TASK_KINDS.includes(
    value as CodeTaskEvidenceGateTaskKind,
  );
}

function isLegacyTerminalStatus(
  value: unknown,
): value is CodeTaskEvidenceGateLegacyTerminalStatus {
  return CODE_TASK_EVIDENCE_GATE_LEGACY_TERMINAL_STATUSES.includes(
    value as CodeTaskEvidenceGateLegacyTerminalStatus,
  );
}

function isLegacyCompleted(
  status: CodeTaskEvidenceGateLegacyTerminalStatus,
): boolean {
  return status === "complete" || status === "completed";
}

function evaluationOutcome(
  report: CodeTaskEvidenceGateShadowReport,
  label: CodeTaskEvidenceGateManualReviewLabel,
): CodeTaskEvidenceGateEvaluationOutcome {
  if (
    label === "inconclusive" ||
    report.decision === "not_applicable" ||
    report.decision === "invalid_input"
  ) {
    return label === "inconclusive" ? "inconclusive" : "not_evaluated";
  }
  if (report.decision === "would_block") {
    return label === "bad_completion" ? "useful_block" : "false_block";
  }
  if (report.decision === "would_allow") {
    return label === "valid_completion" ? "true_allow" : "false_allow";
  }
  return "not_evaluated";
}

function runtimeReplayOutcome(
  callerResult: CodeTaskEvidenceGateRuntimeCallerResult,
  label: CodeTaskEvidenceGateManualReviewLabel | undefined,
): CodeTaskEvidenceGateEvaluationOutcome {
  const shadowDecision = callerResult.samplerEvent?.shadowDecision;
  if (
    !label ||
    !callerResult.sampled ||
    shadowDecision === undefined ||
    shadowDecision === "not_applicable" ||
    shadowDecision === "invalid_input"
  ) {
    return "not_evaluated";
  }
  if (label === "inconclusive") {
    return "inconclusive";
  }
  if (shadowDecision === "would_block") {
    return label === "bad_completion" ? "useful_block" : "false_block";
  }
  if (shadowDecision === "would_allow") {
    return label === "valid_completion" ? "true_allow" : "false_allow";
  }
  return "not_evaluated";
}

function defaultRuntimeReplayReadinessThresholds(): CodeTaskEvidenceGateRuntimeReplayReadinessThresholds {
  return {
    minSamples: 20,
    minEvaluatedCandidates: 16,
    minBlockPrecision: 0.8,
    maxFalseBlockRate: 0.2,
    maxFalseAllowRate: 0.25,
    minUsefulBlockFalseBlockRatio: 4,
    minRiskyFalseAllowShare: 0.6,
  };
}

function runtimeReplayReadinessDiagnostics(params: {
  metrics: CodeTaskEvidenceGateRuntimeReplayReadinessReport["metrics"];
  thresholds: CodeTaskEvidenceGateRuntimeReplayReadinessThresholds;
}): CodeTaskEvidenceGateRuntimeReplayReadinessDiagnostic[] {
  const diagnostics: CodeTaskEvidenceGateRuntimeReplayReadinessDiagnostic[] = [];
  const { metrics, thresholds } = params;

  addRuntimeReplayMinimumDiagnostic(diagnostics, {
    code: "runtime_replay_min_samples_not_met",
    actual: metrics.sampleCount,
    threshold: thresholds.minSamples,
    message: "Runtime-shaped replay does not contain enough samples.",
  });
  addRuntimeReplayMinimumDiagnostic(diagnostics, {
    code: "runtime_replay_min_evaluated_candidates_not_met",
    actual: metrics.evaluatedCandidateCount,
    threshold: thresholds.minEvaluatedCandidates,
    message: "Runtime-shaped replay does not contain enough evaluated candidates.",
  });
  addRuntimeReplayMinimumDiagnostic(diagnostics, {
    code: "runtime_replay_block_precision_below_threshold",
    missingCode: "runtime_replay_block_precision_missing",
    actual: metrics.blockPrecision,
    threshold: thresholds.minBlockPrecision,
    message: "Runtime-shaped replay block precision is below threshold.",
    missingMessage: "Runtime-shaped replay block precision is unavailable.",
  });
  addRuntimeReplayMaximumDiagnostic(diagnostics, {
    code: "runtime_replay_false_block_rate_above_threshold",
    actual: metrics.falseBlockRate,
    threshold: thresholds.maxFalseBlockRate,
    message: "Runtime-shaped replay false-block rate is above threshold.",
  });
  addRuntimeReplayMaximumDiagnostic(diagnostics, {
    code: "runtime_replay_false_allow_rate_above_threshold",
    actual: metrics.falseAllowRate,
    threshold: thresholds.maxFalseAllowRate,
    message: "Runtime-shaped replay false-allow rate is above threshold.",
  });
  addRuntimeReplayMinimumDiagnostic(diagnostics, {
    code: "runtime_replay_useful_block_ratio_below_threshold",
    missingCode: "runtime_replay_useful_block_ratio_missing",
    actual: metrics.usefulBlockFalseBlockRatio,
    threshold: thresholds.minUsefulBlockFalseBlockRatio,
    message: "Runtime-shaped replay useful-block ratio is below threshold.",
    missingMessage: "Runtime-shaped replay useful-block ratio is unavailable.",
  });
  addRuntimeReplayMinimumDiagnostic(diagnostics, {
    code: "runtime_replay_risky_false_allow_share_below_threshold",
    actual: metrics.riskyFalseAllowShare,
    threshold: thresholds.minRiskyFalseAllowShare,
    message: "Runtime-shaped replay risky false-allow share is below threshold.",
  });

  if (
    metrics.nonAuthoritativeCount !== metrics.sampleCount ||
    metrics.completionAuthorityCount !== 0 ||
    metrics.runtimeDecisionUnaffectedCount !== metrics.sampleCount
  ) {
    diagnostics.push({
      code: "runtime_replay_non_authority_violation",
      severity: "error",
      message: "Runtime-shaped replay contains an authority or decision drift signal.",
    });
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    diagnostics.push({
      code: "runtime_replay_thresholds_met",
      severity: "info",
      message: "Runtime-shaped shadow replay thresholds are met.",
    });
  }
  diagnostics.push({
    code: "runtime_replay_active_pilot_still_requires_fresh_spec",
    severity: "info",
    message: "Active pilot still requires a fresh accepted spec and stronger evidence.",
  });

  return diagnostics;
}

function addRuntimeReplayMinimumDiagnostic(
  diagnostics: CodeTaskEvidenceGateRuntimeReplayReadinessDiagnostic[],
  params: {
    code: CodeTaskEvidenceGateRuntimeReplayReadinessDiagnosticCode;
    missingCode?: CodeTaskEvidenceGateRuntimeReplayReadinessDiagnosticCode;
    actual: number | undefined;
    threshold: number | undefined;
    message: string;
    missingMessage?: string;
  },
): void {
  if (params.threshold === undefined) {
    return;
  }
  if (params.actual === undefined) {
    diagnostics.push({
      code: params.missingCode ?? params.code,
      severity: "error",
      message: params.missingMessage ?? params.message,
      threshold: params.threshold,
    });
    return;
  }
  if (params.actual < params.threshold) {
    diagnostics.push({
      code: params.code,
      severity: "error",
      message: params.message,
      actual: params.actual,
      threshold: params.threshold,
    });
  }
}

function addRuntimeReplayMaximumDiagnostic(
  diagnostics: CodeTaskEvidenceGateRuntimeReplayReadinessDiagnostic[],
  params: {
    code: CodeTaskEvidenceGateRuntimeReplayReadinessDiagnosticCode;
    actual: number | undefined;
    threshold: number | undefined;
    message: string;
  },
): void {
  if (params.threshold === undefined || params.actual === undefined) {
    return;
  }
  if (params.actual > params.threshold) {
    diagnostics.push({
      code: params.code,
      severity: "error",
      message: params.message,
      actual: params.actual,
      threshold: params.threshold,
    });
  }
}

function runtimeReplayReadinessDecision(
  diagnostics: readonly CodeTaskEvidenceGateRuntimeReplayReadinessDiagnostic[],
): CodeTaskEvidenceGateRuntimeReplayReadinessDecision {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "blocked";
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return "continue_runtime_shadow_replay";
  }
  return "ready_for_shadow_evidence_review";
}

function defaultReadinessThresholds(
  stage: CodeTaskEvidenceGateReadinessStage,
): CodeTaskEvidenceGateReadinessThresholds {
  switch (stage) {
    case "offline_corpus":
      return {
        minSamples: 8,
        minEvaluatedCandidates: 6,
        maxInconclusiveRate: 0.25,
      };
    case "shadow_sampler":
      return {
        minSamples: 100,
        minEvaluatedCandidates: 80,
        minBlockPrecision: 0.8,
        maxFalseBlockRate: 0.2,
        maxFalseAllowRate: 0.25,
        minUsefulBlockFalseBlockRatio: 4,
        maxMissingReportShare: 0.5,
      };
    case "active_pilot":
      return {
        minSamples: 50,
        minEvaluatedCandidates: 30,
        minBlockPrecision: 0.8,
        minBlockRecall: 0.5,
        maxFalseBlockRate: 0.15,
        maxFalseAllowRate: 0.25,
        maxMissingReportShare: 0.2,
        minRuntimeShadowSamples: 100,
      };
  }
}

function readinessMetrics(
  evaluation: CodeTaskEvidenceGateEvaluationReport,
  runtimeShadowEvidence: CodeTaskEvidenceGateRuntimeShadowEvidence | undefined,
): CodeTaskEvidenceGateReadinessReport["metrics"] {
  const summary = evaluation.summary;
  const candidateCount = summary.evaluatedCandidateCount;
  const blockCount = summary.usefulBlockCount + summary.falseBlockCount;
  const allowCount = summary.trueAllowCount + summary.falseAllowCount;
  return {
    sampleCount: summary.sampleCount,
    evaluatedCandidateCount: candidateCount,
    blockPrecision: summary.blockPrecision,
    blockRecall: summary.blockRecall,
    falseBlockRate: ratio(summary.falseBlockCount, blockCount),
    falseAllowRate: ratio(summary.falseAllowCount, allowCount),
    usefulBlockFalseBlockRatio: summary.usefulBlockFalseBlockRatio,
    riskyFalseAllowShare: summary.riskyFalseAllowShare,
    inconclusiveRate: ratio(summary.inconclusiveCount, summary.sampleCount),
    missingReportShare: ratio(
      summary.shadowSummary.blockReasonCounts.missing_verifier_report,
      summary.shadowSummary.wouldBlockCount,
    ),
    ...(runtimeShadowEvidence
      ? { runtimeShadowSampleCount: runtimeShadowEvidence.sampleCount }
      : {}),
  };
}

function readinessDiagnostics(params: {
  stage: CodeTaskEvidenceGateReadinessStage;
  thresholds: CodeTaskEvidenceGateReadinessThresholds;
  metrics: CodeTaskEvidenceGateReadinessReport["metrics"];
  runtimeShadowEvidence: CodeTaskEvidenceGateRuntimeShadowEvidence | undefined;
}): CodeTaskEvidenceGateReadinessDiagnostic[] {
  const diagnostics: CodeTaskEvidenceGateReadinessDiagnostic[] = [];
  const { stage, thresholds, metrics, runtimeShadowEvidence } = params;

  addMinimumDiagnostic(diagnostics, {
    code: "min_samples_not_met",
    actual: metrics.sampleCount,
    threshold: thresholds.minSamples,
    message: "Evaluation corpus does not contain enough samples.",
  });
  addMinimumDiagnostic(diagnostics, {
    code: "min_candidates_not_met",
    actual: metrics.evaluatedCandidateCount,
    threshold: thresholds.minEvaluatedCandidates,
    message: "Evaluation corpus does not contain enough evaluated gate candidates.",
  });
  addMinimumDiagnostic(diagnostics, {
    code: "block_precision_below_threshold",
    missingCode: "block_precision_missing",
    actual: metrics.blockPrecision,
    threshold: thresholds.minBlockPrecision,
    message: "Useful-block precision is below the readiness threshold.",
    missingMessage: "Useful-block precision is unavailable for this evaluation.",
  });
  addMinimumDiagnostic(diagnostics, {
    code: "block_recall_below_threshold",
    missingCode: "block_recall_missing",
    actual: metrics.blockRecall,
    threshold: thresholds.minBlockRecall,
    message: "Useful-block recall is below the readiness threshold.",
    missingMessage: "Useful-block recall is unavailable for this evaluation.",
  });
  addMaximumDiagnostic(diagnostics, {
    code: "false_block_rate_above_threshold",
    actual: metrics.falseBlockRate,
    threshold: thresholds.maxFalseBlockRate,
    message: "False-block rate is above the readiness threshold.",
  });
  addMaximumDiagnostic(diagnostics, {
    code: "false_allow_rate_above_threshold",
    actual: metrics.falseAllowRate,
    threshold: thresholds.maxFalseAllowRate,
    message: "False-allow rate is above the readiness threshold.",
  });
  addMinimumDiagnostic(diagnostics, {
    code: "useful_block_false_block_ratio_below_threshold",
    missingCode: "useful_block_false_block_ratio_missing",
    actual: metrics.usefulBlockFalseBlockRatio,
    threshold: thresholds.minUsefulBlockFalseBlockRatio,
    message: "Useful-block to false-block ratio is below the readiness threshold.",
    missingMessage: "Useful-block to false-block ratio is unavailable for this evaluation.",
  });
  addMaximumDiagnostic(diagnostics, {
    code: "inconclusive_rate_above_threshold",
    actual: metrics.inconclusiveRate,
    threshold: thresholds.maxInconclusiveRate,
    message: "Inconclusive sample rate is above the readiness threshold.",
  });
  addMaximumDiagnostic(diagnostics, {
    code: "missing_report_share_above_threshold",
    actual: metrics.missingReportShare,
    threshold: thresholds.maxMissingReportShare,
    message: "Missing verifier reports dominate shadow blocks.",
  });

  if (stage === "active_pilot") {
    if (!runtimeShadowEvidence) {
      diagnostics.push({
        code: "runtime_shadow_evidence_required",
        severity: "error",
        message: "Active pilot readiness requires explicit runtime shadow evidence.",
      });
    } else {
      addMinimumDiagnostic(diagnostics, {
        code: "runtime_shadow_samples_below_threshold",
        actual: runtimeShadowEvidence.sampleCount,
        threshold: thresholds.minRuntimeShadowSamples,
        message: "Runtime shadow evidence does not contain enough samples.",
      });
    }
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      code: "readiness_thresholds_met",
      severity: "info",
      message: "Code-task gate readiness thresholds are met for this stage.",
    });
  }

  return diagnostics;
}

function addMinimumDiagnostic(
  diagnostics: CodeTaskEvidenceGateReadinessDiagnostic[],
  params: {
    code: CodeTaskEvidenceGateReadinessDiagnosticCode;
    missingCode?: CodeTaskEvidenceGateReadinessDiagnosticCode;
    actual: number | undefined;
    threshold: number | undefined;
    message: string;
    missingMessage?: string;
  },
): void {
  if (params.threshold === undefined) {
    return;
  }
  if (params.actual === undefined) {
    diagnostics.push({
      code: params.missingCode ?? params.code,
      severity: "error",
      message: params.missingMessage ?? params.message,
      threshold: params.threshold,
    });
    return;
  }
  if (params.actual < params.threshold) {
    diagnostics.push({
      code: params.code,
      severity: "error",
      message: params.message,
      actual: params.actual,
      threshold: params.threshold,
    });
  }
}

function addMaximumDiagnostic(
  diagnostics: CodeTaskEvidenceGateReadinessDiagnostic[],
  params: {
    code: CodeTaskEvidenceGateReadinessDiagnosticCode;
    actual: number | undefined;
    threshold: number | undefined;
    message: string;
  },
): void {
  if (params.threshold === undefined || params.actual === undefined) {
    return;
  }
  if (params.actual > params.threshold) {
    diagnostics.push({
      code: params.code,
      severity: "error",
      message: params.message,
      actual: params.actual,
      threshold: params.threshold,
    });
  }
}

function readinessDecision(
  diagnostics: readonly CodeTaskEvidenceGateReadinessDiagnostic[],
): CodeTaskEvidenceGateReadinessDecision {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "blocked";
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return "needs_more_evidence";
  }
  return "ready";
}

function blockReasonForVerifierDecision(
  decision: Exclude<EvidenceVerifierDecision, "completed">,
): CodeTaskEvidenceGateBlockReason {
  switch (decision) {
    case "failed":
      return "verifier_failed";
    case "blocked":
      return "verifier_blocked";
    case "cancelled":
      return "verifier_cancelled";
    case "insufficient_evidence":
      return "verifier_insufficient_evidence";
  }
}

function diagnosticCodeForBlockReason(
  reason: CodeTaskEvidenceGateBlockReason,
): CodeTaskEvidenceGateShadowDiagnosticCode {
  switch (reason) {
    case "missing_verifier_report":
      return "missing_verifier_report";
    case "verifier_failed":
      return "verifier_failed";
    case "verifier_blocked":
      return "verifier_blocked";
    case "verifier_cancelled":
      return "verifier_cancelled";
    case "verifier_insufficient_evidence":
      return "verifier_insufficient_evidence";
  }
}

function findingCodes(
  report: EvidenceVerifierReport,
): EvidenceVerifierFindingCode[] {
  return Array.from(
    new Set(report.findings.map((finding) => finding.code)),
  ).sort();
}

function evidenceCaptureIssueForBlock(
  input: CodeTaskEvidenceGateShadowInput,
  blockReason: CodeTaskEvidenceGateBlockReason,
): CodeTaskEvidenceGateEvidenceCaptureIssue {
  const configuredIssue = stringMetadata(input.metadata, "evidenceCaptureIssue");
  if (isEvidenceCaptureIssue(configuredIssue)) {
    return configuredIssue;
  }
  const legacyIssue = stringMetadata(input.metadata, "falseBlockCause");
  if (isEvidenceCaptureIssue(legacyIssue)) {
    return legacyIssue;
  }
  if (blockReason === "missing_verifier_report") {
    return "truly_missing_validation";
  }
  return "truly_missing_validation";
}

function evidenceCaptureDiagnostic(
  issue: CodeTaskEvidenceGateEvidenceCaptureIssue,
): CodeTaskEvidenceGateShadowDiagnostic {
  return makeDiagnostic({
    code: diagnosticCodeForEvidenceCaptureIssue(issue),
    severity: issue === "truly_missing_validation" ? "warning" : "info",
    message: `Evidence-capture source is classified as ${issue}.`,
    evidenceCaptureIssue: issue,
  });
}

function diagnosticCodeForEvidenceCaptureIssue(
  issue: CodeTaskEvidenceGateEvidenceCaptureIssue,
): CodeTaskEvidenceGateShadowDiagnosticCode {
  switch (issue) {
    case "truly_missing_validation":
      return "evidence_capture_truly_missing_validation";
    case "validation_done_but_not_captured":
      return "evidence_capture_validation_done_but_not_captured";
    case "external_validation_not_represented":
      return "evidence_capture_external_validation_not_represented";
    case "local_test_not_required":
      return "evidence_capture_local_test_not_required";
    case "report_task_id_or_shape_issue":
      return "evidence_capture_report_task_id_or_shape_issue";
  }
}

function semanticRisksForCompletedReport(
  input: CodeTaskEvidenceGateShadowInput,
  report: EvidenceVerifierReport,
): CodeTaskEvidenceGateSemanticRiskCode[] {
  const risks = new Set<CodeTaskEvidenceGateSemanticRiskCode>();
  for (const riskCode of stringArrayMetadata(input.metadata, "semanticRiskSignals")) {
    if (isSemanticRiskCode(riskCode)) {
      risks.add(riskCode);
    }
  }
  if (booleanMetadata(input.metadata, "evidenceDiffMismatch") === true) {
    risks.add("evidence_diff_mismatch");
  }
  if (stringMetadata(input.metadata, "testCoverage") === "weak") {
    risks.add("weak_test_coverage");
  }
  if (booleanMetadata(input.metadata, "obligationEvidenceMapped") === false) {
    risks.add("obligation_not_mapped_to_evidence");
  }
  if (booleanMetadata(input.metadata, "semanticRegressionRisk") === true) {
    risks.add("semantic_regression_risk");
  }

  const changedFiles = stringArrayMetadata(input.metadata, "changedFiles");
  if (changedFiles.length > 0) {
    const representedFiles = new Set(
      report.evidenceRefs
        .filter((ref) => ref.type === "file")
        .map((ref) => normalizePathish(ref.ref)),
    );
    if (
      changedFiles.some((changedFile) =>
        !representedFiles.has(normalizePathish(changedFile))
      )
    ) {
      risks.add("changed_files_not_represented");
    }
  }

  return CODE_TASK_EVIDENCE_GATE_SEMANTIC_RISK_CODES.filter((riskCode) =>
    risks.has(riskCode)
  );
}

function semanticRiskDiagnostic(
  riskCode: CodeTaskEvidenceGateSemanticRiskCode,
): CodeTaskEvidenceGateShadowDiagnostic {
  return makeDiagnostic({
    code: riskCode,
    severity: "warning",
    message: `Completed verifier report carries semantic-risk signal ${riskCode}.`,
    semanticRiskCodes: [riskCode],
  });
}

function makeReport(
  value: Omit<
    CodeTaskEvidenceGateShadowReport,
    "legacyDecisionUnaffected" | "semanticRiskCodes" | "verifierFindingCodes"
  > & {
    semanticRiskCodes?: CodeTaskEvidenceGateSemanticRiskCode[];
    verifierFindingCodes?: EvidenceVerifierFindingCode[];
  },
): CodeTaskEvidenceGateShadowReport {
  return {
    ...value,
    semanticRiskCodes: stableSemanticRiskCodes(value.semanticRiskCodes ?? []),
    verifierFindingCodes: value.verifierFindingCodes ?? [],
    legacyDecisionUnaffected: true,
  };
}

function makeDiagnostic(
  diagnostic: CodeTaskEvidenceGateShadowDiagnostic,
): CodeTaskEvidenceGateShadowDiagnostic {
  return {
    ...diagnostic,
    ...(diagnostic.findingCodes
      ? { findingCodes: [...diagnostic.findingCodes].sort() }
      : {}),
    ...(diagnostic.semanticRiskCodes
      ? { semanticRiskCodes: stableSemanticRiskCodes(diagnostic.semanticRiskCodes) }
      : {}),
  };
}

function makeSamplerEvent(
  value: Omit<
    CodeTaskEvidenceGateShadowSamplerEvent,
    | "completionAuthority"
    | "diagnosticCodes"
    | "eventKind"
    | "legacyDecisionUnaffected"
    | "nonAuthoritative"
    | "retention"
    | "semanticRiskCodes"
    | "verifierFindingCodes"
  > & {
    semanticRiskCodes?: CodeTaskEvidenceGateSemanticRiskCode[];
    verifierFindingCodes?: EvidenceVerifierFindingCode[];
  },
): CodeTaskEvidenceGateShadowSamplerEvent {
  const diagnostics = value.diagnostics.map(makeSamplerDiagnostic);
  return {
    ...value,
    eventKind: "code_task_evidence_gate_shadow_sample",
    semanticRiskCodes: stableSemanticRiskCodes(value.semanticRiskCodes ?? []),
    verifierFindingCodes: value.verifierFindingCodes ?? [],
    diagnosticCodes: stableSamplerDiagnosticCodes(
      diagnostics.map((diagnostic) => diagnostic.code),
    ),
    diagnostics,
    nonAuthoritative: true,
    completionAuthority: false,
    retention: "caller_owned_non_persistent",
    legacyDecisionUnaffected: true,
  };
}

function makeSamplerDiagnostic(
  diagnostic: CodeTaskEvidenceGateShadowSamplerDiagnostic,
): CodeTaskEvidenceGateShadowSamplerDiagnostic {
  return diagnostic;
}

function makeRuntimeCallerResult(
  value: Omit<
    CodeTaskEvidenceGateRuntimeCallerResult,
    | "completionAuthority"
    | "diagnosticCodes"
    | "legacyDecisionUnaffected"
    | "nonAuthoritative"
    | "runtimeDecisionUnaffected"
  >,
): CodeTaskEvidenceGateRuntimeCallerResult {
  const diagnostics = value.diagnostics.map(makeRuntimeCallerDiagnostic);
  return {
    ...value,
    diagnosticCodes: stableRuntimeCallerDiagnosticCodes(
      diagnostics.map((diagnostic) => diagnostic.code),
    ),
    diagnostics,
    nonAuthoritative: true,
    completionAuthority: false,
    runtimeDecisionUnaffected: true,
    legacyDecisionUnaffected: true,
  };
}

function makeRuntimeCallerDiagnostic(
  diagnostic: CodeTaskEvidenceGateRuntimeCallerDiagnostic,
): CodeTaskEvidenceGateRuntimeCallerDiagnostic {
  return diagnostic;
}

function runtimeShadowProducerResultFromCaller(params: {
  input: CodeTaskEvidenceGateRuntimeShadowProducerInput;
  callerInput: CodeTaskEvidenceGateRuntimeCallerInput;
  callerResult: CodeTaskEvidenceGateRuntimeCallerResult;
}): CodeTaskEvidenceGateRuntimeShadowProducerResult {
  const { input, callerInput, callerResult } = params;
  const samplerEvent = callerResult.samplerEvent;
  if (
    callerResult.outcome === "invalid_input" ||
    samplerEvent?.shadowDecision === "invalid_input"
  ) {
    return makeRuntimeShadowProducerResult({
      producerId: input.producerId,
      completionEventId: input.completionEventId,
      mode: input.mode ?? "disabled",
      outcome: "invalid_input",
      sampled: false,
      taskId: callerResult.taskId,
      callerInput,
      callerResult,
      shadowDecision: samplerEvent?.shadowDecision,
      blockReason: samplerEvent?.blockReason,
      allowRiskTier: samplerEvent?.allowRiskTier,
      semanticRiskCodes: samplerEvent?.semanticRiskCodes,
      diagnostics: [
        makeRuntimeShadowProducerDiagnostic({
          code: "runtime_shadow_producer_invalid_input",
          severity: "error",
          message:
            "Runtime shadow producer caller result failed closed as invalid input.",
        }),
      ],
    });
  }

  const diagnostics: CodeTaskEvidenceGateRuntimeShadowProducerDiagnostic[] = [
    makeRuntimeShadowProducerDiagnostic({
      code: "runtime_shadow_producer_sampled",
      severity: "info",
      message: "Runtime shadow producer emitted a diagnostic sample.",
    }),
  ];

  if (samplerEvent?.shadowDecision === "would_block") {
    diagnostics.push(makeRuntimeShadowProducerDiagnostic({
      code: "runtime_shadow_producer_would_block",
      severity: "warning",
      message: "Runtime shadow producer diagnostic sample would block.",
    }));
  }
  if (samplerEvent?.allowRiskTier === "risky_allow") {
    diagnostics.push(makeRuntimeShadowProducerDiagnostic({
      code: "runtime_shadow_producer_risky_allow",
      severity: "warning",
      message: "Runtime shadow producer diagnostic sample is a risky allow.",
    }));
  }
  diagnostics.push(makeRuntimeShadowProducerDiagnostic({
    code: "runtime_shadow_producer_non_authoritative",
    severity: "info",
    message: "Runtime shadow producer has no completion authority.",
  }));

  return makeRuntimeShadowProducerResult({
    producerId: input.producerId,
    completionEventId: input.completionEventId,
    mode: input.mode ?? "disabled",
    outcome: callerResult.outcome === "sampled" ? "sampled" : callerResult.outcome,
    sampled: callerResult.sampled,
    taskId: callerResult.taskId,
    callerInput,
    callerResult,
    shadowDecision: samplerEvent?.shadowDecision,
    blockReason: samplerEvent?.blockReason,
    allowRiskTier: samplerEvent?.allowRiskTier,
    semanticRiskCodes: samplerEvent?.semanticRiskCodes,
    diagnostics,
  });
}

function makeRuntimeShadowProducerResult(
  value: Omit<
    CodeTaskEvidenceGateRuntimeShadowProducerResult,
    | "completionAuthority"
    | "diagnosticCodes"
    | "legacyDecisionUnaffected"
    | "nonAuthoritative"
    | "runtimeDecisionUnaffected"
    | "semanticRiskCodes"
  > & {
    semanticRiskCodes?: CodeTaskEvidenceGateSemanticRiskCode[];
  },
): CodeTaskEvidenceGateRuntimeShadowProducerResult {
  const diagnostics = value.diagnostics.map(makeRuntimeShadowProducerDiagnostic);
  return {
    ...value,
    semanticRiskCodes: stableSemanticRiskCodes(value.semanticRiskCodes ?? []),
    diagnosticCodes: stableRuntimeShadowProducerDiagnosticCodes(
      diagnostics.map((diagnostic) => diagnostic.code),
    ),
    diagnostics,
    nonAuthoritative: true,
    completionAuthority: false,
    runtimeDecisionUnaffected: true,
    legacyDecisionUnaffected: true,
  };
}

function makeRuntimeShadowProducerDiagnostic(
  diagnostic: CodeTaskEvidenceGateRuntimeShadowProducerDiagnostic,
): CodeTaskEvidenceGateRuntimeShadowProducerDiagnostic {
  return diagnostic;
}

function makeRuntimeShadowCollectionEntry(params: {
  sample: CodeTaskEvidenceGateRuntimeShadowCollectionSample;
  producerResult: CodeTaskEvidenceGateRuntimeShadowProducerResult;
}): CodeTaskEvidenceGateRuntimeShadowCollectionEntry {
  const { sample, producerResult } = params;
  const replaySample: CodeTaskEvidenceGateRuntimeReplaySample | undefined =
    producerResult.callerInput
    ? {
      replayId: sample.collectionSampleId,
      callerInput: producerResult.callerInput,
      ...(sample.manualReviewLabel
        ? { manualReviewLabel: sample.manualReviewLabel }
        : {}),
      ...(sample.category ? { category: sample.category } : {}),
      ...(sample.notes ? { notes: sample.notes } : {}),
      ...(sample.metadata ? { metadata: sample.metadata } : {}),
    }
    : undefined;
  return {
    collectionSampleId: sample.collectionSampleId,
    producerResult,
    ...(replaySample ? { replaySample } : {}),
  };
}

function makeRuntimeShadowCollectionResult(
  value: Omit<
    CodeTaskEvidenceGateRuntimeShadowCollectionResult,
    | "completionAuthority"
    | "diagnosticCodes"
    | "disabledCount"
    | "invalidInputCount"
    | "legacyDecisionUnaffected"
    | "nonAuthoritative"
    | "replaySampleCount"
    | "runtimeDecisionUnaffected"
    | "sampledCount"
  >,
): CodeTaskEvidenceGateRuntimeShadowCollectionResult {
  const diagnostics = value.diagnostics.map(makeRuntimeShadowCollectionDiagnostic);
  const sampledCount = value.entries.filter((entry) =>
    entry.producerResult.sampled
  ).length;
  const disabledCount = value.entries.filter((entry) =>
    entry.producerResult.outcome === "disabled"
  ).length;
  const invalidInputCount = value.entries.filter((entry) =>
    entry.producerResult.outcome === "invalid_input"
  ).length;
  const replaySampleCount = value.entries.filter((entry) =>
    entry.replaySample
  ).length;

  return {
    ...value,
    sampledCount,
    disabledCount,
    invalidInputCount,
    replaySampleCount,
    diagnosticCodes: stableRuntimeShadowCollectionDiagnosticCodes(
      diagnostics.map((diagnostic) => diagnostic.code),
    ),
    diagnostics,
    nonAuthoritative: true,
    completionAuthority: false,
    runtimeDecisionUnaffected: true,
    legacyDecisionUnaffected: true,
  };
}

function makeRuntimeShadowCollectionDiagnostic(
  diagnostic: CodeTaskEvidenceGateRuntimeShadowCollectionDiagnostic,
): CodeTaskEvidenceGateRuntimeShadowCollectionDiagnostic {
  return diagnostic;
}

function makeInternalShadowObservationResult(
  value: Omit<
    CodeTaskEvidenceGateInternalShadowObservationResult,
    | "acceptedSampleCount"
    | "activePilotRequiresFreshSpec"
    | "collectedCollectionCount"
    | "completionAuthority"
    | "diagnosticCodes"
    | "disabledCollectionCount"
    | "invalidCollectionCount"
    | "legacyDecisionUnaffected"
    | "nonAuthoritative"
    | "replayReadinessDecision"
    | "replaySampleCount"
    | "requestedSampleCount"
    | "riskyAllowCount"
    | "runtimeDecisionUnaffected"
    | "sampledCount"
    | "wouldBlockCount"
  > & {
    collections: readonly CodeTaskEvidenceGateRuntimeShadowCollectionResult[];
  },
): CodeTaskEvidenceGateInternalShadowObservationResult {
  const diagnostics = value.diagnostics.map(
    makeInternalShadowObservationDiagnostic,
  );
  let requestedSampleCount = 0;
  let acceptedSampleCount = 0;
  let sampledCount = 0;
  let replaySampleCount = 0;
  let wouldBlockCount = 0;
  let riskyAllowCount = 0;
  let collectedCollectionCount = 0;
  let disabledCollectionCount = 0;
  let invalidCollectionCount = 0;

  for (const collection of value.collections) {
    requestedSampleCount += collection.requestedSampleCount;
    acceptedSampleCount += collection.acceptedSampleCount;
    sampledCount += collection.sampledCount;
    replaySampleCount += collection.replaySampleCount;
    if (collection.outcome === "collected") {
      collectedCollectionCount += 1;
    }
    if (collection.outcome === "disabled") {
      disabledCollectionCount += 1;
    }
    if (collection.outcome === "invalid_input") {
      invalidCollectionCount += 1;
    }
    for (const entry of collection.entries) {
      if (entry.producerResult.shadowDecision === "would_block") {
        wouldBlockCount += 1;
      }
      if (entry.producerResult.allowRiskTier === "risky_allow") {
        riskyAllowCount += 1;
      }
    }
  }

  const result: CodeTaskEvidenceGateInternalShadowObservationResult = {
    observerId: value.observerId,
    mode: value.mode,
    outcome: value.outcome,
    observationDecision: value.observationDecision,
    requestedCollectionCount: value.requestedCollectionCount,
    acceptedCollectionCount: value.acceptedCollectionCount,
    droppedCollectionCount: value.droppedCollectionCount,
    collectedCollectionCount,
    disabledCollectionCount,
    invalidCollectionCount,
    requestedSampleCount,
    acceptedSampleCount,
    sampledCount,
    replaySampleCount,
    wouldBlockCount,
    riskyAllowCount,
    ...(value.replayReadiness
      ? { replayReadinessDecision: value.replayReadiness.decision }
      : {}),
    ...(value.replayReport ? { replayReport: value.replayReport } : {}),
    ...(value.replayReadiness ? { replayReadiness: value.replayReadiness } : {}),
    diagnosticCodes: stableInternalShadowObservationDiagnosticCodes(
      diagnostics.map((diagnostic) => diagnostic.code),
    ),
    diagnostics,
    nonAuthoritative: true,
    completionAuthority: false,
    runtimeDecisionUnaffected: true,
    legacyDecisionUnaffected: true,
    activePilotRequiresFreshSpec: true,
  };
  return result;
}

function makeInternalShadowObservationDiagnostic(
  diagnostic: CodeTaskEvidenceGateInternalShadowObservationDiagnostic,
): CodeTaskEvidenceGateInternalShadowObservationDiagnostic {
  return diagnostic;
}

function runtimeShadowCollectionDiagnostics(params: {
  requestedSampleCount: number;
  acceptedSampleCount: number;
}): CodeTaskEvidenceGateRuntimeShadowCollectionDiagnostic[] {
  const diagnostics: CodeTaskEvidenceGateRuntimeShadowCollectionDiagnostic[] = [];
  if (params.acceptedSampleCount < params.requestedSampleCount) {
    diagnostics.push(makeRuntimeShadowCollectionDiagnostic({
      code: "runtime_shadow_collection_sample_limit_applied",
      severity: "info",
      message: "Runtime shadow collection sample limit was applied.",
    }));
  }
  diagnostics.push(
    makeRuntimeShadowCollectionDiagnostic({
      code: "runtime_shadow_collection_collected",
      severity: "info",
      message: "Runtime shadow collection produced diagnostic samples.",
    }),
    makeRuntimeShadowCollectionDiagnostic({
      code: "runtime_shadow_collection_non_authoritative",
      severity: "info",
      message: "Runtime shadow collection has no completion authority.",
    }),
    makeRuntimeShadowCollectionDiagnostic({
      code: "runtime_shadow_collection_active_pilot_still_requires_fresh_spec",
      severity: "info",
      message:
        "Active pilot still requires a fresh accepted spec and stronger evidence.",
    }),
  );
  return diagnostics;
}

function internalShadowObservationDiagnostics(params: {
  requestedCollectionCount: number;
  acceptedCollectionCount: number;
  replayReadiness: CodeTaskEvidenceGateRuntimeReplayReadinessReport;
}): CodeTaskEvidenceGateInternalShadowObservationDiagnostic[] {
  const diagnostics: CodeTaskEvidenceGateInternalShadowObservationDiagnostic[] = [];
  if (params.acceptedCollectionCount < params.requestedCollectionCount) {
    diagnostics.push(makeInternalShadowObservationDiagnostic({
      code: "internal_shadow_observation_collection_limit_applied",
      severity: "info",
      message: "Internal shadow observation collection limit was applied.",
    }));
  }
  if (params.acceptedCollectionCount === 0) {
    diagnostics.push(makeInternalShadowObservationDiagnostic({
      code: "internal_shadow_observation_no_collections",
      severity: "warning",
      message: "Internal shadow observation received no accepted collections.",
    }));
  }
  diagnostics.push(makeInternalShadowObservationDiagnostic({
    code: "internal_shadow_observation_observed",
    severity: "info",
    message: "Internal shadow observation consumed caller-owned collections.",
  }));

  if (params.replayReadiness.decision === "ready_for_shadow_evidence_review") {
    diagnostics.push(makeInternalShadowObservationDiagnostic({
      code: "internal_shadow_observation_replay_ready_for_review",
      severity: "info",
      message: "Runtime replay readiness supports internal shadow review.",
    }));
  } else if (params.replayReadiness.decision === "continue_runtime_shadow_replay") {
    diagnostics.push(makeInternalShadowObservationDiagnostic({
      code: "internal_shadow_observation_replay_continue_hardening",
      severity: "warning",
      message: "Runtime replay readiness requires continued hardening.",
    }));
  } else {
    diagnostics.push(makeInternalShadowObservationDiagnostic({
      code: "internal_shadow_observation_replay_blocked",
      severity: "error",
      message: "Runtime replay readiness is blocked for this observation set.",
    }));
  }

  diagnostics.push(
    makeInternalShadowObservationDiagnostic({
      code: "internal_shadow_observation_non_authoritative",
      severity: "info",
      message: "Internal shadow observation has no completion authority.",
    }),
    makeInternalShadowObservationDiagnostic({
      code: "internal_shadow_observation_active_pilot_still_forbidden",
      severity: "info",
      message:
        "Active pilot remains forbidden unless a later fresh spec accepts it.",
    }),
  );
  return diagnostics;
}

function internalShadowObservationDecision(
  replayReadiness: CodeTaskEvidenceGateRuntimeReplayReadinessReport,
): CodeTaskEvidenceGateInternalShadowObservationDecision {
  if (replayReadiness.decision === "ready_for_shadow_evidence_review") {
    return "ready_for_limited_default_off_internal_shadow_observation_review";
  }
  if (replayReadiness.decision === "continue_runtime_shadow_replay") {
    return "continue_internal_shadow_observation_hardening";
  }
  return "stop_or_freeze_route";
}

function emptyBlockReasonCounts(): Record<CodeTaskEvidenceGateBlockReason, number> {
  return {
    missing_verifier_report: 0,
    verifier_failed: 0,
    verifier_blocked: 0,
    verifier_cancelled: 0,
    verifier_insufficient_evidence: 0,
  };
}

function emptySamplerModeCounts(): Record<
  CodeTaskEvidenceGateShadowSamplerMode,
  number
> {
  return {
    disabled: 0,
    shadow_only: 0,
  };
}

function emptySamplerOutcomeCounts(): Record<
  CodeTaskEvidenceGateShadowSamplerOutcome,
  number
> {
  return {
    not_sampled: 0,
    sampled: 0,
    invalid_input: 0,
  };
}

function emptyRuntimeCallerOutcomeCounts(): Record<
  CodeTaskEvidenceGateRuntimeCallerOutcome,
  number
> {
  return {
    disabled: 0,
    sampled: 0,
    invalid_input: 0,
  };
}

function emptySamplerShadowDecisionCounts(): Record<
  CodeTaskEvidenceGateShadowDecision | "not_sampled",
  number
> {
  return {
    would_allow: 0,
    would_block: 0,
    not_applicable: 0,
    invalid_input: 0,
    not_sampled: 0,
  };
}

function emptyRuntimeCallerDiagnosticCodeCounts(): Record<
  CodeTaskEvidenceGateRuntimeCallerDiagnosticCode,
  number
> {
  return {
    runtime_shadow_sampler_disabled: 0,
    runtime_shadow_sampler_invalid_input: 0,
    runtime_shadow_sampler_sampled: 0,
    runtime_shadow_sampler_non_authoritative: 0,
  };
}

function emptySamplerDiagnosticCodeCounts(): Record<
  CodeTaskEvidenceGateShadowSamplerDiagnosticCode,
  number
> {
  return {
    sampler_disabled: 0,
    sampler_invalid_input: 0,
    sampler_shadow_sampled: 0,
    sampler_non_authoritative: 0,
  };
}

function emptyEvidenceCaptureIssueCounts(): Record<
  CodeTaskEvidenceGateEvidenceCaptureIssue,
  number
> {
  return {
    truly_missing_validation: 0,
    validation_done_but_not_captured: 0,
    external_validation_not_represented: 0,
    local_test_not_required: 0,
    report_task_id_or_shape_issue: 0,
  };
}

function emptyAllowRiskTierCounts(): Record<
  CodeTaskEvidenceGateAllowRiskTier,
  number
> {
  return {
    clean_allow: 0,
    risky_allow: 0,
  };
}

function emptySemanticRiskCounts(): Record<
  CodeTaskEvidenceGateSemanticRiskCode,
  number
> {
  return {
    evidence_diff_mismatch: 0,
    weak_test_coverage: 0,
    changed_files_not_represented: 0,
    obligation_not_mapped_to_evidence: 0,
    semantic_regression_risk: 0,
  };
}

function emptySampleCategoryCounts(): Record<
  CodeTaskEvidenceGateSampleCategory,
  number
> {
  return {
    valid_full_evidence: 0,
    missing_validation_evidence: 0,
    tool_or_test_failure: 0,
    missing_verifier_report: 0,
    local_test_not_required: 0,
    external_validation_uncaptured: 0,
    non_code_task: 0,
    legacy_not_completed: 0,
    reviewer_inconclusive: 0,
    semantic_regression_with_complete_refs: 0,
    report_shape_issue: 0,
    other: 0,
  };
}

function emptyRuntimeReplayReadinessDecisionCounts(): Record<
  CodeTaskEvidenceGateRuntimeReplayReadinessDecision,
  number
> {
  return {
    ready_for_shadow_evidence_review: 0,
    continue_runtime_shadow_replay: 0,
    blocked: 0,
  };
}

function emptyInternalShadowObservationDecisionCounts(): Record<
  CodeTaskEvidenceGateInternalShadowObservationDecision,
  number
> {
  return {
    ready_for_limited_default_off_internal_shadow_observation_review: 0,
    continue_internal_shadow_observation_hardening: 0,
    stop_or_freeze_route: 0,
  };
}

function emptyVerifierDecisionCounts(): Record<
  EvidenceVerifierDecision | "missing_report",
  number
> {
  return {
    completed: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
    insufficient_evidence: 0,
    missing_report: 0,
  };
}

function taskIdFrom(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const taskId = (value as { taskId?: unknown }).taskId;
    if (isNonEmptyString(taskId)) {
      return taskId;
    }
  }
  return "unknown";
}

function objectiveFrom(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const objective = (value as { objective?: unknown }).objective;
    if (isNonEmptyString(objective)) {
      return objective;
    }
  }
  return "unknown";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isEvidenceCaptureIssue(
  value: unknown,
): value is CodeTaskEvidenceGateEvidenceCaptureIssue {
  return CODE_TASK_EVIDENCE_GATE_EVIDENCE_CAPTURE_ISSUES.includes(
    value as CodeTaskEvidenceGateEvidenceCaptureIssue,
  );
}

function isSemanticRiskCode(
  value: unknown,
): value is CodeTaskEvidenceGateSemanticRiskCode {
  return CODE_TASK_EVIDENCE_GATE_SEMANTIC_RISK_CODES.includes(
    value as CodeTaskEvidenceGateSemanticRiskCode,
  );
}

function isManualReviewLabel(
  value: unknown,
): value is CodeTaskEvidenceGateManualReviewLabel {
  return CODE_TASK_EVIDENCE_GATE_MANUAL_REVIEW_LABELS.includes(
    value as CodeTaskEvidenceGateManualReviewLabel,
  );
}

function isSampleCategory(
  value: unknown,
): value is CodeTaskEvidenceGateSampleCategory {
  return CODE_TASK_EVIDENCE_GATE_SAMPLE_CATEGORIES.includes(
    value as CodeTaskEvidenceGateSampleCategory,
  );
}

function isRuntimeReplayReadinessDecision(
  value: unknown,
): value is CodeTaskEvidenceGateRuntimeReplayReadinessDecision {
  return CODE_TASK_EVIDENCE_GATE_RUNTIME_REPLAY_READINESS_DECISIONS.includes(
    value as CodeTaskEvidenceGateRuntimeReplayReadinessDecision,
  );
}

function isInternalShadowObservationDecision(
  value: unknown,
): value is CodeTaskEvidenceGateInternalShadowObservationDecision {
  return CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DECISIONS.includes(
    value as CodeTaskEvidenceGateInternalShadowObservationDecision,
  );
}

function isCodeTaskEvidenceGateShadowSamplerInput(
  value: unknown,
): value is CodeTaskEvidenceGateShadowSamplerInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<CodeTaskEvidenceGateShadowSamplerInput>;
  return (
    isNonEmptyString(record.samplerId) &&
    isNonEmptyString(record.sampleId) &&
    "input" in record &&
    (record.mode === undefined || isSamplerMode(record.mode)) &&
    (record.metadata === undefined || isRuntimeCoreJsonObject(record.metadata))
  );
}

function isSamplerMode(
  value: unknown,
): value is CodeTaskEvidenceGateShadowSamplerMode {
  return CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_MODES.includes(
    value as CodeTaskEvidenceGateShadowSamplerMode,
  );
}

function isRuntimeCallerEnvelope(
  value: unknown,
): value is CodeTaskEvidenceGateRuntimeCallerInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<CodeTaskEvidenceGateRuntimeCallerInput>;
  return (
    isNonEmptyString(record.callerId) &&
    isNonEmptyString(record.completionEventId) &&
    (record.mode === undefined || isSamplerMode(record.mode)) &&
    (record.metadata === undefined || isRuntimeCoreJsonObject(record.metadata))
  );
}

function isRuntimeShadowProducerEnvelope(
  value: unknown,
): value is CodeTaskEvidenceGateRuntimeShadowProducerInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<CodeTaskEvidenceGateRuntimeShadowProducerInput>;
  return (
    isNonEmptyString(record.producerId) &&
    isNonEmptyString(record.completionEventId) &&
    (record.mode === undefined || isSamplerMode(record.mode)) &&
    (record.metadata === undefined || isRuntimeCoreJsonObject(record.metadata))
  );
}

function isRuntimeShadowProducerCompletion(
  value: unknown,
): value is CodeTaskEvidenceGateRuntimeShadowProducerCompletion {
  if (!isCodeTaskEvidenceGateShadowInput(value)) {
    return false;
  }
  if (value.metadata !== undefined && !isRuntimeCoreJsonObject(value.metadata)) {
    return false;
  }
  return (
    value.verifierReport === undefined ||
    value.verifierReport.taskId === value.taskId
  );
}

function isRuntimeShadowCollectionEnvelope(
  value: unknown,
): value is CodeTaskEvidenceGateRuntimeShadowCollectionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record =
    value as Partial<CodeTaskEvidenceGateRuntimeShadowCollectionInput>;
  return (
    isNonEmptyString(record.collectorId) &&
    (record.mode === undefined || isSamplerMode(record.mode)) &&
    (record.metadata === undefined || isRuntimeCoreJsonObject(record.metadata))
  );
}

function isInternalShadowObservationEnvelope(
  value: unknown,
): value is CodeTaskEvidenceGateInternalShadowObservationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record =
    value as Partial<CodeTaskEvidenceGateInternalShadowObservationInput>;
  return (
    isNonEmptyString(record.observerId) &&
    (record.mode === undefined || isSamplerMode(record.mode)) &&
    (record.metadata === undefined || isRuntimeCoreJsonObject(record.metadata))
  );
}

function isRuntimeShadowCollectionResult(
  value: unknown,
): value is CodeTaskEvidenceGateRuntimeShadowCollectionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record =
    value as Partial<CodeTaskEvidenceGateRuntimeShadowCollectionResult>;
  return (
    isNonEmptyString(record.collectorId) &&
    isSamplerMode(record.mode) &&
    CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_OUTCOMES.includes(
      record.outcome as CodeTaskEvidenceGateRuntimeShadowCollectionOutcome,
    ) &&
    typeof record.requestedSampleCount === "number" &&
    typeof record.acceptedSampleCount === "number" &&
    typeof record.droppedSampleCount === "number" &&
    typeof record.sampledCount === "number" &&
    typeof record.replaySampleCount === "number" &&
    Array.isArray(record.entries) &&
    record.nonAuthoritative === true &&
    record.completionAuthority === false &&
    record.runtimeDecisionUnaffected === true &&
    record.legacyDecisionUnaffected === true
  );
}

function isRuntimeShadowCollectionSampleEnvelope(
  value: unknown,
): value is CodeTaskEvidenceGateRuntimeShadowCollectionSample {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record =
    value as Partial<CodeTaskEvidenceGateRuntimeShadowCollectionSample>;
  return (
    isNonEmptyString(record.collectionSampleId) &&
    "producerInput" in record &&
    (record.manualReviewLabel === undefined ||
      isManualReviewLabel(record.manualReviewLabel)) &&
    (record.category === undefined || isSampleCategory(record.category)) &&
    (record.notes === undefined || typeof record.notes === "string") &&
    (record.metadata === undefined || isRuntimeCoreJsonObject(record.metadata))
  );
}

function isRuntimeShadowCollectionSampleLimit(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= 1000)
  );
}

function isInternalShadowObservationCollectionLimit(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= 1000)
  );
}

function isRuntimeReplayReadinessThresholdPatch(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((threshold) =>
    typeof threshold === "number" && Number.isFinite(threshold) && threshold >= 0
  );
}

function stringMetadata(
  metadata: RuntimeCoreJsonObject | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function booleanMetadata(
  metadata: RuntimeCoreJsonObject | undefined,
  key: string,
): boolean | undefined {
  const value = metadata?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayMetadata(
  metadata: RuntimeCoreJsonObject | undefined,
  key: string,
): string[] {
  const value = metadata?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function stableSemanticRiskCodes(
  riskCodes: readonly CodeTaskEvidenceGateSemanticRiskCode[],
): CodeTaskEvidenceGateSemanticRiskCode[] {
  const present = new Set(riskCodes);
  return CODE_TASK_EVIDENCE_GATE_SEMANTIC_RISK_CODES.filter((riskCode) =>
    present.has(riskCode)
  );
}

function stableSamplerDiagnosticCodes(
  diagnosticCodes: readonly CodeTaskEvidenceGateShadowSamplerDiagnosticCode[],
): CodeTaskEvidenceGateShadowSamplerDiagnosticCode[] {
  const present = new Set(diagnosticCodes);
  return CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_DIAGNOSTIC_CODES.filter(
    (diagnosticCode) => present.has(diagnosticCode),
  );
}

function stableRuntimeCallerDiagnosticCodes(
  diagnosticCodes: readonly CodeTaskEvidenceGateRuntimeCallerDiagnosticCode[],
): CodeTaskEvidenceGateRuntimeCallerDiagnosticCode[] {
  const present = new Set(diagnosticCodes);
  return CODE_TASK_EVIDENCE_GATE_RUNTIME_CALLER_DIAGNOSTIC_CODES.filter(
    (diagnosticCode) => present.has(diagnosticCode),
  );
}

function stableRuntimeShadowProducerDiagnosticCodes(
  diagnosticCodes: readonly CodeTaskEvidenceGateRuntimeShadowProducerDiagnosticCode[],
): CodeTaskEvidenceGateRuntimeShadowProducerDiagnosticCode[] {
  const present = new Set(diagnosticCodes);
  return CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_PRODUCER_DIAGNOSTIC_CODES.filter(
    (diagnosticCode) => present.has(diagnosticCode),
  );
}

function stableRuntimeShadowCollectionDiagnosticCodes(
  diagnosticCodes: readonly CodeTaskEvidenceGateRuntimeShadowCollectionDiagnosticCode[],
): CodeTaskEvidenceGateRuntimeShadowCollectionDiagnosticCode[] {
  const present = new Set(diagnosticCodes);
  return CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_DIAGNOSTIC_CODES.filter(
    (diagnosticCode) => present.has(diagnosticCode),
  );
}

function stableInternalShadowObservationDiagnosticCodes(
  diagnosticCodes: readonly CodeTaskEvidenceGateInternalShadowObservationDiagnosticCode[],
): CodeTaskEvidenceGateInternalShadowObservationDiagnosticCode[] {
  const present = new Set(diagnosticCodes);
  return CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DIAGNOSTIC_CODES.filter(
    (diagnosticCode) => present.has(diagnosticCode),
  );
}

function stableShadowEvidenceQualityDiagnosticCodes(
  diagnosticCodes: readonly CodeTaskEvidenceGateShadowEvidenceQualityDiagnosticCode[],
): CodeTaskEvidenceGateShadowEvidenceQualityDiagnosticCode[] {
  const present = new Set(diagnosticCodes);
  return CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_QUALITY_DIAGNOSTIC_CODES.filter(
    (diagnosticCode) => present.has(diagnosticCode),
  );
}

function stableShadowEvidenceOptimizationDiagnosticCodes(
  diagnosticCodes: readonly CodeTaskEvidenceGateShadowEvidenceOptimizationDiagnosticCode[],
): CodeTaskEvidenceGateShadowEvidenceOptimizationDiagnosticCode[] {
  const present = new Set(diagnosticCodes);
  return CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_DIAGNOSTIC_CODES
    .filter((diagnosticCode) => present.has(diagnosticCode));
}

function normalizePathish(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function samplerIdFrom(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const samplerId = (value as { samplerId?: unknown }).samplerId;
    if (isNonEmptyString(samplerId)) {
      return samplerId;
    }
  }
  return "unknown";
}

function sampleIdFrom(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sampleId = (value as { sampleId?: unknown }).sampleId;
    if (isNonEmptyString(sampleId)) {
      return sampleId;
    }
  }
  return "unknown";
}

function samplerShadowInputFrom(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return (value as { input?: unknown }).input;
  }
  return undefined;
}

function callerIdFrom(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const callerId = (value as { callerId?: unknown }).callerId;
    if (isNonEmptyString(callerId)) {
      return callerId;
    }
  }
  return "unknown";
}

function completionEventIdFrom(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const completionEventId = (value as { completionEventId?: unknown })
      .completionEventId;
    if (isNonEmptyString(completionEventId)) {
      return completionEventId;
    }
  }
  return "unknown";
}

function producerIdFrom(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const producerId = (value as { producerId?: unknown }).producerId;
    if (isNonEmptyString(producerId)) {
      return producerId;
    }
  }
  return "unknown";
}

function collectorIdFrom(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const collectorId = (value as { collectorId?: unknown }).collectorId;
    if (isNonEmptyString(collectorId)) {
      return collectorId;
    }
  }
  return "unknown";
}

function observerIdFrom(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const observerId = (value as { observerId?: unknown }).observerId;
    if (isNonEmptyString(observerId)) {
      return observerId;
    }
  }
  return "unknown";
}

function runtimeCallerShadowInputFrom(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return (value as { shadowInput?: unknown }).shadowInput;
  }
  return undefined;
}

function runtimeShadowProducerCompletionFrom(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return (value as { completion?: unknown }).completion;
  }
  return undefined;
}

function runtimeShadowProducerModeFrom(
  value: unknown,
): CodeTaskEvidenceGateShadowSamplerMode {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const mode = (value as { mode?: unknown }).mode;
    if (isSamplerMode(mode)) {
      return mode;
    }
  }
  return "disabled";
}

function runtimeShadowCollectionModeFrom(
  value: unknown,
): CodeTaskEvidenceGateShadowSamplerMode {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const mode = (value as { mode?: unknown }).mode;
    if (isSamplerMode(mode)) {
      return mode;
    }
  }
  return "disabled";
}

function internalShadowObservationModeFrom(
  value: unknown,
): CodeTaskEvidenceGateShadowSamplerMode {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const mode = (value as { mode?: unknown }).mode;
    if (isSamplerMode(mode)) {
      return mode;
    }
  }
  return "disabled";
}

function runtimeShadowCollectionRequestedSampleCount(value: unknown): number {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const samples = (value as { samples?: unknown }).samples;
    if (Array.isArray(samples)) {
      return samples.length;
    }
  }
  return 0;
}

function internalShadowObservationRequestedCollectionCount(
  value: unknown,
): number {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const collections = (value as { collections?: unknown }).collections;
    if (Array.isArray(collections)) {
      return collections.length;
    }
  }
  return 0;
}

function ratio(numerator: number, denominator: number): number | undefined {
  return denominator > 0 ? numerator / denominator : undefined;
}

function sumRecord(record: Record<string, number> | undefined): number {
  return record === undefined
    ? 0
    : Object.values(record).reduce((sum, value) => sum + value, 0);
}
