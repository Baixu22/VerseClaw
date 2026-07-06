import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const fixedTimestamp = 1_772_000_000_000;

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

const seededHistory = [
  {
    id: 'ai-elements-user',
    role: 'user',
    content: [{ type: 'text', text: 'Render AI Elements migrated cards.' }],
    timestamp: fixedTimestamp,
  },
  {
    id: 'ai-elements-assistant',
    role: 'assistant',
    content: [{
      type: 'text',
      text: [
        '### AI Elements rendering check',
        '',
        'The raw payloads below should be rendered as local adapted AI Elements cards.',
        '',
        toolUiBlock({
          type: 'test-results',
          id: 'ai-test-results-e2e',
          title: 'Vite verification',
          summary: { total: 4, passed: 2, failed: 1, skipped: 1, durationMs: 1840 },
          suites: [{
            id: 'suite-renderer',
            name: 'renderer.test.tsx',
            status: 'failed',
            tests: [
              { name: 'renders migrated test card', status: 'passed', durationMs: 34 },
              { name: 'keeps stack detail visible', status: 'failed', durationMs: 21, error: { message: 'Expected stack frame to be visible', stack: 'at renderer.test.tsx:42:13' } },
              { name: 'handles skipped scenario', status: 'skipped' },
            ],
          }],
        }),
        '',
        toolUiBlock({
          type: 'stack-trace',
          id: 'ai-stack-trace-e2e',
          title: 'Preview runtime error',
          errorType: 'TypeError',
          message: 'Cannot read properties of undefined',
          source: 'web-preview',
          stack: [
            'TypeError: Cannot read properties of undefined',
            '    at renderPreview (src/components/Preview.tsx:42:13)',
            '    at App (src/App.tsx:18:5)',
          ].join('\n'),
        }),
        '',
        toolUiBlock({
          type: 'chain-of-thought',
          id: 'ai-cot-e2e',
          title: 'Migration reasoning',
          defaultOpen: true,
          steps: [
            { title: 'Inspect existing renderer', description: 'Preserve Gateway and host-api flows.', status: 'complete' },
            { title: 'Adapt local components', description: 'Use ClawX tokens and lightweight collapsibles.', status: 'active', results: [{ label: 'workspace tree', url: 'https://example.test/tree' }] },
            { title: 'Accept screenshot baseline', status: 'pending' },
          ],
        }),
        '',
        toolUiBlock({
          type: 'task',
          id: 'ai-task-e2e',
          title: 'Migration tasks',
          defaultOpen: true,
          items: [
            {
              label: 'Wire chat cards',
              detail: 'Render structured payloads inside the assistant message stream.',
              files: [{ path: 'src/components/tool-ui/agent-interactions.tsx', status: 'modified' }],
            },
            {
              label: 'Verify workspace panels',
              files: [{ path: 'tests/e2e/workspace-web-preview-panel.spec.ts', status: 'updated' }],
            },
          ],
        }),
        '',
        toolUiBlock({
          type: 'reasoning',
          id: 'ai-reasoning-e2e',
          title: 'Thinking',
          summary: 'Loading state uses the local shimmer treatment.',
          loading: true,
          defaultOpen: true,
        }),
      ].join('\n'),
    }],
    timestamp: fixedTimestamp,
  },
];

async function openSeededChat(page: Awaited<ReturnType<typeof getStableWindow>>) {
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
      throw error;
    }
  }
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
      [data-sonner-toaster] {
        display: none !important;
      }
    `,
  });
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
}

test.describe('AI Elements local adapted rendering', () => {
  test('renders migrated assistant output cards with screenshot coverage', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
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
            data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345 } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'main' }] } },
          },
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            agents: [{ id: 'main', name: 'main', isDefault: true, mainSessionKey: SESSION_KEY, channelTypes: [] }],
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [],
            activeWorkspaceId: null,
            activeWorkspace: null,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: null,
            activeWorkspace: null,
          },
        },
      });

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1280, height: 900 });
      await openSeededChat(page);

      await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      });

      await expect(page.getByTestId('chat-tool-ui-test-results')).toContainText('Vite verification');
      await expect(page.getByTestId('chat-tool-ui-test-results')).toContainText('Expected stack frame to be visible');
      await expect(page.getByTestId('chat-tool-ui-stack-trace')).toContainText('Preview runtime error');
      await expect(page.getByTestId('ai-stack-trace-frames')).toContainText('Preview.tsx');
      await expect(page.getByTestId('chat-tool-ui-chain-of-thought')).toContainText('Migration reasoning');
      await expect(page.getByTestId('chat-tool-ui-chain-of-thought')).toContainText('Adapt local components');
      await expect(page.getByTestId('chat-tool-ui-task')).toContainText('Migration tasks');
      await expect(page.getByTestId('chat-tool-ui-task')).toContainText('agent-interactions.tsx');
      await expect(page.getByTestId('chat-tool-ui-reasoning')).toBeVisible();
      await expect(page.getByTestId('ai-element-shimmer')).toContainText('Thinking');
      await expect(page.getByText('"test-results"', { exact: false })).toHaveCount(0);

      const scrollContainer = page.getByTestId('chat-scroll-container');
      await page.getByTestId('chat-tool-ui-test-results').scrollIntoViewIfNeeded();
      await expect(scrollContainer).toHaveScreenshot('ai-elements-chat-light.png', {
        animations: 'disabled',
        caret: 'hide',
      });

      await page.evaluate(() => {
        document.documentElement.classList.remove('light');
        document.documentElement.classList.add('dark');
      });
      await page.getByTestId('chat-tool-ui-test-results').scrollIntoViewIfNeeded();
      await expect(scrollContainer).toHaveScreenshot('ai-elements-chat-dark.png', {
        animations: 'disabled',
        caret: 'hide',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
