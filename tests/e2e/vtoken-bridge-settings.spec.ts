import { test, expect, openAgentDevScenario } from './fixtures/electron';

test.describe('Verse Token internal-only positioning', () => {
  test('does not expose a VT bridge switch or standalone panel in Settings > Developer', async ({ page }) => {
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(60_000);
    await openAgentDevScenario(page, 'chat-empty', { visualMode: true });
    await expect(page.getByTestId('main-layout')).toBeVisible();

    const settingsUrl = new URL(page.url());
    settingsUrl.searchParams.delete('devScenario');
    settingsUrl.hash = '/settings/developer';
    await page.goto(settingsUrl.toString());
    await expect(page.getByTestId('settings-developer-section')).toBeVisible();

    const unlock = page.getByTestId('settings-dev-mode-switch');
    if (await unlock.count()) {
      await unlock.click();
    }

    await expect(page.getByTestId('settings-vtoken-bridge')).toHaveCount(0);
    await expect(page.getByTestId('settings-vtoken-bridge-enable-switch')).toHaveCount(0);
    await expect(page.getByTestId('settings-context-layers-vtoken')).toHaveCount(0);
  });
});
