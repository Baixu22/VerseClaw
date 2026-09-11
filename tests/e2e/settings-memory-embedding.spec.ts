import type { Locator, Page } from '@playwright/test';
import { completeSetup, expect, test } from './fixtures/electron';

async function ensureSwitchState(toggle: Locator, checked: boolean): Promise<void> {
  const currentState = await toggle.getAttribute('data-state');
  const isChecked = currentState === 'checked';
  if (isChecked !== checked) {
    await toggle.click();
  }
}

async function readMemoryEmbeddingEnabled(page: Page): Promise<boolean> {
  return await page.evaluate(async () => {
    const settings = await window.electron.ipcRenderer.invoke('settings:getAll');
    return Boolean((settings as any)?.memoryEmbeddingEnabled);
  });
}

test.describe('Verse Claw memory embedding settings', () => {
  test('toggles memory embedding in system settings and persists', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('settings-sidebar')).toBeVisible();
    await page.getByTestId('settings-nav-system').click();
    await expect(page.getByTestId('settings-back-button')).toBeVisible();

    const section = page.getByTestId('settings-memory-embedding-section');
    const toggle = page.getByTestId('settings-memory-embedding-toggle');

    await expect(section).toBeVisible();
    await expect(toggle).toBeVisible();

    await ensureSwitchState(toggle, true);
    await expect.poll(async () => await readMemoryEmbeddingEnabled(page)).toBe(true);

    await ensureSwitchState(toggle, false);
    await expect.poll(async () => await readMemoryEmbeddingEnabled(page)).toBe(false);
  });
});
