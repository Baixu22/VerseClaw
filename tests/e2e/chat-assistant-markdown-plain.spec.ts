import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
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
    content: [{ type: 'text', text: 'Please render a Markdown reply plainly.' }],
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
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
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
        },
        hostApi: {
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
          value: { writeText: async () => undefined },
        });
      });

      // Located by testid, not by fill utility. The previous selector
      // (`div.rounded-2xl.bg-brand`) went stale when the bubble stopped using a
      // `bg-brand` token — it matched nothing, so this assertion had been dead
      // before the transcript adopted the Codex recipe. The point of the check
      // is that user prompts stay bubbled while assistant text renders plain,
      // so assert the rounding that carries that contrast.
      const userBubble = page.getByTestId('chat-user-message-bubble').filter({ hasText: 'Please render a Markdown reply plainly.' }).first();
      await expect(userBubble).toBeVisible({ timeout: 30_000 });
      await expect(userBubble).toHaveClass(/rounded-2xl/);

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
    } finally {
      await closeElectronApp(app);
    }
  });
});
