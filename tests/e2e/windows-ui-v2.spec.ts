import { closeElectronApp, expect, getStableWindow, openAgentDevScenario, test } from './fixtures/electron';

test.describe('Cross-platform FakeCoding UI v2 shell', () => {
  test('uses neutral work surfaces by default and keeps native titlebar controls outside the content stage', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light' });

    try {
      const page = await getStableWindow(app);
      const layout = page.getByTestId('main-layout');
      const stage = page.getByTestId('app-content-stage');

      await expect(layout).toHaveAttribute('data-ui-version', 'v2');
      await expect(stage).toHaveAttribute('data-depth', 'base');
      if (process.platform === 'win32') {
        await expect(page.getByTestId('windows-titlebar')).toBeVisible();
      }

      const metrics = await page.evaluate(() => {
        const titlebar = document.querySelector<HTMLElement>('[data-testid="windows-titlebar"]');
        const stageElement = document.querySelector<HTMLElement>('[data-testid="app-content-stage"]')!;
        const sidebar = document.querySelector<HTMLElement>('[data-testid="sidebar"]')!;
        const titlebarRect = titlebar?.getBoundingClientRect();
        const stageRect = stageElement.getBoundingClientRect();
        const sidebarRect = sidebar.getBoundingClientRect();
        return {
          titlebar: titlebarRect ? { top: titlebarRect.top, height: titlebarRect.height, bottom: titlebarRect.bottom } : null,
          stage: { top: stageRect.top, height: stageRect.height },
          sidebarWidth: sidebarRect.width,
        };
      });

      if (process.platform === 'win32') {
        expect(metrics.titlebar?.top).toBe(0);
        expect(metrics.titlebar?.height).toBe(34);
        expect(Math.abs(metrics.stage.top - (metrics.titlebar?.bottom ?? 0))).toBeLessThanOrEqual(1);
      } else {
        expect(metrics.titlebar).toBeNull();
      }
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
        expect(Math.min(...channels), color).toBeGreaterThan(225);
        expect(Math.max(...channels) - Math.min(...channels), color).toBeLessThanOrEqual(8);
      }
      const elevatedToken = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--material-elevated').trim());
      const elevatedLightness = Number(elevatedToken.match(/([\d.]+)%\s*$/)?.[1] ?? 0);
      expect(elevatedLightness, elevatedToken).toBe(100);

      await testInfo.attach('fakecoding-ui-v2-light', {
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
        expect(Math.max(...channels) - Math.min(...channels), color).toBeLessThanOrEqual(8);
      }
      await testInfo.attach('fakecoding-ui-v2-dark', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('registers an interactive design-system showcase and enforces visual constraints', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, theme: 'light' });

    try {
      const page = await getStableWindow(app);
      await openAgentDevScenario(page, 'ui-v2-showcase', { visualMode: true });
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(page.getByTestId('ui-v2-showcase')).toBeVisible();
      await expect(page.locator('[data-material-level]')).toHaveCount(5);
      await expect(page.getByTestId('ui-v2-showcase-codex-icons').locator('svg')).toHaveCount(5);
      await expect(page.getByTestId('ui-v2-showcase-badges').locator('[class*="rounded-md"]')).toHaveCount(4);

      const contract = await page.evaluate(() => {
        const showcase = document.querySelector<HTMLElement>('[data-testid="ui-v2-showcase"]')!;
        const heading = showcase.querySelector<HTMLElement>('h1')!;
        const primary = showcase.querySelector<HTMLElement>('[data-testid="ui-v2-showcase-open-dialog"]')!;
        const icon = showcase.querySelector<SVGElement>('[data-testid="ui-v2-showcase-codex-icons"] svg')!;
        const badge = showcase.querySelector<HTMLElement>('[data-testid="ui-v2-showcase-default-badge"]')!;
        const toggle = showcase.querySelector<HTMLElement>('[data-testid="ui-v2-showcase-switch"]')!;
        const card = showcase.querySelector<HTMLElement>('[data-testid="ui-v2-showcase-card"]')!;
        const textarea = showcase.querySelector<HTMLElement>('[data-testid="ui-v2-showcase-textarea"]')!;
        const headingStyle = getComputedStyle(heading);
        const primaryStyle = getComputedStyle(primary);
        const badgeStyle = getComputedStyle(badge);
        const toggleStyle = getComputedStyle(toggle);
        const cardStyle = getComputedStyle(card);
        const textareaStyle = getComputedStyle(textarea);
        return {
          headingSize: Number.parseFloat(headingStyle.fontSize),
          headingSpacing: headingStyle.letterSpacing,
          primaryHeight: primary.getBoundingClientRect().height,
          primaryBackground: primaryStyle.backgroundColor,
          iconViewBox: icon.getAttribute('viewBox'),
          iconStroke: icon.getAttribute('stroke'),
          iconStrokeWidth: icon.getAttribute('stroke-width'),
          iconLineCap: icon.getAttribute('stroke-linecap'),
          iconLineJoin: icon.getAttribute('stroke-linejoin'),
          badgeHeight: badge.getBoundingClientRect().height,
          badgeRadius: Number.parseFloat(badgeStyle.borderRadius),
          badgeBackground: badgeStyle.backgroundColor,
          switchWidth: toggle.getBoundingClientRect().width,
          switchHeight: toggle.getBoundingClientRect().height,
          switchBackground: toggleStyle.backgroundColor,
          cardRadius: Number.parseFloat(cardStyle.borderRadius),
          cardBackdrop: cardStyle.backdropFilter,
          textareaFontSize: Number.parseFloat(textareaStyle.fontSize),
          textareaBackground: textareaStyle.backgroundColor,
          primaryCount: showcase.querySelectorAll('button.bg-foreground').length,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

      expect(contract.headingSize).toBeLessThanOrEqual(28);
      expect(contract.headingSpacing).toBe('normal');
      expect(contract.primaryHeight).toBeLessThanOrEqual(36);
      const primaryChannels = contract.primaryBackground.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [];
      expect(primaryChannels).toHaveLength(3);
      expect(Math.max(...primaryChannels) - Math.min(...primaryChannels)).toBeLessThanOrEqual(8);
      expect(contract.iconViewBox).toBe('0 0 24 24');
      expect(contract.iconStroke).toBe('currentColor');
      expect(contract.iconStrokeWidth).toBe('2');
      expect(contract.iconLineCap).toBe('round');
      expect(contract.iconLineJoin).toBe('round');
      expect(contract.badgeHeight).toBe(20);
      // The shared ladder is fixed at 1.25x: md = 8px * 1.25, lg = 10px * 1.25.
      expect(contract.badgeRadius).toBeCloseTo(10, 1);
      expect(contract.switchWidth).toBe(32);
      expect(contract.switchHeight).toBe(20);
      expect(contract.cardRadius).toBeCloseTo(12.5, 1);
      expect(contract.cardBackdrop).toBe('none');
      expect(contract.textareaFontSize).toBe(13);
      for (const color of [contract.badgeBackground, contract.switchBackground, contract.textareaBackground]) {
        const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [];
        expect(channels, color).toHaveLength(3);
        expect(Math.max(...channels) - Math.min(...channels), color).toBeLessThanOrEqual(8);
      }
      expect(contract.primaryCount).toBe(1);
      expect(contract.pageOverflow).toBeLessThanOrEqual(0);

      await testInfo.attach('fakecoding-showcase-1280x800', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      await page.setViewportSize({ width: 960, height: 800 });
      const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(narrowOverflow).toBeLessThanOrEqual(0);
      await testInfo.attach('fakecoding-showcase-960x800', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      await page.getByTestId('ui-v2-theme-dark').click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(page.getByTestId('ui-v2-theme-dark')).toHaveClass(/bg-material-elevated/);
      await expect.poll(async () => {
        const color = await page.getByTestId('ui-v2-showcase-textarea').evaluate((element) => getComputedStyle(element).backgroundColor);
        const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [255];
        return Math.max(...channels);
      }).toBeLessThan(60);
      await testInfo.attach('fakecoding-showcase-dark-960x800', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      await page.setViewportSize({ width: 1280, height: 800 });
      await testInfo.attach('fakecoding-showcase-dark-1280x800', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      await page.getByTestId('ui-v2-showcase-tooltip-trigger').hover();
      await expect(page.getByTestId('ui-v2-showcase-tooltip')).toBeVisible();
      expect(await page.getByTestId('ui-v2-showcase-tooltip').evaluate((element) => {
        const overlayRoot = document.querySelector('#app-overlay-root');
        const showcase = document.querySelector('[data-testid="ui-v2-showcase"]');
        return Boolean(overlayRoot?.contains(element)) && !showcase?.contains(element);
      })).toBe(true);

      await page.getByTestId('ui-v2-showcase-select').click();
      await expect(page.getByTestId('ui-v2-showcase-select-menu')).toBeVisible();
      expect(await page.getByTestId('ui-v2-showcase-select-menu').evaluate((element) => {
        const overlayRoot = document.querySelector('#app-overlay-root');
        const showcase = document.querySelector('[data-testid="ui-v2-showcase"]');
        return Boolean(overlayRoot?.contains(element)) && !showcase?.contains(element);
      })).toBe(true);
      await page.keyboard.press('Escape');

      await page.getByTestId('ui-v2-showcase-open-sheet').click();
      await expect(page.getByTestId('ui-v2-showcase-sheet')).toBeVisible();
      const sheetContract = await page.evaluate(() => {
        const overlay = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]')!;
        const content = document.querySelector<HTMLElement>('[data-testid="ui-v2-showcase-sheet"]')!;
        const overlayRoot = document.querySelector('#app-overlay-root');
        return {
          overlayBackdrop: getComputedStyle(overlay).backdropFilter,
          contentBackdrop: getComputedStyle(content).backdropFilter,
          portalIsAppRoot: Boolean(overlayRoot?.contains(content)),
        };
      });
      expect(sheetContract.overlayBackdrop).toBe('none');
      expect(sheetContract.contentBackdrop).toBe('none');
      expect(sheetContract.portalIsAppRoot).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('ui-v2-showcase-sheet')).toHaveCount(0, { timeout: 2_000 });

      await page.getByTestId('ui-v2-showcase-open-drawer').click();
      await expect(page.getByTestId('ui-v2-showcase-drawer')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('ui-v2-showcase-drawer')).toHaveCount(0, { timeout: 2_000 });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps old visual query values on the current shell and workspace destinations', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, theme: 'light' });

    try {
      const page = await getStableWindow(app);
      const url = new URL(page.url());
      url.searchParams.set('e2eSkipSetup', '1');
      url.searchParams.set('uiVersion', 'legacy');
      url.hash = '#/';
      await page.goto(url.toString());

      await expect(page.getByTestId('main-layout')).toHaveAttribute('data-ui-version', 'v2');
      await expect(page.getByTestId('app-content-stage')).toHaveClass(/app-content-stage-v2/);
      await expect(page.getByTestId('settings-drawer')).toHaveCount(0);
      for (const [route, panel] of [['browser', 'browser'], ['code-review', 'review']]) {
        await page.evaluate((path) => { window.location.hash = `/${path}?uiVersion=legacy`; }, route);
        await expect(page.getByTestId(`artifact-panel-tab-${panel}`)).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => new URL(page.url()).hash.split('?')[0]).toBe('#/');
      }
    } finally {
      await closeElectronApp(app);
    }
  });
});
