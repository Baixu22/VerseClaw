// @vitest-environment node
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { WatcherHub } from '../../shared/resources/watcher-hub';
import { BoundedCache } from '../../shared/resources/bounded-cache';

it('releases50 native watcher lifecycles and bounded cached payloads with readback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resource-repeat-'));
  const hub = new WatcherHub();
  const cache = new BoundedCache<string, Buffer>({ maxEntries: 4, maxBytes: 32768, ttlMs: 60_000, sizeOf: value => value.byteLength });
  const rows: unknown[] = [];
  let failure: string | null = null;
  const reportPath = process.env.RESOURCE_SOAK_REPORT_DIR ? join(process.env.RESOURCE_SOAK_REPORT_DIR, `repeated-observers-${Date.now()}.json`) : null;
  const handles = () => (process as unknown as { _getActiveHandles(): object[] })._getActiveHandles().filter(handle => /^(FSWatcher|StatWatcher)$/.test(handle.constructor.name)).length;
  const initialHandles = handles();
  try {
    for (let index = 0; index < 50; index++) {
      const events = new Set<string | null>();
      const first = hub.subscribeDirectory(root, (_type, name) => events.add(name), undefined, { recursive: true });
      const second = hub.subscribeDirectory(root, (_type, name) => events.add(name), undefined, { recursive: true });
      try {
        expect(hub.getDiagnostics()).toMatchObject({ directoryWatchers: 1, subscriptions: 2 });
        const name = `receipt-${index}.txt`; await writeFile(join(root, name), String(index));
        await expect.poll(() => events.has(name), { timeout: 5000 }).toBe(true);
        first.close(); expect(hub.getDiagnostics().subscriptions).toBe(1);
        const secondName = `second-${index}.txt`; await writeFile(join(root, secondName), 'second');
        await expect.poll(() => events.has(secondName), { timeout: 5000 }).toBe(true);
        for (let item = 0; item < 8; item++) cache.set(`${index}:${item}`, Buffer.alloc(8192, item));
        expect(cache.bytes).toBeLessThanOrEqual(32768); expect(cache.get(`${index}:7`)?.at(0)).toBe(7);
        const peakBytes = cache.bytes; cache.clear();
        rows.push({ index, events: [...events], peakBytes, retainedBytes: cache.bytes, cacheEntries: cache.size });
      } finally { first.close(); second.close(); cache.clear(); }
      expect(hub.getDiagnostics()).toMatchObject({ directoryWatchers: 0, fileWatchers: 0, rootRecoveryMonitors: 0, subscriptions: 0 });
    }
    await expect.poll(handles, { timeout: 5000 }).toBeLessThanOrEqual(initialHandles);
  } catch (error) { failure = String(error); throw error; }
  finally {
    if (reportPath) writeFileSync(reportPath, JSON.stringify({ driven_by: 'agent', actor: 'codex', status: failure ? 'fail' : 'pass', failure, fixture: root, cycles: rows.length, rows, initialHandles, finalHandles: handles(), finalHub: hub.getDiagnostics(), finalCache: { bytes: cache.bytes, entries: cache.size }, scope: 'Real Node WatcherHub and BoundedCache owners; independent of Electron userData.' }, null, 2));
    hub.resetForTest(); cache.clear();
    if (!failure) await rm(root, { recursive: true, force: true });
  }
}, 120_000);
