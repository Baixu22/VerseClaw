// @vitest-environment node
// A03: the A3 resilience gate must be verifiable from the current candidate.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SPEC = "harness/specs/tasks/a3-runtime-resilience-pilot.md";

function read(p: string) {
  return readFileSync(join(ROOT, p), "utf8");
}
function requiredTests(spec: string): string[] {
  const block = spec.match(/requiredTests:\n((?:\s+- .+\n)+)/)?.[1] ?? "";
  return [...block.matchAll(/^\s+- (.+)$/gm)].map((m) => m[1].trim());
}

describe("A03 A3 resilience pilot gate coverage", () => {
  it("points every requiredTests entry at a real file and wires the classifier + counter tests", () => {
    const spec = read(SPEC);
    const tests = requiredTests(spec);
    expect(tests).toContain("tests/unit/anomaly-classifier.test.ts");
    expect(tests).toContain("tests/unit/deprecation-counters.test.ts");
    for (const test of tests) {
      expect(existsSync(join(ROOT, test)), `missing required test: ${test}`).toBe(true);
    }
  });

  it("keeps each A3 criterion mapped to an assertion at the original thresholds", () => {
    const counters = read("tests/unit/deprecation-counters.test.ts");
    expect(counters).toContain("degrade_to_default_decision");
    expect(counters).toMatch(/A3: anomaly rate > 20%/);
    const classifier = read("tests/unit/anomaly-classifier.test.ts");
    expect(classifier).toContain("resolveAnomalyPatternForReviewer");
    expect(classifier).toMatch(/flag-off parity/);
    const perf = read("tests/unit/performance-budgets.test.ts");
    expect(perf).toContain("p99");
    expect(read(SPEC)).toContain("p99 ≤ 15ms");
  });

  it("keeps A3 augmentation-only (never changes the terminal Mission decision)", () => {
    expect(read(SPEC)).toMatch(/only augment|must not change the terminal/i);
  });
});