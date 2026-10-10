import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const gate = path.join(repoRoot, "scripts", "check-runtime-perf-report.mjs");
const tempRoots: string[] = [];

function runGate(report: unknown): { status: number; stdout: string; stderr: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-perf-gate-"));
  tempRoots.push(root);
  const reportPath = path.join(root, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  try {
    const stdout = execFileSync(process.execPath, [gate, "--report", reportPath], {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

function scenario(name: string, overrides: Record<string, unknown> = {}) {
  return {
    scenario: name,
    driver: "provider-stub-scheduling",
    durationMs: 1000,
    ticks: 10,
    sampleIntervalMs: 200,
    workError: null,
    sampleCount: 10,
    samples: {
      eventLoopDelayP99Ms: { count: 10, p50: 1, p95: 1, p99: 1, max: 1, mean: 1 },
      cpuCoreRatio: { count: 10, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 },
      rssBytes: { count: 10, p50: 1, p95: 1, p99: 1, max: 1, mean: 1 },
      syncBlockMsPerTick: { count: 10, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 },
    },
    processScope: {
      measured: "main-process-event-loop",
      inProcessPids: [1],
      treeProbe: { scope: "explicit-pid-set", pids: [1], unsupported: false },
      note: "in-process CPU/RSS covers one process only; the tree probe is an explicit PID set, not the whole machine",
    },
    ...overrides,
  };
}

function healthyReport() {
  return {
    schema: "runtime-perf-report/v1",
    generatedAt: new Date().toISOString(),
    driven_by: "agent",
    actor: "codex-runtime-perf-agent",
    provenance: { sourceRevision: "test", node: process.version, platform: process.platform, arch: process.arch, cpuCount: 8 },
    config: { durationMs: 1000, sampleIntervalMs: 200, historyLines: 100, historySha256: "a".repeat(64) },
    scenarios: ["idle", "single-task", "burst", "large-history"].map((name) => scenario(name)),
    bottlenecks: [{ scenario: "large-history", metric: "cpu-core-ratio", value: 1.2, severity: "blocking", evidence: "measured" }],
    providerStub: { used: true, network: false, paidModelCall: false },
    limitations: ["provider stub latency is scheduling evidence, not real provider performance"],
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("runtime performance report gate", () => {
  it("accepts a complete agent-driven four-scenario report", () => {
    const result = runGate(healthyReport());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("runtime performance gate passed");
  });

  it("rejects a zero-sample scenario instead of treating it as healthy", () => {
    const report = healthyReport();
    report.scenarios[3] = scenario("large-history", {
      sampleCount: 0,
      samples: { ...scenario("large-history").samples, eventLoopDelayP99Ms: { count: 0, p50: null, p95: null, p99: null, max: null, mean: null } },
    });
    const result = runGate(report);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no samples collected");
  });

  it("rejects a work error and an undeclared process scope", () => {
    const withError = healthyReport();
    withError.scenarios[2] = scenario("burst", { workError: "boom" });
    expect(runGate(withError).stderr).toContain("work error");

    const badScope = healthyReport();
    badScope.scenarios[1] = scenario("single-task", {
      processScope: { measured: "whole-machine", inProcessPids: [1], treeProbe: {}, note: "x" },
    });
    expect(runGate(badScope).stderr).toContain("undeclared measurement scope");
  });

  it("rejects a report that hides the provider-stub limitation or uses the network", () => {
    const noLimitation = healthyReport();
    noLimitation.limitations = ["all good"];
    expect(runGate(noLimitation).stderr).toContain("provider-stub limitation");

    const networked = healthyReport();
    networked.providerStub = { used: true, network: true, paidModelCall: false };
    expect(runGate(networked).stderr).toContain("must not use the network");
  });
});