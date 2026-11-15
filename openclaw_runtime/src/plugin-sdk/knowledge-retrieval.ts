/** Owner-bound source normalization, structural projection and citation verification. */
export {
  normalizeProjectRagConfig,
  PROJECT_RAG_DEFAULTS,
} from "../../../shared/knowledge/operations.js";
export type {
  ProjectRagConfigInput,
  ProjectRagConfigV2,
  IndexStatusV1,
  RetrievalCapabilitySnapshotV1,
} from "../../../shared/knowledge/operations.js";
export { normalizeKnowledgeSourceDocument } from "../knowledge/retrieval/source-document.js";
export { chunkKnowledgeDocument } from "../knowledge/retrieval/chunker.js";
export { VectorStore, validateVectorRow } from "../knowledge/retrieval/vector-store.js";
export { createPortableVectorSearch } from "../knowledge/retrieval/vector-worker.js";
export { ProjectionStore } from "../knowledge/retrieval/projection-store.js";
export type {
  VectorBackendId,
  VectorGenerationV1,
  VectorHit,
  VectorProjectionBackend,
  VectorProjectionV1,
  VectorSearchV1,
  IndexBackendCapabilitiesV1,
} from "../knowledge/retrieval/vector-contracts.js";
export {
  KnowledgeEmbeddingSession,
  waitForRetrievalOperation,
  type EmbeddingJobV1,
} from "../knowledge/retrieval/embedding-session.js";
export {
  createEmbeddingSpace,
  assertSameEmbeddingSpace,
  validateEmbeddingVector,
  type EmbeddingSpaceV1,
  type ProviderCapabilitySnapshotV1,
} from "../knowledge/retrieval/embedding-space.js";
export {
  KnowledgeProjectionController,
  type ProjectionOwnerAdapter,
} from "../knowledge/retrieval/index-controller.js";
export type {
  ProjectionSourceIntent,
  ProjectionIndexJob,
  ProjectionSourceState,
  ProjectionGeneration,
} from "../knowledge/retrieval/projection-contracts.js";
export { getWatcherHub } from "../../../shared/resources/watcher-hub.js";
export {
  citationLocatorForChunk,
  verifyKnowledgeCitation,
} from "../knowledge/retrieval/citation.js";
export type {
  NormalizedSourceDocumentV1,
  SourceProvenance,
  ChunkerProfileV1,
  KnowledgeTokenizer,
  KnowledgeChunkV2,
  CitationLocatorV2,
  ChunkKnowledgeOptions,
} from "../knowledge/retrieval/contracts.js";
export {
  createRetrievalPlan,
  fuseRetrievalLanes,
  runRetrievalPlan,
  RETRIEVAL_PROFILES,
} from "../knowledge/retrieval/plan.js";
export { createEndpointRerankProvider } from "../knowledge/retrieval/rerank.js";
export type {
  RerankCandidate,
  RerankProviderV1,
  RerankResultV1,
} from "../knowledge/retrieval/rerank.js";
export type {
  RankSignalsV2,
  RetrievalBudget,
  RetrievalFilter,
  RetrievalHit,
  RetrievalLane,
  RetrievalLaneReceipt,
  RetrievalLaneResult,
  RetrievalMode,
  RetrievalPlanV2,
  RetrievalProfile,
  RetrievalGeneration,
  RetrievalIntent,
  RetrievalQuery,
  RetrievalResultV2,
} from "../knowledge/retrieval/plan.js";
