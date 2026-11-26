import type { Locator, Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { SETTINGS_SECTION_SEGMENTS } from '../../src/pages/Settings/route-config';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const css = (node: Locator, property: string) =>
  node.evaluate(async (element, key) => {
    const style = getComputedStyle(element);
    style.getPropertyValue(key);
    await Promise.all(element.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished));
    return style.getPropertyValue(key);
  }, property);

async function colors(page: Page) {
  return {
    canvas: await css(page.locator('.codex-settings-page__panel'), 'background-color'),
    sidebar: await css(page.getByTestId('settings-sidebar'), 'background-color'),
    card: await css(page.locator('.sp-card').first(), 'background-color'),
    selected: await css(page.getByTestId('settings-nav-general'), 'background-color'),
    track: await css(page.getByTestId('settings-chat-context-display'), 'background-color'),
    thumb: await css(page.getByTestId('settings-chat-context-display').locator('[data-slot="switch-thumb"]'), 'background-color'),
    themeRing: await css(page.getByTestId('settings-theme-mode').locator('[aria-checked="true"] [data-slot="theme-selector-ring"]'), 'border-top-color'),
    sample: await css(page.getByTestId('appearance-reading-preview'), 'border-inline-start-color'),
  };
}

async function destructiveColor(page: Page) {
  await page.getByTestId('settings-archived-delete-agent:main:appearance-sample').click();
  const confirm = page.getByTestId('confirm-dialog-confirm-button');
  await expect(confirm).toBeVisible();
  const color = await css(confirm, 'background-color');
  await page.getByTestId('confirm-dialog-cancel-button').click();
  return color;
}

// Convert CSS Color 4 values to painted sRGB before comparing contrast.
async function contrast(page: Page, foreground: string, background: string) {
  return page.evaluate(([fg, bg]) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    function luminance(value: string) {
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data).map((channel) => {
        const n = channel / 255;
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const a = luminance(fg);
    const b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, [foreground, background]);
}

test('applies CSS to settings pages, shared controls and portalled layers', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const report: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright' };
  const app = await launchElectronApp({ skipSetup: true, theme: 'light', visualMode: true });
  try {
    await installIpcMocks(app, { hostApi: {
      '["sessions","listArchived",null]': { success: true, entries: [{
        sessionKey: 'agent:main:appearance-sample', agentId: 'main', label: 'Archived sample',
        archivedAt: 1600000005000, originalWorkspaceId: null, originalFolderId: null,
        transcriptPath: 'appearance-sample.archived.jsonl', sessionsJsonSnapshot: null,
      }] },
    } });
    const page = await getStableWindow(app);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('sidebar-nav-settings').click();
    const select = page.getByTestId('settings-language-select');
    const active = page.getByTestId('settings-nav-general');
    const panel = page.getByTestId('settings-page');
    const palette = page.getByRole('group', { name: 'Accent color' });
    for (const mode of ['Light', 'Dark']) {
      await page.getByRole('radio', { name: mode, exact: true }).click();
      await palette.getByRole('button', { name: 'Original' }).click();
      const neutral = await colors(page);
      if (mode === 'Dark') {
        await page.getByTestId('settings-nav-archived').click();
        report.neutralDanger = await destructiveColor(page);
        await page.getByTestId('settings-nav-general').click();
      }
      await palette.getByRole('button', { name: 'Jade' }).click();
      await expect(page.getByTestId('settings-chat-context-display')).toHaveCSS('background-color',
        await css(page.getByTestId('appearance-reading-preview'), 'border-inline-start-color'));
      const jade = await colors(page);
      for (const role of ['canvas', 'sidebar', 'card', 'selected', 'themeRing'] as const) {
        expect(jade[role], mode + ' ' + role).not.toEqual(neutral[role]);
      }
      expect(jade.track).toBe(jade.sample);
      expect(jade.themeRing).toBe(jade.sample);
      const ratio = await contrast(page, jade.track, jade.card);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(page, jade.thumb, jade.track)).toBeGreaterThanOrEqual(4.5);
      await palette.getByRole('button', { name: 'Rose' }).click();
      await expect(page.getByTestId('settings-chat-context-display')).not.toHaveCSS('background-color', jade.track);
      const rose = await colors(page);
      expect(rose.canvas).not.toBe(jade.canvas);
      expect(rose.card).not.toBe(jade.card);
      report[mode] = { neutral, jade, rose, contrast: ratio };
      await palette.getByRole('button', { name: 'Original' }).click();
      await expect(active).toHaveCSS('background-color', neutral.selected);
      await expect.poll(() => colors(page)).toEqual(neutral);
    }

    await palette.getByRole('button', { name: 'Jade' }).click();
    const stable = await colors(page);
    const navBefore = Number.parseFloat(await css(active, 'font-size'));
    const sample = page.getByTestId('appearance-reading-preview').locator('[data-slot="appearance-reply"] .codex-markdown p');
    const readingBefore = await css(sample, 'font-size');
    await page.getByRole('button', { name: 'Extra large', exact: true }).click();
    expect(Number.parseFloat(await css(active, 'font-size'))).toBeCloseTo(navBefore * 1.3, 1);
    await expect(sample).toHaveCSS('font-size', readingBefore);
    const sizeButton = page.getByRole('button', { name: 'Extra large', exact: true });
    await expect(sizeButton).toHaveCSS('color', stable.sample);
    await select.focus();
    await select.press('ArrowDown');
    const listbox = page.getByRole('listbox', { name: 'Language' });
    await expect(listbox).toBeVisible();
    expect(await listbox.evaluate((el) => el.closest('#app-overlay-root') !== null)).toBe(true);
    const menuSurface = await css(listbox, 'background-color');
    expect(await contrast(page, menuSurface, stable.card)).toBeCloseTo(1, 2);
    report.menuBackground = menuSurface;
    const chosen = listbox.locator('[data-state="checked"]');
    await expect(chosen).toHaveCSS('color', stable.sample);
    await expect(chosen).toHaveCSS('font-size', '16.9px');
    await page.keyboard.press('End');
    await page.keyboard.press('Escape');
    await expect(select).toBeFocused();
    await expect(select).toContainText('English');

    const visited: string[] = [];
    for (const id of Object.keys(SETTINGS_SECTION_SEGMENTS)) {
      const link = page.getByTestId('settings-nav-' + id);
      const label = await link.innerText();
      await link.click();
      await expect(link).toHaveAttribute('aria-current', 'page');
      await expect(panel.locator('.codex-settings-page__title')).toHaveText(label.trim());
      await expect(panel.locator('.codex-settings-content').first()).toBeVisible();
      await expect(panel.getByTestId('settings-section-loading')).toHaveCount(0);
      await expect(panel.locator('.codex-settings-page__panel')).toHaveCSS('background-color', stable.canvas);
      if (id === 'developer') {
        const developerMode = page.getByTestId('settings-dev-mode-switch');
        await developerMode.click();
        const proxy = page.getByTestId('settings-proxy-toggle');
        const save = page.getByTestId('settings-proxy-save-button');
        await expect(proxy).toHaveAttribute('aria-checked', 'false');
        await expect(save).toBeDisabled();
        const disabledOpacity = Number(await css(save, 'opacity'));
        expect(disabledOpacity).toBeLessThan(1);
        const off = await css(proxy, 'background-color');
        await proxy.click();
        await expect(proxy).toHaveCSS('background-color', stable.sample);
        await expect(save).toBeEnabled();
        await proxy.click();
        await expect(proxy).toHaveCSS('background-color', off);
        await expect(save).toBeDisabled();
        report.disabledOpacity = disabledOpacity;
        await developerMode.click();
      }
      if (id === 'models') {
        await page.getByTestId('providers-add-button').click();
        const dialog = page.getByTestId('add-provider-dialog');
        await expect(dialog).toBeVisible();
        expect(await dialog.evaluate((el) => el.closest('#app-overlay-root') !== null)).toBe(true);
        const surface = await css(dialog, 'background-color');
        report.dialogBackground = surface;
        expect(await contrast(page, surface, stable.card)).toBeCloseTo(1, 2);
        expect(await contrast(page, stable.sample, surface)).toBeGreaterThanOrEqual(4.5);
        await dialog.screenshot({ path: testInfo.outputPath('provider-dialog.png') });
        await page.getByTestId('add-provider-close-button').click();
      }
      if (id === 'archived') {
        const danger = await destructiveColor(page);
        expect(danger).toBe(report.neutralDanger);
        expect(danger).not.toBe(stable.sample);
        report.customDanger = danger;
      }
      visited.push(id);
    }
    report.routes = visited;
    await page.getByTestId('settings-nav-general').click();
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.getByTestId('settings-mobile-section')).toBeVisible();
    await expect(sizeButton).toBeVisible();
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByTestId('settings-language-select').click();
    const bounds = await listbox.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    await expect(listbox).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('settings-narrow.png'), animations: 'disabled', scale: 'css' });
  } finally {
    const path = testInfo.outputPath('settings-computed-css.json');
    await writeFile(path, JSON.stringify(report, null, 2));
    await testInfo.attach('settings-computed-css', { path, contentType: 'application/json' });
    await closeElectronApp(app);
  }
});
