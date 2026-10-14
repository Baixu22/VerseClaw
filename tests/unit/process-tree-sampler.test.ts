import { describe, expect, it } from "vitest";
import {
  ProcessTreeSampler,
  readProcessTreeSample,
  type ProcessTreeSample,
} from "../../openclaw_runtime/src/process/process-tree-sampler";

function sample(overrides: Partial<ProcessTreeSample> = {}): ProcessTreeSample {
  return {
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
}

describe("process tree sampler", () => {
  it("computes tree CPU percent from cumulative CPU-time deltas", async () => {
    const queue: ProcessTreeSample[] = [
      sample({ sampledAt: 1_000, treeCpuTimeMs: 100 }),
      sample({ sampledAt: 2_000, treeCpuTimeMs: 600 }),
    ];
    const sampler = new ProcessTreeSampler({
      now: () => queue[0]!.sampledAt,
      readSample: async () => queue.shift()!,
    });

    const first = await sampler.sample({ rootPids: [123], queueDepth: 2, queueWaitMs: 15 });
    const second = await sampler.sample({ rootPids: [123], queueDepth: 2, queueWaitMs: 15 });
    expect(first.treeCpuPercent).toBe(0);
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