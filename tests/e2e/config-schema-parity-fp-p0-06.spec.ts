/**
 * FP-P0-06 G3: real Electron + real gateway child started with a config that
 * exercises every runtime.* section that used to be missing from the strict
 * zod schema (coding / vtoken / orchestration / resilience / memory.injectPilot).
 *
 * Before FP-P0-06, this exact config made the gateway child exit code=1 during
 * config validation — the gateway could not start at all. The assertion here is
 * therefore simply: the child starts, becomes ready, and answers
 * `runtime.flags.ack` from a real pid.
 *
 * All values written are the OFF/neutral forms; no production default is flipped
 * (hard lock 3). The point is writability, not enablement.
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
    return await handler(event, { id: `fp-p0-06-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload })) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'failed'}`);
  }
  return response.data as T;
}

async function ensureGatewayRunning(app: ElectronApplication, port: number): Promise<void> {
  const deadline = Date.now() + 180_000;
  let attempts = 0;
  let lastStatus: GatewayStatus | undefined;
  let lastError: string | undefined;
  while (Date.now() < deadline) {
    try {
      lastStatus = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      if (lastStatus.gatewayReady === true || lastStatus.state === 'running') return;
      if (lastStatus.state !== 'starting' && attempts < 3) {
        attempts += 1;
        try {
          await hostInvoke<HostSuccess>(app, 'gateway', 'start');
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `gateway never became ready with parity config: ${JSON.stringify({ lastStatus, lastError, port })}`,
  );
}

test.describe('FP-P0-06 schema parity (real gateway child)', () => {
  test('gateway starts with formerly schema-rejected runtime leaves present in config', async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }) => {
    test.setTimeout(420_000);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-fp-p0-06-'));
    const config = {
      gateway: { mode: 'local', controlUi: { enabled: false } },
      runtime: {
        // Every section below was rejected by zod-schema.ts before FP-P0-06 and
        // made the child exit code=1. Values are all OFF/neutral on purpose.
        coding: { writeJournal: { enabled: true }, worktree: { backend: 'inprocess' } },
        vtoken: { assembly: { enabled: false } },
        orchestration: { routingMemoPilot: 'off', handoffArtifacts: 'off' },
        resilience: { anomalyClassifierPilot: 'off' },
        memory: { injectPilot: { enabled: false } },
        contextEnhancement: { killSwitch: false },
      },
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

      const port = await allocatePort();
      const set = await hostInvoke<HostSuccess>(app, 'settings', 'set', {
        key: 'gatewayPort',
        value: port,
      });
      expect(set.success).toBe(true);
      await ensureGatewayRunning(app, port);

      const ack = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
        method: 'runtime.flags.ack',
        params: {},
        timeoutMs: 30_000,
      });

      // The child is a real other process that read the parity config and lived.
      expect(typeof ack.childPid).toBe('number');
      expect(ack.childPid).not.toBe(process.pid);
      const configSource = ack.configSource as { exists?: boolean } | undefined;
      expect(configSource?.exists).toBe(true);

      // Defaults were not flipped by writability: everything stays off.
      const effectiveFlags = ack.effectiveFlags as Record<string, unknown>;
      expect(effectiveFlags['runtime.vtoken.assembly.enabled']).toBe(false);
      expect(effectiveFlags['runtime.contextEnhancement.killSwitch']).toBe(false);


      console.log('[fp-p0-06-parity-start]', JSON.stringify({
        childPid: ack.childPid,
        gatewayGeneration: ack.gatewayGeneration,
        configExists: configSource?.exists,
        vtokenAssembly: effectiveFlags['runtime.vtoken.assembly.enabled'],
        killSwitch: effectiveFlags['runtime.contextEnhancement.killSwitch'],
      }));
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
