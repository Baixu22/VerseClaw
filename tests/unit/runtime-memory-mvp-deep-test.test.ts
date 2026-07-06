// @vitest-environment node
// MVP Deep Test: Quantifies the real-world benefit of all 4 modules (A/B/C/D)
// against realistic corpora. Outputs a structured JSON report to stdout.
//
// This is NOT a pass/fail unit test — it's a measurement script that happens
// to run inside vitest for TypeScript transpilation. The single `it` block
// runs all 4 module measurements and prints results.

import { describe, it } from "vitest";
import {
  decideAUDN,
  DEFAULT_WRITE_CURATION_CONFIG,
} from "../../openclaw_runtime/src/runtime-core/memory-write-curation";
import {
  hybridSearchFacts,
  HybridSearchIndex,
} from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import { RuntimeMemoryStore } from "../../openclaw_runtime/src/runtime-core/memory-store";
import {
  buildRuntimeMemoryTemporalFactFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  type RuntimeMemoryTemporalFact,
  type RuntimeMemoryTemporalFactCandidate,
} from "../../openclaw_runtime/src/runtime-core/memory-context";
import {
  computeMaturityScore,
  buildAllPassScenario,
  DIMENSION_WEIGHTS,
} from "./helpers/runtime-memory-maturity-score";

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

// === Module A: AUDN Write Curation ===
// Simulate 300 incoming candidates: 100 unique, 50 exact duplicates,
// 80 semantic near-duplicates (paraphrased), 70 genuinely new.
// Measure ADD / NONE / UPDATE distribution and storage savings.

type AUDNAction = "ADD" | "NONE" | "UPDATE";

function runModuleA() {
  const subjects = [
    "UserPreference", "CodeError", "SystemConfig", "ProjectFact",
    "ToolUsage", "ApiContract", "TestData", "EnvironmentFact",
  ];
  const predicates = [
    "preference", "error_code", "value", "stack", "invocation",
    "endpoint", "fixture", "variable",
  ];
  const objectTemplates = [
    "User prefers {x} as default {y} tool",
    "Error {x} occurs when {y} type mismatch",
    "System config {x} set to {y} for production",
    "Project uses {x} version {y} in dependencies",
    "Tool {x} invoked with {y} arguments",
    "API {x} returns {y} on success",
    "Test fixture {x} covers {y} edge case",
    "EnvConfig {x} points to {y} directory",
  ];
  const fillers = ["pnpm", "vitest", "neovim", "typescript", "node22", "eslint", "prettier", "github"];

  function makeCandidate(
    id: string,
    subject: string,
    predicate: string,
    objectSummary: string,
    confidence: number = 0.8,
  ): RuntimeMemoryTemporalFactCandidate {
    return buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: id,
      subject,
      predicate,
      objectSummary,
      confidence,
      valid_at: 100,
      reference_time: 100,
    });
  }

  function makeVerified(
    id: string,
    subject: string,
    predicate: string,
    objectSummary: string,
    confidence: number = 0.85,
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

  // Seed with 50 verified facts as the "existing" store
  const existingFacts: RuntimeMemoryTemporalFact[] = [];
  for (let i = 0; i < 50; i++) {
    const subj = subjects[i % subjects.length];
    const pred = predicates[i % predicates.length];
    const obj = objectTemplates[i % objectTemplates.length]
      .replace("{x}", fillers[i % fillers.length])
      .replace("{y}", fillers[(i + 3) % fillers.length]);
    existingFacts.push(makeVerified(`seed-${i}`, subj, pred, obj, 0.8));
  }

  // Build 300 candidates
  const candidates: RuntimeMemoryTemporalFactCandidate[] = [];

  // 100 unique (genuinely new subjects/predicates combos)
  for (let i = 0; i < 100; i++) {
    candidates.push(makeCandidate(
      `new-${i}`,
      subjects[i % subjects.length],
      predicates[(i + 2) % predicates.length],
      `Unique fact #${i}: ${fillers[i % fillers.length]} config detail ${i}`,
      0.75 + (i % 5) * 0.04,
    ));
  }

  // 50 exact duplicates (same subject+predicate+normalized objectSummary as seeds)
  for (let i = 0; i < 50; i++) {
    const seed = existingFacts[i % 50];
    candidates.push(makeCandidate(
      `dup-${i}`,
      seed.subject,
      seed.predicate,
      seed.objectSummary,
      0.7 + (i % 3) * 0.08,
    ));
  }

  // 80 semantic near-duplicates (same subject+predicate, paraphrased objectSummary)
  for (let i = 0; i < 80; i++) {
    const seed = existingFacts[i % 50];
    // Paraphrase: same meaning, different wording
    const paraphrased = seed.objectSummary
      .replace("prefers", "chose")
      .replace("occurs when", "happens if")
      .replace("set to", "configured as")
      .replace("uses", "depends on")
      .replace("invoked with", "called using")
      .replace("returns", "responds with")
      .replace("covers", "validates")
      .replace("points to", "references");
    candidates.push(makeCandidate(
      `paraph-${i}`,
      seed.subject,
      seed.predicate,
      paraphrased,
      0.65 + (i % 4) * 0.08,
    ));
  }

  // 70 genuinely new
  for (let i = 0; i < 70; i++) {
    candidates.push(makeCandidate(
      `fresh-${i}`,
      subjects[(i + 4) % subjects.length],
      predicates[(i + 1) % predicates.length],
      `Fresh fact #${i}: ${fillers[(i + 2) % fillers.length]} detail variant ${i}`,
      0.7 + (i % 6) * 0.05,
    ));
  }

  // Run AUDN against accumulating fact set
  const accumulated = [...existingFacts];
  const actionCounts: Record<AUDNAction, number> = { ADD: 0, NONE: 0, UPDATE: 0 };
  const noneReasons: Record<string, number> = {};
  let supersededCount = 0;

  for (const candidate of candidates) {
    const decision = decideAUDN(candidate, accumulated, DEFAULT_WRITE_CURATION_CONFIG);
    actionCounts[decision.action]++;
    if (decision.action === "NONE") {
      const reason = decision.reason;
      noneReasons[reason] = (noneReasons[reason] ?? 0) + 1;
    }
    if (decision.action === "UPDATE" && decision.supersedes) {
      supersededCount++;
      // Remove superseded fact, add the candidate as a new fact
      const idx = accumulated.findIndex((f) => f.factId === decision.supersedes);
      if (idx !== -1) accumulated.splice(idx, 1);
      accumulated.push(makeVerified(
        candidate.factId,
        candidate.subject,
        candidate.predicate,
        candidate.objectSummary,
        candidate.confidence,
      ));
    }
    if (decision.action === "ADD") {
      accumulated.push(makeVerified(
        candidate.factId,
        candidate.subject,
        candidate.predicate,
        candidate.objectSummary,
        candidate.confidence,
      ));
    }
  }

  const totalCandidates = candidates.length;
  const dedupRate = pct(actionCounts.NONE + actionCounts.UPDATE, totalCandidates);
  const storageSavings = actionCounts.NONE; // facts NOT written to store

  return {
    module: "A: AUDN Write Curation",
    totalCandidates,
    existingFacts: existingFacts.length,
    actionDistribution: actionCounts,
    noneReasonBreakdown: noneReasons,
    supersededCount,
    dedupRate: Number(dedupRate.toFixed(2)),
    storageSavings,
    factsAfterCuration: accumulated.length,
    factsWithoutCuration: existingFacts.length + totalCandidates,
    metrics: {
      dedupRate: `${dedupRate.toFixed(1)}%`,
      storageReduction: `${pct(storageSavings, existingFacts.length + totalCandidates).toFixed(1)}%`,
      updateRate: `${pct(actionCounts.UPDATE, totalCandidates).toFixed(1)}%`,
    },
  };
}

// === Module B: Hybrid Retrieval ===
// Build 500-fact corpus, run 60 queries (30 exact + 30 paraphrase).
// Compare BM25-only vs vector-only vs hybrid RRF: recall@5, MRR, latency.

function runModuleB() {
  const domains = [
    "UserPreference", "CodeError", "SystemConfig", "ProjectFact",
    "ToolUsage", "ApiContract", "TestData", "EnvironmentFact",
  ];
  const predicates = [
    "preference", "error_code", "value", "stack", "invocation",
    "endpoint", "fixture", "variable",
  ];
  const tools = ["pnpm", "vitest", "neovim", "typescript", "node22", "eslint", "prettier", "github"];
  const errorCodes = ["ERR_TS_2345", "AUTH_TOKEN_7723", "ERR_GATEWAY_5001", "ECONNREFUSED_61", "SQLITE_BUSY_5"];

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

  // Build 500-fact corpus
  const facts: RuntimeMemoryTemporalFact[] = [];
  for (let i = 0; i < 500; i++) {
    const d = domains[i % domains.length];
    const p = predicates[i % predicates.length];
    const t = tools[i % tools.length];
    const obj = `${d} detail ${i}: ${t} configuration value ${i % 100} with token alpha${i % 17}`;
    facts.push(makeFact(`fact-${i}`, d, p, obj, 0.6 + (i % 10) * 0.03));
  }

  // Inject 30 target facts with known queries
  const targets: { fact: RuntimeMemoryTemporalFact; query: string; type: "exact" | "paraphrase" }[] = [];

  // 15 exact-term targets (error codes, identifiers)
  for (let i = 0; i < 15; i++) {
    const code = errorCodes[i % errorCodes.length];
    const fact = makeFact(
      `target-exact-${i}`,
      "CodeError",
      "error_code",
      `Error ${code} rejected upstream payload with signature mismatch in module ${i}`,
      0.92,
    );
    facts.push(fact);
    targets.push({ fact, query: `${code} error signature`, type: "exact" });
  }

  // 15 paraphrase targets (morphological variants — BM25 misses, vector hits)
  for (let i = 0; i < 15; i++) {
    const fact = makeFact(
      `target-para-${i}`,
      "UserPreference",
      i % 2 === 0 ? "toolchoice" : "testframework",
      i % 2 === 0
        ? `User chose ${tools[i % tools.length]} as daily editing application`
        : `User picked ${tools[i % tools.length]} as primary validation library`,
      0.88,
    );
    facts.push(fact);
    targets.push({
      fact,
      query: i % 2 === 0
        ? `preferred editor person ${i}`
        : `preferred javascript testing framework alternatives ${i}`,
      type: "paraphrase",
    });
  }

  // Build index once
  const index = new HybridSearchIndex(facts);

  // Optimal fusion config (W19 from ablation): k=0 + normalized + asymmetric
  // weights. Vector-primary: Vector #1 always beats Vector #2 (gap 0.5 >
  // max BM25 boost 0.5), but BM25 can boost agreed facts between adjacent
  // Vector ranks. Satisfies no-harm: MRR ≥ Vector-only, Recall@5 ≥ Vector-only.
  const optimalFusion = { normalizeByPathCount: true, rrfK: 0, wBm25: 0.5, wVector: 1.0 };

  // For single-path comparison, we need to isolate BM25 and vector results.
  // hybridSearchFacts returns combined RRF; we use the bm25Rank/vectorRank fields
  // to determine single-path recall.
  const K = 5;
  const latencies: number[] = [];
  let bm25Hits = 0;
  let vectorHits = 0;
  let hybridHits = 0;
  let bm25Ranks: number[] = [];
  let vectorRanks: number[] = [];
  let hybridRanks: number[] = [];

  for (const target of targets) {
    const start = performance.now();
    const results = index.search(target.query, 20, optimalFusion);
    latencies.push(performance.now() - start);

    const targetId = target.fact.factId;
    const hit = results.find((r) => r.fact.factId === targetId);

    if (hit) {
      hybridHits++;
      hybridRanks.push(results.indexOf(hit) + 1);
    }

    // BM25-only: check if target has bm25Rank <= K
    if (hit && hit.bm25Rank !== null && hit.bm25Rank <= K) {
      bm25Hits++;
      bm25Ranks.push(hit.bm25Rank);
    }

    // Vector-only: check if target has vectorRank <= K
    if (hit && hit.vectorRank !== null && hit.vectorRank <= K) {
      vectorHits++;
      vectorRanks.push(hit.vectorRank);
    }
  }

  // Separate metrics for exact vs paraphrase
  const exactTargets = targets.filter((t) => t.type === "exact");
  const paraTargets = targets.filter((t) => t.type === "paraphrase");

  function recallAtK(tgts: typeof targets, path: "bm25" | "vector" | "hybrid"): number {
    let hits = 0;
    for (const t of tgts) {
      const results = index.search(t.query, K, optimalFusion);
      const hit = results.find((r) => r.fact.factId === t.fact.factId);
      if (!hit) continue;
      if (path === "bm25" && hit.bm25Rank !== null && hit.bm25Rank <= K) hits++;
      if (path === "vector" && hit.vectorRank !== null && hit.vectorRank <= K) hits++;
      if (path === "hybrid") hits++;
    }
    return hits;
  }

  function mrr(tgts: typeof targets, path: "bm25" | "vector" | "hybrid"): number {
    let sum = 0;
    for (const t of tgts) {
      const results = index.search(t.query, 20, optimalFusion);
      const hit = results.find((r) => r.fact.factId === t.fact.factId);
      if (!hit) continue;
      let rank = 0;
      if (path === "bm25" && hit.bm25Rank !== null) rank = hit.bm25Rank;
      else if (path === "vector" && hit.vectorRank !== null) rank = hit.vectorRank;
      else if (path === "hybrid") rank = results.indexOf(hit) + 1;
      if (rank > 0) sum += 1 / rank;
    }
    return sum / tgts.length;
  }

  return {
    module: "B: Hybrid Retrieval (BM25 + Vector RRF)",
    corpusSize: facts.length,
    totalQueries: targets.length,
    queryBreakdown: { exact: exactTargets.length, paraphrase: paraTargets.length },
    recallAt5: {
      overall: {
        bm25: `${pct(bm25Hits, targets.length).toFixed(1)}% (${bm25Hits}/${targets.length})`,
        vector: `${pct(vectorHits, targets.length).toFixed(1)}% (${vectorHits}/${targets.length})`,
        hybrid: `${pct(hybridHits, targets.length).toFixed(1)}% (${hybridHits}/${targets.length})`,
      },
      exactQueries: {
        bm25: `${pct(recallAtK(exactTargets, "bm25"), exactTargets.length).toFixed(1)}%`,
        vector: `${pct(recallAtK(exactTargets, "vector"), exactTargets.length).toFixed(1)}%`,
        hybrid: `${pct(recallAtK(exactTargets, "hybrid"), exactTargets.length).toFixed(1)}%`,
      },
      paraphraseQueries: {
        bm25: `${pct(recallAtK(paraTargets, "bm25"), paraTargets.length).toFixed(1)}%`,
        vector: `${pct(recallAtK(paraTargets, "vector"), paraTargets.length).toFixed(1)}%`,
        hybrid: `${pct(recallAtK(paraTargets, "hybrid"), paraTargets.length).toFixed(1)}%`,
      },
    },
    mrr: {
      bm25: mrr(targets, "bm25").toFixed(3),
      vector: mrr(targets, "vector").toFixed(3),
      hybrid: mrr(targets, "hybrid").toFixed(3),
    },
    latency: {
      p50: `${percentile(latencies, 50).toFixed(3)}ms`,
      p95: `${percentile(latencies, 95).toFixed(3)}ms`,
      mean: `${mean(latencies).toFixed(3)}ms`,
    },
    rrfImprovement: {
      vsBm25Only: `${(hybridHits - bm25Hits)} additional recalls`,
      vsVectorOnly: `${(hybridHits - vectorHits)} additional recalls`,
    },
  };
}

// === Module C: Importance Eviction ===
// Insert 200 facts (varying confidence/source/status/age) into maxFacts=100.
// Compare FIFO vs importance: which facts survive?

function runModuleC() {
  function makeFact(
    id: string,
    subject: string,
    predicate: string,
    objectSummary: string,
    overrides: Partial<RuntimeMemoryTemporalFact> = {},
  ): RuntimeMemoryTemporalFact {
    return buildRuntimeMemoryTemporalFactFixture({
      factId: id,
      subject,
      predicate,
      objectSummary,
      ...overrides,
    });
  }

  // Generate 200 facts with varying importance
  const facts: RuntimeMemoryTemporalFact[] = [];
  for (let i = 0; i < 200; i++) {
    const confidence = 0.3 + (i % 14) * 0.05; // 0.30 - 0.95
    const statuses = ["verified", "verified", "verified", "human_approved", "deterministic_rule"] as const;
    const sources = ["tool_result", "tool_result", "verifier_summary", "human_confirmation", "deterministic_rule"] as const;
    const status = statuses[i % statuses.length];
    const source = sources[i % sources.length];
    const valid_at = 100 + i * 10; // varying age
    facts.push(makeFact(
      `fact-${i}`,
      `Subject${i % 10}`,
      `pred${i % 5}`,
      `Detail ${i} with confidence ${confidence.toFixed(2)}`,
      {
        confidence,
        verificationStatus: status,
        source,
        valid_at,
        reference_time: valid_at,
      },
    ));
  }

  // Run FIFO
  const fifoStore = new RuntimeMemoryStore({ maxFacts: 100, now: () => 5000, evictionPolicy: "fifo" });
  for (const f of facts) fifoStore.appendFact(f);

  // Run importance
  const importanceStore = new RuntimeMemoryStore({
    maxFacts: 100,
    evictionPolicy: "importance",
    now: () => 5000,
  });
  for (const f of facts) importanceStore.appendFact(f);

  // Analyze survivors
  const fifoSurvivors = new Set<string>();
  const importanceSurvivors = new Set<string>();
  for (let i = 0; i < 200; i++) {
    if (fifoStore.getFactById(`fact-${i}`)) fifoSurvivors.add(`fact-${i}`);
    if (importanceStore.getFactById(`fact-${i}`)) importanceSurvivors.add(`fact-${i}`);
  }

  // Top-20 highest confidence facts
  const top20HighConf = facts
    .map((f, i) => ({ id: `fact-${i}`, confidence: f.confidence }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20)
    .map((f) => f.id);

  const fifoHighConfSurvivors = top20HighConf.filter((id) => fifoSurvivors.has(id)).length;
  const importanceHighConfSurvivors = top20HighConf.filter((id) => importanceSurvivors.has(id)).length;

  // Human-approved facts
  const humanApprovedIds = facts
    .map((f, i) => ({ id: `fact-${i}`, status: f.verificationStatus }))
    .filter((f) => f.status === "human_approved")
    .map((f) => f.id);

  const fifoHumanApprovedSurvivors = humanApprovedIds.filter((id) => fifoSurvivors.has(id)).length;
  const importanceHumanApprovedSurvivors = humanApprovedIds.filter((id) => importanceSurvivors.has(id)).length;

  // Mean confidence of survivors
  const fifoSurvivorConfidences = facts
    .filter((_, i) => fifoSurvivors.has(`fact-${i}`))
    .map((f) => f.confidence);
  const importanceSurvivorConfidences = facts
    .filter((_, i) => importanceSurvivors.has(`fact-${i}`))
    .map((f) => f.confidence);

  // Human-confirmation source facts
  const humanConfSourceIds = facts
    .map((f, i) => ({ id: `fact-${i}`, source: f.source }))
    .filter((f) => f.source === "human_confirmation")
    .map((f) => f.id);
  const fifoHumanConfSurvivors = humanConfSourceIds.filter((id) => fifoSurvivors.has(id)).length;
  const importanceHumanConfSurvivors = humanConfSourceIds.filter((id) => importanceSurvivors.has(id)).length;

  return {
    module: "C: Importance-Aware Eviction",
    totalFacts: facts.length,
    maxFacts: 100,
    fifoSurvivors: fifoSurvivors.size,
    importanceSurvivors: importanceSurvivors.size,
    top20HighConfidenceSurvival: {
      fifo: `${fifoHighConfSurvivors}/20`,
      importance: `${importanceHighConfSurvivors}/20`,
    },
    humanApprovedSurvival: {
      total: humanApprovedIds.length,
      fifo: `${fifoHumanApprovedSurvivors}/${humanApprovedIds.length}`,
      importance: `${importanceHumanApprovedSurvivors}/${humanApprovedIds.length}`,
    },
    humanConfirmationSourceSurvival: {
      total: humanConfSourceIds.length,
      fifo: `${fifoHumanConfSurvivors}/${humanConfSourceIds.length}`,
      importance: `${importanceHumanConfSurvivors}/${humanConfSourceIds.length}`,
    },
    meanConfidenceOfSurvivors: {
      fifo: mean(fifoSurvivorConfidences).toFixed(3),
      importance: mean(importanceSurvivorConfidences).toFixed(3),
    },
    improvement: {
      highConfRetention: `${importanceHighConfSurvivors - fifoHighConfSurvivors} more top-20 facts preserved`,
      humanApprovedRetention: `${importanceHumanApprovedSurvivors - fifoHumanApprovedSurvivors} more human-approved facts preserved`,
      meanConfidenceDelta: `+${(mean(importanceSurvivorConfidences) - mean(fifoSurvivorConfidences)).toFixed(3)}`,
    },
  };
}

// === Module D: Maturity Score v2 ===
// Compute the maturity score with real L10 results.

function runModuleD() {
  const allPassLayers = buildAllPassScenario(true);
  const score = computeMaturityScore({ layers: allPassLayers, llmKeyAvailable: true });

  // Also compute with partial L10 (3/4 pass = 0.75)
  const partialL10 = allPassLayers.map((l) =>
    l.layerId === "L10" ? { ...l, passRate: 0.75 } : l,
  );
  const partialScore = computeMaturityScore({ layers: partialL10, llmKeyAvailable: true });

  // Compute without L10 (pre-MVP state)
  const noL10 = allPassLayers.filter((l) => l.layerId !== "L10");
  const noL10Score = computeMaturityScore({ layers: noL10, llmKeyAvailable: true });

  return {
    module: "D: Maturity Score v2",
    dimensions: score.dimensions,
    weights: DIMENSION_WEIGHTS,
    overallScore: Number(score.overall.toFixed(4)),
    level: score.level,
    layerCount: allPassLayers.length,
    disqualifiers: score.disqualifiers,
    scenarios: {
      allPass: {
        overall: Number(score.overall.toFixed(4)),
        level: score.level,
        retrievalQuality: score.dimensions.retrievalQuality,
      },
      partialL10_75pct: {
        overall: Number(partialScore.overall.toFixed(4)),
        level: partialScore.level,
        retrievalQuality: partialScore.dimensions.retrievalQuality,
      },
      noL10_preMVP: {
        overall: Number(noL10Score.overall.toFixed(4)),
        level: noL10Score.level,
        retrievalQuality: noL10Score.dimensions.retrievalQuality,
        coverage: noL10Score.dimensions.coverage,
      },
    },
    mvpImpact: {
      scoreDelta: Number((score.overall - noL10Score.overall).toFixed(4)),
      newDimension: "retrievalQuality (weight: 0.11)",
      newLayer: "L10 (Hybrid Retrieval Quality)",
    },
  };
}

// === Main ===

describe("MVP Deep Test — Real Benefit Measurement", () => {
  it("measures all 4 modules and outputs structured report", () => {
    const results = {
      timestamp: new Date().toISOString(),
      modules: {
        A: runModuleA(),
        B: runModuleB(),
        C: runModuleC(),
        D: runModuleD(),
      },
    };

    // Print structured report
    console.log("\n" + "=".repeat(80));
    console.log("  MVP DEEP TEST REPORT — Real Benefit Measurement");
    console.log("=".repeat(80));
    console.log(`  Timestamp: ${results.timestamp}`);
    console.log("=".repeat(80) + "\n");

    // Module A
    const a = results.modules.A;
    console.log("─".repeat(80));
    console.log(`  MODULE A: ${a.module}`);
    console.log("─".repeat(80));
    console.log(`  Corpus: ${a.totalCandidates} candidates against ${a.existingFacts} existing facts`);
    console.log(`  Action distribution:`);
    console.log(`    ADD:    ${a.actionDistribution.ADD}  (${pct(a.actionDistribution.ADD, a.totalCandidates).toFixed(1)}%)`);
    console.log(`    NONE:   ${a.actionDistribution.NONE}  (${pct(a.actionDistribution.NONE, a.totalCandidates).toFixed(1)}%)`);
    console.log(`    UPDATE: ${a.actionDistribution.UPDATE}  (${pct(a.actionDistribution.UPDATE, a.totalCandidates).toFixed(1)}%)`);
    console.log(`  NONE reasons: ${JSON.stringify(a.noneReasonBreakdown)}`);
    console.log(`  Superseded (UPDATE): ${a.supersededCount}`);
    console.log(`  Dedup rate: ${a.metrics.dedupRate}`);
    console.log(`  Storage reduction: ${a.metrics.storageReduction} (${a.storageSavings} facts NOT written)`);
    console.log(`  Facts after curation: ${a.factsAfterCuration} (without curation: ${a.factsWithoutCuration})`);
    console.log("");

    // Module B
    const b = results.modules.B;
    console.log("─".repeat(80));
    console.log(`  MODULE B: ${b.module}`);
    console.log("─".repeat(80));
    console.log(`  Corpus: ${b.corpusSize} facts, ${b.totalQueries} queries (${b.queryBreakdown.exact} exact + ${b.queryBreakdown.paraphrase} paraphrase)`);
    console.log(`  Recall@5:`);
    console.log(`    Overall:     BM25=${b.recallAt5.overall.bm25}  Vector=${b.recallAt5.overall.vector}  Hybrid=${b.recallAt5.overall.hybrid}`);
    console.log(`    Exact:       BM25=${b.recallAt5.exactQueries.bm25}  Vector=${b.recallAt5.exactQueries.vector}  Hybrid=${b.recallAt5.exactQueries.hybrid}`);
    console.log(`    Paraphrase:  BM25=${b.recallAt5.paraphraseQueries.bm25}  Vector=${b.recallAt5.paraphraseQueries.vector}  Hybrid=${b.recallAt5.paraphraseQueries.hybrid}`);
    console.log(`  MRR:  BM25=${b.mrr.bm25}  Vector=${b.mrr.vector}  Hybrid=${b.mrr.hybrid}`);
    console.log(`  Latency:  p50=${b.latency.p50}  p95=${b.latency.p95}  mean=${b.latency.mean}`);
    console.log(`  RRF improvement:  vs BM25-only=${b.rrfImprovement.vsBm25Only}  vs Vector-only=${b.rrfImprovement.vsVectorOnly}`);
    console.log("");

    // Module C
    const c = results.modules.C;
    console.log("─".repeat(80));
    console.log(`  MODULE C: ${c.module}`);
    console.log("─".repeat(80));
    console.log(`  Corpus: ${c.totalFacts} facts inserted, maxFacts=${c.maxFacts}`);
    console.log(`  Survivors:  FIFO=${c.fifoSurvivors}  Importance=${c.importanceSurvivors}`);
    console.log(`  Top-20 high-confidence survival:  FIFO=${c.top20HighConfidenceSurvival.fifo}  Importance=${c.top20HighConfidenceSurvival.importance}`);
    console.log(`  Human-approved survival:  FIFO=${c.humanApprovedSurvival.fifo}  Importance=${c.humanApprovedSurvival.importance}`);
    console.log(`  Human-confirmation source survival:  FIFO=${c.humanConfirmationSourceSurvival.fifo}  Importance=${c.humanConfirmationSourceSurvival.importance}`);
    console.log(`  Mean confidence of survivors:  FIFO=${c.meanConfidenceOfSurvivors.fifo}  Importance=${c.meanConfidenceOfSurvivors.importance}`);
    console.log(`  Improvement:  ${c.improvement.highConfRetention}, ${c.improvement.humanApprovedRetention}, meanConf Δ=${c.improvement.meanConfidenceDelta}`);
    console.log("");

    // Module D
    const d = results.modules.D;
    console.log("─".repeat(80));
    console.log(`  MODULE D: ${d.module}`);
    console.log("─".repeat(80));
    console.log(`  Layers: ${d.layerCount} (L1-L11 + CV1-CV5)`);
    console.log(`  Dimensions & weights: ${JSON.stringify(d.weights)}`);
    console.log(`  All-pass scenario:  overall=${d.scenarios.allPass.overall}  level=${d.scenarios.allPass.level}  retrievalQuality=${d.scenarios.allPass.retrievalQuality}`);
    console.log(`  Partial L10 (75%):   overall=${d.scenarios.partialL10_75pct.overall}  level=${d.scenarios.partialL10_75pct.level}  retrievalQuality=${d.scenarios.partialL10_75pct.retrievalQuality}`);
    console.log(`  Pre-MVP (no L10):     overall=${d.scenarios.noL10_preMVP.overall}  level=${d.scenarios.noL10_preMVP.level}  retrievalQuality=${d.scenarios.noL10_preMVP.retrievalQuality}  coverage=${d.scenarios.noL10_preMVP.coverage}`);
    console.log(`  MVP impact:  scoreDelta=+${d.mvpImpact.scoreDelta}  newDim=${d.mvpImpact.newDimension}  newLayer=${d.mvpImpact.newLayer}`);
    console.log("");

    // Summary
    console.log("=".repeat(80));
    console.log("  SUMMARY");
    console.log("=".repeat(80));
    console.log(`  Module A (AUDN):        Dedup rate ${a.metrics.dedupRate}, saved ${a.storageSavings} redundant writes`);
    console.log(`  Module B (Hybrid RRF):  Hybrid recall@5 ${b.recallAt5.overall.hybrid} vs BM25 ${b.recallAt5.overall.bm25} vs Vector ${b.recallAt5.overall.vector}`);
    console.log(`                          Latency p95=${b.latency.p95}, MRR hybrid=${b.mrr.hybrid}`);
    console.log(`  Module C (Eviction):    Importance preserves ${c.top20HighConfidenceSurvival.importance} vs FIFO ${c.top20HighConfidenceSurvival.fifo} top-20 high-conf facts`);
    console.log(`                          Mean confidence Δ=${c.improvement.meanConfidenceDelta}`);
    console.log(`  Module D (Maturity):    Overall=${d.scenarios.allPass.overall} (${d.scenarios.allPass.level}), MVP delta=+${d.mvpImpact.scoreDelta}`);
    console.log("=".repeat(80) + "\n");

    // Also output raw JSON for programmatic consumption
    console.log("RAW_JSON:" + JSON.stringify(results));
  });
});
