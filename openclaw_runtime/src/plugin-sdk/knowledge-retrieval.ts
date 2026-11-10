/** Owner-bound source normalization, structural projection and citation verification. */
export { normalizeKnowledgeSourceDocument } from "../knowledge/retrieval/source-document.js";
export { chunkKnowledgeDocument } from "../knowledge/retrieval/chunker.js";
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
