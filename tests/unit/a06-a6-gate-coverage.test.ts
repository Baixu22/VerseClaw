import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SPEC = "harness/specs/tasks/a6-long-running-persistence-pilot.md";
const REQUIRED_TESTS = [
  "tests/unit/deprecation-counters.test.ts",
  "openclaw_runtime/src/observability/deprecation-counters.test.ts",
  "tests/unit/performance-budgets.test.ts",
  "tests/unit/file-fingerprint.test.ts",
  "tests/unit/runtime-resume-shadow.test.ts",
  "tests/unit/long-task-checkpoint-builder.test.ts",
  "tests/unit/long-task-control.test.ts",
  "tests/unit/a06-a6-gate-coverage.test.ts",
  "tests/unit/cross-area-composition.test.ts",
  "tests/unit/deep/a6-deep.test.ts",
] as const;

describe("A06 A6 gate coverage", () => {
  it("keeps every A6 required test path present and wired into the archived pilot spec", () => {
    const spec = readFileSync(path.join(ROOT, SPEC), "utf8");
    for (const rel of REQUIRED_TESTS) {
      expect(spec).toContain(`- ${rel}`);
      expect(existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });

  it("pins A6 critical counter and budget-response evidence", () => {
    const counters = readFileSync(
      path.join(ROOT, "openclaw_runtime/src/observability/deprecation-counters.ts"),
      "utf8",
    );
    expect(counters).toContain('action: "degrade_to_full_reverification"');
    expect(counters).toContain("volatileMislabelCount > 0");
    expect(counters).toContain("verifierFailCount / total > 0.05");
  });

  it("pins the restored verifier, lease-ordering, and pause/resume latency gates", () => {
    const facades = readFileSync(
      path.join(ROOT, "openclaw_runtime/src/agents/cross-area/cross-area-facades.ts"),
      "utf8",
    );
    expect(facades).toContain("class ResumeContractVerifier");
    expect(facades).toContain("requiresReverification");
    expect(facades).toContain("class FingerprintLeaseCoordinator");
    expect(facades).toContain("leaseBeforeCheckpoint");

    const crossArea = readFileSync(path.join(ROOT, "tests/unit/cross-area-composition.test.ts"), "utf8");
    expect(crossArea).toContain("rollback before resume requires_reverification");
    expect(crossArea).toContain("mid-turn pause");

    const deep = readFileSync(path.join(ROOT, "tests/unit/deep/a6-deep.test.ts"), "utf8");
    expect(deep).toContain("FingerprintLeaseCoordinator");

    const perf = readFileSync(path.join(ROOT, "tests/unit/performance-budgets.test.ts"), "utf8");
    expect(perf).toContain("A6 performance budgets");
    expect(perf).toContain("10 pause/resume cycles");

    const manual = readFileSync(path.join(ROOT, "docs/runtime-design/development-manual.md"), "utf8");
    expect(manual).toContain("ResumeContractVerifier");
    expect(manual).toContain("A6 deprecation: `ResumeContractVerifier` pass rate + volatile mislabel");
  });
});
