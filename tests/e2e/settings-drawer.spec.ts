import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function waitForBackgroundRoute(page: Awaited<ReturnType<typeof getStableWindow>>) {
  await expect.poll(() => new URL(page.url()).hash, { timeout: 3_000 }).toBe('#/');
  await expect(page.getByTestId('settings-drawer')).toHaveCount(0);
}

test.describe('Windows Settings AppleDrawer', () => {
  test.skip(process.platform !== 'win32', 'The overlay Settings route is a Windows UI v2 feature.');

  test('opens as a stable overlay route and closes only after the Vaul exit animation', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light' });

    try {
      const page = await getStableWindow(app);
      const settingsEntry = page.getByTestId('sidebar-nav-settings');
      await settingsEntry.focus();
      await settingsEntry.click();

      const drawer = page.getByTestId('settings-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer).toHaveAttribute('data-state', 'open');
      await expect(page.getByTestId('app-content-stage')).toHaveAttribute('data-depth', 'recessed');
      await expect(page.getByTestId('windows-titlebar')).toBeVisible();
      await page.waitForTimeout(1_000);
      const settledDrawer = await drawer.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          rightDelta: Math.abs(rect.right - window.innerWidth),
          rect: { left: rect.left, right: rect.right, width: rect.width },
          inlineStyle: element.getAttribute('style'),
          transform: style.transform,
          transition: style.transition,
          animationName: style.animationName,
          animationDuration: style.animationDuration,
          animationPlayState: style.animationPlayState,
          vaulAnimate: element.getAttribute('data-vaul-animate'),
        };
      });
      expect(settledDrawer.rightDelta, JSON.stringify(settledDrawer)).toBeLessThanOrEqual(1);

      const geometry = await page.evaluate(() => {
        const drawer = document.querySelector<HTMLElement>('[data-testid="settings-drawer"]')!;
        const titlebar = document.querySelector<HTMLElement>('[data-testid="windows-titlebar"]')!;
        const drawerRect = drawer.getBoundingClientRect();
        const titlebarRect = titlebar.getBoundingClientRect();
        return {
          drawerTop: drawerRect.top,
          drawerRight: drawerRect.right,
          viewportWidth: window.innerWidth,
          titlebarBottom: titlebarRect.bottom,
        };
      });
      expect(Math.abs(geometry.drawerTop - geometry.titlebarBottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.drawerRight - geometry.viewportWidth)).toBeLessThanOrEqual(1);
      await testInfo.attach('settings-drawer-light', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      await drawer.evaluate((element) => { element.setAttribute('data-e2e-stable-node', 'true'); });
      await page.getByTestId('settings-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();
      await expect(drawer).toHaveAttribute('data-e2e-stable-node', 'true');
      await expect.poll(() => new URL(page.url()).hash).toBe('#/settings/models');

      await page.getByTestId('settings-drawer-close').click();
      await expect(drawer).toHaveAttribute('data-state', 'closed');
      await page.waitForTimeout(120);
      expect(new URL(page.url()).hash).toBe('#/settings/models');

      await waitForBackgroundRoute(page);
      await expect(settingsEntry).toBeFocused();
      await expect(page.getByTestId('app-content-stage')).toHaveAttribute('data-depth', 'base');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('supports ESC, scrim, deep links, nested Select portals, and reduced motion', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, theme: 'light' });

    try {
      const page = await getStableWindow(app);
      const url = new URL(page.url());
      url.searchParams.set('e2eSkipSetup', '1');
      url.hash = '#/settings/models';
      await page.goto(url.toString());

      await expect(page.getByTestId('settings-drawer')).toBeVisible();
      await expect(page.getByTestId('models-page')).toBeVisible();

      await page.keyboard.press('Escape');
      await waitForBackgroundRoute(page);

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-drawer')).toBeVisible();
      await page.getByTestId('settings-drawer-overlay').click({ position: { x: 12, y: 80 }, force: true });
      await waitForBackgroundRoute(page);

      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-developer').click();
      const devModeSwitch = page.getByTestId('settings-dev-mode-switch');
      await expect(devModeSwitch).toBeVisible();
      if ((await devModeSwitch.getAttribute('data-state')) !== 'checked') {
        await devModeSwitch.click();
      }
      await expect(devModeSwitch).toHaveAttribute('data-state', 'checked');
      await page.getByTestId('settings-nav-system').click();
      const networkSelect = page.getByTestId('settings-sandbox-network-select');
      await expect(networkSelect).toBeVisible();
      await networkSelect.click();
      await expect(page.getByTestId('settings-drawer-portal-host').locator('[role="option"]').first()).toBeVisible();
      await page.keyboard.press('Escape');

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.reload();
      const reducedMotionState = await page.getByTestId('settings-drawer').evaluate((element) => ({
        animationDuration: getComputedStyle(element).animationDuration,
        stageTransform: getComputedStyle(document.querySelector<HTMLElement>('[data-testid="app-content-stage"]')!).transform,
      }));
      expect(reducedMotionState.animationDuration).toBe('0.16s');
      expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(reducedMotionState.stageTransform);
    } finally {
      await closeElectronApp(app);
    }
  });
});
