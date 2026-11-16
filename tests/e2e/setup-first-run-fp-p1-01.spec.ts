/**
 * FP-P1-01 G2/G3: first-run Setup provider/model verification — real Electron,
 * real Setup UI, real HTTP validation requests.
 *
 * The provider endpoint is a REAL local HTTP server implementing the
 * OpenAI-compatible /models surface. The validation request is not mocked away
 * (FP-P1-01 hard lock): electron-main's provider-validation performs an actual
 * network fetch against it. Credential-reject (401) and unreachable-endpoint
 * failure paths are produced by the server / a closed port, not by stubbing.
 *
 * Covered:
 *  - success path: validate → model listing → verified Complete
 *  - failure paths: 未填 (empty key), 凭据无效 (401), 网络不可达 (closed port)
 *  - skip path: Complete shows limited mode; first chat send is intercepted
 */
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; port?: number; gatewayReady?: boolean };
type HostSuccess = { success: boolean };

const VALID_KEY = 'test-key-ok';
const RATE_LIMITED_KEY = 'test-key-429';
const PARAMETER_ERROR_KEY = 'test-key-400-parameter';
const MOCK_MODELS = ['mock-coder-small', 'mock-coder-large'];

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

/** Real OpenAI-compatible /models endpoint with bearer auth. */
async function startProviderEndpoint(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const auth = req.headers.authorization ?? '';
    // TF-0733: state fixtures served by the REAL endpoint, so the UI path is
    // exercised end-to-end rather than stubbed in the renderer.
    if (auth === `Bearer ${RATE_LIMITED_KEY}`) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3' });
      res.end(JSON.stringify({ error: { message: 'Too many requests' } }));
      return;
    }
    if (auth === `Bearer ${PARAMETER_ERROR_KEY}`) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'unsupported parameter temperature' } }));
      return;
    }
    if (auth !== `Bearer ${VALID_KEY}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key provided' } }));
      return;
    }
    if ((req.url ?? '').includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: MOCK_MODELS.map((id) => ({ id })) }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
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
    return await handler(event, { id: `fp-p1-01-${Date.now()}-${Math.random()}`, ...request });
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

test.describe('FP-P1-01 Setup provider/model verification (real Electron + real HTTP)', () => {
  test('verified path plus all three failure classes in the Provider step', async ({
    launchElectronApp,
  }) => {
    test.setTimeout(420_000);
    const endpoint = await startProviderEndpoint();
    const goodBaseUrl = `http://127.0.0.1:${endpoint.port}/v1`;

    const app = await launchElectronApp({ skipSetup: false });
    try {
      const page = await getStableWindow(app);
      /*
       * Run the wizard without its arc.
       *
       * Step cards ride a framer-motion 3D ring (`.setup-arc-orbit`,
       * translateZ/rotateY — see THE ARC in src/pages/Setup/index.tsx), so an
       * ANCESTOR transform is in flight for ~700ms after every step change.
       * Playwright refuses to click an element whose box is still moving, and
       * on a loaded machine that animation plus the step swap outlived the
       * retry budget: `setup-model-option-*` failed as "element is not stable"
       * and then "detached from the DOM". Nothing here tests the arc, and the
       * page already drops it entirely under reduced motion (the variants emit
       * no transform at all), so this removes the flake without weakening what
       * the test actually verifies: real provider/model verification over real
       * HTTP.
       */
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(page.getByTestId('setup-page')).toBeVisible({ timeout: 60_000 });

      // ---- Welcome → Runtime ----
      await page.getByTestId('setup-next-button').click();
      // Runtime gate needs a real running gateway (E2E skips auto-start).
      await startGateway(app);
      await expect(page.getByTestId('setup-next-button')).toBeEnabled({ timeout: 120_000 });
      await page.getByTestId('setup-next-button').click();

      // ---- Installing → skip to Provider ----
      await page.getByTestId('setup-installing-skip').click();
      await expect(page.getByTestId('setup-provider-step')).toBeVisible();
      // Provider step must not be passable without validation.
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();

      await page.getByTestId('setup-provider-vendor-custom').click();

      // ---- failure 1: 未填 (empty key — no request is even needed) ----
      await page.getByTestId('setup-provider-base-url').fill(goodBaseUrl);
      await page.getByTestId('setup-provider-validate').click();
      await expect(page.getByTestId('setup-provider-error-not-filled')).toBeVisible();
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();

      // ---- failure 2: 凭据无效 (real 401 from the real endpoint) ----
      await page.getByTestId('setup-provider-api-key').fill('wrong-key');
      await page.getByTestId('setup-provider-validate').click();
      await expect(page.getByTestId('setup-provider-error-credentials')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();

      // ---- failure 3: 网络不可达 (closed port — connection refused) ----
      // Allocate after Gateway startup so startup cannot claim the released port.
      const deadPort = await allocatePort();
      const deadBaseUrl = `http://127.0.0.1:${deadPort}/v1`;
      await page.getByTestId('setup-provider-base-url').fill(deadBaseUrl);
      await page.getByTestId('setup-provider-api-key').fill(VALID_KEY);
      await page.getByTestId('setup-provider-validate').click();
      await expect(page.getByTestId('setup-provider-validate')).toBeEnabled({ timeout: 60_000 });
      const networkFailure = page.locator('[data-testid^="setup-provider-error-"]');
      await expect(networkFailure).toBeVisible({ timeout: 60_000 });
      expect(await networkFailure.getAttribute('data-testid'), await networkFailure.innerText()).toBe('setup-provider-error-network');
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();

      // ---- failure 4: 429 rate limit (must not look verified) ----
      await page.getByTestId('setup-provider-base-url').fill(goodBaseUrl);
      await page.getByTestId('setup-provider-api-key').fill(RATE_LIMITED_KEY);
      await page.getByTestId('setup-provider-validate').click();
      await expect(page.getByTestId('setup-provider-error-rate-limited')).toBeVisible({
        timeout: 30_000,
      });
      // The retry window from Retry-After is surfaced, not swallowed.
      await expect(page.getByTestId('setup-provider-retry-after')).toContainText('3');
      await expect(page.getByTestId('setup-provider-validated')).toHaveCount(0);
      await expect(page.getByTestId('setup-provider-credentials-accepted')).toHaveCount(0);
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();

      // ---- failure 5: non-auth 400 (protocol/parameter, not credentials) ----
      await page.getByTestId('setup-provider-api-key').fill(PARAMETER_ERROR_KEY);
      await page.getByTestId('setup-provider-validate').click();
      await expect(page.getByTestId('setup-provider-error-protocol')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId('setup-provider-validated')).toHaveCount(0);
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();

      // ---- success: real 200 from the real endpoint ----
      await page.getByTestId('setup-provider-base-url').fill(goodBaseUrl);
      await page.getByTestId('setup-provider-api-key').fill(VALID_KEY);
      await page.getByTestId('setup-provider-validate').click();
      await expect(page.getByTestId('setup-provider-validated')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('setup-next-button')).toBeEnabled();
      await page.getByTestId('setup-next-button').click();

      // ---- Model step: live listing from the endpoint ----
      await expect(page.getByTestId('setup-model-step')).toBeVisible();
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();
      await page.getByTestId(`setup-model-option-${MOCK_MODELS[0]}`).click();
      await page.getByTestId('setup-model-confirm').click();
      await expect(page.getByTestId('setup-model-verified')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('setup-next-button').click();

      // Complete the current wizard's explicit workspace preflight as well.
      await expect(page.getByTestId('setup-workspace-step')).toBeVisible();
      const workspacePath = test.info().outputPath('workspace');
      mkdirSync(workspacePath, { recursive: true });
      await app.evaluate(({ dialog }, selectedFolder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFolder] });
      }, workspacePath);
      await page.getByTestId('setup-workspace-pick').click();
      await expect(page.getByTestId('setup-workspace-preflight')).toBeVisible();
      await page.getByTestId('setup-workspace-mode-readOnly').click();
      await page.getByTestId('setup-workspace-confirm').click();
      await expect(page.getByTestId('setup-workspace-confirmed')).toBeVisible();
      await page.getByTestId('setup-next-button').click();

      // ---- Complete: verified, NOT limited mode ----
      await expect(page.getByTestId('setup-complete-provider-verified')).toBeVisible();
      await expect(page.getByTestId('setup-complete-unverified')).toHaveCount(0);

      // Sanitized verification record persisted host-side; no key material.
      const verification = await hostInvoke<Record<string, unknown>>(app, 'settings', 'get', {
        key: 'setupProviderVerification',
      });

      console.log('[fp-p1-01-verification]', JSON.stringify(verification));
      expect(verification.status).toBe('verified');
      expect(verification.model).toBe(MOCK_MODELS[0]);
      expect(JSON.stringify(verification)).not.toContain(VALID_KEY);

      // Finish setup and land in the main UI.
      await page.getByTestId('setup-next-button').click();
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
    } finally {
      await closeElectronApp(app);
      await new Promise<void>((resolve) => endpoint.server.close(() => resolve()));
    }
  });

  test('skip path: limited-mode Complete state and chat first-send interception', async ({
    launchElectronApp,
  }) => {
    test.setTimeout(420_000);
    const app = await launchElectronApp({ skipSetup: false });
    try {
      const page = await getStableWindow(app);
      // Same reason as the verified path above: no arc, no moving ancestors
      // under the wizard's controls.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(page.getByTestId('setup-page')).toBeVisible({ timeout: 60_000 });

      // Skip from the Welcome step — the escape hatch stays available but is
      // recorded as 'skipped', never as a verified setup.
      await page.getByTestId('setup-skip-button').click();
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const verification = await hostInvoke<Record<string, unknown>>(app, 'settings', 'get', {
        key: 'setupProviderVerification',
      });

      console.log('[fp-p1-01-skip]', JSON.stringify(verification));
      expect(verification.status).toBe('skipped');

      // Chat needs a usable gateway before the composer enables at all.
      await startGateway(app);

      const composer = page.getByTestId('chat-composer-input');
      await expect(composer).toBeVisible({ timeout: 60_000 });
      await expect(composer).toBeEnabled({ timeout: 120_000 });
      await composer.fill('hello, first task');
      await page.getByTestId('chat-composer-send').click();

      // The send is intercepted with guidance — not sent, not silently dropped.
      await expect(page.getByTestId('chat-provider-gate-dialog')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId('chat-provider-gate-configure')).toBeVisible();
      /*
       * And the composer stops pretending. Clicking send raises an optimistic
       * "starting" state so the click has an immediate consequence; a REJECTED
       * send has to drop it at once, or a Stop icon sits over the composer
       * while this dialog explains that nothing was sent. The tight timeout is
       * the point: it is shorter than the optimistic window
       * (RUN_START_AFFORDANCE_MS, 620ms), so waiting that window out instead of
       * rolling back on rejection fails here.
       */
      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', 'ready', {
        timeout: 400,
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
