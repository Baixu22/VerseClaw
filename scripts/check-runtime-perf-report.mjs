#!/usr/bin/env node
// Issue #157: validate a runtime performance report and enforce its health gate.
//
// A report is only evidence if every required scenario produced samples from a
// declared scope, and the hot-spot ranking is derived from those samples. This
// gate never treats a missing sample, an unsupported scope, or a work error as
// healthy.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_SCENARIOS = ["idle", "single-task", "burst", "large-history"];
const DEFAULT_REPORT = path.join(repoRoot, "artifacts", "runtime-perf", "report.json");

function readArg(name, fallback) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1] !== undefined) return process.argv[index + 1];
  const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : fallback;
}

const reportPath = path.resolve(readArg("report", DEFAULT_REPORT));
let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  console.error(`runtime-perf report unreadable: ${reportPath}\n${String(error).slice(0, 200)}`);
  process.exit(1);
}

const failures = [];
if (report.schema !== "runtime-perf-report/v1") failures.push(`unexpected schema: ${String(report.schema)}`);
if (report.driven_by !== "agent") failures.push("report must be marked driven_by: agent");
if (typeof report.actor !== "string" || !report.actor.trim()) failures.push("report must record an actor");
if (report.providerStub?.network === true) failures.push("report claims a network call; provider stub must not use the network");
if (report.config?.historySha256 && !/^[a-f0-9]{64}$/u.test(report.config.historySha256)) {
  failures.push("history fixture digest must be a sha256");
}

const byScenario = new Map((report.scenarios ?? []).map((entry) => [entry.scenario, entry]));
for (const scenario of REQUIRED_SCENARIOS) {
  const entry = byScenario.get(scenario);
  if (!entry) {
    failures.push(`missing required scenario: ${scenario}`);
    continue;
  }
  if (!Number.isInteger(entry.sampleCount) || entry.sampleCount <= 0) {
    failures.push(`${scenario}: no samples collected (zero-sample is not healthy)`);
  }
  if (entry.workError) failures.push(`${scenario}: work error: ${entry.workError}`);
  if (entry.processScope?.measured !== "main-process-event-loop") {
    failures.push(`${scenario}: undeclared measurement scope`);
  }
  if (!entry.processScope?.note?.includes("one process only")) {
    failures.push(`${scenario}: scope note must disclaim whole-machine coverage`);
  }
  if (entry.samples?.eventLoopDelayP99Ms?.count !== entry.sampleCount) {
    failures.push(`${scenario}: event-loop sample count does not match sampleCount`);
  }
}

if (!Array.isArray(report.bottlenecks) || report.bottlenecks.length === 0) {
  failures.push("report must record a bounded hot-spot ranking");
}
if (report.limitations?.some((line) => /provider.*performance|not real provider/i.test(line)) !== true) {
  failures.push("report must state the provider-stub limitation");
}

if (failures.length > 0) {
  console.error("Runtime performance gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
const hot = report.bottlenecks[0];
console.log(`runtime performance gate passed (${REQUIRED_SCENARIOS.length} scenarios; top hot spot: ${hot.scenario}/${hot.metric}=${hot.value})`);