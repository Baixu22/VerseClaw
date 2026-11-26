import type { Page } from '@playwright/test';
import { DEFAULT_REPLY_SIZE } from '../../src/lib/appearance';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

async function openAppearance(page: Page) {
  await page.getByTestId('sidebar-nav-settings').click();
  await expect(page.getByRole('slider', { name: 'Conversation text size' })).toBeVisible();
}

test('personalizes real conversation text, persists across launches and restores appearance alone', async ({ launchElectronApp }, testInfo) => {
  // The test owns two cold Electron launches, each with its own 90s startup budget.
  test.setTimeout(300_000);
  let app = await launchElectronApp({ skipSetup: true, theme: 'light', visualMode: true });
  try {
    let page = await getStableWindow(app);
    await openAppearance(page);
    await page.getByRole('button', { name: 'Extra large', exact: true }).click();
    const color = page.getByRole('group', { name: 'Accent color' });
    const sample = page.getByTestId('appearance-reading-preview');
    const sampleReply = sample.locator('[data-slot="appearance-reply"] .codex-markdown p');
    const slider = page.getByRole('slider', { name: 'Conversation text size' });
    await expect(color.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('settings-ui-depth-advanced').click();
    await color.getByRole('button', { name: 'Jade' }).click();
    await expect(color.getByRole('button', { name: 'Jade' })).toHaveAttribute('aria-pressed', 'true');
    const jade = color.getByRole('button', { name: 'Jade' }).locator('.appearance-swatch-dot');
    await expect(jade).toHaveCSS('background-image', 'none');
    await expect(jade).toHaveCSS('background-color', 'rgb(32, 129, 109)');
    await slider.focus();
    await slider.press('End');
    await expect(sampleReply).toHaveCSS('font-size', '22px');
    await expect(sample.getByTestId('chat-user-message-bubble').locator('p')).toHaveCSS('font-size', '22px');
    await slider.press('ArrowLeft');
    await page.getByRole('button', { name: 'Serif', exact: true }).click();
    await expect(sampleReply).toHaveCSS('font-size', '21px');
    await expect(sampleReply).toHaveCSS('font-family', /Georgia/);

    // Deliver the value a native OS color picker commits to its HTML control.
    await page.getByLabel('Custom color').evaluate((element: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, '#eecc55');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.getByText('#EECC55', { exact: true })).toBeVisible();
    const lightAccent = await sample.evaluate((node) => getComputedStyle(node).borderInlineStartColor);
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(sample).not.toHaveCSS('border-inline-start-color', lightAccent);
    const darkAccent = await sample.evaluate((node) => getComputedStyle(node).borderInlineStartColor);
    await expect(page.getByTestId('settings-chat-context-display'))
      .toHaveCSS('background-color', darkAccent);
    await pinWindowContentSize(app, { width: 960, height: 760 });
    await sample.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('appearance-dark.png') });
    expect(await sample.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);

    await closeElectronApp(app);
    app = await launchElectronApp({ skipSetup: true, visualMode: true });
    const history = [
      { id: 'appearance-user', role: 'user', content: 'Show the reading style.', timestamp: Date.now() - 2000 },
      { id: 'appearance-assistant', role: 'assistant', content: 'A reply with `inline code`.', timestamp: Date.now() - 1000 },
    ];
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
      gatewayRpc: {
        '["sessions.list",{}]': { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'Reading' }] } },
        '["chat.history",null]': { success: true, result: { messages: history, hasMore: false } },
      },
      hostApi: { '["sessions","history",null]': { messages: history, hasMore: false } },
    });
    page = await getStableWindow(app);
    await page.reload();
    const question = page.getByTestId('chat-user-message-bubble').getByText('Show the reading style.');
    await expect(question).toHaveCSS('font-size', '21px');
    await expect(question).toHaveCSS('font-family', /Georgia/);
    const reply = page.locator('.codex-markdown p').filter({ hasText: 'A reply with' });
    await expect(reply).toHaveCSS('font-size', '21px');
    await expect(reply).toHaveCSS('font-family', /Georgia/);
    await expect(reply.locator('code')).toHaveCSS('font-family', /mono|Consolas/i);
    await expect(page.getByTestId('chat-composer-send')).toHaveCSS('background-color', darkAccent);
    await openAppearance(page);
    await expect(page.getByRole('button', { name: 'Extra large', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('#EECC55', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Restore appearance defaults' }).click();
    await expect(page.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'Standard', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('appearance-reading-preview').locator('[data-slot="appearance-reply"] .codex-markdown p'))
      .toHaveCSS('font-size', `${DEFAULT_REPLY_SIZE}px`);
    await expect(page.getByTestId('settings-ui-depth-advanced')).toHaveAttribute('aria-pressed', 'true');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveClass(/light/);
    await page.getByTestId('settings-language-select').click();
    await page.getByRole('option', { name: '中文' }).click();
    await page.getByRole('radio', { name: '浅色', exact: true }).click();
    await page.getByRole('button', { name: '青玉', exact: true }).click();
    await page.getByRole('slider', { name: '对话字号' }).press('ArrowRight');
    await page.getByRole('button', { name: '衬线字体', exact: true }).click();
    const preview = page.getByTestId('appearance-reading-preview');
    await expect(preview.locator('[data-slot="appearance-reply"] .codex-markdown p')).toHaveCSS('font-size', `${DEFAULT_REPLY_SIZE + 1}px`);
    const layout = page.locator('.appearance-settings');
    const controls = layout.locator('.appearance-type-controls');
    const top = () => page.locator('.codex-settings-page__scroll').evaluate((el) => { el.scrollTop = 0; });
    await expect(page.getByText(/Menu language updated|菜单语言已更新/)).toHaveCount(0);
    await top();
    await expect(preview).toBeInViewport({ ratio: 1 });
    const desktopControls = (await controls.boundingBox())!;
    const desktopPreview = (await preview.boundingBox())!;
    expect(desktopPreview.x).toBeGreaterThan(desktopControls.x + desktopControls.width);
    expect(Math.abs(desktopControls.y - desktopPreview.y)).toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath('appearance-zh-light.png'), animations: 'disabled', scale: 'css' });
    await preview.screenshot({ path: testInfo.outputPath('appearance-zh-reading.png'), scale: 'css' });
    await page.getByRole('radio', { name: '深色', exact: true }).click();
    await top();
    await page.screenshot({ path: testInfo.outputPath('appearance-zh-dark.png'), animations: 'disabled', scale: 'css' });
    await page.setViewportSize({ width: 375, height: 800 });
    await page.getByRole('button', { name: '特大', exact: true }).click();
    const narrowControls = (await controls.boundingBox())!;
    const narrowPreview = (await preview.boundingBox())!;
    expect(narrowPreview.y).toBeGreaterThanOrEqual(narrowControls.y + narrowControls.height);
    const overflow = await layout.locator('section, .appearance-type-row, [role="group"], [role="radiogroup"], figure')
      .evaluateAll((nodes) => nodes.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.className));
    expect(overflow).toEqual([]);
    await top();
    await page.screenshot({ path: testInfo.outputPath('appearance-zh-narrow.png'), animations: 'disabled', scale: 'css' });
  } finally {
    await closeElectronApp(app);
  }
});
