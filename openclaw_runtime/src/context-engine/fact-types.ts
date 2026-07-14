// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/core/types.ts:1-127 (+ ProjectIdentity from :506-515).
// Fact-layer data contract shared by Producers, FactStore, and Views.
// NOTE: SPEC appendix A targets `context-engine/types.ts`, but that path is
// occupied by the existing provider-runtime types, so the fact types live here.

export type LanguageId =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "css"
  | "markdown"
  | "json"
  | "swift"
  | "kotlin"
  | "gradle"
  | "xml"
  | "unknown";

export type ChunkKind = "file" | "function" | "class" | "method" | "type" | "variable" | "block";
export type ContextMode = "auto" | "debug" | "feature" | "refactor" | "review" | "explain";

export type FileRole = "source" | "test" | "config" | "docs" | "generated" | "vendor" | "build" | "minified";

export interface FileClassification {
  role: FileRole;
  reason: string;
}

export interface SkippedFile {
  filePath: string;
  reason: string;
  classification?: FileClassification;
}

export type IndexAnalysisWarningKind = "parser_fallback" | "deduped_symbols" | "deduped_chunks";

export interface IndexAnalysisWarning {
  kind: IndexAnalysisWarningKind;
  message: string;
  count: number;
  samples: string[];
}

export interface CodeFile {
  projectId: string;
  path: string;
  absolutePath: string;
  language: LanguageId;
  sizeBytes: number;
  contentHash: string;
  modifiedAtMs: number;
  classification?: FileClassification;
}

export interface CodeChunk {
  id: string;
  projectId: string;
  repoRoot: string;
  filePath: string;
  language: LanguageId;
  kind: ChunkKind;
  symbolName?: string;
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
}

export type SymbolKind = "file" | "function" | "class" | "method" | "type" | "variable" | "unknown";

export interface SymbolNode {
  id: string;
  projectId: string;
  filePath: string;
  name: string;
  kind: SymbolKind;
  language: LanguageId;
  startLine: number;
  endLine: number;
  signature?: string;
  exported?: boolean;
}

export type EdgeKind =
  | "contains"
  | "imports"
  | "exports"
  | "calls"
  | "references"
  | "tested_by"
  | "related"
  | "handles_event"
  | "calls_api"
  | "routes_to"
  | "uses_middleware"
  | "handles_webhook"
  | "reads_from"
  | "writes_to";

export interface GraphEdge {
  projectId: string;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  metadata?: Record<string, unknown>;
}

export interface ProjectIdentity {
  projectId: string;
  repoRoot: string;
  canonicalRoot: string;
  displayName: string;
  gitRemote?: string;
  gitHead?: string;
  createdAtMs: number;
  lastIndexedAtMs?: number;
}

export interface RepoIndex {
  projectId: string;
  project?: ProjectIdentity;
  repoRoot: string;
  indexedAtMs: number;
  indexGeneration: number;
  changedFiles: string[];
  deletedFiles: string[];
  affectedFiles?: string[];
  partialBootstrap?: boolean;
  partialGraphSnapshot?: boolean;
  semanticDeferred?: boolean;
  scannedFiles?: string[];
  refreshedFiles?: string[];
  fullReindex: boolean;
  files: CodeFile[];
  chunks: CodeChunk[];
  symbols: SymbolNode[];
  edges: GraphEdge[];
  skippedFiles: SkippedFile[];
  analysisWarnings?: IndexAnalysisWarning[];
}
