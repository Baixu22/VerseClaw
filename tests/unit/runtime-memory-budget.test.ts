// @vitest-environment node
// Week 6 v2: LLM call budget 单元测试.
//
// 覆盖 memory-arch-roadmap.md §D4, E.2 #13, Week 6 完成定义:
// - 预算检查: check() 不消耗预算, recordCall() 消耗
// - 滑动窗口: 100 turns 窗口外记录老化掉
// - 多类型独立预算: reconcile / regenerate / critique / redact_decide
// - 超预算降级: tryAcquire 返回 allowed=false, degraded=true
// - 降级策略: getDegradationStrategy 各 callType 的 fallback
// - 默认限额: reconcile=5 / regenerate=30 / critique=50 / redact_decide=5
// - 预算面板 buildBudgetReport
import { describe, expect, it } from "vitest";
import {
  buildBudgetReport,
  DEFAULT_BUDGET_CONFIG,
  DEGRADATION_STRATEGIES,
  getDegradationStrategy,
  LLMCallBudget,
  type LLMCallType,
} from "../../openclaw_runtime/src/runtime-core/memory-budget";

describe("LLMCallBudget - check() 不消耗预算", () => {
  it("returns allowed=true when under limit", () => {
    const budget = new LLMCallBudget();
    const result = budget.check("reconcile", 0);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
    expect(result.degraded).toBe(false);
  });

  it("returns remaining = limit - used", () => {
    const budget = new LLMCallBudget();
    budget.recordCall("reconcile", 0);
    budget.recordCall("reconcile", 1);
    const result = budget.check("reconcile", 2);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3); // 5 - 2
  });

  it("returns allowed=false when exhausted", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 2 } });
    budget.recordCall("reconcile", 0);
    budget.recordCall("reconcile", 1);
    const result = budget.check("reconcile", 2);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.degraded).toBe(true);
    expect(result.reason).toContain("budget_exhausted");
    expect(result.reason).toContain("reconcile");
  });

  it("check() does not consume budget", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 2 } });
    budget.check("reconcile", 0);
    budget.check("reconcile", 0);
    budget.check("reconcile", 0);
    const stats = budget.getStats();
    expect(stats.usage.reconcile.used).toBe(0);
  });

  it("different callTypes have independent budgets", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 1, critique: 1 } });
    budget.recordCall("reconcile", 0);
    // reconcile 已耗尽, critique 仍可用
    expect(budget.check("reconcile", 1).allowed).toBe(false);
    expect(budget.check("critique", 1).allowed).toBe(true);
  });
});

describe("LLMCallBudget - recordCall() 消耗预算", () => {
  it("consumes budget on successful call", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 3 } });
    const record = budget.recordCall("reconcile", 0);
    expect(record.callType).toBe("reconcile");
    expect(record.turnIndex).toBe(0);
    expect(record.succeeded).toBe(true);
    expect(record.remainingBefore).toBe(3);

    const stats = budget.getStats();
    expect(stats.usage.reconcile.used).toBe(1);
    expect(stats.usage.reconcile.remaining).toBe(2);
  });

  it("does not record to budget when exhausted (degraded)", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 1 } });
    budget.recordCall("reconcile", 0);
    // 第二次调用: 预算耗尽, 不记录但增加 totalDegraded
    const record = budget.recordCall("reconcile", 1);
    expect(record.succeeded).toBe(true); // recordCall 默认 succeeded=true
    expect(record.remainingBefore).toBe(0);

    const stats = budget.getStats();
    expect(stats.usage.reconcile.used).toBe(1); // 仍是 1, 没有增加
    expect(stats.totalAttempts).toBe(2);
    expect(stats.totalDegraded).toBe(1);
  });

  it("records failed call without consuming extra budget", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 2 } });
    budget.recordCall("reconcile", 0, false); // 失败但仍消耗
    const stats = budget.getStats();
    expect(stats.usage.reconcile.used).toBe(1);
  });
});

describe("LLMCallBudget - tryAcquire() 原子操作", () => {
  it("allows and records in one call", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 2 } });
    const r1 = budget.tryAcquire("reconcile", 0);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(1);

    const r2 = budget.tryAcquire("reconcile", 1);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(0);

    const r3 = budget.tryAcquire("reconcile", 2);
    expect(r3.allowed).toBe(false);
    expect(r3.degraded).toBe(true);
    expect(r3.reason).toContain("budget_exhausted");
  });

  it("increments totalDegraded on reject", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 1 } });
    budget.tryAcquire("reconcile", 0); // used=1
    budget.tryAcquire("reconcile", 1); // degraded
    const stats = budget.getStats();
    expect(stats.totalAttempts).toBe(2);
    expect(stats.totalDegraded).toBe(1);
  });
});

describe("LLMCallBudget - 滑动窗口", () => {
  it("evicts records older than windowSize turns", () => {
    const budget = new LLMCallBudget({
      windowSize: 100,
      limits: { reconcile: 2 },
    });
    // Turn 0: 消耗 1
    budget.recordCall("reconcile", 0);
    // Turn 150: 老化掉 turn 0 的记录
    const result = budget.check("reconcile", 150);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2); // turn 0 的记录已老化, 剩余回到 2
  });

  it("keeps records within window", () => {
    const budget = new LLMCallBudget({
      windowSize: 100,
      limits: { reconcile: 2 },
    });
    budget.recordCall("reconcile", 50);
    budget.recordCall("reconcile", 80);
    // Turn 100: 两条记录都在 [1, 100] 窗口内
    const result = budget.check("reconcile", 100);
    expect(result.allowed).toBe(false); // 已耗尽
  });

  it("window slides: turn 101 evicts turn 1 records", () => {
    const budget = new LLMCallBudget({
      windowSize: 100,
      limits: { reconcile: 1 },
    });
    budget.recordCall("reconcile", 1);
    // Turn 100: 窗口 = [1, 100], turn 1 还在窗口内
    expect(budget.check("reconcile", 100).allowed).toBe(false);
    // Turn 101: 窗口 = [2, 101], turn 1 已老化
    expect(budget.check("reconcile", 101).allowed).toBe(true);
  });

  it("advanceTurn evicts old records", () => {
    const budget = new LLMCallBudget({
      windowSize: 10,
      limits: { reconcile: 1 },
    });
    budget.recordCall("reconcile", 0);
    // 推进 15 turns, turn 0 应该被老化
    for (let i = 1; i <= 15; i++) {
      budget.advanceTurn();
    }
    expect(budget.check("reconcile", 15).allowed).toBe(true);
  });
});

describe("LLMCallBudget - getStats() 统计", () => {
  it("returns zero stats for fresh budget", () => {
    const budget = new LLMCallBudget();
    const stats = budget.getStats();
    expect(stats.currentTurn).toBe(0);
    expect(stats.windowStartTurn).toBe(0);
    expect(stats.totalAttempts).toBe(0);
    expect(stats.totalDegraded).toBe(0);
    expect(stats.usage.reconcile.used).toBe(0);
    expect(stats.usage.reconcile.limit).toBe(5);
    expect(stats.usage.reconcile.remaining).toBe(5);
    expect(stats.usage.reconcile.degraded).toBe(false);
  });

  it("tracks usage across multiple callTypes", () => {
    const budget = new LLMCallBudget();
    budget.recordCall("reconcile", 0);
    budget.recordCall("critique", 0);
    budget.recordCall("regenerate", 0);
    budget.recordCall("redact_decide", 0);

    const stats = budget.getStats();
    expect(stats.usage.reconcile.used).toBe(1);
    expect(stats.usage.critique.used).toBe(1);
    expect(stats.usage.regenerate.used).toBe(1);
    expect(stats.usage.redact_decide.used).toBe(1);
    expect(stats.totalAttempts).toBe(4);
    expect(stats.totalDegraded).toBe(0);
  });

  it("marks degraded=true when remaining=0", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 1 } });
    budget.recordCall("reconcile", 0);
    const stats = budget.getStats();
    expect(stats.usage.reconcile.degraded).toBe(true);
    expect(stats.usage.reconcile.remaining).toBe(0);
  });
});

describe("LLMCallBudget - reset()", () => {
  it("clears all records and counters", () => {
    const budget = new LLMCallBudget();
    budget.recordCall("reconcile", 0);
    budget.recordCall("critique", 0);
    budget.tryAcquire("regenerate", 0); // attempt

    budget.reset();
    const stats = budget.getStats();
    expect(stats.usage.reconcile.used).toBe(0);
    expect(stats.usage.critique.used).toBe(0);
    expect(stats.totalAttempts).toBe(0);
    expect(stats.totalDegraded).toBe(0);
    expect(stats.currentTurn).toBe(0);
  });
});

describe("LLMCallBudget - 默认限额", () => {
  it("DEFAULT_BUDGET_CONFIG has correct limits", () => {
    expect(DEFAULT_BUDGET_CONFIG.windowSize).toBe(100);
    expect(DEFAULT_BUDGET_CONFIG.limits.reconcile).toBe(5);
    expect(DEFAULT_BUDGET_CONFIG.limits.regenerate).toBe(30);
    expect(DEFAULT_BUDGET_CONFIG.limits.critique).toBe(50);
    expect(DEFAULT_BUDGET_CONFIG.limits.redact_decide).toBe(5);
  });

  it("default budget allows 5 reconcile calls per 100 turns", () => {
    const budget = new LLMCallBudget();
    for (let i = 0; i < 5; i++) {
      expect(budget.tryAcquire("reconcile", i).allowed).toBe(true);
    }
    // 第 6 次应该降级
    const r = budget.tryAcquire("reconcile", 5);
    expect(r.allowed).toBe(false);
    expect(r.degraded).toBe(true);
  });

  it("default budget allows 30 regenerate calls per 100 turns", () => {
    const budget = new LLMCallBudget();
    for (let i = 0; i < 30; i++) {
      expect(budget.tryAcquire("regenerate", i).allowed).toBe(true);
    }
    expect(budget.tryAcquire("regenerate", 30).allowed).toBe(false);
  });

  it("default budget allows 50 critique calls per 100 turns", () => {
    const budget = new LLMCallBudget();
    for (let i = 0; i < 50; i++) {
      expect(budget.tryAcquire("critique", i).allowed).toBe(true);
    }
    expect(budget.tryAcquire("critique", 50).allowed).toBe(false);
  });
});

describe("LLMCallBudget - 自定义配置", () => {
  it("partial config merges with defaults", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 10 } });
    const stats = budget.getStats();
    expect(stats.usage.reconcile.limit).toBe(10); // 自定义
    expect(stats.usage.critique.limit).toBe(50); // 默认
    expect(stats.usage.regenerate.limit).toBe(30); // 默认
  });

  it("custom windowSize works", () => {
    const budget = new LLMCallBudget({
      windowSize: 10,
      limits: { reconcile: 1 },
    });
    budget.recordCall("reconcile", 0);
    // Turn 5: 窗口 [0, 9], turn 0 还在
    expect(budget.check("reconcile", 5).allowed).toBe(false);
    // Turn 11: 窗口 [1, 10], turn 0 老化
    expect(budget.check("reconcile", 11).allowed).toBe(true);
  });
});

describe("DEGRADATION_STRATEGIES - 降级策略", () => {
  it("reconcile degrades to rule_only", () => {
    const strategy = getDegradationStrategy("reconcile");
    expect(strategy.fallback).toBe("rule_only");
    expect(strategy.reason).toContain("rule-only");
  });

  it("regenerate degrades to keep_original", () => {
    const strategy = getDegradationStrategy("regenerate");
    expect(strategy.fallback).toBe("keep_original");
    expect(strategy.reason).toContain("keeping initial answer");
  });

  it("critique degrades to skip", () => {
    const strategy = getDegradationStrategy("critique");
    expect(strategy.fallback).toBe("skip");
    expect(strategy.reason).toContain("skipped");
  });

  it("redact_decide degrades to allow (compliance priority)", () => {
    const strategy = getDegradationStrategy("redact_decide");
    expect(strategy.fallback).toBe("allow");
    expect(strategy.reason).toContain("compliance priority");
  });

  it("DEGRADATION_STRATEGIES covers all callTypes", () => {
    const callTypes: LLMCallType[] = [
      "reconcile",
      "regenerate",
      "critique",
      "redact_decide",
    ];
    for (const ct of callTypes) {
      expect(DEGRADATION_STRATEGIES[ct]).toBeDefined();
      expect(DEGRADATION_STRATEGIES[ct].callType).toBe(ct);
    }
  });
});

describe("buildBudgetReport - 预算面板", () => {
  it("builds a complete budget report", () => {
    const budget = new LLMCallBudget();
    budget.recordCall("reconcile", 0);
    budget.recordCall("critique", 0);
    budget.tryAcquire("regenerate", 0);

    const report = buildBudgetReport("user_789", budget);
    expect(report.userId).toBe("user_789");
    expect(report.stats.usage.reconcile.used).toBe(1);
    expect(report.stats.usage.critique.used).toBe(1);
    expect(report.stats.usage.regenerate.used).toBe(1);
    expect(report.degradationStrategies.reconcile.fallback).toBe("rule_only");
    expect(report.config.windowSize).toBe(100);
  });

  it("report includes all degradation strategies", () => {
    const budget = new LLMCallBudget();
    const report = buildBudgetReport("user_1", budget);
    expect(report.degradationStrategies.reconcile).toBeDefined();
    expect(report.degradationStrategies.regenerate).toBeDefined();
    expect(report.degradationStrategies.critique).toBeDefined();
    expect(report.degradationStrategies.redact_decide).toBeDefined();
  });
});

describe("LLMCallBudget - 端到端 1000 turns 模拟", () => {
  it("budget regulates LLM calls over 1000 turns", () => {
    const budget = new LLMCallBudget();
    let llmCalls = 0;
    let degraded = 0;

    for (let turn = 0; turn < 1000; turn++) {
      // 每轮尝试一次 reconcile
      const result = budget.tryAcquire("reconcile", turn);
      if (result.allowed) {
        llmCalls += 1;
      } else {
        degraded += 1;
      }
    }

    // 1000 turns / 100 window = 10 windows
    // 每 window 5 次 → 50 次成功
    expect(llmCalls).toBe(50);
    expect(degraded).toBe(950);
    expect(budget.getStats().totalAttempts).toBe(1000);
    expect(budget.getStats().totalDegraded).toBe(950);
  });

  it("degraded calls do not invoke LLM (degradation strategy applies)", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 1 } });
    // 第一次: 允许 → 调 LLM
    const r1 = budget.tryAcquire("reconcile", 0);
    expect(r1.allowed).toBe(true);

    // 第二次: 降级 → 不调 LLM, 走 rule_only
    const r2 = budget.tryAcquire("reconcile", 1);
    expect(r2.allowed).toBe(false);
    const strategy = getDegradationStrategy("reconcile");
    expect(strategy.fallback).toBe("rule_only");
    // 实际应用中: if (!r2.allowed) { /* apply rule_only */ }
  });
});

describe("LLMCallBudget - 边界情况", () => {
  it("handles turn=0 correctly", () => {
    const budget = new LLMCallBudget();
    const result = budget.check("reconcile", 0);
    expect(result.allowed).toBe(true);
    expect(budget.getStats().currentTurn).toBe(0);
  });

  it("handles negative-ish turns (turnIndex = 0 is minimum)", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 1 } });
    budget.recordCall("reconcile", 0);
    // 重新检查 turn 0 (不会回退)
    const result = budget.check("reconcile", 0);
    expect(result.allowed).toBe(false);
  });

  it("handles very large turn numbers", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 1 } });
    budget.recordCall("reconcile", 1000000);
    expect(budget.getStats().currentTurn).toBe(1000000);
    // turn 1000000 + 200 > window 100, 老化掉
    expect(budget.check("reconcile", 1000200).allowed).toBe(true);
  });

  it("empty limits Record is filled from defaults", () => {
    const budget = new LLMCallBudget({ limits: {} });
    const stats = budget.getStats();
    // 空对象展开后, DEFAULT_BUDGET_CONFIG.limits 被完整保留
    expect(stats.usage.reconcile.limit).toBe(5);
    expect(stats.usage.critique.limit).toBe(50);
  });

  it("windowSize=1 evicts immediately on next turn", () => {
    const budget = new LLMCallBudget({
      windowSize: 1,
      limits: { reconcile: 1 },
    });
    budget.recordCall("reconcile", 0);
    // Turn 1: 窗口 [1, 1], turn 0 已老化
    expect(budget.check("reconcile", 1).allowed).toBe(true);
  });
});
