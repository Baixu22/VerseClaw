type RendererMark = {
  name: string;
  at: number;
  fromStartMs: number;
};

type LongTaskSample = {
  startTime: number;
  durationMs: number;
};

type InputLatencySample = {
  kind: 'click' | 'keydown';
  at: number;
  latencyMs: number;
};

type IpcSample = {
  module: string;
  action: string;
  at: number;
  durationMs: number;
  ok: boolean;
};

export type RendererPerformanceSnapshot = {
  schema: 'clawx.renderer-performance/v1';
  startedAt: number;
  generatedAt: number;
  marks: RendererMark[];
  longTasks: LongTaskSample[];
  inputLatency: InputLatencySample[];
  ipc: {
    count: number;
    p50Ms: number | null;
    p95Ms: number | null;
    recent: IpcSample[];
  };
  unavailable: string[];
};

const STORAGE_KEY = 'clawx.performance.metrics.v1';
const MAX_SAMPLES = 256;
const marks = new Map<string, RendererMark>();
const longTasks: LongTaskSample[] = [];
const inputLatency: InputLatencySample[] = [];
const ipcSamples: IpcSample[] = [];
const unavailable: string[] = [];
const startedAt = Date.now();
const startedPerf = typeof performance !== 'undefined' ? performance.now() : 0;
let initialized = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function trim<T>(values: T[]): void {
  if (values.length > MAX_SAMPLES) values.splice(0, values.length - MAX_SAMPLES);
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? null;
}

export function getRendererPerformanceSnapshot(): RendererPerformanceSnapshot {
  const durations = ipcSamples.map((sample) => sample.durationMs);
  return {
    schema: 'clawx.renderer-performance/v1',
    startedAt,
    generatedAt: Date.now(),
    marks: [...marks.values()],
    longTasks: [...longTasks],
    inputLatency: [...inputLatency],
    ipc: {
      count: ipcSamples.length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      recent: [...ipcSamples],
    },
    unavailable: [...unavailable],
  };
}

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getRendererPerformanceSnapshot()));
  } catch {
    // Storage can be unavailable in hardened renderer contexts; metrics stay in memory.
  }
}

function schedulePersist(): void {
  if (typeof setTimeout !== 'function') return;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    persist();
  }, 250);
}

export function markRendererPerformance(name: string): RendererMark {
  const mark = {
    name,
    at: Date.now(),
    fromStartMs: (typeof performance !== 'undefined' ? performance.now() : 0) - startedPerf,
  };
  marks.set(name, mark);
  persist();
  return mark;
}

export function recordRendererIpcSample(input: {
  module: string;
  action: string;
  durationMs: number;
  ok: boolean;
}): void {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) return;
  ipcSamples.push({
    module: input.module,
    action: input.action,
    at: Date.now(),
    durationMs: input.durationMs,
    ok: input.ok,
  });
  trim(ipcSamples);
  schedulePersist();
}

function recordInput(kind: 'click' | 'keydown', event: Event): void {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  const timestamp = typeof event.timeStamp === 'number' && event.timeStamp <= now ? event.timeStamp : now;
  inputLatency.push({
    kind,
    at: Date.now(),
    latencyMs: Math.max(0, now - timestamp),
  });
  trim(inputLatency);
  schedulePersist();
}

export function initRendererPerformanceMetrics(): void {
  if (initialized) return;
  initialized = true;
  markRendererPerformance('renderer-start');

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 50) continue;
          longTasks.push({ startTime: entry.startTime, durationMs: entry.duration });
        }
        trim(longTasks);
        schedulePersist();
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      unavailable.push('longtask');
    }
  } else {
    unavailable.push('longtask');
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', (event) => recordInput('click', event), { capture: true, passive: true });
    document.addEventListener('keydown', (event) => recordInput('keydown', event), { capture: true, passive: true });
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => markRendererPerformance('renderer-first-paint'));
    });
  } else {
    unavailable.push('renderer-first-paint');
  }

  (window as unknown as { __CLAWX_PERF_SNAPSHOT__?: () => RendererPerformanceSnapshot }).__CLAWX_PERF_SNAPSHOT__ = getRendererPerformanceSnapshot;
  persist();
}

export function resetRendererPerformanceForTest(): void {
  marks.clear();
  longTasks.length = 0;
  inputLatency.length = 0;
  ipcSamples.length = 0;
  unavailable.length = 0;
  initialized = false;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}
