// @vitest-environment node
// Module B Single-Path Deep Test: Measures each retrieval path (BM25-only,
// Vector-only, Hybrid RRF) INDEPENDENTLY with full ranking metrics.
//
// "单侧结果" = each path reported as a standalone retriever, not just a
// combined comparison. For every query we extract the full ranking from each
// path and compute recall@K (K=1,3,5,10), MRR, NDCG@10, and latency, then
// drill down per-query to expose where RRF fusion helps or hurts.

import { describe, it } from "vitest";
import { HybridSearchIndex } from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

// === Helpers ===

function pct(n: number, total: number): number {
  return total > 0 ? (n / total) * 100 : 0;
}

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function ndcgAtK(rank: number | null, k: number): number {
  if (rank === null || rank > k) return 0;
  return 1 / Math.log2(rank + 1);
}

function makeFact(
  id: string,
  subject: string,
  predicate: string,
  objectSummary: string,
  confidence: number = 0.8,
): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject,
    predicate,
    objectSummary,
    confidence,
    valid_at: 100,
    reference_time: 100,
  });
}

// === Query categories ===
// Five categories × 10 queries = 50 queries, designed to stress different
// retrieval strengths:
//   exact       — BM25 dominates (error codes, identifiers)
//   typo        — Vector dominates, BM25 fails (character-level fuzz)
//   morph       — Vector partial win (word-form variation)
//   paraphrase  — Vector should win, BM25 fails (no shared words)
//   subject     — BM25 wins (subject field weighted ×3)

type QueryType = "exact" | "typo" | "morph" | "paraphrase" | "subject";
type Target = { fact: RuntimeMemoryTemporalFact; query: string; type: QueryType };

function buildCorpusAndQueries(): {
  facts: RuntimeMemoryTemporalFact[];
  targets: Target[];
} {
  const facts: RuntimeMemoryTemporalFact[] = [];
  const targets: Target[] = [];

  // --- 480 noise facts ---
  const domains = [
    "UserPreference", "CodeError", "SystemConfig", "ProjectFact",
    "ToolUsage", "ApiContract", "TestData", "EnvironmentFact",
  ];
  const predicates = [
    "preference", "error_code", "value", "stack", "invocation",
    "endpoint", "fixture", "variable",
  ];
  const tools = ["pnpm", "vitest", "neovim", "typescript", "node22", "eslint", "prettier", "github"];
  for (let i = 0; i < 480; i++) {
    const d = domains[i % domains.length];
    const p = predicates[i % predicates.length];
    const t = tools[i % tools.length];
    facts.push(makeFact(
      `noise-${i}`,
      d,
      p,
      `${d} detail ${i}: ${t} configuration value ${i % 100} with token alpha${i % 17}`,
      0.6 + (i % 10) * 0.03,
    ));
  }

  // --- 10 exact-term targets (error codes / identifiers) ---
  const errorCodes = [
    "ERR_TS_2345", "AUTH_TOKEN_7723", "ERR_GATEWAY_5001",
    "ECONNREFUSED_61", "SQLITE_BUSY_5", "ERR_ESLINT_9001",
    "AUTH_EXPIRED_4401", "ERR_VITE_3002", "EACCES_13", "ERR_NODE_404",
  ];
  for (let i = 0; i < 10; i++) {
    const code = errorCodes[i];
    const fact = makeFact(
      `target-exact-${i}`,
      "CodeError",
      "error_code",
      `Error ${code} rejected upstream request with signature mismatch in module ${i}`,
      0.92,
    );
    facts.push(fact);
    targets.push({ fact, query: `${code} error signature`, type: "exact" });
  }

  // --- 10 typo targets (BM25 word-tokenizer splits on \W, so typos break exact match) ---
  // Target contains "neovim" / "typescript"; query has "neovm" / "typescrip" (missing char).
  const typoPairs = [
    { doc: "neovim", query: "neovm" },
    { doc: "typescript", query: "typescrip" },
    { doc: "eslint", query: "eslit" },
    { doc: "prettier", query: "prettir" },
    { doc: "vitest", query: "vitst" },
    { doc: "pnpm", query: "pnp" },
    { doc: "node22", query: "node2" },
    { doc: "github", query: "githb" },
    { doc: "react19", query: "reac19" },
    { doc: "webpack5", query: "webpak5" },
  ];
  for (let i = 0; i < 10; i++) {
    const { doc, query } = typoPairs[i];
    const fact = makeFact(
      `target-typo-${i}`,
      "ToolUsage",
      "invocation",
      `Tool ${doc} invoked with arguments for build pipeline stage ${i}`,
      0.85,
    );
    facts.push(fact);
    targets.push({ fact, query: `${query} tool build pipeline`, type: "typo" });
  }

  // --- 10 morphological targets (word-form variation: "editing" vs "editor") ---
  const morphPairs = [
    { doc: "editing", query: "editor" },
    { doc: "validation", query: "validator" },
    { doc: "configuration", query: "configure" },
    { doc: "deployment", query: "deploy" },
    { doc: "authentication", query: "authenticate" },
    { doc: "optimization", query: "optimize" },
    { doc: "serialization", query: "serialize" },
    { doc: "migration", query: "migrate" },
    { doc: "compilation", query: "compile" },
    { doc: "execution", query: "execute" },
  ];
  for (let i = 0; i < 10; i++) {
    const { doc, query } = morphPairs[i];
    const fact = makeFact(
      `target-morph-${i}`,
      "ProjectFact",
      "value",
      `Project uses ${doc} pipeline for stage ${i} processing`,
      0.84,
    );
    facts.push(fact);
    targets.push({ fact, query: `${query} pipeline stage processing`, type: "morph" });
  }

  // --- 10 paraphrase targets (no shared words; only char 3-gram overlap) ---
  const paraphrasePairs = [
    {
      doc: "User chose neovim as daily editing application",
      query: "preferred editor person",
    },
    {
      doc: "User picked vitest as primary validation library",
      query: "preferred javascript testing framework alternatives",
    },
    {
      doc: "System utilizes redis for in-memory caching layer",
      query: "cache infrastructure distributed storage",
    },
    {
      doc: "Gateway rejects malformed payloads with code four hundred",
      query: "bad request handler validation",
    },
    {
      doc: "Database connection pool exhausted during peak traffic",
      query: "max concurrent queries reached",
    },
    {
      doc: "Authentication service issues short-lived session credentials",
      query: "login session credential management",
    },
    {
      doc: "Build pipeline caches dependencies across runner stages",
      query: "ci runner artifact reuse",
    },
    {
      doc: "Rate limiter throttles abusive clients per ip address",
      query: "abuse prevention traffic shaping",
    },
    {
      doc: "Feature flags gate rollout of experimental capabilities",
      query: "progressive deployment canary release",
    },
    {
      doc: "Observability stack collects traces metrics and logs",
      query: "monitoring telemetry instrumentation",
    },
  ];
  for (let i = 0; i < 10; i++) {
    const { doc, query } = paraphrasePairs[i];
    const fact = makeFact(
      `target-para-${i}`,
      "UserPreference",
      i % 2 === 0 ? "preference" : "value",
      doc,
      0.88,
    );
    facts.push(fact);
    targets.push({ fact, query, type: "paraphrase" });
  }

  // --- 10 subject-only targets (query matches subject field, not object) ---
  // Subject field is weighted ×3 in BM25, so a subject-only match should surface.
  const subjectTargets = [
    { subject: "BillingService", query: "billing service" },
    { subject: "AuthService", query: "auth service" },
    { subject: "NotificationService", query: "notification service" },
    { subject: "SearchIndex", query: "search index" },
    { subject: "RateLimiter", query: "rate limiter" },
    { subject: "CircuitBreaker", query: "circuit breaker" },
    { subject: "MessageQueue", query: "message queue" },
    { subject: "ConfigManager", query: "config manager" },
    { subject: "HealthChecker", query: "health checker" },
    { subject: "AuditLogger", query: "audit logger" },
  ];
  for (let i = 0; i < 10; i++) {
    const { subject, query } = subjectTargets[i];
    const fact = makeFact(
      `target-subj-${i}`,
      subject,
      "endpoint",
      `Service endpoint handles operation ${i} with standard response cycle`,
      0.81,
    );
    facts.push(fact);
    targets.push({ fact, query, type: "subject" });
  }

  return { facts, targets };
}

// === Single-path rank extraction ===
// Call search() with topK = corpus size so no facts are truncated, then derive
// independent rankings for each path.

type PathRanks = {
  bm25: number | null;   // 1-indexed rank in BM25-only ordering
  vector: number | null; // 1-indexed rank in Vector-only ordering
  hybrid: number | null; // 1-indexed rank in Hybrid RRF ordering
};

function extractRanks(
  index: HybridSearchIndex,
  query: string,
  targetId: string,
  corpusSize: number,
): PathRanks {
  const hits = index.search(query, corpusSize);
  // BM25-only: sort by bm25Rank ascending (nulls last)
  const bm25Sorted = hits
    .filter((h) => h.bm25Rank !== null)
    .sort((a, b) => (a.bm25Rank! - b.bm25Rank!));
  // Vector-only: sort by vectorRank ascending
  const vectorSorted = hits
    .filter((h) => h.vectorRank !== null)
    .sort((a, b) => (a.vectorRank! - b.vectorRank!));
  // Hybrid: already sorted by rrfScore desc

  const bm25Rank = bm25Sorted.findIndex((h) => h.fact.factId === targetId);
  const vectorRank = vectorSorted.findIndex((h) => h.fact.factId === targetId);
  const hybridRank = hits.findIndex((h) => h.fact.factId === targetId);

  return {
    bm25: bm25Rank >= 0 ? bm25Rank + 1 : null,
    vector: vectorRank >= 0 ? vectorRank + 1 : null,
    hybrid: hybridRank >= 0 ? hybridRank + 1 : null,
  };
}

type PathMetrics = {
  recall1: number;
  recall3: number;
  recall5: number;
  recall10: number;
  mrr: number;
  ndcg10: number;
  latencyP50: number;
  latencyP95: number;
  latencyMean: number;
  hitCount: number;
  total: number;
};

function computePathMetrics(
  ranks: (number | null)[],
  latencies: number[],
): PathMetrics {
  const total = ranks.length;
  let r1 = 0, r3 = 0, r5 = 0, r10 = 0, hitCount = 0;
  let mrrSum = 0, ndcgSum = 0;
  for (const rank of ranks) {
    if (rank !== null) {
      hitCount++;
      if (rank <= 1) r1++;
      if (rank <= 3) r3++;
      if (rank <= 5) r5++;
      if (rank <= 10) r10++;
      mrrSum += 1 / rank;
      ndcgSum += ndcgAtK(rank, 10);
    }
  }
  return {
    recall1: pct(r1, total),
    recall3: pct(r3, total),
    recall5: pct(r5, total),
    recall10: pct(r10, total),
    mrr: total > 0 ? mrrSum / total : 0,
    ndcg10: total > 0 ? ndcgSum / total : 0,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    latencyMean: mean(latencies),
    hitCount,
    total,
  };
}

function runModuleBSinglePath() {
  const { facts, targets } = buildCorpusAndQueries();
  const corpusSize = facts.length;
  const index = new HybridSearchIndex(facts);

  // Warm up JIT
  index.search(targets[0].query, corpusSize);

  const allBm25Ranks: (number | null)[] = [];
  const allVectorRanks: (number | null)[] = [];
  const allHybridRanks: (number | null)[] = [];
  const bm25Latencies: number[] = [];
  const vectorLatencies: number[] = [];
  const hybridLatencies: number[] = [];

  // Per-query drilldown
  const perQuery: {
    type: QueryType;
    query: string;
    targetId: string;
    bm25: number | null;
    vector: number | null;
    hybrid: number | null;
    winner: "bm25" | "vector" | "hybrid" | "tie" | "none";
  }[] = [];

  // Per-category metrics
  const categories: QueryType[] = ["exact", "typo", "morph", "paraphrase", "subject"];
  const catBm25Ranks: Record<QueryType, (number | null)[]> = {
    exact: [], typo: [], morph: [], paraphrase: [], subject: [],
  };
  const catVectorRanks: Record<QueryType, (number | null)[]> = {
    exact: [], typo: [], morph: [], paraphrase: [], subject: [],
  };
  const catHybridRanks: Record<QueryType, (number | null)[]> = {
    exact: [], typo: [], morph: [], paraphrase: [], subject: [],
  };

  for (const target of targets) {
    // Measure full search latency (all three paths computed together)
    const start = performance.now();
    const ranks = extractRanks(index, target.query, target.fact.factId, corpusSize);
    const elapsed = performance.now() - start;

    allBm25Ranks.push(ranks.bm25);
    allVectorRanks.push(ranks.vector);
    allHybridRanks.push(ranks.hybrid);
    // The three paths share one search() call, so latency is attributed equally.
    bm25Latencies.push(elapsed);
    vectorLatencies.push(elapsed);
    hybridLatencies.push(elapsed);

    catBm25Ranks[target.type].push(ranks.bm25);
    catVectorRanks[target.type].push(ranks.vector);
    catHybridRanks[target.type].push(ranks.hybrid);

    // Determine winner (lowest rank wins; null = miss)
    const valid: { path: "bm25" | "vector" | "hybrid"; rank: number }[] = [];
    if (ranks.bm25 !== null) valid.push({ path: "bm25", rank: ranks.bm25 });
    if (ranks.vector !== null) valid.push({ path: "vector", rank: ranks.vector });
    if (ranks.hybrid !== null) valid.push({ path: "hybrid", rank: ranks.hybrid });
    let winner: "bm25" | "vector" | "hybrid" | "tie" | "none" = "none";
    if (valid.length > 0) {
      valid.sort((a, b) => a.rank - b.rank);
      const best = valid[0];
      const tied = valid.filter((v) => v.rank === best.rank);
      winner = tied.length > 1 ? "tie" : best.path;
    }

    perQuery.push({
      type: target.type,
      query: target.query,
      targetId: target.fact.factId,
      bm25: ranks.bm25,
      vector: ranks.vector,
      hybrid: ranks.hybrid,
      winner,
    });
  }

  const overall = {
    bm25: computePathMetrics(allBm25Ranks, bm25Latencies),
    vector: computePathMetrics(allVectorRanks, vectorLatencies),
    hybrid: computePathMetrics(allHybridRanks, hybridLatencies),
  };

  const byCategory = categories.map((cat) => ({
    category: cat,
    count: catBm25Ranks[cat].length,
    bm25: computePathMetrics(catBm25Ranks[cat], []),
    vector: computePathMetrics(catVectorRanks[cat], []),
    hybrid: computePathMetrics(catHybridRanks[cat], []),
  }));

  // RRF fusion analysis: where does Hybrid beat BOTH / lose to EITHER
  let hybridBeatsBoth = 0;
  let hybridBeatsBm25 = 0;
  let hybridBeatsVector = 0;
  let hybridLosesToEither = 0;
  let hybridLosesToBoth = 0;
  for (const q of perQuery) {
    const b = q.bm25;
    const v = q.vector;
    const h = q.hybrid;
    if (h === null) {
      if (b !== null || v !== null) hybridLosesToEither++;
      if (b !== null && v !== null) hybridLosesToBoth++;
      continue;
    }
    const beatsBm25 = b === null || h < b;
    const beatsVector = v === null || h < v;
    if (beatsBm25 && beatsVector) hybridBeatsBoth++;
    if (beatsBm25) hybridBeatsBm25++;
    if (beatsVector) hybridBeatsVector++;
    if (!beatsBm25 || !beatsVector) hybridLosesToEither++;
    if (!beatsBm25 && !beatsVector) hybridLosesToBoth++;
  }

  // Winner distribution
  const winnerCounts: Record<string, number> = {};
  for (const q of perQuery) {
    winnerCounts[q.winner] = (winnerCounts[q.winner] ?? 0) + 1;
  }

  return {
    corpusSize,
    totalQueries: targets.length,
    overall,
    byCategory,
    perQuery,
    fusionAnalysis: {
      hybridBeatsBoth,
      hybridBeatsBm25,
      hybridBeatsVector,
      hybridLosesToEither,
      hybridLosesToBoth,
    },
    winnerDistribution: winnerCounts,
  };
}

describe("Module B Single-Path Deep Test", () => {
  it("measures BM25-only / Vector-only / Hybrid independently and reports per-path metrics", () => {
    const r = runModuleBSinglePath();

    console.log("\n" + "=".repeat(90));
    console.log("  MODULE B SINGLE-PATH DEEP TEST — 独立路径评测");
    console.log("=".repeat(90));
    console.log(`  Corpus: ${r.corpusSize} facts | Queries: ${r.totalQueries} (5 categories × 10)`);
    console.log("=".repeat(90) + "\n");

    // --- Overall single-path metrics ---
    console.log("─".repeat(90));
    console.log("  OVERALL SINGLE-PATH METRICS (all 50 queries)");
    console.log("─".repeat(90));
    console.log("  Metric          |   BM25-only   |   Vector-only   |   Hybrid(RRF)");
    console.log("  ────────────────┼───────────────┼─────────────────┼──────────────");
    const o = r.overall;
    console.log(`  Recall@1        |  ${o.bm25.recall1.toFixed(1).padStart(5)}% (${o.bm25.recall1 > 0 ? "✓" : " "})  |  ${o.vector.recall1.toFixed(1).padStart(6)}%  |  ${o.hybrid.recall1.toFixed(1).padStart(6)}%`);
    console.log(`  Recall@3        |  ${o.bm25.recall3.toFixed(1).padStart(5)}%       |  ${o.vector.recall3.toFixed(1).padStart(6)}%  |  ${o.hybrid.recall3.toFixed(1).padStart(6)}%`);
    console.log(`  Recall@5        |  ${o.bm25.recall5.toFixed(1).padStart(5)}%       |  ${o.vector.recall5.toFixed(1).padStart(6)}%  |  ${o.hybrid.recall5.toFixed(1).padStart(6)}%`);
    console.log(`  Recall@10       |  ${o.bm25.recall10.toFixed(1).padStart(5)}%      |  ${o.vector.recall10.toFixed(1).padStart(6)}%  |  ${o.hybrid.recall10.toFixed(1).padStart(6)}%`);
    console.log(`  MRR             |  ${o.bm25.mrr.toFixed(4).padStart(7)}         |  ${o.vector.mrr.toFixed(4).padStart(8)}  |  ${o.hybrid.mrr.toFixed(4).padStart(8)}`);
    console.log(`  NDCG@10         |  ${o.bm25.ndcg10.toFixed(4).padStart(7)}        |  ${o.vector.ndcg10.toFixed(4).padStart(8)}  |  ${o.hybrid.ndcg10.toFixed(4).padStart(8)}`);
    console.log(`  Hit count       |  ${o.bm25.hitCount}/${o.bm25.total}        |  ${o.vector.hitCount}/${o.vector.total}          |  ${o.hybrid.hitCount}/${o.hybrid.total}`);
    console.log(`  Latency p50     |  ${o.bm25.latencyP50.toFixed(3).padStart(7)}ms   |  ${o.vector.latencyP50.toFixed(3).padStart(8)}ms |  ${o.hybrid.latencyP50.toFixed(3).padStart(7)}ms`);
    console.log(`  Latency p95     |  ${o.bm25.latencyP95.toFixed(3).padStart(7)}ms   |  ${o.vector.latencyP95.toFixed(3).padStart(8)}ms |  ${o.hybrid.latencyP95.toFixed(3).padStart(7)}ms`);
    console.log("");

    // --- Per-category breakdown ---
    console.log("─".repeat(90));
    console.log("  PER-CATEGORY BREAKDOWN");
    console.log("─".repeat(90));
    for (const cat of r.byCategory) {
      console.log(`\n  [${cat.category.toUpperCase()}] (${cat.count} queries)`);
      console.log(`    Recall@5:  BM25=${cat.bm25.recall5.toFixed(1)}%  Vector=${cat.vector.recall5.toFixed(1)}%  Hybrid=${cat.hybrid.recall5.toFixed(1)}%`);
      console.log(`    Recall@10: BM25=${cat.bm25.recall10.toFixed(1)}%  Vector=${cat.vector.recall10.toFixed(1)}%  Hybrid=${cat.hybrid.recall10.toFixed(1)}%`);
      console.log(`    MRR:       BM25=${cat.bm25.mrr.toFixed(3)}  Vector=${cat.vector.mrr.toFixed(3)}  Hybrid=${cat.hybrid.mrr.toFixed(3)}`);
      console.log(`    Hits:      BM25=${cat.bm25.hitCount}/${cat.count}  Vector=${cat.vector.hitCount}/${cat.count}  Hybrid=${cat.hybrid.hitCount}/${cat.count}`);
    }
    console.log("");

    // --- Per-query drilldown ---
    console.log("─".repeat(90));
    console.log("  PER-QUERY DRILLDOWN (rank position of target; null = MISS)");
    console.log("─".repeat(90));
    console.log("  Type        | Query                                    | BM25  | Vector | Hybrid | Winner");
    console.log("  ────────────┼──────────────────────────────────────────┼───────┼────────┼────────┼───────");
    for (const q of r.perQuery) {
      const bm25Str = q.bm25 === null ? "MISS" : String(q.bm25).padStart(3);
      const vecStr = q.vector === null ? "MISS" : String(q.vector).padStart(4);
      const hybStr = q.hybrid === null ? "MISS" : String(q.hybrid).padStart(4);
      const qStr = q.query.length > 40 ? q.query.slice(0, 37) + "..." : q.query.padEnd(40);
      console.log(`  ${q.type.padEnd(11)} | ${qStr} | ${bm25Str}  | ${vecStr}  | ${hybStr}  | ${q.winner}`);
    }
    console.log("");

    // --- RRF fusion analysis ---
    console.log("─".repeat(90));
    console.log("  RRF FUSION ANALYSIS");
    console.log("─".repeat(90));
    const fa = r.fusionAnalysis;
    console.log(`  Hybrid beats BOTH single paths:   ${fa.hybridBeatsBoth}/${r.totalQueries}`);
    console.log(`  Hybrid beats BM25-only:           ${fa.hybridBeatsBm25}/${r.totalQueries}`);
    console.log(`  Hybrid beats Vector-only:         ${fa.hybridBeatsVector}/${r.totalQueries}`);
    console.log(`  Hybrid loses to EITHER path:      ${fa.hybridLosesToEither}/${r.totalQueries}`);
    console.log(`  Hybrid loses to BOTH paths:       ${fa.hybridLosesToBoth}/${r.totalQueries}`);
    console.log(`  Winner distribution:              ${JSON.stringify(r.winnerDistribution)}`);
    console.log("");

    // --- Verdict ---
    console.log("=".repeat(90));
    console.log("  VERDICT");
    console.log("=".repeat(90));
    const hybridVsBm25Delta = o.hybrid.recall5 - o.bm25.recall5;
    const hybridVsVectorDelta = o.hybrid.recall5 - o.vector.recall5;
    console.log(`  Hybrid vs BM25-only:    Recall@5 Δ=${hybridVsBm25Delta >= 0 ? "+" : ""}${hybridVsBm25Delta.toFixed(1)}pp  MRR Δ=${(o.hybrid.mrr - o.bm25.mrr).toFixed(4)}`);
    console.log(`  Hybrid vs Vector-only:  Recall@5 Δ=${hybridVsVectorDelta >= 0 ? "+" : ""}${hybridVsVectorDelta.toFixed(1)}pp  MRR Δ=${(o.hybrid.mrr - o.vector.mrr).toFixed(4)}`);
    if (o.hybrid.mrr < o.vector.mrr) {
      console.log(`  ⚠ RRF fusion HURTS MRR vs Vector-only (${o.hybrid.mrr.toFixed(4)} < ${o.vector.mrr.toFixed(4)})`);
      console.log(`    → k=60 symmetric RRF dilutes strong vector signals with weak BM25 ranks.`);
      console.log(`    → Consider weighted RRF or conditional fusion when one path dominates.`);
    }
    if (o.hybrid.recall5 > o.bm25.recall5 && o.hybrid.recall5 > o.vector.recall5) {
      console.log(`  ✓ RRF fusion improves Recall@5 over BOTH single paths.`);
    } else if (o.hybrid.recall5 > o.bm25.recall5) {
      console.log(`  ~ RRF fusion improves Recall@5 over BM25-only but NOT over Vector-only.`);
    }
    console.log("=".repeat(90) + "\n");
  });
});
