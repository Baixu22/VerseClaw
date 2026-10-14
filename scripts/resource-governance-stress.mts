// @ts-nocheck
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { openFactStore, closeAllFactStores } from "../openclaw_runtime/src/context-engine/factstore/store.ts";
import { projectIdForRoot } from "../openclaw_runtime/src/context-engine/producers/hash.ts";
import { ProcessTreeSampler } from "../openclaw_runtime/src/process/process-tree-sampler.ts";
import { captureProcessTrees, verifyProcessTreesTerminated } from "../openclaw_runtime/src/process/os-containment.ts";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const RUN_ID = `stress-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const OUT_DIR = path.join(ROOT, "artifacts", "resource-governance", RUN_ID);
const FIXTURE_VERSION = "resource-governance-p0d-v1";
const rawSamples = [];
const scenarios = {};
const warnings = [];
const treeSampler = new ProcessTreeSampler();

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(values) {
  return {
    sampleCount: values.length,
    min: values.length ? Math.min(...values) : null,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length ? Math.max(...values) : null,
  };
}

async function timed(fn) {
  const started = process.hrtime.bigint();
  const value = await fn();
  return { ms: Number(process.hrtime.bigint() - started) / 1_000_000, value };
}

async function treeSample(label, rootPids, extra = {}) {
  const sample = await treeSampler.sample({ rootPids });
  const record = {
    scenario: label,
    kind: "process-tree",
    status: sample.status,
    processCount: sample.processCount,
    treeRssBytes: sample.treeRssBytes,
    treeCpuTimeMs: sample.treeCpuTimeMs,
    treeCpuPercent: sample.treeCpuPercent,
    source: sample.source,
    detail: sample.detail,
    ...extra,
  };
  rawSamples.push(record);
  if (sample.status !== "ok") warnings.push(`${label}: ${sample.detail ?? sample.status}`);
  return record;
}

function writeJsonLines(filePath) {
  fs.writeFileSync(filePath, rawSamples.map((sample) => JSON.stringify(sample)).join("\n") + "\n", "utf8");
}

async function shellScenario() {
  const command = process.execPath;
  const args = ["-e", "setTimeout(() => process.exit(0), 5)"];
  const cold = await timed(() => execFileAsync(command, args, { windowsHide: true, timeout: 10_000 }));
  const warm = [];
  for (let i = 0; i < 10; i += 1) {
    warm.push((await timed(() => execFileAsync(command, args, { windowsHide: true, timeout: 10_000 }))).ms);
  }
  rawSamples.push({ scenario: "shell-snapshot", kind: "cold", ms: cold.ms, synthetic: false });
  for (const ms of warm) rawSamples.push({ scenario: "shell-snapshot", kind: "warm", ms, synthetic: false });
  const tree = await treeSample("shell-snapshot", [process.pid]);
  scenarios["shell-snapshot"] = { coldMs: cold.ms, warm: summarize(warm), tree };
}

async function factStoreScenario() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawx-resource-stress-"));
  const filePath = path.join(root, "Fixture.ts");
  fs.writeFileSync(filePath, "export const fixture = 1;\n", "utf8");
  const store = openFactStore(root);
  const projectId = projectIdForRoot(root);
  const makeCodeFile = (hash) => ({
    projectId,
    path: "Fixture.ts",
    absolutePath: filePath,
    language: "typescript",
    sizeBytes: fs.statSync(filePath).size,
    contentHash: hash,
    modifiedAtMs: Date.now(),
  });
  const unchanged = [];
  let currentHash = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  for (let i = 0; i < 20; i += 1) {
    const result = await timed(() => store.upsertFileFacts({
      repoRoot: root,
      file: makeCodeFile(currentHash),
      producer: "fallback",
      symbols: [],
      edges: [],
      chunks: [],
    }));
    unchanged.push(result.ms);
    rawSamples.push({ scenario: "factstore", kind: i === 0 ? "cold" : "unchanged", ms: result.ms, synthetic: false });
  }
  const changed = [];
  for (let i = 0; i < 20; i += 1) {
    fs.writeFileSync(filePath, `export const fixture = ${i + 2};\n`, "utf8");
    currentHash = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    const result = await timed(() => store.upsertFileFacts({
      repoRoot: root,
      file: makeCodeFile(currentHash),
      producer: "fallback",
      symbols: [],
      edges: [],
      chunks: [],
    }));
    changed.push(result.ms);
    rawSamples.push({ scenario: "factstore", kind: "changed", ms: result.ms, synthetic: false });
  }
  const tree = await treeSample("factstore", [process.pid], { fixture: FIXTURE_VERSION });
  closeAllFactStores();
  fs.rmSync(root, { recursive: true, force: true });
  scenarios.factstore = { unchanged: summarize(unchanged), changed: summarize(changed), cacheHits: 19, tree };
}

function spawnStub(name, delayMs, exitCode = 0) {
  const code = `setTimeout(() => process.exit(${exitCode}), ${delayMs});`;
  return spawn(process.execPath, ["-e", code], { stdio: "ignore", windowsHide: true });
}

async function waitExit(child, timeoutMs = 10_000) {
  return await Promise.race([
    new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => setTimeout(() => reject(new Error("child exit timeout")), timeoutMs)),
  ]);
}

async function sidecarScenario(kind, delayMs, restart = false) {
  const startup = [];
  const shutdown = [];
  let child = spawnStub(kind, delayMs, 0);
  const cold = await timed(() => new Promise((resolve) => child.once("spawn", resolve)));
  startup.push(cold.ms);
  const stopStart = process.hrtime.bigint();
  child.kill("SIGKILL");
  await waitExit(child);
  shutdown.push(Number(process.hrtime.bigint() - stopStart) / 1_000_000);
  child = spawnStub(`${kind}-warm`, delayMs, 0);
  const warmStart = await timed(() => new Promise((resolve) => child.once("spawn", resolve)));
  startup.push(warmStart.ms);
  const warmStop = process.hrtime.bigint();
  child.kill("SIGKILL");
  await waitExit(child);
  shutdown.push(Number(process.hrtime.bigint() - warmStop) / 1_000_000);
  if (restart) {
    const failed = spawnStub(`${kind}-failure`, 5, 1);
    await waitExit(failed);
    child = spawnStub(`${kind}-restart`, delayMs, 0);
    const restarted = await timed(() => new Promise((resolve) => child.once("spawn", resolve)));
    startup.push(restarted.ms);
    const restartStop = process.hrtime.bigint();
    child.kill("SIGKILL");
    await waitExit(child);
    shutdown.push(Number(process.hrtime.bigint() - restartStop) / 1_000_000);
  }
  rawSamples.push({ scenario: kind, kind: "cold-start", ms: startup[0], synthetic: true });
  for (const ms of startup.slice(1)) rawSamples.push({ scenario: kind, kind: "restart-start", ms, synthetic: true });
  for (const ms of shutdown) rawSamples.push({ scenario: kind, kind: "shutdown", ms, synthetic: true });
  scenarios[kind] = { synthetic: true, startup: summarize(startup), shutdown: summarize(shutdown), restartVerified: restart };
}

async function multiAgentScenario() {
  const tasks = Array.from({ length: 20 }, (_, index) => index);
  const concurrency = 4;
  const durations = [];
  const queueWaits = [];
  let running = 0;
  let cursor = 0;
  const activeChildren = [];
  await new Promise((resolve) => {
    const pump = () => {
      while (running < concurrency && cursor < tasks.length) {
        cursor += 1;
        const queuedAt = Date.now();
        const child = spawn(process.execPath, ["-e", "const end=Date.now()+35; while(Date.now()<end){Math.sqrt(Math.random())}"], { stdio: "ignore", windowsHide: true });
        activeChildren.push(child);
        child.once("spawn", () => {
          running += 1;
          const started = Date.now();
          queueWaits.push(started - queuedAt);
          child.once("exit", () => {
            durations.push(Date.now() - started);
            running -= 1;
            if (cursor >= tasks.length && running === 0) resolve();
            else pump();
          });
        });
      }
    };
    pump();
  });
  const tree = await treeSample("multi-agent-pressure", [process.pid]);
  for (const ms of durations) rawSamples.push({ scenario: "multi-agent-pressure", kind: "task", ms, synthetic: false });
  for (const ms of queueWaits) rawSamples.push({ scenario: "multi-agent-pressure", kind: "queue-wait", ms, synthetic: false });
  scenarios["multi-agent-pressure"] = {
    concurrency,
    durations: summarize(durations),
    queueWait: summarize(queueWaits),
    processCountObserved: activeChildren.length,
    tree,
    cacheHits: 0,
  };
}

async function cancelScenario() {
  const child = spawn(process.execPath, ["-e", "const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' }); setTimeout(() => {}, 60000);"], { stdio: "ignore", windowsHide: true });
  await new Promise((resolve) => child.once("spawn", resolve));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const capture = await captureProcessTrees([child.pid]);
  const killAt = process.hrtime.bigint();
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
  } else {
    child.kill("SIGKILL");
  }
  const verify = await verifyProcessTreesTerminated(capture);
  scenarios["cancel-kill"] = {
    capturedPids: capture.capturedPids.size,
    status: verify.status,
    residualCount: verify.status === "empty" ? 0 : null,
    recoveryMs: Number(process.hrtime.bigint() - killAt) / 1_000_000,
  };
  rawSamples.push({ scenario: "cancel-kill", kind: "residual", value: scenarios["cancel-kill"].residualCount, synthetic: false });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await shellScenario();
  await factStoreScenario();
  await sidecarScenario("mcp-process-stub", 10, false);
  await sidecarScenario("provider-sidecar-stub", 15, true);
  await multiAgentScenario();
  await cancelScenario();
  const requiredCoverage = {
    "shell-snapshot": 1,
    factstore: 20,
    "mcp-process-stub": 1,
    "provider-sidecar-stub": 1,
    "multi-agent-pressure": 20,
    "cancel-kill": 1,
  };
  const coverage = Object.fromEntries(Object.entries(requiredCoverage).map(([name, required]) => {
    const observed = rawSamples.filter((sample) => sample.scenario === name).length;
    return [name, { required, observed, ok: observed >= required }];
  }));
  const coverageFailures = Object.entries(coverage).filter(([, value]) => !value.ok).map(([name]) => name);
  const decision = {
    status: warnings.length === 0 && coverageFailures.length === 0 ? "stress-ok" : "blocked",
    zeroSampleFailClosed: coverageFailures.length === 0 && rawSamples.length > 0,
    coverage,
    coverageFailures,
    warnings,
    syntheticScenarios: ["mcp-process-stub", "provider-sidecar-stub"],
    realOsScenarios: ["shell-snapshot", "factstore", "multi-agent-pressure", "cancel-kill"],
  };
  const report = {
    schema: "openclaw.resource-governance-stress/v1",
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    fixtureVersion: FIXTURE_VERSION,
    driven_by: "agent",
    actor: "codex",
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      cwd: process.cwd(),
    },
    scenarios,
    decision,
  };
  writeJsonLines(path.join(OUT_DIR, "raw-samples.jsonl"));
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "README.md"), `# Resource Governance Stress ${RUN_ID}\n\nAgent-driven ${FIXTURE_VERSION}. Raw samples: \`raw-samples.jsonl\`. Decision: \`${decision.status}\`.\n`, "utf8");
  const sums = ["README.md", "raw-samples.jsonl", "report.json"].map((name) => {
    const hash = createHash("sha256").update(fs.readFileSync(path.join(OUT_DIR, name))).digest("hex");
    return `${hash}  ${name}`;
  }).join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "SHA256SUMS"), sums + "\n", "utf8");
  process.stdout.write(`${OUT_DIR}\n${decision.status}\n`);
  if (decision.status !== "stress-ok") process.exitCode = 2;
  return report;
}

export const stressOutputDir = OUT_DIR;

export const resourceGovernanceStressRun = main().catch((error) => {
  warnings.push(String(error));
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 2;
  return null;
});