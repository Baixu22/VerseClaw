/**
 * FP-P1-09 G3 + latency measurement: real Electron + real gateway children.
 *
 * Each `setFlag(restartGateway: true)` spawns a NEW gateway child process and
 * waits for its acknowledgement, so every iteration measures a genuine
 * child-process cold start → ack (`ackWaitMs` is measured host-side around
 * collectRuntimeFlagAck only — the restart itself is excluded). The recorded
 * data is the basis for the FP-P1-09 default timeout (see task doc).
 *
 * Also proves the requery path: `dcsProdFlags.requeryAck` reaches a state
 * decision from the live child WITHOUT saving anything or restarting.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; port?: number; gatewayReady?: boolean };
type HostSuccess = { success: boolean };

async function allocatePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('port allocation failed')));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = (await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require(
      'electron',
    ) as typeof import('electron');
    const handler = (
      ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      }
    )._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available for host:invoke sender auth');
    const sender = win.webContents;
    const event = {
      sender,
      senderFrame: { url: typeof sender.getURL === 'function' ? sender.getURL() : '' },
    };
    return await handler(event, { id: `fp-p1-09-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload })) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'failed'}`);
  }
  return response.data as T;
}

async function ensureGatewayRunning(app: ElectronApplication): Promise<void> {
  const port = await allocatePort();
  await hostInvoke<HostSuccess>(app, 'settings', 'set', { key: 'gatewayPort', value: port });
  const deadline = Date.now() + 180_000;
  let attempts = 0;
  while (Date.now() < deadline) {
    try {
      const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      if (status.gatewayReady === true || status.state === 'running') return;
      if (status.state !== 'starting' && attempts < 3) {
        attempts += 1;
        await hostInvoke<HostSuccess>(app, 'gateway', 'start').catch(() => undefined);
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('gateway never became ready');
}

test.describe('FP-P1-09 ack tuning (real gateway children)', () => {
  test('five real restart→ack cycles reach applied under the tuned defaults, then requery works', async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }) => {
    test.setTimeout(1_740_000);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-fp-p1-09-'));
    const config = {
      gateway: { mode: 'local', controlUi: { enabled: false } },
      agents: { defaults: { workspace: workspaceDir }, list: [{ id: 'main', default: true }] },
    };
    const serialized = `${JSON.stringify(config, null, 2)}\n`;
    const openclawDir = join(homeDir, '.openclaw');
    const sourceStateDir = join(userDataDir, 'openclaw-source-state');
    await mkdir(openclawDir, { recursive: true });
    await mkdir(sourceStateDir, { recursive: true });
    await writeFile(join(openclawDir, 'openclaw.json'), serialized, 'utf8');
    await writeFile(join(sourceStateDir, 'openclaw.json'), serialized, 'utf8');

    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await ensureGatewayRunning(app);

      const samples: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 5; i += 1) {
        const enabled = i % 2 === 0;
        const startedAt = Date.now();
        const result = await hostInvoke<Record<string, unknown>>(app, 'dcsProdFlags', 'setFlag', {
          id: 'working-memory',
          enabled,
          restartGateway: true,
        });
        samples.push({
          run: i,
          enabled,
          status: result.status,
          ackWaitMs: result.ackWaitMs,
          totalMs: Date.now() - startedAt,
          generation: result.gatewayGeneration,
          childPid: (result.runtimeAck as { childPid?: number } | undefined)?.childPid,
        });

        console.log('[fp-p1-09-sample]', JSON.stringify(samples[samples.length - 1]));
        expect(
          result.status,
          `run ${i}: expected applied, got ${JSON.stringify(result)}`,
        ).toBe('applied');
        expect(typeof result.ackWaitMs).toBe('number');
      }

      console.log('[fp-p1-09-latency]', JSON.stringify(samples));

      // Each cycle must have spoken to a distinct child process.
      const pids = new Set(samples.map((sample) => sample.childPid));
      expect(pids.size).toBe(5);

      // ---- requery: no save, no restart, fresh state decision from the child.
      const before = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'status');
      const requery = await hostInvoke<Record<string, unknown>>(app, 'dcsProdFlags', 'requeryAck');

      console.log('[fp-p1-09-requery]', JSON.stringify({
        status: requery.status,
        ackWaitMs: requery.ackWaitMs,
        generation: requery.gatewayGeneration,
        childPid: (requery.runtimeAck as { childPid?: number } | undefined)?.childPid,
      }));
      expect(requery.success).toBe(true);
      expect(requery.status).toBe('applied');
      // Same child as the last cycle: requery did NOT restart the gateway.
      expect((requery.runtimeAck as { childPid?: number }).childPid).toBe(
        samples[4].childPid,
      );
      const after = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'status');
      expect(after.state).toBe(before.state);
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
