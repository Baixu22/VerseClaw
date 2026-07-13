// @vitest-environment node
// Week 4 v2: 桥发现 + constrained expansion 单元测试.
//
// 覆盖 memory-arch-roadmap.md §B4, §C.4, Week 4 完成定义:
//   1. 桥发现: 从 query 抽取 entity pair, 找同时连接 e1+e2 的桥 fact
//   2. Bridge Lift@K: 第二阶段 expansion top-N 中是否出现 answer-supporting fact
//   3. Path Existence Rate: e1 → e2 是否存在长度 ≤ L 的有效路径
//   4. timeFilteredOutCount: 因 invalid_at < now 被剔除的桥候选数量
//   5. constrained expansion: 从桥 fact 出发 maxDepth=1, cap=5
//   6. causal 边过滤: 仅沿 causal/enables 边扩张
import { describe, expect, it } from "vitest";
import {
  backfillBridgeLiftAtK,
  checkPathExistence,
  computeBridgeId,
  discoverBridges,
  extractEntityPairFromQuery,
  type BridgeDiagnostics,
} from "../../openclaw_runtime/src/runtime-core/memory-bridge-discovery";
import {
  chainedRetrievalExpand,
  constrainedExpansionFromBridge,
} from "../../openclaw_runtime/src/runtime-core/memory-chained-retrieval";
import {
  buildRuntimeMemoryTemporalFactFixture,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

// === Helpers ===

const NOW = Date.UTC(2024, 5, 15);

function makeFact(overrides: {
  factId: string;
  subject: string;
  predicate?: string;
  objectSummary: string;
  entityIds?: string[];
  valid_at?: number;
  invalid_at?: number;
}): ReturnType<typeof buildRuntimeMemoryTemporalFactFixture> {
  const fact = buildRuntimeMemoryTemporalFactFixture({
    factId: overrides.factId,
    subject: overrides.subject,
    predicate: overrides.predicate ?? "related_to",
    objectSummary: overrides.objectSummary,
    valid_at: overrides.valid_at ?? Date.UTC(2020, 0, 1),
    reference_time: overrides.valid_at ?? Date.UTC(2020, 0, 1),
    ...(overrides.invalid_at !== undefined
      ? { invalid_at: overrides.invalid_at }
      : {}),
  });
  // 注入 entityIds (fixture sanitize 不保留, 需手动设置)
  if (overrides.entityIds) {
    (fact as { entityIds?: string[] }).entityIds = overrides.entityIds;
  }
  return fact;
}

function makeHit(factId: string, score: number) {
  const fact = makeFact({
    factId,
    subject: "Jon",
    objectSummary: "test",
  });
  return {
    fact,
    rrfScore: score,
    bm25Rank: 1,
    vectorRank: 1,
    entityRank: null,
    bm25Score: score,
    vectorScore: score,
    entityScore: 0,
  };
}

// === extractEntityPairFromQuery ===
describe("extractEntityPairFromQuery", () => {
  it("extracts two capitalized words as entity pair", () => {
    const pair = extractEntityPairFromQuery(
      "How did Jon meet Mary?",
    );
    expect(pair).not.toBeNull();
    if (pair) {
      expect(pair.e1).toBe("Jon");
      expect(pair.e2).toBe("Mary");
    }
  });

  it("extracts quoted strings as entity pair", () => {
    const pair = extractEntityPairFromQuery(
      'How does "Google" connect to "Apple"?',
    );
    expect(pair).not.toBeNull();
    if (pair) {
      expect(pair.e1).toBe("Google");
      expect(pair.e2).toBe("Apple");
    }
  });

  it("extracts Chinese proper nouns (quoted)", () => {
    const pair = extractEntityPairFromQuery(
      '"张三"和"李四"的关系是什么？',
    );
    expect(pair).not.toBeNull();
    if (pair) {
      expect(pair.e1).toBe("张三");
      expect(pair.e2).toBe("李四");
    }
  });

  it("returns null for insufficient entities", () => {
    expect(extractEntityPairFromQuery("What is this?")).toBeNull();
    expect(extractEntityPairFromQuery("")).toBeNull();
    expect(extractEntityPairFromQuery("Jon")).toBeNull();
  });

  it("filters stop words", () => {
    const pair = extractEntityPairFromQuery(
      "What did Jon do?",
    );
    // "What" 被过滤, "Jon" 保留, 但只剩 1 个 → null
    expect(pair).toBeNull();
  });
});

// === discoverBridges: 桥发现 ===
describe("discoverBridges", () => {
  it("finds direct bridge fact containing both e1 and e2", () => {
    const facts = [
      makeFact({
        factId: "f1",
        subject: "Jon",
        objectSummary: "met Mary at Google",
        entityIds: ["Jon", "Mary", "Google"],
      }),
      makeFact({
        factId: "f2",
        subject: "Jon",
        objectSummary: "works at Google",
        entityIds: ["Jon", "Google"],
      }),
    ];

    const { candidates, diagnostics } = discoverBridges(
      { e1: "Jon", e2: "Mary" },
      facts,
      "strict_current",
      NOW,
    );

    expect(candidates.length).toBeGreaterThan(0);
    // f1 同时含 Jon+Mary → betweennessScore=1.0 (直接桥)
    const f1Candidate = candidates.find((c) => c.factId === "f1");
    expect(f1Candidate).toBeDefined();
    if (f1Candidate) {
      expect(f1Candidate.betweennessScore).toBe(1.0);
    }
    expect(diagnostics.bridgeCandidateCount).toBeGreaterThan(0);
    expect(diagnostics.selectedBridgeFactId).toBe("f1");
    expect(diagnostics.pathLength).toBe(1); // 直接桥
    expect(diagnostics.timeFilteredOutCount).toBe(0);
  });

  it("finds indirect bridge (only e1 or only e2)", () => {
    const facts = [
      makeFact({
        factId: "f1",
        subject: "Jon",
        objectSummary: "works at Google",
        entityIds: ["Jon", "Google"], // 只有 e1=Jon
      }),
      makeFact({
        factId: "f2",
        subject: "Mary",
        objectSummary: "works at Google",
        entityIds: ["Mary", "Google"], // 只有 e2=Mary
      }),
    ];

    const { candidates } = discoverBridges(
      { e1: "Jon", e2: "Mary" },
      facts,
      "strict_current",
      NOW,
    );

    // 没有直接桥 (没有 fact 同时含 Jon+Mary)
    const directBridges = candidates.filter(
      (c) => c.betweennessScore === 1.0,
    );
    expect(directBridges.length).toBe(0);
    // 有间接桥 (f1 含 Jon, f2 含 Mary)
    const indirectBridges = candidates.filter(
      (c) => c.betweennessScore === 0.6,
    );
    expect(indirectBridges.length).toBe(2);
  });

  it("filters out time-invalidated bridge candidates", () => {
    const facts = [
      makeFact({
        factId: "f_valid",
        subject: "Jon",
        objectSummary: "met Mary at Google",
        entityIds: ["Jon", "Mary"],
        valid_at: Date.UTC(2020, 0, 1),
      }),
      makeFact({
        factId: "f_invalid",
        subject: "Jon",
        objectSummary: "met Mary at Apple",
        entityIds: ["Jon", "Mary"],
        valid_at: Date.UTC(2018, 0, 1),
        invalid_at: Date.UTC(2019, 0, 1), // 已失效
      }),
    ];

    const { candidates, diagnostics } = discoverBridges(
      { e1: "Jon", e2: "Mary" },
      facts,
      "strict_current",
      NOW,
    );

    expect(candidates.length).toBe(1);
    expect(candidates[0].factId).toBe("f_valid");
    expect(diagnostics.timeFilteredOutCount).toBe(1);
  });

  it("returns empty candidates when no bridge found", () => {
    const facts = [
      makeFact({
        factId: "f1",
        subject: "Jon",
        objectSummary: "lives in Boston",
        entityIds: ["Jon", "Boston"],
      }),
    ];

    const { candidates, diagnostics } = discoverBridges(
      { e1: "Jon", e2: "Mary" },
      facts,
      "strict_current",
      NOW,
    );

    expect(candidates.length).toBe(1); // f1 含 Jon (间接桥)
    expect(diagnostics.selectedBridgeFactId).toBe("f1");
    expect(diagnostics.bridgeLiftAtK).toBe(0); // 未回填
  });

  it("respects topK option", () => {
    const facts = [
      makeFact({
        factId: "f1",
        subject: "Jon",
        objectSummary: "met Mary",
        entityIds: ["Jon", "Mary"],
      }),
      makeFact({
        factId: "f2",
        subject: "Jon",
        objectSummary: "knows Mary",
        entityIds: ["Jon", "Mary"],
      }),
      makeFact({
        factId: "f3",
        subject: "Jon",
        objectSummary: "met Mary again",
        entityIds: ["Jon", "Mary"],
      }),
    ];

    const { candidates } = discoverBridges(
      { e1: "Jon", e2: "Mary" },
      facts,
      "strict_current",
      NOW,
      { topK: 2 },
    );

    expect(candidates.length).toBe(2);
  });
});

// === Path Existence ===
describe("checkPathExistence", () => {
  it("returns true when direct path exists (e1 → fact → e2)", () => {
    const facts = [
      makeFact({
        factId: "f1",
        subject: "Jon",
        objectSummary: "met Mary",
        entityIds: ["Jon", "Mary"],
      }),
    ];

    const exists = checkPathExistence(
      { e1: "Jon", e2: "Mary" },
      facts,
      3,
      "strict_current",
      NOW,
    );
    expect(exists).toBe(true);
  });

  it("returns true when 2-hop path exists (e1 → fact1 → entity → fact2 → e2)", () => {
    const facts = [
      makeFact({
        factId: "f1",
        subject: "Jon",
        objectSummary: "works at Google",
        entityIds: ["Jon", "Google"],
      }),
      makeFact({
        factId: "f2",
        subject: "Mary",
        objectSummary: "works at Google",
        entityIds: ["Mary", "Google"],
      }),
    ];

    // Jon → f1 → Google → f2 → Mary (2 跳)
    const exists = checkPathExistence(
      { e1: "Jon", e2: "Mary" },
      facts,
      3,
      "strict_current",
      NOW,
    );
    expect(exists).toBe(true);
  });

  it("returns false when no path within maxPathLength", () => {
    const facts = [
      makeFact({
        factId: "f1",
        subject: "Jon",
        objectSummary: "Boston home town",
        entityIds: ["Jon", "Boston"],
      }),
      makeFact({
        factId: "f2",
        subject: "Mary",
        objectSummary: "NYC apartment",
        entityIds: ["Mary", "NYC"],
      }),
    ];

    // Jon 和 Mary 没有共同实体, 无路径
    const exists = checkPathExistence(
      { e1: "Jon", e2: "Mary" },
      facts,
      3,
      "strict_current",
      NOW,
    );
    expect(exists).toBe(false);
  });

  it("respects temporal policy (filters time-invalidated facts)", () => {
    const facts = [
      makeFact({
        factId: "f1",
        subject: "Jon",
        objectSummary: "met Mary",
        entityIds: ["Jon", "Mary"],
        valid_at: Date.UTC(2018, 0, 1),
        invalid_at: Date.UTC(2019, 0, 1), // 已失效
      }),
    ];

    // strict_current: f1 已失效 → 路径不通
    const exists = checkPathExistence(
      { e1: "Jon", e2: "Mary" },
      facts,
      3,
      "strict_current",
      NOW,
    );
    expect(exists).toBe(false);

    // include_history_ranked: 允许历史 fact → 路径通
    const existsHist = checkPathExistence(
      { e1: "Jon", e2: "Mary" },
      facts,
      3,
      "include_history_ranked",
      NOW,
    );
    expect(existsHist).toBe(true);
  });
});

// === backfillBridgeLiftAtK ===
describe("backfillBridgeLiftAtK", () => {
  it("returns lift=1 when expansion top-N contains answer-supporting fact", () => {
    const diagnostics: BridgeDiagnostics = {
      entityPair: { e1: "Jon", e2: "Mary" },
      bridgeCandidateCount: 1,
      timeFilteredOutCount: 0,
      selectedBridgeFactId: "f_bridge",
      pathLength: 1,
      bridgeLiftAtK: 0, // 初始值
      pathExistence: true,
    };

    const updated = backfillBridgeLiftAtK(
      diagnostics,
      ["f_exp1", "f_exp2", "f_exp3"], // expansion top-3
      ["f_exp2"], // ground truth: f_exp2 是 answer-supporting
    );

    expect(updated.bridgeLiftAtK).toBe(1);
  });

  it("returns lift=0 when no overlap", () => {
    const diagnostics: BridgeDiagnostics = {
      entityPair: { e1: "Jon", e2: "Mary" },
      bridgeCandidateCount: 1,
      timeFilteredOutCount: 0,
      selectedBridgeFactId: "f_bridge",
      pathLength: 1,
      bridgeLiftAtK: 0,
      pathExistence: true,
    };

    const updated = backfillBridgeLiftAtK(
      diagnostics,
      ["f_exp1", "f_exp2"],
      ["f_exp3"], // 无交集
    );

    expect(updated.bridgeLiftAtK).toBe(0);
  });
});

// === computeBridgeId ===
describe("computeBridgeId", () => {
  it("deterministic hash of factId + entityPair", () => {
    const id1 = computeBridgeId("f1", { e1: "Jon", e2: "Mary" });
    const id2 = computeBridgeId("f1", { e1: "Jon", e2: "Mary" });
    const id3 = computeBridgeId("f1", { e1: "Mary", e2: "Jon" }); // 不同 entityPair
    const id4 = computeBridgeId("f2", { e1: "Jon", e2: "Mary" }); // 不同 factId

    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id1).not.toBe(id4);
    expect(id1).toMatch(/^bridge_[0-9a-f]+$/);
  });
});

// === chainedRetrievalExpand: Week 4 v2 默认值 ===
describe("chainedRetrievalExpand (Week 4 v2 defaults)", () => {
  it("default maxDepth=1, maxExpansion=5", () => {
    const facts = [
      makeFact({ factId: "f1", subject: "Jon", objectSummary: "a" }),
      makeFact({ factId: "f2", subject: "Jon", objectSummary: "b" }),
      makeFact({ factId: "f3", subject: "Jon", objectSummary: "c" }),
      makeFact({ factId: "f4", subject: "Jon", objectSummary: "d" }),
      makeFact({ factId: "f5", subject: "Jon", objectSummary: "e" }),
      makeFact({ factId: "f6", subject: "Jon", objectSummary: "f" }),
      makeFact({ factId: "f7", subject: "Jon", objectSummary: "g" }),
    ];
    const factsById = new Map(facts.map((f) => [f.factId, f]));
    const relationMap = new Map<string, string[]>();
    relationMap.set("f1", ["f2", "f3", "f4", "f5", "f6", "f7"]);

    const result = chainedRetrievalExpand(
      [makeHit("f1", 0.9)],
      relationMap,
      factsById,
    );

    expect(result.expanded).toBe(true);
    expect(result.expansionFactIds.length).toBe(5); // cap=5
    expect(result.relatedFactCount).toBe(6); // 全部 6 个相关
  });

  it("returns expansionFactIds in result", () => {
    const facts = [
      makeFact({ factId: "f1", subject: "Jon", objectSummary: "a" }),
      makeFact({ factId: "f2", subject: "Jon", objectSummary: "b" }),
    ];
    const factsById = new Map(facts.map((f) => [f.factId, f]));
    const relationMap = new Map<string, string[]>();
    relationMap.set("f1", ["f2"]);

    const result = chainedRetrievalExpand(
      [makeHit("f1", 0.9)],
      relationMap,
      factsById,
    );

    expect(result.expansionFactIds).toEqual(["f2"]);
  });

  it("respects custom maxDepth and maxExpansion", () => {
    const facts = [
      makeFact({ factId: "f1", subject: "Jon", objectSummary: "a" }),
      makeFact({ factId: "f2", subject: "Jon", objectSummary: "b" }),
      makeFact({ factId: "f3", subject: "Jon", objectSummary: "c" }),
    ];
    const factsById = new Map(facts.map((f) => [f.factId, f]));
    const relationMap = new Map<string, string[]>();
    relationMap.set("f1", ["f2"]);
    relationMap.set("f2", ["f3"]);

    const result = chainedRetrievalExpand(
      [makeHit("f1", 0.9)],
      relationMap,
      factsById,
      { maxDepth: 2, maxExpansion: 10 },
    );

    // maxDepth=2: f1 → f2 → f3
    expect(result.expansionFactIds).toContain("f2");
    expect(result.expansionFactIds).toContain("f3");
  });
});

// === constrainedExpansionFromBridge ===
describe("constrainedExpansionFromBridge", () => {
  it("expands from bridge fact with maxDepth=1, cap=5", () => {
    const facts = [
      makeFact({ factId: "f_bridge", subject: "Jon", objectSummary: "met Mary" }),
      makeFact({ factId: "f1", subject: "Jon", objectSummary: "a" }),
      makeFact({ factId: "f2", subject: "Jon", objectSummary: "b" }),
      makeFact({ factId: "f3", subject: "Jon", objectSummary: "c" }),
      makeFact({ factId: "f4", subject: "Jon", objectSummary: "d" }),
      makeFact({ factId: "f5", subject: "Jon", objectSummary: "e" }),
      makeFact({ factId: "f6", subject: "Jon", objectSummary: "f" }),
    ];
    const factsById = new Map(facts.map((f) => [f.factId, f]));
    const relationMap = new Map<string, string[]>();
    relationMap.set("f_bridge", ["f1", "f2", "f3", "f4", "f5", "f6"]);

    const { expansionFactIds, expansionHits } = constrainedExpansionFromBridge(
      ["f_bridge"],
      relationMap,
      factsById,
    );

    expect(expansionFactIds.length).toBe(5); // cap=5
    expect(expansionHits.length).toBe(5);
    // 桥 fact 本身不在 expansion 中
    expect(expansionFactIds).not.toContain("f_bridge");
  });

  it("returns empty when no bridge facts", () => {
    const result = constrainedExpansionFromBridge(
      [],
      new Map(),
      new Map(),
    );
    expect(result.expansionFactIds).toEqual([]);
    expect(result.expansionHits).toEqual([]);
  });

  it("returns empty when bridge fact has no related facts", () => {
    const facts = [
      makeFact({ factId: "f_bridge", subject: "Jon", objectSummary: "isolated" }),
    ];
    const factsById = new Map(facts.map((f) => [f.factId, f]));
    const relationMap = new Map<string, string[]>(); // 无边

    const result = constrainedExpansionFromBridge(
      ["f_bridge"],
      relationMap,
      factsById,
    );
    expect(result.expansionFactIds).toEqual([]);
  });
});

// === 集成: 桥发现 + constrained expansion ===
describe("integration: bridge discovery + constrained expansion", () => {
  it("两阶段 multi-hop: 桥发现 → constrained expansion → Bridge Lift@K", () => {
    // 场景: query "How did Jon meet Mary?"
    // 桥 fact: f_bridge (同时含 Jon+Mary, betweennessScore=1.0)
    // expansion: 从 f_bridge 沿 causal 边找到 f_answer (answer-supporting)
    const facts = [
      makeFact({
        factId: "f_bridge",
        subject: "Jon",
        objectSummary: "met Mary at Google conference",
        entityIds: ["Jon", "Mary", "Google"],
      }),
      makeFact({
        factId: "f_answer",
        subject: "Conference",
        objectSummary: "Google conference was in 2020",
        entityIds: ["Google", "conference"],
      }),
      makeFact({
        factId: "f_unrelated",
        subject: "Jon",
        objectSummary: "likes hiking",
        entityIds: ["hiking"],
      }),
    ];
    const factsById = new Map(facts.map((f) => [f.factId, f]));

    // causal 边: f_bridge → f_answer (causal: 会议导致相遇)
    const causalRelationMap = new Map<string, string[]>();
    causalRelationMap.set("f_bridge", ["f_answer"]);

    // Stage 1: 桥发现
    const { candidates, diagnostics } = discoverBridges(
      { e1: "Jon", e2: "Mary" },
      facts,
      "strict_current",
      NOW,
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(diagnostics.selectedBridgeFactId).toBe("f_bridge");
    expect(diagnostics.pathExistence).toBe(true);

    // Stage 2: constrained expansion
    const { expansionFactIds } = constrainedExpansionFromBridge(
      candidates.map((c) => c.factId),
      causalRelationMap,
      factsById,
    );

    expect(expansionFactIds).toContain("f_answer");
    expect(expansionFactIds).not.toContain("f_unrelated"); // 无 causal 边

    // Stage 3: 回填 Bridge Lift@K
    const finalDiagnostics = backfillBridgeLiftAtK(
      diagnostics,
      expansionFactIds,
      ["f_answer"], // ground truth
    );

    expect(finalDiagnostics.bridgeLiftAtK).toBe(1); // 桥提升了答案可达性
  });
});
