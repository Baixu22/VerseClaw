import { afterEach, describe, expect, it, vi } from 'vitest';
import { percentile, summarizeMixedRun, compareMixedRuns, resolveMixedToolchain, pinnedMixedEnvironment } from '../../scripts/lib/resource-mixed-measurement.mjs';

afterEach(() => vi.unstubAllEnvs());

const fixture = { id: 'test', tasks: 3, phases: ['read'], scrolls: 3, workers: [1], windows: [1], order: ['before', 'after', 'after', 'before'] };
const run = () => ({ driven_by: 'agent', status: 'pass', fixtureId: 'test', workers: 1, windows: 1, expected: { corpus: 'hash' },
  work: { events: [0, 1, 2].map(id => ({ id, kind: 'read', receipt: 'hash', status: 'success', receiptVerified: true, queuedMs: id, serviceMs: 10, totalMs: id + 10 })),
    active: 0, queued: 0, ownedChildren: 1, exitedChildren: 1, elapsedMs: 100, startedAt: 1000, endedAt: 1100, samples: [] },
  cleanup: { mainExited: true, launcherExited: true },
  renderer: { inputRetained: true, finalTextCorrect: true, terminalCompleted: true, inputStartedAt: 1010, samples: { inputLatencies: [1, 2, 3], inputEvents: [1, 2, 3].map(durationMs => ({ at: 1010, durationMs })), longTasks: [], longTaskEvents: [] }, scrolls: [1, 2, 3].map(top => ({ at: 1020, top, durationMs: 5 })) },
  processBefore: {}, processAfter: {},
});
describe('mixed workload independent recomputation', () => {
  it('replaces drive-relative overrides with captured canonical paths before a D-drive workload', () => {
    vi.stubEnv('ESBUILD_BINARY_PATH', '\\tools\\esbuild.exe');
    vi.stubEnv('ELECTRON_OVERRIDE_DIST_PATH', '\\tools\\electron');
    const env = { ...process.env, ...pinnedMixedEnvironment([{ role: 'esbuildBinary', path: 'C:/verified/esbuild.exe' }, { role: 'electron', path: 'C:/verified/electron/electron.exe' }]) };
    expect(env.ESBUILD_BINARY_PATH).toBe('C:/verified/esbuild.exe');
    expect(env.ELECTRON_OVERRIDE_DIST_PATH).toBe('C:/verified/electron');
  });
  it.each(['ESBUILD_BINARY_PATH', 'ELECTRON_OVERRIDE_DIST_PATH'])('rejects relative %s before a different working directory can select another binary', name => {
    vi.stubEnv(name, './relative-tool');
    expect(() => resolveMixedToolchain()).toThrow('must be absolute');
  });
  it('uses nearest-rank percentiles and recomputes throughput from verified completions', () => {
    expect(percentile([5, 1, 4, 2, 3], 0.95)).toBe(5);
    expect(summarizeMixedRun(run(), fixture)).toMatchObject({ throughputPerSecond: 30, totalMs: { p50: 11, p95: 12 } });
  });
  it('rejects missing receipts, duplicate work, residual children and empty input measurements', () => {
    const bad = run(); bad.work.events[1].id = 0;
    expect(() => summarizeMixedRun(bad, fixture)).toThrow();
    const residual = run(); residual.work.exitedChildren = 0;
    expect(() => summarizeMixedRun(residual, fixture)).toThrow();
    const empty = run(); empty.renderer.samples.inputLatencies = [];
    expect(() => summarizeMixedRun(empty, fixture)).toThrow();
  });
  it('requires exact ABBA groups and retains tail-latency regressions', () => {
    const rows = fixture.order.map(variant => ({ ...run(), variant }));
    rows[1].work.events[2].totalMs = 40; rows[2].work.events[2].totalMs = 40;
    expect(compareMixedRuns(rows, fixture)[0].p95Total.changePct).toBeGreaterThan(0);
    rows[0].variant = 'after'; expect(() => compareMixedRuns(rows, fixture)).toThrow();
  });
  it('excludes late input, scrolling and memory observations from workload percentiles', () => {
    const measured = run();
    measured.renderer.samples.inputEvents.push({ at: 1200, durationMs: 999 });
    measured.renderer.scrolls[2] = { at: 1200, durationMs: 999, top: 3 };
    const result = summarizeMixedRun(measured, fixture);
    expect(result.inputMs.p95).toBe(3); expect(result.scrollMs.p95).toBe(5);
    measured.work.events[1].receipt = 'wrong';
    expect(() => summarizeMixedRun(measured, fixture)).toThrow();
  });
  it('labels the process-tree CPU observation with its longer sampling interval', () => {
    const measured = { ...run(), processBefore: { tree: { sampledAt: 500 } }, processAfter: { tree: { sampledAt: 1500, treeCpuPercent: 25 } } };
    const result = summarizeMixedRun(measured, fixture);
    expect(result.resources.treeCpuObservation).toMatchObject({ cpuPercent: 25, from: 500, to: 1500, intervalMs: 1000 });
  });
});
