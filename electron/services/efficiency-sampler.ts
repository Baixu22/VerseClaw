/**
 * Runtime Efficiency Sampler
 *
 * P0 for `windows-runtime-efficiency-observability-v1`.
 *
 * Records real, measured process CPU and memory values on a fixed cadence and
 * keeps a bounded rolling window. Everything here is a *measurement* surface:
 * it must never estimate, interpolate, or synthesize values, because the whole
 * point is to make later rendering/concurrency optimizations provable against
 * a before/after artifact pair.
 *
 * Design constraints:
 * - No new dependency. Uses Node builtins (`os`, `process`) only, so the
 *   sampler works identically on Windows, macOS and Linux.
 * - Disabled or stopped sampling performs zero interval work and leaves no
 *   pending handle, so enabling the feature can never become a tax.
 * - CPU percent is derived from real cumulative CPU time deltas against a real
 *   wall-clock delta. The first sample of a window is a baseline and is not
 *   reported as a percentage.
 */

import { cpus, freemem, totalmem } from 'node:os';
import type { TimerAligner } from '../../shared/resources';
import { logger } from '../utils/logger';

export type EfficiencySampleSource = 'os-cpu' | 'process-memory';

export interface EfficiencySample {
  /** Epoch milliseconds when the sample was taken. */
  at: number;
  /** Process CPU usage as a percentage of one core, 0..(cores*100). */
  cpuPercent: number;
  /** Resident set size of the main process in bytes. */
  rssBytes: number;
  /** Heap used by the main process in bytes. */
  heapUsedBytes: number;
  /** System-wide available memory in bytes, for headroom context. */
  systemFreeBytes: number;
  /** System-wide total memory in bytes. */
  systemTotalBytes: number;
  /** Number of logical cores observed at sample time. */
  cpuCount: number;
  /** True when the app is currently shedding background load. */
  shed: boolean;
  source: EfficiencySampleSource;
}

export interface EfficiencySummary {
  sampleCount: number;
  /** Wall-clock coverage of the retained window, in milliseconds. */
  coverageMs: number;
  latest: EfficiencySample | null;
  avgCpuPercent: number;
  peakCpuPercent: number;
  peakRssBytes: number;
  /** Count of samples taken while load shedding was active. */
  shedSampleCount: number;
}

export interface EfficiencySamplerOptions {
  /** Cadence in milliseconds. Must be >= 250 to stay cheap. */
  intervalMs?: number;
  /** Hard cap on retained samples. Older samples are evicted first. */
  maxSamples?: number;
  /** Injected clock for deterministic tests. */
  now?: () => number;
  /** Injected CPU-time reader for deterministic tests. */
  readCpuTime?: () => { user: number; system: number };
  /** Injected memory reader for deterministic tests. */
  readMemory?: () => { rss: number; heapUsed: number };
  /** Injected system-memory reader for deterministic tests. */
  readSystemMemory?: () => { free: number; total: number };
  /** Current shed state, injected so the sampler stays policy-free. */
  isShed?: () => boolean;
  /** Optional shared timer aligner; production wires the process singleton. */
  scheduler?: Pick<TimerAligner, 'register'>;
}

const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 250;
const DEFAULT_MAX_SAMPLES = 720; // 1h at 5s cadence

export const EFFICIENCY_DEFAULTS = {
  intervalMs: DEFAULT_INTERVAL_MS,
  maxSamples: DEFAULT_MAX_SAMPLES,
} as const;

function defaultReadCpuTime(): { user: number; system: number } {
  const usage = process.cpuUsage();
  return { user: usage.user, system: usage.system };
}

function defaultReadMemory(): { rss: number; heapUsed: number } {
  const usage = process.memoryUsage();
  return { rss: usage.rss, heapUsed: usage.heapUsed };
}

function defaultReadSystemMemory(): { free: number; total: number } {
  return { free: freemem(), total: totalmem() };
}

/**
 * Bounded, injectable efficiency sampler.
 *
 * Kept free of Electron imports so it can be unit tested in a plain Node
 * environment without booting the app.
 */
export class EfficiencySampler {
  private readonly intervalMs: number;
  private readonly maxSamples: number;
  private readonly now: () => number;
  private readonly readCpuTime: () => { user: number; system: number };
  private readonly readMemory: () => { rss: number; heapUsed: number };
  private readonly readSystemMemory: () => { free: number; total: number };
  private readonly isShed: () => boolean;
  private readonly optionsScheduler: Pick<TimerAligner, 'register'> | undefined;

  private samples: EfficiencySample[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private unregister: (() => void) | null = null;
  private lastCpuTime: { user: number; system: number } | null = null;
  private lastCpuAt: number | null = null;
  private lastSampleAt: number | null = null;
  private lastSample: EfficiencySample | null = null;
  private shedSampleCount = 0;

  constructor(options: EfficiencySamplerOptions = {}) {
    this.intervalMs = Math.max(MIN_INTERVAL_MS, Math.floor(options.intervalMs ?? DEFAULT_INTERVAL_MS));
    this.maxSamples = Math.max(1, Math.floor(options.maxSamples ?? DEFAULT_MAX_SAMPLES));
    this.now = options.now ?? (() => Date.now());
    this.readCpuTime = options.readCpuTime ?? defaultReadCpuTime;
    this.readMemory = options.readMemory ?? defaultReadMemory;
    this.readSystemMemory = options.readSystemMemory ?? defaultReadSystemMemory;
    this.isShed = options.isShed ?? (() => false);
    this.optionsScheduler = options.scheduler;
  }

  /** Start periodic sampling. Idempotent: a second call is a no-op. */
  start(): void {
    if (this.timer || this.unregister) return;
    // Take a baseline immediately so the first interval tick can report a real
    // CPU percentage instead of waiting a full interval.
    this.lastCpuTime = this.readCpuTime();
    this.lastCpuAt = this.now();
    if (this.optionsScheduler) {
      this.unregister = this.optionsScheduler.register({
        id: 'efficiency-sampler',
        intervalMs: this.intervalMs,
        priority: 'background',
        run: () => { this.capture(); },
      });
    } else {
      this.timer = setInterval(() => this.capture(), this.intervalMs);
      // Never hold the process open just for telemetry.
      this.timer.unref?.();
    }
    logger.info('[efficiency-sampler] started', {
      intervalMs: this.intervalMs,
      maxSamples: this.maxSamples,
    });
  }

  /** Stop sampling and release the timer. Safe to call when not started. */
  stop(): void {
    if (this.unregister) {
      this.unregister();
      this.unregister = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[efficiency-sampler] stopped');
  }

  get running(): boolean {
    return this.timer !== null || this.unregister !== null;
  }

  /**
   * Take one sample immediately. Public so tests and manual probes do not have
   * to wait for a tick.
   */
  capture(): EfficiencySample | null {
    const at = this.now();
    const cpuTime = this.readCpuTime();

    let cpuPercent = 0;
    if (this.lastCpuTime && this.lastCpuAt !== null) {
      const cpuDeltaUs = (cpuTime.user - this.lastCpuTime.user) + (cpuTime.system - this.lastCpuTime.system);
      const wallDeltaMs = at - this.lastCpuAt;
      if (wallDeltaMs > 0 && cpuDeltaUs > 0) {
        // cpuUsage() reports microseconds; one core at 100% == 100_000us per second.
        cpuPercent = (cpuDeltaUs / 1000 / wallDeltaMs) * 100;
        if (!Number.isFinite(cpuPercent) || cpuPercent < 0) cpuPercent = 0;
      }
    }
    this.lastCpuTime = cpuTime;
    this.lastCpuAt = at;

    const memory = this.readMemory();
    const system = this.readSystemMemory();
    const shed = this.isShed();

    const sample: EfficiencySample = {
      at,
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      systemFreeBytes: system.free,
      systemTotalBytes: system.total,
      cpuCount: Math.max(1, cpus().length),
      shed,
      source: 'os-cpu',
    };

    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
    if (shed) this.shedSampleCount += 1;
    this.lastSampleAt = at;
    this.lastSample = sample;
    return sample;
  }

  /** Bounded rolling window, oldest first, including the latest capture before the next timer tick. */
  getSamples(): EfficiencySample[] {
    return this.lastSample && this.samples[this.samples.length - 1] !== this.lastSample
      ? [...this.samples, this.lastSample]
      : this.samples.slice();
  }

  getSummary(): EfficiencySummary {
    const count = this.samples.length;
    if (count === 0) {
      return {
        sampleCount: 0,
        coverageMs: 0,
        latest: null,
        avgCpuPercent: 0,
        peakCpuPercent: 0,
        peakRssBytes: 0,
        shedSampleCount: 0,
      };
    }
    const first = this.samples[0];
    const latest = this.samples[count - 1];
    let cpuSum = 0;
    let peakCpu = 0;
    let peakRss = 0;
    for (const sample of this.samples) {
      cpuSum += sample.cpuPercent;
      if (sample.cpuPercent > peakCpu) peakCpu = sample.cpuPercent;
      if (sample.rssBytes > peakRss) peakRss = sample.rssBytes;
    }
    return {
      sampleCount: count,
      coverageMs: Math.max(0, latest.at - first.at),
      latest,
      avgCpuPercent: Math.round((cpuSum / count) * 100) / 100,
      peakCpuPercent: Math.round(peakCpu * 100) / 100,
      peakRssBytes: peakRss,
      shedSampleCount: this.shedSampleCount,
    };
  }

  /** Drop retained samples without touching the timer. */
  reset(): void {
    this.samples = [];
    this.shedSampleCount = 0;
    this.lastSampleAt = null;
    this.lastSample = null;
    this.lastCpuTime = null;
    this.lastCpuAt = null;
  }

  get lastSampleEpochMs(): number | null {
    return this.lastSampleAt;
  }
}