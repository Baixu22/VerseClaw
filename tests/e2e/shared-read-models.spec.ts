import { mkdtemp, writeFile } from 'node:fs/promises';
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
    secondId = await app.evaluate(async ({ BrowserWindow }, preload) => {
      const first = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:'))!;
      const second = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: {
        preload, contextIsolation: true, nodeIntegration: false, sandbox: false,
      } });
      await second.loadURL(first.webContents.getURL()); return second.id;
    }, join(process.cwd(), 'dist-electron/preload/index.js'));
    const second = await windowReady;
    await expect.poll(() => second.evaluate(() => Boolean(window.verseClaw?.hostInvoke))).toBe(true);
    const reset = () => app.evaluate(() => {
      const modules = Object.values(process.mainModule!.require('node:module')._cache) as Array<{ exports: { clearGitStatusCacheForTest?: () => void } }>;
      const owner = modules.find(module => typeof module.exports?.clearGitStatusCacheForTest === 'function');
      if (!owner) throw new Error('Main Git cache owner unavailable'); owner.exports.clearGitStatusCacheForTest!();
    });
    const measure = () => app.evaluate(() => {
      const modules = Object.values(process.mainModule!.require('node:module')._cache) as Array<{ exports: { getMainPerformanceSnapshot?: () => { counters: { recentSpawns: Array<{ command: string; at: number }> }; rssBytes: number } } }>;
      const owner = modules.find(module => typeof module.exports?.getMainPerformanceSnapshot === 'function');
      if (!owner) throw new Error('Main performance owner unavailable'); return { performance: owner.exports.getMainPerformanceSnapshot!(), memory: process.memoryUsage() };
    });
    const rows: Array<Record<string, unknown>> = [];
    for (const mode of ['uncached-control', 'shared', 'shared', 'uncached-control']) {
      await reset(); const before = await measure(); const at = Date.now(); const durations: number[] = [];
      for (let index = 0; index < 8; index++) {
        if (mode === 'uncached-control') await reset();
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
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)!.destroy(), secondId);
    await writeFile(join(root, 'after-close.txt'), 'remaining window');
    const status = await invoke(main, 'git', 'status');
    expect((status.status as { changes: Array<{ path: string }> }).changes.some(file => file.path === 'after-close.txt')).toBe(true);
    await writeFile(testInfo.outputPath('read-models.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex',
      workload: { requestsPerRound: 8, nativeWindows: 2, order: 'ABBA', source: 'one temporary native Git repository' },
      control: 'Existing Main cache cleared before each control request; product routes and Git commands remain real.',
      rows, remainingWindowReads: true, sourceMutationObserved: true }, null, 2));
  } finally {
    if (secondId !== undefined) await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), secondId).catch(() => {});
    await closeElectronApp(app);
  }
});
