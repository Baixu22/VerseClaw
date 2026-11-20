// @vitest-environment node
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ProcessTreeSampler,
  readProcessTreeSample,
  type ProcessTreeSample,
} from "../../openclaw_runtime/src/process/process-tree-sampler";

function sample(overrides: Partial<ProcessTreeSample> = {}): ProcessTreeSample {
  const result: ProcessTreeSample = {
    status: "ok",
    sampledAt: 1_000,
    rootPids: [123],
    processCount: 3,
    treeRssBytes: 1024,
    treeCpuTimeMs: 100,
    treeCpuPercent: null,
    queueDepth: 2,
    queueWaitMs: 15,
    source: "windows-cim",
    ...overrides,
  };
  result.processes = [{ pid: 123, parentPid: 1, creationToken: 'created', rssBytes: result.treeRssBytes ?? 0, privateBytes: null, cpuTimeMs: result.treeCpuTimeMs ?? 0, cpuPercent: null }];
  return result;
}

describe("process tree sampler", () => {
  it.skipIf(!["win32", "linux"].includes(process.platform))("measures a live busy child by its creation identity and observes its exit", async () => {
    const child = spawn(process.execPath, ['-e', `
      const loop = setInterval(() => { const end = Date.now() + 30; while (Date.now() < end) {} }, 60);
      process.on('message', () => { clearInterval(loop); process.disconnect(); });
      process.send('ready');
    `], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const closed = once(child, 'exit');
    try {
      await once(child, 'message');
      const sampler = new ProcessTreeSampler();
      const first = await sampler.sample({ rootPids: [child.pid!] });
      await new Promise(resolve => setTimeout(resolve, 200));
      const second = await sampler.sample({ rootPids: [child.pid!] });
      expect(first.status, first.detail).toBe('ok'); expect(first.treeCpuPercent).toBeNull();
      expect(second.status, second.detail).toBe('ok'); expect(second.treeCpuPercent).toBeGreaterThan(0);
      expect(second.processes?.[0]?.creationToken).toBe(first.processes?.[0]?.creationToken);
      expect(second.treeRssBytes).toBeGreaterThan(0);
      if (process.platform === 'win32') {
        expect(second.processes?.[0]?.privateBytes).toBeGreaterThan(0);
        expect(second.machineCommit?.committedBytes).toBeGreaterThan(0);
        expect(second.machineCommit?.commitLimitBytes).toBeGreaterThanOrEqual(second.machineCommit!.committedBytes);
      }
      child.send('stop'); await closed;
      if (process.env.RESOURCE_METRICS_REPORT_DIR) writeFileSync(join(process.env.RESOURCE_METRICS_REPORT_DIR, 'live-child.json'), JSON.stringify({
        driven_by: 'agent', actor: 'codex', first, second, exitCode: child.exitCode, observedExit: true,
      }, null, 2));
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    }
  }, 45_000);
  it("computes tree CPU percent from cumulative CPU-time deltas", async () => {
    const queue: ProcessTreeSample[] = [
      sample({ sampledAt: 1_000, treeCpuTimeMs: 100 }),
      sample({ sampledAt: 2_000, treeCpuTimeMs: 600 }),
    ];
    const sampler = new ProcessTreeSampler({
      now: () => 2_000,
      readSample: async () => queue.shift()!,
    });

    const first = await sampler.sample({ rootPids: [123], queueDepth: 2, queueWaitMs: 15 });
    const second = await sampler.sample({ rootPids: [123], queueDepth: 2, queueWaitMs: 15 });
    expect(first.treeCpuPercent).toBeNull();
    expect(second.treeCpuPercent).toBe(50);
    expect(second.queueDepth).toBe(2);
    expect(second.queueWaitMs).toBe(15);
  });

  it("fails closed when process discovery is unavailable", async () => {
    const sampler = new ProcessTreeSampler({
      readSample: async () => sample({ status: "unknown", processCount: null, treeRssBytes: null, treeCpuTimeMs: null, detail: "probe failed" }),
    });
    const result = await sampler.sample({ rootPids: [123] });
    expect(result.status).toBe("unknown");
    expect(result.processCount).toBeNull();
    expect(result.treeRssBytes).toBeNull();
  });

  it("reports empty roots as empty rather than a healthy process tree", async () => {
    const result = await readProcessTreeSample({ rootPids: [] });
    expect(result.status).toBe("empty");
    expect(result.processCount).toBe(0);
  });

  it.skipIf(!["win32", "linux"].includes(process.platform))("reads a real process tree for the current process", async () => {
    const result = await readProcessTreeSample({ rootPids: [process.pid] });
    expect(result.status).toBe("ok");
    expect(result.processCount).toBeGreaterThanOrEqual(1);
    expect(result.treeRssBytes).toBeGreaterThan(0);
  });
});
