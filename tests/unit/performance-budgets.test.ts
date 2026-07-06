import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import {
  ObservabilityTraceRecorder,
} from "../../openclaw_runtime/src/observability/trace-recorder.js";
import { getFileFingerprint, diffFileFingerprints } from "../../openclaw_runtime/src/agents/long-task-control/file-fingerprint.js";
import {
  ResourceAwareWaveScheduler,
} from "../../openclaw_runtime/src/agents/resource-aware-wave-scheduler.js";
import {
  ContextBudgetPlanner,
  ResumeContractVerifier,
} from "../../openclaw_runtime/src/agents/cross-area/cross-area-facades.js";
import { classifyAnomalyPattern } from "../../openclaw_runtime/src/agents/anomaly-classifier.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OrchestrationTaskGraph } from "../../openclaw_runtime/src/agents/orchestration-protocol.js";

/**
 * Stage 4 / 4.5-4.11: Performance budget benchmarks.
 *
 * Each benchmark measures the p99 latency of an area's hot path against the
 * Stage 0 budget. These are NOT micro-benchmarks — they exercise the real
 * hot-path code paths used in production.
 *
 * p99 is approximated by the max of 100 runs (n=100 is too small for true
 * p99, but max-of-100 is a conservative upper bound).
 */

function makeGraph(nodeCount: number): OrchestrationTaskGraph {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    taskNodeId: `task-${i + 1}`,
    roleName: "worker",
    task: `Task ${i + 1}`,
    phase: "worker" as const,
    dependsOn: [] as string[],
    scope: "default",
    requiredCapabilities: [],
    attemptPolicy: { maxRepairAttempts: 0, maxRedoAttempts: 0 },
    status: "planned" as const,
    isVerifier: false,
  }));
  return {
    graphRunId: "run-1",
    mode: "router",
    status: "planned",
    nodes,
    edges: [],
  };
}

function p99(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
  return sorted[idx];
}

const ITERATIONS = 100;
const WARMUP = 5;

describe("Stage 4 / 4.5: A1 p99 ≤ 200ms (100-turn session)", () => {
  it("A1 isolation hot path stays under 200ms p99", () => {
    const samples: number[] = [];

    for (let i = 0; i < ITERATIONS + WARMUP; i++) {
      const recorder = new ObservabilityTraceRecorder(
        { name: `bench-${i}` },
        { callerArea: "a1", idFactory: (p) => `${p}_${i}` },
      );
      recorder.start();
      const start = performance.now();
      const span = recorder.startSpan({ name: `span-${i}`, kind: "tool", area: "a1" });
      recorder.recordEvent("claw.a1.tool.choice", "Choice");
      recorder.endSpan(span.id);
      const elapsed = performance.now() - start;
      if (i >= WARMUP) samples.push(elapsed);
    }

    const p99Latency = p99(samples);
    // Assert against budget, allowing some CI variance headroom.
    expect(p99Latency, `A1 p99 ${p99Latency}ms exceeds 200ms budget`).toBeLessThan(200);
  });
});

describe("Stage 4 / 4.6: A2 p99 ≤ 80ms (10-wave orchestration)", () => {
  it("A2 wave scheduling hot path stays under 80ms p99", () => {
    const samples: number[] = [];

    for (let i = 0; i < ITERATIONS + WARMUP; i++) {
      const graph = makeGraph(30); // 10 waves of 3 workers each
      const scheduler = new ResourceAwareWaveScheduler(graph, { maxWorkers: 3 });
      const start = performance.now();
      scheduler.plan();
      scheduler.startWave(1);
      const elapsed = performance.now() - start;
      if (i >= WARMUP) samples.push(elapsed);
    }

    const p99Latency = p99(samples);
    expect(p99Latency, `A2 p99 ${p99Latency}ms exceeds 80ms budget`).toBeLessThan(80);
  });
});

describe("Stage 4 / 4.7: A3 p99 ≤ 15ms (100 Mission ticks)", () => {
  it("A3 anomaly classification hot path stays under 15ms p99", () => {
    const samples: number[] = [];

    for (let i = 0; i < ITERATIONS + WARMUP; i++) {
      const start = performance.now();
      // A3 hot path: anomaly classification.
      const result = classifyAnomalyPattern({
        tick: i,
        repairTicksUsed: i % 5,
        maxRepairTicks: 10,
        maxTicks: 100,
        failures: i % 3 === 0 ? ["tool_failed"] : undefined,
        recentToolFailureCount: i % 4,
      });
      // Force evaluation by referencing the result.
      void result;
      const elapsed = performance.now() - start;
      if (i >= WARMUP) samples.push(elapsed);
    }

    const p99Latency = p99(samples);
    expect(p99Latency, `A3 p99 ${p99Latency}ms exceeds 15ms budget`).toBeLessThan(15);
  });
});

describe("Stage 4 / 4.8: A5 p99 ≤ 30ms (100-turn session)", () => {
  it("A5 budget planner hot path stays under 30ms p99", () => {
    const samples: number[] = [];

    for (let i = 0; i < ITERATIONS + WARMUP; i++) {
      const graph = makeGraph(8);
      const planner = new ContextBudgetPlanner(graph, 4);
      planner.plan();
      const start = performance.now();
      planner.replanOnResume(3);
      const elapsed = performance.now() - start;
      if (i >= WARMUP) samples.push(elapsed);
    }

    const p99Latency = p99(samples);
    expect(p99Latency, `A5 p99 ${p99Latency}ms exceeds 30ms budget`).toBeLessThan(30);
  });
});

describe("Stage 4 / 4.9: A6 p99 ≤ 300ms (10 pause/resume cycles)", () => {
  let tempDirs: string[] = [];

  async function setupFiles(idx: number): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), `clawx-a6-${idx}-`));
    tempDirs.push(dir);
    await writeFile(join(dir, "file1.txt"), `content-${idx}-1`);
    await writeFile(join(dir, "file2.txt"), `content-${idx}-2`);
    await writeFile(join(dir, "file3.txt"), `content-${idx}-3`);
    return dir;
  }

  async function cleanup(): Promise<void> {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  }

  it("A6 fingerprint + resume hot path stays under 300ms p99", async () => {
    const samples: number[] = [];

    for (let i = 0; i < 10 + WARMUP; i++) {
      const dir = await setupFiles(i);
      try {
        const start = performance.now();

        // A6 hot path: fingerprint + diff + resume contract verify.
        const fp1 = await getFileFingerprint(join(dir, "file1.txt"));
        const fp2 = await getFileFingerprint(join(dir, "file2.txt"));
        const beforeDir = {
          rootPath: dir,
          files: new Map([
            ["file1.txt", fp1!],
            ["file2.txt", fp2!],
          ]),
          skipped: [],
          totalBytes: (fp1?.size ?? 0) + (fp2?.size ?? 0),
        };
        const afterDir = {
          rootPath: dir,
          files: new Map([
            ["file1.txt", fp1!],
            ["file2.txt", fp2!],
          ]),
          skipped: [],
          totalBytes: (fp1?.size ?? 0) + (fp2?.size ?? 0),
        };
        diffFileFingerprints(beforeDir, afterDir);

        const verifier = new ResumeContractVerifier();
        verifier.verify({ config: undefined }, false);

        const elapsed = performance.now() - start;
        if (i >= WARMUP) samples.push(elapsed);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }

    const p99Latency = p99(samples);
    // Allow generous headroom for I/O variance on CI.
    expect(p99Latency, `A6 p99 ${p99Latency}ms exceeds 300ms budget`).toBeLessThan(300);
    await cleanup();
  });
});

describe("Stage 4 / 4.10: per-turn cumulative p99 ≤ 300ms (A1+A5+A3 active)", () => {
  it("cumulative A1+A5+A3 hot path stays under 300ms p99", () => {
    const samples: number[] = [];

    for (let i = 0; i < ITERATIONS + WARMUP; i++) {
      const start = performance.now();

      // A1: trace recorder span (no I/O).
      const recorder = new ObservabilityTraceRecorder(
        { name: `cumulative-${i}` },
        { callerArea: "a1", idFactory: (p) => `${p}_${i}` },
      );
      recorder.start();
      const spanId = recorder.startSpan({ name: `span-${i}`, kind: "tool", area: "a1" }).id;
      recorder.recordEvent("claw.a1.tool.choice", "Choice");
      recorder.endSpan(spanId);

      // A5: budget planner re-plan (no I/O).
      const graph = makeGraph(8);
      const planner = new ContextBudgetPlanner(graph, 4);
      planner.plan();
      planner.replanOnResume(2);

      // A3: anomaly classification (no I/O).
      classifyAnomalyPattern({
        tick: i,
        repairTicksUsed: 1,
        maxRepairTicks: 10,
        maxTicks: 100,
        recentToolFailureCount: 1,
      });

      const elapsed = performance.now() - start;
      if (i >= WARMUP) samples.push(elapsed);
    }

    const p99Latency = p99(samples);
    // Per-turn cumulative budget is 300ms; degradation order A4→A3→A5→A1.
    expect(p99Latency, `cumulative p99 ${p99Latency}ms exceeds 300ms budget`).toBeLessThan(300);
  });
});

describe("Stage 4 / 4.11: shadow total memory ≤ 24MB", () => {
  it("shadow instrumentation memory footprint stays under 24MB", () => {
    // Measure the memory delta after exercising all shadow paths.
    const baseline = process.memoryUsage().rss;

    // Exercise all shadow paths: trace recorder + wave scheduler + counters.
    const recorders: ObservabilityTraceRecorder[] = [];
    const schedulers: ResourceAwareWaveScheduler[] = [];
    for (let i = 0; i < 100; i++) {
      const recorder = new ObservabilityTraceRecorder(
        { name: `mem-${i}` },
        { callerArea: "core", idFactory: (p) => `${p}_${i}` },
      );
      recorder.start();
      for (let j = 0; j < 50; j++) {
        recorder.startSpan({ name: `span-${j}`, kind: "tool", area: "a1" });
      }
      recorders.push(recorder);

      const scheduler = new ResourceAwareWaveScheduler(makeGraph(20), { maxWorkers: 4 });
      scheduler.plan();
      schedulers.push(scheduler);
    }

    // Force GC if available (Node 22+ has --expose-gc; without it, we use a
    // conservative upper bound).
    if (typeof globalThis.gc === "function") {
      globalThis.gc();
    }

    const after = process.memoryUsage().rss;
    const deltaBytes = after - baseline;

    // Convert to MB and allow headroom for CI variance.
    const deltaMB = deltaBytes / (1024 * 1024);
    // The 24MB budget is for shadow paths in production. In this test, we
    // allocate 100 recorders * 50 spans + 100 schedulers, which is more than
    // a real session would hold. Assert the delta is bounded.
    expect(deltaMB, `shadow memory delta ${deltaMB.toFixed(2)}MB exceeds 24MB budget`).toBeLessThan(24);
  });
});
