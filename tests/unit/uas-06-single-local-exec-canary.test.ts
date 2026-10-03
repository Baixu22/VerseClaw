import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  summarizeUas06Canary,
  UAS06_ENGINEERING_SCENARIOS,
  type Uas06CanaryObservation,
} from "../../openclaw_runtime/src/agents/verseshell/single-plane-canary";
import {
  UAS06_LIVE_OBSERVATIONS_SCHEMA,
  validateUas06LiveEvidence,
} from "../../openclaw_runtime/src/agents/verseshell/real-canary-evidence";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function engineeringObservation(
  scenario: Uas06CanaryObservation["scenario"],
): Uas06CanaryObservation {
  return {
    observationId: `engineering-${scenario}`,
    source: "engineering",
    cohortId: "internal-canary",
    cohortArm: "verseshell",
    scenario,
    eligibleLocal: true,
    executionHost: "verseshell",
    lifecycleOwner: "verseshell",
    nativeFallback: false,
    outcome: "completed",
    durationMs: 1,
    recoveryState:
      scenario === "cancel" || scenario === "timeout"
        ? "killed"
        : scenario === "restart"
          ? "lost"
          : "exited",
    unauthorizedExecutionCount: 0,
    duplicateProcessCount: 0,
    lostOutputBytes: 0,
    sensitiveOutputLeakCount: 0,
    ...(scenario === "rollback" ? { rollbackSucceeded: true } : {}),
  };
}

describe("UAS-06 single local execution plane boundary", () => {
  it("keeps operator cohort selection out of the model-facing host enum", () => {
    const configSchema = read("openclaw_runtime/src/config/zod-schema.agent-runtime.ts");
    const toolSchema = read("openclaw_runtime/src/agents/bash-tools.schemas.ts");
    expect(configSchema).toContain('["auto", "sandbox", "gateway", "node", "verseshell"]');
    expect(toolSchema).toContain(
      'const EXEC_TOOL_HOST_VALUES = ["auto", "sandbox", "gateway", "node"]',
    );
    expect(toolSchema).not.toContain(
      'EXEC_TOOL_HOST_VALUES = ["auto", "sandbox", "gateway", "node", "verseshell"]',
    );
  });

  it("records the selected route, actual owner, fallback, and recovery state", () => {
    const runtime = read("openclaw_runtime/src/agents/bash-tools.exec-runtime.ts");
    const events = read("openclaw_runtime/src/infra/diagnostic-events.ts");
    const stability = read("openclaw_runtime/src/logging/diagnostic-stability.ts");
    for (const field of [
      "selectedHost",
      "executionHost",
      "lifecycleOwner",
      "cohortRoute",
      "nativeFallback",
      "recoveryState",
    ]) {
      expect(runtime).toContain(field);
      expect(events).toContain(field);
      expect(stability).toContain(field);
    }
    expect(runtime).toContain('cohortRoute: "verseshell-single-plane"');
    expect(runtime).toContain("compatibilityNativeFallbackUsed = true");
  });

  it("does not convert an engineering matrix into real canary completion", () => {
    const report = summarizeUas06Canary(
      UAS06_ENGINEERING_SCENARIOS.map((scenario) => engineeringObservation(scenario)),
    );
    expect(report.status).toBe("needs-real-canary");
    expect(report.productGraduationAuthorized).toBe(false);
    expect(report.coverage.governedLocalPercent).toBe(100);
    expect(report.requiredNextEvidence).toContain("real internal cohort observations");
  });

  it("locks UAS-07 and product graduation behind reviewed real cohort evidence", () => {
    const task = read("harness/specs/tasks/uas-06-single-local-exec-canary.md");
    const rule = read("harness/specs/rules/verseshell-single-local-exec-canary-boundary.md");
    expect(task).toContain("TF-0018 cannot start until a reviewed real cohort report");
    expect(rule).toContain("UAS-07 and UAS-08 remain locked");
    expect(task).toContain("changing liveReady, productApproved, defaultOn, TF-0006");
  });

  it("inventories both evidence channels without a local session handoff", async () => {
    const engineering = await import("../../scripts/uas-06-canary-evidence.mts");
    const real = await import("../../scripts/uas-06-real-canary.mts");
    const stableRunbook = "docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md";
    const inventories = [
      {
        paths: engineering.UAS06_ENGINEERING_SOURCE_EVIDENCE,
        inventory: engineering.inventoryUas06EngineeringSources,
      },
      {
        paths: real.UAS06_REAL_SOURCE_EVIDENCE,
        inventory: real.inventoryUas06RealSources,
      },
    ];
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), "uas06-source-inventory-"));
    const fixtureContent = "agent-driven source inventory fixture\n";
    try {
      for (const { paths } of inventories) {
        expect(paths).toContain(stableRunbook);
        expect(new Set(paths).size).toBe(paths.length);
        expect(paths.some((file) => file.startsWith("docs/dev/handoffs/"))).toBe(false);
        for (const file of paths) {
          const destination = resolve(fixtureRoot, file);
          mkdirSync(dirname(destination), { recursive: true });
          writeFileSync(destination, fixtureContent);
        }
      }
      expect(existsSync(resolve(fixtureRoot, "docs/dev/handoffs"))).toBe(false);
      for (const { paths, inventory } of inventories) {
        const result = inventory(fixtureRoot);
        expect(result.map((entry) => entry.path)).toEqual([...paths]);
        expect(result).toContainEqual({
          path: stableRunbook,
          bytes: Buffer.byteLength(fixtureContent),
          sha256: createHash("sha256").update(fixtureContent).digest("hex"),
        });
      }
      rmSync(resolve(fixtureRoot, stableRunbook));
      for (const { inventory } of inventories) {
        expect(() => inventory(fixtureRoot)).toThrow(stableRunbook);
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("keeps reviewed live records in a separate, non-executing evidence channel", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    const template = JSON.parse(
      read("tests/fixtures/uas-06-live-observations.json"),
    );
    const script = read("scripts/uas-06-real-canary.mts");

    expect(template).toEqual({ schema: UAS06_LIVE_OBSERVATIONS_SCHEMA, observations: [] });
    expect(validateUas06LiveEvidence(template).issues).toEqual([]);
    expect(packageJson.scripts?.["uas:06:real-canary"]).toContain(
      "scripts/uas-06-real-canary.mts",
    );
    expect(packageJson.scripts?.["uas:06:real-canary:check"]).toContain("--check");
    expect(script).toContain("real-cohort-report.json");
    expect(script).toContain("taskForestCloseoutAuthorized");
    expect(script).not.toContain("startGatewayServer");
    expect(script).not.toContain("DEEPSEEK_API_KEY");
  });
});
