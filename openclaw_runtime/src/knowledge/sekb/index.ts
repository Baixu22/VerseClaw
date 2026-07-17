export {
  extractErrorSignature,
  extractErrorSignatureSync,
  rawErrorHash,
  type ErrorSignatureExtractor,
} from "./error-signature.js";
export { DistillationTool, type DistillationToolOptions } from "./distillation-tool.js";
export {
  isSekbBatchDistillationAssistantEnabled,
  isSekbEnabled,
  isSekbPhaseCWouldTriggerEnabled,
  isSekbShadowEvaluationEnabled,
  resolveSekbPhaseCWouldTriggerOwner,
  resolveSekbPhaseCWouldTriggerTimeoutMs,
  type SekbFlagConfig,
} from "./feature-flags.js";
export {
  extractInProcessShadowScore,
  projectWouldTriggerFromShadowScore,
  SekbPhaseCWouldTriggerScheduler,
  snapshotPhaseCObservability,
  SEKB_PHASE_C_DEFAULT_OWNER,
  SEKB_PHASE_C_DEFAULT_TIMEOUT_MS,
  SEKB_PHASE_C_POLICY_ID,
  SEKB_PHASE_C_SHADOW_V1_THRESHOLD,
  type SekbPhaseCWouldTriggerCounters,
  type SekbPhaseCWouldTriggerEvidence,
  type SekbPhaseCWouldTriggerRunResult,
  type SekbPhaseCWouldTriggerSchedulerOptions,
} from "./phase-c-would-trigger.js";
export {
  getSekbBatchSuggestionProvenance,
  normalizedEditDistance,
  originalSuggestionContent,
  SekbBatchDistillationAssistant,
  SEKB_BATCH_DISTILLATION_MAX_PRINCIPLES,
  SEKB_BATCH_DISTILLATION_MAX_SUGGESTIONS,
  SEKB_BATCH_DISTILLATION_MAX_TRAJECTORIES,
  SEKB_BATCH_DISTILLATION_TIMEOUT_MS,
  type SekbBatchDistillationAssistantOptions,
  type SekbBatchDistillationModelInput,
  type SekbBatchDistillationOperatorEvidence,
  type SekbBatchDistillationProvider,
  type SekbBatchDistillationProviderResponse,
  type SekbBatchDistillationRequest,
  type SekbBatchDistillationResult,
  type SekbBatchDistillationSuggestion,
} from "./batch-distillation-assistant.js";
export {
  createDeepSeekSekbBatchDistillationProvider,
  type CreateDeepSeekSekbBatchProviderOptions,
} from "./batch-distillation-deepseek-provider.js";
export {
  defaultSekbTaskClassifier,
  installSekbHarnessHooks,
  SEKB_DEFAULT_TASK_INTENT_MAX_CHARS,
  type InstallSekbHarnessHooksOptions,
  type SekbHarnessHookTarget,
  type SekbTaskClassification,
  type SekbTaskClassifier,
} from "./harness-integration.js";
export { KnowledgeStore, type KnowledgeStoreOptions } from "./knowledge-store.js";
export {
  buildSekbOperatorReport,
  type SekbOperatorReport,
  type SekbOperatorReportOptions,
} from "./operator-report.js";
export {
  buildSekbOfflineEvaluationReport,
  buildSekbShadowEvaluationExport,
  createSekbShadowEvaluationReviewProtocol,
  writeSekbOfflineEvaluationReportArtifact,
  writeSekbShadowEvaluationExportArtifact,
  SEKB_MAXIMUM_PROJECTED_FALSE_DROP_RATE,
  SEKB_MINIMUM_COHENS_KAPPA,
  SEKB_MINIMUM_REVIEWED_TRAJECTORIES,
  SEKB_MINIMUM_VALUABLE_RECALL,
  SEKB_SHADOW_EVALUATION_ARTIFACT_DIRECTORY,
  SEKB_SHADOW_EVALUATION_EXPORT_FILE,
  SEKB_SHADOW_EVALUATION_REPORT_FILE,
  type BuildSekbOfflineEvaluationReportOptions,
  type BuildSekbShadowEvaluationExportOptions,
  type CreateSekbShadowEvaluationReviewProtocolOptions,
  type SekbCohensKappa,
  type SekbConfidenceInterval,
  type SekbEvaluationLabel,
  type SekbEvaluationMetric,
  type SekbOfflineEvaluationReport,
  type SekbShadowEvaluationExportArtifact,
  type SekbShadowEvaluationExportRecord,
  type SekbShadowEvaluationReview,
  type SekbShadowEvaluationReviewProtocol,
  type WriteSekbOfflineEvaluationReportOptions,
  type WriteSekbShadowEvaluationExportOptions,
} from "./shadow-evaluation-offline.js";
export { ContextInjector, RetrievalEngine, type RetrievalEngineOptions } from "./retrieval-engine.js";
export { TrajectoryCapture, capture_trajectory, type TrajectoryCaptureOptions } from "./trajectory-capture.js";
export type {
  DistillationRejection,
  DistillationSuggestion,
  IndexEntry,
  JsonObject,
  Principle,
  PrincipleCreatedBy,
  PrincipleCriticality,
  PrincipleQuery,
  PrincipleStatus,
  SekbBatchDistillationEvent,
  SekbBatchDistillationFallbackReason,
  Trajectory,
  TrajectoryCost,
  TrajectoryOutcome,
  TrajectoryQuery,
  TrajectoryStep,
} from "./types.js";
export { approxTokenCount, buildPrincipleFullContent, normalizeTags } from "./types.js";
export {
  classifySekbPayload,
  isSekbQuarantinedPayload,
  quarantineSekbPayload,
  redactSekbValue,
  sanitizeSekbStep,
  sanitizeTrajectoryForPersistence,
  sekbByteLength,
  sekbContentFingerprint,
  trajectoryContainsPlaintext,
  SEKB_QUARANTINE_MARKER,
  type SekbPayloadClassification,
  type SekbQuarantinedPayload,
} from "./trajectory-redaction.js";

export {
  assertConfirmSession,
  buildConfirmProvenance,
  canEnterHighTrustContext,
  ConfirmProvenanceError,
  normalizeConfirmIntegrityClaim,
  normalizeConfirmSourceSystem,
  resolveConfirmIntegrity,
  type ConfirmIntegrityLevel,
  type ConfirmProvenance,
  type ConfirmProvenanceErrorCode,
  type ConfirmSourceSystem,
} from "./confirm-provenance.js";
export type { ConfirmAndSaveOptions, ConfirmAndSaveResult } from "./distillation-tool.js";

export {
  collectSessionCascadeTargets,
  createInMemoryCascadeStores,
  createKnowledgeStoreCascadeAdapter,
  executeSessionCascadeDelete,
  locateDerivativeLineage,
  purgeExpiredSekbTrajectories,
  type CascadeError,
  type CascadeTarget,
  type CascadeTargetKind,
  type SessionCascadeReport,
  type SessionCascadeStores,
} from "./session-cascade-delete.js";
