import { completeSetup, expect, test } from './fixtures/electron';


test.describe('Verse Claw developer-mode gated UI', () => {
  test('keeps raw diagnostics hidden until the local dev switch is enabled', async ({ page }, testInfo) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-footer-menu-trigger').click();
    await expect(page.getByTestId('sidebar-more-observability')).toBeVisible();
    await expect(page.getByTestId('sidebar-more-image-generation')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-more-dreams')).toHaveCount(0);
    await testInfo.attach('tf0505-developer-clean-surface', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByTestId('sidebar-footer-menu-trigger').click();

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-developer').click();
    await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'unchecked');
    await expect(page.getByTestId('settings-developer-gateway-token')).toHaveCount(0);
    await expect(page.getByTestId('settings-dcs-prod-flags')).toHaveCount(0);
    await expect(page.getByTestId('settings-vtoken-bridge')).toHaveCount(0);

    await page.evaluate(() => { window.location.hash = '#/dreams'; });
    await expect(page.getByTestId('dreams-page')).toHaveCount(0);
    await expect(page.getByTestId('main-layout')).toBeVisible();

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-developer').click();
    await page.getByTestId('settings-dev-mode-switch').click();
    await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'checked');
    await expect(page.getByTestId('settings-developer-section')).toBeVisible();
    await expect(page.getByTestId('settings-developer-gateway-token')).toBeVisible();
    await expect(page.getByTestId('settings-vtoken-bridge')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-more-dreams')).toHaveCount(0);
  });
});
