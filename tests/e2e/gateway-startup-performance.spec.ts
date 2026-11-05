import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test('managed Gateway starts with plugins, serves authenticated RPC, and stops its child', async ({
  homeDir, userDataDir, launchElectronApp,
}, testInfo) => {
  test.setTimeout(240_000);
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Port allocation failed');
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
  const config = JSON.stringify({
    gateway: { mode: 'local', controlUi: { enabled: false } },
    plugins: { enabled: true },
    update: { checkOnStart: false },
    agents: { defaults: { workspace: join(homeDir, 'workspace') } },
  });
  for (const dir of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'openclaw.json'), config);
  }
  // Electron's low-integrity child cannot reuse the shell-owned shared jiti
  // cache on this Windows host. Give this run its own writable temp boundary.
  const tempDir = join(userDataDir, 'temp');
  await mkdir(tempDir, { recursive: true });
  const evidence = {
    driven_by: 'agent', actor: 'playwright-gateway-startup', pluginsEnabled: true,
    memory: { freeBytes: freemem(), totalBytes: totalmem() },
    startSucceeded: false, authenticatedRpc: false, stopped: false,
    readyMs: null as number | null, pid: null as number | null,
  };
  const app = await launchElectronApp({ skipSetup: true, env: {
    TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir, OPENCLAW_GATEWAY_STARTUP_TRACE: '1',
  } });
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible();
    const invoke = async (module: 'gateway' | 'settings', action: string, payload?: Record<string, unknown>) => {
      const response = await page.evaluate(async (request) => {
        if (!window.verseClaw) throw new Error('Host bridge unavailable');
        return window.verseClaw.hostInvoke({ id: crypto.randomUUID(), ...request });
      }, { module, action, payload });
      if (!response.ok) throw new Error(response.error?.message ?? 'Host invocation failed');
      return response.data as Record<string, unknown>;
    };
    await invoke('settings', 'set', { key: 'gatewayPort', value: port });
    const startedAt = Date.now();
    const start = await invoke('gateway', 'start');
    expect(start.success).toBe(true);
    evidence.startSucceeded = true;
    await expect.poll(async () => {
      const status = await invoke('gateway', 'status');
      return status.state === 'running' && status.gatewayReady === true;
    }, { timeout: 90_000 }).toBe(true);
    const presence = await invoke('gateway', 'rpc', { method: 'system-presence', params: {}, timeoutMs: 10_000 });
    expect(Array.isArray(presence)).toBe(true);
    evidence.authenticatedRpc = true;
    const status = await invoke('gateway', 'status');
    const pid = status.pid as number;
    expect(pid).toBeGreaterThan(0);
    evidence.pid = pid;
    evidence.readyMs = Date.now() - startedAt;
    expect((await invoke('gateway', 'stop')).success).toBe(true);
    expect((await invoke('gateway', 'status')).state).toBe('stopped');
    await expect.poll(() => {
      try { process.kill(pid, 0); return true; } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
      }
    }, { timeout: 10_000 }).toBe(false);
    evidence.stopped = true;
  } finally {
    await testInfo.attach('gateway-startup.json', {
      contentType: 'application/json', body: JSON.stringify(evidence),
    });
    await closeElectronApp(app);
  }
});
