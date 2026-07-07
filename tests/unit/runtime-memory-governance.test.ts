// @vitest-environment node
// Week 6 v2: Memory governance 单元测试.
//
// 覆盖 memory-arch-roadmap.md §D3, E.2 #14, Week 6 完成定义:
// - 4 信号计算正确性 (conflictDensity / driftScore / staleRatio / hotSpotCount)
// - 自动触发规则:
//     conflictDensity > 0.15 → reconcile
//     driftScore > 0.3       → rebuild
//     staleRatio > 0.4       → prune
// - 优先级排序: reconcile > rebuild > prune
// - 小样本保护: 总 fact 数 < 10 时 conflictDensity/staleRatio 返回 0
// - KL 散度计算 + 平滑 + 小样本保护
// - 误触发防护 (roadmap: 误触发率 ≤5%)
// - 治理面板 buildHealthReport
import { describe, expect, it } from "vitest";
import {
  applyGovernanceRules,
  buildHealthReport,
  computeGovernanceSignals,
  computeKlDivergence,
  decideGovernanceAction,
  GOVERNANCE_DEFAULTS,
  GOVERNANCE_THRESHOLDS,
  type GovernanceFactInput,
  type GovernanceInput,
} from "../../openclaw_runtime/src/runtime-core/memory-governance";

function makeFact(overrides: Partial<GovernanceFactInput> = {}): GovernanceFactInput {
  return {
    factId: overrides.factId ?? "f1",
    subject: overrides.subject ?? "Jon",
    predicate: overrides.predicate ?? "lives_in",
    invalidAt: overrides.invalidAt,
    lastAccessedAt: overrides.lastAccessedAt,
    accessCount: overrides.accessCount,
  };
}

function makeFacts(count: number, overrides: Partial<GovernanceFactInput> = {}): GovernanceFactInput[] {
  const facts: GovernanceFactInput[] = [];
  for (let i = 0; i < count; i++) {
    facts.push(
      makeFact({
        factId: `f${i}`,
        ...overrides,
      }),
    );
  }
  return facts;
}

describe("computeGovernanceSignals - conflictDensity", () => {
  it("returns 0 when no facts have invalidAt", () => {
    const facts = makeFacts(20);
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.conflictDensity).toBe(0);
    expect(signals.conflictCount).toBe(0);
  });

  it("returns correct ratio for mixed facts", () => {
    const facts = [
      ...makeFacts(15),
      ...makeFacts(5, { invalidAt: 50000 }),
    ];
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.conflictCount).toBe(5);
    expect(signals.totalFacts).toBe(20);
    expect(signals.conflictDensity).toBeCloseTo(0.25, 5);
  });

  it("returns 0 when total facts < minSampleSize (small sample protection)", () => {
    const facts = [
      ...makeFacts(5),
      ...makeFacts(4, { invalidAt: 50000 }),
    ];
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    // 总数 9 < 10 → conflictDensity = 0 (避免小样本噪声)
    expect(signals.totalFacts).toBe(9);
    expect(signals.conflictDensity).toBe(0);
    // conflictCount 仍然记录真实值
    expect(signals.conflictCount).toBe(4);
  });

  it("returns 1.0 when all facts are conflicted", () => {
    const facts = makeFacts(20, { invalidAt: 50000 });
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.conflictDensity).toBe(1);
  });
});

describe("computeGovernanceSignals - staleRatio", () => {
  const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  it("returns 0 when all facts accessed recently", () => {
    const facts = makeFacts(20, { lastAccessedAt: 100000 });
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000 + 1000, // 1s later
    });
    expect(signals.staleRatio).toBe(0);
    expect(signals.staleCount).toBe(0);
  });

  it("returns correct ratio for stale facts", () => {
    const recent = makeFacts(15, { lastAccessedAt: 100000 });
    const stale = makeFacts(5, {
      lastAccessedAt: 100000 - STALE_MS - 1000,
    });
    const signals = computeGovernanceSignals({
      facts: [...recent, ...stale],
      referenceTime: 100000,
    });
    expect(signals.staleCount).toBe(5);
    expect(signals.totalFacts).toBe(20);
    expect(signals.staleRatio).toBeCloseTo(0.25, 5);
  });

  it("treats never-accessed facts as stale", () => {
    const facts = makeFacts(20); // 无 lastAccessedAt
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.staleCount).toBe(20);
    expect(signals.staleRatio).toBe(1);
  });

  it("respects custom pruneStaleDays", () => {
    const facts = makeFacts(20, {
      lastAccessedAt: 100000 - 7 * 24 * 60 * 60 * 1000, // 7 days ago
    });
    // 默认 30 天 → 不陈旧
    const signalsDefault = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signalsDefault.staleRatio).toBe(0);

    // 5 天阈值 → 陈旧
    const signals5Days = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
      pruneStaleDays: 5,
    });
    expect(signals5Days.staleRatio).toBe(1);
  });

  it("returns 0 when total facts < minSampleSize", () => {
    const facts = makeFacts(5, {
      lastAccessedAt: 100000 - STALE_MS - 1000,
    });
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.staleRatio).toBe(0);
    expect(signals.staleCount).toBe(5);
  });
});

describe("computeGovernanceSignals - hotSpotCount", () => {
  it("returns 0 when no facts meet threshold", () => {
    const facts = makeFacts(20, { accessCount: 1 });
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.hotSpotCount).toBe(0);
  });

  it("counts facts at or above threshold", () => {
    const facts = [
      ...makeFacts(15, { accessCount: 1 }),
      ...makeFacts(5, { accessCount: 10 }),
    ];
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.hotSpotCount).toBe(5);
  });

  it("respects custom hotSpotThreshold", () => {
    const facts = makeFacts(20, { accessCount: 7 });
    // 默认阈值 5 → 全部是热点
    const signalsDefault = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signalsDefault.hotSpotCount).toBe(20);

    // 阈值 10 → 无热点
    const signals10 = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
      hotSpotThreshold: 10,
    });
    expect(signals10.hotSpotCount).toBe(0);
  });

  it("treats undefined accessCount as 0", () => {
    const facts = makeFacts(20); // 无 accessCount
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.hotSpotCount).toBe(0);
  });
});

describe("computeGovernanceSignals - driftScore (KL divergence)", () => {
  it("returns 0 when distributions are missing", () => {
    const signals = computeGovernanceSignals({
      facts: makeFacts(20),
      referenceTime: 100000,
    });
    expect(signals.driftScore).toBe(0);
  });

  it("returns 0 when distributions are empty", () => {
    const signals = computeGovernanceSignals({
      facts: makeFacts(20),
      referenceTime: 100000,
      recentFactDistribution: new Map(),
      historicalFactDistribution: new Map(),
    });
    expect(signals.driftScore).toBe(0);
  });

  it("returns 0 for identical distributions", () => {
    const dist = new Map([
      ["Jon", 50],
      ["Mary", 30],
      ["Bob", 20],
    ]);
    const signals = computeGovernanceSignals({
      facts: makeFacts(20),
      referenceTime: 100000,
      recentFactDistribution: dist,
      historicalFactDistribution: dist,
    });
    // 相同分布 KL = 0 (理论上, 实际因平滑可能极小)
    expect(signals.driftScore).toBeLessThan(0.001);
  });

  it("returns positive value for divergent distributions", () => {
    const recent = new Map([
      ["Jon", 80],
      ["Mary", 10],
      ["Bob", 10],
    ]);
    const historical = new Map([
      ["Jon", 10],
      ["Mary", 80],
      ["Bob", 10],
    ]);
    const signals = computeGovernanceSignals({
      facts: makeFacts(20),
      referenceTime: 100000,
      recentFactDistribution: recent,
      historicalFactDistribution: historical,
    });
    expect(signals.driftScore).toBeGreaterThan(0.5);
  });

  it("returns 0 when recent distribution total < minSampleSize", () => {
    const recent = new Map([
      ["Jon", 5],
      ["Mary", 3],
    ]); // total=8 < 10
    const historical = new Map([
      ["Jon", 100],
      ["Mary", 100],
    ]);
    const signals = computeGovernanceSignals({
      facts: makeFacts(20),
      referenceTime: 100000,
      recentFactDistribution: recent,
      historicalFactDistribution: historical,
    });
    expect(signals.driftScore).toBe(0);
  });

  it("returns 0 when historical distribution total < minSampleSize", () => {
    const recent = new Map([
      ["Jon", 100],
      ["Mary", 100],
    ]);
    const historical = new Map([
      ["Jon", 5],
      ["Mary", 3],
    ]); // total=8 < 10
    const signals = computeGovernanceSignals({
      facts: makeFacts(20),
      referenceTime: 100000,
      recentFactDistribution: recent,
      historicalFactDistribution: historical,
    });
    expect(signals.driftScore).toBe(0);
  });
});

describe("computeKlDivergence - 独立工具函数", () => {
  it("returns 0 for undefined inputs", () => {
    expect(computeKlDivergence(undefined, undefined)).toBe(0);
    expect(computeKlDivergence(new Map(), undefined)).toBe(0);
    expect(computeKlDivergence(undefined, new Map())).toBe(0);
  });

  it("returns 0 for empty maps", () => {
    expect(computeKlDivergence(new Map(), new Map())).toBe(0);
  });

  it("returns 0 for identical distributions", () => {
    const dist = new Map([
      ["a", 50],
      ["b", 50],
    ]);
    expect(computeKlDivergence(dist, dist)).toBeLessThan(0.001);
  });

  it("KL divergence is symmetric for identical distributions but not general", () => {
    // KL is NOT symmetric in general. Test with different distributions.
    const p = new Map([
      ["a", 80],
      ["b", 20],
    ]);
    const q = new Map([
      ["a", 20],
      ["b", 80],
    ]);
    const klPQ = computeKlDivergence(p, q);
    const klQP = computeKlDivergence(q, p);
    expect(klPQ).toBeGreaterThan(0);
    expect(klQP).toBeGreaterThan(0);
    // For symmetric divergence (a=80,b=20 vs a=20,b=80), KL(P||Q) === KL(Q||P)
    // because the magnitude of divergence is the same.
    expect(klPQ).toBeCloseTo(klQP, 5);
  });

  it("returns 0 for small samples", () => {
    const small = new Map([["a", 5]]); // total 5 < 10
    const large = new Map([["a", 100]]);
    expect(computeKlDivergence(small, large)).toBe(0);
    expect(computeKlDivergence(large, small)).toBe(0);
  });

  it("always returns non-negative value", () => {
    const p = new Map([
      ["a", 30],
      ["b", 30],
      ["c", 40],
    ]);
    const q = new Map([
      ["a", 50],
      ["b", 50],
    ]);
    const kl = computeKlDivergence(p, q);
    expect(kl).toBeGreaterThanOrEqual(0);
  });
});

describe("applyGovernanceRules - 自动触发规则", () => {
  it("triggers reconcile when conflictDensity > 0.15", () => {
    const signals = {
      conflictDensity: 0.2,
      driftScore: 0,
      staleRatio: 0,
      hotSpotCount: 0,
      totalFacts: 100,
      conflictCount: 20,
      staleCount: 0,
      computedAt: 1000,
    };
    const decisions = applyGovernanceRules(signals);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("reconcile");
    expect(decisions[0].trigger).toBe("conflictDensity");
    expect(decisions[0].value).toBe(0.2);
    expect(decisions[0].threshold).toBe(GOVERNANCE_THRESHOLDS.conflictDensity);
  });

  it("does not trigger reconcile when conflictDensity === 0.15 (boundary)", () => {
    const signals = {
      conflictDensity: 0.15,
      driftScore: 0,
      staleRatio: 0,
      hotSpotCount: 0,
      totalFacts: 100,
      conflictCount: 15,
      staleCount: 0,
      computedAt: 1000,
    };
    const decisions = applyGovernanceRules(signals);
    expect(decisions).toHaveLength(0);
  });

  it("triggers rebuild when driftScore > 0.3", () => {
    const signals = {
      conflictDensity: 0,
      driftScore: 0.5,
      staleRatio: 0,
      hotSpotCount: 0,
      totalFacts: 100,
      conflictCount: 0,
      staleCount: 0,
      computedAt: 1000,
    };
    const decisions = applyGovernanceRules(signals);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("rebuild");
    expect(decisions[0].trigger).toBe("driftScore");
    expect(decisions[0].value).toBe(0.5);
    expect(decisions[0].threshold).toBe(GOVERNANCE_THRESHOLDS.driftScore);
  });

  it("triggers prune when staleRatio > 0.4", () => {
    const signals = {
      conflictDensity: 0,
      driftScore: 0,
      staleRatio: 0.6,
      hotSpotCount: 0,
      totalFacts: 100,
      conflictCount: 0,
      staleCount: 60,
      computedAt: 1000,
    };
    const decisions = applyGovernanceRules(signals);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("prune");
    expect(decisions[0].trigger).toBe("staleRatio");
    expect(decisions[0].value).toBe(0.6);
    expect(decisions[0].threshold).toBe(GOVERNANCE_THRESHOLDS.staleRatio);
  });

  it("returns empty when all signals below thresholds", () => {
    const signals = {
      conflictDensity: 0.1,
      driftScore: 0.2,
      staleRatio: 0.3,
      hotSpotCount: 5,
      totalFacts: 100,
      conflictCount: 10,
      staleCount: 30,
      computedAt: 1000,
    };
    const decisions = applyGovernanceRules(signals);
    expect(decisions).toHaveLength(0);
  });

  it("triggers multiple actions when multiple signals exceed", () => {
    const signals = {
      conflictDensity: 0.2,
      driftScore: 0.5,
      staleRatio: 0.6,
      hotSpotCount: 0,
      totalFacts: 100,
      conflictCount: 20,
      staleCount: 60,
      computedAt: 1000,
    };
    const decisions = applyGovernanceRules(signals);
    expect(decisions).toHaveLength(3);
    // applyGovernanceRules 按 reconcile → rebuild → prune 顺序 push (不加 sort)
    const actions = decisions.map((d) => d.action);
    expect(actions).toEqual(["reconcile", "rebuild", "prune"]);
  });
});

describe("decideGovernanceAction - 优先级排序", () => {
  it("returns none when no signal triggers", () => {
    const signals = {
      conflictDensity: 0,
      driftScore: 0,
      staleRatio: 0,
      hotSpotCount: 0,
      totalFacts: 0,
      conflictCount: 0,
      staleCount: 0,
      computedAt: 1000,
    };
    const decision = decideGovernanceAction(signals);
    expect(decision.action).toBe("none");
    expect(decision.trigger).toBe("none");
  });

  it("returns reconcile when only conflictDensity triggers (highest priority)", () => {
    const signals = {
      conflictDensity: 0.2,
      driftScore: 0,
      staleRatio: 0,
      hotSpotCount: 0,
      totalFacts: 100,
      conflictCount: 20,
      staleCount: 0,
      computedAt: 1000,
    };
    const decision = decideGovernanceAction(signals);
    expect(decision.action).toBe("reconcile");
  });

  it("returns reconcile when all signals trigger (priority: reconcile > rebuild > prune)", () => {
    const signals = {
      conflictDensity: 0.2,
      driftScore: 0.5,
      staleRatio: 0.6,
      hotSpotCount: 0,
      totalFacts: 100,
      conflictCount: 20,
      staleCount: 60,
      computedAt: 1000,
    };
    const decision = decideGovernanceAction(signals);
    expect(decision.action).toBe("reconcile");
    expect(decision.trigger).toBe("conflictDensity");
  });

  it("returns rebuild when drift + stale trigger (no conflict)", () => {
    const signals = {
      conflictDensity: 0.05,
      driftScore: 0.5,
      staleRatio: 0.6,
      hotSpotCount: 0,
      totalFacts: 100,
      conflictCount: 5,
      staleCount: 60,
      computedAt: 1000,
    };
    const decision = decideGovernanceAction(signals);
    expect(decision.action).toBe("rebuild");
    expect(decision.trigger).toBe("driftScore");
  });

  it("returns prune when only stale triggers", () => {
    const signals = {
      conflictDensity: 0.05,
      driftScore: 0.1,
      staleRatio: 0.6,
      hotSpotCount: 0,
      totalFacts: 100,
      conflictCount: 5,
      staleCount: 60,
      computedAt: 1000,
    };
    const decision = decideGovernanceAction(signals);
    expect(decision.action).toBe("prune");
    expect(decision.trigger).toBe("staleRatio");
  });
});

describe("buildHealthReport - 治理面板", () => {
  it("builds a complete health report", () => {
    const facts = [
      ...makeFacts(15, { lastAccessedAt: 100000 }), // recent → not stale
      ...makeFacts(5, { invalidAt: 50000, lastAccessedAt: 100000 }), // 20% conflict, also recent
    ];
    const input: GovernanceInput = {
      facts,
      referenceTime: 100000,
    };
    const report = buildHealthReport("user_123", input);

    expect(report.userId).toBe("user_123");
    expect(report.signals.totalFacts).toBe(20);
    expect(report.signals.conflictDensity).toBeCloseTo(0.25, 5);
    expect(report.thresholds).toBe(GOVERNANCE_THRESHOLDS);
    expect(report.topDecision.action).toBe("reconcile");
    expect(report.triggeredActions).toHaveLength(1);
    expect(report.triggeredActions[0].action).toBe("reconcile");
  });

  it("returns none action when no signals trigger", () => {
    const facts = makeFacts(20, { lastAccessedAt: 100000 });
    const report = buildHealthReport("user_456", {
      facts,
      referenceTime: 100000 + 1000,
    });
    expect(report.topDecision.action).toBe("none");
    expect(report.triggeredActions).toHaveLength(0);
  });
});

describe("computeGovernanceSignals - 误触发防护", () => {
  it("small sample does not trigger reconcile", () => {
    // 5 facts, all conflicted → 100% conflict density but small sample
    const facts = makeFacts(5, { invalidAt: 1000 });
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.conflictDensity).toBe(0); // 小样本保护
    const decisions = applyGovernanceRules(signals);
    expect(decisions).toHaveLength(0);
  });

  it("small sample does not trigger prune", () => {
    const staleMs = 30 * 24 * 60 * 60 * 1000;
    const facts = makeFacts(5, {
      lastAccessedAt: 100000 - staleMs - 1000,
    });
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.staleRatio).toBe(0); // 小样本保护
    const decisions = applyGovernanceRules(signals);
    expect(decisions).toHaveLength(0);
  });

  it("small sample drift does not trigger rebuild", () => {
    const recent = new Map([["a", 5]]);
    const historical = new Map([["b", 100]]);
    const signals = computeGovernanceSignals({
      // 设置 lastAccessedAt 避免误触发 prune (无 lastAccessedAt 视为 stale)
      facts: makeFacts(20, { lastAccessedAt: 100000 }),
      referenceTime: 100000,
      recentFactDistribution: recent,
      historicalFactDistribution: historical,
    });
    expect(signals.driftScore).toBe(0); // 小样本保护
    const decisions = applyGovernanceRules(signals);
    expect(decisions).toHaveLength(0);
  });

  it("hotSpotCount does not trigger any action", () => {
    const signals = {
      conflictDensity: 0,
      driftScore: 0,
      staleRatio: 0,
      hotSpotCount: 1000, // 巨大热点数
      totalFacts: 100,
      conflictCount: 0,
      staleCount: 0,
      computedAt: 1000,
    };
    const decisions = applyGovernanceRules(signals);
    expect(decisions).toHaveLength(0);
  });
});

describe("computeGovernanceSignals - 默认值", () => {
  it("uses default pruneStaleDays=30 when not specified", () => {
    const facts = makeFacts(20, {
      lastAccessedAt: 100000 - 29 * 24 * 60 * 60 * 1000, // 29 days ago
    });
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.staleRatio).toBe(0); // 29 < 30
  });

  it("uses default hotSpotThreshold=5 when not specified", () => {
    const facts = makeFacts(20, { accessCount: 4 });
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.hotSpotCount).toBe(0); // 4 < 5
  });

  it("GOVERNANCE_DEFAULTS exposes minSampleSize=10", () => {
    expect(GOVERNANCE_DEFAULTS.minSampleSize).toBe(10);
  });

  it("GOVERNANCE_THRESHOLDS exposes 0.15/0.3/0.4", () => {
    expect(GOVERNANCE_THRESHOLDS.conflictDensity).toBe(0.15);
    expect(GOVERNANCE_THRESHOLDS.driftScore).toBe(0.3);
    expect(GOVERNANCE_THRESHOLDS.staleRatio).toBe(0.4);
  });
});
