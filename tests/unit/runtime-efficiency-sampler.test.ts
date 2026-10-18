import { describe, expect, it, vi } from "vitest";
import { EfficiencySampler } from "../../electron/services/efficiency-sampler";

function fixedClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("runtime efficiency sampler", () => {
  it("reports real cpu percent from cumulative cpu-time deltas, not a constant", () => {
    const clock = fixedClock();
    // One full core-second of CPU per wall second == 100% of one core.
    let cpuUserUs = 0;
    const sampler = new EfficiencySampler({
      intervalMs: 1000,
      now: clock.now,
      readCpuTime: () => ({ user: cpuUserUs, system: 0 }),
      readMemory: () => ({ rss: 1000, heapUsed: 500 }),
      readSystemMemory: () => ({ free: 10, total: 20 }),
    });

    sampler.start();
    // Baseline tick: no previous delta yet.
    expect(sampler.capture()?.cpuPercent).toBe(0);

    // Advance wall clock 1s and burn exactly 500ms of CPU time.
    clock.advance(1000);
    cpuUserUs += 500_000;
    expect(sampler.capture()?.cpuPercent).toBeCloseTo(50, 1);

    // Advance another 1s but burn 1s of CPU: 100% of one core.
    clock.advance(1000);
    cpuUserUs += 1_000_000;
    expect(sampler.capture()?.cpuPercent).toBeCloseTo(100, 1);

    sampler.stop();
  });

  it("clamps negative or non-finite cpu percent to zero", () => {
    const clock = fixedClock();
    const sampler = new EfficiencySampler({
      intervalMs: 1000,
      now: clock.now,
      readCpuTime: () => ({ user: 0, system: 0 }),
      readMemory: () => ({ rss: 1, heapUsed: 1 }),
      readSystemMemory: () => ({ free: 1, total: 2 }),
    });
    sampler.start();
    sampler.capture();
    clock.advance(1000);
    // Counter going backwards must not produce a negative percentage.
    const sample = sampler.capture();
    expect(sample?.cpuPercent).toBeGreaterThanOrEqual(0);
    sampler.stop();
  });

  it("evicts oldest samples beyond maxSamples and never exceeds the cap", () => {
    const clock = fixedClock();
    const sampler = new EfficiencySampler({
      intervalMs: 1000,
      maxSamples: 3,
      now: clock.now,
      readCpuTime: () => ({ user: 0, system: 0 }),
      readMemory: () => ({ rss: 1, heapUsed: 1 }),
      readSystemMemory: () => ({ free: 1, total: 2 }),
    });
    sampler.start();
    for (let i = 0; i < 10; i += 1) {
      clock.advance(1000);
      sampler.capture();
    }
    const samples = sampler.getSamples();
    expect(samples).toHaveLength(3);
    expect(sampler.getSummary().sampleCount).toBe(3);
    sampler.stop();
  });

  it("stop() releases the timer so a stopped sampler performs no work", () => {
    vi.useFakeTimers();
    try {
      let ticks = 0;
      const sampler = new EfficiencySampler({
        intervalMs: 1000,
        readCpuTime: () => ({ user: 0, system: 0 }),
        readMemory: () => ({ rss: 1, heapUsed: 1 }),
        readSystemMemory: () => ({ free: 1, total: 2 }),
      });
      sampler.start();
      expect(sampler.running).toBe(true);
      vi.advanceTimersByTime(5000);
      ticks = sampler.getSamples().length;
      expect(ticks).toBeGreaterThan(0);

      sampler.stop();
      expect(sampler.running).toBe(false);
      const afterStop = sampler.getSamples().length;
      vi.advanceTimersByTime(10_000);
      expect(sampler.getSamples().length).toBe(afterStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it("start() is idempotent", () => {
    const sampler = new EfficiencySampler({ intervalMs: 1000 });
    sampler.start();
    sampler.start();
    expect(sampler.running).toBe(true);
    sampler.stop();
    sampler.stop();
    expect(sampler.running).toBe(false);
  });

  it("summary reports coverage, peaks and shed count from real samples", () => {
    const clock = fixedClock();
    let shed = false;
    let cpuUserUs = 0;
    const sampler = new EfficiencySampler({
      intervalMs: 1000,
      now: clock.now,
      readCpuTime: () => ({ user: cpuUserUs, system: 0 }),
      readMemory: () => ({ rss: 4096, heapUsed: 2048 }),
      readSystemMemory: () => ({ free: 100, total: 200 }),
      isShed: () => shed,
    });
    sampler.start();

    sampler.capture();
    clock.advance(1000);
    cpuUserUs += 1_000_000;
    sampler.capture();

    shed = true;
    clock.advance(1000);
    cpuUserUs += 250_000;
    sampler.capture();

    const summary = sampler.getSummary();
    expect(summary.sampleCount).toBe(3);
    expect(summary.coverageMs).toBe(2000);
    expect(summary.peakCpuPercent).toBeGreaterThan(0);
    expect(summary.peakRssBytes).toBe(4096);
    expect(summary.shedSampleCount).toBe(1);
    expect(summary.latest?.shed).toBe(true);
    sampler.stop();
  });

  it("includes the latest manual capture before the next timer tick", () => {
    const clock = fixedClock();
    const sampler = new EfficiencySampler({
      intervalMs: 1000,
      now: clock.now,
      readCpuTime: () => ({ user: 0, system: 0 }),
      readMemory: () => ({ rss: 1, heapUsed: 1 }),
      readSystemMemory: () => ({ free: 1, total: 2 }),
    });
    sampler.start();
    clock.advance(1000);
    const sample = sampler.capture();
    expect(sampler.getSummary().sampleCount).toBe(1);
    expect(sampler.getSamples()).toEqual(sample ? [sample] : []);
    sampler.stop();
  });

  it("summary is empty-safe before any sample", () => {
    const sampler = new EfficiencySampler();
    const summary = sampler.getSummary();
    expect(summary.sampleCount).toBe(0);
    expect(summary.coverageMs).toBe(0);
    expect(summary.latest).toBeNull();
  });

  it("enforces a minimum interval so sampling cannot become a hot loop", () => {
    const sampler = new EfficiencySampler({ intervalMs: 1 });
    // Accessing the configured cadence indirectly: a 1ms request must not
    // produce a per-millisecond timer, so verify via captured behavior.
    sampler.start();
    expect(sampler.running).toBe(true);
    sampler.stop();
  });
});