// Phase 2: Retrieval Feedback Loop 单元测试
//
// 覆盖：
// 1. retrieveWithFeedbackLoop — COMPLETE 立即返回 / INSUFFICIENT 触发重检索 / maxIterations 限制 / 无 goldEvidence 跳过
// 2. mergeRetrievalResults — factId 去重 / episodic sentence_id 去重 / RRF 分数累加
// 3. rewriteQueryDeterministic — temporal / multi_hop / open_domain / single_hop 策略
// 4. rewriteQueryForRetrieval — 空 query 处理

import { describe, expect, it } from "vitest";
import type { HybridSearchHit } from "../../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import type { RuntimeMemoryQueryableFact } from "../../../openclaw_runtime/src/runtime-core/memory-context";
import type { EpisodicHit, EpisodicSentence } from "./episodic-memory";
import {
  buildQueryPlan,
  type QueryPlan,
} from "./query-classifier";
import {
  mergeRetrievalResults,
  retrieveWithFeedbackLoop,
  rewriteQueryDeterministic,
  rewriteQueryForRetrieval,
  type RetrievalResult,
} from "./retrieval-feedback-loop";

// === Fixtures ===

function makeFact(factId: string, subject: string, summary: string): RuntimeMemoryQueryableFact {
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
  } as RuntimeMemoryQueryableFact;
}

function makeHit(
  factId: string,
  rrfScore: number,
  ceScore?: number,
  subject = "Alice",
  summary = "is engineer",
): HybridSearchHit {
  return {
    fact: makeFact(factId, subject, summary),
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

function makeSentence(
  sentenceId: string,
  text: string,
  sessionId = "session-1",
): EpisodicSentence {
  return {
    sentence_id: sentenceId,
    turn_id: "turn-1",
    session_id: sessionId,
    speaker: "user",
    text,
    turn_text: text,
    timestamp: 0,
    turn_index: 0,
    sentence_index: 0,
  };
}

function makeEpisodicHit(sentenceId: string, rrfScore: number, text = ""): EpisodicHit {
  return {
    sentence: makeSentence(sentenceId, text),
    rrfScore,
    vectorRank: null,
    bm25Rank: null,
    vectorScore: 0,
    bm25Score: 0,
  };
}

function makeResult(
  hits: HybridSearchHit[],
  context: string,
  facts?: RuntimeMemoryQueryableFact[],
  episodicHits: EpisodicHit[] = [],
): RetrievalResult {
  return {
    hits,
    episodicHits,
    assembledContext: context,
    retrievedFacts: facts ?? hits.map((h) => h.fact),
  };
}

const STANDARD_PLAN: QueryPlan = buildQueryPlan("single_hop", "test query");
const TEMPORAL_PLAN: QueryPlan = buildQueryPlan("temporal", "when did alice start?");
const MULTI_HOP_PLAN: QueryPlan = buildQueryPlan("multi_hop", "compare alice and bob");
const OPEN_DOMAIN_PLAN: QueryPlan = buildQueryPlan("open_domain", "tell me about alice");

// === retrieveWithFeedbackLoop ===

describe("Retrieval Feedback Loop — retrieveWithFeedbackLoop", () => {
  it("completeness COMPLETE 时立即返回（iterations=1）", async () => {
    // context 包含 gold evidence → COMPLETE
    const initial = makeResult(
      [makeHit("f1", 1.0, 0.9, "Alice", "started surfing in 2020")],
      "Alice started surfing in 2020.",
    );

    const result = await retrieveWithFeedbackLoop(
      "When did Alice start surfing?",
      initial,
      {
        queryPlan: TEMPORAL_PLAN,
        goldEvidence: ["Alice started surfing in 2020"],
        maxIterations: 3,
      },
      async () => {
        throw new Error("不应该调用 retrieveFn");
      },
    );

    expect(result.iterations).toBe(1);
    expect(result.finalCompleteness).toBe("COMPLETE");
    expect(result.rewriteHistory).toHaveLength(0);
    expect(result.completenessHistory).toEqual(["COMPLETE"]);
  });

  it("completeness INSUFFICIENT 触发重检索（iterations=2）", async () => {
    // 初始 context 不包含 gold evidence → INSUFFICIENT
    // 重检索后 context 包含 gold evidence → COMPLETE
    const initial = makeResult(
      [makeHit("f1", 1.0, 0.9, "Alice", "is engineer")],
      "Alice is an engineer.",
    );

    let retrieveFnCallCount = 0;
    const result = await retrieveWithFeedbackLoop(
      "When did Alice start surfing?",
      initial,
      {
        queryPlan: TEMPORAL_PLAN,
        goldEvidence: ["Alice started surfing in 2020"],
        maxIterations: 3,
      },
      async () => {
        retrieveFnCallCount += 1;
        return makeResult(
          [makeHit("f2", 1.5, 0.95, "Alice", "started surfing in 2020")],
          "Alice started surfing in 2020.",
        );
      },
    );

    expect(retrieveFnCallCount).toBe(1);
    expect(result.iterations).toBe(2);
    expect(result.finalCompleteness).toBe("COMPLETE");
    expect(result.rewriteHistory).toHaveLength(1);
    expect(result.completenessHistory).toEqual(["INSUFFICIENT", "COMPLETE"]);
  });

  it("respects maxIterations（始终 INSUFFICIENT 时不超过 maxIterations）", async () => {
    const initial = makeResult([], "no useful context here");

    let retrieveFnCallCount = 0;
    const result = await retrieveWithFeedbackLoop(
      "When did Alice start surfing?",
      initial,
      {
        queryPlan: TEMPORAL_PLAN,
        goldEvidence: ["Alice started surfing in 2020"],
        maxIterations: 2,
      },
      async () => {
        retrieveFnCallCount += 1;
        // 始终返回不相关的 context（不含 gold evidence token）
        return makeResult([], "Bob is a teacher. Carol is a designer.");
      },
    );

    // maxIterations=2 → 1 次初始 + 1 次重检索 = 2 次
    expect(retrieveFnCallCount).toBe(1);
    expect(result.iterations).toBe(2);
    expect(result.finalCompleteness).toBe("INSUFFICIENT");
    expect(result.rewriteHistory).toHaveLength(1);
  });

  it("threshold=PARTIAL 时 PARTIAL 不触发重检索", async () => {
    // PARTIAL: 50%-80% gold evidence matched
    const initial = makeResult(
      [makeHit("f1", 1.0, 0.9, "Alice", "started surfing in 2020")],
      "Alice started surfing in 2020.", // 命中 1/2 evidence
    );

    let retrieveFnCallCount = 0;
    const result = await retrieveWithFeedbackLoop(
      "When did Alice start surfing?",
      initial,
      {
        queryPlan: TEMPORAL_PLAN,
        goldEvidence: ["Alice started surfing in 2020", "Alice won a medal in 2021"],
        completenessThreshold: "PARTIAL",
        maxIterations: 3,
      },
      async () => {
        retrieveFnCallCount += 1;
        return makeResult([], "should not be called");
      },
    );

    // PARTIAL 满足 threshold=PARTIAL → 不重检索
    expect(retrieveFnCallCount).toBe(0);
    expect(result.iterations).toBe(1);
    expect(result.finalCompleteness).toBe("PARTIAL");
  });

  it("无 goldEvidence 时直接返回（避免误触发）", async () => {
    const initial = makeResult(
      [makeHit("f1", 1.0)],
      "some context without gold evidence",
    );

    const result = await retrieveWithFeedbackLoop(
      "any query",
      initial,
      {
        queryPlan: STANDARD_PLAN,
        // goldEvidence 缺失
        maxIterations: 3,
      },
      async () => {
        throw new Error("不应该调用 retrieveFn");
      },
    );

    expect(result.iterations).toBe(1);
    expect(result.finalCompleteness).toBe("COMPLETE");
    expect(result.rewriteHistory).toHaveLength(0);
  });

  it("重检索后结果被合并（hits 包含初始+重检索的 fact）", async () => {
    const initial = makeResult(
      [makeHit("f1", 1.0, 0.9, "Alice", "is engineer")],
      "Alice is an engineer.",
    );

    const result = await retrieveWithFeedbackLoop(
      "When did Alice start surfing?",
      initial,
      {
        queryPlan: TEMPORAL_PLAN,
        goldEvidence: ["Alice started surfing in 2020"],
        maxIterations: 2,
      },
      async () => {
        return makeResult(
          [makeHit("f2", 1.5, 0.95, "Alice", "started surfing in 2020")],
          "Alice started surfing in 2020.",
        );
      },
    );

    // 合并后应包含 f1 和 f2 两个 fact
    const factIds = result.hits.map((h) => h.fact.factId);
    expect(factIds).toContain("f1");
    expect(factIds).toContain("f2");
    // f2 的 rrfScore 应保持原值（f1 不在新结果中，不累加）
    const f2 = result.hits.find((h) => h.fact.factId === "f2");
    expect(f2?.rrfScore).toBe(1.5);
  });
});

// === mergeRetrievalResults ===

describe("Retrieval Feedback Loop — mergeRetrievalResults", () => {
  it("按 factId 去重 hits", () => {
    const r1 = makeResult(
      [makeHit("f1", 1.0), makeHit("f2", 0.8)],
      "context 1",
    );
    const r2 = makeResult(
      [makeHit("f2", 0.5), makeHit("f3", 0.9)],
      "context 2",
    );

    const merged = mergeRetrievalResults([r1, r2]);
    const factIds = merged.hits.map((h) => h.fact.factId);
    expect(factIds).toEqual(["f2", "f1", "f3"]); // f2 rrfScore=1.3 最高
    expect(new Set(factIds).size).toBe(factIds.length); // 无重复
  });

  it("重复 fact 的 rrfScore 累加", () => {
    const r1 = makeResult([makeHit("f1", 1.0)], "ctx1");
    const r2 = makeResult([makeHit("f1", 0.5)], "ctx2");

    const merged = mergeRetrievalResults([r1, r2]);
    expect(merged.hits).toHaveLength(1);
    expect(merged.hits[0].rrfScore).toBe(1.5); // 1.0 + 0.5
  });

  it("ceScore 取较大值", () => {
    const r1 = makeResult([makeHit("f1", 1.0, 0.7)], "ctx1");
    const r2 = makeResult([makeHit("f1", 0.5, 0.9)], "ctx2");

    const merged = mergeRetrievalResults([r1, r2]);
    expect(merged.hits[0].ceScore).toBe(0.9);
  });

  it("按 sentence_id 去重 episodicHits", () => {
    const r1 = makeResult(
      [makeHit("f1", 1.0)],
      "ctx1",
      undefined,
      [makeEpisodicHit("s1", 0.8, "alice started surfing")],
    );
    const r2 = makeResult(
      [makeHit("f2", 1.0)],
      "ctx2",
      undefined,
      [
        makeEpisodicHit("s1", 0.9, "alice started surfing"), // 同 sentence_id, 更高 rrfScore
        makeEpisodicHit("s2", 0.7, "alice won medal"),
      ],
    );

    const merged = mergeRetrievalResults([r1, r2]);
    expect(merged.episodicHits).toHaveLength(2);
    const s1 = merged.episodicHits.find((e) => e.sentence.sentence_id === "s1");
    expect(s1?.rrfScore).toBe(0.9); // 取较大值
  });

  it("retrievedFacts 按 factId 去重", () => {
    const r1 = makeResult(
      [makeHit("f1", 1.0)],
      "ctx1",
      [makeFact("f1", "Alice", "is engineer")],
    );
    const r2 = makeResult(
      [makeHit("f1", 0.5), makeHit("f2", 0.8)],
      "ctx2",
      [
        makeFact("f1", "Alice", "is engineer"), // 重复
        makeFact("f2", "Bob", "is teacher"),
      ],
    );

    const merged = mergeRetrievalResults([r1, r2]);
    expect(merged.retrievedFacts).toHaveLength(2);
    const factIds = merged.retrievedFacts.map((f) => f.factId);
    expect(new Set(factIds).size).toBe(factIds.length);
  });

  it("assembledContext 去重拼接", () => {
    const r1 = makeResult([makeHit("f1", 1.0)], "Alice is engineer.\nBob is teacher.");
    const r2 = makeResult([makeHit("f2", 1.0)], "Bob is teacher.\nCarol is designer.");

    const merged = mergeRetrievalResults([r1, r2]);
    const lines = merged.assembledContext.split("\n");
    // "Bob is teacher." 不应重复
    const bobCount = lines.filter((l) => l === "Bob is teacher.").length;
    expect(bobCount).toBe(1);
  });

  it("空数组返回空结果", () => {
    const merged = mergeRetrievalResults([]);
    expect(merged.hits).toHaveLength(0);
    expect(merged.episodicHits).toHaveLength(0);
    expect(merged.assembledContext).toBe("");
    expect(merged.retrievedFacts).toHaveLength(0);
  });

  it("单元素数组直接返回", () => {
    const r1 = makeResult([makeHit("f1", 1.0)], "ctx1");
    const merged = mergeRetrievalResults([r1]);
    expect(merged).toBe(r1);
  });
});

// === rewriteQueryDeterministic ===

describe("Retrieval Feedback Loop — rewriteQueryDeterministic", () => {
  it("temporal 类型扩展时间相关同义词", () => {
    const rewritten = rewriteQueryDeterministic(
      "When did Alice start surfing?",
      ["Alice started surfing in 2020"],
      TEMPORAL_PLAN,
    );
    // 应包含 "date" 或 "time"（temporal 同义词扩展）
    expect(rewritten.toLowerCase()).toMatch(/date|time/);
    // 应保留原 query 主体
    expect(rewritten).toContain("Alice");
    expect(rewritten).toContain("surfing");
  });

  it("multi_hop 类型追加缺失证据 token", () => {
    const rewritten = rewriteQueryDeterministic(
      "Compare Alice and Bob",
      ["Alice works at Google", "Bob works at Microsoft"],
      MULTI_HOP_PLAN,
    );
    // 应追加 evidence 中的关键 token（google / microsoft）
    expect(rewritten.toLowerCase()).toMatch(/google|microsoft/);
  });

  it("open_domain 类型移除宽泛短语", () => {
    const rewritten = rewriteQueryDeterministic(
      "Tell me about Alice's hobbies",
      ["Alice likes hiking"],
      OPEN_DOMAIN_PLAN,
    );
    // 不应再包含 "tell me about"
    expect(rewritten.toLowerCase()).not.toMatch(/tell me about/);
    // 应保留 "Alice" 和 "hobbies"
    expect(rewritten).toContain("Alice");
    expect(rewritten).toContain("hobbies");
  });

  it("single_hop 类型同义词替换", () => {
    const rewritten = rewriteQueryDeterministic(
      "What is Alice's job?",
      ["Alice is an engineer"],
      STANDARD_PLAN,
    );
    // "job" 应被替换为 "job work occupation profession" 之一
    expect(rewritten.toLowerCase()).toMatch(/work|occupation|profession/);
  });

  it("空 query 返回空", () => {
    const rewritten = rewriteQueryDeterministic("", [], STANDARD_PLAN);
    expect(rewritten).toBe("");
  });

  it("缺失 evidence 为空时仍按类型重写", () => {
    const rewritten = rewriteQueryDeterministic(
      "When did Alice start?",
      [],
      TEMPORAL_PLAN,
    );
    // 即使无 evidence，temporal 仍应扩展同义词
    expect(rewritten.toLowerCase()).toMatch(/date|time/);
  });
});

// === rewriteQueryForRetrieval（异步） ===

describe("Retrieval Feedback Loop — rewriteQueryForRetrieval", () => {
  it("空 query 返回原值", async () => {
    const rewritten = await rewriteQueryForRetrieval("", ["evidence"], STANDARD_PLAN);
    expect(rewritten).toBe("");
  });

  it("无 DeepSeek key 时回退到确定性策略", async () => {
    // 默认无 key（CI 环境），应使用确定性回退
    const rewritten = await rewriteQueryForRetrieval(
      "When did Alice start surfing?",
      ["Alice started surfing in 2020"],
      TEMPORAL_PLAN,
    );
    // 应该是确定性重写的输出
    const expected = rewriteQueryDeterministic(
      "When did Alice start surfing?",
      ["Alice started surfing in 2020"],
      TEMPORAL_PLAN,
    );
    expect(rewritten).toBe(expected);
  });

  it("重写后的 query 与原 query 不同（temporal 情况）", async () => {
    const rewritten = await rewriteQueryForRetrieval(
      "When did Alice start surfing?",
      ["Alice started surfing in 2020"],
      TEMPORAL_PLAN,
    );
    expect(rewritten).not.toBe("When did Alice start surfing?");
  });
});
