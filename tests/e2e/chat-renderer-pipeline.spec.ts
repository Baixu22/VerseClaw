import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function toolUiBlock(payload: Record<string, unknown>): string {
  return ['```tool-ui', JSON.stringify(payload), '```'].join('\n');
}

/**
 * This assistant message exercises both rendering pipelines simultaneously:
 *
 *  1. assistant-ui — MarkdownTextPrimitive renders the Markdown prose
 *     (bold, code, blockquote, table, code block with copy button).
 *  2. tool-ui — parseToolUiContent extracts the fenced ```tool-ui blocks
 *     and renders them as interactive cards (plan, table, alert, key-value,
 *     progress), stripping the raw JSON from the visible text.
 *
 * Verifying both in the same message proves the "actual usage judgment"
 * (data-driven suppress flags + parseToolUiContent) works end-to-end:
 * the prose renderer and the card renderer coexist without conflict.
 */
const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Show me a mixed response with markdown and structured cards.' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'text',
      text: [
        '### Renderer pipeline check',
        '',
        'This reply validates that **assistant-ui** Markdown and **tool-ui** cards both render.',
        '',
        '- Bold: **works**',
        '- Inline code: `worksToo()`',
        '',
        '> Quoted context stays grouped.',
        '',
        '```ts',
        'const pipeline = "assistant-ui + tool-ui";',
        '```',
        '',
        toolUiBlock({
          type: 'plan',
          id: 'plan-pipeline',
          title: 'Pipeline verification',
          todos: [
            { id: 'markdown', label: 'Verify Markdown prose', status: 'completed' },
            { id: 'cards', label: 'Verify tool-ui cards', status: 'in_progress' },
            { id: 'cleanup', label: 'Verify JSON stripped', status: 'pending' },
          ],
        }),
        '',
        toolUiBlock({
          type: 'table',
          id: 'table-pipeline',
          title: 'Card coverage',
          columns: [
            { key: 'card', label: 'Card' },
            { key: 'status', label: 'Status' },
          ],
          rows: [
            { card: 'Plan', status: 'Rendered' },
            { card: 'Table', status: 'Rendered' },
            { card: 'Alert', status: 'Rendered' },
          ],
        }),
        '',
        toolUiBlock({
          type: 'alert',
          id: 'alert-pipeline',
          variant: 'success',
          title: 'Pipeline healthy',
          message: 'Both renderers are active in this message.',
          dismissible: false,
        }),
        '',
        toolUiBlock({
          type: 'key-value',
          id: 'kv-pipeline',
          title: 'Renderer details',
          entries: [
            { key: 'Markdown engine', value: 'MarkdownTextPrimitive' },
            { key: 'Card parser', value: 'parseToolUiContent' },
          ],
        }),
        '',
        toolUiBlock({
          type: 'progress',
          id: 'progress-pipeline',
          label: 'Verification progress',
          value: 60,
          max: 100,
          status: 'active',
          unit: '%',
        }),
      ].join('\n'),
    }],
    timestamp: Date.now(),
  },
];

test.describe('Chat renderer pipeline — assistant-ui + tool-ui coexistence', () => {
  test('renders Markdown prose and tool-ui cards in the same assistant message', async ({ launchElectronApp }) => {
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
        // The real clipboard rejects under the Electron test runner (the window
        // isn't focused), so the copy handler's `await` throws and the button
        // never reaches its "Copied" state. chat-user-message-actions.spec.ts
        // stubs the same way for the same reason.
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async () => undefined },
        });
      });

      // ── assistant-ui MarkdownTextPrimitive assertions ──
      // The .prose class + data-status="complete" prove MarkdownTextPrimitive is
      // the actual renderer, not a fallback.
      const assistantProse = page.locator('.prose').filter({ hasText: 'Renderer pipeline check' }).first();
      await expect(assistantProse).toBeVisible({ timeout: 30_000 });
      await expect(assistantProse).toHaveAttribute('data-status', 'complete');
      await expect(assistantProse.locator('strong', { hasText: 'works' })).toHaveText('works');
      await expect(assistantProse.locator('code').filter({ hasText: 'worksToo()' })).toBeVisible();
      await expect(assistantProse.locator('blockquote')).toContainText('Quoted context');
      await expect(assistantProse.getByTestId('assistant-code-header')).toContainText('ts');
      await expect(assistantProse.locator('pre')).toContainText('pipeline');

      // Code copy button interaction — proves the assistant-ui code header is interactive.
      // State is published via `aria-label` (not `title`), and reverts after 2000ms.
      await assistantProse.getByTestId('assistant-code-copy').click();
      await expect(assistantProse.getByTestId('assistant-code-copy')).toHaveAttribute('aria-label', 'Copied', { timeout: 2000 });

      // ── tool-ui card assertions ──
      // Each card type has a dedicated data-testid proving parseToolUiContent
      // extracted the interaction and the correct Card component rendered it.
      // For cards where the title lives in the ToolUiShell header (outside the
      // inner test-id div), we filter by content that appears inside the div.
      await expect(page.getByTestId('chat-tool-ui-plan').filter({ hasText: 'Pipeline verification' })).toBeVisible();
      await expect(page.getByTestId('chat-tool-ui-table')).toBeVisible();
      await expect(page.getByTestId('chat-tool-ui-table').filter({ hasText: 'Rendered' })).toBeVisible();
      await expect(page.getByTestId('chat-tool-ui-alert').filter({ hasText: 'Pipeline healthy' })).toBeVisible();
      await expect(page.getByTestId('chat-tool-ui-key-value').filter({ hasText: 'MarkdownTextPrimitive' })).toBeVisible();
      await expect(page.getByTestId('chat-tool-ui-progress').filter({ hasText: '60' })).toBeVisible();

      // ── JSON stripping assertion ──
      // The fenced ```tool-ui blocks must be removed from the visible Markdown
      // text — raw JSON keys like "todos" or "columns" should not leak.
      await expect(page.getByText('"todos"', { exact: false })).toHaveCount(0);
      await expect(page.getByText('"columns"', { exact: false })).toHaveCount(0);

      // ── Coexistence assertion ──
      // Both the prose and the cards exist as siblings under the same assistant
      // message — neither suppresses the other.
      const proseCount = await page.locator('.prose').filter({ hasText: 'Renderer pipeline check' }).count();
      const cardCount = await page.getByTestId('chat-tool-ui-interactions').count();
      expect(proseCount).toBeGreaterThanOrEqual(1);
      expect(cardCount).toBeGreaterThanOrEqual(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});
