import type { Locator, Page } from '@playwright/test';
import { completeSetup, expect, test } from './fixtures/electron';

async function ensureSwitchState(toggle: Locator, checked: boolean): Promise<void> {
  const currentState = await toggle.getAttribute('data-state');
  if ((currentState === 'checked') !== checked) {
    await toggle.click();
  }
}

async function readEfficiencyEnabled(page: Page): Promise<boolean> {
  return await page.evaluate(async () => {
    const bridge = (window as unknown as {
      verseClaw?: { hostInvoke: (request: unknown) => Promise<unknown> };
    }).verseClaw;
    const response = await bridge?.hostInvoke({
      id: 'e2e-efficiency-get-state',
      module: 'efficiency',
      action: 'getState',
    });
    const record = response as { ok?: boolean; data?: { enabled?: boolean } } | undefined;
    return Boolean(record?.ok && record.data?.enabled);
  });
}

test.describe('Verse Claw runtime efficiency sampling settings', () => {
  test('toggles sampling, fails closed when unmeasured, and persists', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await page.getByTestId('settings-nav-developer').click();

    // The developer section is gated; unlock it before asserting the panel.
    await expect(page.getByTestId('settings-dev-mode-switch')).toBeVisible();
    await page.getByTestId('settings-dev-mode-switch').click();
    await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'checked');
    await expect(page.getByTestId('settings-developer-section')).toBeVisible();

    const section = page.getByTestId('settings-efficiency-sampling');
    const toggle = page.getByTestId('settings-efficiency-toggle');
    await expect(section).toBeVisible();
    await expect(toggle).toBeVisible();

    // Fail-closed: before the first 5s sample the readout must say not-sampled.
    await expect(page.getByTestId('settings-efficiency-not-sampled')).toBeVisible();
    await expect(page.getByTestId('settings-efficiency-sample-count')).toHaveCount(0);

    await ensureSwitchState(toggle, false);
    await expect(toggle).toHaveAttribute('data-state', 'unchecked');
    await expect(page.getByTestId('settings-efficiency-not-sampled')).toBeVisible();
    await expect.poll(async () => await readEfficiencyEnabled(page)).toBe(false);

    await ensureSwitchState(toggle, true);
    await expect(toggle).toHaveAttribute('data-state', 'checked');
    await expect.poll(async () => await readEfficiencyEnabled(page)).toBe(true);
  });
});
