// @vitest-environment node
// A01: the A1 graduation gate must be verifiable from the current candidate.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(p: string) {
  return readFileSync(join(ROOT, p), "utf8");
}

describe("A01 A1 isolation pilot gate coverage", () => {
  it("keeps the A1 spec's requiredTests wired to the criterion-1/3/4 counter tests", () => {
    const spec = read("harness/specs/tasks/a1-layered-isolation-pilot.md");
    expect(spec).toContain("tests/unit/deprecation-counters.test.ts");
    expect(spec).toContain("openclaw_runtime/src/observability/deprecation-counters.test.ts");
    // The original graduation thresholds must not be redefined.
    expect(spec).toContain("legacyFallbackCount / (legacyFallbackCount + shadowSuccessCount) < 0.05");
    expect(spec).toContain("degrade_to_legacy");
    expect(spec).toContain("p99 ≤ 200ms");
  });

  it("keeps the counter test asserting the 5% budget and the degrade_to_legacy response", () => {
    const counterTest = read("tests/unit/deprecation-counters.test.ts");
    expect(counterTest).toContain("degrade_to_legacy");
    expect(counterTest).toContain("legacyFallbackCount");
    expect(counterTest).toContain("declaredPathViolationCount");
    // Strictly greater than 5% trips; <= 5% does not.
    expect(counterTest).toMatch(/rate\s*>?\s*5%/i);
  });

  it("keeps the write-risk and namespace criteria covered by their tests", () => {
    const toolReg = read("tests/unit/tool-registration.test.ts");
    expect(toolReg).toContain("writeRiskProfile");
    const namespace = read("tests/unit/trace-namespace-enforcement.test.ts");
    expect(namespace).toContain("claw.a4.tool.choice");
    const perf = read("tests/unit/performance-budgets.test.ts");
    expect(perf).toContain("p99");
  });
});