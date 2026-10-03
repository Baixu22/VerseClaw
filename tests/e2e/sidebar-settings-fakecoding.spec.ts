import { closeElectronApp, expect, getStableWindow, revealSectionHeadingActionsFor, test } from './fixtures/electron';

test.describe('FakeCoding sidebar and full-page settings alignment', () => {
  test('keeps meaningful sidebar and settings shells visible at all states', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark' });

    try {
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1285, height: 820 });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(1285, 820);
      });
      await page.waitForTimeout(100);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('sidebar-session-section-toggle')).toContainText(/^(Projects|Conversations)$/);
      // Section actions exist but stay hidden until the heading is hovered.
      await expect(page.getByTestId('sidebar-session-search')).toHaveCount(1);
      await expect(page.locator('.section-heading-actions').first()).toHaveCSS('opacity', '0');

      const sidebarGeometry = await page.getByTestId('sidebar').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const heading = element.querySelector<HTMLElement>('.section-heading')?.getBoundingClientRect();
        return { width: rect.width, headingHeight: heading?.height ?? 0 };
      });
      expect(sidebarGeometry.width).toBeGreaterThanOrEqual(240);
      expect(sidebarGeometry.width).toBeLessThanOrEqual(360);
      expect(sidebarGeometry.headingHeight).toBeGreaterThanOrEqual(28);
      const footerGeometry = await page.locator('.sidebar-footer').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { height: rect.height };
      });
      expect(Math.abs(footerGeometry.height - 45)).toBeLessThanOrEqual(1);

      /* Session-area alignment against the FakeCoding reference: the section
         label is a real collapse control, actions are hover-only, and a nested
         session title starts at the same x as its workspace title (row 8px +
         icon column 19px + gap 7px + nested indent = 43px), with no reserved
         leading status slot pushing it right. */
      const sessionArea = await page.getByTestId('sidebar').evaluate((element) => {
        const sidebarLeft = element.getBoundingClientRect().left;
        const label = element.querySelector<HTMLElement>('.section-label-button');
        const actions = element.querySelector<HTMLElement>('.section-heading-actions');
        const projectTitle = element.querySelector<HTMLElement>('.project-row > span');
        const taskSelect = element.querySelector<HTMLElement>('.project-tasks .task-select');
        const taskTitle = taskSelect?.querySelector<HTMLElement>(':scope > span:not(.task-status-slot)');
        const row = element.querySelector<HTMLElement>('.sidebar-row');
        const at = (node: HTMLElement | null | undefined) =>
          node ? node.getBoundingClientRect().left - sidebarLeft : null;
        return {
          labelTag: label?.tagName,
          labelExpanded: label?.getAttribute('aria-expanded'),
          hasChevron: !!label?.querySelector('.section-chevron'),
          actionsOpacity: actions ? Number(getComputedStyle(actions).opacity) : null,
          chevronGlyphs: element.querySelectorAll('.section-chevron path').length,
          projectTitleX: at(projectTitle),
          taskTitleX: at(taskTitle),
          rowHeight: row ? row.getBoundingClientRect().height : null,
          rowRadius: row ? getComputedStyle(row).borderRadius : null,
          folderGlyph: (() => {
            const glyph = element.querySelector<HTMLElement>('.project-row .project-folder-icon');
            return glyph ? Math.round(glyph.getBoundingClientRect().width) : null;
          })(),
        };
      });
      // The label collapses its own section, exactly like the reference.
      expect(sessionArea.labelTag).toBe('BUTTON');
      expect(sessionArea.labelExpanded).toBe('true');
      expect(sessionArea.hasChevron).toBe(true);
      // A single filled path — the captured Codex chevron, not a stroked caret.
      expect(sessionArea.chevronGlyphs).toBe(1);
      expect(sessionArea.rowHeight).toBe(30);
      expect(sessionArea.rowRadius).toBe('12.5px');
      expect(sessionArea.folderGlyph).toBe(15);
      // Session titles line up with workspace titles instead of sitting ~21px
      // right. The reference itself lands 1px apart — its 35px nested indent
      // was computed against a 20px icon column that later became 19px — so
      // reproducing it faithfully means allowing exactly that 1px.
      if (sessionArea.projectTitleX != null && sessionArea.taskTitleX != null) {
        expect(
          Math.abs(sessionArea.taskTitleX - sessionArea.projectTitleX),
          JSON.stringify(sessionArea),
        ).toBeLessThanOrEqual(1);
      }

      // Official section actions are hover-revealed, so the heading must be
      // hovered before its 22x22 slots accept pointer events.
      await revealSectionHeadingActionsFor(page.getByTestId('sidebar-session-organize'));
      await page.getByTestId('sidebar-session-organize').click();
      const organizeMenu = page.locator('.sidebar-session-organize-menu');
      await expect(organizeMenu).toBeVisible();
      // Two view-by (project/time) + three sort-by (newest/active/priority)
      // radio items. The sort-by group was added to this menu after the
      // spec was first written, so the total is 5, not 2.
      await expect(organizeMenu.getByRole('menuitemradio')).toHaveCount(5);
      await page.waitForTimeout(180);
      const organizeGeometry = await organizeMenu.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          computedWidth: style.width,
          transform: style.transform,
          rootZoom: getComputedStyle(document.documentElement).zoom,
          bodyZoom: getComputedStyle(document.body).zoom,
          devicePixelRatio: window.devicePixelRatio,
          viewportScale: window.visualViewport?.scale ?? 1,
        };
      });
      expect(organizeGeometry.left).toBeGreaterThanOrEqual(8);
      expect(organizeGeometry.top).toBeGreaterThanOrEqual(8);
      expect(organizeGeometry.right).toBeLessThanOrEqual(1285 - 8);
      expect(organizeGeometry.bottom).toBeLessThanOrEqual(820 - 8);
      expect(parseFloat(organizeGeometry.computedWidth), JSON.stringify(organizeGeometry)).toBe(172);
      await page.keyboard.press('Escape');
      await expect(organizeMenu).toBeHidden();

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page).toHaveURL(/#\/settings\/general$/);
      await expect(page.getByTestId('settings-sidebar')).toBeVisible();
      await expect(page.getByTestId('settings-back-button')).toHaveText(/Back to app/);
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-drawer')).toHaveCount(0);
      await expect(page.getByTestId('settings-implementation')).toBeVisible();

      const settingsGeometry = await page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>('[data-testid="app-content-stage"]')!.getBoundingClientRect();
        const sidebar = document.querySelector<HTMLElement>('[data-testid="settings-sidebar"]')!.getBoundingClientRect();
        const main = document.querySelector<HTMLElement>('[data-testid="main-content"]')!.getBoundingClientRect();
        const page = document.querySelector<HTMLElement>('[data-testid="settings-page"]')!.getBoundingClientRect();
        const header = document.querySelector<HTMLElement>('.codex-settings-page__header')!.getBoundingClientRect();
        const content = document.querySelector<HTMLElement>('.codex-settings-page__content')!.getBoundingClientRect();
        const title = document.querySelector<HTMLElement>('.codex-settings-page__title')!.getBoundingClientRect();
        return {
          stage: { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom },
          sidebar: { width: sidebar.width, right: sidebar.right },
          main: { left: main.left, top: main.top, right: main.right, bottom: main.bottom },
          page: { left: page.left, top: page.top, right: page.right, bottom: page.bottom },
          headerHeight: header.height,
          content: { left: content.left, width: content.width },
          titleLeft: title.left,
        };
      });
      expect(Math.abs(settingsGeometry.sidebar.width - 275)).toBeLessThanOrEqual(1);
      expect(Math.abs(settingsGeometry.main.left - settingsGeometry.sidebar.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(settingsGeometry.page.left - settingsGeometry.main.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(settingsGeometry.page.top - settingsGeometry.main.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(settingsGeometry.page.right - settingsGeometry.main.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(settingsGeometry.page.bottom - settingsGeometry.main.bottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(settingsGeometry.headerHeight - 46)).toBeLessThanOrEqual(1);
      expect(settingsGeometry.content.width).toBeLessThanOrEqual(768.5);
      expect(Math.abs(settingsGeometry.content.left - settingsGeometry.titleLeft)).toBeLessThanOrEqual(1);

      const darkScreenshot = testInfo.outputPath('settings-full-page-dark.png');
      await page.screenshot({ path: darkScreenshot });
      await testInfo.attach('settings-full-page-dark', {
        path: darkScreenshot,
        contentType: 'image/png',
      });

      await page.getByTestId('settings-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();
      await expect(page.getByTestId('models-page-title')).toHaveText(/Models/);
      await expect(page.locator('[data-testid="settings-back-button"]')).toHaveCount(1);

      await page.getByTestId('settings-back-button').click();
      await expect(page).toHaveURL(/#\/$/);
      await expect(page.getByTestId('sidebar')).toBeVisible();
      await expect(page.getByTestId('sidebar-session-section-toggle')).toContainText(/^(Projects|Conversations)$/);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps the collapsed rail and compact footer usable at the minimum window', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, theme: 'dark' });
    try {
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 960, height: 600 });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(960, 600);
      });
      await page.waitForTimeout(100);
      await expect(page.getByTestId('sidebar')).toBeVisible();
      await expect(page.getByTestId('sidebar-nav-settings')).toBeVisible();
      const layout = await page.evaluate(() => {
        const sidebarElement = document.querySelector<HTMLElement>('[data-testid="sidebar"]')!;
        const sidebar = sidebarElement.getBoundingClientRect();
        const footer = document.querySelector<HTMLElement>('.sidebar-footer')!.getBoundingClientRect();
        return {
          sidebarWidth: sidebar.width,
          sidebarCssWidth: sidebarElement.style.width,
          sessionSectionVisible: document.querySelector('[data-testid="sidebar-session-section-toggle"]') !== null,
          footerHeight: footer.height,
        };
      });
      expect(layout.sidebarCssWidth).toBe('64px');
      expect(layout.sessionSectionVisible).toBe(false);
      expect(Math.abs(layout.footerHeight - 45)).toBeLessThanOrEqual(1);

      await expect(page.getByTestId('sidebar-footer-menu-trigger')).toHaveCount(0);
      await expect(page.getByTestId('sidebar-open-dev-console')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps narrow, light, and loading states fully populated', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({
      skipSetup: true,
      visualMode: true,
      theme: 'light',
      settingsSectionDelayMs: 1_200,
    });

    try {
      const page = await getStableWindow(app);
      expect(new URL(page.url()).searchParams.get('e2eSettingsSectionDelayMs')).toBe('1200');
      await page.setViewportSize({ width: 1000, height: 820 });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(1000, 820);
      });
      await page.waitForTimeout(100);
      await expect(page.getByTestId('sidebar')).toBeVisible();
      await expect(page.getByTestId('sidebar-nav-settings')).toBeVisible();
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-implementation')).toBeVisible();
      await expect(page.getByTestId('settings-sidebar')).toBeVisible();

      const narrowGeometry = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>('[data-testid="settings-sidebar"]')!.getBoundingClientRect();
        const main = document.querySelector<HTMLElement>('[data-testid="main-content"]')!.getBoundingClientRect();
        const content = document.querySelector<HTMLElement>('.codex-settings-page__content')!.getBoundingClientRect();
        const scroll = document.querySelector<HTMLElement>('.codex-settings-page__scroll')!;
        return {
          sidebarWidth: sidebar.width,
          mainWidth: main.width,
          contentWidth: content.width,
          contentRight: content.right,
          mainRight: main.right,
          horizontalOverflow: scroll.scrollWidth - scroll.clientWidth,
        };
      });
      expect(narrowGeometry.sidebarWidth).toBeGreaterThanOrEqual(220);
      expect(narrowGeometry.sidebarWidth).toBeLessThanOrEqual(275);
      expect(narrowGeometry.contentWidth).toBeLessThanOrEqual(narrowGeometry.mainWidth - 30);
      expect(narrowGeometry.contentRight).toBeLessThanOrEqual(narrowGeometry.mainRight);
      expect(narrowGeometry.horizontalOverflow).toBeLessThanOrEqual(1);

      const narrowScreenshot = testInfo.outputPath('settings-full-page-light-narrow.png');
      await page.screenshot({ path: narrowScreenshot });
      await testInfo.attach('settings-full-page-light-narrow', { path: narrowScreenshot, contentType: 'image/png' });

      await page.getByTestId('settings-nav-storage').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-sidebar')).toBeVisible();
      const transitionContent = page.locator('[data-testid="settings-section-loading"], [data-testid="settings-implementation"]');
      await expect(transitionContent.first()).toBeVisible();
      const loadingScreenshot = testInfo.outputPath('settings-loading-populated.png');
      await page.screenshot({ path: loadingScreenshot });
      await testInfo.attach('settings-loading-populated', { path: loadingScreenshot, contentType: 'image/png' });
      await expect(page.getByTestId('storage-info-ram')).toBeVisible({ timeout: 10_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
});
