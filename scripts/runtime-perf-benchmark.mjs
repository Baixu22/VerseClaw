#!/usr/bin/env node
// Issue #157: run the four bounded runtime performance scenarios and write a
// reviewable evidence report. Provider stubs only; no network, no paid models.
//
//   pnpm runtime:perf -- --duration-ms 1500
//
// Scenarios (fixed, bounded):
//   idle          - monitor only, no load (floor/noise reference)
//   single-task   - one unit of synthetic scheduling work
//   burst         - many concurrent units (event-loop pressure)
//   large-history - parse a large synthetic transcript history
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { measureScenario, RUNTIME_PERF_SCENARIOS, rankBottlenecks } from "./lib/runtime-perf-benchmark.mjs";
import { parseUsageEntriesFromJsonl, aggregateUsageEntries } from "../electron/utils/token-usage-core.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readArg(name, fallback) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1] !== undefined) return process.argv[index + 1];
  const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : fallback;
}

const durationMs = Number(readArg("duration-ms", process.env.RUNTIME_PERF_DURATION_MS ?? "1500"));
const sampleIntervalMs = Number(readArg("sample-interval-ms", process.env.RUNTIME_PERF_SAMPLE_INTERVAL_MS ?? "100"));
const historyLines = Number(readArg("history-lines", process.env.RUNTIME_PERF_HISTORY_LINES ?? "20000"));
const outPath = resolve(readArg("out", join(repoRoot, "artifacts", "runtime-perf", "report.json")));
if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("--duration-ms must be a positive number");
if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs <= 0) throw new Error("--sample-interval-ms must be a positive number");
if (!Number.isSafeInteger(historyLines) || historyLines <= 0) throw new Error("--history-lines must be a positive integer");

/** Deterministic synthetic work: never depends on wall-clock or randomness. */
function syntheticWork(seed, iterations) {
  let acc = seed >>> 0;
  for (let i = 0; i < iterations; i += 1) {
    acc = (Math.imul(acc ^ i, 2_654_435_761) >>> 0) ^ (acc >>> 5);
  }
  return acc;
}

/** Build a fixed large-history fixture in memory (no disk, no network). */
function buildHistoryFixture(lineCount) {
  const lines = [];
  for (let i = 0; i < lineCount; i += 1) {
    const role = i % 20 === 0 ? "toolResult" : "assistant";
    if (role === "assistant") {
      lines.push(JSON.stringify({
        type: "message",
        timestamp: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
        message: {
          role: "assistant",
          model: `synthetic-model-${i % 4}`,
          provider: "provider-stub",
          usage: { input: 100 + (i % 50), output: 40 + (i % 30), cacheRead: i % 7, cacheWrite: i % 3, total: 200 + (i % 80) },
        },
      }));
    } else {
      lines.push(JSON.stringify({
        type: "message",
        timestamp: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
        message: {
          role: "toolResult",
          toolName: "synthetic-tool",
          details: { provider: "provider-stub", model: `synthetic-model-${i % 4}`, usage: { input: 10, output: 5, total: 15 } },
        },
      }));
    }
  }
  return lines.join("\n");
}

const historyFixture = buildHistoryFixture(historyLines);
const historyDigest = createHash("sha256").update(historyFixture).digest("hex");

const scenarios = [];
for (const scenario of RUNTIME_PERF_SCENARIOS) {
  process.stderr.write(`[runtime-perf] scenario=${scenario}\n`);
  const result = await measureScenario(
    scenario,
    (tick) => {
      if (scenario === "idle") return undefined;
      if (scenario === "single-task") {
        // One scheduling unit: an async provider-stub round trip plus a small
        // CPU-bound post-processing step, mirroring a single tool/LLM turn.
        return (async () => {
          await new Promise((resolve) => setImmediate(resolve));
          syntheticWork(tick + 1, 20_000);
        })();
      }
      if (scenario === "burst") {
        // Many concurrent async units: measures scheduling pressure, not a
        // deliberate event-loop-blocking busy loop.
        return Promise.all(Array.from({ length: 64 }, (_, i) => (async () => {
          await new Promise((resolve) => setTimeout(resolve, i % 8));
          syntheticWork(tick + i, 2_000);
        })()));
      }
      return undefined;
    },
    { durationMs, sampleIntervalMs, driver: "provider-stub-scheduling" },
  );
  if (scenario === "large-history") {
    // Measure the real large-history read/parse/aggregate path, bounded to one
    // pass per tick so the sample window is honest about throughput.
    const historyRun = await measureScenario(
      scenario,
      () => {
        const entries = parseUsageEntriesFromJsonl(historyFixture, { sessionId: "perf-synthetic", agentId: "perf" });
        aggregateUsageEntries(entries, "all", { scannedFiles: 1 });
      },
      { durationMs, sampleIntervalMs, driver: "large-history-parse-aggregate" },
    );
    historyRun.label = `synthetic-history-lines=${historyLines}`;
    scenarios.push(historyRun);
    continue;
  }
  scenarios.push(result);
}

const report = {
  schema: "runtime-perf-report/v1",
  generatedAt: new Date().toISOString(),
  driven_by: "agent",
  actor: "codex-runtime-perf-agent",
  provenance: {
    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: (process.env.PROCESSOR_IDENTIFIER ?? "").trim() || null,
    cpuCount: (await import("node:os")).cpus().length,
    timingScope: "in-process CPU; OS tree probe is an explicit PID set, never the whole machine",
  },
  config: { durationMs, sampleIntervalMs, historyLines, historySha256: historyDigest },
  warmupNote: "first scenario run in this process; cold-cache note recorded rather than hidden",
  scenarios,
  bottlenecks: rankBottlenecks(scenarios),
  providerStub: { used: true, network: false, paidModelCall: false },
  limitations: [
    "provider stub latency is scheduling evidence, not real provider performance",
    "in-process CPU/RSS covers one process; tool-tree scope is limited to the reported PID set",
    "samples measure this host at this time; they are not a cross-platform normalization",
  ],
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outPath, bytes: statSync(outPath).size, scenarios: scenarios.map((s) => s.scenario), bottlenecks: report.bottlenecks.length }, null, 2)}\n`);