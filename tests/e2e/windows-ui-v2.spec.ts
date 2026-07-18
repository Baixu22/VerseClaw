import { closeElectronApp, expect, getStableWindow, openAgentDevScenario, test } from './fixtures/electron';

test.describe('Windows UI v2 shell', () => {
  test.skip(process.platform !== 'win32', 'Windows UI v2 is enabled by default only on Windows.');

  test('uses the liquid split-view shell by default and keeps the titlebar outside the content stage', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light' });

    try {
      const page = await getStableWindow(app);
      const layout = page.getByTestId('main-layout');
      const titlebar = page.getByTestId('windows-titlebar');
      const stage = page.getByTestId('app-content-stage');

      await expect(layout).toHaveAttribute('data-ui-version', 'v2');
      await expect(titlebar).toBeVisible();
      await expect(stage).toHaveAttribute('data-depth', 'base');

      const metrics = await page.evaluate(() => {
        const titlebar = document.querySelector<HTMLElement>('[data-testid="windows-titlebar"]')!;
        const stage = document.querySelector<HTMLElement>('[data-testid="app-content-stage"]')!;
        const sidebar = document.querySelector<HTMLElement>('[data-testid="sidebar"]')!;
        const titlebarRect = titlebar.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        const sidebarRect = sidebar.getBoundingClientRect();
        return {
          titlebar: { top: titlebarRect.top, height: titlebarRect.height, bottom: titlebarRect.bottom },
          stage: { top: stageRect.top, height: stageRect.height },
          sidebarWidth: sidebarRect.width,
        };
      });

      expect(metrics.titlebar.top).toBe(0);
      expect(metrics.titlebar.height).toBe(40);
      expect(Math.abs(metrics.stage.top - metrics.titlebar.bottom)).toBeLessThanOrEqual(1);
      expect(metrics.sidebarWidth).toBeGreaterThanOrEqual(240);
      expect(metrics.sidebarWidth).toBeLessThanOrEqual(360);
      const lightColors = await page.evaluate(() => {
        const read = (testId: string) => getComputedStyle(document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!).backgroundColor;
        return {
          sidebar: read('sidebar'),
          main: read('main-content'),
          chat: read('chat-page'),
        };
      });
      for (const color of Object.values(lightColors)) {
        const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [];
        expect(channels, color).toHaveLength(3);
        expect(Math.min(...channels), color).toBeGreaterThan(220);
        expect(Math.max(...channels) - Math.min(...channels), color).toBeLessThanOrEqual(12);
      }
      const elevatedToken = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--material-elevated').trim());
      const elevatedLightness = Number(elevatedToken.match(/([\d.]+)%\s*$/)?.[1] ?? 100);
      expect(elevatedLightness, elevatedToken).toBeLessThan(100);
      await testInfo.attach('windows-ui-v2-light', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps dark materials neutral without inheriting light-only overrides', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark' });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toHaveAttribute('data-ui-version', 'v2');
      const darkColors = await page.evaluate(() => {
        const read = (testId: string) => getComputedStyle(document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!).backgroundColor;
        return { sidebar: read('sidebar'), chat: read('chat-page') };
      });
      for (const color of Object.values(darkColors)) {
        const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [];
        expect(Math.max(...channels), color).toBeLessThan(60);
      }
      await testInfo.attach('windows-ui-v2-dark', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('registers an interactive UI v2 Agent Dev showcase', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, theme: 'light' });

    try {
      const page = await getStableWindow(app);
      await openAgentDevScenario(page, 'ui-v2-showcase', { visualMode: true });
      await expect(page.getByTestId('ui-v2-showcase')).toBeVisible();
      await expect(page.locator('[data-material-level]')).toHaveCount(5);
      await page.getByTestId('ui-v2-showcase-open-drawer').click();
      await expect(page.getByTestId('ui-v2-showcase-drawer')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('ui-v2-showcase-drawer')).toHaveCount(0, { timeout: 2_000 });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('supports the development-only legacy query override', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, theme: 'light' });

    try {
      const page = await getStableWindow(app);
      const url = new URL(page.url());
      url.searchParams.set('e2eSkipSetup', '1');
      url.searchParams.set('uiVersion', 'legacy');
      url.hash = '#/';
      await page.goto(url.toString());

      await expect(page.getByTestId('main-layout')).toHaveAttribute('data-ui-version', 'legacy');
      await expect(page.getByTestId('app-content-stage')).not.toHaveClass(/app-content-stage-v2/);
      await expect(page.getByTestId('settings-drawer')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
