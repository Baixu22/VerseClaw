import sharp from 'sharp';
import type { Locator } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

const repoUrl = 'https://github.com/facebook/react';
const siteUrl = 'https://example.org/frontend/documentation';
const unavailableUrl = 'https://example.org/unavailable';
const linkedSession = {
  key: 'agent:main:references',
  sessionId: 'fb9e0d86-7b7c-4d86-8ae5-229a57c45932',
  label: 'Rendering notes for the desktop composer',
};

async function pasteDraft(editor: Locator, text: string) {
  await editor.focus();
  await editor.evaluate((element: HTMLTextAreaElement, value) => {
    // Exercise the paste and input events without changing the system clipboard.
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', value);
    if (!element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))) return;
    element.setRangeText(value, element.selectionStart, element.selectionEnd, 'end');
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: value }));
  }, text);
}

async function thumbnail(width: number, height: number, color: string) {
  const data = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
  return 'data:image/png;base64,' + data.toString('base64');
}

async function expectThumbnail(img: Locator) {
  await expect(img).toBeVisible();
  await expect(img).toHaveCSS('object-fit', 'cover');
  await expect.poll(() => img.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  const box = (await img.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
  expect(box.width).toBeLessThanOrEqual(208);
}

for (const theme of ['light', 'dark'] as const) {
  test('renders a repo pill and delayed website preview in a ' + theme + ' composer', async ({ launchElectronApp }, info) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme, deviceScaleFactor: 1 });
    try {
      const previewRequests = () => app.evaluate(() => {
        const calls = (globalThis as typeof globalThis & {
          __verseClawE2eHostCalls?: Array<{ module: string; action: string; payload?: { url?: string; mode?: string } }>;
        }).__verseClawE2eHostCalls ?? [];
        return calls.filter(call => call.module === 'media' && call.action === 'linkPreview' && call.payload?.mode !== 'favicon')
          .map(call => call.payload?.url);
      });
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, gatewayReady: true },
        gatewayRpcByMethod: {
          'sessions.list': { sessions: [{ key: 'agent:main:main', sessionId: 'link-preview-demo' }, linkedSession] },
          'chat.history': { messages: [] },
          '*': {},
        },
        hostApi: {
          [JSON.stringify(['providers', 'accounts', null])]: [
            { id: 'link-preview-e2e', vendorId: 'openai', label: 'Link reference fixture', authMode: 'oauth_browser', enabled: true },
          ],
          [JSON.stringify(['providers', 'accountKeyInfo', null])]: [],
          [JSON.stringify(['providers', 'vendors', null])]: [],
          [JSON.stringify(['providers', 'getDefaultAccount', null])]: { accountId: 'link-preview-e2e' },
          [JSON.stringify(['chat', 'sendWithMedia', null])]: { success: true, result: { runId: 'link-preview-send' } },
          [JSON.stringify(['shell', 'openExternal', { url: repoUrl }])]: {},
          [JSON.stringify(['media', 'linkPreview', { mode: 'favicon', url: 'https://example.org' }])]: {
            favicon: await thumbnail(24, 24, '#497caa'),
          },
          [JSON.stringify(['media', 'linkPreview', { url: siteUrl }])]: {
            thumbnail: await thumbnail(110, 240, '#54826f'),
          },
          [JSON.stringify(['media', 'linkPreview', { url: unavailableUrl }])]: null,
        },
      });
      const page = await getStableWindow(app);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(320, 600));
      await pinWindowContentSize(app, { width: 1280, height: 800 });
      const editor = page.getByTestId('chat-composer-input');
      const isolated = page.getByTestId('composer-standalone-link');
      const editLink = isolated.getByTestId('composer-edit-link');
      const showReference = page.getByTestId('composer-show-link-card');
      const repo = isolated.getByRole('button', { name: 'facebook/react' });

      await editor.fill('facebook/react');
      await expect(isolated).toHaveCount(0);
      await showReference.click();
      await expect(repo).toHaveText('facebook/react');
      await expect(repo).toHaveClass('chat-github-reference');
      await expect(repo.locator('svg')).toHaveCount(1);
      await expect(editor).toBeHidden();
      await expect(editLink.locator('svg')).toHaveAttribute('width', '12');
      await expect(editLink).toHaveCSS('width', '24px');
      await expect(editLink).toHaveCSS('height', '24px');
      expect((await repo.boundingBox())!.height).toBeLessThanOrEqual(24);
      expect((await repo.boundingBox())!.width).toBeLessThanOrEqual(150);
      await repo.hover();
      await expect.poll(previewRequests).toEqual([]);
      await page.screenshot({ path: info.outputPath('repository.png') });
      await repo.click();
      await editLink.click();
      await expect(editor).toBeFocused();
      await expect(editor).toHaveValue('facebook/react');
      await expect(isolated).toHaveCount(0);

      const site = isolated.getByRole('link');
      const preview = page.getByTestId('chat-link-preview-image');
      await editor.press('ControlOrMeta+a');
      await pasteDraft(editor, siteUrl);
      await expect(site).toHaveText(siteUrl);
      await expect(site).toHaveAttribute('href', siteUrl);
      await expect(editor).toBeHidden();
      await expect(isolated).toBeFocused();
      const icon = site.locator(':scope > .chat-website-icon:first-child').getByTestId('chat-website-favicon');
      await expect(icon).toBeVisible();
      await expect.poll(() => icon.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(24);
      expect((await icon.boundingBox())!.width).toBeLessThanOrEqual(16);
      await expect.poll(previewRequests).toEqual([]);
      await expect(preview).toBeHidden();
      await page.screenshot({ path: info.outputPath('website-desktop.png') });

      await pinWindowContentSize(app, { width: 375, height: 667 });
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(375);
      await expect.poll(async () => (await isolated.boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(52);
      expect(await site.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      const height = (await isolated.boundingBox())!.height;
      await site.hover();
      await expectThumbnail(preview);
      await expect.poll(previewRequests).toEqual([siteUrl]);
      expect((await isolated.boundingBox())!.height).toBe(height);
      await expect(editLink).toBeInViewport();
      await expect(page.getByTestId('chat-composer-send')).toBeInViewport();
      await page.screenshot({ path: info.outputPath('website-375.png') });
      await page.mouse.move(4, 120);
      await expect(preview).toBeHidden();

      await editLink.press('Escape');
      await expect(editor).toBeFocused();
      await expect(isolated).toHaveCount(0);
      await expect(editor).toHaveValue(siteUrl);

      await editor.press('ControlOrMeta+a');
      await pasteDraft(editor, unavailableUrl);
      await expect(site).toHaveAttribute('href', unavailableUrl);
      await site.hover();
      await expect.poll(previewRequests).toEqual([siteUrl, unavailableUrl]);
      await expect(site).toBeVisible();
      await expect(preview).toBeHidden();

      await editLink.press('Enter');
      await expect(editor).toBeFocused();
      await editor.fill('Compare repo:facebook/react with ' + siteUrl);
      await page.locator('.composer-draft-preview-toggle').click();
      const linkList = page.getByRole('list', { name: 'References' });
      await expect(linkList.getByRole('listitem')).toHaveCount(2);
      await expect(linkList.getByRole('button', { name: 'facebook/react' })).toHaveClass('chat-github-reference');
      await linkList.getByRole('link', { name: siteUrl }).hover();
      await expectThumbnail(preview);
      await expect.poll(previewRequests).toEqual([siteUrl, unavailableUrl, siteUrl]);
      await editor.fill('A draft without references');
      await expect(preview).toBeHidden();

      const sessionReference = theme === 'light' ? linkedSession.sessionId : linkedSession.key;
      await editor.press('ControlOrMeta+a');
      await pasteDraft(editor, sessionReference);
      const sessionChip = isolated.locator('.composer-session-reference');
      const openSession = sessionChip.getByRole('button', { name: 'Open conversation ' + linkedSession.label });
      await expect(openSession).toBeVisible();
      await expect(openSession).toHaveAttribute('title', linkedSession.label + '\n' + sessionReference);
      expect((await sessionChip.boundingBox())!.height).toBeLessThanOrEqual(30);
      await editLink.press('Escape');
      await expect(editor).toBeFocused();
      await expect(editor).toHaveValue(sessionReference);

      const rawDraft = theme === 'light' ? sessionReference : 'repo:facebook/react';
      if (theme === 'light') {
        await showReference.click();
      } else {
        await editor.press('ControlOrMeta+a');
        await pasteDraft(editor, rawDraft);
      }
      await expect(editor).toBeHidden();
      await expect(isolated).toBeFocused();
      await page.keyboard.press('Enter');
      await expect.poll(() => app.evaluate(() => {
        const calls = (globalThis as typeof globalThis & {
          __verseClawE2eHostCalls?: Array<{ module: string; action: string; payload?: { message?: string } }>;
        }).__verseClawE2eHostCalls;
        return calls?.filter(call => call.module === 'chat' && call.action === 'sendWithMedia').map(call => call.payload?.message);
      })).toEqual([rawDraft]);
      await expect(editor).toHaveValue('');
      await expect(editor).toBeFocused();
      await expect(isolated).toHaveCount(0);
      await expect.poll(previewRequests).toEqual([siteUrl, unavailableUrl, siteUrl]);
    } finally {
      await closeElectronApp(app);
    }
  });
}
