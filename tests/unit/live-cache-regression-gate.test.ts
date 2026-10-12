import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __testing } from "../../openclaw_runtime/src/agents/live-cache-regression-runner.js";
import { buildLiveCacheRegressionGateReport } from "../../openclaw_runtime/src/agents/live-cache-regression-report.js";

describe("live cache regression gate", () => {
  it("builds a secret-free report with threshold and lane summaries", () => {
    const summary = {
      anthropic: { stable: { hitRate: 0.99, best: { cacheRead: 5_600 } } },
      openai: { stable: { skipped: true } },
    };
    const report = buildLiveCacheRegressionGateReport({
      measured: true,
      summary,
      generatedAt: "2026-10-12T00:00:00.000Z",
    });

    expect(report.result).toEqual({
      measured: true,
      passed: true,
      regressions: [],
      warnings: [],
    });
    expect(report.threshold.anthropic.stable.minCacheReadOrWrite).toBeGreaterThan(0);
    expect(report.perTurn).toEqual(summary);
    expect(report.promptCache).toEqual(summary);
    expect(report.artifactSafety).toEqual({ apiKeyCaptured: false });
  });

  it("marks a regression report as failed", () => {
    const report = buildLiveCacheRegressionGateReport({
      measured: true,
      regressions: ["anthropic:stable cacheRead=1 < min=5400"],
    });
    expect(report.result.passed).toBe(false);
    expect(report.result.regressions).toHaveLength(1);
  });

  it("marks an unmeasured run as failed, never green", () => {
    const report = buildLiveCacheRegressionGateReport({
      measured: false,
      regressions: ["unmeasured"],
    });
    expect(report.result.measured).toBe(false);
    expect(report.result.passed).toBe(false);
  });

  it("injects a hard Anthropic floor regression", () => {
    const findings = __testing.evaluateAgainstBaseline({
      provider: "anthropic",
      lane: "image",
      result: {
        best: {
          hitRate: 0.5,
          suffix: "hard",
          text: "CACHE-OK hard",
          usage: { input: 100, cacheRead: 100, cacheWrite: 1 },
        },
      },
    });
    expect(findings.regressions.join("\n")).toContain("anthropic:image");
    expect(findings.warnings).toHaveLength(0);
  });

  it("keeps OpenAI drift warn-only", () => {
    const findings = __testing.evaluateAgainstBaseline({
      provider: "openai",
      lane: "image",
      result: {
        best: {
          hitRate: 0.5,
          suffix: "warn",
          text: "CACHE-OK warn",
          usage: { input: 100, cacheRead: 100, cacheWrite: 1 },
        },
      },
    });
    expect(findings.regressions).toHaveLength(0);
    expect(findings.warnings.join("\n")).toContain("openai:image");
  });

  it("keeps workflow_dispatch and weekly scheduling wired to the live runner", () => {
    const workflow = readFileSync(
      path.join(process.cwd(), ".github/workflows/live-cache-regression.yml"),
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("cron:");
    expect(workflow).toContain("pnpm --dir openclaw_runtime run test:live:cache");
    expect(workflow).toContain("actions/upload-artifact@");
  });
});
