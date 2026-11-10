// Runtime capabilities consumed by the host's chat knowledge adapter.
export { getMemoryWikiPage } from "./src/query.js";
export { ingestMemoryWikiSource } from "./src/ingest.js";
export { readMemoryWikiRetrievalChunks, readMemoryWikiChunkCitation } from "./src/retrieval-document.js";
export { resolveMemoryWikiConfig, type MemoryWikiPluginConfig } from "./src/config.js";
export {
  createMemoryWikiReadContext,
  memoryWikiNamespaceId,
  readMemoryWikiOwnerPolicy,
  readMemoryWikiOwnerSnapshot,
  type MemoryWikiReadIdentity,
} from "./src/owner-read.js";
