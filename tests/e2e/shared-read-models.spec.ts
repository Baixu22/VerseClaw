import { mkdtemp, writeFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function invoke(page: Page, module: string, action: string, payload?: unknown) {
  return page.evaluate(async data => {
    const result = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), ...data }) as { ok: boolean; data: Record<string, unknown>; error?: { message: string } };
    if (!result.ok) throw new Error(result.error?.message ?? 'Host request failed');
    return result.data;
  }, { module, action, payload });
}

test('two native windows share Git reads and retain independent lifetime', async ({ launchElectronApp, homeDir }, testInfo) => {
  test.setTimeout(180000);
  const root = await mkdtemp(join(homeDir, 'git-read-model-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, windowsHide: true });
  await writeFile(join(root, 'readme.txt'), 'initial');
  const app = await launchElectronApp({ skipSetup: true });
  let secondId: number | undefined;
  try {
    const main = await getStableWindow(app);
    const workspace = await invoke(main, 'workspaces', 'create', { name: 'Shared status', rootPath: root, agentId: 'main', activeSessionKey: 'agent:main:shared-status', permissionMode: 'readOnly' });
    expect(workspace.activeWorkspace).toBeTruthy();
    const windowReady = app.waitForEvent('window');
    secondId = await app.evaluate(async () => {
      const modules = Object.values(process.mainModule!.require('node:module')._cache) as Array<{ exports: { createHostReadObserverWindow?: () => Promise<Electron.BrowserWindow> } }>;
      const entry = modules.find(module => typeof module.exports?.createHostReadObserverWindow === 'function');
      if (!entry) throw new Error('Main observer factory unavailable');
      return (await entry.exports.createHostReadObserverWindow!()).id;
    });
    const second = await windowReady;
    await expect.poll(() => second.evaluate(() => Boolean(window.verseClaw?.hostInvoke))).toBe(true);
    await expect(invoke(second, 'git', 'stage', { paths: ['readme.txt'] })).rejects.toThrow('observer action is not authorized');
    let sourceClock = Date.now();
    const invalidateSource = async () => { sourceClock += 1000; await utimes(root, new Date(sourceClock), new Date(sourceClock)); };
    const measure = async () => {
      const state = await invoke(main, 'efficiency', 'getState');
      return { performance: state.performance as { counters: { recentSpawns: Array<{ command: string; at: number }> }; rssBytes: number },
        memory: await app.evaluate(() => process.memoryUsage()) };
    };
    const rows: Array<Record<string, unknown>> = [];
    for (const mode of ['uncached-control', 'shared', 'shared', 'uncached-control']) {
      await invalidateSource(); const before = await measure(); const at = Date.now(); const durations: number[] = [];
      for (let index = 0; index < 8; index++) {
        if (mode === 'uncached-control') await invalidateSource();
        const started = Date.now(); const result = await invoke(index % 2 ? second : main, 'git', 'status'); durations.push(Date.now() - started);
        expect(result.success).toBe(true); expect((result.status as { repoRoot: string }).repoRoot.toLowerCase()).toBe(root.toLowerCase());
      }
      const after = await measure(); const gitSpawns = after.performance.counters.recentSpawns.filter(row => row.command === 'git' && row.at >= at).length;
      expect(after.performance.counters.recentSpawns.filter(row => row.at >= at).length).toBeLessThan(64);
      rows.push({ mode, before, after, durations, gitSpawns, requests: 8, windows: 2 });
    }
    const controls = rows.filter(row => row.mode === 'uncached-control').map(row => row.gitSpawns as number);
    const shared = rows.filter(row => row.mode === 'shared').map(row => row.gitSpawns as number);
    expect(Math.max(...shared)).toBeLessThan(Math.min(...controls) / 2);
    await second.goto('about:blank');
    await app.evaluate(async ({ BrowserWindow, ipcMain }, id) => {
      const sender = BrowserWindow.fromId(id)!.webContents;
      const handler = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<{ ok: boolean }>> })._invokeHandlers.get('host:invoke')!;
      const result = await handler({ sender, senderFrame: sender.mainFrame }, { id: 'navigated-observer', module: 'git', action: 'status' });
      if (result.ok) throw new Error('Navigated observer retained authorization');
    }, secondId);
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)!.destroy(), secondId);
    await writeFile(join(root, 'after-close.txt'), 'remaining window');
    const status = await invoke(main, 'git', 'status');
    expect((status.status as { changes: Array<{ path: string }> }).changes.some(file => file.path === 'after-close.txt')).toBe(true);
    await writeFile(testInfo.outputPath('read-models.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex',
      workload: { requestsPerRound: 8, nativeWindows: 2, order: 'ABBA', source: 'one temporary native Git repository' },
      control: 'Temporary repository directory mtime changes before each control request; shared rounds keep the source stable. Product routes and Git commands remain real.',
      rows, remainingWindowReads: true, sourceMutationObserved: true,
      authorization: { mainCreatedObserver: true, mutationDenied: true, navigatedSourceDenied: true } }, null, 2));
  } finally {
    if (secondId !== undefined) await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), secondId).catch(() => {});
    await closeElectronApp(app);
  }
});
