import type { Page } from '@playwright/test';
import { completeSetup, expect, test } from './fixtures/electron';

async function readTelemetryEnabled(page: Page): Promise<boolean> {
  return await page.evaluate(async () => {
    const settings = await window.electron.ipcRenderer.invoke('settings:getAll');
    return Boolean((settings as { telemetryEnabled?: boolean } | undefined)?.telemetryEnabled);
  });
}

test.describe('Verse Claw telemetry consent (#129)', () => {
  test('applies the developer telemetry switch to persisted host settings at runtime', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await page.getByTestId('settings-nav-developer').click();

    const toggle = page.getByTestId('settings-telemetry-switch');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('data-state', 'checked');
    await expect.poll(async () => await readTelemetryEnabled(page)).toBe(true);

    // Opt out while the app is running: the Main-owned lifecycle must apply the
    // persisted value without a restart and the switch must stay responsive.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-state', 'unchecked');
    await expect.poll(async () => await readTelemetryEnabled(page)).toBe(false);

    // Re-enable is idempotent from the UI and still persists.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-state', 'checked');
    await expect.poll(async () => await readTelemetryEnabled(page)).toBe(true);
  });
});
