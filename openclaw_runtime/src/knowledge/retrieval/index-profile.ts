import { digestOwnerReadContent } from "../../runtime-core/knowledge-owner-read.js";
import type { ChunkerProfileV1, KnowledgeTokenizer } from "./contracts.js";

// This lexical projection has no model input claim. RAG embedding generations
// use the selected provider's tokenizer and a different profile digest.
export const lexicalProjectionTokenizer: KnowledgeTokenizer = {
  id: "lexical-utf8-bytes/v1",
  digest: digestOwnerReadContent("lexical-utf8-bytes/v1"),
  count: (text) => Buffer.byteLength(text, "utf8"),
};
export const lexicalProjectionProfile: ChunkerProfileV1 = {
  schema: "ChunkerProfile/v1",
  version: "markdown-structure-v2/lexical-utf8-bytes",
  targetTokens: 384,
  maxTokens: 768,
  maxChars: 2400,
  overlap: 0,
  tokenizerId: lexicalProjectionTokenizer.id,
  tokenizerDigest: lexicalProjectionTokenizer.digest,
};
export const lexicalProjectionProfileDigest = digestOwnerReadContent(
  JSON.stringify(lexicalProjectionProfile),
);
