import type { Locator, Page } from '@playwright/test';
import { completeSetup, expect, test } from './fixtures/electron';

async function ensureSwitchState(toggle: Locator, checked: boolean): Promise<void> {
  const currentState = await toggle.getAttribute('data-state');
  const isChecked = currentState === 'checked';
  if (isChecked !== checked) {
    await toggle.click();
  }
}

async function readProxyEnabled(page: Page): Promise<boolean> {
  return await page.evaluate(async () => {
    if (!window.verseClaw) throw new Error('verseClaw.hostInvoke unavailable');
    const response = await window.verseClaw.hostInvoke<{ proxyEnabled?: boolean }>({
      id: crypto.randomUUID(),
      module: 'settings',
      action: 'getAll',
    });
    if (!response.ok) throw new Error(response.error?.message || 'settings.getAll failed');
    return Boolean(response.data?.proxyEnabled);
  });
}

test.describe('Verse Claw developer proxy settings', () => {
  test('keeps proxy save available when disabling proxy in developer mode', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('settings-sidebar')).toBeVisible();
    await page.getByTestId('settings-nav-developer').click();
    await expect(page.getByTestId('settings-back-button')).toHaveCount(1);

    const devModeToggle = page.getByTestId('settings-dev-mode-switch');
    await expect(devModeToggle).toBeVisible();
    await ensureSwitchState(devModeToggle, true);

    const proxySection = page.getByTestId('settings-proxy-section');
    const proxyToggle = page.getByTestId('settings-proxy-toggle');
    const proxySaveButton = page.getByTestId('settings-proxy-save-button');

    await expect(proxySection).toBeVisible();
    await expect(proxyToggle).toBeVisible();
    await expect(proxySaveButton).toBeVisible();

    await ensureSwitchState(proxyToggle, true);
    await expect(proxySaveButton).toBeEnabled();
    await proxySaveButton.click();
    await expect.poll(async () => await readProxyEnabled(page)).toBe(true);

    await ensureSwitchState(proxyToggle, false);
    await expect(proxySaveButton).toBeVisible();
    await expect(proxySaveButton).toBeEnabled();
    await proxySaveButton.click();
    await expect.poll(async () => await readProxyEnabled(page)).toBe(false);
  });
});
