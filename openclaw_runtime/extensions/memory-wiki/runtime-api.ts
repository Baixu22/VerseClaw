// Runtime capabilities consumed by the host's chat knowledge adapter.
export { getMemoryWikiPage } from "./src/query.js";
export { applyMemoryWikiMutation, normalizeMemoryWikiMutationInput, readMemoryWikiLifecycleMetadata } from "./src/apply.js";
export { ingestMemoryWikiSource } from "./src/ingest.js";
export { createMemoryWikiProjectionService } from "./src/retrieval-index.js";
export { createMemoryWikiEmbeddingService } from "./src/retrieval-embeddings.js";
export {
  createPortableVectorBackend,
  createLanceVectorBackend,
} from "./src/retrieval/vector-backends.js";
export { createMemoryWikiVectorService } from "./src/retrieval/vector-service.js";
export {
  readMemoryWikiRetrievalChunks,
  readMemoryWikiChunkCitation,
} from "./src/retrieval-document.js";
export {
  resolveMemoryWikiConfig,
  memoryWikiConfigSchema,
  type MemoryWikiPluginConfig,
} from "./src/config.js";
export { resolveMemoryWikiStatus, buildMemoryWikiDoctorReport } from "./src/status.js";
export { normalizeCompatibilityConfig } from "./src/config-compat.js";
export {
  createMemoryWikiReadContext,
  memoryWikiNamespaceId,
  readMemoryWikiOwnerPolicy,
  readMemoryWikiOwnerSnapshot,
  type MemoryWikiReadIdentity,
} from "./src/owner-read.js";
export { retrieveMemoryWiki } from "./src/retrieval/plan-service.js";
export { createMemoryWikiRerankService } from "./src/retrieval-rerank.js";
