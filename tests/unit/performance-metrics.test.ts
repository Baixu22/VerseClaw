import { beforeEach, describe, expect, it } from 'vitest';
import {
  getMainPerformanceSnapshot,
  markPerformance,
  resetPerformanceInstrumentationForTest,
} from '@electron/services/performance-metrics';
import { execFile } from '@electron/utils/counted-child-process';
import {
  getRendererPerformanceSnapshot,
  markRendererPerformance,
  recordRendererIpcSample,
  resetRendererPerformanceForTest,
} from '@/lib/performance-metrics';

describe('main performance counters', () => {
  beforeEach(() => {
    resetPerformanceInstrumentationForTest();
  });

  it('records startup marks', () => {
    markPerformance('app-ready');
    const snapshot = getMainPerformanceSnapshot();
    expect(snapshot.marks.some((mark) => mark.name === 'app-ready')).toBe(true);
    expect(snapshot.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('counts real child-process invocations without changing their result', async () => {
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, ['-e', '0'], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    const snapshot = getMainPerformanceSnapshot();
    expect(snapshot.counters.spawnCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.counters.spawnByMethod.execFile).toBeGreaterThanOrEqual(1);
    expect(snapshot.counters.recentSpawns.at(-1)?.method).toBe('execFile');
  });

  it('tracks live intervals through the patched global timer API', () => {
    const before = getMainPerformanceSnapshot().counters.activeIntervals;
    const timer = setInterval(() => {}, 1_000);
    expect(getMainPerformanceSnapshot().counters.activeIntervals).toBe(before + 1);
    clearInterval(timer);
    expect(getMainPerformanceSnapshot().counters.activeIntervals).toBe(before);
  });
});

describe('renderer performance metrics', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRendererPerformanceForTest();
  });

  it('keeps bounded IPC samples and computes p50/p95', () => {
    recordRendererIpcSample({ module: 'git', action: 'status', durationMs: 10, ok: true });
    recordRendererIpcSample({ module: 'git', action: 'status', durationMs: 40, ok: true });
    recordRendererIpcSample({ module: 'system', action: 'info', durationMs: 100, ok: false });
    const snapshot = getRendererPerformanceSnapshot();
    expect(snapshot.ipc.count).toBe(3);
    expect(snapshot.ipc.p50Ms).toBe(40);
    expect(snapshot.ipc.p95Ms).toBe(100);
    expect(snapshot.ipc.recent.at(-1)?.ok).toBe(false);
  });

  it('persists marks to the local JSON ring buffer', () => {
    markRendererPerformance('renderer-first-paint');
    const raw = localStorage.getItem('clawx.performance.metrics.v1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      schema: 'clawx.renderer-performance/v1',
      marks: [{ name: 'renderer-first-paint' }],
    });
  });
});
