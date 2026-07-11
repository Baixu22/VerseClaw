import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

function surface(payload: Record<string, unknown>): string {
  return ['```tool-ui', JSON.stringify(payload), '```'].join('\n');
}

const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Show the execution receipt.' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'text',
      text: [
        '### Execution receipt',
        '',
        'The structured execution surfaces below come from the conversation payload.',
        '',
        surface({
          type: 'approval-card',
          id: 'approval-release',
          title: 'Publish the release?',
          description: 'This model decision returns through the chat interaction callback only.',
          icon: 'shield-alert',
          variant: 'destructive',
          confirmLabel: 'Approve',
          cancelLabel: 'Deny',
          metadata: [{ key: 'Target', value: 'staging' }],
        }),
        '',
        surface({
          type: 'terminal',
          id: 'terminal-tests',
          command: 'pnpm test --filter execution',
          cwd: 'C:/workspace/verse-claw',
          stdout: 'PASS tests/unit/tool-ui-run-surfaces.test.ts\n22 tests passed',
          exitCode: 0,
          durationMs: 1840,
        }),
        '',
        surface({
          type: 'code-diff',
          id: 'diff-agent',
          filePath: 'src/agent.ts',
          language: 'typescript',
          original: 'const status = "pending";\n',
          modified: 'const status = "completed";\n',
        }),
        '',
        surface({
          type: 'progress-tracker',
          id: 'progress-run',
          status: 'completed',
          steps: [
            { id: 'inspect', label: 'Inspect runtime events', status: 'completed' },
            { id: 'render', label: 'Render official Tool UI', status: 'completed' },
            { id: 'verify', label: 'Verify execution receipt', status: 'completed' },
          ],
          choice: {
            outcome: 'success',
            summary: 'Execution surfaces verified',
            at: new Date().toISOString(),
          },
        }),
      ].join('\n'),
    }],
    timestamp: Date.now(),
  },
];

test.describe('Tool UI execution surfaces', () => {
  test('renders official execution surfaces in light, dark, and narrow layouts', async ({ launchElectronApp }, testInfo) => {
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
        },
      });

      const page = await getStableWindow(app);
      await page.reload().catch((error) => {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      });

      const approval = page.getByTestId('chat-tool-ui-approval');
      const terminal = page.getByTestId('chat-tool-ui-terminal');
      const codeDiff = page.getByTestId('chat-tool-ui-code-diff');
      const progress = page.getByTestId('chat-tool-ui-progress-tracker');
      await expect(approval).toBeVisible({ timeout: 30_000 });
      await expect(terminal).toContainText('22 tests passed');
      await expect(terminal.locator('input')).toHaveCount(0);
      await expect(codeDiff).toContainText('agent.ts');
      await expect(progress).toContainText('Execution surfaces verified');
      await expect(page.getByText('"original"', { exact: false })).toHaveCount(0);

      const diskSpaceNotice = page.getByText('Disk space is running low', { exact: true });
      if (await diskSpaceNotice.isVisible().catch(() => false)) {
        await diskSpaceNotice.locator('xpath=ancestor::*[@data-sonner-toast][1]').getByRole('button').click();
      }

      const message = approval.locator('xpath=ancestor::*[starts-with(@data-testid,"chat-message-")][1]');
      await page.setViewportSize({ width: 1280, height: 1400 });
      await message.scrollIntoViewIfNeeded();
      const lightPath = testInfo.outputPath('tool-ui-execution-light.png');
      await message.screenshot({ path: lightPath });
      await testInfo.attach('tool-ui-execution-light', { path: lightPath, contentType: 'image/png' });

      await page.evaluate(() => document.documentElement.classList.add('dark'));
      const darkPath = testInfo.outputPath('tool-ui-execution-dark.png');
      await message.screenshot({ path: darkPath });
      await testInfo.attach('tool-ui-execution-dark', { path: darkPath, contentType: 'image/png' });

      await page.setViewportSize({ width: 800, height: 1400 });
      await message.scrollIntoViewIfNeeded();
      const narrowPath = testInfo.outputPath('tool-ui-execution-narrow.png');
      await message.screenshot({ path: narrowPath });
      await testInfo.attach('tool-ui-execution-narrow', { path: narrowPath, contentType: 'image/png' });
      expect((await terminal.boundingBox())?.width ?? 0).toBeLessThanOrEqual(760);
    } finally {
      await closeElectronApp(app);
    }
  });
});
