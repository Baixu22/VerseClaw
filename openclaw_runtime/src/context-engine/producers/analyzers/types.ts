// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/indexing/analyzers/types.ts (verbatim; import path localized).
import type { CodeChunk, CodeFile, GraphEdge, IndexAnalysisWarning, LanguageId, SymbolNode } from "../../fact-types.js";

export interface FileAnalysis {
  chunks: CodeChunk[];
  symbols: SymbolNode[];
  edges: GraphEdge[];
  warnings?: IndexAnalysisWarning[];
}

export interface AnalyzeFileInput {
  repoRoot: string;
  file: CodeFile;
  content: string;
}

export type AnalyzerCapability =
  | "symbols"
  | "imports"
  | "exports"
  | "calls"
  | "definitions"
  | "framework_routes"
  | "tests";

export interface LanguageAnalyzer {
  language: LanguageId;
  capabilities: AnalyzerCapability[];
  analyzeFile(input: AnalyzeFileInput): FileAnalysis;
}
