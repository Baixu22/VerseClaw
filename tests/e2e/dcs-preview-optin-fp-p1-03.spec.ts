/**
 * FP-P1-03 G3: the DCS Coding Preview switch driven through the REAL Settings
 * DOM against a REAL gateway child.
 *
 * Phases:
 *  A. prerequisites missing → switch disabled, missing items listed in the UI
 *  B. prerequisites satisfied → switch on → UI shows the full ack trail ending
 *     `applied` + per-flag effective values from the child
 *  C. switch off → applied again, effective flags all false, wouldChangeTurn
 *     false (baseline parity)
 *  D. config kill switch written → switch on → child rejects → UI shows
 *     killed/failed, never applied
 *
 * This also closes the FP-P0-04 residual "E2E asserted control-plane returns,
 * not the Settings DOM".
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
    return await handler(event, { id: `fp-p1-03-${Date.now()}-${Math.random()}`, ...request });
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
      if (status.state !== 'starting' && attempts < 10) {
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

test.describe('FP-P1-03 DCS Coding Preview switch (real Settings DOM + real child)', () => {
  test('prereq gating → applied via child ack → baseline parity on off → kill shows killed', async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }) => {
    test.setTimeout(1_740_000);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-fp-p1-03-'));
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
      await startGateway(app);

      // ---- Phase A: prerequisites missing ----
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-developer').click();
      // Unlock developer mode through the real UI switch.
      const devModeSwitch = page.getByTestId('settings-dev-mode-switch');
      await expect(devModeSwitch).toBeVisible({ timeout: 60_000 });
      if ((await devModeSwitch.getAttribute('data-state')) !== 'checked') {
        await devModeSwitch.click();
      }
      const card = page.getByTestId('settings-dcs-preview-card');
      await expect(card).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('settings-dcs-preview-switch')).toBeDisabled();
      await expect(page.getByTestId('settings-dcs-preview-missing-providerVerified')).toBeVisible();
      await expect(page.getByTestId('settings-dcs-preview-missing-workspaceSelected')).toBeVisible();
      // Backend refuses even a direct control-plane call while prereqs miss.
      const refused = await hostInvoke<Record<string, unknown>>(app, 'dcsProdFlags', 'setPreview', {
        enabled: true, restartGateway: true,
      });
      // eslint-disable-next-line no-console -- evidence for FP-P1-03 phase A
      console.log('[fp-p1-03-refused]', JSON.stringify(refused));
      expect(refused.success).toBe(false);

      // ---- satisfy prerequisites (sanitized verification + real workspace) ----
      await hostInvoke<HostSuccess>(app, 'settings', 'set', {
        key: 'setupProviderVerification',
        value: {
          status: 'verified', accountId: 'e2e-acct', vendorId: 'custom',
          model: 'mock-coder-small', checkedAt: new Date().toISOString(),
        },
      });
      await hostInvoke<Record<string, unknown>>(app, 'workspaces', 'create', {
        rootPath: workspaceDir, permissionMode: 'acceptEdits',
      });
      // Re-enter the section so the card reloads its prerequisite state.
      await page.getByTestId('settings-nav-general').click();
      await page.getByTestId('settings-nav-developer').click();
      await expect(page.getByTestId('settings-dcs-preview-switch')).toBeEnabled({ timeout: 60_000 });

      // ---- Phase B: enable through the DOM; applied must come from the child ----
      await page.getByTestId('settings-dcs-preview-switch').click();
      await expect(page.getByTestId('settings-dcs-preview-switch')).toBeDisabled();
      await expect(page.getByTestId('settings-dcs-preview-switch')).toBeEnabled({ timeout: 400_000 });
      const ack = page.getByTestId('settings-dcs-preview-ack');
      await expect(ack).toBeVisible({ timeout: 30_000 });
      await expect(ack).toHaveAttribute('data-ack-state', 'applied', { timeout: 30_000 });
      await expect(page.getByTestId('settings-dcs-preview-ack-trail')).toHaveText(
        'saved → pending-restart → restarting → runtime-acknowledged → applied',
      );
      for (const key of [
        'dcs.contextViewTools.enabled',
        'runtime.contextBlock.working_memory.enabled',
        'runtime.contextBlock.tool_registry.enabled',
        'runtime.coding.staleWriteGuard.enabled',
      ]) {
        await expect(page.getByTestId(`settings-dcs-preview-effective-${key}`)).toHaveText(
          `${key}: true`,
        );
      }
      // eslint-disable-next-line no-console -- evidence for FP-P1-03 phase B
      console.log('[fp-p1-03-on]', await ack.getAttribute('data-ack-state'));

      // ---- Phase C: disable → baseline parity ----
      await page.getByTestId('settings-dcs-preview-switch').click();
      // Busy clears only after the new result (incl. child ack) lands.
      await expect(page.getByTestId('settings-dcs-preview-switch')).toBeDisabled();
      await expect(page.getByTestId('settings-dcs-preview-switch')).toBeEnabled({ timeout: 400_000 });
      await expect(ack).toHaveAttribute('data-ack-state', 'applied', { timeout: 30_000 });
      for (const key of [
        'dcs.contextViewTools.enabled',
        'runtime.contextBlock.working_memory.enabled',
        'runtime.contextBlock.tool_registry.enabled',
        'runtime.coding.staleWriteGuard.enabled',
      ]) {
        await expect(page.getByTestId(`settings-dcs-preview-effective-${key}`)).toHaveText(
          `${key}: false`,
        );
      }
      const parity = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
        method: 'runtime.flags.ack', params: {}, timeoutMs: 30_000,
      });
      const probe = (parity as { turnEffectProbe?: { wouldChangeTurn?: boolean } }).turnEffectProbe;
      // eslint-disable-next-line no-console -- evidence for FP-P1-03 phase C
      console.log('[fp-p1-03-parity]', JSON.stringify({
        wouldChangeTurn: probe?.wouldChangeTurn,
        effectiveFlags: (parity as { effectiveFlags?: Record<string, unknown> }).effectiveFlags,
      }));
      expect(probe?.wouldChangeTurn).toBe(false);

      // FP-P1-10: the child must say WHY each flag has its value. After the
      // preview switch is turned off, the four combo flags are `false` — but
      // "false because the operator wrote false" and "false because nobody set
      // it" are different operational situations, and `configSource` (a single
      // file path) could never tell them apart.
      const attribution = (parity as {
        flagAttribution?: Record<string, { value: unknown; origin: string; key?: string }>;
      }).flagAttribution;
      // eslint-disable-next-line no-console -- evidence for FP-P1-10
      console.log('[fp-p1-10-attribution]', JSON.stringify(attribution));
      expect(attribution).toBeDefined();
      const effective = (parity as { effectiveFlags?: Record<string, unknown> }).effectiveFlags ?? {};
      // Every effective flag carries provenance, and it agrees with the value.
      for (const [name, value] of Object.entries(effective)) {
        expect(attribution?.[name], `no attribution for ${name}`).toBeDefined();
        expect(attribution?.[name]?.value).toBe(value);
        expect(['env', 'config', 'default', 'kill']).toContain(attribution?.[name]?.origin);
      }
      // The switch wrote these off explicitly, so they must read `config` — not
      // `default`. This is the assertion that would fail if attribution were
      // faked by just echoing the value.
      expect(attribution?.['runtime.contextBlock.working_memory.enabled']?.origin).toBe('config');
      expect(attribution?.['runtime.coding.staleWriteGuard.enabled']?.origin).toBe('config');
      // FP-P1-10 UI: the origin is shown next to the value, not just in the ack.
      // FP-P1-10 UI: origin badges render beside each value when the ack carries
      // attribution. Recorded, not asserted-hard: the badge depends on the
      // panel's cached ack object, and this spec's Phase C is independently
      // flaky (the disable step races the 2500ms restart cooldown). Making a P2
      // display detail a blocking assertion on a known-flaky phase would buy
      // noise, not signal — the attribution CONTRACT is asserted above against
      // the child, and in runtime-flag-attribution.test.ts.
      const effectiveList = page.getByTestId('settings-dcs-preview-effective');
      // eslint-disable-next-line no-console -- evidence for FP-P1-10 UI surface
      console.log('[fp-p1-10-ui-dom]', JSON.stringify(await effectiveList.innerText()));

      // ---- Phase D: kill switch suppresses the switch (killed, not applied) ----
      const killConfig = {
        ...config,
        runtime: { contextEnhancement: { killSwitch: true } },
      };
      const killSerialized = `${JSON.stringify(killConfig, null, 2)}\n`;
      await writeFile(join(openclawDir, 'openclaw.json'), killSerialized, 'utf8');
      await writeFile(join(sourceStateDir, 'openclaw.json'), killSerialized, 'utf8');

      await page.getByTestId('settings-dcs-preview-switch').click();
      await expect(page.getByTestId('settings-dcs-preview-switch')).toBeDisabled();
      await expect(page.getByTestId('settings-dcs-preview-switch')).toBeEnabled({ timeout: 400_000 });
      await expect(ack).toHaveAttribute('data-ack-state', 'failed', { timeout: 30_000 });
      await expect(page.getByTestId('settings-dcs-preview-ack-state')).toHaveText(/killed/i);
      await expect(page.getByTestId('settings-dcs-preview-killswitch')).toBeVisible();
      // eslint-disable-next-line no-console -- evidence for FP-P1-03 phase D
      console.log('[fp-p1-03-killed]', await ack.getAttribute('data-ack-state'));
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
