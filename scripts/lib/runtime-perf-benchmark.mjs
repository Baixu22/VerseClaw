// Issue #157: bounded, agent-runnable runtime performance benchmark.
//
// Measures the four required scenarios (idle, single task, burst, large
// history) with explicit process attribution so a hot spot is identified from
// samples rather than from API names. In-process readers only cover one
// process; tree-wide CPU/RSS is read from the OS via a bounded `wmic`/`ps`
// probe and every sample carries the scope it actually measured.
import { execFile } from "node:child_process";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const RUNTIME_PERF_SCENARIOS = ["idle", "single-task", "burst", "large-history"];

const DEFAULT_SAMPLE_INTERVAL_MS = 100;
const DEFAULT_DURATION_MS = 1_500;
const EVENT_LOOP_RESOLUTION_MS = 10;
const ELP_SIGNIFICANT_MS = 30;
const ELP_BLOCKING_MS = 100;
const CPU_CORE_COUNT = Math.max(1, cpus().length);

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(samples) {
  const sorted = [...samples].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, p50: null, p95: null, p99: null, max: null, mean: null };
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
  return {
    count: sorted.length,
    p50: round(pick(0.5)),
    p95: round(pick(0.95)),
    p99: round(pick(0.99)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length),
  };
}

/** Read OS-level CPU/RSS for an explicit set of PIDs (never "the whole machine"). */
export async function readProcessTreeUsage(pids, options = {}) {
  const wanted = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  if (wanted.length === 0) return { scope: "none", pids: [], cpuMs: null, rssBytes: null, unsupported: false };
  const platform = options.platform ?? process.platform;
  try {
    if (platform === "win32") {
      // `tasklist` is present on every supported Windows version; `wmic` is not.
      const { stdout } = await execFileAsync(
        "tasklist",
        ["/FI", `PID eq ${wanted.join(",")}`, "/FO", "CSV", "/NH"],
        { windowsHide: true, timeout: 2_000, maxBuffer: 4 * 1024 * 1024 },
      );
      let rssBytes = 0;
      let found = 0;
      for (const line of stdout.split(/\r?\n/u)) {
        const cells = line.match(/"([^"]*)"/gu);
        if (!cells || cells.length < 5) continue;
        const pid = Number(cells[1].replaceAll('"', "").replaceAll(",", ""));
        const mem = Number(cells[4].replaceAll('"', "").replaceAll(",", "").replaceAll(" K", "").replaceAll("K", ""));
        if (!wanted.includes(pid)) continue;
        found += 1;
        if (Number.isFinite(mem)) rssBytes += mem * 1024;
      }
      return {
        scope: "explicit-pid-set",
        pids: wanted,
        foundPids: found,
        cpuMs: null,
        rssBytes: found > 0 ? rssBytes : null,
        unsupported: false,
        note: "tasklist reports RSS per PID; CPU time is sampled in-process instead",
      };
    }
    const { stdout } = await execFileAsync("ps", ["-o", "pid=,rss=,time=", "-p", wanted.join(",")], {
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    let rssBytes = 0;
    let found = 0;
    for (const line of stdout.split(/\r?\n/u)) {
      const parts = line.trim().split(/\s+/u);
      if (parts.length < 3) continue;
      const pid = Number(parts[0]);
      const rssKb = Number(parts[1]);
      if (!wanted.includes(pid)) continue;
      found += 1;
      if (Number.isFinite(rssKb)) rssBytes += rssKb * 1024;
    }
    return {
      scope: "explicit-pid-set",
      pids: wanted,
      foundPids: found,
      cpuMs: null,
      rssBytes: found > 0 ? rssBytes : null,
      unsupported: false,
    };
  } catch (error) {
    return {
      scope: "explicit-pid-set",
      pids: wanted,
      foundPids: 0,
      cpuMs: null,
      rssBytes: null,
      unsupported: true,
      reason: String(error).slice(0, 200),
    };
  }
}

/**
 * Run one bounded scenario. `work` is the scenario's synthetic load; it is
 * called once per tick so the sample window also captures the event loop the
 * work runs on. All work is bounded by `durationMs` and the caller's own limits.
 */
export async function measureScenario(scenario, work, options = {}) {
  if (!RUNTIME_PERF_SCENARIOS.includes(scenario)) throw new Error(`unknown scenario: ${scenario}`);
  const durationMs = Math.max(50, options.durationMs ?? DEFAULT_DURATION_MS);
  const intervalMs = Math.max(10, options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS);
  // High-resolution monotonic clock: Date.now() has ~15ms granularity on
  // Windows, which makes a per-tick CPU/wall ratio divide by ~0 and explode.
  const now = options.now ?? (() => performance.now());
  const delay = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
  delay.enable();
  delay.reset();

  const delays = [];
  const cpuRatios = [];
  const rssBytes = [];
  const syncBlockMs = [];
  let ticks = 0;
  let lastCpu = process.cpuUsage();
  let lastAt = now();
  let workError = null;

  const startedAt = now();
  while (now() - startedAt < durationMs) {
    const tickStart = now();
    const cpuBefore = process.cpuUsage();
    try {
      if (work) await work(ticks);
    } catch (error) {
      workError = String(error).slice(0, 300);
    }
    // Synchronous blocking inside this tick: CPU time the process consumed
    // while it held the event loop (includes GC on helper threads).
    const tickCpu = process.cpuUsage(cpuBefore);
    syncBlockMs.push((tickCpu.user + tickCpu.system) / 1_000);
    ticks += 1;
    const at = now();
    const elapsed = Math.max(1, at - lastAt);
    const cpu = process.cpuUsage(lastCpu);
    const cpuMs = (cpu.user + cpu.system) / 1_000;
    // A single-threaded process cannot exceed one core over an interval, but
    // GC/helper threads can, so cap the ratio at the machine's core count.
    const coreCap = CPU_CORE_COUNT;
    // Read the monitor WITHOUT resetting it each tick, so a blocking tick is
    // still visible in the scenario's p99 instead of being erased.
    delays.push(delay.percentile(99) / 1e6);
    cpuRatios.push(Math.min(coreCap, cpuMs / elapsed));
    rssBytes.push(process.memoryUsage().rss);
    lastCpu = process.cpuUsage();
    lastAt = at;
    const remaining = intervalMs - (now() - tickStart);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  const endedAt = now();
  const finalDelayP99 = delay.percentile(99) / 1e6;
  delays.push(finalDelayP99);
  delay.disable();

  // The OS probe is a subprocess; it must not pollute the sampled window, so it
  // runs only after `endedAt` is captured, and only when explicitly requested.
  const treeProbe = options.probeTree === true
    ? await readProcessTreeUsage([process.pid], options)
    : {
        scope: "explicit-pid-set",
        pids: [process.pid],
        cpuMs: null,
        rssBytes: null,
        unsupported: false,
        reason: "tree probe not requested; in-process RSS is reported instead",
      };
  return {
    scenario,
    driver: options.driver ?? "in-process",
    durationMs: endedAt - startedAt,
    ticks,
    sampleIntervalMs: intervalMs,
    workError,
    sampleCount: delays.length,
    samples: {
      eventLoopDelayP99Ms: summarize(delays),
      cpuCoreRatio: summarize(cpuRatios),
      rssBytes: summarize(rssBytes),
      syncBlockMsPerTick: summarize(syncBlockMs),
    },
    processScope: {
      measured: "main-process-event-loop",
      inProcessPids: [process.pid],
      treeProbe,
      note: "in-process CPU/RSS covers one process only; the tree probe is an explicit PID set, not the whole machine",
    },
  };
}

/** Extract a bounded, ordered hot-spot list from measured samples. */
export function rankBottlenecks(scenarios) {
  const findings = [];
  for (const entry of scenarios) {
    if (entry.workError) {
      findings.push({
        scenario: entry.scenario,
        metric: "work-error",
        value: entry.workError,
        evidence: `scenario reported an error while ${entry.ticks} tick(s) ran`,
      });
      continue;
    }
    if (entry.sampleCount === 0) {
      findings.push({
        scenario: entry.scenario,
        metric: "no-samples",
        value: 0,
        evidence: "no event-loop samples were collected; the scenario is not healthy by default",
      });
      continue;
    }
    const p99 = entry.samples.eventLoopDelayP99Ms.p95 ?? 0;
    const cpu = entry.samples.cpuCoreRatio.p95 ?? 0;
    const block = entry.samples.syncBlockMsPerTick?.p95 ?? 0;
    const throughput = entry.durationMs > 0 ? entry.ticks / (entry.durationMs / 1000) : 0;
    // Delay is only meaningful above the monitor resolution and with real load;
    // an idle floor is a reference, not a hot spot.
    if (entry.scenario !== "idle" && block >= ELP_SIGNIFICANT_MS) {
      findings.push({
        scenario: entry.scenario,
        metric: "sync-block-ms-per-tick",
        value: round(block, 2),
        severity: block >= ELP_BLOCKING_MS ? "blocking" : "elevated",
        evidence: "CPU time consumed while this tick held the event loop",
      });
    }
    if (entry.scenario !== "idle" && p99 >= ELP_SIGNIFICANT_MS) {
      findings.push({
        scenario: entry.scenario,
        metric: "event-loop-delay-p99-ms",
        value: p99,
        severity: p99 >= ELP_BLOCKING_MS ? "blocking" : "elevated",
        evidence: `${entry.sampleCount} sample(s) over ${entry.ticks} tick(s)`,
      });
    }
    if (entry.scenario !== "idle" && cpu > 0) {
      findings.push({
        scenario: entry.scenario,
        metric: "cpu-core-ratio",
        value: cpu,
        severity: cpu >= 0.7 ? "blocking" : cpu >= 0.3 ? "elevated" : "info",
        evidence: "in-process CPU time / wall time for the sampled interval",
      });
    }
    findings.push({
      scenario: entry.scenario,
      metric: "ticks-per-second",
      value: round(throughput, 2),
      severity: "info",
      evidence: `${entry.ticks} tick(s) in ${Math.round(entry.durationMs)} ms`,
    });
  }
  const severityRank = { blocking: 2, elevated: 1, info: 0 };
  return findings
    .sort((a, b) => (severityRank[b.severity] - severityRank[a.severity]) || ((Number(b.value) || 0) - (Number(a.value) || 0)))
    .slice(0, 12);
}