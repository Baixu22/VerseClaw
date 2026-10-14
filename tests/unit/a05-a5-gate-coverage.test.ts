import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SPEC = "harness/specs/tasks/a5-adaptive-context-budget-pilot.md";
const REQUIRED_TESTS = [
  "tests/unit/resource-aware-wave-scheduler.test.ts",
  "tests/unit/performance-budgets.test.ts",
  "tests/unit/deprecation-counters.test.ts",
  "openclaw_runtime/src/observability/deprecation-counters.test.ts",
  "openclaw_runtime/src/agents/agent-hooks/compaction-budget-shadow.test.ts",
  "openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.test.ts",
  "openclaw_runtime/src/context-engine/context-orchestrator.test.ts",
  "openclaw_runtime/src/agents/agent-hooks/compaction-promotion.test.ts",
  "tests/unit/a05-a5-gate-coverage.test.ts",
  "tests/unit/cross-area-composition.test.ts",
  "tests/unit/deep/a5-deep.test.ts",
] as const;

describe("A05 A5 gate coverage", () => {
  it("keeps every A5 required test path present and wired into the archived pilot spec", () => {
    const spec = readFileSync(path.join(ROOT, SPEC), "utf8");
    for (const rel of REQUIRED_TESTS) {
      expect(spec).toContain(`- ${rel}`);
      expect(existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });

  it("pins A5 counter, budget action, wave immutability, and cumulative smoke evidence", () => {
    const counters = readFileSync(
      path.join(ROOT, "openclaw_runtime/src/observability/deprecation-counters.ts"),
      "utf8",
    );
    expect(counters).toContain('action: "degrade_to_default_budget"');

    const waveTest = readFileSync(
      path.join(ROOT, "tests/unit/resource-aware-wave-scheduler.test.ts"),
      "utf8",
    );
    expect(waveTest).toContain("ignores rePlan when appliesToWave is already started");

    const shadowTest = readFileSync(
      path.join(ROOT, "openclaw_runtime/src/agents/agent-hooks/compaction-budget-shadow.test.ts"),
      "utf8",
    );
    expect(shadowTest).toContain("recordEmbeddedCompactionBudgetCounters");
    expect(shadowTest).toContain("planAdoptedCount");

    const performanceTest = readFileSync(path.join(ROOT, "tests/unit/performance-budgets.test.ts"), "utf8");
    expect(performanceTest).toContain("A5+A1+A3 cumulative per-turn smoke");
  });

  it("pins the resume re-planning implementation and its cross-area evidence", () => {
    const facades = readFileSync(
      path.join(ROOT, "openclaw_runtime/src/agents/cross-area/cross-area-facades.ts"),
      "utf8",
    );
    expect(facades).toContain("class ContextBudgetPlanner");
    expect(facades).toContain("replanOnResume");
    expect(facades).toContain("hasReexecuted");

    const crossArea = readFileSync(path.join(ROOT, "tests/unit/cross-area-composition.test.ts"), "utf8");
    expect(crossArea).toContain("resume re-runs budget planner");

    const deep = readFileSync(path.join(ROOT, "tests/unit/deep/a5-deep.test.ts"), "utf8");
    expect(deep).toContain("ContextBudgetPlanner");

    const manual = readFileSync(path.join(ROOT, "docs/runtime-design/development-manual.md"), "utf8");
    expect(manual).toContain("resume re-runs budget planner");
    const spec = readFileSync(path.join(ROOT, SPEC), "utf8");
    expect(spec).toContain("ContextBudgetPlanner.replanOnResume");
  });
});
