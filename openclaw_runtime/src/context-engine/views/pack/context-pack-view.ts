// ContextPack assembly view (SPEC §6.1/§6.4, ALIGNMENT 校正3/4): reads facts from the
// FactStore (never parses), routes gaps through the Task D materialization closure, and
// emits the frozen ContextPack contract — evidence + declared gaps + edit-readiness.
import type {
  ContextMode,
  ContextPack,
  ContextSnippet,
  OwnerNode,
  RelationshipEvidence,
  TopologyEdge,
} from "../../fact-types.js";
import type { FreshnessReport } from "../../factstore/freshness.js";
import type { EnsureFactsResult, Materializer } from "../../factstore/materialize.js";
import type { FactStore } from "../../factstore/store.js";
import { estimatePackCost, truncatePackToBudget } from "./context-budget.js";
import { chooseExpansion } from "./expansion-policy.js";
import { skeletonizeChunk } from "./skeletonizer.js";
import { rerankWithGraph } from "../retrieval/graph-reranker.js";
import { retrieveHybrid, type SearchHit } from "../retrieval/hybrid-retriever.js";
import { classifyEvidencePath } from "../retrieval/path-classification.js";
import { buildQueryContext } from "../retrieval/query-context.js";

export interface ContextPackRequest {
  query: string;
  mode?: ContextMode;
  budgetChars?: number;
  /** Candidate repo-relative paths (e.g. provider activeFiles) to materialize first. */
  activeFiles?: string[];
  maxSnippets?: number;
}

export const DEFAULT_PACK_BUDGET_CHARS = 12_000;
const DEFAULT_MAX_SNIPPETS = 8;
const FOCUS_WINDOW_LINES = 12;

export async function buildContextPack(
  store: FactStore,
  materializer: Materializer,
  request: ContextPackRequest,
): Promise<ContextPack> {
  const repoRoot = materializer.repoRoot;
  const budgetChars = request.budgetChars ?? DEFAULT_PACK_BUDGET_CHARS;
  const mode = resolveMode(request.mode, request.query);
  const queryContext = buildQueryContext(request.query);

  const ensure = materializer.ensureFacts({ paths: request.activeFiles ?? [] });
  const retrieval = retrieveHybrid(store, repoRoot, queryContext, {
    limit: Math.max(request.maxSnippets ?? DEFAULT_MAX_SNIPPETS, 12),
  });
  let hits = rerankWithGraph(store, repoRoot, retrieval.hits);

  // Degradation chain (§3): index miss → automatic ripgrep backfill. Text hits are
  // memoized into the store (producer=ripgrep) and served as snippets so a cold or
  // partial store still answers at grep quality instead of returning nothing.
  let grepFallbackUsed = false;
  if (hits.length === 0) {
    const pattern = ripgrepPatternFor(queryContext);
    if (pattern) {
      const textFacts = await materializer.ensureTextFacts(pattern);
      if (textFacts.chunks.length > 0) {
        grepFallbackUsed = true;
        hits = textFacts.chunks.slice(0, 24).map((chunk) => ({
          chunk,
          score: 0.5,
          source: "keyword" as const,
          reason: `ripgrep fallback (producer=ripgrep) matched /${pattern}/`,
        }));
      }
    }
  }

  const ownerChain = buildOwnerChain(store, repoRoot, hits);
  const topology = buildTopology(store, repoRoot, ownerChain);
  const snippets = buildSnippets(hits, request.query, mode, request.maxSnippets ?? DEFAULT_MAX_SNIPPETS);
  const freshness = buildFreshness(store, repoRoot, ensure, ownerChain);
  const missingEvidence = buildMissingEvidence(ensure, hits, request.query);
  if (grepFallbackUsed) {
    missingEvidence.push(
      "Evidence served by the ripgrep fallback (producer=ripgrep); structural facts for these files are pending materialization.",
    );
  }
  const relationships = buildRelationships(topology);
  const nextQueries = buildNextQueries(queryContext.codeTokens, ownerChain);

  const answerable = snippets.length > 0;
  const confidence = deriveConfidence(hits, freshness, missingEvidence);
  const editReadiness = deriveEditReadiness(answerable, confidence, freshness, missingEvidence);

  // Field order below is the §6.1 contract order — do not reorder.
  const pack: ContextPack = {
    query: request.query,
    repoRoot,
    projectId: materializer.projectId,
    mode,
    answerable,
    confidence,
    editReadiness,
    brief: buildBrief(request.query, ownerChain, answerable),
    freshness,
    ownerChain,
    topology,
    snippets,
    relationships,
    missingEvidence,
    nextQueries,
    budgetChars,
    usedChars: 0,
  };
  pack.usedChars = estimatePackCost(pack, "markdown");
  if (pack.usedChars > budgetChars) {
    return truncatePackToBudget(pack, { hardByteCap: budgetChars, format: "markdown" });
  }
  return pack;
}

function resolveMode(mode: ContextMode | undefined, query: string): Exclude<ContextMode, "auto"> {
  if (mode && mode !== "auto") return mode;
  if (/\b(bug|error|fail|crash|broken)\b|报错|错误|失败/i.test(query)) return "debug";
  if (/\b(review|diff)\b|审查/i.test(query)) return "review";
  return "explain";
}

function buildOwnerChain(store: FactStore, repoRoot: string, hits: SearchHit[]): OwnerNode[] {
  const byFile = new Map<string, { score: number; reasons: string[] }>();
  for (const hit of hits) {
    const entry = byFile.get(hit.chunk.filePath) ?? { score: 0, reasons: [] };
    entry.score += hit.score;
    if (entry.reasons.length < 2) entry.reasons.push(hit.reason.split(";")[0] ?? hit.reason);
    byFile.set(hit.chunk.filePath, entry);
  }
  return [...byFile.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 5)
    .map(([filePath, entry]) => ({
      filePath,
      role: classifyEvidencePath(filePath),
      reason: entry.reasons.join("; "),
      score: Number(entry.score.toFixed(3)),
      symbols: store
        .getSymbolsByFile(repoRoot, filePath)
        .filter((symbol) => symbol.kind !== "file")
        .slice(0, 6)
        .map((symbol) => ({
          name: symbol.name,
          kind: symbol.kind,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
        })),
    }));
}

function buildTopology(store: FactStore, repoRoot: string, ownerChain: OwnerNode[]): TopologyEdge[] {
  const edges: TopologyEdge[] = [];
  for (const owner of ownerChain) {
    for (const edge of store.getEdgesByFile(repoRoot, owner.filePath)) {
      if (edge.kind !== "imports" && edge.kind !== "calls" && edge.kind !== "exports") continue;
      const target =
        typeof edge.metadata?.source === "string"
          ? edge.metadata.source
          : typeof edge.metadata?.targetName === "string"
            ? edge.metadata.targetName
            : edge.targetId;
      edges.push({
        from: owner.filePath,
        to: target,
        edge: edge.kind,
        confidence: "high",
        reason: `${edge.kind} edge recorded by producer at index time`,
        sourceFile: owner.filePath,
      });
      if (edges.length >= 12) return edges;
    }
  }
  return edges;
}

function buildSnippets(
  hits: SearchHit[],
  query: string,
  mode: Exclude<ContextMode, "auto">,
  maxSnippets: number,
): ContextSnippet[] {
  const snippets: ContextSnippet[] = [];
  const seenFiles = new Map<string, number>();
  for (const hit of hits) {
    if (snippets.length >= maxSnippets) break;
    const perFile = seenFiles.get(hit.chunk.filePath) ?? 0;
    if (perFile >= 2) continue;
    seenFiles.set(hit.chunk.filePath, perFile + 1);

    const decision = chooseExpansion(hit.chunk, query, mode);
    const originalLineCount = hit.chunk.content.length === 0 ? 0 : hit.chunk.content.split(/\r?\n/).length;
    let content: string;
    let startLine = hit.chunk.startLine;
    let endLine = hit.chunk.endLine;
    if (decision.expansionLevel === "skeleton") {
      content = skeletonizeChunk(hit.chunk);
    } else if (decision.expansionLevel === "file_card") {
      content = `${hit.chunk.filePath} (${originalLineCount} lines, ${hit.chunk.language})`;
    } else if (decision.focusLine !== undefined) {
      const lines = hit.chunk.content.split(/\r?\n/);
      const focusIndex = decision.focusLine - 1;
      const from = Math.max(0, focusIndex - FOCUS_WINDOW_LINES);
      const to = Math.min(lines.length, focusIndex + FOCUS_WINDOW_LINES + 1);
      content = lines.slice(from, to).join("\n");
      startLine = hit.chunk.startLine + from;
      endLine = hit.chunk.startLine + to - 1;
    } else {
      content = hit.chunk.content;
    }
    const returnedLineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;
    snippets.push({
      filePath: hit.chunk.filePath,
      startLine,
      endLine,
      content,
      score: Number(hit.score.toFixed(3)),
      reason: hit.reason,
      role: classifyEvidencePath(hit.chunk.filePath),
      expansionLevel: decision.expansionLevel,
      originalLineCount,
      returnedLineCount,
      elidedLineCount: Math.max(0, originalLineCount - returnedLineCount),
    });
  }
  return snippets;
}

function buildFreshness(
  store: FactStore,
  repoRoot: string,
  ensure: EnsureFactsResult,
  ownerChain: OwnerNode[],
): FreshnessReport {
  const staleOwners = ownerChain
    .map((owner) => owner.filePath)
    .filter((filePath) => store.getFileRecord(repoRoot, filePath)?.status === "stale");
  return {
    mode: "balanced",
    fresh: dedupe([...ensure.fresh, ...ensure.parsed]),
    stale: dedupe(staleOwners),
    missing: dedupe([...ensure.deferred, ...ensure.failed.map((failure) => failure.path)]),
    refreshed: [...ensure.parsed],
    checks: [],
  };
}

function buildMissingEvidence(ensure: EnsureFactsResult, hits: SearchHit[], query: string): string[] {
  const entries = [...ensure.missingEvidence];
  for (const failure of ensure.failed) {
    entries.push(`unreadable (${failure.error}): ${failure.path}`);
  }
  if (hits.length === 0) {
    entries.push(`No indexed evidence matched "${query}". The store may not cover the relevant files yet.`);
  }
  return entries;
}

/** OR-pattern over the strongest query terms for the T0 ripgrep fallback. */
function ripgrepPatternFor(queryContext: ReturnType<typeof buildQueryContext>): string | undefined {
  const terms = new Set<string>();
  for (const token of queryContext.codeTokens) terms.add(token);
  for (const term of queryContext.lexicalTerms) {
    if ((term.source === "raw" || term.source === "identifier" || term.source === "lexicon") && term.term.length >= 3) {
      terms.add(term.term);
    }
  }
  const escaped = [...terms].slice(0, 8).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return escaped.length > 0 ? escaped.join("|") : undefined;
}

function buildRelationships(topology: TopologyEdge[]): RelationshipEvidence[] {
  return topology.slice(0, 8).map((edge) => ({
    source: edge.from,
    target: edge.to,
    kind: edge.edge,
    reason: edge.reason,
  }));
}

function buildNextQueries(codeTokens: string[], ownerChain: OwnerNode[]): string[] {
  const queries: string[] = [];
  const topSymbol = ownerChain[0]?.symbols[0]?.name;
  if (topSymbol) queries.push(`callers of ${topSymbol}`);
  for (const token of codeTokens.slice(0, 2)) {
    queries.push(`impact of changing ${token}`);
  }
  if (ownerChain[1]) queries.push(`how does ${ownerChain[1].filePath} relate to ${ownerChain[0]?.filePath ?? "the entrypoint"}`);
  return dedupe(queries).slice(0, 3);
}

function deriveConfidence(
  hits: SearchHit[],
  freshness: FreshnessReport,
  missingEvidence: string[],
): "low" | "medium" | "high" {
  if (hits.length === 0) return "low";
  const hasExact = hits.some((hit) => hit.source === "exact");
  const noGaps = missingEvidence.length === 0 && freshness.stale.length === 0 && freshness.missing.length === 0;
  if (hasExact && noGaps) return "high";
  if (noGaps || hasExact) return "medium";
  return "low";
}

/** The 可动手判定 tri-state (gate E-2): evidence coverage decides, never vibes. */
function deriveEditReadiness(
  answerable: boolean,
  confidence: "low" | "medium" | "high",
  freshness: FreshnessReport,
  missingEvidence: string[],
): ContextPack["editReadiness"] {
  if (!answerable) return "not_enough_context";
  const hasGaps = missingEvidence.length > 0 || freshness.stale.length > 0 || freshness.missing.length > 0;
  if (hasGaps || confidence === "low") return "investigate_only";
  return "safe_to_edit_after_reading";
}

function buildBrief(query: string, ownerChain: OwnerNode[], answerable: boolean): string {
  if (!answerable || ownerChain.length === 0) {
    return `No indexed evidence answers "${query}" yet.`;
  }
  const top = ownerChain[0]!;
  const symbolNames = top.symbols.slice(0, 3).map((symbol) => symbol.name);
  const alsoCount = Math.max(0, ownerChain.length - 1);
  return `${top.filePath} owns the closest evidence${symbolNames.length > 0 ? ` (${symbolNames.join(", ")})` : ""}${alsoCount > 0 ? `; ${alsoCount} related file(s) attached` : ""}.`;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
