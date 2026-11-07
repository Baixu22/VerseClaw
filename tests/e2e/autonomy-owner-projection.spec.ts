import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke } from './fixtures/fp-p1-harness';

test('R1 rebuilds browser and terminal envelopes from their live desktop owners', async ({ launchElectronApp, homeDir }, testInfo) => {
  test.setTimeout(240000);
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>R1 owner fixture</title><p>Agent-driven owner projection</p>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
  const origin = `http://127.0.0.1:${address.port}`;
  const app = await launchElectronApp({ skipSetup: true });
  let browserId: string | undefined, terminalId: string | undefined;
  type Envelope = { measured: boolean; snapshot: { entries: Array<{ id: string; workspaceKey: string; activeSlots: number; pids?: number[] }> } };
  try {
    await getStableWindow(app);
    const active = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'getActive');
    const workspaceId = active.activeWorkspace.id, sessionKey = 'agent:main:r1-owner-projection';
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, rootPath: homeDir, permissionMode: 'fullAccess' });
    await hostInvoke(app, 'agentBrowser', 'setEnabled', { enabled: true });
    await app.evaluate((_electron, input) => {
      const modules = process.mainModule!.require('node:module')._cache;
      const entry = Object.values(modules).find((value: unknown) => typeof (value as { exports?: { approveBrowserPrivateNetwork?: unknown } }).exports?.approveBrowserPrivateNetwork === 'function') as { exports: { approveBrowserPrivateNetwork: (value: unknown) => unknown } } | undefined;
      if (!entry) throw new Error('Main browser approval owner is unavailable');
      return entry.exports.approveBrowserPrivateNetwork(input);
    }, { sessionId: sessionKey, origin });
    const opened = await hostInvoke<{ success: boolean; session: { id: string } }>(app, 'agentBrowser', 'open', { url: origin, waitUntil: 'dom-ready', mode: 'headless', workspaceId, sessionKey });
    expect(opened.success).toBe(true); browserId = opened.session.id;
    const openedTerminal = await hostInvoke<{ success: boolean; sessionId: string; pid: number | null }>(app, 'terminal', 'open', { workspaceId, sessionKey, cwd: homeDir });
    expect(openedTerminal.success).toBe(true); terminalId = openedTerminal.sessionId;
    const terminalStatus = () => hostInvoke<{ success: boolean; sessionId: string; pid: number | null }>(app, 'terminal', 'status', { sessionId: terminalId });
    await expect.poll(async () => Number((await terminalStatus()).pid), { timeout: 30000 }).toBeGreaterThan(0);
    const terminal = await terminalStatus();
    const before = await hostInvoke<Envelope>(app, 'resourceEnvelope', 'getState');
    await app.evaluate(() => {
      const key = Symbol.for('openclaw.resourceEnvelopeLedger');
      const store = globalThis as Record<PropertyKey, unknown>;
      const ledger = store[key] as { constructor: new () => unknown };
      if (!ledger) throw new Error('Main resource projection is unavailable');
      store[key] = new ledger.constructor();
    });
    const rebuilt = await hostInvoke<Envelope>(app, 'resourceEnvelope', 'getState');
    expect(rebuilt.snapshot.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'main:browser-session:' + browserId, workspaceKey: workspaceId, activeSlots: 1 }),
      expect.objectContaining({ id: 'main:pty-session:' + terminalId, workspaceKey: workspaceId, activeSlots: 1, pids: [terminal.pid] }),
    ]));
    await hostInvoke(app, 'terminal', 'close', { sessionId: terminalId }); terminalId = undefined;
    await expect.poll(async () => await app.evaluate((_electron, pid) => {
      try { process.kill(pid!, 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
    }, terminal.pid), { timeout: 30000 }).toBe(false);
    await hostInvoke(app, 'agentBrowser', 'close', { sessionId: browserId }); browserId = undefined;
    const released = await hostInvoke<Envelope>(app, 'resourceEnvelope', 'getState');
    expect(released.snapshot.entries.some(entry => entry.id.startsWith('main:browser-session:') || entry.id.startsWith('main:pty-session:'))).toBe(false);
    await writeFile(testInfo.outputPath('owner-rebuild.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-r1-desktop-owner-probe',
      workspaceId, opened, terminal, before, rebuilt, released }, null, 2));
  } finally {
    if (terminalId) await hostInvoke(app, 'terminal', 'close', { sessionId: terminalId }).catch(() => undefined);
    if (browserId) await hostInvoke(app, 'agentBrowser', 'close', { sessionId: browserId }).catch(() => undefined);
    await closeElectronApp(app);
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
