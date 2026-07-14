// FactStore → shadow-provider data bridge (SPEC Task 5 / ALIGNMENT 校正1, SEAM_MAP §B):
// feeds the two existing shadow providers (agent-map-context-provider.getResult and
// symbol-context-provider.getOverviews) from the FactStore instead of the legacy
// JS/TS-only scanner. The provider skeletons are untouched — interface compatibility
// is gate F-1 — and both callbacks route gaps through the Task D materialization
// closure, so Py/Go/Rust/Java files produce symbols too (gate F-2 upgrade).
import type {
  AgentMapFileSelection,
  AgentMapLanguage,
  AgentMapRankedTag,
  AgentMapResult,
  AgentMapSymbolKind,
  EvidenceRef,
  RuntimeSymbolNode,
  RuntimeSymbolOverview,
} from "../../runtime-core/index.js";
import type { LanguageId, SymbolKind, SymbolNode } from "../fact-types.js";
import { createMaterializer, type Materializer } from "../factstore/materialize.js";
import { openFactStore, type FactStore } from "../factstore/store.js";

export interface FactStoreBridgeQuery {
  activeFiles?: string[];
  tokenBudget?: number;
}

export interface FactStoreBridge {
  readonly store: FactStore;
  readonly materializer: Materializer;
  agentMapResult(query: FactStoreBridgeQuery): AgentMapResult | undefined;
  symbolOverviews(query: FactStoreBridgeQuery): RuntimeSymbolOverview[];
}

export function createFactStoreBridge(store: FactStore, materializer: Materializer): FactStoreBridge {
  return {
    store,
    materializer,
    agentMapResult(query) {
      return factStoreToAgentMapResult(store, materializer, query);
    },
    symbolOverviews(query) {
      return factStoreToSymbolOverviews(store, materializer, query);
    },
  };
}

/** Lazily opens one bridge per workspace — providers share the workspace singleton store. */
export function createWorkspaceFactStoreBridge(): (workspaceRoot: string) => FactStoreBridge {
  const bridges = new Map<string, FactStoreBridge>();
  return (workspaceRoot: string) => {
    const existing = bridges.get(workspaceRoot);
    if (existing) return existing;
    const store = openFactStore(workspaceRoot);
    const bridge = createFactStoreBridge(store, createMaterializer(store, workspaceRoot));
    bridges.set(workspaceRoot, bridge);
    return bridge;
  };
}

/**
 * Builds an AgentMapResult (runtime-core contract, schemaVersion 1) from FactStore
 * facts for the queried files. Symbols come from whatever producer analyzed the file
 * (five languages), which is the multi-language upgrade over the legacy JS/TS scanner.
 */
export function factStoreToAgentMapResult(
  store: FactStore,
  materializer: Materializer,
  query: FactStoreBridgeQuery,
): AgentMapResult | undefined {
  const activeFiles = query.activeFiles ?? [];
  if (activeFiles.length === 0) return undefined;
  const repoRoot = materializer.repoRoot;
  const ensure = materializer.ensureFacts({ paths: activeFiles });

  const includedFiles: AgentMapFileSelection[] = [];
  const excludedFiles: AgentMapFileSelection[] = [];
  const includedSymbols: AgentMapRankedTag[] = [];
  const contentLines: string[] = [];

  const materializedFiles = [...ensure.fresh, ...ensure.parsed].sort();
  let rank = 0;
  for (const filePath of materializedFiles) {
    const symbols = store.getSymbolsByFile(repoRoot, filePath).filter((symbol) => symbol.kind !== "file");
    const record = store.getFileRecord(repoRoot, filePath);
    const tagIds: string[] = [];
    contentLines.push(`## ${filePath}`);
    for (const symbol of symbols) {
      rank += 1;
      tagIds.push(symbol.id);
      includedSymbols.push(rankedTagFromSymbol(symbol, rank, ensure.fresh.includes(filePath)));
      contentLines.push(`- ${symbol.name} (${symbol.kind}) L${symbol.startLine}-L${symbol.endLine}`);
    }
    if (symbols.length === 0) contentLines.push("- (no symbols)");
    includedFiles.push({
      file: filePath,
      included: true,
      reason: "activeFile",
      tagIds,
      tokenEstimate: estimateTokens(symbols.map((symbol) => symbol.signature ?? symbol.name).join("\n")),
      evidenceRefs: [fileRef(filePath)],
      metadata: {
        factStore: true,
        producer: record?.provenance.producer ?? "unknown",
        producedHash: record?.provenance.producedHash ?? "",
        factLanguage: record?.file.language ?? "unknown",
      },
    });
  }

  for (const deferredPath of ensure.deferred) {
    excludedFiles.push(exclusion(deferredPath, "budget", "parse budget exhausted (declared, not silently dropped)"));
  }
  for (const skipped of ensure.skipped) {
    excludedFiles.push(exclusion(skipped.path, "diagnostic", skipped.reason));
  }
  for (const failure of ensure.failed) {
    excludedFiles.push(exclusion(failure.path, "diagnostic", failure.error));
  }

  const content = includedSymbols.length > 0 ? contentLines.join("\n") : "";
  const tokenEstimate = estimateTokens(content);
  return {
    schemaVersion: 1,
    status: includedSymbols.length > 0 ? "success" : "empty",
    readonly: true,
    content,
    tokenBudget: query.tokenBudget ?? tokenEstimate,
    tokenEstimate,
    includedFiles,
    excludedFiles,
    includedSymbols,
    evidence: [
      {
        evidenceId: "factstore:tag-extraction",
        type: "tagExtraction",
        summary: `${includedSymbols.length} symbol(s) from FactStore facts across ${materializedFiles.length} file(s); parsed ${ensure.parsed.length}, cache-hit ${ensure.fresh.length}, deferred ${ensure.deferred.length}.`,
        evidenceRefs: materializedFiles.map(fileRef),
      },
    ],
    evidenceRefs: [bridgeRef()],
    metadata: {
      factStoreBridge: true,
      repoRoot,
      projectId: materializer.projectId,
      parsed: ensure.parsed.length,
      cacheHits: ensure.fresh.length,
      deferred: ensure.deferred.length,
    },
  };
}

/** RuntimeSymbolOverview view over the same facts — gate F-3's "single source of truth" pair. */
export function factStoreToSymbolOverviews(
  store: FactStore,
  materializer: Materializer,
  query: FactStoreBridgeQuery,
): RuntimeSymbolOverview[] {
  const activeFiles = query.activeFiles ?? [];
  if (activeFiles.length === 0) return [];
  const repoRoot = materializer.repoRoot;
  const ensure = materializer.ensureFacts({ paths: activeFiles });
  return [...ensure.fresh, ...ensure.parsed].sort().map((filePath) => ({
    file: filePath,
    symbols: store
      .getSymbolsByFile(repoRoot, filePath)
      .filter((symbol) => symbol.kind !== "file")
      .map(symbolNodeFromFact),
    evidence: [fileRef(filePath)],
  }));
}

function rankedTagFromSymbol(symbol: SymbolNode, rank: number, fromCache: boolean): AgentMapRankedTag {
  return {
    tag: {
      tagId: symbol.id,
      file: symbol.filePath,
      language: agentMapLanguageFor(symbol.language),
      kind: "definition",
      symbolKind: agentMapSymbolKindFor(symbol.kind),
      name: symbol.name,
      namePath: [symbol.name],
      range: {
        startLine: symbol.startLine,
        startColumn: 1,
        endLine: symbol.endLine,
        endColumn: 1,
      },
      signature: symbol.signature,
      exported: symbol.exported ?? false,
      evidenceRefs: [fileRef(symbol.filePath)],
      metadata: { factLanguage: symbol.language, factStore: true },
    },
    rank,
    score: Math.max(0.1, 1 - (rank - 1) * 0.01),
    reasons: [
      {
        kind: "fromActiveFileReference",
        scoreDelta: 1,
        evidenceRefs: [fileRef(symbol.filePath)],
        metadata: { fromCache },
      },
    ],
    evidenceRefs: [fileRef(symbol.filePath)],
    metadata: { factStore: true },
  };
}

function symbolNodeFromFact(symbol: SymbolNode): RuntimeSymbolNode {
  return {
    symbolId: symbol.id,
    name: symbol.name,
    namePath: [symbol.name],
    kind: symbol.kind,
    file: symbol.filePath,
    range: {
      start: { line: symbol.startLine, character: 0 },
      end: { line: symbol.endLine, character: 0 },
    },
    signature: symbol.signature,
    children: [],
    evidence: [fileRef(symbol.filePath)],
  };
}

function exclusion(filePath: string, reason: AgentMapFileSelection["reason"], detail: string): AgentMapFileSelection {
  return {
    file: filePath,
    included: false,
    reason,
    tagIds: [],
    tokenEstimate: 0,
    evidenceRefs: [fileRef(filePath)],
    metadata: { detail },
  };
}

/** agent-map's language enum stays JS/TS-shaped; other producers surface as "unknown" with factLanguage metadata. */
function agentMapLanguageFor(language: LanguageId): AgentMapLanguage {
  if (language === "typescript") return "typescript";
  if (language === "javascript") return "javascript";
  return "unknown";
}

function agentMapSymbolKindFor(kind: SymbolKind): AgentMapSymbolKind {
  switch (kind) {
    case "function":
      return "function";
    case "class":
      return "class";
    case "method":
      return "method";
    case "type":
      return "type";
    case "variable":
      return "variable";
    case "file":
      return "module";
    default:
      return "unknown";
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function fileRef(filePath: string): EvidenceRef {
  return { type: "file", ref: filePath };
}

function bridgeRef(): EvidenceRef {
  return {
    type: "other",
    ref: "context-engine/views/factstore-bridge",
    label: "FactStore shadow-provider bridge",
  };
}
