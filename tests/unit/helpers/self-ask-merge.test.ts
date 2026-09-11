// Phase 3: Self-ask Merge 单元测试
//
// 覆盖：
// 1. selfAskDecomposeAndMerge — 分解/检索/合并主流程 + maxSubQuestions 限制 + precomputed 复用 + 空 query
// 2. mergeSelfAskIntoMainHits — 主 hits boost + self-ask-only 新增 + 排序
// 3. computeSelfAskRRF — RRF 公式 + 去重 + armWeight 应用

import { describe, expect, it } from "vitest";
import type { HybridSearchHit } from "../../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import type { RuntimeMemoryQueryableFact } from "../../../openclaw_runtime/src/runtime-core/memory-context";
import {
  computeSelfAskRRF,
  mergeSelfAskIntoMainHits,
  selfAskDecomposeAndMerge,
} from "./self-ask-merge";

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

// === selfAskDecomposeAndMerge ===

describe("Self-ask Merge — selfAskDecomposeAndMerge", () => {
  it("空 query 返回空结果", async () => {
    const result = await selfAskDecomposeAndMerge("", async () => []);
    expect(result.subQuestions).toHaveLength(0);
    expect(result.mergedArmHits).toHaveLength(0);
    expect(result.reasoningHints).toHaveLength(0);
  });

  it("使用 precomputedSubQuestions 跳过 LLM 分解", async () => {
    const retrieveFn = async (q: string): Promise<HybridSearchHit[]> => {
      // 不同 sub-question 返回不同 hits
      if (q.includes("Who did")) return [makeHit("f1", 1.0, 0.9)];
      if (q.includes("Where does")) return [makeHit("f2", 1.0, 0.9)];
      return [];
    };

    const result = await selfAskDecomposeAndMerge(
      "Where does the friend Caroline met at the support group work?",
      retrieveFn,
      {
        precomputedSubQuestions: [
          "Who did Caroline meet at the support group?",
          "Where does [ANSWER_TO_HOP_1] work?",
        ],
      },
    );

    expect(result.subQuestions).toHaveLength(2);
    expect(result.subQuestions[0].question).toContain("Who did Caroline meet");
    expect(result.subQuestions[1].question).toContain("Where does");
    expect(result.subQuestions[0].retrievedFactIds).toEqual(["f1"]);
    expect(result.subQuestions[1].retrievedFactIds).toEqual(["f2"]);
  });

  it("respects maxSubQuestions 限制", async () => {
    const result = await selfAskDecomposeAndMerge(
      "test query",
      async () => [makeHit("f1", 1.0)],
      {
        precomputedSubQuestions: ["q1", "q2", "q3", "q4", "q5"],
        maxSubQuestions: 2,
      },
    );

    expect(result.subQuestions).toHaveLength(2);
  });

  it("生成 hop answers 作为 reasoningHints", async () => {
    const result = await selfAskDecomposeAndMerge("test query", async () => [makeHit("f1", 1.0)], {
      precomputedSubQuestions: ["Who is Alice?"],
      generateHopAnswer: async () => "Alice is an engineer",
    });

    expect(result.reasoningHints).toEqual(["Alice is an engineer"]);
    expect(result.subQuestions[0].answer).toBe("Alice is an engineer");
  });

  it("无 precomputed 时 fallback 为单 sub-question", async () => {
    const result = await selfAskDecomposeAndMerge(
      "What job did Alice have before becoming a nurse?",
      async () => [makeHit("f1", 1.0)],
    );

    expect(result.subQuestions).toHaveLength(1);
    expect(result.subQuestions[0].question).toBe("What job did Alice have before becoming a nurse?");
  });

  it("sub-question 检索失败时仍返回结果（容错）", async () => {
    let callCount = 0;
    const result = await selfAskDecomposeAndMerge(
      "test query",
      async () => {
        callCount += 1;
        if (callCount === 1) throw new Error("network error");
        return [makeHit("f1", 1.0)];
      },
      {
        precomputedSubQuestions: ["q1", "q2"],
      },
    );

    // 第一个 sub-question 失败，但第二个成功
    expect(result.subQuestions).toHaveLength(2);
    expect(result.subQuestions[0].retrievedFactIds).toHaveLength(0); // 失败
    expect(result.subQuestions[1].retrievedFactIds).toEqual(["f1"]);
  });

  it("合并多个 sub-question 的 hits 到 mergedArmHits", async () => {
    const result = await selfAskDecomposeAndMerge(
      "test query",
      async (q) => {
        if (q === "q1") return [makeHit("f1", 1.0), makeHit("f2", 0.8)];
        if (q === "q2") return [makeHit("f2", 0.5), makeHit("f3", 0.9)]; // f2 重复
        return [];
      },
      {
        precomputedSubQuestions: ["q1", "q2"],
      },
    );

    // f1, f2, f3 三个 unique fact
    expect(result.mergedArmHits).toHaveLength(3);
    const factIds = result.mergedArmHits.map((h) => h.fact.factId).sort();
    expect(factIds).toEqual(["f1", "f2", "f3"]);
  });
});

// === mergeSelfAskIntoMainHits ===

describe("Self-ask Merge — mergeSelfAskIntoMainHits", () => {
  it("主 hits 中已有的 fact 获得分数 boost", () => {
    const mainHits = [
      makeHit("shared", 1.0, 0.9),
      makeHit("main-only", 0.8, 0.7),
    ];
    const selfAskHits = [
      makeHit("shared", 0.5 * (1 / (60 + 0 + 1))), // armWeight=0.5, rank=0
    ];

    const merged = mergeSelfAskIntoMainHits(mainHits, selfAskHits, 0.5);

    const shared = merged.find((h) => h.fact.factId === "shared");
    expect(shared).toBeDefined();
    // 原始 rrfScore=1.0 + self-ask RRF 贡献
    expect(shared!.rrfScore).toBeGreaterThan(1.0);
  });

  it("self-ask 独有的 fact 作为新 candidate 加入", () => {
    const mainHits = [makeHit("f1", 1.0, 0.9)];
    const selfAskHits = [
      makeHit("f2", 0.5 * (1 / (60 + 0 + 1))), // self-ask only
    ];

    const merged = mergeSelfAskIntoMainHits(mainHits, selfAskHits, 0.5);

    expect(merged).toHaveLength(2);
    const factIds = merged.map((h) => h.fact.factId);
    expect(factIds).toContain("f1");
    expect(factIds).toContain("f2");
  });

  it("合并后按 (ceScore ?? rrfScore) 降序排序", () => {
    const mainHits = [
      makeHit("f1", 0.5, 0.8), // ceScore=0.8
      makeHit("f2", 1.0, 0.6), // ceScore=0.6
    ];
    const selfAskHits: HybridSearchHit[] = [];

    const merged = mergeSelfAskIntoMainHits(mainHits, selfAskHits, 0.8);

    // f1 (ceScore=0.8) 应在 f2 (ceScore=0.6) 之前
    expect(merged[0].fact.factId).toBe("f1");
    expect(merged[1].fact.factId).toBe("f2");
  });

  it("空 selfAskHits 返回主 hits 副本", () => {
    const mainHits = [makeHit("f1", 1.0), makeHit("f2", 0.8)];
    const merged = mergeSelfAskIntoMainHits(mainHits, [], 0.8);

    expect(merged).toHaveLength(2);
    expect(merged.map((h) => h.fact.factId)).toEqual(["f1", "f2"]);
    // 应是副本，不是同一引用
    expect(merged).not.toBe(mainHits);
  });

  it("ceScore 取较大值", () => {
    const mainHits = [makeHit("shared", 1.0, 0.7)];
    const selfAskHits = [makeHit("shared", 0.5, 0.95)];

    const merged = mergeSelfAskIntoMainHits(mainHits, selfAskHits, 0.5);
    const shared = merged.find((h) => h.fact.factId === "shared");
    expect(shared!.ceScore).toBe(0.95);
  });

  it("不 mutate 输入的 mainHits", () => {
    const mainHits = [makeHit("f1", 1.0)];
    const originalScore = mainHits[0].rrfScore;
    const selfAskHits = [makeHit("f1", 0.5 * (1 / 61))];

    mergeSelfAskIntoMainHits(mainHits, selfAskHits, 0.5);

    // 原 mainHits 不应被修改
    expect(mainHits[0].rrfScore).toBe(originalScore);
  });
});

// === computeSelfAskRRF ===

describe("Self-ask Merge — computeSelfAskRRF", () => {
  it("应用 armWeight 到 RRF 分数", () => {
    const hits = [makeHit("f1", 999)]; // 原 rrfScore 不重要，会被覆盖

    const result = computeSelfAskRRF(hits, 0.8, 60);

    // rrf = 0.8 × (1 / (60 + 0 + 1)) = 0.8 / 61
    expect(result[0].rrfScore).toBeCloseTo(0.8 / 61, 10);
  });

  it("按 factId 去重，保留首次出现（最佳 rank）", () => {
    const hits = [
      makeHit("f1", 1.0),
      makeHit("f2", 0.8),
      makeHit("f1", 0.5), // 重复，应被去重
      makeHit("f3", 0.6),
    ];

    const result = computeSelfAskRRF(hits, 1.0, 60);

    expect(result).toHaveLength(3);
    const factIds = result.map((h) => h.fact.factId);
    expect(factIds).toContain("f1");
    expect(factIds).toContain("f2");
    expect(factIds).toContain("f3");
  });

  it("RRF 分数按 rank 递减（rank 越小分数越高）", () => {
    const hits = [makeHit("f1", 1.0), makeHit("f2", 0.8), makeHit("f3", 0.6)];

    const result = computeSelfAskRRF(hits, 1.0, 60);

    // f1 (rank=0) > f2 (rank=1) > f3 (rank=2)
    expect(result[0].fact.factId).toBe("f1");
    expect(result[1].fact.factId).toBe("f2");
    expect(result[2].fact.factId).toBe("f3");
    expect(result[0].rrfScore).toBeGreaterThan(result[1].rrfScore);
    expect(result[1].rrfScore).toBeGreaterThan(result[2].rrfScore);
  });

  it("空数组返回空结果", () => {
    const result = computeSelfAskRRF([], 0.8, 60);
    expect(result).toHaveLength(0);
  });

  it("k 参数影响分数但不影响排序", () => {
    const hits = [makeHit("f1", 1.0), makeHit("f2", 0.8)];

    const resultK60 = computeSelfAskRRF(hits, 1.0, 60);
    const resultK10 = computeSelfAskRRF(hits, 1.0, 10);

    // 排序相同
    expect(resultK60[0].fact.factId).toBe(resultK10[0].fact.factId);
    // k=10 分数更高（分母更小）
    expect(resultK10[0].rrfScore).toBeGreaterThan(resultK60[0].rrfScore);
  });
});
