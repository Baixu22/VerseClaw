// @vitest-environment node
// WP3 (Week 7-8): Weighted traversal / causal-aware expansion 单元测试.
//
// 覆盖 memory-bridge-discovery.ts 的 weightedExpansionFromBridge():
//   - 构造小图: related_to 与 causes 两条路径同时存在
//   - 启用 weighted traversal 后, expansion 必须优先 causal 路径
//   - 断言 trace 中 selectedEdges 的 scoreBreakdown 合理
//   - relationType 直方图正确
//   - 时间过滤不通过的候选被剔除 (不入候选)
//   - maxExpansion cap 生效
//   - cePrior 作为 tie-breaker 生效
import { describe, expect, it } from "vitest";
import {
  weightedExpansionFromBridge,
} from "../../openclaw_runtime/src/runtime-core/memory-bridge-discovery.js";
import type { RuntimeMemoryQueryableFact } from "../../openclaw_runtime/src/runtime-core/memory-context.js";
import type { SelectedEdge } from "../../openclaw_runtime/src/runtime-core/memory-trace.js";

// === Helpers ===

function makeFact(
  factId: string,
  subject: string,
  objectSummary: string,
  entityIds: string[],
  validAt = 1000,
  invalidAt?: number,
): RuntimeMemoryQueryableFact {
  return {
    factId,
    subject,
    predicate: "relates_to",
    objectSummary,
    confidence: 0.9,
    valid_at: validAt,
    invalid_at: invalidAt,
    expired_at: undefined,
    reference_time: validAt,
    memoryType: "semantic",
    entities: entityIds,
    proofCount: 1,
    sourceMemoryIds: [],
    topic: "test",
    subTopic: "test",
    attributes: [],
    // bridge discovery 通过 (fact as { entityIds?: string[] }).entityIds 访问
    entityIds,
  } as unknown as RuntimeMemoryQueryableFact;
}

function makeRelation(
  sourceFactId: string,
  targetFactId: string,
  relationType: string,
  confidence = 0.9,
): {
  sourceFactId: string;
  targetFactId: string;
  relationType: string;
  confidence: number;
} {
  return { sourceFactId, targetFactId, relationType, confidence };
}

function buildRelationMap(
  relations: ReadonlyArray<{
    sourceFactId: string;
    targetFactId: string;
    relationType: string;
    confidence: number;
  }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const rel of relations) {
    const arr = map.get(rel.sourceFactId) ?? [];
    arr.push(rel.targetFactId);
    map.set(rel.sourceFactId, arr);
    // 双向 (expansion 是无向的, 邻接表需双向)
    const arr2 = map.get(rel.targetFactId) ?? [];
    arr2.push(rel.sourceFactId);
    map.set(rel.targetFactId, arr2);
  }
  return map;
}

function buildFactsById(
  facts: RuntimeMemoryQueryableFact[],
): Map<string, RuntimeMemoryQueryableFact> {
  const map = new Map<string, RuntimeMemoryQueryableFact>();
  for (const f of facts) map.set(f.factId, f);
  return map;
}

// === WP3: Weighted expansion ===

describe("WP3: Weighted traversal / causal-aware expansion", () => {
  // 1. 核心断言: 同时存在 related_to 与 causes 路径时, expansion 优先 causal
  it("should_prefer_causal_path_over_related_to", () => {
    // 桥 fact = f_bridge
    // 候选 1: f_related (related_to 边, weight=0.2)
    // 候选 2: f_causal (causes 边, weight=1.0)
    // 两者都通过 temporalPolicy, entityOverlap 相同
    const bridge = makeFact("f_bridge", "Bridge", "bridge info", ["e1"]);
    const related = makeFact("f_related", "Related", "related info", ["e2"]);
    const causal = makeFact("f_causal", "Causal", "causal info", ["e2"]);

    const relations = [
      makeRelation("f_bridge", "f_related", "related_to"),
      makeRelation("f_bridge", "f_causal", "causes"),
    ];

    const result = weightedExpansionFromBridge(
      ["f_bridge"],
      buildRelationMap(relations),
      buildFactsById([bridge, related, causal]),
      relations,
      "strict_current",
      2000,
      { maxExpansion: 2 },
    );

    // selectedEdges 非空
    expect(result.selectedEdges).toHaveLength(2);
    // expansionFactIds 包含两个候选
    expect(result.expansionFactIds).toHaveLength(2);

    // 第一个 (top score) 必须是 causal 路径 (f_causal)
    // 因为 causes weight=1.0 > related_to weight=0.2
    expect(result.expansionFactIds[0]).toBe("f_causal");
    expect(result.selectedEdges[0].toFactId).toBe("f_causal");
    expect(result.selectedEdges[0].relationType).toBe("causes");

    // scoreBreakdown 合理: causes 的 relationWeight (1.0) > related_to (0.2)
    const causalEdge = result.selectedEdges[0];
    const relatedEdge = result.selectedEdges[1];
    expect(causalEdge.scoreBreakdown.relationWeight).toBeGreaterThan(
      relatedEdge.scoreBreakdown.relationWeight,
    );
    expect(causalEdge.scoreBreakdown.total).toBeGreaterThan(
      relatedEdge.scoreBreakdown.total,
    );

    // relationType 直方图
    expect(result.relationTypeHistogram).toEqual({
      causes: 1,
      related_to: 1,
    });
  });

  // 2. selectedEdges 的 scoreBreakdown 字段完整
  it("should_have_complete_score_breakdown_in_trace", () => {
    const bridge = makeFact("f_bridge", "Bridge", "bridge info", ["e1", "e2"]);
    const target = makeFact("f_target", "Target", "target info", ["e1", "e3"]);

    const relations = [makeRelation("f_bridge", "f_target", "enables", 0.8)];

    const result = weightedExpansionFromBridge(
      ["f_bridge"],
      buildRelationMap(relations),
      buildFactsById([bridge, target]),
      relations,
      "strict_current",
      2000,
      { maxExpansion: 5 },
    );

    expect(result.selectedEdges).toHaveLength(1);
    const edge: SelectedEdge = result.selectedEdges[0];

    // 必填字段
    expect(edge.fromFactId).toBe("f_bridge");
    expect(edge.toFactId).toBe("f_target");
    expect(edge.relationType).toBe("enables");

    // scoreBreakdown 完整
    expect(edge.scoreBreakdown).toBeDefined();
    expect(typeof edge.scoreBreakdown.relationWeight).toBe("number");
    expect(edge.scoreBreakdown.temporalPass).toBe(1); // 通过时间过滤
    expect(typeof edge.scoreBreakdown.entityOverlap).toBe("number");
    expect(typeof edge.scoreBreakdown.total).toBe("number");

    // enables 的 relationWeight = 0.7 (来自 CAUSAL_EDGE_WEIGHT)
    expect(edge.scoreBreakdown.relationWeight).toBe(0.7);

    // entityOverlap: bridge {e1,e2} ∩ target {e1,e3} = {e1} → 1
    expect(edge.scoreBreakdown.entityOverlap).toBe(1);

    // total = relationWeight * confidence + temporalPass(1) + entityOverlap * 0.5 + cePrior * 0.1
    // = 0.7 * 0.8 + 1 + 1 * 0.5 + 0 = 0.56 + 1 + 0.5 = 2.06
    expect(edge.scoreBreakdown.total).toBeCloseTo(2.06, 2);
  });

  // 3. 时间过滤不通过的候选被剔除 (不入候选)
  it("should_filter_out_time_invalid_candidates", () => {
    const bridge = makeFact("f_bridge", "Bridge", "bridge info", ["e1"]);
    // valid 候选
    const validTarget = makeFact("f_valid", "Valid", "valid info", ["e1"], 1000);
    // invalid 候选 (invalid_at < now, strict_current 下被剔除)
    const invalidTarget = makeFact(
      "f_invalid",
      "Invalid",
      "invalid info",
      ["e1"],
      1000,
      1500, // invalid_at = 1500, now = 2000 → 已失效
    );

    const relations = [
      makeRelation("f_bridge", "f_valid", "causes"),
      makeRelation("f_bridge", "f_invalid", "causes"),
    ];

    const result = weightedExpansionFromBridge(
      ["f_bridge"],
      buildRelationMap(relations),
      buildFactsById([bridge, validTarget, invalidTarget]),
      relations,
      "strict_current",
      2000,
      { maxExpansion: 5 },
    );

    // 只有 valid 候选入选
    expect(result.expansionFactIds).toEqual(["f_valid"]);
    expect(result.selectedEdges).toHaveLength(1);
    expect(result.selectedEdges[0].toFactId).toBe("f_valid");
  });

  // 4. maxExpansion cap 生效 (best-first 截断)
  it("should_cap_at_maxExpansion", () => {
    const bridge = makeFact("f_bridge", "Bridge", "bridge info", ["e1"]);
    // 3 个 causes 候选 + 2 个 related_to 候选 = 5 候选
    // cap=3 → 只保留 top-3 (按 score, causes 优先)
    const targets: RuntimeMemoryQueryableFact[] = [];
    const relations: ReturnType<typeof makeRelation>[] = [];
    for (let i = 0; i < 3; i++) {
      const f = makeFact(`f_c${i}`, `C${i}`, `causal ${i}`, ["e1"]);
      targets.push(f);
      relations.push(makeRelation("f_bridge", `f_c${i}`, "causes"));
    }
    for (let i = 0; i < 2; i++) {
      const f = makeFact(`f_r${i}`, `R${i}`, `related ${i}`, ["e1"]);
      targets.push(f);
      relations.push(makeRelation("f_bridge", `f_r${i}`, "related_to"));
    }

    const result = weightedExpansionFromBridge(
      ["f_bridge"],
      buildRelationMap(relations),
      buildFactsById([bridge, ...targets]),
      relations,
      "strict_current",
      2000,
      { maxExpansion: 3 },
    );

    // cap=3 → 只保留 3 个
    expect(result.expansionFactIds).toHaveLength(3);
    expect(result.selectedEdges).toHaveLength(3);

    // 全部是 causes (因为 causes weight > related_to weight, best-first 优先)
    for (const edge of result.selectedEdges) {
      expect(edge.relationType).toBe("causes");
    }
    expect(result.relationTypeHistogram).toEqual({ causes: 3 });
  });

  // 5. cePrior 作为 tie-breaker (同 relationType 时 ceScore 高的优先)
  it("should_use_cePrior_as_tiebreaker", () => {
    const bridge = makeFact("f_bridge", "Bridge", "bridge info", ["e1"]);
    // 两个 causes 候选, entityOverlap 相同, 但 ceScore 不同
    const t1 = makeFact("f_t1", "T1", "target 1", ["e1"]);
    const t2 = makeFact("f_t2", "T2", "target 2", ["e1"]);

    const relations = [
      makeRelation("f_bridge", "f_t1", "causes"),
      makeRelation("f_bridge", "f_t2", "causes"),
    ];

    // f_t2 的 ceScore 更高
    const ceScores = new Map<string, number>([
      ["f_t1", 0.3],
      ["f_t2", 0.9],
    ]);

    const result = weightedExpansionFromBridge(
      ["f_bridge"],
      buildRelationMap(relations),
      buildFactsById([bridge, t1, t2]),
      relations,
      "strict_current",
      2000,
      { maxExpansion: 2, ceScores },
    );

    // f_t2 (ceScore=0.9) 应排在前面
    expect(result.expansionFactIds[0]).toBe("f_t2");
    expect(result.expansionFactIds[1]).toBe("f_t1");

    // selectedEdges 含 cePrior 字段
    expect(result.selectedEdges[0].scoreBreakdown.cePrior).toBe(0.9);
    expect(result.selectedEdges[1].scoreBreakdown.cePrior).toBe(0.3);
  });

  // 6. 空 bridgeFactIds 返回空结果
  it("should_return_empty_when_no_bridge_facts", () => {
    const result = weightedExpansionFromBridge(
      [],
      new Map(),
      new Map(),
      [],
      "strict_current",
      2000,
    );

    expect(result.expansionFactIds).toEqual([]);
    expect(result.selectedEdges).toEqual([]);
    expect(result.relationTypeHistogram).toEqual({});
  });

  // 7. relationType 直方图正确统计多种类型
  it("should_compute_relationType_histogram_correctly", () => {
    const bridge = makeFact("f_bridge", "Bridge", "bridge info", ["e1"]);
    const targets = [
      makeFact("f_a", "A", "a info", ["e1"]),
      makeFact("f_b", "B", "b info", ["e1"]),
      makeFact("f_c", "C", "c info", ["e1"]),
      makeFact("f_d", "D", "d info", ["e1"]),
    ];

    const relations = [
      makeRelation("f_bridge", "f_a", "causes"),
      makeRelation("f_bridge", "f_b", "causes"),
      makeRelation("f_bridge", "f_c", "enables"),
      makeRelation("f_bridge", "f_d", "related_to"),
    ];

    const result = weightedExpansionFromBridge(
      ["f_bridge"],
      buildRelationMap(relations),
      buildFactsById([bridge, ...targets]),
      relations,
      "strict_current",
      2000,
      { maxExpansion: 10 },
    );

    expect(result.relationTypeHistogram).toEqual({
      causes: 2,
      enables: 1,
      related_to: 1,
    });
  });

  // 8. 多个桥 fact 时, 候选合并后排序
  it("should_merge_candidates_from_multiple_bridges", () => {
    const bridge1 = makeFact("f_b1", "B1", "bridge 1", ["e1"]);
    const bridge2 = makeFact("f_b2", "B2", "bridge 2", ["e2"]);
    // 共同的 target (与两个桥都有 causes 边)
    const target = makeFact("f_target", "Target", "target info", ["e1", "e2"]);

    const relations = [
      makeRelation("f_b1", "f_target", "causes"),
      makeRelation("f_b2", "f_target", "related_to"),
    ];

    const result = weightedExpansionFromBridge(
      ["f_b1", "f_b2"],
      buildRelationMap(relations),
      buildFactsById([bridge1, bridge2, target]),
      relations,
      "strict_current",
      2000,
      { maxExpansion: 5 },
    );

    // target 应被包含 (来自两个桥的候选)
    expect(result.expansionFactIds).toContain("f_target");
    // 因为 best-first, causes 边的版本应排在前
    const edges = result.selectedEdges.filter((e) => e.toFactId === "f_target");
    // 至少有一条边指向 target
    expect(edges.length).toBeGreaterThanOrEqual(1);
    // 排在前的边应是 causes (weight 更高)
    expect(edges[0].relationType).toBe("causes");
  });
});
