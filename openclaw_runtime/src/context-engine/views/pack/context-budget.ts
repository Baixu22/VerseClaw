// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/context/context-budget.ts (verbatim except the recorded deltas).
// Deltas: FreshnessReport is the local hash-compare report (factstore/freshness.ts) so
// compactFreshness/freshnessFileCount slice fresh/stale/missing/refreshed/checks instead of
// ragcode's watcher lists; memorySnippets/memoryHints handling dropped (memory layer is on
// the do-not-copy list); expandContext hints point at the context.understand capability.
import type {
  ContextBudgetTrace,
  ContextPack,
  ContextSnippet,
  MissingEvidenceHint,
} from "../../fact-types.js";
import type { FreshnessReport } from "../../factstore/freshness.js";

export type ContextResultFormat = "json" | "markdown";

export interface ContextBudget {
  hardByteCap: number;
  targetByteCap?: number;
  format?: ContextResultFormat;
  providerHint?: string;
  minSnippets?: number;
  degradationLevel?: number;
  fallbackReason?: string;
}

export interface ContextBudgetResult {
  pack: ContextPack;
  trace: ContextBudgetTrace;
}

export function measureTransportBytes(result: unknown): number {
  const envelope = {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
  return Buffer.byteLength(JSON.stringify(envelope), "utf8");
}

export function estimateModelTokens(result: unknown, providerHint?: string): number {
  return estimateModelTokenDetails(result, providerHint).tokens;
}

export function estimateSnippetCost(snippet: ContextSnippet, format: ContextResultFormat = "json"): number {
  if (format === "markdown") {
    return Buffer.byteLength(`${snippet.filePath}\n${snippet.role}\n${snippet.content}`, "utf8") + 160;
  }
  return Buffer.byteLength(JSON.stringify(snippet), "utf8");
}

export function estimatePackCost(pack: ContextPack, format: ContextResultFormat = "json"): number {
  if (format === "markdown") {
    const snippetCost = pack.snippets.reduce((sum, snippet) => sum + estimateSnippetCost(snippet, "markdown"), 0);
    return Buffer.byteLength(JSON.stringify({ ...pack, snippets: [] }), "utf8") + snippetCost;
  }
  return Buffer.byteLength(JSON.stringify(pack), "utf8");
}

export function truncatePackToBudget(pack: ContextPack, budget: ContextBudget): ContextPack {
  const hardByteCap = Math.max(512, budget.hardByteCap);
  const targetByteCap = budget.targetByteCap ?? Math.floor(hardByteCap * 0.85);
  const format = budget.format ?? "json";
  const minSnippets = budget.minSnippets ?? 1;
  const originalSnippetCount = pack.snippets.length;
  const originalFreshnessFiles = freshnessFileCount(pack.freshness);
  let next = compactPackMetadata(pack);

  next.snippets = selectBudgetedSnippets(next.snippets, targetByteCap, format, minSnippets);
  next = trimSnippetBodies(next, targetByteCap, format);

  const omittedSnippets = originalSnippetCount - next.snippets.length;
  const omittedFiles = originalFreshnessFiles - freshnessFileCount(next.freshness);
  const notice = truncationNotice(hardByteCap, omittedSnippets, omittedFiles);
  next.missingEvidence = uniqueStrings([
    ...next.missingEvidence.filter((entry) => !entry.startsWith("Results truncated to fit")),
    notice
  ]);
  next.missingEvidenceHints = appendMissingEvidenceHint(
    next.missingEvidenceHints,
    budgetHint("context_budget_truncated", pack, next, hardByteCap, format, omittedSnippets, omittedFiles)
  );
  next.usedChars = Math.min(next.budgetChars, estimatePackCost(next, format));
  next.budgetTrace = {
    hardByteCap,
    targetByteCap,
    renderedBytes: estimatePackCost(next, format),
    transportBytes: 0,
    estimatedModelTokens: 0,
    tokenEstimateApproximate: true,
    tokenizer: "heuristic-conservative",
    providerHint: budget.providerHint,
    format,
    omittedSnippets,
    omittedFiles,
    truncated: true,
    fallbackUsed: false,
    degradationLevel: budget.degradationLevel ?? 1,
    fallbackReason: budget.fallbackReason
  };
  return next;
}

export function assertToolResultUnderBudget(result: unknown, budget: ContextBudget): void {
  const bytes = measureTransportBytes(result);
  if (bytes > budget.hardByteCap) {
    throw new Error(`Tool result exceeded transport budget: ${bytes} > ${budget.hardByteCap} bytes.`);
  }
}

export function contextBudgetTrace(
  result: unknown,
  budget: ContextBudget,
  details: {
    renderedBytes?: number;
    omittedSnippets?: number;
    omittedFiles?: number;
    truncated?: boolean;
    fallbackUsed?: boolean;
    degradationLevel?: number;
    fallbackReason?: string;
  } = {}
): ContextBudgetTrace {
  const hardByteCap = Math.max(512, budget.hardByteCap);
  const targetByteCap = budget.targetByteCap ?? Math.floor(hardByteCap * 0.85);
  const tokenEstimate = estimateModelTokenDetails(result, budget.providerHint);
  return {
    hardByteCap,
    targetByteCap,
    renderedBytes: details.renderedBytes ?? Buffer.byteLength(typeof result === "string" ? result : JSON.stringify(result), "utf8"),
    transportBytes: measureTransportBytes(result),
    estimatedModelTokens: tokenEstimate.tokens,
    tokenEstimateApproximate: true,
    tokenizer: tokenEstimate.tokenizer,
    providerHint: budget.providerHint,
    format: budget.format ?? "json",
    omittedSnippets: details.omittedSnippets ?? 0,
    omittedFiles: details.omittedFiles ?? 0,
    truncated: details.truncated ?? false,
    fallbackUsed: details.fallbackUsed ?? false,
    degradationLevel: details.degradationLevel ?? budget.degradationLevel,
    fallbackReason: details.fallbackReason ?? budget.fallbackReason
  };
}

export function compactFallbackPack(pack: ContextPack, budget: ContextBudget): ContextPack {
  const hardByteCap = Math.max(512, budget.hardByteCap);
  const format = budget.format ?? "json";
  const snippet = pack.snippets[0] ? truncateSnippetToBytes(pack.snippets[0], Math.max(120, Math.floor(hardByteCap * 0.25))) : undefined;
  const fallback: ContextPack = {
    query: pack.query,
    repoRoot: pack.repoRoot,
    projectId: pack.projectId,
    mode: pack.mode,
    answerable: Boolean(snippet),
    confidence: "low",
    editReadiness: snippet ? "investigate_only" : "not_enough_context",
    brief: pack.brief,
    freshness: compactFreshness(pack.freshness, 1),
    ownerChain: pack.ownerChain.slice(0, 1),
    topology: [],
    snippets: snippet ? [snippet] : [],
    relationships: [],
    missingEvidence: uniqueStrings([
      ...pack.missingEvidence.slice(0, 2),
      "Results exceeded the transport budget; returned compact fallback context. Use a larger budget for omitted evidence."
    ]),
    nextQueries: pack.nextQueries.slice(0, 1),
    missingEvidenceHints: appendMissingEvidenceHint(
      pack.missingEvidenceHints,
      budgetHint(
        "compact_fallback",
        pack,
        {
          ...pack,
          snippets: snippet ? [snippet] : [],
          freshness: compactFreshness(pack.freshness, 1)
        },
        hardByteCap,
        format,
        Math.max(0, pack.snippets.length - (snippet ? 1 : 0)),
        freshnessFileCount(pack.freshness) - freshnessFileCount(compactFreshness(pack.freshness, 1))
      )
    ),
    budgetChars: pack.budgetChars,
    usedChars: 0
  };
  fallback.usedChars = Math.min(fallback.budgetChars, estimatePackCost(fallback, format));
  fallback.budgetTrace = {
    hardByteCap,
    targetByteCap: budget.targetByteCap ?? Math.floor(hardByteCap * 0.85),
    renderedBytes: estimatePackCost(fallback, format),
    transportBytes: 0,
    estimatedModelTokens: 0,
    tokenEstimateApproximate: true,
    tokenizer: "heuristic-conservative",
    providerHint: budget.providerHint,
    format,
    omittedSnippets: Math.max(0, pack.snippets.length - fallback.snippets.length),
    omittedFiles: freshnessFileCount(pack.freshness) - freshnessFileCount(fallback.freshness),
    truncated: true,
    fallbackUsed: true,
    degradationLevel: budget.degradationLevel ?? 4,
    fallbackReason: budget.fallbackReason ?? "compact_fallback"
  };
  return fallback;
}

export function markdownFenceFor(content: string, language = ""): { open: string; close: string } {
  const longest = longestBacktickRun(content);
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return {
    open: `${ticks}${language}`,
    close: ticks
  };
}

function compactPackMetadata(pack: ContextPack): ContextPack {
  return {
    ...pack,
    freshness: compactFreshness(pack.freshness, 3),
    ownerChain: pack.ownerChain.slice(0, 5),
    relationships: pack.relationships.slice(0, 8),
    topology: pack.topology.slice(0, 8),
    nextQueries: pack.nextQueries.slice(0, 3),
    missingEvidenceHints: pack.missingEvidenceHints?.slice(0, 4)
  };
}

function compactFreshness(freshness: FreshnessReport, maxFiles: number): FreshnessReport {
  return {
    ...freshness,
    fresh: freshness.fresh.slice(0, maxFiles),
    stale: freshness.stale.slice(0, maxFiles),
    missing: freshness.missing.slice(0, maxFiles),
    refreshed: freshness.refreshed.slice(0, maxFiles),
    checks: freshness.checks.slice(0, maxFiles)
  };
}

function selectBudgetedSnippets(
  snippets: ContextSnippet[],
  targetByteCap: number,
  format: ContextResultFormat,
  minSnippets: number
): ContextSnippet[] {
  const sorted = [...snippets].sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));
  const selected: ContextSnippet[] = [];
  let used = 0;
  for (const snippet of sorted) {
    const cost = estimateSnippetCost(snippet, format);
    if (selected.length >= minSnippets && used + cost > Math.floor(targetByteCap * 0.55)) continue;
    selected.push(snippet);
    used += cost;
    if (used > Math.floor(targetByteCap * 0.7)) break;
  }
  return selected.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine);
}

function trimSnippetBodies(pack: ContextPack, targetByteCap: number, format: ContextResultFormat): ContextPack {
  if (pack.snippets.length === 0) return pack;
  const next = { ...pack, snippets: [...pack.snippets] };
  let cost = estimatePackCost(next, format);
  if (cost <= targetByteCap) return next;

  const perSnippetBudget = Math.max(160, Math.floor((targetByteCap * 0.45) / next.snippets.length));
  next.snippets = next.snippets.map((snippet) => truncateSnippetToBytes(snippet, perSnippetBudget));
  cost = estimatePackCost(next, format);
  if (cost <= targetByteCap || next.snippets.length <= 1) return next;

  while (next.snippets.length > 1 && estimatePackCost(next, format) > targetByteCap) {
    next.snippets = next.snippets.slice(0, -1);
  }
  return next;
}

function truncateSnippetToBytes(snippet: ContextSnippet, maxContentBytes: number): ContextSnippet {
  if (Buffer.byteLength(snippet.content, "utf8") <= maxContentBytes) return snippet;
  const notice = "/* truncated: raise budgetChars for remaining lines */";
  const noticeBytes = Buffer.byteLength(`\n${notice}`, "utf8");
  const contentBudget = Math.max(0, maxContentBytes - noticeBytes);
  const clipped = clipUtf8(lineAwarePrefix(snippet.content, contentBudget), contentBudget);
  const content = contentBudget > 0
    ? `${clipped.text}\n${notice}`
    : clipUtf8(notice, maxContentBytes).text;
  const returnedLineCount = Math.max(1, content.split(/\r?\n/).length);
  return {
    ...snippet,
    content,
    returnedLineCount,
    elidedLineCount: Math.max(snippet.elidedLineCount, Math.max(0, snippet.originalLineCount - returnedLineCount))
  };
}

function lineAwarePrefix(content: string, maxBytes: number): string {
  const lines = content.split(/\r?\n/);
  if (lines.length <= 1) return content;
  let output = "";
  for (const line of lines) {
    const candidate = output ? `${output}\n${line}` : line;
    if (Buffer.byteLength(candidate, "utf8") > maxBytes) break;
    output = candidate;
  }
  return output || lines[0] || "";
}

function clipUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (maxBytes <= 0) return { text: "", truncated: Buffer.byteLength(value, "utf8") > 0 };
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return { text: value, truncated: false };
  let output = "";
  let bytes = 0;
  for (const char of Array.from(value)) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) break;
    output += char;
    bytes += charBytes;
  }
  return { text: output.trimEnd(), truncated: true };
}

function estimateModelTokenDetails(result: unknown, providerHint?: string): { tokens: number; tokenizer: string } {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  const chars = Array.from(text);
  const bytes = Buffer.byteLength(text, "utf8");
  const cjkChars = chars.filter((char) => /[㐀-鿿぀-ヿ가-힯]/u.test(char)).length;
  const cjkRatio = chars.length > 0 ? cjkChars / chars.length : 0;
  const codeOrJsonLike = /```|[{[\]}]|=>|;\s*$|\b(function|class|const|let|interface|type)\b|"\w+"\s*:/m.test(text);
  const charDivisor = cjkRatio >= 0.15 ? 1 : codeOrJsonLike ? 2.5 : 3;
  const charEstimate = Math.ceil(chars.length / charDivisor);
  const byteEstimate = Math.ceil(bytes / 4);
  const provider = providerHint ? `:${providerHint}` : "";
  return {
    tokens: Math.max(1, charEstimate, byteEstimate),
    tokenizer: `heuristic-conservative${provider}`
  };
}

function freshnessFileCount(freshness: FreshnessReport): number {
  return freshness.stale.length + freshness.missing.length;
}

function truncationNotice(hardByteCap: number, omittedSnippets: number, omittedFiles: number): string {
  return `Results truncated to fit ${hardByteCap} transport bytes: ${omittedSnippets} snippet(s) and ${omittedFiles} freshness file entry/entries omitted. Raise budgetChars for full evidence.`;
}

function budgetHint(
  code: MissingEvidenceHint["code"],
  original: ContextPack,
  current: Pick<ContextPack, "snippets" | "freshness">,
  hardByteCap: number,
  format: ContextResultFormat,
  omittedSnippets: number,
  omittedFiles: number
): MissingEvidenceHint {
  return {
    code,
    message: code === "compact_fallback"
      ? "Context was compacted to fit the requested transport budget."
      : "Context evidence was truncated to fit the requested transport budget.",
    omittedSnippets: {
      count: omittedSnippets,
      originalCount: original.snippets.length,
      returnedCount: current.snippets.length,
      filePaths: omittedSnippetFilePaths(original.snippets, current.snippets)
    },
    omittedFiles: {
      count: omittedFiles,
      freshnessCategories: omittedFreshnessCategories(original.freshness, current.freshness)
    },
    expandContext: {
      capability: "context.understand",
      args: {
        repoRoot: original.repoRoot,
        query: original.query,
        mode: original.mode,
        budgetChars: Math.max(18_000, hardByteCap * 2),
        format
      }
    }
  };
}

function appendMissingEvidenceHint(existing: MissingEvidenceHint[] | undefined, hint: MissingEvidenceHint): MissingEvidenceHint[] {
  const withoutSameCode = (existing ?? []).filter((entry) => entry.code !== hint.code);
  return [...withoutSameCode, hint];
}

function omittedSnippetFilePaths(original: ContextSnippet[], current: ContextSnippet[]): string[] {
  const currentKeys = new Set(current.map(snippetKey));
  return uniqueStrings(original.filter((snippet) => !currentKeys.has(snippetKey(snippet))).map((snippet) => snippet.filePath)).slice(0, 12);
}

function snippetKey(snippet: ContextSnippet): string {
  return `${snippet.filePath}\0${snippet.startLine}\0${snippet.endLine}\0${snippet.role}`;
}

type FreshnessCategory = NonNullable<MissingEvidenceHint["omittedFiles"]>["freshnessCategories"][number];

function omittedFreshnessCategories(original: FreshnessReport, current: FreshnessReport): FreshnessCategory[] {
  const categories: FreshnessCategory[] = [];
  if (original.stale.length > current.stale.length) categories.push("staleFiles");
  if (original.missing.length > current.missing.length) categories.push("missingFiles");
  return categories;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function longestBacktickRun(content: string): number {
  let longest = 0;
  const matches = content.match(/`+/g) ?? [];
  for (const match of matches) longest = Math.max(longest, match.length);
  return longest;
}
