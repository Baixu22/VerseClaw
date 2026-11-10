/** Owner-bound source normalization, structural projection and citation verification. */
export { normalizeKnowledgeSourceDocument } from "../knowledge/retrieval/source-document.js";
export { chunkKnowledgeDocument } from "../knowledge/retrieval/chunker.js";
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
