// Phase Integration Verification — 四个 Phase 协同工作验证
//
// 目的：避免开始工作后发现某个函数没用上或某个函数没写。
// 本测试验证：
// 1. 每个 Phase 的所有 export 函数都能被调用并返回正确类型
// 2. 四个 Phase 串联调用（模拟主 pipeline 流程）能正常工作
// 3. Phase 1 产生的 QueryPlan 能被 Phase 2/3 消费
// 4. Phase 4 的 judge 能消费 Phase 1 的 category
// 5. 主 pipeline 文件确实 import 了所有关键函数（静态验证）
// 6. 识别并记录"diagnostic-only"未激活函数

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { HybridSearchHit } from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import type { RuntimeMemoryQueryableFact } from "../../openclaw_runtime/src/runtime-core/memory-context";
import type { EpisodicHit, EpisodicSentence } from "./helpers/episodic-memory";
import {
  buildQueryPlan,
  classifyQuery,
  classifyQueryHeuristic,
  parseClassificationResponse,
  type QueryPlan,
  type QueryType,
  type RetrievalStrategy,
} from "./helpers/query-classifier";
import {
  mergeRetrievalResults,
  rewriteQueryDeterministic,
  rewriteQueryForRetrieval,
  retrieveWithFeedbackLoop,
  type FeedbackLoopOptions,
  type FeedbackLoopResult,
  type RetrievalResult,
} from "./helpers/retrieval-feedback-loop";
import {
  computeSelfAskRRF,
  mergeSelfAskIntoMainHits,
  selfAskDecomposeAndMerge,
  type SelfAskMergeResult,
  type SelfAskSubQuestion,
} from "./helpers/self-ask-merge";
import {
  buildUnifiedJudgePrompt,
  compareJudgeResults,
  deterministicJudge,
  getCategorySpecificPrompt,
  judgeWithUnifiedPrompt,
  parseUnifiedJudgeVerdict,
  UNIFIED_JUDGE_CONFIG,
  type JudgeCategory,
  type JudgeConfig,
  type JudgeResult,
} from "./helpers/unified-judge";

// === Fixtures ===

function makeFact(factId: string, subject = "Alice", summary = "is engineer"): RuntimeMemoryQueryableFact {
  return {
    schemaVersion: 1,
    factId,
    subject,
    predicate: "is",
    objectSummary: summary,
    confidence: 0.9,
    source: "verifier",
    verificationStatus: "verified",
    sourceEpisodeRefs: [],
    evidenceRefs: [],
    proposedAt: 0,
    valid_at: 0,
    reference_time: 0,
  } as unknown as RuntimeMemoryQueryableFact;
}

function makeHit(
  factId: string,
  rrfScore: number,
  ceScore?: number,
): HybridSearchHit {
  return {
    fact: makeFact(factId),
    rrfScore,
    bm25Rank: null,
    vectorRank: null,
    entityRank: null,
    bm25Score: 0,
    vectorScore: 0,
    entityScore: 0,
    ...(ceScore !== undefined ? { ceScore } : {}),
  };
}

function makeSentence(sentenceId: string, text = "test"): EpisodicSentence {
  return {
    sentence_id: sentenceId,
    turn_id: "turn-1",
    session_id: "session-1",
    speaker: "user",
    text,
    turn_text: text,
    timestamp: 0,
    turn_index: 0,
    sentence_index: 0,
  };
}

function makeEpisodicHit(sentenceId: string, rrfScore: number): EpisodicHit {
  return {
    sentence: makeSentence(sentenceId),
    rrfScore,
    vectorRank: null,
    bm25Rank: null,
    vectorScore: 0,
    bm25Score: 0,
  };
}

// === 1. Export Coverage: 每个 Phase 的所有 export 都能被调用 ===

describe("Phase Integration — Export Coverage", () => {
  describe("Phase 1: query-classifier.ts", () => {
    it("classifyQueryHeuristic 可调用", () => {
      const result: QueryType = classifyQueryHeuristic("When did Alice start?");
      expect(["temporal", "multi_hop", "open_domain", "single_hop"]).toContain(result);
    });

    it("buildQueryPlan 可调用", () => {
      const plan: QueryPlan = buildQueryPlan("temporal", "test query");
      expect(plan.type).toBe("temporal");
      expect(plan.strategy).toBe("temporal_priority");
    });

    it("parseClassificationResponse 可调用", () => {
      const result = parseClassificationResponse('{"type":"temporal"}');
      expect(result).toBe("temporal");
    });

    it("classifyQuery 可调用", async () => {
      const plan: QueryPlan = await classifyQuery("When did Alice start?");
      expect(plan.type).toBe("temporal");
    });

    it("QueryType 和 RetrievalStrategy 类型可用", () => {
      const qt: QueryType = "temporal";
      const rs: RetrievalStrategy = "temporal_priority";
      expect(qt).toBe("temporal");
      expect(rs).toBe("temporal_priority");
    });
  });

  describe("Phase 2: retrieval-feedback-loop.ts", () => {
    it("retrieveWithFeedbackLoop 可调用", async () => {
      const initial: RetrievalResult = {
        hits: [makeHit("f1", 1.0)],
        episodicHits: [],
        assembledContext: "test context",
        retrievedFacts: [makeFact("f1")],
      };
      const options: FeedbackLoopOptions = {
        queryPlan: buildQueryPlan("single_hop", "test"),
        maxIterations: 2,
      };
      const result: FeedbackLoopResult = await retrieveWithFeedbackLoop(
        "test",
        initial,
        options,
        async () => initial,
      );
      expect(result.iterations).toBeGreaterThanOrEqual(1);
    });

    it("rewriteQueryForRetrieval 可调用", async () => {
      const plan = buildQueryPlan("temporal", "when did alice start");
      const rewritten = await rewriteQueryForRetrieval("test", ["evidence"], plan);
      expect(typeof rewritten).toBe("string");
    });

    it("rewriteQueryDeterministic 可调用", () => {
      const plan = buildQueryPlan("temporal", "when did alice start");
      const rewritten = rewriteQueryDeterministic("test query", ["evidence"], plan);
      expect(typeof rewritten).toBe("string");
    });

    it("mergeRetrievalResults 可调用", () => {
      const r1: RetrievalResult = {
        hits: [makeHit("f1", 1.0)],
        episodicHits: [makeEpisodicHit("s1", 0.8)],
        assembledContext: "ctx1",
        retrievedFacts: [makeFact("f1")],
      };
      const merged = mergeRetrievalResults([r1]);
      expect(merged.hits).toHaveLength(1);
    });

    it("RetrievalResult / FeedbackLoopOptions / FeedbackLoopResult 类型可用", () => {
      const rr: RetrievalResult = {
        hits: [],
        episodicHits: [],
        assembledContext: "",
        retrievedFacts: [],
      };
      const fo: FeedbackLoopOptions = {
        queryPlan: buildQueryPlan("single_hop", "test"),
      };
      expect(rr.hits).toHaveLength(0);
      expect(fo.queryPlan).toBeDefined();
      // FeedbackLoopResult extends RetrievalResult，类型兼容
      const flr: FeedbackLoopResult = {
        ...rr,
        iterations: 1,
        finalCompleteness: "COMPLETE",
        rewriteHistory: [],
        completenessHistory: ["COMPLETE"],
      };
      expect(flr.iterations).toBe(1);
    });
  });

  describe("Phase 3: self-ask-merge.ts", () => {
    it("selfAskDecomposeAndMerge 可调用", async () => {
      const result: SelfAskMergeResult = await selfAskDecomposeAndMerge(
        "test query",
        async () => [makeHit("f1", 1.0)],
        { precomputedSubQuestions: ["q1"] },
      );
      expect(result.subQuestions).toHaveLength(1);
      expect(result.mergedArmHits).toBeDefined();
    });

    it("mergeSelfAskIntoMainHits 可调用", () => {
      const mainHits = [makeHit("f1", 1.0)];
      const selfAskHits = [makeHit("f2", 0.5)];
      const merged = mergeSelfAskIntoMainHits(mainHits, selfAskHits, 0.8);
      expect(merged).toHaveLength(2);
    });

    it("computeSelfAskRRF 可调用", () => {
      const hits = [makeHit("f1", 1.0)];
      const result = computeSelfAskRRF(hits, 0.8, 60);
      expect(result).toHaveLength(1);
      expect(result[0].rrfScore).toBeGreaterThan(0);
    });

    it("SelfAskSubQuestion 和 SelfAskMergeResult 类型可用", () => {
      const sq: SelfAskSubQuestion = {
        question: "test",
        retrievedFactIds: [],
        retrievedHits: [],
      };
      const smr: SelfAskMergeResult = {
        subQuestions: [sq],
        mergedArmHits: [],
        reasoningHints: [],
      };
      expect(smr.subQuestions).toHaveLength(1);
      expect(smr.mergedArmHits).toHaveLength(0);
      void sq; // 避免未使用警告
    });
  });

  describe("Phase 4: unified-judge.ts", () => {
    it("buildUnifiedJudgePrompt 可调用", () => {
      const { system, user } = buildUnifiedJudgePrompt("q", "gold", "pred", "temporal");
      expect(system).toContain("CORRECT");
      expect(user).toContain("q");
    });

    it("getCategorySpecificPrompt 可调用", () => {
      const prompt = getCategorySpecificPrompt("temporal");
      expect(prompt).toContain("off-by-one");
    });

    it("parseUnifiedJudgeVerdict 可调用", () => {
      const result = parseUnifiedJudgeVerdict("CORRECT");
      expect(result.verdict).toBe("CORRECT");
    });

    it("deterministicJudge 可调用", () => {
      const result = deterministicJudge("engineer", "engineer");
      expect(result.verdict).toBe("CORRECT");
    });

    it("compareJudgeResults 可调用", () => {
      const unified: JudgeResult[] = [{ verdict: "CORRECT", confidence: 1.0 }];
      const frozen = [{ score: 1 }];
      const cmp = compareJudgeResults(unified, frozen);
      expect(cmp.agreementRate).toBe(1.0);
    });

    it("judgeWithUnifiedPrompt 可调用", async () => {
      const result = await judgeWithUnifiedPrompt("q", "gold", "gold", "single_hop");
      expect(result.verdict).toBe("CORRECT");
    });

    it("UNIFIED_JUDGE_CONFIG / JudgeConfig / JudgeResult / JudgeCategory 类型可用", () => {
      const config: JudgeConfig = UNIFIED_JUDGE_CONFIG;
      expect(config.promptVersion).toBe("unified-v2-generous-7rules-2026-07-05");
      const cat: JudgeCategory = "temporal";
      expect(cat).toBe("temporal");
      const result: JudgeResult = { verdict: "CORRECT", confidence: 1.0 };
      expect(result.verdict).toBe("CORRECT");
    });
  });
});

// === 2. End-to-End: 四个 Phase 串联调用 ===

describe("Phase Integration — End-to-End Pipeline", () => {
  it("Phase 1 → Phase 2: classifyQuery 产生的 QueryPlan 能被 rewriteQueryForRetrieval 消费", async () => {
    // Phase 1: 分类
    const plan = await classifyQuery("When did Alice start surfing?");
    expect(plan.type).toBe("temporal");

    // Phase 2: 用 Phase 1 的 QueryPlan 重写 query
    const rewritten = await rewriteQueryForRetrieval(
      "When did Alice start surfing?",
      ["Alice started surfing in 2020"],
      plan,
    );
    expect(rewritten).not.toBe("When did Alice start surfing?");
    expect(typeof rewritten).toBe("string");
  });

  it("Phase 1 → Phase 3: multi_hop 的 QueryPlan.subQuestions 能被 selfAskDecomposeAndMerge 消费", async () => {
    // Phase 1: 分类 multi_hop query（用 buildQueryPlan 构造，因为无 LLM key）
    const plan = buildQueryPlan("multi_hop", "Compare Alice and Bob", undefined, [
      "Who is Alice?",
      "Who is Bob?",
    ]);
    expect(plan.type).toBe("multi_hop");
    expect(plan.subQuestions).toHaveLength(2);
    expect(plan.armWeights.selfAsk).toBe(0.8);

    // Phase 3: 用 Phase 1 的 subQuestions 和 armWeights
    const result = await selfAskDecomposeAndMerge(
      "Compare Alice and Bob",
      async (subQ) => {
        if (subQ.includes("Alice")) return [makeHit("alice-fact", 1.0)];
        if (subQ.includes("Bob")) return [makeHit("bob-fact", 1.0)];
        return [];
      },
      {
        precomputedSubQuestions: plan.subQuestions,
        armWeight: plan.armWeights.selfAsk,
      },
    );

    expect(result.subQuestions).toHaveLength(2);
    expect(result.mergedArmHits).toHaveLength(2);
    const factIds = result.mergedArmHits.map((h) => h.fact.factId).sort();
    expect(factIds).toEqual(["alice-fact", "bob-fact"]);
  });

  it("Phase 3 → 主 pipeline: mergeSelfAskIntoMainHits 能合并到主 hits", () => {
    const mainHits = [makeHit("main-1", 1.0, 0.9), makeHit("main-2", 0.8, 0.7)];
    const selfAskHits = [
      makeHit("main-1", 0.5), // 与主 hits 重叠，应 boost
      makeHit("selfask-only", 0.6), // 新 candidate
    ];

    const merged = mergeSelfAskIntoMainHits(mainHits, selfAskHits, 0.8);
    expect(merged.length).toBeGreaterThanOrEqual(2); // 至少包含主 hits

    // main-1 应被 boost
    const main1 = merged.find((h) => h.fact.factId === "main-1");
    expect(main1!.rrfScore).toBeGreaterThan(1.0);

    // selfask-only 应作为新 candidate
    const selfAskOnly = merged.find((h) => h.fact.factId === "selfask-only");
    expect(selfAskOnly).toBeDefined();
  });

  it("Phase 1 → Phase 4: QueryType 能作为 JudgeCategory 传给 judgeWithUnifiedPrompt", async () => {
    // Phase 1: 分类
    const plan = await classifyQuery("When did Alice start surfing?");
    const queryType: QueryType = plan.type;

    // Phase 4: 用 Phase 1 的 type 作为 JudgeCategory
    const result = await judgeWithUnifiedPrompt(
      "When did Alice start surfing?",
      "Alice started surfing in 2020",
      "Alice started surfing in 2020",
      queryType, // QueryType 兼容 JudgeCategory
    );
    expect(result.verdict).toBe("CORRECT");
  });

  it("Phase 2 → Phase 4: feedback loop 重写后仍能用 unified judge 评判", async () => {
    // Phase 1
    const plan = await classifyQuery("When did Alice start surfing?");

    // Phase 2: 重写 query
    const rewritten = await rewriteQueryForRetrieval(
      "When did Alice start surfing?",
      ["Alice started surfing in 2020"],
      plan,
    );

    // Phase 4: 评判（用重写后的 query 检索结果）
    const result = await judgeWithUnifiedPrompt(
      rewritten,
      "Alice started surfing in 2020",
      "Alice started surfing in 2020",
      plan.type,
    );
    expect(result.verdict).toBe("CORRECT");
  });

  it("完整流程: Phase 1 → 2 → 3 → 4 串联", async () => {
    // === Phase 1: 分类 ===
    const plan = await classifyQuery("When did Alice start surfing?");
    expect(plan.type).toBe("temporal");

    // === Phase 2: feedback loop（模拟 INSUFFICIENT 触发重检索）===
    const initial: RetrievalResult = {
      hits: [],
      episodicHits: [],
      assembledContext: "no useful context",
      retrievedFacts: [],
    };
    const feedbackResult = await retrieveWithFeedbackLoop(
      "When did Alice start surfing?",
      initial,
      {
        queryPlan: plan,
        goldEvidence: ["Alice started surfing in 2020"],
        maxIterations: 2,
      },
      async () => ({
        hits: [makeHit("f1", 1.0, 0.9)],
        episodicHits: [],
        assembledContext: "Alice started surfing in 2020",
        retrievedFacts: [makeFact("f1", "Alice", "started surfing in 2020")],
      }),
    );
    expect(feedbackResult.iterations).toBe(2); // INSUFFICIENT → 重检索 → COMPLETE
    expect(feedbackResult.finalCompleteness).toBe("COMPLETE");

    // === Phase 3: self-ask merge（如果是 multi_hop，但这里是 temporal，跳过）===
    if (plan.type === "multi_hop") {
      const selfAskResult = await selfAskDecomposeAndMerge(
        "When did Alice start surfing?",
        async () => [makeHit("f1", 1.0)],
        { precomputedSubQuestions: plan.subQuestions ?? [plan.rewriteHint ?? "test"] },
      );
      expect(selfAskResult.mergedArmHits).toBeDefined();
    }

    // === Phase 4: unified judge ===
    const judgeResult = await judgeWithUnifiedPrompt(
      "When did Alice start surfing?",
      "Alice started surfing in 2020",
      "Alice started surfing in 2020",
      plan.type,
    );
    expect(judgeResult.verdict).toBe("CORRECT");
  });
});

// === 3. 主 Pipeline Import 验证 ===

describe("Phase Integration — 主 Pipeline Import 验证", () => {
  const mainPipelinePath = resolve(
    __dirname,
    "runtime-memory-locomo-full-500.test.ts",
  );
  const mainPipelineContent = readFileSync(mainPipelinePath, "utf-8");

  it("主 pipeline import 了 Phase 1 的 classifyQuery", () => {
    expect(mainPipelineContent).toContain('classifyQuery');
    expect(mainPipelineContent).toContain('from "./helpers/query-classifier"');
  });

  it("主 pipeline import 了 Phase 2 的 rewriteQueryForRetrieval", () => {
    expect(mainPipelineContent).toContain('rewriteQueryForRetrieval');
    expect(mainPipelineContent).toContain('from "./helpers/retrieval-feedback-loop"');
  });

  it("主 pipeline import 了 Phase 3 的 selfAskDecomposeAndMerge 和 mergeSelfAskIntoMainHits", () => {
    expect(mainPipelineContent).toContain('selfAskDecomposeAndMerge');
    expect(mainPipelineContent).toContain('mergeSelfAskIntoMainHits');
    expect(mainPipelineContent).toContain('from "./helpers/self-ask-merge"');
  });

  it("主 pipeline import 了 Phase 4 的 judgeWithUnifiedPrompt 和 compareJudgeResults", () => {
    expect(mainPipelineContent).toContain('judgeWithUnifiedPrompt');
    expect(mainPipelineContent).toContain('compareJudgeResults');
    expect(mainPipelineContent).toContain('from "./helpers/unified-judge"');
  });

  it("主 pipeline 调用了 classifyQuery（不只是 import）", () => {
    // 查找 classifyQuery( 调用（import 行用逗号不用括号，所以匹配到 1 次即说明被调用）
    const callPattern = /classifyQuery\s*\(/;
    const matches = mainPipelineContent.match(new RegExp(callPattern, "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("主 pipeline 调用了 rewriteQueryForRetrieval（不只是 import）", () => {
    const callPattern = /rewriteQueryForRetrieval\s*\(/;
    const matches = mainPipelineContent.match(new RegExp(callPattern, "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("主 pipeline 调用了 selfAskDecomposeAndMerge（不只是 import）", () => {
    const callPattern = /selfAskDecomposeAndMerge\s*\(/;
    const matches = mainPipelineContent.match(new RegExp(callPattern, "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("主 pipeline 调用了 mergeSelfAskIntoMainHits（不只是 import）", () => {
    const callPattern = /mergeSelfAskIntoMainHits\s*\(/;
    const matches = mainPipelineContent.match(new RegExp(callPattern, "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("主 pipeline 调用了 judgeWithUnifiedPrompt（不只是 import）", () => {
    const callPattern = /judgeWithUnifiedPrompt\s*\(/;
    const matches = mainPipelineContent.match(new RegExp(callPattern, "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("主 pipeline 调用了 compareJudgeResults（不只是 import）", () => {
    const callPattern = /compareJudgeResults\s*\(/;
    const matches = mainPipelineContent.match(new RegExp(callPattern, "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

// === 4. Diagnostic-Only 函数清单（设计上未激活）===
//
// 这些函数已实现且被单元测试覆盖，但主 pipeline 未实际调用
// （diagnostic mode 设计决定，等待 150q 验证后激活）：

describe("Phase Integration — Diagnostic-Only 函数清单", () => {
  it("retrieveWithFeedbackLoop: 主 pipeline 未调用（diagnostic mode）", () => {
    const mainPipelineContent = readFileSync(
      resolve(__dirname, "runtime-memory-locomo-full-500.test.ts"),
      "utf-8",
    );
    // retrieveWithFeedbackLoop 未被 import（主 pipeline 只用 rewriteQueryForRetrieval）
    expect(mainPipelineContent).not.toContain('retrieveWithFeedbackLoop');
  });

  it("mergeRetrievalResults: 主 pipeline 未调用（diagnostic mode）", () => {
    const mainPipelineContent = readFileSync(
      resolve(__dirname, "runtime-memory-locomo-full-500.test.ts"),
      "utf-8",
    );
    expect(mainPipelineContent).not.toContain('mergeRetrievalResults');
  });

  it("getCategorySpecificPrompt: 主 pipeline 未调用（public API 保留）", () => {
    const mainPipelineContent = readFileSync(
      resolve(__dirname, "runtime-memory-locomo-full-500.test.ts"),
      "utf-8",
    );
    expect(mainPipelineContent).not.toContain('getCategorySpecificPrompt');
  });

  it("rewriteQueryDeterministic: 主 pipeline 未直接调用（被 rewriteQueryForRetrieval 内部调用）", () => {
    const mainPipelineContent = readFileSync(
      resolve(__dirname, "runtime-memory-locomo-full-500.test.ts"),
      "utf-8",
    );
    expect(mainPipelineContent).not.toContain('rewriteQueryDeterministic');
  });

  it("computeSelfAskRRF: 主 pipeline 未直接调用（被 selfAskDecomposeAndMerge 内部调用）", () => {
    const mainPipelineContent = readFileSync(
      resolve(__dirname, "runtime-memory-locomo-full-500.test.ts"),
      "utf-8",
    );
    expect(mainPipelineContent).not.toContain('computeSelfAskRRF');
  });

  it("buildUnifiedJudgePrompt: 主 pipeline 未直接调用（被 judgeWithUnifiedPrompt 内部调用）", () => {
    const mainPipelineContent = readFileSync(
      resolve(__dirname, "runtime-memory-locomo-full-500.test.ts"),
      "utf-8",
    );
    expect(mainPipelineContent).not.toContain('buildUnifiedJudgePrompt');
  });

  it("parseUnifiedJudgeVerdict: 主 pipeline 未直接调用（被 judgeWithVoting 内部调用）", () => {
    const mainPipelineContent = readFileSync(
      resolve(__dirname, "runtime-memory-locomo-full-500.test.ts"),
      "utf-8",
    );
    expect(mainPipelineContent).not.toContain('parseUnifiedJudgeVerdict');
  });

  it("judgeWithVoting: 主 pipeline 未直接调用（被 judgeWithUnifiedPrompt 内部调用）", () => {
    const mainPipelineContent = readFileSync(
      resolve(__dirname, "runtime-memory-locomo-full-500.test.ts"),
      "utf-8",
    );
    expect(mainPipelineContent).not.toContain('judgeWithVoting');
  });

  it("deterministicJudge: 主 pipeline 未直接调用（被 judgeWithUnifiedPrompt 内部调用）", () => {
    const mainPipelineContent = readFileSync(
      resolve(__dirname, "runtime-memory-locomo-full-500.test.ts"),
      "utf-8",
    );
    expect(mainPipelineContent).not.toContain('deterministicJudge');
  });
});

// === 5. 类型兼容性验证 ===

describe("Phase Integration — 类型兼容性验证", () => {
  it("QueryType 兼容 JudgeCategory", () => {
    const qt: QueryType = "temporal";
    const jc: JudgeCategory = qt; // 应该能赋值
    expect(jc).toBe("temporal");
  });

  it("QueryPlan.armWeights.selfAsk 可选（只有 multi_hop_deep 有）", () => {
    const temporalPlan = buildQueryPlan("temporal", "test");
    expect(temporalPlan.armWeights.selfAsk).toBeUndefined();

    const multiHopPlan = buildQueryPlan("multi_hop", "test");
    expect(multiHopPlan.armWeights.selfAsk).toBe(0.8);
  });

  it("QueryPlan.armWeights.temporal 可选（只有 temporal_priority 有）", () => {
    const temporalPlan = buildQueryPlan("temporal", "test");
    expect(temporalPlan.armWeights.temporal).toBe(1.5);

    const singleHopPlan = buildQueryPlan("single_hop", "test");
    expect(singleHopPlan.armWeights.temporal).toBeUndefined();
  });

  it("RetrievalResult 接口与主 pipeline 兼容", () => {
    // 主 pipeline 期望的字段：hits, episodicHits, assembledContext, retrievedFacts
    const result: RetrievalResult = {
      hits: [makeHit("f1", 1.0)],
      episodicHits: [makeEpisodicHit("s1", 0.8)],
      assembledContext: "test context",
      retrievedFacts: [makeFact("f1")],
    };
    expect(result.hits).toBeDefined();
    expect(result.episodicHits).toBeDefined();
    expect(result.assembledContext).toBeDefined();
    expect(result.retrievedFacts).toBeDefined();
  });

  it("FeedbackLoopResult 继承 RetrievalResult", () => {
    const result: FeedbackLoopResult = {
      hits: [],
      episodicHits: [],
      assembledContext: "",
      retrievedFacts: [],
      iterations: 1,
      finalCompleteness: "COMPLETE",
      rewriteHistory: [],
      completenessHistory: ["COMPLETE"],
    };
    // 应该能作为 RetrievalResult 使用
    const asRetrievalResult: RetrievalResult = result;
    expect(asRetrievalResult.hits).toEqual(result.hits);
  });
});
