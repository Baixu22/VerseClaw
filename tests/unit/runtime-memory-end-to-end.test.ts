// @vitest-environment node
// 阶段 4: 端到端链路测试.
//
// 模拟真实用户会话: 从写入到治理的全流程, 验证 Week 1-6 组件协作无假阳性.
// 与阶段 3 跨组件测试的区别:
//   - 跨组件: 两个组件间的接口契约
//   - 端到端: 完整链路 (写入 → AUDN → 存储 → 检索 → 桥 → state-machine → 生成 → Reflect → event log → 治理)
//
// 场景:
//   1. 用户 Jon 的记忆生命周期:
//      T1: 抽取 f1 (Jon prefers dark theme)
//      T2: AUDN 决策 ADD → event log + observation
//      T3: 抽取 f2 (Jon no longer prefers dark theme, switched to light)
//      T4: AUDN 决策 SUPERSEDE → event log + observation
//      T5: 治理信号检测 conflictDensity, budget 决策是否 LLM reconcile
//      T6: 检索 (strict_current) 返回 f2 (light theme), 不返回 f1
//      T7: 时间 policy 切换 (include_history_ranked) 返回 f1 + f2
//   2. multi_hop 查询完整流程:
//      recall → bridge_probe → evidence_expand → generate → finalize
//      state-machine 严格按类别触发, 写入 trace
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
} from "../../openclaw_runtime/src/runtime-core/memory-event-log";
import {
  ObservationStore,
  type MemoryMutationEvent,
} from "../../openclaw_runtime/src/runtime-core/memory-observation-store";
import {
  computeGovernanceSignals,
  decideGovernanceAction,
  type GovernanceFactInput,
} from "../../openclaw_runtime/src/runtime-core/memory-governance";
import {
  getDegradationStrategy,
  LLMCallBudget,
} from "../../openclaw_runtime/src/runtime-core/memory-budget";
import {
  inferTemporalPolicyFromQuery,
  passesTemporalPolicy,
} from "../../openclaw_runtime/src/runtime-core/memory-temporal-policy";
import {
  backfillBridgeLiftAtK,
  discoverBridges,
  extractEntityPairFromQuery,
  weightedExpansionFromBridge,
} from "../../openclaw_runtime/src/runtime-core/memory-bridge-discovery";
import {
  constrainedExpansionFromBridge,
} from "../../openclaw_runtime/src/runtime-core/memory-chained-retrieval";
import {
  createRecommendedStateMachine,
  type MemoryReasoningStateDelta,
} from "../../openclaw_runtime/src/runtime-core/memory-agent-state-machine";
import {
  createRecallTraceBuilder,
  type RecallTrace,
  validateRecallTrace,
} from "../../openclaw_runtime/src/runtime-core/memory-trace";
// Week 7-8 WP4: evidence discipline
import {
  DEFAULT_EVIDENCE_DISCIPLINE_CONFIG,
  enforceEvidenceDiscipline,
} from "../../openclaw_runtime/src/runtime-core/memory-evidence-discipline";
// Week 7-8 WP0: runtime config + fingerprint
import {
  buildRuntimeFingerprint,
  createMemoryRuntimeConfig,
} from "../../openclaw_runtime/src/runtime-core/memory-runtime-config";

// === 工具函数 ===

function makeCandidate(
  factId: string,
  subject: string,
  predicate: string,
  objectSummary: string,
  overrides: Partial<RuntimeMemoryTemporalFactCandidate> = {},
): RuntimeMemoryTemporalFactCandidate {
  return buildRuntimeMemoryTemporalFactCandidateFixture({
    factId,
    subject,
    predicate,
    objectSummary,
    valid_at: 2000,
    reference_time: 2000,
    ...overrides,
  });
}

function makeFact(
  factId: string,
  subject: string,
  predicate: string,
  objectSummary: string,
  overrides: Partial<RuntimeMemoryTemporalFact> = {},
): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId,
    subject,
    predicate,
    objectSummary,
    valid_at: 1000,
    reference_time: 1000,
    ...overrides,
  });
}

function toMutationEvent(
  eventType: "ADD" | "SUPERSEDE" | "INVALIDATE" | "MERGE" | "PRUNE",
  factId: string,
  subject: string,
  predicate: string,
  objectSummary: string,
  extras: Partial<MemoryMutationEvent["payload"]> = {},
  timestamp = 1000,
): MemoryMutationEvent {
  return {
    eventId: `evt_${factId}_${timestamp}`,
    timestamp,
    eventType,
    payload: {
      factId,
      subject,
      predicate,
      objectSummary,
      validAt: timestamp,
      ...extras,
    },
  };
}

// === 场景 1: 用户 Jon 的记忆生命周期 ===

describe("端到端: 用户 Jon 的记忆生命周期", () => {
  it("T1-T7: 完整写入 → 冲突解决 → 治理 → 检索 → 时间 policy 流程", () => {
    const log = new MemoryEventLog("user_jon");
    const store = new ObservationStore();
    const liveFacts: RuntimeMemoryTemporalFact[] = [];

    // === T1: 抽取 f1 (Jon prefers dark theme) ===
    const f1Candidate = makeCandidate(
      "f1",
      "Jon",
      "prefers",
      "prefers dark theme",
    );

    // T2: AUDN 决策 (无现有 fact → ADD)
    const decision1 = decideAUDN(f1Candidate, liveFacts);
    expect(decision1.action).toBe("ADD");

    const apply1 = applyAUDNDecision(decision1, liveFacts);
    const f1: RuntimeMemoryTemporalFact = {
      ...f1Candidate,
      verificationStatus: "verified",
      acceptedAt: 1500,
      promotion: {
        promotedBy: "verifier",
        evidenceRefs: [],
      },
    } as RuntimeMemoryTemporalFact;
    liveFacts.push(...apply1.remainingFacts, f1);

    // 写入 event log + observation
    log.append({
      eventType: "ADD",
      payload: {
        factId: "f1",
        subject: "Jon",
        predicate: "prefers",
        objectSummary: "prefers dark theme",
        validAt: 1000,
      },
      timestamp: 1000,
    });
    store.updateObservationsIncremental([
      toMutationEvent("ADD", "f1", "Jon", "prefers", "prefers dark theme"),
    ]);

    expect(log.verifyChain()).toBe(true);
    expect(store.size()).toBe(1);

    // === T3: 抽取 f2 (Jon no longer prefers dark theme, switched to light) ===
    const f2Candidate = makeCandidate(
      "f2",
      "Jon",
      "prefers",
      "no longer prefers dark theme, switched to light",
      { valid_at: 3000, reference_time: 3000 },
    );

    // T4: AUDN 决策 (negation pattern → SUPERSEDE)
    const decision2 = decideAUDN(f2Candidate, liveFacts);
    expect(decision2.action).toBe("SUPERSEDE");

    const apply2 = applyAUDNDecision(decision2, liveFacts);
    expect(apply2.toInvalidateFactId).toBe("f1");

    // 更新 liveFacts: 移除 f1, 加入 f2
    const f2: RuntimeMemoryTemporalFact = {
      ...f2Candidate,
      verificationStatus: "verified",
      acceptedAt: 3500,
      promotion: { promotedBy: "verifier", evidenceRefs: [] },
    } as RuntimeMemoryTemporalFact;
    liveFacts.length = 0;
    liveFacts.push(...apply2.remainingFacts, f2);

    // 写入 event log + observation
    log.append({
      eventType: "SUPERSEDE",
      payload: {
        factId: "f2",
        supersededFactId: "f1",
        subject: "Jon",
        predicate: "prefers",
        objectSummary: "no longer prefers dark theme, switched to light",
        validAt: 3000,
      },
      timestamp: 3000,
    });
    store.updateObservationsIncremental([
      toMutationEvent(
        "SUPERSEDE",
        "f2",
        "Jon",
        "prefers",
        "no longer prefers dark theme, switched to light",
        { supersededFactId: "f1", validAt: 3000 },
        3000,
      ),
    ]);

    expect(log.verifyChain()).toBe(true);

    // === T5: 治理信号检测 ===
    // 构造 governance 输入: 1 valid + 1 invalid (f1 superseded)
    const govFacts: GovernanceFactInput[] = [
      {
        factId: "f1",
        subject: "Jon",
        predicate: "prefers",
        invalidAt: 3000, // superseded
        lastAccessedAt: 2500,
        accessCount: 2,
      },
      {
        factId: "f2",
        subject: "Jon",
        predicate: "prefers",
        lastAccessedAt: 3000,
        accessCount: 1,
      },
    ];
    const signals = computeGovernanceSignals({
      facts: govFacts,
      referenceTime: 3000,
    });
    // 总数 2 < 10 (minSampleSize) → conflictDensity = 0 (小样本保护)
    expect(signals.totalFacts).toBe(2);
    expect(signals.conflictDensity).toBe(0);
    expect(signals.conflictCount).toBe(1);

    // 无触发 (小样本保护)
    const govDecision = decideGovernanceAction(signals);
    expect(govDecision.action).toBe("none");

    // Budget 不被消耗
    const budget = new LLMCallBudget();
    expect(budget.getStats().totalAttempts).toBe(0);

    // === T6: 检索 (strict_current) → 只返回 f2 ===
    const now = 4000;
    const strictPolicy = inferTemporalPolicyFromQuery(
      "What theme does Jon prefer now?",
      now,
    );
    expect(strictPolicy.policy).toBe("strict_current");

    // f1 已被 superseded (invalidAt=3000) → 被 strict_current 过滤
    const f1WithInvalidAt = {
      ...makeFact("f1", "Jon", "prefers", "prefers dark theme"),
      invalid_at: 3000,
    } as RuntimeMemoryTemporalFact;
    const f2Fact = makeFact(
      "f2",
      "Jon",
      "prefers",
      "no longer prefers dark theme, switched to light",
    );

    const f1Pass = passesTemporalPolicy(
      f1WithInvalidAt as never,
      strictPolicy.policy,
      now,
    );
    const f2Pass = passesTemporalPolicy(
      f2Fact as never,
      strictPolicy.policy,
      now,
    );
    expect(f1Pass.passes).toBe(false); // f1 已失效
    expect(f2Pass.passes).toBe(true); // f2 当前有效

    // === T7: 时间 policy 切换 (include_history_ranked) → 返回 f1 + f2 ===
    const historyPolicy = inferTemporalPolicyFromQuery(
      "What theme did Jon prefer before?",
      now,
    );
    expect(historyPolicy.policy).toBe("include_history_ranked");

    const f1PassHistory = passesTemporalPolicy(
      f1WithInvalidAt as never,
      historyPolicy.policy,
      now,
    );
    expect(f1PassHistory.passes).toBe(true); // 历史模式允许 f1

    // === 验证 snapshot 一致性 ===
    const snapshotAt4000 = log.rebuildAsOfSnapshot(4000);
    expect(snapshotAt4000.facts).toHaveLength(2);
    const f1InSnap = snapshotAt4000.facts.find((f) => f.factId === "f1");
    const f2InSnap = snapshotAt4000.facts.find((f) => f.factId === "f2");
    expect(f1InSnap?.invalidAt).toBe(3000);
    expect(f2InSnap?.invalidAt).toBeUndefined();

    // === 验证 observation 一致性 ===
    const obs = store.getByKey("jon|prefers");
    expect(obs).toBeDefined();
    expect(obs?.supportFactIds).toContain("f2");
    expect(obs?.supportFactIds).not.toContain("f1"); // f1 已被移除
  });

  it("治理触发场景: 大量冲突 + budget 降级", () => {
    // 构造 20 个 fact, 5 个冲突 (25% conflictDensity > 15%)
    const govFacts: GovernanceFactInput[] = [
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
        invalidAt: 50000,
        lastAccessedAt: 100000,
        accessCount: 1,
      })),
    ];

    const signals = computeGovernanceSignals({
      facts: govFacts,
      referenceTime: 100000,
    });
    expect(signals.conflictDensity).toBeCloseTo(0.25, 5);

    const decision = decideGovernanceAction(signals);
    expect(decision.action).toBe("reconcile");

    // 模拟 LLM 调用预算耗尽
    const budget = new LLMCallBudget({ limits: { reconcile: 1 } });
    const r1 = budget.tryAcquire("reconcile", 0);
    expect(r1.allowed).toBe(true);

    const r2 = budget.tryAcquire("reconcile", 1);
    expect(r2.allowed).toBe(false);
    expect(r2.degraded).toBe(true);

    // 降级策略: rule_only
    const strategy = getDegradationStrategy("reconcile");
    expect(strategy.fallback).toBe("rule_only");
  });
});

// === 场景 2: multi_hop 查询完整流程 ===

describe("端到端: multi_hop 查询完整流程", () => {
  it("recall → bridge_probe → evidence_expand → generate → finalize + trace 完整", () => {
    // 构造 multi-hop 知识图谱:
    //   f1: Jon works at Conference (桥: 含 Jon 和 Conference)
    //   f2: Conference held in Boston
    //   f3: Boston is in USA
    //   f_answer: LocationInfo about Boston (答案 fact)
    const f1 = makeFact("f1", "Jon", "works_at", "works at Conference");
    const f2 = makeFact("f2", "Conference", "held_in", "held in Boston");
    const f3 = makeFact("f3", "Boston", "located_in", "is in USA");
    const fAnswer = makeFact(
      "f_answer",
      "LocationInfo",
      "indicates",
      "Boston is the answer",
    );
    const facts = [f1, f2, f3, fAnswer];

    // === Step 1: 抽取 entity pair ===
    const entityPair = extractEntityPairFromQuery(
      "「Jon」和「Conference」的关系是什么？",
    );
    expect(entityPair?.e1).toBe("Jon");
    expect(entityPair?.e2).toBe("Conference");

    // === Step 2: 启动 state-machine (multi_hop) ===
    const sm = createRecommendedStateMachine("multi_hop");
    sm.start();

    // === Step 3: recall (Step 1) ===
    const recallDelta: MemoryReasoningStateDelta = {
      hypotheses: ["Jon-Conference relation"],
      constraints: {
        temporalPolicy: "strict_current",
        entities: ["Jon", "Conference"],
        maxSteps: 12,
      },
      missingInfo: "Conference location",
      nextAction: "bridge_probe",
    };
    sm.executeStep("recall", recallDelta, { recalledFactIds: ["f1"] });

    // === Step 4: bridge_probe (Step 2) ===
    const { candidates, diagnostics } = discoverBridges(
      entityPair!,
      facts,
      undefined,
      1000,
    );
    const bridgeFactIds = candidates.map((c) => c.factId);
    expect(bridgeFactIds).toContain("f1");

    const bridgeDelta: MemoryReasoningStateDelta = {
      hypotheses: ["f1 is bridge"],
      missingInfo: "Conference location fact",
      nextAction: "evidence_expand",
    };
    sm.executeStep("bridge_probe", bridgeDelta, { bridgeFactIds });

    // === Step 5: evidence_expand (Step 3) ===
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
    expect(expansionFactIds).toContain("f_answer");

    const updatedDiag = backfillBridgeLiftAtK(
      diagnostics,
      expansionFactIds,
      ["f_answer"],
    );
    expect(updatedDiag.bridgeLiftAtK).toBe(1);

    const expandDelta: MemoryReasoningStateDelta = {
      hypotheses: ["f1 is bridge"],
      missingInfo: null,
      nextAction: "generate",
    };
    sm.executeStep("evidence_expand", expandDelta, { expansionFactIds });

    // === Step 6: generate (Step 4) ===
    const genDelta: MemoryReasoningStateDelta = {
      hypotheses: ["f1 is bridge"],
      missingInfo: null,
      nextAction: "finalize",
    };
    sm.executeStep("generate", genDelta, { answer: "Boston" });

    // === Step 7: finalize (Step 5) ===
    sm.finalize({
      hypotheses: ["f1 is bridge"],
      missingInfo: null,
      nextAction: "done",
    });

    // === Step 8: 写入完整 trace ===
    const builder = createRecallTraceBuilder({
      questionId: "Q_multi_hop_1",
      query: "Jon 和 Conference 的关系",
    });
    builder.setCategory("multi_hop");
    builder.setTemporalPolicy("strict_current");
    builder.setBridgeDiscovery({
      entityPair: [entityPair!.e1, entityPair!.e2],
      bridgeCandidateCount: candidates.length,
      timeFilteredOutCount: diagnostics.timeFilteredOutCount,
      selectedBridgeFactId: bridgeFactIds[0],
      pathLength: diagnostics.pathLength,
      bridgeLiftAtK: updatedDiag.bridgeLiftAtK,
      pathExistence: updatedDiag.pathExistence,
    });
    builder.addExpansionFacts(expansionFactIds);
    for (const step of sm.getSteps()) {
      builder.addAgentStep({
        stepIndex: step.stepIndex,
        stepType: step.stepType,
        stateDelta: step.stateDelta,
        durationMs: step.durationMs,
        output: step.output,
      });
    }
    builder.addLLMCall(500); // 假设 500 tokens

    const trace: RecallTrace = builder.build();

    // === 验证 trace 完整性 ===
    const validation = validateRecallTrace(trace);
    expect(validation).toEqual([]); // 无缺失字段

    expect(trace.category).toBe("multi_hop");
    expect(trace.temporalPolicy).toBe("strict_current");
    expect(trace.expansionFacts).toContain("f_answer");
    expect(trace.bridgeDiscovery?.bridgeLiftAtK).toBe(1);
    expect(trace.bridgeDiscovery?.selectedBridgeFactId).toBe("f1");
    expect(trace.agentSteps).toHaveLength(5);
    expect(trace.llmCalls).toBe(1);
    expect(trace.tokensUsed).toBe(500);

    // 验证 step 序列正确
    const stepTypes = trace.agentSteps.map((s) => s.stepType);
    expect(stepTypes).toEqual([
      "recall",
      "bridge_probe",
      "evidence_expand",
      "generate",
      "finalize",
    ]);
  });

  it("single_hop 简化流程: recall → generate → finalize (无 bridge_probe)", () => {
    const sm = createRecommendedStateMachine("single_hop");
    sm.start();

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
    expect(stepTypes).toEqual(["recall", "generate", "finalize"]);
    expect(stepTypes).not.toContain("bridge_probe");
  });
});

// === 场景 3: REDACT 合规删除流程 ===

describe("端到端: REDACT 合规删除流程", () => {
  it("ADD → REDACT → snapshot 移除 + hash chain 连续 + 审计可查", () => {
    const log = new MemoryEventLog("user_gdpr");

    // ADD 用户敏感 fact
    log.append({
      eventType: "ADD",
      payload: {
        factId: "f_sensitive",
        subject: "Jon",
        predicate: "ssn",
        objectSummary: "123-45-6789",
        entityIds: ["e_jon"],
        validAt: 1000,
      },
      timestamp: 1000,
    });

    // 用户要求 GDPR 删除
    log.append({
      eventType: "REDACT",
      payload: {
        factId: "f_sensitive",
        subject: "Jon",
        predicate: "ssn",
        objectSummary: "123-45-6789",
        redactionReason: "gdpr_user_request",
      },
      timestamp: 2000,
    });

    // hash chain 仍连续
    expect(log.verifyChain()).toBe(true);

    // REDACT 后内容字段置空
    const redactions = log.getRedactionEvents();
    expect(redactions).toHaveLength(1);
    expect(redactions[0].payload.factId).toBe("f_sensitive");
    expect(redactions[0].payload.subject).toBeUndefined();
    expect(redactions[0].payload.predicate).toBeUndefined();
    expect(redactions[0].payload.objectSummary).toBeUndefined();
    expect(redactions[0].payload.redactionReason).toBe("gdpr_user_request");

    // snapshot 移除 f_sensitive
    const snapshot = log.rebuildAsOfSnapshot(2000);
    expect(snapshot.facts).toHaveLength(0);

    // T=1500 时 f_sensitive 仍存在 (REDACT 之前)
    const snapshotBefore = log.rebuildAsOfSnapshot(1500);
    expect(snapshotBefore.facts).toHaveLength(1);
    expect(snapshotBefore.facts[0].factId).toBe("f_sensitive");
    expect(snapshotBefore.facts[0].objectSummary).toBe("123-45-6789");
  });
});

// === 场景 4: 1000 turns 模拟 (预算 + 治理联动) ===

describe("端到端: 1000 turns 预算模拟", () => {
  it("1000 turns reconcile 调用受预算控制, 50 次成功 950 次降级", () => {
    const budget = new LLMCallBudget();
    let llmCalls = 0;
    let degraded = 0;

    for (let turn = 0; turn < 1000; turn++) {
      const result = budget.tryAcquire("reconcile", turn);
      if (result.allowed) {
        llmCalls += 1;
      } else {
        degraded += 1;
        // 降级为 rule_only
        const strategy = getDegradationStrategy("reconcile");
        expect(strategy.fallback).toBe("rule_only");
      }
    }

    // 1000 turns / 100 window = 10 windows × 5 reconcile = 50 成功
    expect(llmCalls).toBe(50);
    expect(degraded).toBe(950);

    const stats = budget.getStats();
    expect(stats.totalAttempts).toBe(1000);
    expect(stats.totalDegraded).toBe(950);
  });
});

// === Week 7-8: multi-hop + usedFactIds 端到端场景 ===
//
// 验证 WP2/WP3/WP4 协作:
//   - WP2: EntityResolver canonicalize e1/e2 (bridge discovery)
//   - WP3: Weighted expansion 偏向 causal 路径 (selectedEdges trace)
//   - WP4: Evidence discipline 校验 usedFactIds 来自 expansion evidence
//
// 场景: 查询 "How does Jon's job change relate to his move to Boston?"
//   1. recall f1 (Jon started new job)
//   2. bridge discovery 找 f_bridge (Jon moved to Boston for new job)
//   3. weighted expansion 从 f_bridge 扩张, 偏向 causes 边
//   4. generate 输出 usedFactIds = [f1, f_bridge, f_expanded]
//   5. evidence discipline 校验 usedFactIds ⊆ recalledFacts ∪ supportFactIdsExpanded

describe("端到端 (Week 7-8): multi-hop + usedFactIds", () => {
  it("multi_hop 场景: bridge + weighted expansion + evidence discipline 全链路", () => {
    // === Setup: 构造 facts ===
    // 注意: makeCandidate 用 valid_at (snake_case), entities 字段会被保留
    // bridge discovery 通过文本匹配 (subject/objectSummary) + entityIds (cast) 找桥
    // weighted expansion 通过 entityIds 计算 entityOverlap
    const f1 = makeCandidate(
      "f1",
      "Jon",
      "started_job",
      "Jon started a new job at Acme Corp",
      { entities: ["Jon", "Acme Corp"], valid_at: 1000 },
    );
    const f2 = makeCandidate(
      "f2",
      "Jon",
      "moved_to",
      "Jon moved to Boston for the new job",
      { entities: ["Jon", "Boston"], valid_at: 1100 },
    );
    const f3 = makeCandidate(
      "f3",
      "Boston",
      "has_company",
      "Acme Corp is headquartered in Boston",
      { entities: ["Boston", "Acme Corp"], valid_at: 900 },
    );
    const f4 = makeCandidate(
      "f4",
      "Jon",
      "likes",
      "Jon likes Italian food",
      { entities: ["Jon", "Italian food"], valid_at: 800 },
    );

    const facts: RuntimeMemoryTemporalFactCandidate[] = [f1, f2, f3, f4];

    // bridge discovery 通过 (fact as { entityIds?: string[] }).entityIds 访问,
    // makeCandidate 只设 entities 字段, 需要额外添加 entityIds (与 WP2 测试一致)
    for (const f of facts) {
      (f as unknown as { entityIds: string[] }).entityIds = f.entities ?? [];
    }

    // === WP2: EntityResolver ===
    // 本场景 entities 已统一 (Jon/Boston/Acme Corp), 无需 resolver
    const resolver = null;

    // === WP3: Weighted expansion relations ===
    // f1 (started job) → causes → f2 (moved to Boston)  [causes, weight=1.0]
    // f2 (moved) → enables → f3 (Acme Corp in Boston)   [enables, weight=0.7]
    // f2 (moved) → related_to → f4 (likes Italian food) [related_to, weight=0.2, 无关]
    const relations = [
      {
        sourceFactId: "f1",
        targetFactId: "f2",
        relationType: "causes",
        confidence: 0.9,
      },
      {
        sourceFactId: "f2",
        targetFactId: "f3",
        relationType: "enables",
        confidence: 0.8,
      },
      {
        sourceFactId: "f2",
        targetFactId: "f4",
        relationType: "related_to",
        confidence: 0.5,
      },
    ];

    // === Step 1: Recall (模拟 hybrid retrieval 返回 f1) ===
    const recalledFactIds = ["f1"];

    // === Step 2: Bridge discovery (e1=Jon, e2=Boston) ===
    const query = "How does Jon's job change relate to his move to Boston?";
    const entityPair = { e1: "Jon", e2: "Boston" };

    const { candidates: bridgeCandidates, diagnostics: bridgeDiag } =
      discoverBridges(
        entityPair,
        facts,
        "strict_current",
        2000,
        { resolver, topK: 5, maxPathLength: 3 },
      );

    // bridge 应找到 f2 (同时包含 Jon 和 Boston)
    expect(bridgeCandidates.length).toBeGreaterThan(0);
    const bridgeFactId = bridgeDiag.selectedBridgeFactId;
    expect(bridgeFactId).not.toBeNull();
    expect(facts.find((f) => f.factId === bridgeFactId)?.subject).toBe("Jon");

    // pathExistence 应为 true (Jon → f2 → Boston 路径存在)
    expect(bridgeDiag.pathExistence).toBe(true);

    // === Step 3: Weighted expansion (causal-aware) ===
    const factsById = new Map<string, RuntimeMemoryQueryableFact>(
      facts.map((f) => [f.factId, f as unknown as RuntimeMemoryQueryableFact]),
    );
    const relationMap = new Map<string, string[]>();
    for (const rel of relations) {
      const arr = relationMap.get(rel.sourceFactId) ?? [];
      arr.push(rel.targetFactId);
      relationMap.set(rel.sourceFactId, arr);
      const arr2 = relationMap.get(rel.targetFactId) ?? [];
      arr2.push(rel.sourceFactId);
      relationMap.set(rel.targetFactId, arr2);
    }

    const expansionResult = weightedExpansionFromBridge(
      bridgeFactId ? [bridgeFactId] : [],
      relationMap,
      factsById,
      relations,
      "strict_current",
      2000,
      { maxDepth: 1, maxExpansion: 5 },
    );

    // expansion 应包含 f1 (causes 边, weight=1.0) 和 f3 (enables 边, weight=0.7)
    expect(expansionResult.expansionFactIds).toContain("f1");
    expect(expansionResult.expansionFactIds).toContain("f3");

    // selectedEdges trace 完整
    expect(expansionResult.selectedEdges.length).toBeGreaterThan(0);

    // f1 (causes) 应排在 f3 (enables) 之前, 因为 causes weight > enables weight
    const f1Edge = expansionResult.selectedEdges.find(
      (e) => e.toFactId === "f1",
    );
    const f3Edge = expansionResult.selectedEdges.find(
      (e) => e.toFactId === "f3",
    );
    expect(f1Edge).toBeDefined();
    expect(f3Edge).toBeDefined();
    if (f1Edge && f3Edge) {
      expect(f1Edge.scoreBreakdown.relationWeight).toBeGreaterThan(
        f3Edge.scoreBreakdown.relationWeight,
      );
      expect(f1Edge.relationType).toBe("causes");
      expect(f3Edge.relationType).toBe("enables");
    }

    // relationType 直方图应含 causes 和 enables
    expect(expansionResult.relationTypeHistogram).toHaveProperty("causes");
    expect(expansionResult.relationTypeHistogram).toHaveProperty("enables");

    // === Step 4: Generate (模型输出含 usedFactIds) ===
    const supportFactIdsExpanded = expansionResult.expansionFactIds;
    const allowedFactIds = new Set([
      ...recalledFactIds,
      ...supportFactIdsExpanded,
    ]);

    // 模拟模型输出: usedFactIds 全部合法
    const generatedOutput = {
      answer:
        "Jon's new job at Acme Corp caused him to move to Boston, where Acme is headquartered.",
      usedFactIds: [...recalledFactIds, ...supportFactIdsExpanded],
    };

    // === Step 5: Evidence discipline 校验 ===
    const evidenceResult = enforceEvidenceDiscipline(
      generatedOutput,
      recalledFactIds,
      supportFactIdsExpanded,
      DEFAULT_EVIDENCE_DISCIPLINE_CONFIG,
      0,
    );

    // usedFactIds 全部合法 → validated=true
    expect(evidenceResult.validated).toBe(true);
    expect(evidenceResult.shouldRegenerate).toBe(false);

    // 所有 usedFactIds 都来自 recalledFacts ∪ supportFactIdsExpanded
    for (const fid of generatedOutput.usedFactIds) {
      expect(allowedFactIds.has(fid)).toBe(true);
    }

    // === Step 6: 写入 RecallTrace (端到端可观测) ===
    const builder = createRecallTraceBuilder({
      questionId: "e2e_week7_8_multihop",
      query,
    });
    builder.setCategory("multi_hop");
    builder.setTemporalPolicy("strict_current");
    builder.setRuntimeFingerprint(
      buildRuntimeFingerprint(
        createMemoryRuntimeConfig({
          featureFlags: {
            enableEntityResolverInBridge: false, // 本场景 resolver=null
            enableWeightedTraversalInExpansion: true,
            enableEvidenceDiscipline: true,
          },
        }),
      ),
    );
    for (const fid of recalledFactIds) {
      builder.addRecalledFact({
        factId: fid,
        finalScore: 0.9,
        armRanks: { bm25: 1, vector: 1 },
      });
    }
    builder.setBridgeDiscovery({
      entityPair: [entityPair.e1, entityPair.e2],
      bridgeFactId: bridgeFactId ?? undefined,
      betweennessScore: 1.0,
      pathLength: 1,
      timeFilteredOutCount: bridgeDiag.timeFilteredOutCount,
      bridgeLiftAtK: 1,
      pathExistence: bridgeDiag.pathExistence,
      entityResolution: {
        applied: false,
        input: entityPair,
        canonical: entityPair,
        mappings: [],
      },
      selectedEdges: expansionResult.selectedEdges,
      relationTypeHistogram: expansionResult.relationTypeHistogram,
    });
    builder.addExpansionFacts(supportFactIdsExpanded);
    builder.setEvidenceDiscipline(evidenceResult.trace);
    builder.addLLMCall(800);

    const trace = builder.build();

    // === 验证 trace 完整性 ===
    expect(trace.questionId).toBe("e2e_week7_8_multihop");
    expect(trace.category).toBe("multi_hop");
    expect(trace.runtimeFingerprint).toBeDefined();
    expect(trace.runtimeFingerprint?.featureFlags.enableWeightedTraversalInExpansion).toBe(true);
    expect(trace.runtimeFingerprint?.featureFlags.enableEvidenceDiscipline).toBe(true);

    // bridge discovery trace 含 selectedEdges
    expect(trace.bridgeDiscovery).not.toBeNull();
    expect(trace.bridgeDiscovery?.selectedEdges).toBeDefined();
    expect(trace.bridgeDiscovery?.selectedEdges?.length).toBeGreaterThan(0);
    expect(trace.bridgeDiscovery?.relationTypeHistogram).toBeDefined();

    // evidence discipline trace
    expect(trace.evidenceDiscipline).toBeDefined();
    expect(trace.evidenceDiscipline?.enabled).toBe(true);
    expect(trace.evidenceDiscipline?.validated).toBe(true);
    expect(trace.evidenceDiscipline?.usedFactIds).toEqual(generatedOutput.usedFactIds);

    // validateRecallTrace 应通过 (无缺失字段)
    const missing = validateRecallTrace(trace);
    expect(missing).toEqual([]);
  });

  it("multi_hop 场景: evidence discipline 检测 hallucinated factId", () => {
    // 场景: 模型引用了未在 recalledFacts/supportFactIdsExpanded 中的 fact
    const recalledFactIds = ["f1", "f2"];
    const supportFactIdsExpanded = ["f3"];

    const hallucinatedOutput = {
      answer: "fabricated answer",
      usedFactIds: ["f1", "f_hallucinated"], // f_hallucinated 不在 allowed
    };

    const result = enforceEvidenceDiscipline(
      hallucinatedOutput,
      recalledFactIds,
      supportFactIdsExpanded,
      DEFAULT_EVIDENCE_DISCIPLINE_CONFIG,
      0,
    );

    // 校验失败
    expect(result.validated).toBe(false);
    // 默认策略 insufficient_evidence → 降级
    expect(result.finalOutput.answer).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.finalOutput.usedFactIds).toEqual([]);
    // trace 记录失败
    expect(result.trace.validated).toBe(false);
    expect(result.trace.failureReason).toContain("f_hallucinated");
  });
});
