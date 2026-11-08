// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { watch, watchFile, unwatchFile, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WatcherHub } from '../../shared/resources/watcher-hub';

const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
const count = () => ((process as unknown as { _getActiveHandles: () => object[] })._getActiveHandles())
  .filter(handle => /^(FSWatcher|StatWatcher)$/.test(handle.constructor.name)).length;
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe('native shared observation', () => {
  it('retains independent file listeners after the hub releases its last reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shared-file-')); roots.push(root); const file = join(root, 'a.txt'); await writeFile(file, 'a');
    const external = vi.fn(); watchFile(file, { interval: 50 }, external);
    const hub = new WatcherHub(); const handle = hub.subscribeFile(file, vi.fn(), { intervalMs: 50 }); handle.close();
    try { await writeFile(file, 'changed'); await vi.waitFor(() => expect(external).toHaveBeenCalled(), { timeout: 3000 }); }
    finally { unwatchFile(file, external); hub.resetForTest(); }
  });
  it('recovers a recursive directory subscription after native deletion and recreation', async () => {
    const base = await mkdtemp(join(tmpdir(), 'shared-recreate-')); roots.push(base); const root = join(base, 'watched'); await mkdir(root);
    const hub = new WatcherHub(); const events: Array<string | null> = [];
    const handle = hub.subscribeDirectory(root, (_type, name) => events.push(name), () => {}, { recursive: true });
    try {
      await writeFile(join(root, 'first.txt'), 'first'); await vi.waitFor(() => expect(events).toContain('first.txt'), { timeout: 3000 });
      await rm(root, { recursive: true }); await mkdir(root); await writeFile(join(root, 'recreated.txt'), 'new');
      await vi.waitFor(() => expect(events).toContain(null), { timeout: 4000 });
      await writeFile(join(root, 'after.txt'), 'after'); await vi.waitFor(() => expect(events).toContain('after.txt'), { timeout: 3000 });
    } finally { handle.close(); }
    expect(hub.getDiagnostics().subscriptions).toBe(0);
  }, 15000);
  it('records ABBA handle and memory samples for equal overlapping subscription work', async () => {
    const base = await mkdtemp(join(tmpdir(), 'shared-pressure-')); roots.push(base); const child = join(base, 'child'); await mkdir(child);
    const samples: Array<Record<string, unknown>> = [];
    for (const mode of ['separate', 'shared', 'shared', 'separate']) {
      await settle(); const baseline = count(); const memoryBefore = process.memoryUsage(); const usageBefore = process.resourceUsage();
      const hub = new WatcherHub(); const paths = Array.from({ length: 8 }, (_, i) => i < 4 ? base : child);
      const calls = paths.map(() => 0);
      const handles = paths.map((path, i) => mode === 'shared'
        ? hub.subscribeDirectory(path, () => { calls[i]++; }, undefined, { recursive: true })
        : watch(path, { recursive: true }, () => { calls[i]++; }));
      const handlesDuring = count() - baseline;
      try {
        for (let i = 0; i < 20; i++) await writeFile(join(child, `sample-${i}.txt`), mode);
        await vi.waitFor(() => expect(calls.every(value => value > 0)).toBe(true), { timeout: 5000 });
        const memoryDuring = process.memoryUsage();
        const diagnostics = hub.getDiagnostics();
        samples.push({ mode, handlesDuring, rootRecoveryMonitors: diagnostics.rootRecoveryMonitors,
          handleCensusScope: 'Node _getActiveHandles reports referenced FSWatcher/StatWatcher handles; non-persistent recovery monitors are listed separately.',
          memoryBefore, memoryDuring, usageBefore, usageAfter: process.resourceUsage(), callbacks: calls, workload: { subscriptions: 8, roots: 2, writes: 20 }, diagnostics });
      } finally { handles.forEach(handle => handle.close()); }
      await settle(); expect(count()).toBeLessThanOrEqual(baseline); expect(hub.getDiagnostics().rootRecoveryMonitors).toBe(0);
    }
    const before = samples.filter(row => row.mode === 'separate').map(row => row.handlesDuring as number);
    const after = samples.filter(row => row.mode === 'shared').map(row => row.handlesDuring as number);
    expect(Math.max(...after)).toBeLessThanOrEqual(Math.min(...before) / 2);
    if (process.env.SHARED_WATCHERS_REPORT_DIR) writeFileSync(join(process.env.SHARED_WATCHERS_REPORT_DIR, 'watcher-pressure.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex', order: 'ABBA', samples, finalNativeWatchers: count() }, null, 2));
  }, 30000);
});
