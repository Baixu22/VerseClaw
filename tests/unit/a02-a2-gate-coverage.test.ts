// @vitest-environment node
// A02: the A2 gate spec must reference real tests and keep criteria 1-3 verifiable.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SPEC = "harness/specs/tasks/a2-multi-agent-orchestration-pilot.md";

function read(p: string) {
  return readFileSync(join(ROOT, p), "utf8");
}
function requiredTests(spec: string): string[] {
  const block = spec.match(/requiredTests:\n((?:\s+- .+\n)+)/)?.[1] ?? "";
  return [...block.matchAll(/^\s+- (.+)$/gm)].map((m) => m[1].trim());
}

describe("A02 A2 orchestration pilot gate coverage", () => {
  it("points every requiredTests entry at a real file (no stale reference)", () => {
    const spec = read(SPEC);
    const tests = requiredTests(spec);
    expect(tests.length).toBeGreaterThan(0);
    for (const test of tests) {
      expect(existsSync(join(ROOT, test)), `missing required test: ${test}`).toBe(true);
    }
    // The removed stale references must not reappear in the frontmatter lists
    // (the re-verification note may still name them as removed).
    const frontmatter = spec.slice(0, spec.indexOf("\n---", 4));
    expect(frontmatter).not.toContain("tests/unit/cross-area-composition.test.ts");
    expect(frontmatter).not.toContain("cross-area/cross-area-facades.ts");
  });

  it("keeps criteria 1-3 mapped to assertions at the original thresholds", () => {
    const counters = read("tests/unit/deprecation-counters.test.ts");
    expect(counters).toContain("degrade_to_live_only");
    expect(counters).toContain("deferralDisagreementCount");
    const scheduler = read("tests/unit/resource-aware-wave-scheduler.test.ts");
    expect(scheduler).toMatch(/rePlan when appliesToWave is already started/);
    const perf = read("tests/unit/performance-budgets.test.ts");
    expect(perf).toContain("p99");
    const spec = read(SPEC);
    expect(spec).toContain("p99 ≤ 80ms");
  });

  it("records criterion 4 (multi-worker resume) as an explicit residual, not a pass", () => {
    const spec = read(SPEC);
    expect(spec).toContain("Criterion 4");
    expect(spec).toMatch(/NO-GO|residual/i);
    expect(spec).toMatch(/multi-worker resume/i);
  });
});