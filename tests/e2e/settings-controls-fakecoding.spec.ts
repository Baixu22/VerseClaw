/**
 * Settings *content* alignment against the FakeCoding reference.
 *
 * The sibling spec (sidebar-settings-fakecoding) covers the page chrome — nav
 * rail, surface, panel, scroller. This one covers the vocabulary inside the
 * scroller: section titles, cards with inset dividers, rows, and the controls
 * (switch / select / segmented) ported from
 *   FakeCoding-main/web/src/components/settings/
 *
 * Geometry is asserted from computed styles rather than screenshots so a
 * regression names the property that drifted. Both themes are exercised
 * because the reference ships dark-only and ClawX re-maps the tokens.
 */
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

/** Reference values from settings.css (CDP-measured on the official app). */
const REFERENCE = {
  cardRadius: 20,
  rowRadius: 12.5,
  switchWidth: 32,
  switchHeight: 20,
  selectHeight: 28,
  sectionTitleSize: 14,
  rowTitleSize: 13,
  rowPaddingY: 12,
  rowPaddingX: 16,
  dividerInset: 16,
  menuWidth: 220,
  menuRadius: 15,
};

test.describe('FakeCoding settings content alignment', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`renders reference card, row and control geometry in ${theme} mode`, async ({ launchElectronApp }) => {
      const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme });

      try {
        const page = await getStableWindow(app);
        await page.setViewportSize({ width: 1285, height: 820 });
        await page.getByTestId('sidebar-nav-settings').click();
        await expect(page.getByTestId('settings-page')).toBeVisible();

        // The appearance rows are the ported vocabulary end to end.
        const card = page.locator('.sp-card').first();
        await expect(card).toBeVisible();

        const geometry = await card.evaluate((element) => {
          const row = element.querySelector<HTMLElement>('.sp-row');
          const label = row?.querySelector<HTMLElement>('.sp-row-label b');
          const title = element.closest('.sp-section')?.querySelector<HTMLElement>('.sp-section-title');
          const cardStyle = getComputedStyle(element);
          const rowStyle = row ? getComputedStyle(row) : null;
          const divider = row ? getComputedStyle(row, '::after') : null;
          return {
            cardRadius: Number.parseFloat(cardStyle.borderTopLeftRadius),
            cardOverflow: cardStyle.overflow,
            rowPaddingTop: rowStyle ? Number.parseFloat(rowStyle.paddingTop) : null,
            rowPaddingLeft: rowStyle ? Number.parseFloat(rowStyle.paddingLeft) : null,
            rowAlign: rowStyle?.alignItems ?? null,
            dividerLeft: divider ? Number.parseFloat(divider.left) : null,
            sectionTitleSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : null,
            rowTitleSize: label ? Number.parseFloat(getComputedStyle(label).fontSize) : null,
            // The card must paint a surface distinct from the page behind it.
            cardBackground: cardStyle.backgroundColor,
          };
        });

        expect(geometry.cardRadius).toBeCloseTo(REFERENCE.cardRadius, 1);
        expect(geometry.cardOverflow).toBe('hidden');
        expect(geometry.rowPaddingTop).toBeCloseTo(REFERENCE.rowPaddingY, 1);
        expect(geometry.rowPaddingLeft).toBeCloseTo(REFERENCE.rowPaddingX, 1);
        expect(geometry.rowAlign).toBe('center');
        expect(geometry.dividerLeft).toBeCloseTo(REFERENCE.dividerInset, 1);
        expect(geometry.sectionTitleSize).toBeCloseTo(REFERENCE.sectionTitleSize, 1);
        expect(geometry.rowTitleSize).toBeCloseTo(REFERENCE.rowTitleSize, 1);
        expect(geometry.cardBackground).not.toBe('rgba(0, 0, 0, 0)');

        // Switch: 32x20 track with a 16px thumb travelling 2px -> 14px.
        const startup = page.getByTestId('settings-launch-at-startup');
        const switchGeometry = await startup.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const thumb = element.querySelector<HTMLElement>('.sp-switch-thumb');
          return {
            width: rect.width,
            height: rect.height,
            thumbWidth: thumb ? thumb.getBoundingClientRect().width : null,
            transform: thumb ? getComputedStyle(thumb).transform : null,
          };
        });
        expect(switchGeometry.width).toBeCloseTo(REFERENCE.switchWidth, 0);
        expect(switchGeometry.height).toBeCloseTo(REFERENCE.switchHeight, 0);
        expect(switchGeometry.thumbWidth).toBeCloseTo(16, 0);

        const initialState = await startup.getAttribute('data-state');
        await startup.click();
        await expect(startup).not.toHaveAttribute('data-state', initialState ?? '');

        // Segmented control drives a real store value.
        const depth = page.getByTestId('settings-ui-depth-mode');
        await expect(depth).toBeVisible();
        await page.getByTestId('settings-ui-depth-advanced').click();
        await expect(page.getByTestId('settings-ui-depth-advanced')).toHaveAttribute('aria-pressed', 'true');

        // Select: 28px trigger opening a 220px / r15 portalled menu that is not
        // clipped by the scroller, and that closes on Escape.
        const select = page.getByTestId('settings-language-select');
        await expect(select).toHaveCSS('height', `${REFERENCE.selectHeight}px`);
        await select.click();

        const menu = page.locator('.sp-select-menu');
        await expect(menu).toBeVisible();
        const menuGeometry = await menu.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            width: rect.width,
            radius: Number.parseFloat(style.borderTopLeftRadius),
            position: style.position,
            withinViewport: rect.left >= 0
              && rect.top >= 0
              && rect.right <= window.innerWidth
              && rect.bottom <= window.innerHeight,
          };
        });
        expect(menuGeometry.width).toBeCloseTo(REFERENCE.menuWidth, 0);
        expect(menuGeometry.radius).toBeCloseTo(REFERENCE.menuRadius, 1);
        expect(menuGeometry.position).toBe('fixed');
        expect(menuGeometry.withinViewport).toBe(true);

        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
      } finally {
        await closeElectronApp(app);
      }
    });
  }

  test('keeps rows readable and controls reachable at the minimum window', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark' });

    try {
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1000, height: 820 });
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();

      // No empty shell: the section, its card and at least one row must render.
      await expect(page.locator('.sp-section').first()).toBeVisible();
      await expect(page.locator('.sp-card').first()).toBeVisible();
      expect(await page.locator('.sp-row').count()).toBeGreaterThan(0);

      const layout = await page.locator('.sp-row').first().evaluate((element) => {
        const label = element.querySelector<HTMLElement>('.sp-row-label');
        const control = element.querySelector<HTMLElement>('.sp-row-control');
        const labelRect = label?.getBoundingClientRect();
        const controlRect = control?.getBoundingClientRect();
        return {
          // label and control stay on one line, control pinned right
          controlAfterLabel: labelRect && controlRect ? controlRect.left >= labelRect.right : null,
          controlVisible: controlRect ? controlRect.width > 0 : null,
          overflowsCard: controlRect
            ? controlRect.right > (element.getBoundingClientRect().right + 1)
            : null,
        };
      });
      expect(layout.controlAfterLabel).toBe(true);
      expect(layout.controlVisible).toBe(true);
      expect(layout.overflowsCard).toBe(false);
    } finally {
      await closeElectronApp(app);
    }
  });
});
