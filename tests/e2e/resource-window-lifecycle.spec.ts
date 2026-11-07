import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { createServer } from 'node:http';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

async function invoke(page: Page, module: string, action: string, payload?: unknown) {
  return page.evaluate(async ({ module, action, payload }) => {
    const r = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module, action, payload }) as { ok: boolean; data: Record<string, unknown>; error?: { message: string } };
    if (!r.ok) throw new Error(r.error?.message ?? 'host request failed');
    return r.data;
  }, { module, action, payload });
}

test('integrated main and browser windows retain visibility, observers and background execution', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(240_000);
  const app = await launchElectronApp({ skipSetup: true, visualMode: true });
  const page = await getStableWindow(app);
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>Window lifecycle</title><h1>Agent-driven window lifecycle</h1>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Window fixture did not bind');
  const origin = `http://127.0.0.1:${address.port}`;
  const report: Record<string, unknown> = { driven_by: 'agent', actor: 'codex', gateway: 'idle transport fixture', windows: 'real Electron', services: ['sessionStorage', 'terminal', 'agentBrowser', 'efficiency', 'resourceTracker'] };
  const calls = async () => app.evaluate(() => {
    const rows = (globalThis as unknown as { __verseClawE2eHostCalls: Array<{ module: string; action: string }> }).__verseClawE2eHostCalls;
    return { resourcePolls: rows.filter(r => r.module === 'resourceTracker' && r.action === 'list').length,
      stopControls: rows.filter(r => r.module === 'resourceTracker' && ['stop', 'stopAll'].includes(r.action)).length,
      efficiencyReads: rows.filter(r => r.module === 'efficiency' && r.action === 'getState').length };
  });
  try {
    await installIpcMocks(app, { gatewayStatus: { state: 'running', gatewayReady: true },
      gatewayRpcByMethod: { 'sessions.list': { sessions: [] }, 'chat.history': { messages: [] }, '*': {} },
      hostApi: { '["agents","list",null]': { success: true, agents: [{ id: 'main', name: 'Main' }] } },
    });
    const scratch = join(process.env.CLAWX_E2E_RUN_ROOT!, 'window-workspaces'); await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(join(scratch, 'scope-'));
    const created = await invoke(page, 'workspaces', 'create', { rootPath: root, name: 'Window lifecycle', agentId: 'main', activeSessionKey: 'agent:main:window-lifecycle', permissionMode: 'acceptEdits' });
    const workspace = created.activeWorkspace as { id: string; activeSessionKey: string };
    await page.reload(); await expect(page.getByTestId('session-worktree-trigger')).toBeVisible();
    const scope = { workspaceId: workspace.id, sessionKey: workspace.activeSessionKey };
    let terminal = await invoke(page, 'terminal', 'open', { ...scope, keepOnLeave: true });
    if (terminal.approvalRequired) {
      const approvalId = (terminal.approval as { id: string }).id;
      await invoke(page, 'permissions', 'decideApproval', { id: approvalId, decision: 'approved' });
      terminal = await invoke(page, 'terminal', 'open', { ...scope, keepOnLeave: true, approvalId });
    }
    expect(terminal.success).toBe(true);
    const heartbeat = join(root, 'heartbeat.txt'); const script = join(root, 'heartbeat.cjs');
    await writeFile(script, `setInterval(() => require('node:fs').appendFileSync(${JSON.stringify(heartbeat)}, 'x'), 400);`);
    // TerminalSessionManager uses COMSPEC on Windows.
    await invoke(page, 'terminal', 'write', { sessionId: terminal.sessionId, data: `"${process.execPath}" "${script}"\r` });
    const size = async () => (await readFile(heartbeat).catch(() => Buffer.alloc(0))).length;
    await expect.poll(size).toBeGreaterThan(0);
    await invoke(page, 'efficiency', 'setEnabled', { enabled: false });
    await invoke(page, 'efficiency', 'setEnabled', { enabled: true });
    const shed = async () => Boolean(((await invoke(page, 'efficiency', 'getState')).shed as { activeReasons?: string[] } | null)?.activeReasons?.includes('window-hidden'));
    const approveBrowser = () => app.evaluate((_electron, input) => {
      const modules = process.mainModule!.require('node:module')._cache;
      const entry = Object.keys(modules).find(key => typeof modules[key].exports?.approveBrowserPrivateNetwork === 'function');
      if (!entry) throw new Error('Main approval owner unavailable');
      return modules[entry].exports.approveBrowserPrivateNetwork(input);
    }, { sessionId: scope.sessionKey, origin });
    const mainId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
    const openBrowser = async () => {
      // Closing a browser revokes its origin grant; every new session is approved separately.
      report.networkApproval = await approveBrowser();
      const opened = await invoke(page, 'agentBrowser', 'open', { ...scope, url: origin, mode: 'visible', profile: 'window-lifecycle' });
      expect(opened.success).toBe(true);
      const browserId = await app.evaluate(({ BrowserWindow }, mainId) => BrowserWindow.getAllWindows().find(w => w.id !== mainId)?.id, mainId);
      expect(browserId).toBeTruthy();
      return { browserId: browserId!, sessionId: (opened.session as { id: string }).id };
    };
    const control = async (id: number, action: 'hide' | 'showInactive' | 'minimize' | 'restore') => app.evaluate(({ BrowserWindow }, { id, action }) => {
      const win = BrowserWindow.fromId(id); if (!win) throw new Error('Missing test window'); win[action]();
    }, { id, action });
    const browser = await openBrowser();
    await control(browser.browserId, 'hide'); await expect.poll(shed).toBe(false);
    await control(browser.browserId, 'showInactive'); await control(mainId, 'hide'); await expect.poll(shed).toBe(false);
    await expect.poll(() => invoke(page, 'window', 'isVisible')).toBe(false);
    await writeFile(testInfo.outputPath('hidden-window.json'), JSON.stringify(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ id: w.id, visible: w.isVisible(), minimized: w.isMinimized(), backgroundThrottling: w.webContents.getBackgroundThrottling() }))), null, 2));
    const heartbeatBefore = await size(); const hiddenBefore = await calls();
    await page.waitForTimeout(11_000);
    const hiddenAfter = await calls();
    expect(hiddenAfter.resourcePolls).toBe(hiddenBefore.resourcePolls);
    expect(await size()).toBeGreaterThan(heartbeatBefore);
    await control(browser.browserId, 'minimize'); await expect.poll(shed).toBe(true);
    await control(browser.browserId, 'restore'); await expect.poll(shed).toBe(false);
    await control(browser.browserId, 'hide'); await expect.poll(shed).toBe(true);
    await control(mainId, 'showInactive'); await expect.poll(shed).toBe(false);
    await expect.poll(async () => (await calls()).resourcePolls).toBeGreaterThan(hiddenAfter.resourcePolls);
    await invoke(page, 'agentBrowser', 'close', { sessionId: browser.sessionId });
    const reopened = await openBrowser(); await invoke(page, 'agentBrowser', 'close', { sessionId: reopened.sessionId });
    await page.screenshot({ path: testInfo.outputPath('main-after-browser-reopen.png') });
    const beforeLeave = await calls();
    await page.evaluate(() => { window.location.hash = '#/settings'; });
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await page.waitForTimeout(11_000);
    const afterLeave = await calls();
    expect(afterLeave.resourcePolls).toBe(beforeLeave.resourcePolls);
    expect(afterLeave.stopControls).toBe(0);
    const terminalAfter = await invoke(page, 'terminal', 'list', scope);
    expect((terminalAfter.sessions as Array<{ sessionId: string }>).some(s => s.sessionId === terminal.sessionId)).toBe(true);
    const finalBeat = await size(); await page.waitForTimeout(900); expect(await size()).toBeGreaterThan(finalBeat);
    report.visibility = { oneHiddenKeepsVisible: true, allHiddenSheds: true, restoreRecovers: true, browserReopened: true };
    report.observation = { hiddenBefore, hiddenAfter, beforeLeave, afterLeave, backgroundHeartbeat: await size() };
    const storage = await invoke(page, 'sessionStorage', 'snapshot');
    expect((storage.sessions as Array<{ sessionKey: string; terminals: number }>).some(s => s.sessionKey === scope.sessionKey && s.terminals === 1)).toBe(true);
    await invoke(page, 'terminal', 'close', { sessionId: terminal.sessionId });
    report.cleanup = { terminalClosed: (await invoke(page, 'terminal', 'list', scope)).sessions, remainingWindows: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) };
    await writeFile(testInfo.outputPath('acceptance.json'), JSON.stringify(report, null, 2));
  } finally {
    const cleanup = await closeElectronApp(app);
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await writeFile(testInfo.outputPath('owned-process-cleanup.json'), JSON.stringify(cleanup, null, 2));
    expect(cleanup.mainExited).toBe(true); expect(cleanup.launcherExited).toBe(true);
  }
});
