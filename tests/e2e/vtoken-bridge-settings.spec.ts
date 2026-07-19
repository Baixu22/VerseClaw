import { test, expect, openAgentDevScenario } from './fixtures/electron';

test.describe('Verse Token bridge developer surface', () => {
  test('shows VT bridge panel in Settings > Developer', async ({ page }) => {
    await openAgentDevScenario(page, 'chat-empty', { visualMode: true });
    await expect(page.getByTestId('main-layout')).toBeVisible();

    const settingsUrl = new URL(page.url());
    settingsUrl.searchParams.delete('devScenario');
    settingsUrl.hash = '/settings/developer';
    await page.goto(settingsUrl.toString());
    await expect(page.getByTestId('settings-developer-section')).toBeVisible();

    const panel = page.getByTestId('settings-vtoken-bridge');
    if (await panel.count() === 0) {
      const unlock = page.getByTestId('settings-dev-mode-switch');
      if (await unlock.count()) {
        await unlock.click();
      }
    }

    await expect(panel).toBeVisible();
    await expect(page.getByTestId('settings-vtoken-bridge-enabled-badge')).toBeVisible();
    await expect(page.getByTestId('settings-vtoken-bridge-running-badge')).toBeVisible();
    await expect(page.getByTestId('settings-vtoken-bridge-status')).toBeVisible();
    await expect(page.getByTestId('settings-vtoken-bridge-enable-switch')).toBeVisible();
    await expect(page.getByTestId('settings-vtoken-bridge-refresh')).toBeVisible();
    await expect(page.getByTestId('settings-vtoken-bridge-ensure')).toBeVisible();
    await expect(page.getByTestId('settings-vtoken-bridge-smoke')).toBeVisible();

    // Product default ON: badge should indicate enabled unless kill-switch is set.
    await expect(page.getByTestId('settings-vtoken-bridge-enabled-badge')).toContainText(
      /enabled|已启用|有効|включен/i,
    );
  });
});
