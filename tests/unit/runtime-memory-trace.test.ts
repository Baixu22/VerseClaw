// @vitest-environment node
// Week 1 v2: Recall trace 字段完整性单元测试.
//
// 覆盖 memory-arch-roadmap.md §E.3 (recall trace v2 增强) 要求:
// - Builder 模式正确追加各字段
// - validateRecallTrace 检测缺失必填字段 (Week 1 验收门槛: 覆盖率 100%)
// - serializeRecallTrace 输出合法 JSON
// - summarizeRecallTrace 统计指标正确 (A/B 对比用)
// - 占位字段 (temporalPolicy / bridgeDiscovery / agentSteps) 可被各 Week 组件填充
import { describe, expect, it } from "vitest";
import {
  createRecallTraceBuilder,
  serializeRecallTrace,
  summarizeRecallTrace,
  validateRecallTrace,
  type RecallTrace,
  type RecallTraceFact,
} from "../../openclaw_runtime/src/runtime-core/memory-trace";

describe("RecallTraceBuilder", () => {
  it("builds a minimal trace with required fields only", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q1",
      query: "Where does Jon live?",
    });
    const trace = builder.build();

    expect(trace.questionId).toBe("Q1");
    expect(trace.query).toBe("Where does Jon live?");
    expect(trace.recalledFacts).toEqual([]);
    expect(trace.invalidatedFiltered).toEqual([]);
    expect(trace.bridgeDiscovery).toBeNull();
    expect(trace.expansionFacts).toEqual([]);
    expect(trace.agentSteps).toEqual([]);
    expect(trace.llmCalls).toBe(0);
    expect(trace.tokensUsed).toBe(0);
  });

  it("appends recalled facts via addRecalledFact", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q2",
      query: "test",
    });
    const fact: RecallTraceFact = {
      factId: "f1",
      armRanks: { bm25: 1, vector: 2 },
      finalScore: 0.87,
      ceScore: 0.92,
      recencyBoost: 0.05,
      proofCount: 3,
    };
    builder.addRecalledFact(fact);
    const trace = builder.build();

    expect(trace.recalledFacts).toHaveLength(1);
    expect(trace.recalledFacts[0].factId).toBe("f1");
    expect(trace.recalledFacts[0].armRanks.bm25).toBe(1);
    expect(trace.recalledFacts[0].ceScore).toBe(0.92);
  });

  it("appends multiple recalled facts preserving order", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q3",
      query: "test",
    });
    builder.addRecalledFact({
      factId: "f1",
      armRanks: {},
      finalScore: 0.9,
    });
    builder.addRecalledFact({
      factId: "f2",
      armRanks: {},
      finalScore: 0.8,
    });
    builder.addRecalledFact({
      factId: "f3",
      armRanks: {},
      finalScore: 0.7,
    });

    const trace = builder.build();
    expect(trace.recalledFacts.map((f) => f.factId)).toEqual([
      "f1",
      "f2",
      "f3",
    ]);
  });

  it("sets category and temporalPolicy with intent keywords", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q4",
      query: "Where did Jon live before?",
    });
    builder.setCategory("temporal");
    builder.setTemporalPolicy("include_history_ranked", [
      "before",
      "previously",
      "former",
    ]);

    const trace = builder.build();
    expect(trace.category).toBe("temporal");
    expect(trace.temporalPolicy).toBe("include_history_ranked");
    expect(trace.queryIntentKeywords).toEqual([
      "before",
      "previously",
      "former",
    ]);
  });

  it("appends invalidated filtered entries", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q5",
      query: "test",
    });
    builder.addInvalidatedFiltered({
      factId: "f_old",
      reason: "superseded",
      invalid_at: 200,
    });
    builder.addInvalidatedFiltered({
      factId: "f_expired",
      reason: "expired",
      expired_at: 150,
    });

    const trace = builder.build();
    expect(trace.invalidatedFiltered).toHaveLength(2);
    expect(trace.invalidatedFiltered[0].factId).toBe("f_old");
    expect(trace.invalidatedFiltered[1].reason).toBe("expired");
  });

  it("sets bridgeDiscovery (Week 4 placeholder)", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q6",
      query: "How did Jon meet Mary?",
    });
    builder.setBridgeDiscovery({
      entityPair: ["Jon", "Mary"],
      bridgeFactId: "f_bridge",
      betweennessScore: 0.85,
      pathLength: 2,
      timeFilteredOutCount: 1,
      bridgeLiftAtK: 0.12,
      pathExistence: true,
    });

    const trace = builder.build();
    expect(trace.bridgeDiscovery).not.toBeNull();
    if (trace.bridgeDiscovery) {
      expect(trace.bridgeDiscovery.entityPair).toEqual(["Jon", "Mary"]);
      expect(trace.bridgeDiscovery.bridgeLiftAtK).toBe(0.12);
      expect(trace.bridgeDiscovery.pathExistence).toBe(true);
    }
  });

  it("appends expansion facts (single and batch)", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q7",
      query: "test",
    });
    builder.addExpansionFact("f1");
    builder.addExpansionFacts(["f2", "f3", "f4"]);

    const trace = builder.build();
    expect(trace.expansionFacts).toEqual(["f1", "f2", "f3", "f4"]);
  });

  it("appends agent steps with state delta (Week 5 placeholder)", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q8",
      query: "test",
    });
    builder.addAgentStep({
      step: "recall",
      stateDelta: {
        hypotheses: ["Jon lives in Boston"],
        missingInfo: null,
        nextAction: "expand",
      },
    });
    builder.addAgentStep({
      step: "expand",
      stateDelta: {
        hypotheses: ["Jon lives in Boston", "Jon works at Google"],
        constraints: { maxSteps: 12 },
        nextAction: "answer",
      },
    });

    const trace = builder.build();
    expect(trace.agentSteps).toHaveLength(2);
    expect(trace.agentSteps[0].step).toBe("recall");
    expect(trace.agentSteps[1].stateDelta?.constraints).toEqual({
      maxSteps: 12,
    });
  });

  it("accumulates LLM calls and tokens", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q9",
      query: "test",
    });
    builder.addLLMCall(150);
    builder.addLLMCall(200);
    builder.addLLMCall(75);

    const trace = builder.build();
    expect(trace.llmCalls).toBe(3);
    expect(trace.tokensUsed).toBe(425);
  });
});

describe("validateRecallTrace", () => {
  it("returns empty array for complete trace", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q1",
      query: "test",
    });
    builder.addRecalledFact({
      factId: "f1",
      armRanks: {},
      finalScore: 0.9,
    });
    const trace = builder.build();

    const missing = validateRecallTrace(trace);
    expect(missing).toEqual([]);
  });

  it("detects missing questionId", () => {
    const trace: RecallTrace = {
      questionId: "",
      query: "test",
      recalledFacts: [],
      invalidatedFiltered: [],
      bridgeDiscovery: null,
      expansionFacts: [],
      agentSteps: [],
      llmCalls: 0,
      tokensUsed: 0,
    };

    const missing = validateRecallTrace(trace);
    expect(missing).toContain("questionId");
  });

  it("detects missing query", () => {
    const trace: RecallTrace = {
      questionId: "Q1",
      query: "",
      recalledFacts: [],
      invalidatedFiltered: [],
      bridgeDiscovery: null,
      expansionFacts: [],
      agentSteps: [],
      llmCalls: 0,
      tokensUsed: 0,
    };

    const missing = validateRecallTrace(trace);
    expect(missing).toContain("query");
  });

  it("detects missing recalledFacts array", () => {
    const trace = {
      questionId: "Q1",
      query: "test",
      invalidatedFiltered: [],
      bridgeDiscovery: null,
      expansionFacts: [],
      agentSteps: [],
      llmCalls: 0,
      tokensUsed: 0,
    } as unknown as RecallTrace;

    const missing = validateRecallTrace(trace);
    expect(missing).toContain("recalledFacts");
  });

  it("detects multiple missing fields", () => {
    const trace = {
      questionId: "Q1",
      query: "test",
    } as unknown as RecallTrace;

    const missing = validateRecallTrace(trace);
    expect(missing).toContain("recalledFacts");
    expect(missing).toContain("invalidatedFiltered");
    expect(missing).toContain("expansionFacts");
    expect(missing).toContain("agentSteps");
    expect(missing).toContain("llmCalls");
    expect(missing).toContain("tokensUsed");
  });

  it("accepts empty arrays as valid (length 0 is valid)", () => {
    const trace: RecallTrace = {
      questionId: "Q1",
      query: "test",
      recalledFacts: [],
      invalidatedFiltered: [],
      bridgeDiscovery: null,
      expansionFacts: [],
      agentSteps: [],
      llmCalls: 0,
      tokensUsed: 0,
    };

    const missing = validateRecallTrace(trace);
    expect(missing).toEqual([]);
  });
});

describe("serializeRecallTrace", () => {
  it("produces valid JSON with all fields", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q1",
      query: "test query",
    });
    builder.setCategory("multi_hop");
    builder.addRecalledFact({
      factId: "f1",
      armRanks: { bm25: 1, vector: 2 },
      finalScore: 0.9,
    });
    builder.setBridgeDiscovery({
      entityPair: ["A", "B"],
      betweennessScore: 0.5,
    });
    builder.addLLMCall(100);

    const trace = builder.build();
    const json = serializeRecallTrace(trace);
    const parsed = JSON.parse(json);

    expect(parsed.questionId).toBe("Q1");
    expect(parsed.query).toBe("test query");
    expect(parsed.category).toBe("multi_hop");
    expect(parsed.recalledFacts).toHaveLength(1);
    expect(parsed.bridgeDiscovery.entityPair).toEqual(["A", "B"]);
    expect(parsed.llmCalls).toBe(1);
    expect(parsed.tokensUsed).toBe(100);
  });

  it("handles null bridgeDiscovery in JSON", () => {
    const trace: RecallTrace = {
      questionId: "Q1",
      query: "test",
      recalledFacts: [],
      invalidatedFiltered: [],
      bridgeDiscovery: null,
      expansionFacts: [],
      agentSteps: [],
      llmCalls: 0,
      tokensUsed: 0,
    };

    const json = serializeRecallTrace(trace);
    const parsed = JSON.parse(json);
    expect(parsed.bridgeDiscovery).toBeNull();
  });
});

describe("summarizeRecallTrace", () => {
  it("computes correct summary metrics", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q1",
      query: "test",
    });
    builder.addRecalledFact({ factId: "f1", armRanks: {}, finalScore: 0.9 });
    builder.addRecalledFact({ factId: "f2", armRanks: {}, finalScore: 0.8 });
    builder.addRecalledFact({ factId: "f3", armRanks: {}, finalScore: 0.7 });
    builder.addInvalidatedFiltered({ factId: "f_old", reason: "superseded" });
    builder.addInvalidatedFiltered({
      factId: "f_old2",
      reason: "expired",
    });
    builder.setBridgeDiscovery({
      entityPair: ["A", "B"],
      betweennessScore: 0.5,
    });
    builder.addExpansionFacts(["f4", "f5"]);
    builder.addAgentStep({ step: "recall" });
    builder.addAgentStep({ step: "expand" });
    builder.addAgentStep({ step: "answer" });
    builder.addLLMCall(100);
    builder.addLLMCall(200);

    const trace = builder.build();
    const summary = summarizeRecallTrace(trace);

    expect(summary.recalledCount).toBe(3);
    expect(summary.invalidatedCount).toBe(2);
    expect(summary.expansionCount).toBe(2);
    expect(summary.agentStepCount).toBe(3);
    expect(summary.hasBridge).toBe(true);
    expect(summary.llmCalls).toBe(2);
    expect(summary.tokensUsed).toBe(300);
  });

  it("returns hasBridge=false when no bridge discovery", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q1",
      query: "test",
    });
    const trace = builder.build();
    const summary = summarizeRecallTrace(trace);
    expect(summary.hasBridge).toBe(false);
  });
});

describe("RecallTrace builder integration (multi-week placeholder fill)", () => {
  it("Week 2 temporalPolicy + Week 4 bridge + Week 5 agent steps coexist", () => {
    const builder = createRecallTraceBuilder({
      questionId: "Q_complex",
      query: "How did Jon's job change affect his commute?",
    });

    // Week 2: temporal policy
    builder.setCategory("multi_hop");
    builder.setTemporalPolicy("include_history_ranked", [
      "how",
      "change",
      "affect",
    ]);

    // Week 1: recalled facts
    builder.addRecalledFact({
      factId: "f_job_old",
      armRanks: { bm25: 1, vector: 3 },
      finalScore: 0.85,
      proofCount: 2,
    });
    builder.addRecalledFact({
      factId: "f_job_new",
      armRanks: { bm25: 2, vector: 1 },
      finalScore: 0.92,
      proofCount: 5,
    });

    // Week 1: invalidated (old job superseded)
    builder.addInvalidatedFiltered({
      factId: "f_job_old",
      reason: "superseded",
      invalid_at: 200,
    });

    // Week 4: bridge discovery
    builder.setBridgeDiscovery({
      entityPair: ["Jon", "commute"],
      bridgeFactId: "f_bridge_commute",
      betweennessScore: 0.78,
      pathLength: 3,
      timeFilteredOutCount: 2,
      bridgeLiftAtK: 0.15,
      pathExistence: true,
    });

    // Week 4: expansion facts
    builder.addExpansionFacts(["f_commute_mode", "f_commute_time"]);

    // Week 5: agent steps with state delta
    builder.addAgentStep({
      step: "recall",
      stateDelta: {
        hypotheses: ["Jon changed jobs"],
        missingInfo: "commute impact",
        nextAction: "bridge_discovery",
      },
    });
    builder.addAgentStep({
      step: "bridge_discovery",
      stateDelta: {
        hypotheses: ["Jon changed jobs", "commute changed"],
        constraints: { maxSteps: 12, repeatedRecall: 1 },
        nextAction: "answer",
      },
    });
    builder.addAgentStep({ step: "answer" });

    // Cost
    builder.addLLMCall(350);
    builder.addLLMCall(180);

    const trace = builder.build();

    // Validate completeness
    const missing = validateRecallTrace(trace);
    expect(missing).toEqual([]);

    // Validate summary
    const summary = summarizeRecallTrace(trace);
    expect(summary.recalledCount).toBe(2);
    expect(summary.invalidatedCount).toBe(1);
    expect(summary.expansionCount).toBe(2);
    expect(summary.agentStepCount).toBe(3);
    expect(summary.hasBridge).toBe(true);
    expect(summary.llmCalls).toBe(2);
    expect(summary.tokensUsed).toBe(530);

    // Validate serialization round-trip
    const json = serializeRecallTrace(trace);
    const parsed = JSON.parse(json);
    expect(parsed.temporalPolicy).toBe("include_history_ranked");
    expect(parsed.queryIntentKeywords).toEqual(["how", "change", "affect"]);
    expect(parsed.bridgeDiscovery.bridgeLiftAtK).toBe(0.15);
    expect(parsed.agentSteps[1].stateDelta.constraints.maxSteps).toBe(12);
  });
});
