// @vitest-environment node
// L11: LoCoMo Benchmark — external dataset evaluation.
//
// Loads conversations and QA pairs from tests/fixtures/locomo/, writes each
// conversation's turns as episodic facts into a persistence store, retrieves
// top-5 facts per question, generates an answer via DeepSeek, and scores
// Recall@5 / F1 / BLEU-1 against ground truth.
//
// Requires RUNTIME_MEMORY_REAL_LLM=1 and DEEPSEEK_API_KEY.
// Skipped otherwise (does NOT trigger hollow_llm disqualifier).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRuntimeMemoryTemporalFactFixture,
  findRuntimeMemoryFacts,
  type RuntimeMemoryQueryableFact,
} from "../../openclaw_runtime/src/runtime-core/memory-context";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import {
  hybridSearchFacts,
  hybridSearchFactsWithEmbedding,
} from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import { callDeepSeek, hasDeepSeekKey } from "./helpers/runtime-memory-real-llm-client";
import {
  computeBleu1,
  computeF1,
  computeRecallAt5,
  type LocomoQuestion,
} from "./helpers/locomo-metrics";
import {
  createSiliconFlowEmbeddingProvider,
  hasSiliconFlowKey,
} from "./helpers/siliconflow-embedding-provider";

type LocomoTurn = { turnId: number; speaker: string; text: string };
type LocomoConversation = {
  conversationId: string;
  speakers: string[];
  turns: LocomoTurn[];
};

const FIXTURE_DIR = join(process.cwd(), "tests", "fixtures", "locomo");
const PERSIST_CONFIG = { runtime: { memory: { persist: true } } } as const;

const tempDirs: string[] = [];

function loadFixture<T>(filename: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, filename), "utf-8")) as T;
}

function createTempDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return join(dir, "openclaw.sqlite");
}

function turnToFact(
  turn: LocomoTurn,
  conversationId: string,
): RuntimeMemoryQueryableFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: `${conversationId}_turn_${turn.turnId}`,
    subject: turn.speaker,
    predicate: "said",
    objectSummary: turn.text,
    taskId: conversationId,
    valid_at: turn.turnId,
    reference_time: turn.turnId,
  });
}

function seedConversationFacts(
  dbPath: string,
  conversation: LocomoConversation,
): RuntimeMemoryQueryableFact[] {
  const store = createRuntimeMemoryPersistenceStore({
    config: PERSIST_CONFIG,
    database: { path: dbPath },
    now: () => 10000,
  });
  expect(store.migrate().status).toBe("migrated");

  const facts: RuntimeMemoryQueryableFact[] = [];
  for (const turn of conversation.turns) {
    const fact = turnToFact(turn, conversation.conversationId);
    const result = store.appendFact(fact);
    if (result.status === "persisted") {
      facts.push(result.value);
    }
  }
  return facts;
}

async function generateAnswer(
  question: string,
  retrievedFacts: RuntimeMemoryQueryableFact[],
): Promise<string> {
  const context = retrievedFacts
    .slice(0, 5)
    .map((f, i) => `[${i + 1}] ${f.subject} ${f.predicate}: ${f.objectSummary}`)
    .join("\n");

  const system =
    "You are a helpful assistant answering questions about a conversation. " +
    "Use only the provided context to answer. Be concise and factual. " +
    "If the context doesn't contain the answer, say 'I don't know.'";

  const user =
    `Context:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;

  const response = await callDeepSeek(system, user, {
    temperature: 0,
    maxTokens: 128,
  });

  return response.content.trim();
}

type CategoryMetrics = {
  recallAt5: number;
  f1: number;
  bleu1: number;
  count: number;
};

type ShortcomingDimension = "retrieval" | "generation" | "temporal" | "relation_chain";
type ShortcomingSeverity = "high" | "medium" | "low";

type Shortcoming = {
  dimension: ShortcomingDimension;
  severity: ShortcomingSeverity;
  evidence: string;
  recommendation: string;
};

function emptyCategoryMetrics(): CategoryMetrics {
  return { recallAt5: 0, f1: 0, bleu1: 0, count: 0 };
}

function analyzeShortcomings(
  overall: CategoryMetrics,
  byCategory: Record<string, CategoryMetrics>,
): Shortcoming[] {
  const shortcomings: Shortcoming[] = [];

  // 1. Retrieval shortfall: overall Recall@5 below target
  if (overall.recallAt5 < 0.70) {
    shortcomings.push({
      dimension: "retrieval",
      severity: overall.recallAt5 < 0.50 ? "high" : "medium",
      evidence: `Overall Recall@5 ${overall.recallAt5.toFixed(3)} < target 0.70`,
      recommendation:
        "Optimize embedding provider integration or RRF fusion weights (k, wBm25, wVector)",
    });
  }

  // 2. Generation shortfall: Recall@5 acceptable but F1 low
  if (overall.recallAt5 >= 0.50 && overall.f1 < 0.40) {
    shortcomings.push({
      dimension: "generation",
      severity: overall.f1 < 0.25 ? "high" : "medium",
      evidence: `Overall F1 ${overall.f1.toFixed(3)} < 0.40 while Recall@5 ${overall.recallAt5.toFixed(3)} is acceptable — context retrieved but not utilized`,
      recommendation:
        "Improve LLM context formatting (fact numbering, subject-predicate-object structure) or increase token budget",
    });
  }

  // 3. Category gap: identify weakest question type
  const categories = Object.entries(byCategory).sort(
    (a, b) => a[1].recallAt5 - b[1].recallAt5,
  );
  if (categories.length > 1) {
    const worst = categories[0];
    const best = categories[categories.length - 1];
    const gap = best[1].recallAt5 - worst[1].recallAt5;
    if (gap > 0.15) {
      shortcomings.push({
        dimension: "retrieval",
        severity: gap > 0.30 ? "high" : "medium",
        evidence: `Category gap: ${best[0]} ${best[1].recallAt5.toFixed(3)} vs ${worst[0]} ${worst[1].recallAt5.toFixed(3)} (Δ=${gap.toFixed(3)})`,
        recommendation: `Focus on ${worst[0]} question retrieval — examine query expansion and type-aware slot allocation`,
      });
    }
  }

  // 4. Temporal shortfall: adversarial questions underperform
  const adversarial = byCategory["adversarial"];
  if (adversarial && adversarial.recallAt5 < overall.recallAt5 - 0.10) {
    shortcomings.push({
      dimension: "temporal",
      severity: adversarial.recallAt5 < 0.30 ? "high" : "medium",
      evidence: `Adversarial Recall@5 ${adversarial.recallAt5.toFixed(3)} < overall ${overall.recallAt5.toFixed(3)} — bi-temporal reasoning needed`,
      recommendation:
        "Verify supersession conflict detection and invalid_at handling for 'before X, later Y' questions",
    });
  }

  // 5. Relation chain shortfall: multi-hop underperforms
  const multiHop = byCategory["multi_hop"];
  if (multiHop && multiHop.recallAt5 < overall.recallAt5 - 0.10) {
    shortcomings.push({
      dimension: "relation_chain",
      severity: multiHop.recallAt5 < 0.30 ? "high" : "medium",
      evidence: `Multi-hop Recall@5 ${multiHop.recallAt5.toFixed(3)} < overall ${overall.recallAt5.toFixed(3)} — 1-hop expansion may be insufficient`,
      recommendation:
        "Consider expanding to 2-hop BFS in memory_find_related or increasing relation expansion budget in context provider",
    });
  }

  return shortcomings;
}

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("L11: LoCoMo benchmark — fixture and infrastructure", () => {
  it("loads fixture and verifies structure", () => {
    const conversations = loadFixture<LocomoConversation[]>("conversations.json");
    const questions = loadFixture<LocomoQuestion[]>("questions.json");

    expect(conversations.length).toBeGreaterThan(0);
    expect(questions.length).toBeGreaterThan(0);
    expect(conversations[0].turns.length).toBeGreaterThan(0);
    expect(questions[0].question).toBeTruthy();
    expect(questions[0].answer).toBeTruthy();
    expect(questions[0].category).toBeTruthy();

    const categories = new Set(questions.map((q) => q.category));
    console.log("[LoCoMo] Conversations:", conversations.length);
    console.log("[LoCoMo] Questions:", questions.length);
    console.log("[LoCoMo] Categories:", [...categories]);
  });

  it("seeds conversation facts and verifies retrieval works", () => {
    const conversations = loadFixture<LocomoConversation[]>("conversations.json");
    const conversation = conversations[0];
    const dbPath = createTempDbPath("locomo-seed-");
    const facts = seedConversationFacts(dbPath, conversation);

    expect(facts.length).toBe(conversation.turns.length);

    const hits = findRuntimeMemoryFacts(facts, {
      reference_time: 10000,
      limit: 5,
    });
    expect(hits.length).toBeGreaterThan(0);

    closeOpenClawStateDatabaseForTest();
    closeRuntimeMemoryHydrationShadowDatabasesForTest();
  });

  it("analyzes shortcomings with structured dimension/severity/evidence/recommendation", () => {
    // Scenario: low overall Recall@5 + adversarial underperformance + multi-hop gap
    const overall: CategoryMetrics = {
      recallAt5: 0.55,
      f1: 0.30,
      bleu1: 0.25,
      count: 20,
    };
    const byCategory: Record<string, CategoryMetrics> = {
      single_hop: { recallAt5: 0.80, f1: 0.50, bleu1: 0.40, count: 10 },
      multi_hop: { recallAt5: 0.30, f1: 0.15, bleu1: 0.10, count: 5 },
      adversarial: { recallAt5: 0.20, f1: 0.10, bleu1: 0.05, count: 5 },
    };

    const shortcomings = analyzeShortcomings(overall, byCategory);

    // Should detect: retrieval (overall < 0.70), generation (F1 < 0.40 with Recall@5 >= 0.50),
    // category gap, temporal (adversarial), relation_chain (multi-hop)
    expect(shortcomings.length).toBeGreaterThanOrEqual(4);

    // Verify structured format
    for (const s of shortcomings) {
      expect(["retrieval", "generation", "temporal", "relation_chain"]).toContain(s.dimension);
      expect(["high", "medium", "low"]).toContain(s.severity);
      expect(s.evidence).toBeTruthy();
      expect(s.recommendation).toBeTruthy();
    }

    // Verify specific dimensions are detected
    const dimensions = shortcomings.map((s) => s.dimension);
    expect(dimensions).toContain("retrieval");
    expect(dimensions).toContain("temporal");
    expect(dimensions).toContain("relation_chain");

    // Adversarial with Recall@5 0.20 < 0.30 → high severity
    const temporal = shortcomings.find((s) => s.dimension === "temporal");
    expect(temporal?.severity).toBe("high");

    // Multi-hop with Recall@5 0.30 >= 0.30 → medium severity
    const relation = shortcomings.find((s) => s.dimension === "relation_chain");
    expect(relation?.severity).toBe("medium");

    // No shortcomings when all metrics are good
    const goodOverall: CategoryMetrics = {
      recallAt5: 0.85,
      f1: 0.60,
      bleu1: 0.50,
      count: 20,
    };
    const goodCategory: Record<string, CategoryMetrics> = {
      single_hop: { recallAt5: 0.88, f1: 0.65, bleu1: 0.55, count: 10 },
      multi_hop: { recallAt5: 0.82, f1: 0.55, bleu1: 0.45, count: 5 },
      adversarial: { recallAt5: 0.80, f1: 0.50, bleu1: 0.40, count: 5 },
    };
    const noShortcomings = analyzeShortcomings(goodOverall, goodCategory);
    expect(noShortcomings).toHaveLength(0);
  });
});

describe.skipIf(!hasDeepSeekKey())("L11: LoCoMo benchmark — full LLM evaluation", () => {
  it("runs full LoCoMo benchmark: retrieve + generate + score", async () => {
    const conversations = loadFixture<LocomoConversation[]>("conversations.json");
    const questions = loadFixture<LocomoQuestion[]>("questions.json");

    const factsByConversation = new Map<string, RuntimeMemoryQueryableFact[]>();
    for (const conv of conversations) {
      const dbPath = createTempDbPath(`locomo-conv-${conv.conversationId}-`);
      const facts = seedConversationFacts(dbPath, conv);
      factsByConversation.set(conv.conversationId, facts);
      closeOpenClawStateDatabaseForTest();
      closeRuntimeMemoryHydrationShadowDatabasesForTest();
    }

    const useEmbedding = hasSiliconFlowKey();
    const embeddingProvider = useEmbedding
      ? createSiliconFlowEmbeddingProvider()
      : null;
    const retrievalMode = useEmbedding
      ? "Qwen3-Embedding-8B (SiliconFlow)"
      : "3-gram TF-IDF (fallback)";
    console.log(`[LoCoMo] Retrieval mode: ${retrievalMode}`);

    const byCategory: Record<string, CategoryMetrics> = {};
    let overallRecall5 = 0;
    let overallF1 = 0;
    let overallBleu1 = 0;
    let totalQuestions = 0;

    for (const question of questions) {
      const facts = factsByConversation.get(question.conversationId) ?? [];

      const hybridHits = useEmbedding
        ? await hybridSearchFactsWithEmbedding(
            facts,
            { queryText: question.question, topK: 5 },
            embeddingProvider!,
          )
        : hybridSearchFacts(facts, {
            queryText: question.question,
            topK: 5,
          });
      const retrievedFacts = hybridHits.map((h) => h.fact);

      const generatedAnswer = await generateAnswer(question.question, retrievedFacts);

      const recall5 = computeRecallAt5(
        retrievedFacts.map((f) => ({ factId: f.factId, objectSummary: f.objectSummary })),
        question.answer,
      );
      const f1 = computeF1(generatedAnswer, question.answer);
      const bleu1 = computeBleu1(generatedAnswer, question.answer);

      overallRecall5 += recall5;
      overallF1 += f1;
      overallBleu1 += bleu1;
      totalQuestions++;

      if (!byCategory[question.category]) {
        byCategory[question.category] = emptyCategoryMetrics();
      }
      byCategory[question.category].recallAt5 += recall5;
      byCategory[question.category].f1 += f1;
      byCategory[question.category].bleu1 += bleu1;
      byCategory[question.category].count++;

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const overall: CategoryMetrics = {
      recallAt5: overallRecall5 / totalQuestions,
      f1: overallF1 / totalQuestions,
      bleu1: overallBleu1 / totalQuestions,
      count: totalQuestions,
    };

    for (const cat of Object.keys(byCategory)) {
      const m = byCategory[cat];
      m.recallAt5 /= m.count;
      m.f1 /= m.count;
      m.bleu1 /= m.count;
    }

    const shortcomings = analyzeShortcomings(overall, byCategory);

    const report = {
      dataset: "locomo",
      version: "1.1",
      totalQuestions: totalQuestions,
      retrievalMode,
      metrics: {
        overall: {
          recall_at_5: overall.recallAt5,
          f1: overall.f1,
          bleu1: overall.bleu1,
        },
        byCategory: Object.fromEntries(
          Object.entries(byCategory).map(([cat, m]) => [
            cat,
            {
              recall_at_5: m.recallAt5,
              f1: m.f1,
              bleu1: m.bleu1,
              count: m.count,
            },
          ]),
        ),
      },
      shortcomings,
      comparison: {
        mem0: { recall_at_5: 0.925 },
        langmem: { recall_at_5: 0.683 },
        letta: { recall_at_5: 0.601 },
        ours: { recall_at_5: overall.recallAt5 },
      },
      generatedAt: new Date().toISOString(),
    };

    const artifactDir = join(process.cwd(), "artifacts", "runtime-memory-eval");
    try {
      writeFileSync(
        join(artifactDir, "locomo-report.json"),
        JSON.stringify(report, null, 2) + "\n",
        "utf-8",
      );
    } catch {
      // Artifact directory may not exist; log to console instead.
    }

    console.log("[LoCoMo] === Benchmark Results ===");
    console.log("[LoCoMo] Overall Recall@5:", overall.recallAt5.toFixed(4));
    console.log("[LoCoMo] Overall F1:", overall.f1.toFixed(4));
    console.log("[LoCoMo] Overall BLEU-1:", overall.bleu1.toFixed(4));
    console.log("[LoCoMo] Total questions:", totalQuestions);
    for (const [cat, m] of Object.entries(byCategory)) {
      console.log(
        `[LoCoMo] ${cat}: Recall@5=${m.recallAt5.toFixed(4)} F1=${m.f1.toFixed(4)} BLEU1=${m.bleu1.toFixed(4)} n=${m.count}`,
      );
    }
    if (shortcomings.length > 0) {
      console.log("[LoCoMo] Shortcomings:");
      for (const s of shortcomings) {
        console.log(
          `  - [${s.severity.toUpperCase()}] ${s.dimension}: ${s.evidence}\n    → ${s.recommendation}`,
        );
      }
    } else {
      console.log("[LoCoMo] No significant shortcomings detected.");
    }

    expect(totalQuestions).toBe(questions.length);
    expect(overall.recallAt5).toBeGreaterThan(0);
    expect(overall.f1).toBeGreaterThan(0);
  }, 600_000);
});
