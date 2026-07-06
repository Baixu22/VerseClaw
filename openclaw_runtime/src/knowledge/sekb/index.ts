export {
  extractErrorSignature,
  extractErrorSignatureSync,
  rawErrorHash,
  type ErrorSignatureExtractor,
} from "./error-signature.js";
export { DistillationTool, type DistillationToolOptions } from "./distillation-tool.js";
export {
  installSekbHarnessHooks,
  type InstallSekbHarnessHooksOptions,
  type SekbHarnessHookTarget,
  type SekbTaskClassification,
  type SekbTaskClassifier,
} from "./harness-integration.js";
export { KnowledgeStore, type KnowledgeStoreOptions } from "./knowledge-store.js";
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
  Trajectory,
  TrajectoryCost,
  TrajectoryOutcome,
  TrajectoryQuery,
  TrajectoryStep,
} from "./types.js";
export { approxTokenCount, buildPrincipleFullContent, normalizeTags } from "./types.js";
