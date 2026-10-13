import { existsSync, readFileSync, readdirSync } from "node:fs";
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
] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("A05 A5 gate coverage", () => {
  it("keeps every A5 required test path present and wired into the archived pilot spec", () => {
    const spec = readFileSync(path.join(ROOT, SPEC), "utf8");
    for (const rel of REQUIRED_TESTS) {
      expect(spec).toContain(`- ${rel}`);
      expect(existsSync(path.join(ROOT, rel))).toBe(true);
    }
    expect(spec).not.toContain("tests/unit/cross-area-composition.test.ts");
    expect(spec).not.toContain("openclaw_runtime/src/agents/cross-area/cross-area-facades.ts");
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

  it("keeps the unresolved resume re-planning criterion explicit as a NO-GO", () => {
    const sourceFiles = [
      ...walk(path.join(ROOT, "openclaw_runtime/src")),
      ...walk(path.join(ROOT, "openclaw_runtime/packages/agent-core/src")),
    ];
    for (const file of sourceFiles) {
      expect(readFileSync(file, "utf8")).not.toContain("replanOnResume");
    }

    const manual = readFileSync(path.join(ROOT, "docs/runtime-design/development-manual.md"), "utf8");
    expect(manual).toContain("resume re-runs budget planner");
    const spec = readFileSync(path.join(ROOT, SPEC), "utf8");
    expect(spec).toContain("ContextBudgetPlanner.replanOnResume");
  });
});
