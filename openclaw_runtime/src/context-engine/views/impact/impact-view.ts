// Impact analysis view (SPEC Task 6, gate G): semantic rewrite of ragcode's
// src/graph/impact-report.ts + src/graph/target-matcher.ts (MIT,
// https://github.com/MarshallEriksen-Neura/ragcode) over the local FactStore.
// Parity baseline is the vendored codegraph extension's callers/impact output
// (ALIGNMENT 校正2); recall must be a superset, never less.
//
// Join note: tree-sitter/TS-compiler call edges carry targetId =
// stableId([repoRoot, targetName, "symbol"]), which is a name-keyed synthetic id,
// so caller/callee joins go through metadata.targetName (the same medium-confidence
// join ragcode uses when resolution metadata is absent).
import type { EdgeKind, GraphEdge, SymbolNode } from "../../fact-types.js";
import type { FactStore } from "../../factstore/store.js";
import { normalizeFactPath } from "../../factstore/ignore.js";

export interface ImpactTargetSpec {
  raw: string;
  normalized: string;
  lowered: string;
  filePath?: string;
  symbolName?: string;
  qualified: boolean;
}

export interface ImpactCaller {
  name: string;
  filePath: string;
  kind: string;
  startLine: number;
  endLine: number;
  depth: number;
  via: string;
}

export interface ImpactReference {
  edge: EdgeKind;
  sourceFile?: string;
  targetFile?: string;
  sourceSymbol?: string;
  targetSymbol?: string;
  targetName?: string;
  reason: string;
  confidence: "low" | "medium" | "high";
}

export interface ImpactAnalysis {
  target: string;
  matchedSymbols: SymbolNode[];
  callers: ImpactCaller[];
  callees: ImpactCaller[];
  impactedFiles: string[];
  references: ImpactReference[];
  riskLevel: "low" | "medium" | "high";
}

export interface ImpactOptions {
  /** Caller/callee chain depth; codegraph parity default is 2. */
  depth?: number;
}

/** target-matcher semantics: `path:symbol`/`path#symbol` qualified, else fuzzy name/path. */
export function parseImpactTarget(target: string): ImpactTargetSpec {
  const normalized = normalizeFactPath(target.trim());
  const qualified = parseQualifiedTarget(normalized);
  if (qualified) {
    return {
      raw: target,
      normalized,
      lowered: normalized.toLowerCase(),
      filePath: qualified.filePath,
      symbolName: qualified.symbolName,
      qualified: true,
    };
  }
  return { raw: target, normalized, lowered: target.toLowerCase(), qualified: false };
}

export function matchesImpactTarget(symbol: SymbolNode, target: ImpactTargetSpec): boolean {
  if (target.qualified) {
    return Boolean(
      target.filePath &&
        target.symbolName &&
        filePathMatches(symbol.filePath, target.filePath) &&
        symbol.name === target.symbolName,
    );
  }
  return (
    symbol.name.toLowerCase().includes(target.lowered) ||
    symbol.filePath === target.normalized ||
    symbol.filePath.includes(target.normalized)
  );
}

export function analyzeImpact(
  store: FactStore,
  repoRoot: string,
  target: string,
  options: ImpactOptions = {},
): ImpactAnalysis {
  const depth = options.depth ?? 2;
  const spec = parseImpactTarget(target);
  const callEdges = store.getEdgesByKind(repoRoot, "calls");
  const importEdges = store.getEdgesByKind(repoRoot, "imports");

  const matchedSymbols = collectMatchedSymbols(store, repoRoot, spec);
  const symbolsByFile = new Map<string, SymbolNode[]>();
  const symbolsById = new Map<string, SymbolNode>();
  for (const symbol of matchedSymbols) {
    indexSymbolFile(store, repoRoot, symbol.filePath, symbolsByFile, symbolsById);
  }
  for (const edge of callEdges) {
    const sourceFile = stringMetadata(edge, "sourceFile");
    if (sourceFile) indexSymbolFile(store, repoRoot, sourceFile, symbolsByFile, symbolsById);
  }

  // Callers: breadth-first over incoming call edges, joined by targetName.
  const callers: ImpactCaller[] = [];
  const seenCallers = new Set<string>();
  let frontierNames = new Set(matchedSymbols.map((symbol) => symbol.name.toLowerCase()));
  if (!spec.qualified) frontierNames.add(spec.lowered);
  for (let level = 1; level <= depth && frontierNames.size > 0; level += 1) {
    const nextFrontier = new Set<string>();
    for (const edge of callEdges) {
      const targetName = stringMetadata(edge, "targetName")?.toLowerCase();
      if (!targetName || !frontierNames.has(targetName)) continue;
      const source = symbolsById.get(edge.sourceId);
      if (!source || source.kind === "file") continue;
      const key = `${source.name}@${source.filePath}`;
      if (seenCallers.has(key)) continue;
      seenCallers.add(key);
      callers.push({
        name: source.name,
        filePath: source.filePath,
        kind: source.kind,
        startLine: source.startLine,
        endLine: source.endLine,
        depth: level,
        via: stringMetadata(edge, "targetName") ?? spec.raw,
      });
      nextFrontier.add(source.name.toLowerCase());
    }
    frontierNames = nextFrontier;
  }

  // Callees: outgoing call edges from the matched symbols, resolved by name.
  const matchedIds = new Set(matchedSymbols.map((symbol) => symbol.id));
  const callees: ImpactCaller[] = [];
  const seenCallees = new Set<string>();
  for (const edge of callEdges) {
    if (!matchedIds.has(edge.sourceId)) continue;
    const targetName = stringMetadata(edge, "targetName");
    if (!targetName) continue;
    for (const resolved of store.findSymbolByNameLike(repoRoot, targetName)) {
      if (resolved.kind === "file" || resolved.name !== targetName) continue;
      const key = `${resolved.name}@${resolved.filePath}`;
      if (seenCallees.has(key)) continue;
      seenCallees.add(key);
      callees.push({
        name: resolved.name,
        filePath: resolved.filePath,
        kind: resolved.kind,
        startLine: resolved.startLine,
        endLine: resolved.endLine,
        depth: 1,
        via: targetName,
      });
    }
  }

  // Impacted files: targets + caller files + callee files + importers of target files.
  const impacted = new Set<string>();
  for (const symbol of matchedSymbols) impacted.add(symbol.filePath);
  for (const caller of callers) impacted.add(caller.filePath);
  for (const callee of callees) impacted.add(callee.filePath);
  const targetStems = new Set(matchedSymbols.map((symbol) => fileStem(symbol.filePath)));
  for (const edge of importEdges) {
    const specifier = stringMetadata(edge, "source");
    const sourceFile = stringMetadata(edge, "sourceFile");
    if (!specifier || !sourceFile) continue;
    if (targetStems.has(specifierStem(specifier))) impacted.add(normalizeFactPath(sourceFile));
  }

  const references = buildReferences(callEdges, importEdges, matchedIds, matchedSymbols, symbolsById, spec);
  const riskScore = impacted.size + references.length;
  return {
    target,
    matchedSymbols,
    callers,
    callees,
    impactedFiles: [...impacted].sort(),
    references,
    riskLevel: riskScore > 12 ? "high" : riskScore > 4 ? "medium" : "low",
  };
}

function collectMatchedSymbols(store: FactStore, repoRoot: string, spec: ImpactTargetSpec): SymbolNode[] {
  const needle = spec.qualified ? (spec.symbolName ?? spec.normalized) : spec.raw;
  const candidates = store.findSymbolByNameLike(repoRoot, needle);
  const matched = candidates.filter((symbol) => symbol.kind !== "file" && matchesImpactTarget(symbol, spec));
  if (matched.length > 0 || spec.qualified) return matched;
  // File-path targets: fall back to every symbol in the referenced file.
  return store
    .getSymbolsByFile(repoRoot, spec.normalized)
    .filter((symbol) => symbol.kind !== "file");
}

function indexSymbolFile(
  store: FactStore,
  repoRoot: string,
  filePath: string,
  symbolsByFile: Map<string, SymbolNode[]>,
  symbolsById: Map<string, SymbolNode>,
): void {
  const normalized = normalizeFactPath(filePath);
  if (symbolsByFile.has(normalized)) return;
  const symbols = store.getSymbolsByFile(repoRoot, normalized);
  symbolsByFile.set(normalized, symbols);
  for (const symbol of symbols) symbolsById.set(symbol.id, symbol);
}

function buildReferences(
  callEdges: GraphEdge[],
  importEdges: GraphEdge[],
  matchedIds: Set<string>,
  matchedSymbols: SymbolNode[],
  symbolsById: Map<string, SymbolNode>,
  spec: ImpactTargetSpec,
): ImpactReference[] {
  const matchedNames = new Set(matchedSymbols.map((symbol) => symbol.name.toLowerCase()));
  if (!spec.qualified) matchedNames.add(spec.lowered);
  const references: ImpactReference[] = [];
  const seen = new Set<string>();
  const push = (reference: ImpactReference) => {
    const key = [reference.edge, reference.sourceFile, reference.targetFile, reference.targetName, reference.sourceSymbol].join("::");
    if (seen.has(key)) return;
    seen.add(key);
    references.push(reference);
  };

  for (const edge of callEdges) {
    const targetName = stringMetadata(edge, "targetName")?.toLowerCase();
    const incoming = targetName !== undefined && matchedNames.has(targetName);
    const outgoing = matchedIds.has(edge.sourceId);
    if (!incoming && !outgoing) continue;
    const source = symbolsById.get(edge.sourceId);
    push({
      edge: edge.kind,
      sourceFile: source?.filePath ?? stringMetadata(edge, "sourceFile"),
      sourceSymbol: source?.name,
      targetName: stringMetadata(edge, "targetName"),
      reason: incoming ? "Incoming call edge to target." : "Outgoing call edge from target.",
      confidence: stringMetadata(edge, "targetName") ? "medium" : "low",
    });
  }
  const targetStems = new Set(matchedSymbols.map((symbol) => fileStem(symbol.filePath)));
  for (const edge of importEdges) {
    const specifier = stringMetadata(edge, "source");
    const sourceFile = stringMetadata(edge, "sourceFile");
    if (!specifier || !sourceFile || !targetStems.has(specifierStem(specifier))) continue;
    push({
      edge: edge.kind,
      sourceFile: normalizeFactPath(sourceFile),
      targetName: specifier,
      reason: "Importer of a target-owning module.",
      confidence: "medium",
    });
  }
  return references;
}

function parseQualifiedTarget(target: string): { filePath: string; symbolName: string } | undefined {
  const separatorIndex = Math.max(target.lastIndexOf(":"), target.lastIndexOf("#"));
  if (separatorIndex <= 0 || separatorIndex === target.length - 1) return undefined;
  const filePath = target.slice(0, separatorIndex);
  const symbolName = target.slice(separatorIndex + 1);
  if (!looksLikePath(filePath) || !symbolName) return undefined;
  return { filePath, symbolName };
}

function looksLikePath(value: string): boolean {
  return value.includes("/") || /\.[cm]?[jt]sx?$/.test(value) || /\.[a-z0-9]+$/i.test(value);
}

function filePathMatches(actual: string, expected: string): boolean {
  return actual === expected || actual.endsWith(`/${expected}`);
}

function stringMetadata(edge: GraphEdge, key: string): string | undefined {
  const value = edge.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function fileStem(filePath: string): string {
  const base = filePath.replaceAll("\\", "/").split("/").pop() ?? filePath;
  return base.replace(/\.[^.]+$/, "").toLowerCase();
}

function specifierStem(specifier: string): string {
  const cleaned = specifier.replace(/['"]/g, "");
  const base = cleaned.split("/").pop() ?? cleaned;
  return base.replace(/\.(js|ts|mjs|cjs|jsx|tsx)$/, "").toLowerCase();
}
