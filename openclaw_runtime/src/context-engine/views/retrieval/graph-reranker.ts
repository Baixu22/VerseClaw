// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/retrieval/graph-reranker.ts — compact semantic rewrite ("按图距离重排,
// 无 embedding 也能跑", SPEC §6.3). ragcode's version rides its GraphStore contract plus
// ranking-signals/topology-distance helpers; this rewrite keeps the core idea on the
// FactStore: the top-scored files seed a 1-hop import/call neighborhood, and hits whose
// file sits inside that neighborhood get a proximity boost. Deeper multi-hop topology
// work lands with the impact view (Task G).
import type { FactStore } from "../../factstore/store.js";
import type { SearchHit } from "./hybrid-retriever.js";
import type { SourceRefV2 } from "../../../runtime-core/knowledge-owner-read.js";

export interface GraphRerankOptions {
  maxSeeds?: number;
  proximityBoost?: number;
  /** Exact endpoint pins produced by the owner-admitted relationship expansion. */
  admittedSources?: readonly SourceRefV2[];
}

const DEFAULT_MAX_SEEDS = 3;
const DEFAULT_PROXIMITY_BOOST = 0.3;

export function rerankWithGraph(
  store: FactStore,
  repoRoot: string,
  hits: SearchHit[],
  options: GraphRerankOptions = {},
): SearchHit[] {
  if (hits.length <= 1 || !options.admittedSources?.length) return hits;
  const maxSeeds = options.maxSeeds ?? DEFAULT_MAX_SEEDS;
  const proximityBoost = options.proximityBoost ?? DEFAULT_PROXIMITY_BOOST;

  const seedFiles = uniqueFilesByScore(hits).slice(0, maxSeeds);
  if (seedFiles.length === 0) return hits;
  const neighborhood = new Map(
    options.admittedSources
      .filter((source) => source.domain === "code")
      .map((source) => [source.subjectId, source]),
  );

  return hits
    .map((hit) => {
      const filePath = hit.chunk.filePath;
      const pin = neighborhood.get(filePath);
      const file = store.getFileRecord(repoRoot, filePath);
      if (
        seedFiles.includes(filePath) ||
        !pin ||
        !file ||
        file.status !== "fresh" ||
        pin.authorityId !== hit.chunk.projectId ||
        pin.sourceDigest !== `sha256:${file.provenance.producedHash}`
      )
        return hit;
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
