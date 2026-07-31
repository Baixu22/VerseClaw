import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function waitForAppRoute(page: Awaited<ReturnType<typeof getStableWindow>>) {
  await expect.poll(() => new URL(page.url()).hash, { timeout: 3_000 }).toBe('#/');
  await expect(page.getByTestId('settings-page')).toHaveCount(0);
  await expect(page.getByTestId('sidebar')).toBeVisible();
}

test.describe('Windows full-page Settings', () => {
  test.skip(process.platform !== 'win32', 'The full-page Settings shell is validated on Windows UI v2.');

  test('opens as a routed page and returns to the exact application route', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light' });

    try {
      const page = await getStableWindow(app);
      const settingsEntry = page.getByTestId('sidebar-nav-settings');
      await settingsEntry.focus();
      await settingsEntry.click();

      await expect(page).toHaveURL(/#\/settings\/general$/);
      await expect(page.getByTestId('settings-page')).toHaveAttribute('data-presentation', 'page');
      await expect(page.getByTestId('settings-sidebar')).toBeVisible();
      await expect(page.getByTestId('settings-drawer')).toHaveCount(0);
      await expect(page.getByTestId('windows-titlebar')).toBeVisible();
      await expect(page.locator('[data-layout-id]')).toHaveCount(0);

      const geometry = await page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>('[data-testid="app-content-stage"]')!.getBoundingClientRect();
        const rail = document.querySelector<HTMLElement>('[data-testid="settings-sidebar"]')!.getBoundingClientRect();
        const settingsPage = document.querySelector<HTMLElement>('[data-testid="settings-page"]')!.getBoundingClientRect();
        return {
          railWidth: rail.width,
          railRight: rail.right,
          pageLeft: settingsPage.left,
          pageTop: settingsPage.top,
          pageBottom: settingsPage.bottom,
          stageTop: stage.top,
          stageBottom: stage.bottom,
        };
      });
      expect(Math.abs(geometry.railWidth - 275)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.railRight - geometry.pageLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.pageTop - geometry.stageTop)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.pageBottom - geometry.stageBottom)).toBeLessThanOrEqual(1);

      const screenshotPath = testInfo.outputPath('settings-page-light.png');
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach('settings-page-light', { path: screenshotPath, contentType: 'image/png' });

      await page.getByTestId('settings-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();
      await expect(page).toHaveURL(/#\/settings\/models$/);

      await page.getByTestId('settings-back-button').click();
      await waitForAppRoute(page);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('supports direct links, nested Select portals, narrow geometry, and reduced motion', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, theme: 'light' });

    try {
      const page = await getStableWindow(app);
      const url = new URL(page.url());
      url.searchParams.set('e2eSkipSetup', '1');
      url.hash = '#/settings/models';
      await page.goto(url.toString());

      await expect(page.getByTestId('settings-sidebar')).toBeVisible();
      await expect(page.getByTestId('models-page')).toBeVisible();
      await expect(page.getByTestId('settings-drawer')).toHaveCount(0);

      await page.getByTestId('settings-nav-developer').click();
      const devModeSwitch = page.getByTestId('settings-dev-mode-switch');
      await expect(devModeSwitch).toBeVisible();
      if ((await devModeSwitch.getAttribute('data-state')) !== 'checked') await devModeSwitch.click();
      await page.getByTestId('settings-nav-system').click();
      const networkSelect = page.getByTestId('settings-sandbox-network-select');
      await expect(networkSelect).toBeVisible();
      await networkSelect.click();
      await expect(page.getByTestId('app-overlay-root').getByRole('option').first()).toBeVisible();
      await page.keyboard.press('Escape');

      await page.setViewportSize({ width: 1000, height: 820 });
      const overflow = await page.locator('.codex-settings-page__scroll').evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.reload();
      const reducedMotionState = await page.getByTestId('settings-page').evaluate((element) => ({
        pageAnimation: getComputedStyle(element).animationName,
        backTransition: getComputedStyle(document.querySelector<HTMLElement>('[data-testid="settings-back-button"]')!).transitionDuration,
      }));
      expect(reducedMotionState.pageAnimation).toBe('none');
      expect(['0s', '']).toContain(reducedMotionState.backTransition);

      await page.getByTestId('settings-back-button').click();
      await waitForAppRoute(page);
    } finally {
      await closeElectronApp(app);
    }
  });
});
