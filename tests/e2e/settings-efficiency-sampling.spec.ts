import type { Locator, Page } from '@playwright/test';
import { completeSetup, expect, test } from './fixtures/electron';
import type { RuntimeEfficiencyState } from '../../shared/host-api/contract';

async function ensureSwitchState(toggle: Locator, checked: boolean): Promise<void> {
  const currentState = await toggle.getAttribute('data-state');
  if ((currentState === 'checked') !== checked) {
    await toggle.click();
  }
}

async function readEfficiencyState(page: Page): Promise<RuntimeEfficiencyState> {
  return await page.evaluate(async () => {
    const bridge = (window as unknown as {
      verseClaw?: { hostInvoke: (request: unknown) => Promise<unknown> };
    }).verseClaw;
    const response = await bridge?.hostInvoke({
      id: 'e2e-efficiency-get-state',
      module: 'efficiency',
      action: 'getState',
    });
    const record = response as { ok?: boolean; data?: RuntimeEfficiencyState } | undefined;
    if (!record?.ok || !record.data) throw new Error('Efficiency host state unavailable');
    return record.data;
  });
}

test.describe('Verse Claw runtime efficiency sampling settings', () => {
  test('toggles recording while retaining resource protection and persists', async ({ page }, testInfo) => {
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
    await expect.poll(async () => (await readEfficiencyState(page)).enabled).toBe(false);
    const disabled = await readEfficiencyState(page);
    expect(disabled.running).toBe(false);
    expect(disabled.backgroundWork).not.toBeNull();
    expect(disabled.shed).not.toBeNull();
    await testInfo.attach('sampling-disabled-protection.json', {
      body: JSON.stringify({ driven_by: 'agent', enabled: disabled.enabled, running: disabled.running, backgroundWork: disabled.backgroundWork, shed: disabled.shed }),
      contentType: 'application/json',
    });

    await ensureSwitchState(toggle, true);
    await expect(toggle).toHaveAttribute('data-state', 'checked');
    await expect.poll(async () => (await readEfficiencyState(page)).enabled).toBe(true);
    await expect.poll(async () => (await readEfficiencyState(page)).running).toBe(true);
  });
});
