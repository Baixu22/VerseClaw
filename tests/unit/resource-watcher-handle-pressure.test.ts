// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { WatcherHub } from '../../shared/resources/watcher-hub';

const roots: string[] = [];
function makeRoots() {
  const base = mkdtempSync(join(tmpdir(), 'tf0400-watch-'));
  roots.push(base);
  const a = join(base, 'a');
  const b = join(base, 'b');
  mkdirSync(a);
  mkdirSync(b);
  return { a, b };
}

function activeFsWatcherCount(): number {
  const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  return handles.filter((handle) => {
    const name = (handle as { constructor?: { name?: string } })?.constructor?.name;
    return name === 'FSWatcher' || name === 'StatWatcher';
  }).length;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('resource watcher handle pressure', () => {
  it('reduces real fs watcher handles by at least 60% across shared roots', async () => {
    const { a, b } = makeRoots();
    const baseHandles = activeFsWatcherCount();
    const legacy = [
      watch(a, () => {}),
      watch(a, () => {}),
      watch(a, () => {}),
      watch(b, () => {}),
      watch(b, () => {}),
    ];
    const baselineLegacyHandles = activeFsWatcherCount() - baseHandles;
    for (const watcher of legacy) watcher.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const baseAfterLegacy = activeFsWatcherCount();

    const hub = new WatcherHub();
    const handles = [
      hub.subscribeDirectory(a, () => {}),
      hub.subscribeDirectory(a, () => {}),
      hub.subscribeDirectory(a, () => {}),
      hub.subscribeDirectory(b, () => {}),
      hub.subscribeDirectory(b, () => {}),
    ];
    const after = activeFsWatcherCount() - baseAfterLegacy;
    const diagnostics = hub.getDiagnostics();
    const report = {
      schema: 'clawx.tf0400.watcher-handle-pressure/v1',
      driven_by: 'agent',
      actor: 'codex-tf0400',
      generatedAt: new Date().toISOString(),
      workload: { roots: 2, subscriptions: 5 },
      legacyHandles: baselineLegacyHandles,
      hubHandles: after,
      reductionRatio: baselineLegacyHandles === 0 ? null : 1 - after / baselineLegacyHandles,
      diagnostics,
    };
    const output = process.env.RESOURCE_WATCHER_PRESSURE_OUT;
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    for (const handle of handles) handle.close();
    expect(baselineLegacyHandles).toBeGreaterThanOrEqual(2);
    expect(after).toBeLessThanOrEqual(Math.floor(baselineLegacyHandles * 0.4));
    expect(diagnostics.directoryWatchers).toBe(2);
  });
});