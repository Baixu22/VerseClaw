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

function relaxedPlanBlock(): string {
  return [
    '```tool-ui plan',
    '{',
    "  component: 'plan',",
    '  props: {',
    "    id: 'plan-e2e',",
    "    title: 'Renderer rollout',",
    '    todos: [',
    "      { id: 'inspect', label: 'Inspect renderer', status: 'completed', },",
    "      { id: 'adapt', label: 'Adapt Tool UI cards', status: 'in_progress', },",
    '    ],',
    '  },',
    '}',
    '```',
  ].join('\n');
}

const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Show structured interaction rendering.' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'text',
      text: [
        'Structured interaction examples:',
        '',
        relaxedPlanBlock(),
        '',
        toolUiBlock({
          type: 'option-list',
          id: 'options-e2e',
          title: 'Choose a path',
          selectionMode: 'single',
          options: [
            { id: 'simple', label: 'Simple path' },
            { id: 'guided', label: 'Guided path' },
          ],
        }),
        '',
        toolUiBlock({
          type: 'question-flow',
          id: 'question-e2e',
          steps: [
            {
              id: 'scope',
              title: 'Which scope should be optimized?',
              options: [
                { id: 'rendering', label: 'Rendering only' },
                { id: 'runtime', label: 'Runtime protocol' },
              ],
            },
          ],
        }),
        '',
        'Question: Which fallback path should render?',
        'Options:',
        '1. Markdown question fallback',
        '2. Raw markdown only',
        '',
        toolUiBlock({
          type: 'preferences-panel',
          id: 'prefs-e2e',
          title: 'Rendering preferences',
          sections: [
            {
              heading: 'Display',
              items: [
                { id: 'rich', type: 'switch', label: 'Rich cards', defaultChecked: true },
                {
                  id: 'density',
                  type: 'toggle',
                  label: 'Density',
                  options: [
                    { value: 'compact', label: 'Compact' },
                    { value: 'comfortable', label: 'Comfortable' },
                  ],
                },
              ],
            },
          ],
        }),
      ].join('\n'),
    }],
    timestamp: Date.now(),
  },
];

test.describe('Verse Claw Tool UI interaction rendering', () => {
  test('renders plan, options, question flow, and preferences cards from assistant payloads', async ({ launchElectronApp }) => {
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
      await expect(page.getByTestId('chat-tool-ui-plan').filter({ hasText: 'Renderer rollout' })).toBeVisible();
      await expect(page.getByTestId('chat-tool-ui-option-list').filter({ hasText: 'Choose a path' })).toBeVisible();
      await expect(page.getByTestId('chat-tool-ui-question-flow').filter({ hasText: 'Which scope should be optimized?' })).toBeVisible();
      await expect(page.getByTestId('chat-tool-ui-question-flow').filter({ hasText: 'Which fallback path should render?' })).toBeVisible();
      await expect(page.getByTestId('chat-tool-ui-preferences-panel').filter({ hasText: 'Rendering preferences' })).toBeVisible();
      await expect(page.getByText('"todos"')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
