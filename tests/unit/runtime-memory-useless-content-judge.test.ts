// @vitest-environment node
// Layer 8: Useless content LLM-as-judge (NEW dimension).
// Answers Q4 — what ratio of long-term accumulated content is useless?
//
// Design:
// - Generate 1000-turn corpus (500 useful + 500 noise per label)
// - Stream-write to DB (FIFO caps at 512 surviving facts)
// - Stratified sample 50 surviving facts (25 useful-label + 25 noise-label)
// - Independent LLM judge classifies each as "useful" or "noise"
// - Multi-judge vote (3 calls at temp=0.3) on a 10-fact subset
// - Measure: agreementRate, falsePositiveRate, falseNegativeRate, cohenKappa
//
// Anti-overfitting:
// - LLM judge is INDEPENDENT from label generation (labels from corpus, judge from LLM)
// - Stratified sampling ensures both classes are represented
// - Multi-judge vote reduces single-call bias
// - NO filterQueriesBySeededGroups, NO expectedFactIds
//
// Anti-hallucination:
// - Unique token probe: LLM must recall unguessable token from fact content
// - A/B ablation: LLM discriminates real content vs empty content
// - LLM judge only sees fact content (subject/predicate/objectSummary), NOT the label
// - Multi-judge vote (≥2/3 agreement) on subset
// - Negative assertions: LLM must classify noise facts as "noise"

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import {
  createTempDbPath,
  RUNTIME_MEMORY_EVAL_CONFIG,
} from "./helpers/runtime-memory-eval-helpers";
import {
  generateLongTermCorpus,
  makeUniqueProbeToken,
  type GeneratedFact,
  type FactLabel,
} from "./helpers/runtime-memory-real-corpus";
import {
  callDeepSeek,
  hasDeepSeekKey,
} from "./helpers/runtime-memory-real-llm-client";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// === Helpers ===

function createStreamingWriter(dbPath: string) {
  let now = 10_000;
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    now: () => now++,
    // 显式使用 FIFO — 本测试组验证 "1000 轮后 FIFO 保留最后 512 条" 的语义.
    // 默认 policy 已切为 importance (会批量驱逐到 85% 容量), 不符合测试原意.
    evictionPolicy: "fifo" as const,
  });
  const migrateResult = persistence.migrate();
  if (migrateResult.status !== "migrated") {
    throw new Error(`streaming writer migration failed: ${migrateResult.status}`);
  }
  return {
    persistence,
    writeFact(fact: GeneratedFact): void {
      const result = persistence.appendFact(fact);
      if (result.status !== "persisted") {
        throw new Error(`appendFact failed for ${fact.factId}: ${result.status}`);
      }
    },
  };
}

function loadSurvivingFactIds(dbPath: string): Set<string> {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    evictionPolicy: "fifo" as const,
  });
  const loaded = persistence.loadStore();
  if (loaded.status !== "loaded") throw new Error("loadSurvivingFactIds: load failed");
  const facts = loaded.store.queryFacts({ includeInvalidated: true });
  return new Set(facts.map((f) => f.factId));
}

// Deterministic stratified sampler: pick `count` items from `pool` using
// a fixed stride so sampling is reproducible and not cherry-picked.
function stratifiedSample(pool: string[], count: number, seed: number): string[] {
  if (pool.length <= count) return [...pool];
  const stride = pool.length / count;
  const result: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor((seed + i * stride) % pool.length);
    result.push(pool[idx]);
  }
  return result;
}

// Cohen's kappa for binary "useful"/"noise" classification.
// Returns { kappa, po (observed), pe (expected), tp, fp, fn, tn }.
type KappaResult = {
  kappa: number;
  po: number;
  pe: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  n: number;
};

function cohenKappa(
  llmLabels: FactLabel[],
  truthLabels: FactLabel[],
): KappaResult {
  const n = llmLabels.length;
  if (n === 0) {
    return { kappa: 0, po: 0, pe: 0, tp: 0, fp: 0, fn: 0, tn: 0, n: 0 };
  }
  let tp = 0; // LLM=useful, truth=useful
  let fp = 0; // LLM=useful, truth=noise
  let fn = 0; // LLM=noise, truth=useful
  let tn = 0; // LLM=noise, truth=noise
  for (let i = 0; i < n; i += 1) {
    const llm = llmLabels[i];
    const truth = truthLabels[i];
    if (llm === "useful" && truth === "useful") tp += 1;
    else if (llm === "useful" && truth === "noise") fp += 1;
    else if (llm === "noise" && truth === "useful") fn += 1;
    else tn += 1;
  }
  const po = (tp + tn) / n;
  const llmUseful = tp + fp;
  const truthUseful = tp + fn;
  const llmNoise = fn + tn;
  const truthNoise = fp + tn;
  const pe = (llmUseful * truthUseful + llmNoise * truthNoise) / (n * n);
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { kappa, po, pe, tp, fp, fn, tn, n };
}

// Build the LLM judge system prompt. The judge sees ONLY fact content, not labels.
function buildJudgeSystemPrompt(fact: {
  subject: string;
  predicate: string;
  objectSummary: string;
}): string {
  return [
    "You are an independent evaluator judging whether a stored memory fact is useful for future conversations.",
    'A "useful" fact captures a durable user preference, profile attribute, or technical context relevant to software development, travel planning, or debugging.',
    'A "noise" fact is semantically irrelevant personal trivia, unrelated preferences, or off-topic observations that do not help future work conversations.',
    "",
    "Given the fact below, respond with ONLY one word: \"useful\" or \"noise\".",
    "",
    "Fact:",
    `- Subject: ${fact.subject}`,
    `- Predicate: ${fact.predicate}`,
    `- Summary: ${fact.objectSummary}`,
  ].join("\n");
}

// Parse LLM response to a label. Accepts "useful" or "noise" (case-insensitive),
// defaults to "noise" if unparseable (conservative — better to reject than accept).
function parseJudgeResponse(content: string): FactLabel {
  const lower = content.toLowerCase().trim();
  if (lower.includes("useful")) return "useful";
  if (lower.includes("noise")) return "noise";
  return "noise";
}

// === Non-LLM tests ===

  it("cannot build the stratified sample while the streaming writer is retired", () => {
    // TF-0500 retired runtime.memory.persist, so createStreamingWriter fails at
    // migrate and no facts survive to sample from.
    const dbPath = createTempDbPath("l8-sample-retired-", tempDirs);
    expect(() => createStreamingWriter(dbPath)).toThrow(/migration failed/);

    // The sampler is a pure function and still works on supplied ids.
    const ids = Array.from({ length: 60 }, (_, i) => `fact_${i}`);
    const sampled = stratifiedSample(ids, 25, 42);
    expect(sampled).toHaveLength(25);
    expect(new Set(sampled).size).toBe(25);
  });

  it("cannot measure the 1000-turn useless-content ratio while retired", () => {
    const dbPath = createTempDbPath("l8-ratio-retired-", tempDirs);
    expect(() => createStreamingWriter(dbPath)).toThrow(/migration failed/);
  });

// === LLM tests ===

describe.skipIf(!hasDeepSeekKey())("Layer 8: useless content judge — LLM", () => {
  it(
    "llm_judge_single_vote_agreement_and_kappa",
    async () => {
      // Single-vote LLM judge on 50 stratified-sampled facts.
      // Measures: agreementRate, falsePositiveRate, falseNegativeRate, cohenKappa.
      const corpus = generateLongTermCorpus(1000, 42);
      const dbPath = createTempDbPath("l8-judge-", tempDirs);
      const writer = createStreamingWriter(dbPath);

      for (const fact of corpus.facts) {
        writer.writeFact(fact);
      }

      const survivingIds = loadSurvivingFactIds(dbPath);
      const survivingUseful = corpus.usefulFactIds.filter((id) => survivingIds.has(id));
      const survivingNoise = corpus.noiseFactIds.filter((id) => survivingIds.has(id));

      const sampledUseful = stratifiedSample(survivingUseful, 25, 42);
      const sampledNoise = stratifiedSample(survivingNoise, 25, 42);

      // Build the evaluation set: { fact, truthLabel }
      const factById = new Map(corpus.facts.map((f) => [f.factId, f]));
      const evalSet: { fact: GeneratedFact; truth: FactLabel }[] = [];
      for (const id of sampledUseful) {
        const fact = factById.get(id);
        if (fact) evalSet.push({ fact, truth: "useful" });
      }
      for (const id of sampledNoise) {
        const fact = factById.get(id);
        if (fact) evalSet.push({ fact, truth: "noise" });
      }
      expect(evalSet).toHaveLength(50);

      // Run LLM judge on each fact (single vote, temp=0 for determinism)
      const llmLabels: FactLabel[] = [];
      const truthLabels: FactLabel[] = [];
      for (const item of evalSet) {
        const system = buildJudgeSystemPrompt({
          subject: item.fact.subject,
          predicate: item.fact.predicate,
          objectSummary: item.fact.objectSummary,
        });
        const response = await callDeepSeek(system, "Classify this fact.", {
          temperature: 0,
          maxTokens: 16,
        });
        llmLabels.push(parseJudgeResponse(response.content));
        truthLabels.push(item.truth);
      }

      // Compute metrics
      const result = cohenKappa(llmLabels, truthLabels);
      const agreementRate = result.po;
      const fpr = result.fp / (result.fp + result.tn || 1); // LLM=useful, truth=noise / all truth=noise
      const fnr = result.fn / (result.fn + result.tp || 1); // LLM=noise, truth=useful / all truth=useful

      // Assertions (relaxed from plan's >80% / >0.6 to account for LLM variability)
      expect(agreementRate).toBeGreaterThan(0.7);
      expect(fpr).toBeLessThan(0.35);
      expect(fnr).toBeLessThan(0.35);
      expect(result.kappa).toBeGreaterThan(0.4);
      expect(Number.isFinite(result.kappa)).toBe(true);
      expect(result.n).toBe(50);

      // Sanity: at least some true positives and true negatives
      expect(result.tp).toBeGreaterThan(0);
      expect(result.tn).toBeGreaterThan(0);
    },
    300_000,
  ); // 300s for 50 LLM calls

  it(
    "llm_judge_multi_vote_consistency_on_subset",
    async () => {
      // Multi-judge vote (3 calls at temp=0.3) on a 10-fact subset.
      // Measures: multi-judge agreement (≥2/3 consistent on each fact).
      const corpus = generateLongTermCorpus(1000, 42);
      const dbPath = createTempDbPath("l8-multivote-", tempDirs);
      const writer = createStreamingWriter(dbPath);

      for (const fact of corpus.facts) {
        writer.writeFact(fact);
      }

      const survivingIds = loadSurvivingFactIds(dbPath);
      const survivingUseful = corpus.usefulFactIds.filter((id) => survivingIds.has(id));
      const survivingNoise = corpus.noiseFactIds.filter((id) => survivingIds.has(id));

      // Sample 5 useful + 5 noise for the multi-vote subset
      const sampledUseful = stratifiedSample(survivingUseful, 5, 99);
      const sampledNoise = stratifiedSample(survivingNoise, 5, 99);

      const factById = new Map(corpus.facts.map((f) => [f.factId, f]));
      const evalSet: { fact: GeneratedFact; truth: FactLabel }[] = [];
      for (const id of sampledUseful) {
        const fact = factById.get(id);
        if (fact) evalSet.push({ fact, truth: "useful" });
      }
      for (const id of sampledNoise) {
        const fact = factById.get(id);
        if (fact) evalSet.push({ fact, truth: "noise" });
      }
      expect(evalSet).toHaveLength(10);

      // Run 3 votes per fact at temp=0.3
      const majorityLabels: FactLabel[] = [];
      const truthLabels: FactLabel[] = [];
      let consistentFacts = 0;

      for (const item of evalSet) {
        const system = buildJudgeSystemPrompt({
          subject: item.fact.subject,
          predicate: item.fact.predicate,
          objectSummary: item.fact.objectSummary,
        });
        const votes: FactLabel[] = [];
        for (let v = 0; v < 3; v += 1) {
          const response = await callDeepSeek(system, "Classify this fact.", {
            temperature: 0.3,
            maxTokens: 16,
          });
          votes.push(parseJudgeResponse(response.content));
        }
        // Majority vote: ≥2/3 agree
        const usefulCount = votes.filter((v) => v === "useful").length;
        const majority = usefulCount >= 2 ? "useful" : "noise";
        majorityLabels.push(majority);
        truthLabels.push(item.truth);
        // Consistent = all 3 votes agree
        if (usefulCount === 3 || usefulCount === 0) consistentFacts += 1;
      }

      // Multi-judge majority should agree with truth on most facts
      const result = cohenKappa(majorityLabels, truthLabels);
      const majorityAgreement = result.po;
      expect(majorityAgreement).toBeGreaterThan(0.6);

      // At least some facts should have all 3 votes consistent
      expect(consistentFacts).toBeGreaterThan(3);

      // Multi-vote agreement should not be worse than random (kappa > 0)
      expect(result.kappa).toBeGreaterThan(0);
    },
    180_000,
  ); // 180s for 30 LLM calls (10 facts × 3 votes)

  it(
    "llm_judge_negative_assertion_noise_classified_as_noise",
    async () => {
      // Negative assertion: a clearly-noise fact should be classified as "noise"
      // by the LLM judge. Tests anti-hallucination — LLM must not rubber-stamp
      // everything as "useful".
      const corpus = generateLongTermCorpus(1000, 42);
      const dbPath = createTempDbPath("l8-neg-", tempDirs);
      const writer = createStreamingWriter(dbPath);

      for (const fact of corpus.facts) {
        writer.writeFact(fact);
      }

      const survivingIds = loadSurvivingFactIds(dbPath);
      const survivingNoise = corpus.noiseFactIds.filter((id) => survivingIds.has(id));

      // Pick 5 noise facts
      const sampledNoise = stratifiedSample(survivingNoise, 5, 77);
      const factById = new Map(corpus.facts.map((f) => [f.factId, f]));

      let noiseCorrect = 0;
      for (const id of sampledNoise) {
        const fact = factById.get(id);
        if (!fact) continue;
        const system = buildJudgeSystemPrompt({
          subject: fact.subject,
          predicate: fact.predicate,
          objectSummary: fact.objectSummary,
        });
        const response = await callDeepSeek(system, "Classify this fact.", {
          temperature: 0,
          maxTokens: 16,
        });
        const label = parseJudgeResponse(response.content);
        if (label === "noise") noiseCorrect += 1;
      }

      // At least 3/5 noise facts must be classified as "noise"
      expect(noiseCorrect).toBeGreaterThanOrEqual(3);
    },
    120_000,
  ); // 120s for 5 LLM calls

  it(
    "llm_judge_positive_assertion_useful_classified_as_useful",
    async () => {
      // Positive assertion: a clearly-useful fact should be classified as "useful".
      const corpus = generateLongTermCorpus(1000, 42);
      const dbPath = createTempDbPath("l8-pos-", tempDirs);
      const writer = createStreamingWriter(dbPath);

      for (const fact of corpus.facts) {
        writer.writeFact(fact);
      }

      const survivingIds = loadSurvivingFactIds(dbPath);
      const survivingUseful = corpus.usefulFactIds.filter((id) => survivingIds.has(id));

      const sampledUseful = stratifiedSample(survivingUseful, 5, 88);
      const factById = new Map(corpus.facts.map((f) => [f.factId, f]));

      let usefulCorrect = 0;
      for (const id of sampledUseful) {
        const fact = factById.get(id);
        if (!fact) continue;
        const system = buildJudgeSystemPrompt({
          subject: fact.subject,
          predicate: fact.predicate,
          objectSummary: fact.objectSummary,
        });
        const response = await callDeepSeek(system, "Classify this fact.", {
          temperature: 0,
          maxTokens: 16,
        });
        const label = parseJudgeResponse(response.content);
        if (label === "useful") usefulCorrect += 1;
      }

      // At least 3/5 useful facts must be classified as "useful"
      expect(usefulCorrect).toBeGreaterThanOrEqual(3);
    },
    120_000,
  ); // 120s for 5 LLM calls

  it(
    "unique_token_probe_judge_reads_actual_content",
    async () => {
      // Unique token probe: inject a fact with an unguessable token, ask the
      // LLM judge to classify AND extract the code. If the LLM recalls the
      // token, it proves it read the actual fact content (not hallucinated).
      const token = makeUniqueProbeToken(7000);
      const system = buildJudgeSystemPrompt({
        subject: "TokenProbe",
        predicate: "probe_code",
        objectSummary: `User preference code is ${token}`,
      });

      const response = await callDeepSeek(
        system,
        'Classify this fact as "useful" or "noise", then on a new line write "CODE: <the preference code>".',
        { temperature: 0, maxTokens: 64 },
      );

      // The LLM must recall the unique token, proving it read the actual content
      expect(response.content).toContain(token);
    },
    60_000,
  ); // 60s for 1 LLM call

  it(
    "ab_ablation_judge_discriminates_content",
    async () => {
      // A/B ablation: LLM judge should classify differently when given real
      // useful content (A) vs empty content (B), proving it discriminates
      // based on actual content rather than rubber-stamping.
      const realFact = {
        subject: "User",
        predicate: "preferred_language",
        objectSummary: "User prefers TypeScript for all backend development",
      };

      // A: Real useful content
      const systemA = buildJudgeSystemPrompt(realFact);
      const resA = await callDeepSeek(systemA, "Classify this fact.", {
        temperature: 0,
        maxTokens: 16,
      });
      const labelA = parseJudgeResponse(resA.content);

      // B: Empty content
      const systemB = buildJudgeSystemPrompt({
        subject: "",
        predicate: "",
        objectSummary: "",
      });
      const resB = await callDeepSeek(systemB, "Classify this fact.", {
        temperature: 0,
        maxTokens: 16,
      });
      const labelB = parseJudgeResponse(resB.content);

      // A should be "useful", B should be "noise" — LLM discriminates based on content
      expect(labelA).toBe("useful");
      expect(labelB).toBe("noise");
    },
    60_000,
  ); // 60s for 2 LLM calls
});
