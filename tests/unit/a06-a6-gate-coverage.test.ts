import { existsSync, readFileSync, readdirSync } from "node:fs";
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
] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("A06 A6 gate coverage", () => {
  it("keeps every A6 required test path present and wired into the archived pilot spec", () => {
    const spec = readFileSync(path.join(ROOT, SPEC), "utf8");
    for (const rel of REQUIRED_TESTS) {
      expect(spec).toContain(`- ${rel}`);
      expect(existsSync(path.join(ROOT, rel))).toBe(true);
    }
    expect(spec).not.toContain("tests/unit/cross-area-composition.test.ts");
    expect(spec).not.toContain("openclaw_runtime/src/agents/cross-area/cross-area-facades.ts");
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

  it("keeps the missing verifier, lease-ordering, and pause/resume latency gates explicit", () => {
    const sourceFiles = [
      ...walk(path.join(ROOT, "openclaw_runtime/src")),
      ...walk(path.join(ROOT, "openclaw_runtime/packages/agent-core/src")),
    ];
    const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    const declarations = source.match(/(?:class|interface|type|function|const)\s+(ResumeContractVerifier|FingerprintLeaseCoordinator)\b/g) ?? [];
    expect(declarations).toEqual([]);
    const reverifyUsages = source.match(/\brequiresReverification\b/g) ?? [];
    expect(reverifyUsages).toEqual([]);

    const perf = readFileSync(path.join(ROOT, "tests/unit/performance-budgets.test.ts"), "utf8");
    expect(perf).not.toContain("A6");
    expect(perf).not.toContain("10 pause");

    const manual = readFileSync(path.join(ROOT, "docs/runtime-design/development-manual.md"), "utf8");
    expect(manual).toContain("ResumeContractVerifier");
    expect(manual).toContain("A6 deprecation: `ResumeContractVerifier` pass rate + volatile mislabel");
  });
});
