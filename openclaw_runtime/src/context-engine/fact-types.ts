// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/core/types.ts:1-127 (+ ProjectIdentity from :506-515)
//         + ContextPack contract from :382-436, :459-476, :499, :555-579, :625-630, :701.
// Fact-layer data contract shared by Producers, FactStore, and Views.
// NOTE: SPEC appendix A targets `context-engine/types.ts`, but that path is
// occupied by the existing provider-runtime types, so the fact types live here.
// ContextPack deltas vs ragcode (recorded per SPEC §6.1 adaptation):
// - freshness uses the local hash-compare FreshnessReport (factstore/freshness.ts),
//   not ragcode's watcher/semantic report — one store, one freshness clock.
// - memorySnippets/memoryHints dropped (ragcode src/memory is on the do-not-copy list).
// - editReadiness (types.ts:701 tri-state) is carried on the pack itself: the
//   "可动手判定" is part of this architecture's core contract.
// - MissingEvidenceHint.expandContext points at the context.understand capability
//   (ALIGNMENT 校正4), not ragcode's get_context MCP tool.

import type { FreshnessReport } from "./factstore/freshness.js";

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

// ---------------------------------------------------------------------------
// ContextPack contract (ragcode src/core/types.ts:382-436 + :701, adapted).
// Markdown output order iron rule (SPEC §6.1):
// brief → freshness → ownerChain → topology → snippets → missingEvidence → nextQueries.
// ---------------------------------------------------------------------------

export type ExpansionLevel = "file_card" | "skeleton" | "focused_body" | "full_body";

export type EditReadiness = "safe_to_edit_after_reading" | "investigate_only" | "not_enough_context";

export interface ContextSnippet {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  reason: string;
  role: string;
  expansionLevel: ExpansionLevel;
  originalLineCount: number;
  returnedLineCount: number;
  elidedLineCount: number;
}

export interface OwnerNode {
  filePath: string;
  role: string;
  reason: string;
  score: number;
  symbols: Array<{
    name: string;
    kind: string;
    startLine: number;
    endLine: number;
  }>;
}

export interface TopologyEdge {
  from: string;
  to: string;
  edge: EdgeKind;
  confidence: "low" | "medium" | "high";
  reason: string;
  sourceFile?: string;
  targetFile?: string;
}

export interface RelationshipEvidence {
  source: string;
  target: string;
  kind: EdgeKind;
  reason: string;
}

export interface MissingEvidenceHint {
  code:
    | "context_budget_truncated"
    | "compact_fallback"
    | "context_budget_too_small"
    | "no_context_match"
    | "index_stale"
    | "index_pending"
    | "indexing_in_progress"
    | "index_skipped_files";
  message: string;
  omittedSnippets?: {
    count: number;
    originalCount: number;
    returnedCount: number;
    filePaths: string[];
  };
  omittedFiles?: {
    count: number;
    freshnessCategories: Array<"staleFiles" | "missingFiles">;
  };
  expandContext?: {
    capability: "context.understand";
    args: {
      repoRoot: string;
      query: string;
      mode: Exclude<ContextMode, "auto">;
      budgetChars: number;
      format?: "json" | "markdown";
    };
  };
}

export interface ContextBudgetTrace {
  hardByteCap: number;
  targetByteCap: number;
  renderedBytes: number;
  transportBytes: number;
  estimatedModelTokens: number;
  tokenEstimateApproximate: boolean;
  tokenizer?: string;
  providerHint?: string;
  format: "json" | "markdown";
  omittedSnippets: number;
  omittedFiles: number;
  truncated: boolean;
  fallbackUsed: boolean;
  degradationLevel?: number;
  fallbackReason?: string;
}

export interface ContextPack {
  query: string;
  repoRoot: string;
  projectId: string;
  mode: Exclude<ContextMode, "auto">;
  answerable: boolean;
  confidence: "low" | "medium" | "high";
  editReadiness: EditReadiness;
  brief: string;
  freshness: FreshnessReport;
  ownerChain: OwnerNode[];
  topology: TopologyEdge[];
  snippets: ContextSnippet[];
  relationships: RelationshipEvidence[];
  missingEvidence: string[];
  nextQueries: string[];
  missingEvidenceHints?: MissingEvidenceHint[];
  budgetChars: number;
  usedChars: number;
  budgetTrace?: ContextBudgetTrace;
}

// ---------------------------------------------------------------------------
// Reuse contract (ragcode src/core/types.ts:780-845 + OwnerCandidate :920, verbatim).
// ---------------------------------------------------------------------------

export type ReuseDecision = "reuse" | "extend" | "wrap" | "implement_new" | "uncertain";

export type ReuseCandidateKind =
  | "helper"
  | "service_method"
  | "react_hook"
  | "component"
  | "api_wrapper"
  | "type_or_schema"
  | "test_fixture"
  | "config_constant"
  | "unknown";

export interface ReuseCandidate {
  filePath: string;
  symbolName?: string;
  kind: ReuseCandidateKind;
  score: number;
  confidence: "low" | "medium" | "high";
  exported: boolean;
  callerCount: number;
  relatedTestCount: number;
  structuralSignals: {
    bodyFingerprint?: string;
    bodyDuplicateCount: number;
    signatureSimilarity: number;
    importOverlap: number;
    calleeOverlap: number;
  };
  reasons: string[];
  whyReuse: string[];
  snippet?: ContextSnippet;
}

export interface ReuseGuard {
  status: "allow_new" | "block_new" | "review_required";
  reason: string;
  candidates: Array<{
    filePath: string;
    symbolName?: string;
    score: number;
    confidence: "low" | "medium" | "high";
  }>;
}

export interface ReuseCandidateReport {
  query: string;
  decision: ReuseDecision;
  confidence: "low" | "medium" | "high";
  candidates: ReuseCandidate[];
  duplicateRisk: "low" | "medium" | "high";
  reuseGuard: ReuseGuard;
  missingEvidence: string[];
  nextQueries: string[];
}

export interface OwnerCandidate {
  filePath: string;
  score: number;
  reasons: string[];
  symbols: SymbolNode[];
}
