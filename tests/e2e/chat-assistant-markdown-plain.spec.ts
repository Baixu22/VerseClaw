import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const LINKED_KEY = 'agent:main:session-linked';
const LINKED_ID = 'ba09848c-3ff1-49bc-ad39-38418b7ec69f';
const SYNTHETIC_KEY = 'sk-' + 'testOnly0123456789'.repeat(2);
const CLOUD_ARTIFACT_PATH = '/opt/cursor/artifacts/chat_assistant_plain_markdown.png';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: [
      'Please render a Markdown reply plainly.', '', '### Review checklist', '',
      '- [x] Inspect **changes**', '', 'github.com/example/project', '',
      `Follow ${LINKED_ID} and example/project#42.`, '', `\`\`\`env\nAPI_KEY=${SYNTHETIC_KEY}\n\`\`\``,
    ].join('\n') }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'text',
      text: [
        '### Plain Markdown reply',
        '',
        'This assistant reply should render as normal Markdown, not inside a gray rounded bubble.',
        '',
        '- Bold text: **works**',
        '- Inline code: `worksToo()`',
        '- Follow the [reference](https://example.com/docs) for details.',
        '',
        '> Quoted context stays visually grouped.',
        '',
        '| Item | Status |',
        '| --- | --- |',
        '| Table row | Ready |',
        '',
        '- [x] Render task item',
        '',
        '```ts',
        'const rich = true;',
        '```',
      ].join('\n'),
    }],
    timestamp: Date.now(),
  },
];

test.describe('Verse Claw assistant reply Markdown styling', () => {
  test('renders assistant text as plain Markdown while keeping user prompts bubbled', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' },
                { key: LINKED_KEY, sessionId: LINKED_ID, label: 'Rendering notes' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          ...Object.fromEntries([200, 1000].map(limit => [
            stableStringify(['chat.history', { sessionKey: LINKED_KEY, limit, maxChars: 500000 }]),
            { success: true, result: { messages: [{ role: 'user', content: '## Linked conversation\n\n' + 'Log entry\n'.repeat(32) + 'End of log' }] } },
          ])),
        },
        hostApi: {
          [stableStringify(['media', 'linkPreview', null])]: null,
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.remove('dark');
        root.classList.add('light');
        // The real clipboard rejects under the Electron test runner (the window
        // isn't focused), so the copy handler's `await` throws and the button
        // never reaches its "Copied" state. chat-user-message-actions.spec.ts
        // stubs the same way for the same reason.
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async (text: string) => { document.documentElement.dataset.testClipboard = text; } },
        });
      });

      const userBubble = page.getByTestId('chat-user-message-bubble').filter({ hasText: 'Please render a Markdown reply plainly.' }).first();
      await expect(userBubble).toBeVisible({ timeout: 30_000 });
      const editor = page.getByTestId('chat-composer-input');
      const draftPreview = page.getByTestId('composer-draft-preview');
      const liveToggle = draftPreview.locator('.composer-draft-preview-toggle');
      const richMode = draftPreview.getByTestId('composer-rich-mode-toggle');
      await editor.fill('Related to ' + LINKED_ID);
      await liveToggle.click();
      const draftSession = draftPreview.getByRole('button', { name: /Rendering notes/ });
      await expect(draftSession).toHaveText('Rendering notes');
      await expect(draftSession).toHaveAttribute('title', new RegExp(LINKED_ID));
      expect((await draftSession.boundingBox())!.height).toBeLessThanOrEqual(30);
      await editor.fill('https://github.com/example/project');
      await page.getByTestId('composer-show-link-card').click();
      await expect(page.getByTestId('composer-standalone-link').getByRole('button', { name: /example\/project/ })).toBeVisible();
      await expect(editor).toBeHidden();
      await page.getByTestId('composer-edit-link').click();
      await expect(editor).toBeFocused();
      const mixed = '参考仓库 facebook/react，修改 src/App.tsx:42，采用 npm:zod，主色 #0EA5E9，画布 1280×720。';
      await editor.fill(mixed);
      const refs = draftPreview.getByRole('list', { name: 'References', exact: true });
      await expect(refs.getByRole('listitem')).toHaveCount(5);
      await expect(refs.locator('button[data-kind="repo"]')).toContainText('facebook/react');
      await expect(refs.locator('[data-kind="path"]').first()).toContainText('App.tsx:42');
      await expect(refs.locator('button[data-kind="npm"]')).toContainText('zod');
      const color = refs.locator('button[data-kind="color"]');
      await expect(color.locator('.draft-color-swatch')).toHaveCSS('background-color', 'rgb(14, 165, 233)');
      await color.click();
      await expect(page.locator('html')).toHaveAttribute('data-test-clipboard', '#0EA5E9');
      const composerShell = editor.locator('xpath=ancestor::*[contains(@class, "codex-composer-shell")][1]');
      await composerShell.screenshot({ path: testInfo.outputPath('live-references.png'), animations: 'disabled' });
      await liveToggle.click();
      await editor.fill(mixed.replace('facebook/react', 'vercel/next.js'));
      await expect(liveToggle).toContainText('vercel/next.js');
      await expect(liveToggle).toHaveAttribute('aria-expanded', 'false');
      await composerShell.screenshot({ path: testInfo.outputPath('collapsed-references.png'), animations: 'disabled' });
      await liveToggle.focus();
      await page.keyboard.press('Enter');
      await expect(refs.getByRole('listitem')).toHaveCount(5);
      const originalViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      await page.setViewportSize({ width: 420, height: 800 });
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      expect(await draftPreview.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await draftPreview.screenshot({ path: testInfo.outputPath('narrow-references.png'), animations: 'disabled' });
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      await page.setViewportSize(originalViewport);
      await expect(editor).toHaveValue(mixed.replace('facebook/react', 'vercel/next.js'));
      await editor.fill('');
      await expect(draftPreview).toHaveCount(0);
      await editor.fill('{"status":"ready","items":[1,2]}');
      await richMode.click();
      await expect(editor).toBeHidden();
      await expect(draftPreview.getByTestId('assistant-code-header')).toContainText('json');
      expect(await draftPreview.locator('pre').textContent()).toContain('\n  "status": "ready"');
      await richMode.click();
      await expect(editor).toBeFocused();
      await editor.fill('--- a/readme.md\n+++ b/readme.md\n@@ -1 +1 @@\n-old\n+new');
      await richMode.click();
      await expect(draftPreview.getByTestId('assistant-code-header')).toContainText('diff');
      await richMode.click();
      const rawDraft = ['## Release checklist', '', '- [x] Verify the build', '', `API_KEY=${SYNTHETIC_KEY}`].join('\n');
      await editor.fill(rawDraft);
      const overlay = page.getByTestId('composer-draft-overlay');
      await expect(overlay).toContainText('API_KEY=••••');
      await expect(overlay).not.toContainText(SYNTHETIC_KEY);
      await expect(editor).toHaveValue(rawDraft);
      expect(await editor.evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-text-fill-color'))).toBe('rgba(0, 0, 0, 0)');
      const clipboard = await editor.evaluate((el: HTMLTextAreaElement) => {
        const at = el.value.indexOf('testOnly');
        el.setSelectionRange(at, at + 4);
        const data = new DataTransfer();
        el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
        return data.getData('text/plain');
      });
      expect(clipboard).toBe('••••••');
      await expect(draftPreview.getByTestId('composer-rendered-draft')).toHaveCount(0);
      await richMode.click();
      await expect(editor).toBeHidden();
      await expect(draftPreview.getByRole('heading', { name: 'Release checklist' })).toBeVisible();
      await expect(draftPreview.getByRole('checkbox')).toBeChecked();
      await expect(draftPreview).not.toContainText(SYNTHETIC_KEY);
      const composerShot = testInfo.outputPath('unsent-composer.png');
      await editor.locator('xpath=ancestor::*[contains(@class, "codex-composer-shell")][1]').screenshot({ path: composerShot, animations: 'disabled' });
      await draftPreview.getByRole('heading', { name: 'Release checklist' }).dblclick();
      await expect(editor).toBeFocused();
      const longDraft = '# Deployment notes\n\n' + 'Line of draft\n'.repeat(30) + 'End of draft';
      await editor.fill(longDraft);
      await expect(draftPreview.getByTestId('composer-rendered-draft')).toHaveCount(0);
      await richMode.click();
      await expect(draftPreview).toContainText('End of draft');
      await richMode.click();
      await expect(editor).toHaveValue(longDraft);
      await editor.fill('');
      await expect(draftPreview).toHaveCount(0);
      await expect(userBubble.getByRole('heading', { name: 'Review checklist' })).toBeVisible();
      await expect(userBubble.getByRole('checkbox')).toBeChecked();
      await expect(userBubble.getByRole('button', { name: /example\/project/ })).toBeVisible();
      await expect(userBubble.getByRole('link', { name: 'example/project#42' })).toHaveAttribute('href', 'https://github.com/example/project/issues/42');
      expect(await userBubble.innerHTML()).not.toContain(SYNTHETIC_KEY);
      await userBubble.getByTestId('assistant-code-copy').click();
      await expect(page.locator('html')).toHaveAttribute('data-test-clipboard', /API_KEY=••••••/);
      await userBubble.hover();
      await page.getByTestId('chat-user-message-copy').click();
      const copied = await page.locator('html').getAttribute('data-test-clipboard');
      expect(copied).toContain('### Review checklist');
      expect(copied).not.toContain(SYNTHETIC_KEY);
      const windowSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      await page.setViewportSize({ width: 420, height: 800 });
      expect(await userBubble.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const richScreenshot = testInfo.outputPath('rich-user-message.png');
      await userBubble.screenshot({ path: richScreenshot, animations: 'disabled' });
      await testInfo.attach('rich-user-message', { path: richScreenshot, contentType: 'image/png' });
      await page.setViewportSize(windowSize);
      expect(await userBubble.evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThan(0);
      await expect(userBubble).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

      const assistantProse = page.locator('.prose').filter({ hasText: 'Plain Markdown reply' }).first();
      await expect(assistantProse).toBeVisible({ timeout: 30_000 });
      await expect(assistantProse).toHaveAttribute('data-status', 'complete');
      await expect(assistantProse.locator('strong')).toHaveText('works');
      await expect(assistantProse.locator('code').filter({ hasText: 'worksToo()' })).toBeVisible();
      await expect(assistantProse.locator('blockquote')).toContainText('Quoted context');
      await expect(assistantProse.locator('table')).toContainText('Table row');
      await expect(assistantProse.locator('input[type="checkbox"]')).toBeChecked();
      await expect(assistantProse.getByTestId('assistant-code-header')).toContainText('ts');
      await expect(assistantProse.locator('pre')).toContainText('const rich = true;');
      await expect(assistantProse.locator('.markdown-syntax-token').first()).toBeAttached();
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
        const colors = await assistantProse.evaluate(element => {
          const ink = (selector: string) => getComputedStyle(element.querySelector(selector)!).color;
          return {
            prose: [ink('h3'), ink('p'), ink('a'), ink('li code'), ink('blockquote')],
            syntax: [...element.querySelectorAll('.markdown-syntax-token')].map(token => getComputedStyle(token).color),
          };
        });
        expect(new Set(colors.prose).size).toBe(colors.prose.length);
        expect(new Set(colors.syntax).size).toBeGreaterThan(1);
      }
      // The button publishes its state through `aria-label`; the `title`
      // attribute was dropped in the Codex visual polish and this assertion had
      // been dead since. The 2000ms revert timer bounds the observable window,
      // so keep the retry budget inside it.
      await assistantProse.getByTestId('assistant-code-copy').click();
      await expect(assistantProse.getByTestId('assistant-code-copy')).toHaveAttribute('aria-label', 'Copied', { timeout: 2000 });

      const assistantStyles = await assistantProse.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const parentStyle = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
        return {
          backgroundColor: style.backgroundColor,
          borderRadius: style.borderRadius,
          paddingLeft: style.paddingLeft,
          paddingTop: style.paddingTop,
          parentBackgroundColor: parentStyle?.backgroundColor ?? '',
          parentBorderRadius: parentStyle?.borderRadius ?? '',
        };
      });

      expect(assistantStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(assistantStyles.borderRadius).toBe('0px');
      expect(assistantStyles.paddingLeft).toBe('0px');
      expect(assistantStyles.paddingTop).toBe('0px');
      expect(assistantStyles.parentBackgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(assistantStyles.parentBorderRadius).toBe('0px');

      const screenshotPath = testInfo.outputPath('chat_assistant_plain_markdown.png');
      await assistantProse.screenshot({ path: screenshotPath });
      await testInfo.attach('chat_assistant_plain_markdown', {
        path: screenshotPath,
        contentType: 'image/png',
      });

      try {
        mkdirSync(dirname(CLOUD_ARTIFACT_PATH), { recursive: true });
        copyFileSync(screenshotPath, CLOUD_ARTIFACT_PATH);
      } catch {
        // Cloud artifact directory is optional; ignore when unavailable (e.g. on CI runners).
      }
      const messageSession = userBubble.getByRole('button', { name: 'Open conversation Rendering notes' });
      await expect(messageSession).toBeVisible();
      expect((await messageSession.boundingBox())!.height).toBeLessThanOrEqual(22);
      await expect(messageSession).toHaveAttribute('title', 'Rendering notes\n' + LINKED_ID);
      await editor.fill(LINKED_ID);
      await page.getByTestId('composer-show-link-card').click();
      await page.getByTestId('composer-standalone-link').getByRole('button', { name: /Rendering notes/ }).press('Enter');
      const linkedBubble = page.getByTestId('chat-user-message-bubble').filter({ hasText: 'Linked conversation' });
      const disclosure = linkedBubble.getByRole('button', { name: 'Show full message' });
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await expect(linkedBubble).not.toContainText('End of log');
      await disclosure.focus();
      await page.keyboard.press('Enter');
      await expect(linkedBubble).toContainText('End of log');
      await linkedBubble.getByRole('button', { name: 'Show less' }).click();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    } finally {
      await closeElectronApp(app);
    }
  });
});
