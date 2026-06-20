import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const fixedTimestamp = 1_772_100_000_000;

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
    id: 'user-turn-work',
    role: 'user',
    content: [{ type: 'text', text: 'Research the docs and write a short report.' }],
    timestamp: fixedTimestamp,
  },
  {
    id: 'assistant-turn-tools',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'I will fetch the source and prepare the report.',
      },
      {
        type: 'tool_use',
        id: 'tool-web',
        name: 'web_fetch',
        input: { url: 'https://example.com/docs/rendering' },
      },
      {
        type: 'tool_use',
        id: 'tool-write',
        name: 'Write',
        input: {
          file_path: 'C:\\tmp\\turn-work-report.md',
          content: '# Rendering report\n\nSource: https://example.com/docs/rendering\n',
        },
      },
    ],
    timestamp: fixedTimestamp + 1000,
  },
  {
    id: 'assistant-turn-final',
    role: 'assistant',
    content: [{ type: 'text', text: 'The report is ready and includes the referenced website.' }],
    timestamp: fixedTimestamp + 2000,
  },
];

async function installMocks(app: Parameters<typeof installIpcMocks>[0]) {
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
        data: {
          status: 200,
          ok: true,
          json: { success: true, agents: [{ id: 'main', name: 'main' }] },
        },
      },
      [stableStringify(['shell', 'openExternal', { url: 'https://example.com/docs/rendering' }])]: { success: true },
    },
  });
}

test.describe('ClawX turn work panel', () => {
  test('summarizes tasks, generated reports, and visited sources with visual baseline', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installMocks(app);
      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            caret-color: transparent !important;
          }
        `,
      });
      await expect(page.getByTestId('chat-page')).toBeVisible();

      const panel = page.getByTestId('turn-work-panel');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('Work panel');
      await expect(page.getByTestId('turn-work-tabs')).toContainText('Tasks');
      await expect(page.getByTestId('turn-work-tabs')).toContainText('Reports');
      await expect(page.getByTestId('turn-work-tabs')).toContainText('Sources');
      await expect(page.getByTestId('turn-work-reports')).toContainText('turn-work-report.md');

      await expect(panel).toHaveScreenshot('turn-work-panel-reports-light.png', {
        animations: 'disabled',
        caret: 'hide',
      });

      await page.getByRole('button', { name: 'Sources' }).click();
      await expect(page.getByTestId('turn-work-sources')).toContainText('example.com');
      await expect(panel).toHaveScreenshot('turn-work-panel-sources-light.png', {
        animations: 'disabled',
        caret: 'hide',
      });

      await page.getByRole('button', { name: 'Reports' }).click();
      await page.getByRole('button', { name: /turn-work-report\.md/ }).click();
      await expect(page.getByTestId('artifact-panel')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
