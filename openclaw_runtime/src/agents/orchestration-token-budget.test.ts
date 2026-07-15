import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codingObservability } from "../context-engine/coding-observability.js";
import {
  __resetTokenBudgets,
  advanceWaveBudget,
  chargeTokenBudget,
  createTokenBudget,
} from "./orchestration-token-budget.js";
import {
  buildExecutionWaves,
  type OrchestrationTaskGraph,
  type OrchestrationTaskNode,
} from "./orchestration-protocol.js";

function node(id: string, writeSet?: string[]): OrchestrationTaskNode {
  return {
    taskNodeId: id,
    roleName: `r-${id}`,
    task: id,
    phase: "implementation",
    dependsOn: [],
    scope: "repo",
    requiredCapabilities: [],
    attemptPolicy: { maxRepairAttempts: 0, maxRedoAttempts: 0 },
    status: "planned",
    writeSet,
  };
}

describe("orchestration token budget + concurrent metrics (C3-4)", () => {
  beforeEach(() => {
    __resetTokenBudgets();
    codingObservability.reset();
  });
  afterEach(() => {
    __resetTokenBudgets();
    codingObservability.reset();
  });

  it("aborts when goal budget exceeded", () => {
    createTokenBudget({ goalId: "g1", goalBudgetTokens: 100, waveBudgetTokens: 100 });
    expect(chargeTokenBudget("g1", 90).ok).toBe(true);
    const second = chargeTokenBudget("g1", 20);
    expect(second.ok).toBe(false);
    expect(codingObservability.snapshot().tokenBudgetAborts).toBe(1);
  });

  it("resets wave budget on advance", () => {
    createTokenBudget({ goalId: "g1", goalBudgetTokens: 1000, waveBudgetTokens: 50 });
    expect(chargeTokenBudget("g1", 40).ok).toBe(true);
    advanceWaveBudget("g1", 2);
    expect(chargeTokenBudget("g1", 40).ok).toBe(true);
  });

  it("records wave conflict checks when packing", () => {
    const g: OrchestrationTaskGraph = {
      graphRunId: "g",
      mode: "flat",
      status: "planned",
      nodes: [node("a", ["x.ts"]), node("b", ["x.ts"]), node("c", ["y.ts"])],
      edges: [],
    };
    buildExecutionWaves(g);
    expect(codingObservability.snapshot().waveConflictChecks).toBeGreaterThan(0);
    expect(codingObservability.rates().waveConflictRate).toBeGreaterThan(0);
  });
});