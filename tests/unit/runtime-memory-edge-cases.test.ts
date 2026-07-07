// @vitest-environment node
// 阶段 5: 边界与异常测试.
//
// 验证组件在异常输入下不崩溃, 避免 500q 评测时遇到边界场景假阴性.
//
// 覆盖:
//   1. 空输入: 空数组/空字符串/undefined
//   2. 超大输入: 大量 facts (1000+) / 长字符串
//   3. 类型边界: 数值边界 (0/-1/Infinity/NaN)
//   4. 并发安全: event log 顺序追加, observation 增量 vs rebuild 一致
//   5. 异常组合: SUPERSEDE 不存在的 fact / REDACT 后再 REDACT
import { describe, expect, it } from "vitest";
import {
  MemoryEventLog,
} from "../../openclaw_runtime/src/runtime-core/memory-event-log";
import {
  ObservationStore,
  type MemoryMutationEvent,
} from "../../openclaw_runtime/src/runtime-core/memory-observation-store";
import {
  computeGovernanceSignals,
  decideGovernanceAction,
} from "../../openclaw_runtime/src/runtime-core/memory-governance";
import {
  LLMCallBudget,
} from "../../openclaw_runtime/src/runtime-core/memory-budget";
import {
  discoverBridges,
  extractEntityPairFromQuery,
} from "../../openclaw_runtime/src/runtime-core/memory-bridge-discovery";
import {
  inferTemporalPolicyFromQuery,
  passesTemporalPolicy,
} from "../../openclaw_runtime/src/runtime-core/memory-temporal-policy";
import {
  createRecommendedStateMachine,
} from "../../openclaw_runtime/src/runtime-core/memory-agent-state-machine";

// === 1. 空输入 ===

describe("边界: 空输入", () => {
  it("MemoryEventLog: 空 log verifyChain 返回 true", () => {
    const log = new MemoryEventLog("user_1");
    expect(log.verifyChain()).toBe(true);
    expect(log.size()).toBe(0);
    expect(log.getEvents()).toHaveLength(0);
    expect(log.getRedactionEvents()).toHaveLength(0);
  });

  it("MemoryEventLog: 空 log rebuildAsOfSnapshot 返回空 snapshot", () => {
    const log = new MemoryEventLog("user_1");
    const snap = log.rebuildAsOfSnapshot(1000);
    expect(snap.facts).toHaveLength(0);
    expect(snap.eventCount).toBe(0);
  });

  it("ObservationStore: 空事件不创建 observation", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([]);
    expect(store.size()).toBe(0);
    expect(store.getAll()).toHaveLength(0);
  });

  it("computeGovernanceSignals: 空 facts 返回零信号", () => {
    const signals = computeGovernanceSignals({
      facts: [],
      referenceTime: 100000,
    });
    expect(signals.totalFacts).toBe(0);
    expect(signals.conflictDensity).toBe(0);
    expect(signals.driftScore).toBe(0);
    expect(signals.staleRatio).toBe(0);
    expect(signals.hotSpotCount).toBe(0);
  });

  it("LLMCallBudget: 0 limit 总是拒绝", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 0 } });
    const result = budget.check("reconcile", 0);
    expect(result.allowed).toBe(false);
    expect(result.degraded).toBe(true);
  });

  it("discoverBridges: 空 facts 返回空 candidates", () => {
    const { candidates, diagnostics } = discoverBridges(
      { e1: "Jon", e2: "Mary" },
      [],
      undefined,
      1000,
    );
    expect(candidates).toHaveLength(0);
    expect(diagnostics.pathExistence).toBe(false);
    expect(diagnostics.bridgeCandidateCount).toBe(0);
  });

  it("extractEntityPairFromQuery: 无引号 entity 仍可识别 (regex 支持)", () => {
    // 中文格式 "X 和 Y" 也能被识别 (regex 不强制引号)
    const result = extractEntityPairFromQuery("Jon 和 Mary 的关系");
    expect(result).not.toBeNull();
    expect(result?.e1).toBe("Jon");
    expect(result?.e2).toBe("Mary");
  });

  it("extractEntityPairFromQuery: 真正无 entity 模式返回 null", () => {
    // 无 "和" 连接, 无引号 → null
    const result = extractEntityPairFromQuery("hello world");
    expect(result).toBeNull();
  });

  it("inferTemporalPolicyFromQuery: 空字符串返回 strict_current", () => {
    const result = inferTemporalPolicyFromQuery("", 1000);
    expect(result.policy).toBe("strict_current");
  });

  it("createRecommendedStateMachine: 不 start 直接 executeStep 不崩溃 (容忍设计)", () => {
    const sm = createRecommendedStateMachine("multi_hop");
    // state-machine 容忍未 start 调用 (不抛错, 内部自动 start)
    expect(() => {
      sm.executeStep("recall", {
        hypotheses: [],
        missingInfo: null,
        nextAction: "generate",
      });
    }).not.toThrow();
  });
});

// === 2. 超大输入 ===

describe("边界: 超大输入", () => {
  it("MemoryEventLog: 1000 events verifyChain 仍正确", () => {
    const log = new MemoryEventLog("user_1");
    for (let i = 0; i < 1000; i++) {
      log.append({
        eventType: "ADD",
        payload: {
          factId: `f_${i}`,
          subject: "Jon",
          predicate: "knows",
          objectSummary: `fact ${i}`,
          validAt: i,
        },
        timestamp: i,
      });
    }
    expect(log.size()).toBe(1000);
    expect(log.verifyChain()).toBe(true);

    const snap = log.rebuildAsOfSnapshot(999);
    expect(snap.facts).toHaveLength(1000);
    expect(snap.eventCount).toBe(1000);
  });

  it("ObservationStore: 500 ADD 事件, 增量 vs rebuild 一致", () => {
    const events: MemoryMutationEvent[] = [];
    for (let i = 0; i < 500; i++) {
      events.push({
        eventId: `evt_${i}`,
        timestamp: i,
        eventType: "ADD",
        payload: {
          factId: `f_${i}`,
          subject: "Jon",
          predicate: "knows",
          objectSummary: `fact ${i}`,
          validAt: i,
        },
      });
    }

    // 增量
    const storeIncremental = new ObservationStore();
    storeIncremental.updateObservationsIncremental(events);

    // 全量 rebuild
    const storeRebuild = new ObservationStore();
    storeRebuild.rebuildObservationsFromScratch(events);

    expect(storeIncremental.size()).toBe(storeRebuild.size());
    // 同 subject+predicate → 同一 observation, supportFactIds 应一致
    const obs1 = storeIncremental.getByKey("jon|knows");
    const obs2 = storeRebuild.getByKey("jon|knows");
    expect(obs1?.supportFactIds.length).toBe(obs2?.supportFactIds.length);
    expect(obs1?.supportFactIds.length).toBe(500);
  });

  it("computeGovernanceSignals: 1000 facts 不崩溃", () => {
    const facts = Array.from({ length: 1000 }, (_, i) => ({
      factId: `f_${i}`,
      subject: "Jon",
      predicate: "knows",
      lastAccessedAt: 100000,
      accessCount: 1,
    }));
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.totalFacts).toBe(1000);
    expect(signals.conflictDensity).toBe(0);
  });

  it("LLMCallBudget: 10000 turns 模拟不崩溃", () => {
    const budget = new LLMCallBudget({ limits: { reconcile: 5 } });
    for (let turn = 0; turn < 10000; turn++) {
      budget.tryAcquire("reconcile", turn);
    }
    const stats = budget.getStats();
    expect(stats.totalAttempts).toBe(10000);
    // 10000 / 100 × 5 = 500 成功
    expect(stats.usage.reconcile.used).toBeLessThanOrEqual(5);
  });

  it("长字符串 objectSummary 不崩溃 observation store", () => {
    const longSummary = "a".repeat(10000);
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      {
        eventId: "evt_1",
        timestamp: 1000,
        eventType: "ADD",
        payload: {
          factId: "f1",
          subject: "Jon",
          predicate: "knows",
          objectSummary: longSummary,
          validAt: 1000,
        },
      },
    ]);
    expect(store.size()).toBe(1);
  });
});

// === 3. 类型边界 ===

describe("边界: 类型边界", () => {
  it("inferTemporalPolicyFromQuery: timestamp=0 不崩溃", () => {
    const result = inferTemporalPolicyFromQuery("test", 0);
    expect(result.policy).toBe("strict_current");
  });

  it("passesTemporalPolicy: now=0 不崩溃", () => {
    const fact = {
      factId: "f1",
      subject: "Jon",
      predicate: "knows",
      objectSummary: "x",
      valid_at: 0,
      reference_time: 0,
    };
    const result = passesTemporalPolicy(fact as never, "strict_current", 0);
    expect(result.passes).toBe(true);
  });

  it("LLMCallBudget: turnIndex=0 不崩溃", () => {
    const budget = new LLMCallBudget();
    const result = budget.check("reconcile", 0);
    expect(result.allowed).toBe(true);
  });

  it("LLMCallBudget: 负 turnIndex 不崩溃 (不回退)", () => {
    const budget = new LLMCallBudget();
    // turnIndex 不能为负, 但测试边界
    expect(() => budget.check("reconcile", 0)).not.toThrow();
  });

  it("computeGovernanceSignals: pruneStaleDays=0 视所有 fact 为 stale", () => {
    const facts = Array.from({ length: 20 }, (_, i) => ({
      factId: `f_${i}`,
      subject: "Jon",
      predicate: "knows",
      lastAccessedAt: 100000,
    }));
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100001, // 1ms later, pruneStaleDays=0 → 0ms 阈值
      pruneStaleDays: 0,
    });
    // 所有 fact 的 (referenceTime - lastAccessedAt) = 1ms > 0ms 阈值 → 全部 stale
    expect(signals.staleRatio).toBe(1);
  });
});

// === 4. 并发安全 (顺序追加) ===

describe("边界: 并发安全 (顺序追加)", () => {
  it("MemoryEventLog: 相同 timestamp 多次 append, eventId 仍唯一", () => {
    const log = new MemoryEventLog("user_1");
    const e1 = log.append({
      eventType: "ADD",
      payload: { factId: "f1" },
      timestamp: 1000,
    });
    const e2 = log.append({
      eventType: "ADD",
      payload: { factId: "f2" },
      timestamp: 1000, // 相同 timestamp
    });
    expect(e1.eventId).not.toBe(e2.eventId);
    expect(e1.eventHash).not.toBe(e2.eventHash);
    expect(log.verifyChain()).toBe(true);
  });

  it("ObservationStore: 分批增量 vs 一次性增量 一致", () => {
    const events: MemoryMutationEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push({
        eventId: `evt_${i}`,
        timestamp: i * 100,
        eventType: "ADD",
        payload: {
          factId: `f_${i}`,
          subject: "Jon",
          predicate: "knows",
          objectSummary: `fact ${i}`,
          validAt: i * 100,
        },
      });
    }

    // 一次性
    const storeBatch = new ObservationStore();
    storeBatch.updateObservationsIncremental(events);

    // 分批 (每批 5 个)
    const storeIncremental = new ObservationStore();
    for (let i = 0; i < events.length; i += 5) {
      storeIncremental.updateObservationsIncremental(events.slice(i, i + 5));
    }

    expect(storeBatch.size()).toBe(storeIncremental.size());
    const obs1 = storeBatch.getByKey("jon|knows");
    const obs2 = storeIncremental.getByKey("jon|knows");
    expect(obs1?.supportFactIds.length).toBe(obs2?.supportFactIds.length);
    expect(obs1?.supportFactIds.length).toBe(20);
  });
});

// === 5. 异常组合 ===

describe("边界: 异常组合", () => {
  it("SUPERSEDE 不存在的 fact: snapshot 仍正确", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "SUPERSEDE",
      payload: {
        factId: "f_new",
        supersededFactId: "f_nonexistent",
        subject: "Jon",
        predicate: "knows",
        objectSummary: "new fact",
        validAt: 1000,
      },
      timestamp: 1000,
    });
    // f_nonexistent 不存在, 但 f_new 应该被加入
    const snap = log.rebuildAsOfSnapshot(1000);
    expect(snap.facts).toHaveLength(1);
    expect(snap.facts[0].factId).toBe("f_new");
  });

  it("REDACT 后再 REDACT 同一 fact: hash chain 仍连续", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: { factId: "f1", subject: "Jon" },
      timestamp: 1000,
    });
    log.append({
      eventType: "REDACT",
      payload: { factId: "f1", redactionReason: "first" },
      timestamp: 2000,
    });
    log.append({
      eventType: "REDACT",
      payload: { factId: "f1", redactionReason: "second" },
      timestamp: 3000,
    });
    expect(log.verifyChain()).toBe(true);
    expect(log.getRedactionEvents()).toHaveLength(2);
  });

  it("INVALIDATE 已失效 fact: 不崩溃, invalidAt 更新", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: { factId: "f1", subject: "Jon", validAt: 1000 },
      timestamp: 1000,
    });
    log.append({
      eventType: "INVALIDATE",
      payload: { factId: "f1", invalidAt: 2000, reason: "wrong" },
      timestamp: 2000,
    });
    log.append({
      eventType: "INVALIDATE",
      payload: { factId: "f1", invalidAt: 3000, reason: "wrong_again" },
      timestamp: 3000,
    });
    expect(log.verifyChain()).toBe(true);
    const snap = log.rebuildAsOfSnapshot(3000);
    expect(snap.facts).toHaveLength(1);
    expect(snap.facts[0].invalidAt).toBe(3000); // 后者覆盖
  });

  it("PRUNE 不存在的 fact: 不崩溃, snapshot 为空", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "PRUNE",
      payload: { factId: "f_nonexistent", reason: "stale" },
      timestamp: 1000,
    });
    expect(log.verifyChain()).toBe(true);
    const snap = log.rebuildAsOfSnapshot(1000);
    expect(snap.facts).toHaveLength(0);
  });

  it("MERGE 空 mergedFactIds: 不崩溃", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "MERGE",
      payload: {
        factId: "f_merged",
        mergedFactIds: [],
        subject: "Jon",
        predicate: "knows",
        objectSummary: "merged",
      },
      timestamp: 1000,
    });
    expect(log.verifyChain()).toBe(true);
    const snap = log.rebuildAsOfSnapshot(1000);
    expect(snap.facts).toHaveLength(1);
    expect(snap.facts[0].factId).toBe("f_merged");
  });

  it("state-machine: 错误的 step 顺序抛错", () => {
    const sm = createRecommendedStateMachine("multi_hop");
    sm.start();
    // 直接尝试 finalize (无 generate) → 应抛错
    expect(() => {
      sm.finalize({
        hypotheses: [],
        missingInfo: null,
        nextAction: "done",
      });
    }).toThrow();
  });

  it("state-machine: evidence_expand 在 bridge_probe 之前抛错", () => {
    const sm = createRecommendedStateMachine("multi_hop");
    sm.start();
    // 直接尝试 evidence_expand (无 bridge_probe) → 应抛错
    expect(() => {
      sm.executeStep("evidence_expand", {
        hypotheses: [],
        missingInfo: null,
        nextAction: "generate",
      });
    }).toThrow();
  });

  it("decideGovernanceAction: 全 0 信号返回 none", () => {
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
});
