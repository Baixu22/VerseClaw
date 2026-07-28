import { describe, expect, it, beforeEach } from "vitest";
import {
  applyInjectionBudget,
  createInjectionBudget,
  remainingBudget,
  DEFAULT_INJECTION_CHAR_BUDGET,
} from "./injection-budget.js";
import { dcsObservability } from "./dcs-observability.js";
import { KNOWLEDGE_INJECTION_CHAR_BUDGET } from "./assembler.js";

describe("injection-budget (TASK-P2-03)", () => {
  beforeEach(() => {
    dcsObservability.reset();
  });

  it("defaults align with assembler knowledge budget constant", () => {
    expect(DEFAULT_INJECTION_CHAR_BUDGET).toBe(KNOWLEDGE_INJECTION_CHAR_BUDGET);
    expect(createInjectionBudget().total).toBe(KNOWLEDGE_INJECTION_CHAR_BUDGET);
  });

  it("applies full text when under budget", () => {
    const b = createInjectionBudget(100);
    const r = applyInjectionBudget(b, "hello", "working_memory");
    expect(r.applied).toBe(true);
    expect(r.text).toBe("hello");
    expect(r.charsApplied).toBe(5);
    expect(remainingBudget(b)).toBe(95);
    expect(dcsObservability.snapshot().injectionBudgetOverflows).toBe(0);
  });

  it("truncates when exceeding remaining", () => {
    const b = createInjectionBudget(10);
    const r = applyInjectionBudget(b, "0123456789ABCDEF", "tool_registry");
    expect(r.applied).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.text?.endsWith("…")).toBe(true);
    expect(r.charsApplied).toBe(10);
    expect(remainingBudget(b)).toBe(0);
    expect(dcsObservability.snapshot().injectionBudgetTruncations).toBe(1);
  });

  it("drops when budget exhausted", () => {
    const b = createInjectionBudget(5);
    applyInjectionBudget(b, "12345", "working_memory");
    const r = applyInjectionBudget(b, "more", "knowledge");
    expect(r.dropped).toBe(true);
    expect(r.text).toBeUndefined();
    expect(dcsObservability.snapshot().injectionBudgetDrops).toBe(1);
    expect(dcsObservability.snapshot().injectionBudgetOverflows).toBe(1);
  });

  it("fail-closed when total is zero", () => {
    const b = createInjectionBudget(0);
    const r = applyInjectionBudget(b, "x", "knowledge");
    expect(r.dropped).toBe(true);
    expect(r.text).toBeUndefined();
  });
});
