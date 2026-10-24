import type { Locator, Page } from '@playwright/test';
import { test, expect, openAgentDevScenario } from './fixtures/electron';

async function ensureDevPanel(page: Page) {
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);
  await openAgentDevScenario(page, 'chat-empty', { visualMode: true });
  await expect(page.getByTestId('main-layout')).toBeVisible();

  const settingsUrl = new URL(page.url());
  settingsUrl.searchParams.delete('devScenario');
  settingsUrl.hash = '/settings/developer';
  await page.goto(settingsUrl.toString());
  await expect(page.getByTestId('settings-developer-section')).toBeVisible();

  const panel = page.getByTestId('settings-dcs-prod-flags');
  if ((await panel.count()) === 0) {
    const unlock = page.getByTestId('settings-dev-mode-switch');
    if (await unlock.count()) {
      await unlock.click();
    }
  }
  await expect(panel).toBeVisible();
  return panel;
}

async function ensureSwitchState(toggle: Locator, checked: boolean): Promise<void> {
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled({ timeout: 15_000 });
  const currentState = await toggle.getAttribute('data-state');
  const isChecked = currentState === 'checked';
  if (isChecked === checked) return;
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-state', checked ? 'checked' : 'unchecked', {
    timeout: 15_000,
  });
}

async function readAppSettingFlag(page: Page, key: string): Promise<boolean> {
  return page.evaluate(async (settingKey) => {
    const settings = await window.electron.ipcRenderer.invoke('settings:getAll');
    return Boolean((settings as Record<string, unknown> | undefined)?.[settingKey]);
  }, key);
}

async function hostGetDcsFlags(page: Page): Promise<{
  flags: Array<{ id: string; enabled: boolean; writable: boolean; status: string }>;
}> {
  return page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        verseClaw?: {
          hostInvoke: (input: Record<string, unknown>) => Promise<{
            ok: boolean;
            data?: unknown;
            error?: { message?: string };
          }>;
        };
      }
    ).verseClaw?.hostInvoke;
    if (!bridge) throw new Error('verseClaw.hostInvoke unavailable');
    const response = await bridge({
      id: `dcs-flags-${Date.now()}`,
      module: 'dcsProdFlags',
      action: 'getFlags',
    });
    if (!response?.ok) {
      throw new Error(response?.error?.message || 'dcsProdFlags.getFlags failed');
    }
    return response.data as {
      flags: Array<{ id: string; enabled: boolean; writable: boolean; status: string }>;
    };
  });
}

test.describe('DCS production P0 packaging surface', () => {
  test('shows opt-in DCS production flags panel in Settings > Developer', async ({ page }) => {
    await ensureDevPanel(page);
    await expect(page.getByTestId('settings-dcs-prod-flags-mode')).toBeVisible();
    await expect(page.getByTestId('settings-context-layers-explainer')).toHaveCount(0);
    await expect(page.getByTestId('settings-context-layers-vtoken')).toHaveCount(0);
    await expect(page.getByTestId('settings-dcs-prod-flags-layer-role')).toBeVisible();
    await expect(page.getByTestId('settings-dcs-observability-panel')).toBeVisible();
    await expect(page.getByTestId('settings-dcs-observability-kill')).toBeVisible();
    await expect(page.getByTestId('settings-dcs-prod-flags-list')).toBeVisible();
    await expect(page.getByTestId('settings-dcs-prod-flag-context-view-tools')).toBeVisible();
    await expect(page.getByTestId('settings-dcs-prod-flags-refresh')).toBeVisible();

    // Writable control plane: view tools row exposes a switch (default off).
    await page.getByTestId('settings-dcs-prod-flag-context-view-tools').click();
    const viewSwitch = page.getByTestId('settings-dcs-prod-flag-switch-context-view-tools');
    await expect(viewSwitch).toBeVisible();
    await expect(viewSwitch).toHaveAttribute('data-state', 'unchecked');

    await page.getByTestId('settings-dcs-prod-flag-stale-write-guard').click();
    await expect(page.getByTestId('settings-dcs-prod-flags-detail')).toContainText('staleWriteGuard');
    await expect(page.getByTestId('settings-dcs-prod-flag-switch-stale-write-guard')).toBeVisible();

    // TASK-P1-02: working-memory is a writable Settings config flag (default off)
    await page.getByTestId('settings-dcs-prod-flag-working-memory').click();
    const wmSwitch = page.getByTestId('settings-dcs-prod-flag-switch-working-memory');
    await expect(wmSwitch).toBeVisible();
    await expect(wmSwitch).toHaveAttribute('data-state', 'unchecked');

    // TASK-P1-03: tool-registry writable (default off)
    await page.getByTestId('settings-dcs-prod-flag-tool-registry').click();
    const trSwitch = page.getByTestId('settings-dcs-prod-flag-switch-tool-registry');
    await expect(trSwitch).toBeVisible();
    await expect(trSwitch).toHaveAttribute('data-state', 'unchecked');
  });

  test('renders the DCS control surface in Japanese and Russian', async ({ page }) => {
    await ensureDevPanel(page);

    await page.getByTestId('settings-nav-general').click();
    // Language is now a SettingsSelect dropdown (listbox), not inline buttons.
    await page.getByTestId('settings-language-select').click();
    await page.getByRole('option', { name: '日本語', exact: true }).click();
    await page.getByTestId('settings-nav-developer').click();
    await expect(page.getByTestId('settings-context-layers-explainer')).toHaveCount(0);
    await expect(page.getByTestId('settings-dcs-prod-flags')).toContainText(
      'DCS Controlled Preview フラグ',
    );

    await page.getByTestId('settings-nav-general').click();
    await page.getByTestId('settings-language-select').click();
    await page.getByRole('option', { name: 'Русский', exact: true }).click();
    await page.getByTestId('settings-nav-developer').click();
    await expect(page.getByTestId('settings-context-layers-explainer')).toHaveCount(0);
    await expect(page.getByTestId('settings-dcs-prod-flags')).toContainText(
      'Флаги DCS Controlled Preview',
    );

    await page.getByTestId('settings-nav-general').click();
    await page.getByTestId('settings-language-select').click();
    await page.getByRole('option', { name: 'English', exact: true }).click();
  });

  test('toggles writable flags, persists store, and restores baseline', async ({ page }) => {
    await ensureDevPanel(page);

    // --- env-class: context view tools ---
    await page.getByTestId('settings-dcs-prod-flag-context-view-tools').click();
    const viewSwitch = page.getByTestId('settings-dcs-prod-flag-switch-context-view-tools');
    await expect(viewSwitch).toBeVisible();
    await expect(viewSwitch).toHaveAttribute('data-state', 'unchecked');

    await ensureSwitchState(viewSwitch, true);
    await expect
      .poll(async () => readAppSettingFlag(page, 'dcsContextViewToolsEnabled'), { timeout: 15_000 })
      .toBe(true);
    await expect
      .poll(async () => {
        const snap = await hostGetDcsFlags(page);
        return snap.flags.find((f) => f.id === 'context-view-tools')?.enabled;
      }, { timeout: 15_000 })
      .toBe(true);

    await ensureSwitchState(viewSwitch, false);
    await expect
      .poll(async () => readAppSettingFlag(page, 'dcsContextViewToolsEnabled'), { timeout: 15_000 })
      .toBe(false);
    await expect
      .poll(async () => {
        const snap = await hostGetDcsFlags(page);
        return snap.flags.find((f) => f.id === 'context-view-tools')?.enabled;
      }, { timeout: 15_000 })
      .toBe(false);

    // --- config-class: working-memory (TASK-P1-02) ---
    await page.getByTestId('settings-dcs-prod-flag-working-memory').click();
    const wmSwitch = page.getByTestId('settings-dcs-prod-flag-switch-working-memory');
    await expect(wmSwitch).toBeVisible();
    await ensureSwitchState(wmSwitch, true);
    await expect
      .poll(async () => readAppSettingFlag(page, 'dcsWorkingMemoryEnabled'), { timeout: 15_000 })
      .toBe(true);
    await ensureSwitchState(wmSwitch, false);
    await expect
      .poll(async () => readAppSettingFlag(page, 'dcsWorkingMemoryEnabled'), { timeout: 15_000 })
      .toBe(false);

    // --- config-class: stale write guard ---
    await page.getByTestId('settings-dcs-prod-flag-stale-write-guard').click();
    const staleSwitch = page.getByTestId('settings-dcs-prod-flag-switch-stale-write-guard');
    await expect(staleSwitch).toBeVisible();
    await ensureSwitchState(staleSwitch, true);
    await expect
      .poll(async () => readAppSettingFlag(page, 'dcsStaleWriteGuardEnabled'), { timeout: 15_000 })
      .toBe(true);
    await expect
      .poll(async () => {
        const snap = await hostGetDcsFlags(page);
        const row = snap.flags.find((f) => f.id === 'stale-write-guard');
        return row?.enabled === true && row.writable === true;
      }, { timeout: 15_000 })
      .toBe(true);

    await ensureSwitchState(staleSwitch, false);
    await expect
      .poll(async () => readAppSettingFlag(page, 'dcsStaleWriteGuardEnabled'), { timeout: 15_000 })
      .toBe(false);

    // read-only row (patch-flow) must not expose a switch
    await page.getByTestId('settings-dcs-prod-flag-patch-flow').click();
    await expect(page.getByTestId('settings-dcs-prod-flags-detail')).toBeVisible();
    await expect(page.getByTestId('settings-dcs-prod-flag-switch-patch-flow')).toHaveCount(0);
    await expect(page.getByTestId('settings-dcs-prod-flags-readonly-hint')).toBeVisible();
  });

  test('shows discoverability banner for hidden view tools and one-click enable', async ({ page }) => {
    await ensureDevPanel(page);

    const banner = page.getByTestId('settings-dcs-view-tools-discover-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-state', 'disabled');
    await expect(page.getByTestId('settings-dcs-view-tools-discover-enable')).toBeVisible();

    await page.getByTestId('settings-dcs-view-tools-discover-focus').click();
    await expect(page.getByTestId('settings-dcs-prod-flag-switch-context-view-tools')).toBeVisible();
    await expect(page.getByTestId('settings-dcs-view-tools-detail-hint')).toBeVisible();

    await page.getByTestId('settings-dcs-view-tools-discover-enable').click();
    await expect
      .poll(async () => readAppSettingFlag(page, 'dcsContextViewToolsEnabled'), { timeout: 15_000 })
      .toBe(true);
    await expect(banner).toHaveAttribute('data-state', 'enabled');

    // restore baseline
    await ensureSwitchState(
      page.getByTestId('settings-dcs-prod-flag-switch-context-view-tools'),
      false,
    );
    await expect
      .poll(async () => readAppSettingFlag(page, 'dcsContextViewToolsEnabled'), { timeout: 15_000 })
      .toBe(false);
    await expect(banner).toHaveAttribute('data-state', 'disabled');
  });
});
