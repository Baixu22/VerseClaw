import { test, expect, openAgentDevScenario } from './fixtures/electron';

test.describe('DCS production P0 packaging surface', () => {
  test('shows opt-in DCS production flags panel in Settings > Developer', async ({ page }) => {
    await openAgentDevScenario(page, 'chat-empty', { visualMode: true });
    await expect(page.getByTestId('main-layout')).toBeVisible();

    const settingsUrl = new URL(page.url());
    settingsUrl.searchParams.delete('devScenario');
    settingsUrl.hash = '/settings/developer';
    await page.goto(settingsUrl.toString());
    await expect(page.getByTestId('settings-developer-section')).toBeVisible();

    const panel = page.getByTestId('settings-dcs-prod-flags');
    if (await panel.count() === 0) {
      const unlock = page.getByTestId('settings-dev-mode-switch');
      if (await unlock.count()) {
        await unlock.click();
      }
    }

    await expect(panel).toBeVisible();
    await expect(page.getByTestId('settings-dcs-prod-flags-mode')).toBeVisible();
    await expect(page.getByTestId('settings-dcs-prod-flags-list')).toBeVisible();
    await expect(page.getByTestId('settings-dcs-prod-flag-context-view-tools')).toBeVisible();
    await page.getByTestId('settings-dcs-prod-flag-stale-write-guard').click();
    await expect(page.getByTestId('settings-dcs-prod-flags-detail')).toContainText('staleWriteGuard');
  });
});