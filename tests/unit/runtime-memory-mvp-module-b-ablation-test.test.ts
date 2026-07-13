// @vitest-environment node
// Module B Ablation Test: Runs 21 fusion variants against the same 60-query
// corpus and compares Recall@K, MRR, NDCG, fusion win rate, and MRR
// degradation. Selects the best variant that satisfies the no-harm constraint
// (Hybrid MRR ≥ Vector-only MRR, Recall@5 ≥ Vector-only Recall@5).
//
// Variants W7-W10 use per-query conditional fusion: detect top-1 disagreement
// between BM25 and Vector paths, then select the dominant path for the ENTIRE
// query (zero out the other path's weight). This avoids the per-fact scoring
// imbalance that broke W2/W4/W5/W6 (conditionalAlpha).
//
// Variants W11-W14 use normalized RRF: divide the RRF sum by the number of
// paths that found each fact, eliminating the unfair double-weight advantage
// that dual-path noise facts get under classic sum RRF.
//
// Variants W15-W17 use normalized RRF with very low k (0/1/3): amplifies rank
// gaps so single-path #1 (score=1.0) clearly beats dual-path #1/#2 (0.75),
// preventing noise from pushing single-path targets down.

import { describe, it } from "vitest";
import {
  HybridSearchIndex,
  type HybridSearchFusionOptions,
} from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

// === Helpers ===

function pct(n: number, total: number): number {
  return total > 0 ? (n / total) * 100 : 0;
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

// === Corpus & Queries ===

type QueryType = "exact" | "typo" | "morph" | "paraphrase" | "subject" | "hard-para";
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
      `noise-${i}`, d, p,
      `${d} detail ${i}: ${t} configuration value ${i % 100} with token alpha${i % 17}`,
      0.6 + (i % 10) * 0.03,
    ));
  }

  // --- 10 exact-term targets ---
  const errorCodes = [
    "ERR_TS_2345", "AUTH_TOKEN_7723", "ERR_GATEWAY_5001",
    "ECONNREFUSED_61", "SQLITE_BUSY_5", "ERR_ESLINT_9001",
    "AUTH_EXPIRED_4401", "ERR_VITE_3002", "EACCES_13", "ERR_NODE_404",
  ];
  for (let i = 0; i < 10; i++) {
    const code = errorCodes[i];
    const fact = makeFact(`target-exact-${i}`, "CodeError", "error_code",
      `Error ${code} rejected upstream request with signature mismatch in module ${i}`, 0.92);
    facts.push(fact);
    targets.push({ fact, query: `${code} error signature`, type: "exact" });
  }

  // --- 10 typo targets ---
  const typoPairs = [
    { doc: "neovim", query: "neovm" }, { doc: "typescript", query: "typescrip" },
    { doc: "eslint", query: "eslit" }, { doc: "prettier", query: "prettir" },
    { doc: "vitest", query: "vitst" }, { doc: "pnpm", query: "pnp" },
    { doc: "node22", query: "node2" }, { doc: "github", query: "githb" },
    { doc: "react19", query: "reac19" }, { doc: "webpack5", query: "webpak5" },
  ];
  for (let i = 0; i < 10; i++) {
    const { doc, query } = typoPairs[i];
    const fact = makeFact(`target-typo-${i}`, "ToolUsage", "invocation",
      `Tool ${doc} invoked with arguments for build pipeline stage ${i}`, 0.85);
    facts.push(fact);
    targets.push({ fact, query: `${query} tool build pipeline`, type: "typo" });
  }

  // --- 10 morphological targets ---
  const morphPairs = [
    { doc: "editing", query: "editor" }, { doc: "validation", query: "validator" },
    { doc: "configuration", query: "configure" }, { doc: "deployment", query: "deploy" },
    { doc: "authentication", query: "authenticate" }, { doc: "optimization", query: "optimize" },
    { doc: "serialization", query: "serialize" }, { doc: "migration", query: "migrate" },
    { doc: "compilation", query: "compile" }, { doc: "execution", query: "execute" },
  ];
  for (let i = 0; i < 10; i++) {
    const { doc, query } = morphPairs[i];
    const fact = makeFact(`target-morph-${i}`, "ProjectFact", "value",
      `Project uses ${doc} pipeline for stage ${i} processing`, 0.84);
    facts.push(fact);
    targets.push({ fact, query: `${query} pipeline stage processing`, type: "morph" });
  }

  // --- 10 paraphrase targets ---
  const paraphrasePairs = [
    { doc: "User chose neovim as daily editing application", query: "preferred editor person" },
    { doc: "User picked vitest as primary validation library", query: "preferred javascript testing framework alternatives" },
    { doc: "System utilizes redis for in-memory caching layer", query: "cache infrastructure distributed storage" },
    { doc: "Gateway rejects malformed requests with code four hundred", query: "bad request handler validation" },
    { doc: "Database connection pool exhausted during peak traffic", query: "max concurrent queries reached" },
    { doc: "Authentication service issues short-lived session credentials", query: "login session credential management" },
    { doc: "Build pipeline caches dependencies across runner stages", query: "ci runner artifact reuse" },
    { doc: "Rate limiter throttles abusive clients per ip address", query: "abuse prevention traffic shaping" },
    { doc: "Feature flags gate rollout of experimental capabilities", query: "progressive deployment canary release" },
    { doc: "Observability stack collects traces metrics and logs", query: "monitoring telemetry instrumentation" },
  ];
  for (let i = 0; i < 10; i++) {
    const { doc, query } = paraphrasePairs[i];
    const fact = makeFact(`target-para-${i}`, "UserPreference",
      i % 2 === 0 ? "preference" : "value", doc, 0.88);
    facts.push(fact);
    targets.push({ fact, query, type: "paraphrase" });
  }

  // --- 10 subject-only targets ---
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
    const fact = makeFact(`target-subj-${i}`, subject, "endpoint",
      `Service endpoint handles operation ${i} with standard response cycle`, 0.81);
    facts.push(fact);
    targets.push({ fact, query, type: "subject" });
  }

  // --- 10 hard-paraphrase targets (zero word overlap, tests semantic gap) ---
  const hardParaPairs = [
    { doc: "Gateway timed out waiting for upstream proxy response", query: "reverse proxy deadline exceeded" },
    { doc: "Database migration failed on foreign key constraint violation", query: "schema upgrade error relation reference" },
    { doc: "Load balancer health check marked instance as unhealthy", query: "traffic distributor probe detected failure" },
    { doc: "Redis pubsub channel reached maximum subscriber limit", query: "message broker topic capacity exceeded" },
    { doc: "Kubernetes pod evicted due to memory pressure on node", query: "container orchestration resource starvation" },
    { doc: "TLS certificate expired for production api domain", query: "secure transport credential renewal overdue" },
    { doc: "Garbage collector pause exceeded two hundred milliseconds", query: "memory reclamation stop the world latency" },
    { doc: "Circuit breaker opened after five consecutive failures", query: "fault tolerance threshold tripped protection" },
    { doc: "OAuth flow redirected to error page with invalid state", query: "delegated auth callback mismatch abort" },
    { doc: "Thread pool queue depth exceeded one thousand tasks", query: "concurrent worker backlog overflow pending" },
  ];
  for (let i = 0; i < 10; i++) {
    const { doc, query } = hardParaPairs[i];
    const fact = makeFact(`target-hard-${i}`, "SystemConfig", "stack", doc, 0.86);
    facts.push(fact);
    targets.push({ fact, query, type: "hard-para" });
  }

  return { facts, targets };
}

// === Variant definitions ===

type Variant = {
  name: string;
  short: string;
  fusion: HybridSearchFusionOptions;
};

const variants: Variant[] = [
  { name: "Baseline (k=60, symmetric)", short: "Base", fusion: {} },
  { name: "W1: Weighted (w_vec=0.7)", short: "W1", fusion: { wBm25: 0.3, wVector: 0.7 } },
  { name: "W2: Conditional (α=3,β=3)", short: "W2", fusion: { conditionalAlpha: 3, conditionalBeta: 3 } },
  { name: "W3: Low k (k=20)", short: "W3", fusion: { rrfK: 20 } },
  { name: "W4: Combined (k=20,w,α3β3)", short: "W4", fusion: { rrfK: 20, wBm25: 0.3, wVector: 0.7, conditionalAlpha: 3, conditionalBeta: 3 } },
  { name: "W5: Aggressive cond (α=1,β=3)", short: "W5", fusion: { conditionalAlpha: 1, conditionalBeta: 3 } },
  { name: "W6: Combined aggressive", short: "W6", fusion: { rrfK: 20, wBm25: 0.3, wVector: 0.7, conditionalAlpha: 1, conditionalBeta: 3 } },
  // Per-query conditional fusion variants — select dominant path for the ENTIRE
  // query based on top-1 agreement, avoiding per-fact scoring imbalance.
  { name: "W7: PerQuery (K=5, vector tie)", short: "W7", fusion: { perQueryConditional: true, perQueryK: 5, perQueryTieBreak: "vector" } },
  { name: "W8: PerQuery+Weighted (K=5,w_vec=0.7)", short: "W8", fusion: { wBm25: 0.3, wVector: 0.7, perQueryConditional: true, perQueryK: 5, perQueryTieBreak: "vector" } },
  { name: "W9: PerQuery+LowK (K=3,k=20)", short: "W9", fusion: { rrfK: 20, perQueryConditional: true, perQueryK: 3, perQueryTieBreak: "vector" } },
  { name: "W10: PerQuery K=10 (looser agree)", short: "W10", fusion: { perQueryConditional: true, perQueryK: 10, perQueryTieBreak: "vector" } },
  // Normalized RRF variants — divide RRF sum by path count so single-path
  // matches (typos, morph) aren't pushed out by dual-path noise facts that
  // get unfair double-weight under classic sum RRF.
  { name: "W11: Normalized RRF", short: "W11", fusion: { normalizeByPathCount: true } },
  { name: "W12: Normalized+Weighted", short: "W12", fusion: { normalizeByPathCount: true, wBm25: 0.3, wVector: 0.7 } },
  { name: "W13: Normalized+LowK", short: "W13", fusion: { normalizeByPathCount: true, rrfK: 20 } },
  { name: "W14: Norm+PerQuery", short: "W14", fusion: { normalizeByPathCount: true, perQueryConditional: true, perQueryK: 5, perQueryTieBreak: "vector" } },
  // Low-k + normalized: k=0 or k=1 amplifies rank gaps so single-path #1
  // (score=1.0) clearly beats dual-path #1/#2 (score=0.75), preventing noise
  // from pushing single-path targets down.
  { name: "W15: Norm+k=0", short: "W15", fusion: { normalizeByPathCount: true, rrfK: 0 } },
  { name: "W16: Norm+k=1", short: "W16", fusion: { normalizeByPathCount: true, rrfK: 1 } },
  { name: "W17: Norm+k=3", short: "W17", fusion: { normalizeByPathCount: true, rrfK: 3 } },
  // Vector-primary: k=0 + normalize + asymmetric weights. Vector gap (1.0 vs
  // 0.5) exceeds BM25 boost, so Vector #1 always beats Vector #2. BM25 can
  // only boost agreed facts between adjacent Vector ranks.
  { name: "W18: k=0,Norm,wB=.3", short: "W18", fusion: { normalizeByPathCount: true, rrfK: 0, wBm25: 0.3, wVector: 1.0 } },
  { name: "W19: k=0,Norm,wB=.5", short: "W19", fusion: { normalizeByPathCount: true, rrfK: 0, wBm25: 0.5, wVector: 1.0 } },
  { name: "W20: k=1,Norm,wB=.3", short: "W20", fusion: { normalizeByPathCount: true, rrfK: 1, wBm25: 0.3, wVector: 1.0 } },
];

// === Rank extraction ===

type PathRanks = { bm25: number | null; vector: number | null; hybrid: number | null };

function extractRanks(
  index: HybridSearchIndex,
  query: string,
  targetId: string,
  corpusSize: number,
  fusion?: HybridSearchFusionOptions,
): PathRanks {
  const hits = index.search(query, corpusSize, fusion);
  const bm25Sorted = hits
    .filter((h) => h.bm25Rank !== null)
    .sort((a, b) => (a.bm25Rank! - b.bm25Rank!));
  const vectorSorted = hits
    .filter((h) => h.vectorRank !== null)
    .sort((a, b) => (a.vectorRank! - b.vectorRank!));

  const bm25Rank = bm25Sorted.findIndex((h) => h.fact.factId === targetId);
  const vectorRank = vectorSorted.findIndex((h) => h.fact.factId === targetId);
  const hybridRank = hits.findIndex((h) => h.fact.factId === targetId);

  return {
    bm25: bm25Rank >= 0 ? bm25Rank + 1 : null,
    vector: vectorRank >= 0 ? vectorRank + 1 : null,
    hybrid: hybridRank >= 0 ? hybridRank + 1 : null,
  };
}

// === Metrics ===

type Metrics = {
  recall1: number; recall3: number; recall5: number; recall10: number;
  mrr: number; ndcg10: number;
  hitCount: number; total: number;
  latencyP50: number; latencyP95: number;
};

function computeMetrics(ranks: (number | null)[], latencies: number[]): Metrics {
  const total = ranks.length;
  let r1 = 0, r3 = 0, r5 = 0, r10 = 0, hits = 0, mrrSum = 0, ndcgSum = 0;
  for (const rank of ranks) {
    if (rank !== null) {
      hits++;
      if (rank <= 1) r1++;
      if (rank <= 3) r3++;
      if (rank <= 5) r5++;
      if (rank <= 10) r10++;
      mrrSum += 1 / rank;
      ndcgSum += ndcgAtK(rank, 10);
    }
  }
  return {
    recall1: pct(r1, total), recall3: pct(r3, total),
    recall5: pct(r5, total), recall10: pct(r10, total),
    mrr: total > 0 ? mrrSum / total : 0,
    ndcg10: total > 0 ? ndcgSum / total : 0,
    hitCount: hits, total,
    latencyP50: percentile(latencies, 50), latencyP95: percentile(latencies, 95),
  };
}

// === Main ===

function runAblation() {
  const { facts, targets } = buildCorpusAndQueries();
  const corpusSize = facts.length;
  const index = new HybridSearchIndex(facts);

  // Warm up
  index.search(targets[0].query, corpusSize);

  // Extract BM25-only and Vector-only rankings once (same for all variants)
  const bm25Ranks: (number | null)[] = [];
  const vectorRanks: (number | null)[] = [];
  for (const target of targets) {
    const ranks = extractRanks(index, target.query, target.fact.factId, corpusSize);
    bm25Ranks.push(ranks.bm25);
    vectorRanks.push(ranks.vector);
  }
  const bm25Metrics = computeMetrics(bm25Ranks, []);
  const vectorMetrics = computeMetrics(vectorRanks, []);

  // Run each variant
  const variantResults: {
    variant: Variant;
    metrics: Metrics;
    fusionWins: number;
    mrrDegradation: number;
    perCategory: Record<string, Metrics>;
  }[] = [];

  for (const variant of variants) {
    const hybridRanks: (number | null)[] = [];
    const latencies: number[] = [];
    let fusionWins = 0;
    let mrrDegradation = 0;

    // Per-category tracking
    const catRanks: Record<string, (number | null)[]> = {};

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const start = performance.now();
      const ranks = extractRanks(index, target.query, target.fact.factId, corpusSize, variant.fusion);
      latencies.push(performance.now() - start);
      hybridRanks.push(ranks.hybrid);

      // Fusion win: Hybrid beats both single paths
      const b = bm25Ranks[i];
      const v = vectorRanks[i];
      const h = ranks.hybrid;
      if (h !== null) {
        const beatsBm25 = b === null || h < b;
        const beatsVector = v === null || h < v;
        if (beatsBm25 && beatsVector) fusionWins++;
        if (v !== null && h > v) mrrDegradation++;
      } else {
        if (b !== null || v !== null) mrrDegradation++;
      }

      // Category tracking
      const cat = target.type;
      if (!catRanks[cat]) catRanks[cat] = [];
      catRanks[cat].push(ranks.hybrid);
    }

    const metrics = computeMetrics(hybridRanks, latencies);
    const perCategory: Record<string, Metrics> = {};
    for (const [cat, ranks] of Object.entries(catRanks)) {
      perCategory[cat] = computeMetrics(ranks, []);
    }

    variantResults.push({ variant, metrics, fusionWins, mrrDegradation, perCategory });
  }

  return {
    corpusSize,
    totalQueries: targets.length,
    bm25Baseline: bm25Metrics,
    vectorBaseline: vectorMetrics,
    variantResults,
  };
}

describe("Module B Ablation Test", () => {
  it("compares 21 fusion variants and selects the best", () => {
    const r = runAblation();

    console.log("\n" + "=".repeat(100));
    console.log("  MODULE B ABLATION TEST — 21 Fusion Variants × 60 Queries");
    console.log("=".repeat(100));
    console.log(`  Corpus: ${r.corpusSize} facts | Queries: ${r.totalQueries} (exact:10, typo:10, morph:10, paraphrase:10, subject:10, hard-para:10)`);
    console.log("=".repeat(100) + "\n");

    // --- Single-path baselines ---
    console.log("─".repeat(100));
    console.log("  SINGLE-PATH BASELINES");
    console.log("─".repeat(100));
    const b = r.bm25Baseline;
    const v = r.vectorBaseline;
    console.log(`  BM25-only:    Recall@1=${b.recall1.toFixed(1)}%  Recall@5=${b.recall5.toFixed(1)}%  Recall@10=${b.recall10.toFixed(1)}%  MRR=${b.mrr.toFixed(4)}  NDCG=${b.ndcg10.toFixed(4)}  Hits=${b.hitCount}/${b.total}`);
    console.log(`  Vector-only:  Recall@1=${v.recall1.toFixed(1)}%  Recall@5=${v.recall5.toFixed(1)}%  Recall@10=${v.recall10.toFixed(1)}%  MRR=${v.mrr.toFixed(4)}  NDCG=${v.ndcg10.toFixed(4)}  Hits=${v.hitCount}/${v.total}`);
    console.log(`  → No-harm constraint: Hybrid MRR ≥ ${v.mrr.toFixed(4)} (Vector), Recall@5 ≥ ${v.recall5.toFixed(1)}%`);
    console.log("");

    // --- Variant comparison ---
    console.log("─".repeat(100));
    console.log("  VARIANT COMPARISON");
    console.log("─".repeat(100));
    console.log("  Variant | R@1     | R@3     | R@5     | R@10    | MRR     | NDCG    | Wins  | Degrad | p95ms  | No-harm");
    console.log("  ────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼───────┼────────┼────────┼───────");

    for (const vr of r.variantResults) {
      const m = vr.metrics;
      const noHarmMrr = m.mrr >= v.mrr - 0.001;
      const noHarmRecall = m.recall5 >= v.recall5 - 0.1;
      const noHarm = noHarmMrr && noHarmRecall;
      console.log(
        `  ${vr.variant.short.padEnd(7)} | ${m.recall1.toFixed(1).padStart(5)}%  | ${m.recall3.toFixed(1).padStart(5)}%  | ${m.recall5.toFixed(1).padStart(5)}%  | ${m.recall10.toFixed(1).padStart(5)}%  | ${m.mrr.toFixed(4).padStart(7)} | ${m.ndcg10.toFixed(4).padStart(7)} | ${String(vr.fusionWins).padStart(5)}  | ${String(vr.mrrDegradation).padStart(6)}  | ${m.latencyP95.toFixed(2).padStart(6)} | ${noHarm ? "✓" : "✗"}`,
      );
    }
    console.log("");

    // --- Per-category breakdown for each variant ---
    const categories = ["exact", "typo", "morph", "paraphrase", "subject", "hard-para"];
    console.log("─".repeat(100));
    console.log("  PER-CATEGORY MRR (by variant)");
    console.log("─".repeat(100));
    console.log(`  Category     | ${variants.map((v) => v.short.padStart(7)).join(" | ")}`);
    console.log(`  ─────────────┼${variants.map(() => "─────────").join("┼")}`);
    for (const cat of categories) {
      const vals = r.variantResults.map((vr) => {
        const m = vr.perCategory[cat];
        return m ? m.mrr.toFixed(3).padStart(7) : "  N/A  ";
      });
      console.log(`  ${cat.padEnd(12)} | ${vals.join(" | ")}`);
    }
    console.log("");

    // --- Per-category Recall@5 ---
    console.log("─".repeat(100));
    console.log("  PER-CATEGORY Recall@5 (by variant)");
    console.log("─".repeat(100));
    console.log(`  Category     | ${variants.map((v) => v.short.padStart(7)).join(" | ")}`);
    console.log(`  ─────────────┼${variants.map(() => "─────────").join("┼")}`);
    for (const cat of categories) {
      const vals = r.variantResults.map((vr) => {
        const m = vr.perCategory[cat];
        return m ? m.recall5.toFixed(1).padStart(6) + "%" : "  N/A  ";
      });
      console.log(`  ${cat.padEnd(12)} | ${vals.join(" | ")}`);
    }
    console.log("");

    // --- Select best variant ---
    console.log("=".repeat(100));
    console.log("  SELECTION");
    console.log("=".repeat(100));
    const eligible = r.variantResults.filter((vr) => {
      const m = vr.metrics;
      return m.mrr >= v.mrr - 0.001 && m.recall5 >= v.recall5 - 0.1;
    });
    if (eligible.length === 0) {
      console.log("  ⚠ No variant satisfies no-harm constraint. Best MRR variant:");
      const best = [...r.variantResults].sort((a, b) => b.metrics.mrr - a.metrics.mrr)[0];
      console.log(`    ${best.variant.name}: MRR=${best.metrics.mrr.toFixed(4)} (target: ${v.mrr.toFixed(4)})`);
    } else {
      const best = [...eligible].sort((a, b) => b.metrics.mrr - a.metrics.mrr)[0];
      console.log(`  ✓ Best no-harm variant: ${best.variant.name}`);
      console.log(`    MRR=${best.metrics.mrr.toFixed(4)} (Vector baseline: ${v.mrr.toFixed(4)}, Δ=${(best.metrics.mrr - v.mrr).toFixed(4)})`);
      console.log(`    Recall@5=${best.metrics.recall5.toFixed(1)}% (Vector baseline: ${v.recall5.toFixed(1)}%, Δ=${(best.metrics.recall5 - v.recall5).toFixed(1)}pp)`);
      console.log(`    NDCG@10=${best.metrics.ndcg10.toFixed(4)} (Vector baseline: ${v.ndcg10.toFixed(4)})`);
      console.log(`    Fusion wins=${best.fusionWins}/${r.totalQueries}, MRR degradation=${best.mrrDegradation}/${r.totalQueries}`);
      console.log(`    Latency p95=${best.metrics.latencyP95.toFixed(2)}ms`);
      console.log(`    Fusion params: ${JSON.stringify(best.variant.fusion)}`);
    }
    console.log("=".repeat(100) + "\n");
  });
});
