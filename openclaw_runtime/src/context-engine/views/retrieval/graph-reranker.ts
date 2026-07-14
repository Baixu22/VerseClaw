// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/retrieval/graph-reranker.ts — compact semantic rewrite ("按图距离重排,
// 无 embedding 也能跑", SPEC §6.3). ragcode's version rides its GraphStore contract plus
// ranking-signals/topology-distance helpers; this rewrite keeps the core idea on the
// FactStore: the top-scored files seed a 1-hop import/call neighborhood, and hits whose
// file sits inside that neighborhood get a proximity boost. Deeper multi-hop topology
// work lands with the impact view (Task G).
import type { FactStore } from "../../factstore/store.js";
import type { SearchHit } from "./hybrid-retriever.js";

export interface GraphRerankOptions {
  maxSeeds?: number;
  proximityBoost?: number;
}

const DEFAULT_MAX_SEEDS = 3;
const DEFAULT_PROXIMITY_BOOST = 0.3;

export function rerankWithGraph(
  store: FactStore,
  repoRoot: string,
  hits: SearchHit[],
  options: GraphRerankOptions = {},
): SearchHit[] {
  if (hits.length <= 1) return hits;
  const maxSeeds = options.maxSeeds ?? DEFAULT_MAX_SEEDS;
  const proximityBoost = options.proximityBoost ?? DEFAULT_PROXIMITY_BOOST;

  const seedFiles = uniqueFilesByScore(hits).slice(0, maxSeeds);
  if (seedFiles.length === 0) return hits;
  const neighborhood = importNeighborhood(store, repoRoot, seedFiles);

  return hits
    .map((hit) => {
      const filePath = hit.chunk.filePath;
      if (seedFiles.includes(filePath) || !neighborhood.has(fileStem(filePath))) return hit;
      const boosted = hit.score + proximityBoost;
      return {
        ...hit,
        score: boosted,
        source: hit.source === "keyword" ? ("graph" as const) : hit.source,
        scoreBreakdown: {
          ...hit.scoreBreakdown,
          graphAdjustment: (hit.scoreBreakdown?.graphAdjustment ?? 0) + proximityBoost,
          final: boosted,
        },
        reason: `${hit.reason}; graph proximity to seed [${seedFiles.join(", ")}] +${proximityBoost}`,
      };
    })
    .sort((a, b) => b.score - a.score || a.chunk.filePath.localeCompare(b.chunk.filePath));
}

function uniqueFilesByScore(hits: SearchHit[]): string[] {
  const bestByFile = new Map<string, number>();
  for (const hit of hits) {
    const current = bestByFile.get(hit.chunk.filePath);
    if (current === undefined || hit.score > current) {
      bestByFile.set(hit.chunk.filePath, hit.score);
    }
  }
  return [...bestByFile.entries()].sort((a, b) => b[1] - a[1]).map(([filePath]) => filePath);
}

/**
 * 1-hop neighborhood as file stems: everything a seed file imports or calls into,
 * plus files that import the seed (matched by module-specifier stem — resolving
 * specifiers to concrete files is Task G territory).
 */
function importNeighborhood(store: FactStore, repoRoot: string, seedFiles: string[]): Set<string> {
  const neighborhood = new Set<string>();
  const seedStems = new Set(seedFiles.map(fileStem));
  for (const seed of seedFiles) {
    for (const edge of store.getEdgesByFile(repoRoot, seed)) {
      if (edge.kind !== "imports" && edge.kind !== "calls") continue;
      const source = edge.metadata?.source;
      if (typeof source === "string") neighborhood.add(specifierStem(source));
      const targetName = edge.metadata?.targetName;
      if (typeof targetName === "string") neighborhood.add(targetName.toLowerCase());
    }
  }
  for (const edge of store.getEdgesByKind(repoRoot, "imports")) {
    const source = edge.metadata?.source;
    const sourceFile = edge.metadata?.sourceFile;
    if (typeof source !== "string" || typeof sourceFile !== "string") continue;
    if (seedStems.has(specifierStem(source))) neighborhood.add(fileStem(sourceFile));
  }
  return neighborhood;
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
