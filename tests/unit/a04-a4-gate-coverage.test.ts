import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SPEC = "harness/specs/tasks/a4-decision-quality-pilot.md";
const REQUIRED_TESTS = [
  "tests/unit/decision-quality-auditor.test.ts",
  "tests/unit/deprecation-counters.test.ts",
  "tests/unit/performance-budgets.test.ts",
  "tests/unit/deep/a4-deep.test.ts",
  "tests/unit/trace-truncation.test.ts",
  "tests/unit/a04-a4-gate-coverage.test.ts",
  "tests/unit/a4-decision-quality-dev-tool.test.ts",
] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("A04 A4 gate coverage", () => {
  it("keeps every A4 required test path present and wired into the archived pilot spec", () => {
    const spec = readFileSync(path.join(ROOT, SPEC), "utf8");
    for (const rel of REQUIRED_TESTS) {
      expect(spec).toContain(`- ${rel}`);
      expect(existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });

  it("pins the A4 counter action and A4-first degradation order evidence", () => {
    const counters = readFileSync(
      path.join(ROOT, "openclaw_runtime/src/observability/deprecation-counters.ts"),
      "utf8",
    );
    expect(counters).toContain('action: "degrade_to_audit_only"');

    const traceRecorder = readFileSync(
      path.join(ROOT, "openclaw_runtime/src/observability/trace-recorder.ts"),
      "utf8",
    );
    expect(traceRecorder).toContain("a4 > a3 > a5 > a2 > a1 > a6 > core");

    const traceTest = readFileSync(path.join(ROOT, "tests/unit/trace-truncation.test.ts"), "utf8");
    expect(traceTest).toContain("drops lowest-priority spans first");
    expect(traceTest).toContain("a4, a3, a5 should be dropped");
  });

  it("pins A4 as offline-only with the sanctioned dev-tool consumer wired", () => {
    const manual = readFileSync(path.join(ROOT, "docs/runtime-design/development-manual.md"), "utf8");
    expect(manual).toContain("A4 — Decision Quality (offline pure functions only)");
    expect(manual).toContain("A4 is called ONLY via explicit dev-tool invocation");

    // The only consumer of the auditor must be the explicit dev-tool CLI; the
    // runtime tree must not import it on any production turn path.
    const offenders = walk(path.join(ROOT, "openclaw_runtime/src"))
      .filter((file) => !file.includes("decision-quality-auditor"))
      .filter((file) => readFileSync(file, "utf8").includes("DecisionQualityAuditor"));
    expect(offenders).toEqual([]);

    expect(existsSync(path.join(ROOT, "scripts/a4-decision-quality-audit.mts"))).toBe(true);
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["a4:decision-quality-audit"]).toContain("a4-decision-quality-audit.mts");
  });
});
