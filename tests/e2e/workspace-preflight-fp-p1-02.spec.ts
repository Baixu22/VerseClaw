/**
 * FP-P1-02 G3: workspace preflight + permission choice in real Electron, and
 * the write boundary enforced in the real host process.
 *
 * The OS folder picker cannot be driven headlessly, so dialog.showOpenDialog is
 * stubbed to return a real temp directory — everything downstream (preflight
 * checks, workspace creation, boundary enforcement on files.writeText) runs the
 * real production code paths. The boundary assertions write through the real
 * host `files.writeText` route: inside the workspace succeeds on disk; outside
 * and `../`-traversal writes are rejected with the boundary named.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; port?: number; gatewayReady?: boolean };
type HostSuccess = { success: boolean };

const VALID_KEY = 'test-key-ok';
const MOCK_MODELS = ['mock-coder-small'];

async function allocatePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
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

async function startProviderEndpoint(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${VALID_KEY}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key provided' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: MOCK_MODELS.map((id) => ({ id })) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('endpoint port failed');
  return { server, port: address.port };
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
    return await handler(event, { id: `fp-p1-02-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload })) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'failed'}`);
  }
  return response.data as T;
}

async function startGateway(app: ElectronApplication): Promise<void> {
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

async function stubFolderPicker(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, pickedFolder) => {
    // Only the OS picker is stubbed; preflight/creation/boundary stay real.
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pickedFolder] });
  }, folder);
}

test.describe('FP-P1-02 workspace preflight + boundary (real Electron)', () => {
  test('preflight gates the folder, permission is explicit, and the runtime boundary rejects escapes', async ({
    launchElectronApp,
  }) => {
    test.setTimeout(600_000);
    const endpoint = await startProviderEndpoint();
    const goodBaseUrl = `http://127.0.0.1:${endpoint.port}/v1`;
    const outerDir = await mkdtemp(join(tmpdir(), 'clawx-fp-p1-02-'));
    const wsDir = join(outerDir, 'workspace');
    await mkdir(wsDir, { recursive: true });

    const app = await launchElectronApp({ skipSetup: false });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('setup-page')).toBeVisible({ timeout: 60_000 });

      // Welcome → Runtime (needs a live gateway) → Installing(skip) → Provider.
      await page.getByTestId('setup-next-button').click();
      await startGateway(app);
      await expect(page.getByTestId('setup-next-button')).toBeEnabled({ timeout: 120_000 });
      await page.getByTestId('setup-next-button').click();
      await page.getByTestId('setup-installing-skip').click();

      // Provider + Model against the real local endpoint (validated path).
      await page.getByTestId('setup-provider-vendor-custom').click();
      await page.getByTestId('setup-provider-base-url').fill(goodBaseUrl);
      await page.getByTestId('setup-provider-api-key').fill(VALID_KEY);
      await page.getByTestId('setup-provider-validate').click();
      await expect(page.getByTestId('setup-provider-validated')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('setup-next-button').click();
      await page.getByTestId(`setup-model-option-${MOCK_MODELS[0]}`).click();
      await page.getByTestId('setup-model-confirm').click();
      await expect(page.getByTestId('setup-model-verified')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('setup-next-button').click();

      // ---- Workspace step ----
      await expect(page.getByTestId('setup-workspace-step')).toBeVisible();
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();

      // First: a folder that MUST be blocked (system dir is sensitive).
      const blockedDir = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
      await stubFolderPicker(app, blockedDir);
      await page.getByTestId('setup-workspace-pick').click();
      await expect(page.getByTestId('setup-workspace-blocked')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();

      // Then: the real project folder passes preflight.
      await stubFolderPicker(app, wsDir);
      await page.getByTestId('setup-workspace-pick').click();
      await expect(page.getByTestId('setup-workspace-check-exists-ok')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('setup-workspace-check-writable-ok')).toBeVisible();

      // Controlled write is an explicit choice; confirm activates the workspace.
      await page.getByTestId('setup-workspace-mode-acceptEdits').click();
      await page.getByTestId('setup-workspace-confirm').click();
      await expect(page.getByTestId('setup-workspace-confirmed')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('setup-next-button').click();

      // Complete shows the workspace and finishes into the main UI.
      await expect(page.getByTestId('setup-complete-workspace')).toBeVisible();
      await page.getByTestId('setup-next-button').click();
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      // ---- Single authority: gateway config follows the active workspace. ----
      const active = await hostInvoke<{ activeWorkspace?: { rootPath?: string; permissionMode?: string } }>(
        app, 'workspaces', 'getActive',
      );
      // eslint-disable-next-line no-console -- evidence for FP-P1-02
      console.log('[fp-p1-02-active]', JSON.stringify(active.activeWorkspace));
      expect(active.activeWorkspace?.rootPath?.toLowerCase()).toBe(wsDir.toLowerCase());
      expect(active.activeWorkspace?.permissionMode).toBe('acceptEdits');

      // ---- Runtime boundary via the REAL host write route. ----
      // files.writeText edits existing files; seed the target first.
      const insidePath = join(wsDir, 'inside.txt');
      await writeFile(insidePath, 'seed\n', 'utf8');
      const inside = await hostInvoke<{ ok?: boolean; error?: string }>(app, 'files', 'writeText', {
        path: insidePath,
        content: 'inside the boundary\n',
      });
      expect(inside.ok).toBe(true);
      expect(await readFile(insidePath, 'utf8')).toContain('inside the boundary');

      const outsidePath = join(outerDir, 'outside.txt');
      const outside = await hostInvoke<{ ok?: boolean; error?: string; approval?: { reason?: string } }>(
        app, 'files', 'writeText', { path: outsidePath, content: 'escape attempt\n' },
      );
      // eslint-disable-next-line no-console -- evidence for FP-P1-02
      console.log('[fp-p1-02-outside]', JSON.stringify(outside));
      expect(outside.ok).toBe(false);
      expect(outside.error).toBe('approvalRequired');
      // The denial names the actual boundary.
      expect(outside.approval?.reason ?? '').toContain('outside the workspace boundary');

      const traversalPath = join(wsDir, 'sub', '..', '..', 'traversal.txt');
      const traversal = await hostInvoke<{ ok?: boolean; error?: string }>(app, 'files', 'writeText', {
        path: traversalPath,
        content: 'traversal attempt\n',
      });
      // eslint-disable-next-line no-console -- evidence for FP-P1-02
      console.log('[fp-p1-02-traversal]', JSON.stringify(traversal));
      expect(traversal.ok).toBe(false);

      // Nothing escaped onto disk.
      await expect(readFile(join(outerDir, 'outside.txt'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(outerDir, 'traversal.txt'), 'utf8')).rejects.toThrow();
    } finally {
      await closeElectronApp(app);
      await new Promise<void>((resolve) => endpoint.server.close(() => resolve()));
      await rm(outerDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
