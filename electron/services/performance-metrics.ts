import { performance } from 'node:perf_hooks';

export type SpawnMethod =
  | 'spawn'
  | 'exec'
  | 'execFile'
  | 'fork'
  | 'spawnSync'
  | 'execSync'
  | 'execFileSync';

export type PerformanceMark = {
  name: string;
  at: number;
  fromStartMs: number;
};

export type SpawnSample = {
  method: SpawnMethod;
  at: number;
  fromStartMs: number;
  command: string | null;
};

export type PerformanceCounterSnapshot = {
  spawnCount: number;
  spawnByMethod: Record<SpawnMethod, number>;
  recentSpawns: SpawnSample[];
  activeIntervals: number;
  activeWatchers: number;
  unavailable: string[];
};

export type MainPerformanceSnapshot = {
  startedAt: number;
  elapsedMs: number;
  marks: PerformanceMark[];
  counters: PerformanceCounterSnapshot;
  rssBytes: number;
};

const STARTED_AT = Date.now();
const STARTED_PERF = performance.now();
const MAX_RECENT_SPAWNS = 64;
const SPAWN_METHODS: SpawnMethod[] = [
  'spawn',
  'exec',
  'execFile',
  'fork',
  'spawnSync',
  'execSync',
  'execFileSync',
];

const marks = new Map<string, PerformanceMark>();
const recentSpawns: SpawnSample[] = [];
const activeIntervals = new Set<ReturnType<typeof setInterval>>();
const unavailable: string[] = [];
let spawnCount = 0;
let activeWatcherCount = 0;
let installed = false;

const spawnByMethod: Record<SpawnMethod, number> = {
  spawn: 0,
  exec: 0,
  execFile: 0,
  fork: 0,
  spawnSync: 0,
  execSync: 0,
  execFileSync: 0,
};

function nowMark(name: string): PerformanceMark {
  return {
    name,
    at: Date.now(),
    fromStartMs: performance.now() - STARTED_PERF,
  };
}

export function markPerformance(name: string): PerformanceMark {
  const mark = nowMark(name);
  marks.set(name, mark);
  return mark;
}

export function recordChildProcessSpawn(method: SpawnMethod, args: unknown[]): void {
  spawnCount += 1;
  spawnByMethod[method] += 1;
  const first = args[0];
  recentSpawns.push({
    method,
    at: Date.now(),
    fromStartMs: performance.now() - STARTED_PERF,
    command: typeof first === 'string' ? first : null,
  });
  if (recentSpawns.length > MAX_RECENT_SPAWNS) {
    recentSpawns.splice(0, recentSpawns.length - MAX_RECENT_SPAWNS);
  }
}

function patchIntervals(): void {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  try {
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      const timer = originalSetInterval(...args);
      activeIntervals.add(timer);
      return timer;
    }) as typeof setInterval;
    globalThis.clearInterval = ((timer: Parameters<typeof clearInterval>[0]) => {
      activeIntervals.delete(timer as ReturnType<typeof setInterval>);
      return originalClearInterval(timer);
    }) as typeof clearInterval;
  } catch {
    unavailable.push('setInterval');
  }
}

export function installPerformanceInstrumentation(): void {
  if (installed) return;
  installed = true;
  patchIntervals();
}

export function getMainPerformanceSnapshot(): MainPerformanceSnapshot {
  return {
    startedAt: STARTED_AT,
    elapsedMs: performance.now() - STARTED_PERF,
    marks: [...marks.values()],
    counters: {
      spawnCount,
      spawnByMethod: { ...spawnByMethod },
      recentSpawns: [...recentSpawns],
      activeIntervals: activeIntervals.size,
      activeWatchers: activeWatcherCount,
      unavailable: [...unavailable],
    },
    rssBytes: process.memoryUsage().rss,
  };
}

export function resetPerformanceInstrumentationForTest(): void {
  marks.clear();
  recentSpawns.length = 0;
  activeIntervals.clear();
  unavailable.length = 0;
  spawnCount = 0;
  activeWatcherCount = 0;
  for (const method of SPAWN_METHODS) spawnByMethod[method] = 0;
}

installPerformanceInstrumentation();
