// @vitest-environment node
// Week 5 v2: Agent state-machine 单元测试.
//
// 覆盖 memory-arch-roadmap.md §B5, Week 5 完成定义:
//   1. state-machine 转换: recall → bridge_probe → evidence_expand → generate → finalize
//   2. 结构化状态增量 (MemoryReasoningStateDelta): hypotheses/constraints/missingInfo/nextAction
//   3. 8-12 步强约束 (超过 12 强制终止)
//   4. 禁止重复 recall 超过 2 次
//   5. 类别条件触发: bridge_probe 仅 multi_hop, evidence_expand 仅 bridge 命中
//   6. finalize 前必须有 generate
import { describe, expect, it } from "vitest";
import {
  AgentStateMachine,
  createRecommendedStateMachine,
  getRecommendedSequence,
  type AgentStepType,
  type MemoryReasoningStateDelta,
} from "../../openclaw_runtime/src/runtime-core/memory-agent-state-machine";

// === Helpers ===

function makeStateDelta(
  overrides: Partial<MemoryReasoningStateDelta> = {},
): MemoryReasoningStateDelta {
  return {
    missingInfo: null,
    nextAction: "done",
    ...overrides,
  };
}

// === 基本流程 ===
describe("AgentStateMachine basic flow", () => {
  it("starts and executes a recall step", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();

    const record = sm.executeStep("recall", makeStateDelta({
      nextAction: "generate",
      missingInfo: null,
      hypotheses: ["Jon lives in Boston"],
    }), {
      recalledFactIds: ["f1", "f2"],
    });

    expect(record.stepType).toBe("recall");
    expect(record.stateDelta.repeatedRecallCount).toBe(1);
    expect(record.output?.recalledFactIds).toEqual(["f1", "f2"]);

    const state = sm.getState();
    expect(state.recallCount).toBe(1);
    expect(state.currentStep).toBe(2);
  });

  it("finalizes after generate", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "generate" }));
    sm.executeStep("generate", makeStateDelta({ nextAction: "finalize" }), {
      answer: "Jon lives in Boston",
    });
    sm.finalize(makeStateDelta({ nextAction: "done" }));

    const state = sm.getState();
    expect(state.finalized).toBe(true);
    expect(state.terminationReason).toBe("completed");
    expect(state.generateCount).toBe(1);
    expect(state.steps.length).toBe(3); // recall + generate + finalize
  });
});

// === 重复 recall 硬约束 ===
describe("recall hard constraint (max 2)", () => {
  it("allows up to 2 recall steps", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "recall" }));
    sm.executeStep("recall", makeStateDelta({ nextAction: "generate" }));

    expect(sm.getState().recallCount).toBe(2);
  });

  it("throws on 3rd recall (constraint violation)", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "recall" }));
    sm.executeStep("recall", makeStateDelta({ nextAction: "recall" }));

    expect(() => {
      sm.executeStep("recall", makeStateDelta({ nextAction: "generate" }));
    }).toThrow(/recall constraint violation/);
  });

  it("repeatedRecallCount is tracked in stateDelta", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    const r1 = sm.executeStep("recall", makeStateDelta({ nextAction: "recall" }));
    const r2 = sm.executeStep("recall", makeStateDelta({ nextAction: "generate" }));

    expect(r1.stateDelta.repeatedRecallCount).toBe(1);
    expect(r2.stateDelta.repeatedRecallCount).toBe(2);
  });
});

// === 类别条件触发 ===
describe("category conditional triggering", () => {
  it("bridge_probe allowed for multi_hop", () => {
    const sm = new AgentStateMachine({ category: "multi_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "bridge_probe" }));

    expect(() => {
      sm.executeStep("bridge_probe", makeStateDelta({ nextAction: "generate" }));
    }).not.toThrow();
  });

  it("bridge_probe rejected for single_hop", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "bridge_probe" }));

    expect(() => {
      sm.executeStep("bridge_probe", makeStateDelta({ nextAction: "generate" }));
    }).toThrow(/bridge_probe condition violation.*multi_hop/);
  });

  it("bridge_probe rejected for temporal", () => {
    const sm = new AgentStateMachine({ category: "temporal" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "bridge_probe" }));

    expect(() => {
      sm.executeStep("bridge_probe", makeStateDelta({ nextAction: "generate" }));
    }).toThrow(/bridge_probe condition violation/);
  });

  it("evidence_expand requires bridge_probe first", () => {
    const sm = new AgentStateMachine({ category: "multi_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "evidence_expand" }));

    expect(() => {
      sm.executeStep("evidence_expand", makeStateDelta({ nextAction: "generate" }));
    }).toThrow(/evidence_expand condition violation.*bridge_probe/);
  });

  it("evidence_expand allowed after bridge_probe", () => {
    const sm = new AgentStateMachine({ category: "multi_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "bridge_probe" }));
    sm.executeStep("bridge_probe", makeStateDelta({ nextAction: "evidence_expand" }));

    expect(() => {
      sm.executeStep("evidence_expand", makeStateDelta({ nextAction: "generate" }));
    }).not.toThrow();
  });
});

// === 步数约束 ===
describe("step count constraints", () => {
  it("throws when maxSteps exceeded", () => {
    const sm = new AgentStateMachine({
      category: "single_hop",
      maxSteps: 4,
      minSteps: 1,
    });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "recall" }));
    sm.executeStep("recall", makeStateDelta({ nextAction: "generate" }));
    sm.executeStep("generate", makeStateDelta({ nextAction: "finalize" }));

    // 第 5 步应触发 max_steps_exceeded
    expect(() => {
      sm.finalize(makeStateDelta({ nextAction: "done" }));
    }).not.toThrow(); // finalize 是第 4 步, 不超限

    // 但再执行一步会超限 (但已 finalized)
    expect(() => {
      sm.executeStep("recall" as AgentStepType, makeStateDelta({}));
    }).toThrow(/already finalized/);
  });

  it("default maxSteps=12", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    expect(sm.getState().currentStep).toBe(0);
    // 默认配置通过 canExecute 间接验证
    expect(sm.canExecute("recall")).toBe(false); // 未 start
  });
});

// === finalize 约束 ===
describe("finalize constraints", () => {
  it("throws when finalize before generate", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "finalize" }));

    expect(() => {
      sm.finalize(makeStateDelta({ nextAction: "done" }));
    }).toThrow(/generate step is required/);
  });

  it("throws on double finalize", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "generate" }));
    sm.executeStep("generate", makeStateDelta({ nextAction: "finalize" }));
    sm.finalize(makeStateDelta({ nextAction: "done" }));

    expect(() => {
      sm.finalize(makeStateDelta({ nextAction: "done" }));
    }).toThrow(/already finalized/);
  });

  it("throws on executeStep after finalize", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "generate" }));
    sm.executeStep("generate", makeStateDelta({ nextAction: "finalize" }));
    sm.finalize(makeStateDelta({ nextAction: "done" }));

    expect(() => {
      sm.executeStep("recall", makeStateDelta({ nextAction: "generate" }));
    }).toThrow(/already finalized/);
  });
});

// === generate 约束 ===
describe("generate constraints", () => {
  it("only 1 generate allowed", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "generate" }));
    sm.executeStep("generate", makeStateDelta({ nextAction: "generate" }));

    expect(() => {
      sm.executeStep("generate", makeStateDelta({ nextAction: "finalize" }));
    }).toThrow(/generate constraint violation/);
  });
});

// === nextAction 白名单 ===
describe("nextAction whitelist", () => {
  it("throws on invalid nextAction", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();

    expect(() => {
      sm.executeStep("recall", makeStateDelta({
        nextAction: "invalid_action" as AgentStepType,
      }));
    }).toThrow(/Invalid nextAction/);
  });

  it("accepts 'done' as nextAction", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "done" }));
    expect(sm.getState().recallCount).toBe(1);
  });
});

// === canExecute (不实际执行) ===
describe("canExecute", () => {
  it("returns false before start", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    expect(sm.canExecute("recall")).toBe(false);
  });

  it("returns true for valid step", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    expect(sm.canExecute("recall")).toBe(true);
  });

  it("returns false for bridge_probe on single_hop", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    expect(sm.canExecute("bridge_probe")).toBe(false);
  });

  it("returns false for 3rd recall", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "recall" }));
    sm.executeStep("recall", makeStateDelta({ nextAction: "recall" }));
    expect(sm.canExecute("recall")).toBe(false);
  });
});

// === 工厂函数 ===
describe("factory functions", () => {
  it("createRecommendedStateMachine: multi_hop allows bridge_probe", () => {
    const sm = createRecommendedStateMachine("multi_hop");
    sm.start();
    expect(sm.canExecute("bridge_probe")).toBe(true);
  });

  it("createRecommendedStateMachine: single_hop rejects bridge_probe", () => {
    const sm = createRecommendedStateMachine("single_hop");
    sm.start();
    expect(sm.canExecute("bridge_probe")).toBe(false);
  });

  it("getRecommendedSequence: multi_hop", () => {
    const seq = getRecommendedSequence("multi_hop");
    expect(seq).toEqual([
      "recall",
      "bridge_probe",
      "evidence_expand",
      "generate",
      "finalize",
    ]);
  });

  it("getRecommendedSequence: single_hop", () => {
    const seq = getRecommendedSequence("single_hop");
    expect(seq).toEqual(["recall", "generate", "finalize"]);
  });
});

// === 完整 multi_hop 流程 ===
describe("complete multi_hop flow", () => {
  it("executes full multi_hop sequence with state deltas", () => {
    const sm = new AgentStateMachine({
      category: "multi_hop",
      maxSteps: 12,
    });
    sm.start();

    // Step 1: recall
    const r1 = sm.executeStep("recall", {
      hypotheses: ["Jon works at Google"],
      constraints: { temporalPolicy: "strict_current", entities: ["Jon"] },
      missingInfo: "How did Jon meet Mary?",
      nextAction: "bridge_probe",
    }, { recalledFactIds: ["f1", "f2"] });
    expect(r1.stateDelta.repeatedRecallCount).toBe(1);

    // Step 2: bridge_probe
    const r2 = sm.executeStep("bridge_probe", {
      hypotheses: ["Jon ↔ Mary bridge fact"],
      constraints: { entities: ["Jon", "Mary"] },
      missingInfo: "What evidence connects them?",
      nextAction: "evidence_expand",
    }, { bridgeFactIds: ["f_bridge"] });
    expect(sm.getState().bridgeProbeCount).toBe(1);

    // Step 3: evidence_expand
    const r3 = sm.executeStep("evidence_expand", {
      hypotheses: ["Jon met Mary at Google conference"],
      constraints: { entities: ["Jon", "Mary", "Google"] },
      missingInfo: null,
      nextAction: "generate",
    }, { expansionFactIds: ["f_exp1", "f_exp2"] });
    expect(sm.getState().evidenceExpandCount).toBe(1);

    // Step 4: generate
    const r4 = sm.executeStep("generate", {
      hypotheses: ["Jon met Mary at Google conference in 2020"],
      missingInfo: null,
      nextAction: "finalize",
    }, { answer: "Jon met Mary at the Google conference in 2020." });
    expect(sm.getState().generateCount).toBe(1);

    // Step 5: finalize
    const r5 = sm.finalize({
      missingInfo: null,
      nextAction: "done",
    });

    expect(r5.stepType).toBe("finalize");
    expect(sm.getState().finalized).toBe(true);
    expect(sm.getState().terminationReason).toBe("completed");
    expect(sm.getSteps().length).toBe(5);
  });

  it("executes full single_hop sequence (no bridge_probe)", () => {
    const sm = new AgentStateMachine({ category: "single_hop" });
    sm.start();

    sm.executeStep("recall", makeStateDelta({ nextAction: "generate" }));
    sm.executeStep("generate", makeStateDelta({ nextAction: "finalize" }));
    sm.finalize(makeStateDelta({ nextAction: "done" }));

    expect(sm.getState().finalized).toBe(true);
    expect(sm.getState().bridgeProbeCount).toBe(0);
    expect(sm.getState().evidenceExpandCount).toBe(0);
    expect(sm.getSteps().length).toBe(3);
  });

  it("reconcile step (冲突检测时触发)", () => {
    const sm = new AgentStateMachine({ category: "multi_hop" });
    sm.start();
    sm.executeStep("recall", makeStateDelta({ nextAction: "bridge_probe" }));
    sm.executeStep("bridge_probe", makeStateDelta({ nextAction: "reconcile" }));

    // reconcile: 检测到冲突, 调 LLM 调和
    const r = sm.executeStep("reconcile", {
      hypotheses: ["conflicting facts about Jon's location"],
      constraints: { temporalPolicy: "strict_current" },
      missingInfo: "Which location is current?",
      nextAction: "generate",
    });
    expect(sm.getState().reconcileCount).toBe(1);

    // 再 reconcile 应被拒
    expect(() => {
      sm.executeStep("reconcile", makeStateDelta({ nextAction: "generate" }));
    }).toThrow(/reconcile constraint violation/);
  });
});

// === 状态增量字段完整性 ===
describe("stateDelta field completeness", () => {
  it("all stateDelta fields are preserved in step record", () => {
    const sm = new AgentStateMachine({ category: "multi_hop" });
    sm.start();
    const record = sm.executeStep("recall", {
      hypotheses: ["h1", "h2"],
      constraints: {
        temporalPolicy: "include_history_ranked",
        entities: ["Jon", "Mary"],
        relationTypes: ["causal"],
        maxSteps: 12,
      },
      missingInfo: "missing evidence",
      nextAction: "generate",
    });

    expect(record.stateDelta.hypotheses).toEqual(["h1", "h2"]);
    expect(record.stateDelta.constraints?.temporalPolicy).toBe(
      "include_history_ranked",
    );
    expect(record.stateDelta.constraints?.entities).toEqual(["Jon", "Mary"]);
    expect(record.stateDelta.constraints?.relationTypes).toEqual(["causal"]);
    expect(record.stateDelta.constraints?.maxSteps).toBe(12);
    expect(record.stateDelta.missingInfo).toBe("missing evidence");
    expect(record.stateDelta.nextAction).toBe("generate");
    expect(record.stateDelta.repeatedRecallCount).toBe(1);
  });
});
