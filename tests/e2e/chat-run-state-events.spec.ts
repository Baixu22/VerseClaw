import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

// FP-P1-01 added a first-send provider gate: when no usable provider exists the
// composer intercepts the send instead of dispatching it. Tests that actually
// send a message must therefore present a configured, keyed default account,
// otherwise the send never happens and no run/message is ever produced.
const PROVIDER_TIMESTAMP = '2026-01-01T00:00:00.000Z';
const PROVIDER_HOST_API_MOCKS: Record<string, unknown> = {
  [stableStringify(['providers', 'accounts', null])]: [
    {
      id: 'anthropic-e2e',
      vendorId: 'anthropic',
      label: 'Anthropic',
      authMode: 'api_key',
      model: 'claude-opus-4',
      enabled: true,
      isDefault: true,
      createdAt: PROVIDER_TIMESTAMP,
      updatedAt: PROVIDER_TIMESTAMP,
    },
  ],
  [stableStringify(['providers', 'accountKeyInfo', null])]: [
    { accountId: 'anthropic-e2e', hasKey: true, keyMasked: 'sk-***' },
  ],
  [stableStringify(['providers', 'vendors', null])]: [],
  [stableStringify(['providers', 'getDefaultAccount', null])]: { accountId: 'anthropic-e2e' },
};

test.describe('Verse Claw chat run state events', () => {
  test('anchors the live thinking matrix to the latest assistant output and clears it after completion', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.send', null])]: {
            success: true,
            result: { runId: 'run-inline-status' },
          },
        },
        hostApi: {
          ...PROVIDER_HOST_API_MOCKS,
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
          [stableStringify(['usage', 'live', { sessionKey: MAIN_SESSION_KEY, runId: 'run-inline-status', streaming: true }])]: {
            success: true,
            usage: {
              sessionKey: MAIN_SESSION_KEY,
              runId: 'run-inline-status',
              inputTokens: 100,
              outputTokens: 145,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 245,
              updatedAt: Date.now(),
              status: 'streaming',
            },
          },
          [stableStringify(['chat', 'sendWithMedia', null])]: {
            success: true,
            result: { runId: 'run-inline-status' },
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

      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('Render the latest status inline');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByText('Render the latest status inline')).toBeVisible();

      await app.evaluate(({ BrowserWindow }, sessionKey) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.started',
            runId: 'run-inline-status',
            sessionKey,
            startedAt: Date.now() - 14_000,
          });
          win.webContents.send('chat:runtime-event', {
            type: 'tool.started',
            runId: 'run-inline-status',
            sessionKey,
            toolCallId: 'status-tool',
            name: 'read',
            args: { path: '/tmp/status.md' },
          });
        }
      }, MAIN_SESSION_KEY);

      const activityToggle = page.getByTestId('chat-turn-summary-toggle');
      await expect(activityToggle).toBeVisible();
      await expect(activityToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(activityToggle).toContainText(/Working|处理中/);

      // The reply bubble is only promoted once no tool is still running, so
      // settle the read tool before streaming the assistant text.
      await app.evaluate(({ BrowserWindow }, payload) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'tool.completed',
            runId: payload.runId,
            sessionKey: payload.sessionKey,
            toolCallId: 'status-tool',
            name: 'read',
            result: { summary: 'read status.md' },
            isError: false,
          });
          win.webContents.send('chat:runtime-event', {
            type: 'assistant.delta',
            runId: payload.runId,
            sessionKey: payload.sessionKey,
            text: 'First line of streamed output.',
            replace: true,
          });
        }
      }, { runId: 'run-inline-status', sessionKey: MAIN_SESSION_KEY });

      await expect(page.getByText('First line of streamed output.')).toBeVisible();
      await expect(activityToggle).toHaveAttribute('aria-expanded', 'false');

      const screenshotPath = testInfo.outputPath('assistant-stream-status-inline.png');
      await page.screenshot({ path: screenshotPath, fullPage: false });
      await testInfo.attach('assistant-stream-status-inline', {
        path: screenshotPath,
        contentType: 'image/png',
      });

      await app.evaluate(({ BrowserWindow }, payload) => {
        const text = [
          'First line of streamed output.',
          '',
          'Second paragraph keeps growing.',
          '',
          'Third paragraph moves the status down.',
          '',
          'Fourth paragraph keeps the same left anchor.',
        ].join('\n');
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'assistant.delta',
            runId: payload.runId,
            sessionKey: payload.sessionKey,
            text,
            replace: true,
          });
        }
      }, { runId: 'run-inline-status', sessionKey: MAIN_SESSION_KEY });

      await expect(page.getByText('Fourth paragraph keeps the same left anchor.')).toBeVisible();
      await expect(activityToggle).toHaveAttribute('aria-expanded', 'false');

      await app.evaluate(({ BrowserWindow }, sessionKey) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.ended',
            runId: 'run-inline-status',
            sessionKey,
            status: 'completed',
            endedAt: Date.now(),
          });
        }
      }, MAIN_SESSION_KEY);

      // A finished run self-quiets: the live "Working for …" label turns into a
      // past-tense receipt instead of disappearing entirely.
      await expect(page.getByTestId('chat-turn-summary-card')).toHaveAttribute('data-status', 'completed');
      await expect(activityToggle).toContainText(/Worked for|Work details|用时|工作详情/);
      await expect(activityToggle).not.toContainText(/Working|处理中/);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps stop control active across non-terminal runtime events and clears it on run.ended', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.send', null])]: {
            success: true,
            result: { runId: 'run-e2e' },
          },
        },
        hostApi: {
          ...PROVIDER_HOST_API_MOCKS,
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
          },
          [stableStringify(['/api/chat/sessions', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                result: {
                  sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
                },
              },
            },
          },
          [stableStringify(['/api/chat/history', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                result: { messages: [] },
              },
            },
          },
          [stableStringify(['/api/chat/send', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                result: { runId: 'run-e2e' },
              },
            },
          },
          [stableStringify(['chat', 'sendWithMedia', null])]: {
            success: true,
            result: { runId: 'run-e2e' },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
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

      const sendButton = page.getByTestId('chat-composer-send');
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('run long task');
      await sendButton.click();

      await app.evaluate(({ BrowserWindow }, sessionKey) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.started',
            runId: 'run-e2e',
            sessionKey,
            startedAt: Date.now(),
          });
        }
      }, MAIN_SESSION_KEY);
      await expect(sendButton).toHaveAttribute('aria-label', /Stop|停止/);

      await app.evaluate(({ BrowserWindow }, sessionKey) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'tool.started',
            runId: 'run-e2e',
            sessionKey,
            toolCallId: 'call-1',
            name: 'read',
            args: { filePath: '/tmp/demo.md' },
          });
        }
      }, MAIN_SESSION_KEY);

      await expect(page.getByTestId('chat-execution-graph')).toBeVisible();

      await app.evaluate(({ BrowserWindow }, sessionKey) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'tool.completed',
            runId: 'run-e2e',
            sessionKey,
            toolCallId: 'call-1',
            name: 'read',
            result: { summary: 'done' },
            isError: false,
          });
        }
      }, MAIN_SESSION_KEY);

      await expect(sendButton).toHaveAttribute('aria-label', /Stop|停止/);

      await app.evaluate(({ BrowserWindow }, sessionKey) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.ended',
            runId: 'run-e2e',
            sessionKey,
            status: 'completed',
            endedAt: Date.now(),
          });
        }
      }, MAIN_SESSION_KEY);

      await expect(sendButton).toHaveAttribute('aria-label', /Send|发送/);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders historical execution graph with tool results and final assistant reply', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const seededHistory = [
      {
        role: 'user',
        id: 'user-repair',
        timestamp: Date.now() / 1000,
        content: [{ type: 'text', text: 'Fix subtract and verify tests.' }],
      },
      {
        role: 'assistant',
        id: 'assistant-tools',
        timestamp: Date.now() / 1000,
        content: [
          { type: 'tool_use', id: 'read-call', name: 'read', input: { filePath: 'src/math.js' } },
          { type: 'tool_use', id: 'edit-call', name: 'edit', input: { filePath: 'src/math.js' } },
          { type: 'tool_use', id: 'exec-call', name: 'exec', input: { command: 'node test/run-tests.mjs' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'read-call',
        toolName: 'read',
        timestamp: Date.now() / 1000,
        content: [{ type: 'text', text: 'Read src/math.js' }],
      },
      {
        role: 'toolResult',
        toolCallId: 'edit-call',
        toolName: 'edit',
        timestamp: Date.now() / 1000,
        content: [{ type: 'text', text: 'Updated subtract implementation' }],
      },
      {
        role: 'toolResult',
        toolCallId: 'exec-call',
        toolName: 'exec',
        timestamp: Date.now() / 1000,
        content: [{ type: 'text', text: 'math tests passed' }],
      },
      {
        role: 'assistant',
        id: 'assistant-final',
        timestamp: Date.now() / 1000,
        content: [{ type: 'text', text: 'Fixed subtract and tests now pass.' }],
      },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
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
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
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

      await expect(page.getByText('Fix subtract and verify tests.')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-message-2').getByText('Fixed subtract and tests now pass.')).toBeVisible();
      const summary = page.getByTestId('chat-turn-summary-card');
      await expect(summary).toBeVisible();
      await expect(summary.getByTestId('chat-turn-summary-toggle')).toHaveAttribute('aria-expanded', 'true');

      const graph = summary.getByTestId('chat-execution-graph');
      await expect(graph).toBeVisible({ timeout: 30_000 });
      await expect(graph).toHaveAttribute('data-collapsed', 'false');

      const readStep = graph.getByTestId('chat-execution-step').filter({ hasText: 'read' }).first();
      await readStep.getByTestId('chat-execution-step-toggle').click();
      await expect(readStep.getByTestId('chat-execution-step-detail')).toContainText('src/math.js');

      await summary.getByTestId('chat-turn-summary-toggle').click();
      await expect(summary.getByTestId('chat-turn-summary-toggle')).toHaveAttribute('aria-expanded', 'false');
      await expect(summary.getByTestId('chat-turn-summary-details')).toHaveCount(0);
      await summary.getByTestId('chat-turn-summary-toggle').click();
      await expect(summary.getByTestId('chat-turn-summary-toggle')).toHaveAttribute('aria-expanded', 'true');
      await expect(summary.getByTestId('chat-execution-step-detail')).toContainText('src/math.js');

      await expect(graph.getByText('read', { exact: true })).toBeVisible();
      await expect(graph.getByText('edit', { exact: true })).toBeVisible();
      await expect(graph.getByText('exec', { exact: true })).toBeVisible();
      await expect(graph.getByText('Tool Result: read', { exact: true })).toBeVisible();
      await expect(graph.getByText('Tool Result: edit', { exact: true })).toBeVisible();
      await expect(graph.getByText('Tool Result: exec', { exact: true })).toBeVisible();
      await expect(graph.getByText('Assistant Final', { exact: true })).toHaveCount(0);
      await expect(graph.getByText('Fixed subtract and tests now pass.', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('chat-message-2').getByText('Fixed subtract and tests now pass.')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows clear image preview states for generated media while hydration retries', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const gatewayUrl = '/api/chat/media/outgoing/agent%3Amain%3Aimage-preview/image-1/full';
    const history = [
      {
        role: 'assistant',
        id: 'generated-image',
        timestamp: Date.now() / 1000,
        content: [{
          type: 'image',
          url: gatewayUrl,
          mimeType: 'image/png',
          alt: 'generated.png',
        }],
      },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: history },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
          [stableStringify(['/api/files/thumbnails', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { [gatewayUrl]: { preview: null, fileSize: 0 } },
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

      await expect(page.getByTestId('image-preview-unavailable')).toBeVisible({ timeout: 10_000 });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('hydrates Windows MEDIA SVG artifacts without leaking the marker text', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const filePath = String.raw`C:\Users\Administrator\.openclaw\workspace\japan-kansai-4d3n-plan.svg`;
    const svgPreview = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>').toString('base64')}`;
    const history = [
      {
        role: 'assistant',
        id: 'windows-svg-artifact',
        timestamp: Date.now() / 1000,
        content: String.raw`SVG file is ready:

MEDIA:C:\Users\Administrator\.openclaw\workspace\japan-kansai-4d3n-plan.svg`,
      },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: history },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
          [stableStringify(['/api/files/thumbnails', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { [filePath]: { preview: svgPreview, fileSize: 73 } },
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

      await expect(page.getByText('SVG file is ready:')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('MEDIA:C:')).toHaveCount(0);
      await expect(page.locator('img[alt="japan-kansai-4d3n-plan.svg"]')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
