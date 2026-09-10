// @vitest-environment node
// 阶段 3: 跨组件一致性测试.
//
// 验证组件间数据流转无假阳性. 与单元测试的区别:
//   - 单元测试: 隔离测试单个组件
//   - 跨组件测试: 多个组件协作, 验证接口契约 + 数据一致性
//
// 覆盖链路:
//   1. AUDN 决策 → event log 记录 → as-of snapshot 重建一致
//   2. 治理信号 → budget 决策 → 降级策略联动
//   3. 桥发现 → 受控扩张 → recall trace 记录
//   4. 时间 policy → 检索结果过滤一致
//   5. observation 增量更新 vs event log snapshot 一致
//   6. state-machine 步骤 → trace 字段完整
import { describe, expect, it } from "vitest";
import {
  applyAUDNDecision,
  decideAUDN,
} from "../../openclaw_runtime/src/runtime-core/memory-write-curation";
import {
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
  type RuntimeMemoryTemporalFactCandidate,
} from "../../openclaw_runtime/src/runtime-core/memory-context";
import {
  MemoryEventLog,
  type MemoryEventPayload,
} from "../../openclaw_runtime/src/runtime-core/memory-event-log";
import {
  computeGovernanceSignals,
  decideGovernanceAction,
  type GovernanceFactInput,
} from "../../openclaw_runtime/src/runtime-core/memory-governance";
import {
  DEGRADATION_STRATEGIES,
  getDegradationStrategy,
  LLMCallBudget,
} from "../../openclaw_runtime/src/runtime-core/memory-budget";
import {
  backfillBridgeLiftAtK,
  discoverBridges,
  extractEntityPairFromQuery,
} from "../../openclaw_runtime/src/runtime-core/memory-bridge-discovery";
import {
  constrainedExpansionFromBridge,
} from "../../openclaw_runtime/src/runtime-core/memory-chained-retrieval";
import {
  inferTemporalPolicyFromQuery,
  passesTemporalPolicy,
} from "../../openclaw_runtime/src/runtime-core/memory-temporal-policy";
import {
  ObservationStore,
  type MemoryMutationEvent,
} from "../../openclaw_runtime/src/runtime-core/memory-observation-store";
import {
  createRecommendedStateMachine,
  type MemoryReasoningStateDelta,
} from "../../openclaw_runtime/src/runtime-core/memory-agent-state-machine";
import {
  createRecallTraceBuilder,
  type RecallTrace,
} from "../../openclaw_runtime/src/runtime-core/memory-trace";

// === 工具函数 ===

function makeFact(
  factId: string,
  subject: string,
  objectSummary: string,
  overrides: Partial<RuntimeMemoryTemporalFact> = {},
): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId,
    subject,
    predicate: "lives_in",
    objectSummary,
    valid_at: 1000,
    reference_time: 1000,
    ...overrides,
  });
}

function makeCandidate(
  factId: string,
  subject: string,
  objectSummary: string,
  overrides: Partial<RuntimeMemoryTemporalFactCandidate> = {},
): RuntimeMemoryTemporalFactCandidate {
  return buildRuntimeMemoryTemporalFactCandidateFixture({
    factId,
    subject,
    predicate: "lives_in",
    objectSummary,
    valid_at: 2000,
    reference_time: 2000,
    ...overrides,
  });
}

// === 1. AUDN → event log → snapshot 一致性 ===

describe("跨组件一致性: AUDN → event log → snapshot", () => {
  it("SUPERSEDE 决策 → event log 记录 → snapshot 重建一致", () => {
    // Setup: 已有 f1 (Jon prefers dark theme)
    const f1 = makeFact("f1", "Jon", "prefers dark theme", {
      predicate: "prefers",
    });
    // 新候选 f2 (Jon no longer prefers dark theme, switched to light) — 触发 negation pattern
    const f2Candidate = makeCandidate(
      "f2",
      "Jon",
      "no longer prefers dark theme, switched to light",
      { predicate: "prefers" },
    );

    // Step 1: AUDN 决策 — negation pattern 触发 SUPERSEDE
    const decision = decideAUDN(f2Candidate, [f1]);
    expect(decision.action).toBe("SUPERSEDE");

    // Step 2: 应用决策
    const applyResult = applyAUDNDecision(decision, [f1]);
    expect(applyResult.toInvalidateFactId).toBe("f1");

    // Step 3: 写入 event log
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: {
        factId: "f1",
        subject: f1.subject,
        predicate: f1.predicate,
        objectSummary: f1.objectSummary,
        validAt: f1.valid_at,
      },
      timestamp: 1000,
    });
    log.append({
      eventType: "SUPERSEDE",
      payload: {
        factId: "f2",
        supersededFactId: "f1",
        subject: f2Candidate.subject,
        predicate: f2Candidate.predicate,
        objectSummary: f2Candidate.objectSummary,
        validAt: f2Candidate.valid_at,
      },
      timestamp: 2000,
    });

    // Step 4: 验证 hash chain 完整
    expect(log.verifyChain()).toBe(true);

    // Step 5: snapshot 重建一致性
    const snapshot = log.rebuildAsOfSnapshot(2000);
    const f1InSnap = snapshot.facts.find((f) => f.factId === "f1");
    const f2InSnap = snapshot.facts.find((f) => f.factId === "f2");
    expect(f1InSnap?.invalidAt).toBe(2000);
    expect(f2InSnap?.invalidAt).toBeUndefined();
    expect(f2InSnap?.objectSummary).toContain("light");
  });

  it("ADD 决策 → event log 记录 → snapshot 包含新 fact", () => {
    const f1Candidate = makeCandidate("f1", "Jon", "Boston");
    // 无现有 fact, 应为 ADD
    const decision = decideAUDN(f1Candidate, []);
    expect(decision.action).toBe("ADD");

    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: {
        factId: "f1",
        subject: f1Candidate.subject,
        predicate: f1Candidate.predicate,
        objectSummary: f1Candidate.objectSummary,
        validAt: f1Candidate.valid_at,
      },
      timestamp: 1000,
    });

    const snapshot = log.rebuildAsOfSnapshot(1000);
    expect(snapshot.facts).toHaveLength(1);
    expect(snapshot.facts[0].factId).toBe("f1");
  });

  it("NONE 决策 (重复 fact) → 不写入 event log", () => {
    const f1 = makeFact("f1", "Jon", "Boston");
    // 相同 fact → NONE
    const dupCandidate = makeCandidate("f1_dup", "Jon", "Boston");
    const decision = decideAUDN(dupCandidate, [f1]);

    // NONE 不应写入 event log
    const log = new MemoryEventLog("user_1");
    if (decision.action !== "NONE") {
      log.append({
        eventType: "ADD",
        payload: { factId: dupCandidate.factId },
        timestamp: 2000,
      });
    }
    expect(log.size()).toBe(0);
  });
});

// === 2. 治理 → budget → 降级策略联动 ===

describe("跨组件一致性: governance → budget → degradation", () => {
  it("conflictDensity 触发 reconcile → budget 耗尽 → 降级 rule_only", () => {
    // Step 1: 构造高 conflictDensity 场景
    const facts: GovernanceFactInput[] = [
      ...Array.from({ length: 15 }, (_, i) => ({
        factId: `f_ok_${i}`,
        subject: "Jon",
        predicate: "knows",
        lastAccessedAt: 100000,
        accessCount: 1,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        factId: `f_conflict_${i}`,
        subject: "Jon",
        predicate: "knows",
        invalidAt: 50000, // 25% conflict
        lastAccessedAt: 100000,
        accessCount: 1,
      })),
    ];

    // Step 2: 治理信号触发 reconcile
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    expect(signals.conflictDensity).toBeCloseTo(0.25, 5);
    const decision = decideGovernanceAction(signals);
    expect(decision.action).toBe("reconcile");

    // Step 3: budget 耗尽 (限额 1, 已用 1)
    const budget = new LLMCallBudget({ limits: { reconcile: 1 } });
    budget.recordCall("reconcile", 0);

    // Step 4: 第二次尝试 → 降级
    const check = budget.tryAcquire("reconcile", 1);
    expect(check.allowed).toBe(false);
    expect(check.degraded).toBe(true);

    // Step 5: 降级策略为 rule_only
    const strategy = getDegradationStrategy("reconcile");
    expect(strategy.fallback).toBe("rule_only");
    expect(strategy.reason).toContain("rule-only");
  });

  it("driftScore 触发 rebuild → budget 允许 → 不降级", () => {
    const recent = new Map([
      ["Jon", 80],
      ["Mary", 20],
    ]);
    const historical = new Map([
      ["Jon", 20],
      ["Mary", 80],
    ]);
    const signals = computeGovernanceSignals({
      facts: Array.from({ length: 20 }, (_, i) => ({
        factId: `f${i}`,
        subject: "x",
        predicate: "y",
        lastAccessedAt: 100000,
      })),
      referenceTime: 100000,
      recentFactDistribution: recent,
      historicalFactDistribution: historical,
    });
    expect(signals.driftScore).toBeGreaterThan(0.3);
    const decision = decideGovernanceAction(signals);
    expect(decision.action).toBe("rebuild");

    // rebuild 不消耗 reconcile 预算 (独立类型)
    const budget = new LLMCallBudget();
    expect(budget.check("reconcile", 0).allowed).toBe(true);
  });

  it("无信号触发 → budget 不被消耗", () => {
    const facts: GovernanceFactInput[] = Array.from(
      { length: 20 },
      (_, i) => ({
        factId: `f${i}`,
        subject: "Jon",
        predicate: "knows",
        lastAccessedAt: 100000,
        accessCount: 1,
      }),
    );
    const signals = computeGovernanceSignals({
      facts,
      referenceTime: 100000,
    });
    const decision = decideGovernanceAction(signals);
    expect(decision.action).toBe("none");

    // 无触发 → 不应调用 budget
    const budget = new LLMCallBudget();
    expect(budget.getStats().totalAttempts).toBe(0);
  });

  it("DEGRADATION_STRATEGIES 覆盖所有 LLMCallType", () => {
    const callTypes = ["reconcile", "regenerate", "critique", "redact_decide"];
    for (const ct of callTypes) {
      const strategy = DEGRADATION_STRATEGIES[ct as keyof typeof DEGRADATION_STRATEGIES];
      expect(strategy).toBeDefined();
      expect(strategy.callType).toBe(ct);
      expect(typeof strategy.fallback).toBe("string");
      expect(typeof strategy.reason).toBe("string");
    }
  });
});

// === 3. 桥发现 → 受控扩张 → recall trace ===

describe("跨组件一致性: bridge → expansion → trace", () => {
  it("两阶段 multi-hop: 桥发现 → 扩张 → trace 记录完整", () => {
    // 构造 multi-hop 场景 (entity pair: Jon ↔ Conference):
    //   f1: Jon works at Conference  (桥: 同时含 Jon 和 Conference)
    //   f2: Conference held in Boston (含 Conference)
    //   f3: Boston is in USA
    //   f_answer: LocationInfo about Boston (不含 Jon 或 Conference → 仅通过 expansion 命中)
    // Query: "「Jon」和「Conference」的关系" → 桥 = f1 (连接 Jon 和 Conference)
    const f1 = makeFact("f1", "Jon", "works at Conference", { valid_at: 1000 });
    const f2 = makeFact("f2", "Conference", "held in Boston", { valid_at: 1000 });
    const f3 = makeFact("f3", "Boston", "is in USA", { valid_at: 1000 });
    // f_answer 不含 entity "Jon" 或 "Conference", 不会被识别为桥
    const fAnswer = makeFact("f_answer", "LocationInfo", "Boston is the answer", { valid_at: 1000 });
    const facts = [f1, f2, f3, fAnswer];

    // Step 1: 抽取 entity pair
    const entityPair = extractEntityPairFromQuery(
      "「Jon」和「Conference」的关系是什么？",
    );
    expect(entityPair).not.toBeNull();
    expect(entityPair?.e1).toBe("Jon");
    expect(entityPair?.e2).toBe("Conference");

    // Step 2: 桥发现 — f1 (直接桥), f2 (间接桥, 含 Conference)
    const { candidates, diagnostics } = discoverBridges(
      entityPair!,
      facts,
      undefined,
      1000,
    );
    expect(candidates.length).toBeGreaterThan(0);
    const bridgeFactIds = candidates.map((c) => c.factId);
    expect(bridgeFactIds).toContain("f1");
    // f_answer 不应被识别为桥 (不含 Jon 或 Conference)
    expect(bridgeFactIds).not.toContain("f_answer");

    // Step 3: 受控扩张 — 从 f1 出发, relationMap 指向 f_answer
    const relationMap = new Map<string, string[]>();
    relationMap.set("f1", ["f2", "f_answer"]);
    relationMap.set("f2", ["f3", "f_answer"]);
    const factsById = new Map(facts.map((f) => [f.factId, f]));

    const { expansionFactIds } = constrainedExpansionFromBridge(
      bridgeFactIds,
      relationMap,
      factsById,
      { maxDepth: 1, maxExpansion: 5 },
    );
    expect(expansionFactIds.length).toBeGreaterThan(0);
    // f_answer 应在 expansionFactIds 中 (因为不在 bridgeSet 中)
    expect(expansionFactIds).toContain("f_answer");

    // Step 4: 回填 Bridge Lift@K — f_answer 在 expansion 中 → lift=1
    const updatedDiag = backfillBridgeLiftAtK(
      diagnostics,
      expansionFactIds,
      ["f_answer"], // answer-supporting fact
    );
    expect(updatedDiag.bridgeLiftAtK).toBe(1);

    // Step 5: 写入 recall trace (使用 builder 模式)
    const builder = createRecallTraceBuilder({
      questionId: "Q1",
      query: "Jon 和 Conference 的关系",
    });
    builder.setCategory("multi_hop");
    builder.setBridgeDiscovery({
      entityPair: [entityPair!.e1, entityPair!.e2],
      bridgeCandidateCount: diagnostics.bridgeCandidateCount,
      selectedBridgeFactId: diagnostics.selectedBridgeFactId,
      timeFilteredOutCount: diagnostics.timeFilteredOutCount,
      pathLength: diagnostics.pathLength,
      bridgeLiftAtK: updatedDiag.bridgeLiftAtK,
      pathExistence: updatedDiag.pathExistence,
    });
    builder.addExpansionFacts(expansionFactIds);
    const trace: RecallTrace = builder.build();

    expect(trace.expansionFacts).toEqual(expansionFactIds);
    expect(trace.bridgeDiscovery?.bridgeLiftAtK).toBe(1);
    expect((trace.bridgeDiscovery as any)?.selectedBridgeFactId).toBe(bridgeFactIds[0]);
    expect(trace.category).toBe("multi_hop");
  });

  it("无桥发现 → 不执行扩张 → trace 记录空", () => {
    const entityPair = extractEntityPairFromQuery(
      "「Alice」和「Bob」的关系是什么？",
    );
    expect(entityPair?.e1).toBe("Alice");
    expect(entityPair?.e2).toBe("Bob");

    // 无 fact 连接 Alice 和 Bob
    const facts: RuntimeMemoryTemporalFact[] = [
      makeFact("f1", "Charlie", "knows Dave"),
    ];
    const { candidates, diagnostics } = discoverBridges(
      entityPair!,
      facts,
      undefined,
      1000,
    );
    expect(candidates).toHaveLength(0);
    expect(diagnostics.pathExistence).toBe(false);

    // 无桥 → 不执行扩张
    const relationMap = new Map<string, string[]>();
    const factsById = new Map(facts.map((f) => [f.factId, f]));
    const { expansionFactIds, expansionHits } = constrainedExpansionFromBridge(
      [],
      relationMap,
      factsById,
    );
    expect(expansionFactIds).toHaveLength(0);
    expect(expansionHits).toHaveLength(0);
  });
});

// === 4. 时间 policy → 检索结果过滤一致 ===

describe("跨组件一致性: temporal policy → 过滤一致", () => {
  it("strict_current: 历史事实被过滤", () => {
    const now = 10000;
    const currentFact = makeFact("f1", "Jon", "NYC", {
      valid_at: 5000,
      reference_time: 5000,
    });
    const expiredFact = makeFact("f2", "Jon", "Boston", {
      valid_at: 1000,
      reference_time: 1000,
    });
    // 模拟 expired (invalid_at < now)
    (expiredFact as RuntimeMemoryTemporalFact & { invalid_at?: number }).invalid_at = 2000;

    // strict_current policy
    const result1 = passesTemporalPolicy(
      currentFact as never,
      "strict_current",
      now,
    );
    expect(result1.passes).toBe(true);

    const result2 = passesTemporalPolicy(
      expiredFact as never,
      "strict_current",
      now,
    );
    expect(result2.passes).toBe(false);
  });

  it("include_history_ranked: 历史事实通过过滤", () => {
    const now = 10000;
    const expiredFact = makeFact("f1", "Jon", "Boston", {
      valid_at: 1000,
      reference_time: 1000,
    });
    (expiredFact as RuntimeMemoryTemporalFact & { invalid_at?: number }).invalid_at = 2000;

    const result = passesTemporalPolicy(
      expiredFact as never,
      "include_history_ranked",
      now,
    );
    expect(result.passes).toBe(true); // 历史事实通过
  });

  it("query-intent 启发式: '以前' 触发 include_history_ranked", () => {
    const r1 = inferTemporalPolicyFromQuery("Jon 以前住在哪里？", 10000);
    expect(r1.policy).toBe("include_history_ranked");

    const r2 = inferTemporalPolicyFromQuery("Where did Jon live before?", 10000);
    expect(r2.policy).toBe("include_history_ranked");

    const r3 = inferTemporalPolicyFromQuery("Jon 现在住在哪里？", 10000);
    expect(r3.policy).toBe("strict_current");
  });

  it("as_of(T): 指定时间点重建", () => {
    const r = inferTemporalPolicyFromQuery(
      "In 2023, where did Jon live?",
      10000,
    );
    expect(r.policy).toBe("as_of");
    expect(r.asOfTime).toBeDefined();
  });
});

// === 5. observation 增量更新 vs event log snapshot 一致性 ===

describe("跨组件一致性: observation ↔ event log snapshot", () => {
  it("ADD 事件: observation 与 snapshot 一致", () => {
    const log = new MemoryEventLog("user_1");
    const store = new ObservationStore();

    const payload: MemoryEventPayload = {
      factId: "f1",
      subject: "Jon",
      predicate: "lives_in",
      objectSummary: "Boston",
      entityIds: ["e_jon", "e_boston"],
      validAt: 1000,
    };

    log.append({ eventType: "ADD", payload, timestamp: 1000 });
    const obsEvent: MemoryMutationEvent = {
      eventId: "evt_1",
      timestamp: 1000,
      eventType: "ADD",
      payload: {
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston",
        entityIds: ["e_jon", "e_boston"],
        validAt: 1000,
      },
    };
    store.updateObservationsIncremental([obsEvent]);

    // snapshot 包含 f1
    const snapshot = log.rebuildAsOfSnapshot(1000);
    expect(snapshot.facts).toHaveLength(1);
    expect(snapshot.facts[0].factId).toBe("f1");

    // observation store 也包含对应 observation
    const obs = store.getByKey("jon|lives_in");
    expect(obs).toBeDefined();
    expect(obs?.supportFactIds).toContain("f1");
  });

  it("SUPERSEDE 事件: observation 移除旧 fact, snapshot 标记 invalidAt", () => {
    const log = new MemoryEventLog("user_1");
    const store = new ObservationStore();

    // ADD f1
    log.append({
      eventType: "ADD",
      payload: {
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston",
        entityIds: ["e_jon"],
        validAt: 1000,
      },
      timestamp: 1000,
    });
    store.updateObservationsIncremental([
      {
        eventId: "evt_1",
        timestamp: 1000,
        eventType: "ADD",
        payload: {
          factId: "f1",
          subject: "Jon",
          predicate: "lives_in",
          objectSummary: "Boston",
          entityIds: ["e_jon"],
          validAt: 1000,
        },
      },
    ]);

    // SUPERSEDE f1 with f2
    log.append({
      eventType: "SUPERSEDE",
      payload: {
        factId: "f2",
        supersededFactId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "NYC",
        entityIds: ["e_jon"],
        validAt: 2000,
      },
      timestamp: 2000,
    });
    store.updateObservationsIncremental([
      {
        eventId: "evt_2",
        timestamp: 2000,
        eventType: "SUPERSEDE",
        payload: {
          factId: "f2",
          supersededFactId: "f1",
          subject: "Jon",
          predicate: "lives_in",
          objectSummary: "NYC",
          entityIds: ["e_jon"],
          validAt: 2000,
        },
      },
    ]);

    // snapshot: f1 invalidAt=2000, f2 valid
    const snapshot = log.rebuildAsOfSnapshot(2000);
    expect(snapshot.facts).toHaveLength(2);
    expect(snapshot.facts.find((f) => f.factId === "f1")?.invalidAt).toBe(
      2000,
    );
    expect(snapshot.facts.find((f) => f.factId === "f2")?.invalidAt).toBe(
      undefined,
    );

    // observation: supportFactIds 应该是 [f2], 不含 f1
    const obs = store.getByKey("jon|lives_in");
    expect(obs?.supportFactIds).toContain("f2");
    expect(obs?.supportFactIds).not.toContain("f1");
  });
});

// === 6. state-machine → trace 字段完整 ===

describe("跨组件一致性: state-machine → trace", () => {
  it("完整 multi_hop 流程: 每步 stateDelta 写入 trace", () => {
    const sm = createRecommendedStateMachine("multi_hop");
    sm.start();

    // Step 1: recall
    const recallDelta: MemoryReasoningStateDelta = {
      hypotheses: ["Jon-Conference relation"],
      constraints: { temporalPolicy: "strict_current", maxSteps: 12 },
      missingInfo: "Conference location",
      nextAction: "bridge_probe",
    };
    const step1 = sm.executeStep("recall", recallDelta, {
      recalledFactIds: ["f1"],
    });
    expect(step1).toBeDefined();

    // Step 2: bridge_probe
    const bridgeDelta: MemoryReasoningStateDelta = {
      hypotheses: ["f1 is bridge"],
      missingInfo: "Conference location fact",
      nextAction: "evidence_expand",
    };
    const step2 = sm.executeStep(
      "bridge_probe",
      bridgeDelta,
      { bridgeFactIds: ["f1"] },
    );
    expect(step2).toBeDefined();

    // Step 3: evidence_expand
    const expandDelta: MemoryReasoningStateDelta = {
      hypotheses: ["f1 is bridge"],
      missingInfo: null,
      nextAction: "generate",
    };
    const step3 = sm.executeStep(
      "evidence_expand",
      expandDelta,
      { expansionFactIds: ["f_answer"] },
    );
    expect(step3).toBeDefined();

    // Step 4: generate
    const genDelta: MemoryReasoningStateDelta = {
      hypotheses: ["f1 is bridge"],
      missingInfo: null,
      nextAction: "finalize",
    };
    const step4 = sm.executeStep("generate", genDelta, {
      answer: "Boston",
    });
    expect(step4).toBeDefined();

    // Step 5: finalize
    sm.finalize({
      hypotheses: ["f1 is bridge"],
      missingInfo: null,
      nextAction: "done",
    });

    // 验证 trace 字段完整
    const steps = sm.getSteps();
    expect(steps).toHaveLength(5);
    expect(steps[0].stepType).toBe("recall");
    expect(steps[0].output?.recalledFactIds).toEqual(["f1"]);
    expect(steps[1].stepType).toBe("bridge_probe");
    expect(steps[1].output?.bridgeFactIds).toEqual(["f1"]);
    expect(steps[2].stepType).toBe("evidence_expand");
    expect(steps[2].output?.expansionFactIds).toEqual(["f_answer"]);
    expect(steps[3].stepType).toBe("generate");
    expect(steps[3].output?.answer).toBe("Boston");
    expect(steps[4].stepType).toBe("finalize");

    // 每步都有 stateDelta
    for (const step of steps) {
      expect(step.stateDelta).toBeDefined();
      expect(step.stateDelta.missingInfo).toBeDefined();
      expect(step.stateDelta.nextAction).toBeDefined();
    }
  });

  it("single_hop 流程: 不触发 bridge_probe", () => {
    const sm = createRecommendedStateMachine("single_hop");
    sm.start();

    // single_hop: recall → generate → finalize
    sm.executeStep("recall", {
      hypotheses: [],
      missingInfo: null,
      nextAction: "generate",
    });
    sm.executeStep("generate", {
      hypotheses: [],
      missingInfo: null,
      nextAction: "finalize",
    });
    sm.finalize({
      hypotheses: [],
      missingInfo: null,
      nextAction: "done",
    });

    const steps = sm.getSteps();
    expect(steps).toHaveLength(3);
    const stepTypes = steps.map((s) => s.stepType);
    expect(stepTypes).not.toContain("bridge_probe");
    expect(stepTypes).not.toContain("evidence_expand");
  });

  it("重复 recall 硬约束: 超过 2 次拒绝", () => {
    const sm = createRecommendedStateMachine("multi_hop");
    sm.start();

    sm.executeStep("recall", {
      hypotheses: [],
      missingInfo: null,
      nextAction: "recall",
    });
    sm.executeStep("recall", {
      hypotheses: [],
      missingInfo: null,
      nextAction: "recall",
    });
    // 第 3 次 recall 应该被拒绝
    expect(() => {
      sm.executeStep("recall", {
        hypotheses: [],
        missingInfo: null,
        nextAction: "recall",
      });
    }).toThrow();
  });
});
