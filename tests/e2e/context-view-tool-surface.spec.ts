import { test, expect, openAgentDevScenario } from './fixtures/electron';

test.describe('TF-0495 context view tool surface', () => {
  test('keeps automatic discovery distinct from the explicit rollback control', async ({ page }) => {
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(120_000);

    // Navigate to the dev scenario, but tolerate 'load' being delayed by the
    // Electron file:// shell. The app readiness assertion below is the real
    // test precondition, not the browser load event.
    await openAgentDevScenario(page, 'chat-empty', { visualMode: true }).catch(() => undefined);
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="main-layout"]')) ||
        Boolean(document.querySelector('[data-testid="app-error-boundary"]')) ||
        document.readyState === 'complete',
      undefined,
      { timeout: 120_000 },
    );
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 120_000 });

    const settingsUrl = new URL(page.url());
    settingsUrl.searchParams.delete('devScenario');
    settingsUrl.hash = '/settings/developer';
    await page.goto(settingsUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await expect(page.getByTestId('settings-developer-section')).toBeVisible({ timeout: 120_000 });

    const panel = page.getByTestId('settings-dcs-prod-flags');
    if ((await panel.count()) === 0) {
      const unlock = page.getByTestId('settings-dev-mode-switch');
      if (await unlock.count()) await unlock.click();
    }
    await expect(panel).toBeVisible({ timeout: 120_000 });
    await page.getByTestId('settings-dcs-prod-flag-context-view-tools').click();

    const detail = page.getByTestId('settings-dcs-prod-flags-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('context_understand');
    await expect(page.getByTestId('settings-dcs-prod-flag-switch-context-view-tools')).toBeVisible();
    await expect(page.getByTestId('settings-dcs-view-tools-discover-banner')).toBeVisible();
  });
});
