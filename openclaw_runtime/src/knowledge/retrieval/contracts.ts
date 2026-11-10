import type {
  OwnerReadSnapshotV1,
  RawSourceLocator,
  ReadAdmissionContextV1,
  SourceRefV2,
} from "../../runtime-core/knowledge-owner-read.js";

export type SourceProvenance = {
  kind: "wiki" | "file" | "directory" | "github";
  sourcePath?: string;
  sourceRevision?: string;
};

/** Normalization preserves citation bytes. Folding is restricted to retrieval fields. */
export type NormalizedSourceDocumentV1 = {
  schema: "NormalizedSourceDocument/v1";
  snapshot: OwnerReadSnapshotV1;
  text: string;
  parser: { id: "owner-markdown/v1"; encoding: "utf-8"; normalization: "identity-raw-utf8" };
  provenance: SourceProvenance;
  lines: Array<{
    startChar: number;
    endChar: number;
    startByte: number;
    endByteExclusive: number;
    rawLine: number;
  }>;
};

export type ChunkerProfileV1 = {
  schema: "ChunkerProfile/v1";
  version: string;
  targetTokens: number;
  maxTokens: number;
  maxChars: number;
  overlap: 0;
  tokenizerId: string;
  tokenizerDigest: string;
};

/** The selected model supplies its versioned tokenizer; estimates cannot claim that identity. */
export type KnowledgeTokenizer = {
  id: string;
  digest: string;
  count: (text: string) => number;
};

export type KnowledgeChunkV2 = {
  schema: "KnowledgeChunk/v2";
  chunkId: string;
  parentId: string;
  sectionId: string;
  ordinal: number;
  kind: "heading" | "paragraph" | "list" | "step" | "code" | "table" | "blockquote" | "other";
  headingPath: string[];
  source: SourceRefV2 & { locator: RawSourceLocator };
  quote: string;
  chunkDigest: string;
  retrievalText: string;
  searchTokens: string[];
  tokenCount: number;
  chunker: ChunkerProfileV1;
};

export type CitationLocatorV2 = {
  schema: "CitationLocator/v2";
  chunkId: string;
  chunkDigest: string;
  source: SourceRefV2 & { locator: RawSourceLocator };
  chunker: ChunkerProfileV1;
};

export type ChunkKnowledgeOptions = {
  context: ReadAdmissionContextV1;
  profile: ChunkerProfileV1;
  tokenizer: KnowledgeTokenizer;
  signal?: AbortSignal;
};
