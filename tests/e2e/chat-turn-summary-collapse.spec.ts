import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import type { ElectronApplication } from '@playwright/test';

const SESSION_KEY = 'agent:main:main';

type LaunchElectronApp = (options?: {
  skipSetup?: boolean;
  flags?: string[];
  visualMode?: boolean;
  devScenario?: string;
}) => Promise<ElectronApplication>;

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function baseHostApiMocks(messageCount: number) {
  return {
    [stableStringify(['/api/settings', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { language: 'en', setupComplete: true, runActivityKeepExpandedOnComplete: false },
      },
    },
    [stableStringify(['settings', 'getAll', null])]: {
      language: 'en',
      setupComplete: true,
      runActivityKeepExpandedOnComplete: false,
    },
    [stableStringify(['gateway', 'status', null])]: {
      state: 'running',
      port: 18789,
      pid: 12345,
      gatewayReady: true,
    },
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
    [stableStringify(['/api/workspaces', 'GET'])]: {
      ok: true,
      data: { status: 200, ok: true, json: { success: true, workspaces: [], activeWorkspaceId: null } },
    },
    [stableStringify(['workspaces', 'list', null])]: {
      success: true,
      profiles: [],
      activeWorkspaceId: null,
      activeWorkspace: null,
    },
    [stableStringify(['workspaces', 'getActive', null])]: {
      success: true,
      activeWorkspaceId: null,
      activeWorkspace: null,
    },
    [stableStringify(['sessions', 'compactionStatus', {
      sessionKey: SESSION_KEY,
      agentId: 'main',
    }])]: {
      success: true,
      available: true,
      canCompact: false,
      inProgress: false,
      pressure: 'low',
      truncatedMessageCount: 0,
      warnings: [],
    },
    [stableStringify(['sessions', 'longTaskControlStatus', {
      sessionKey: SESSION_KEY,
      agentId: 'main',
    }])]: {
      success: true,
      available: false,
      key: SESSION_KEY,
      queueCount: 0,
      warnings: [],
    },
    [stableStringify(['usage', 'contextRange', {
      sessionKey: SESSION_KEY,
      modelRef: null,
      messageCount,
      usedTokens: null,
    }])]: {
      success: true,
      range: {
        sessionKey: SESSION_KEY,
        usedTokens: 0,
        maxTokens: 128000,
        truncatedMessageCount: 0,
        status: 'bestEffort',
      },
    },
    [stableStringify(['usage', 'live', {
      sessionKey: SESSION_KEY,
      runId: null,
      streaming: false,
    }])]: { success: true, usage: null },
  };
}

async function openChatWithHistory(
  launchElectronApp: LaunchElectronApp,
  history: unknown[],
) {
  const app = await launchElectronApp({ skipSetup: true });
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    gatewayRpc: {
      [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
        success: true,
        result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
      },
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages: history },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
        success: true,
        result: { messages: history },
      },
    },
    hostApi: baseHostApiMocks(history.length),
  });
  const page = await getStableWindow(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 30_000 });
  return { app, page };
}

test.describe('Verse Claw chat turn summary collapse', () => {
  test('keeps live activity compact, animated and readable without assistant avatars', async ({ launchElectronApp }, testInfo) => {
    const history = [
      { role: 'user', id: 'compact-user', content: 'Inspect the conversation and simplify the output.' },
      { role: 'assistant', id: 'compact-progress', content: 'I will check the conversation components and then verify the result.' },
    ];
    const { app, page } = await openChatWithHistory(launchElectronApp, history);
    try {
      const identity = { runId: 'compact-live-run', sessionKey: SESSION_KEY };
      await app.evaluate(({ BrowserWindow }, identity) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', { ...identity, type: 'run.started', startedAt: Date.now(), ts: Date.now() });
          win.webContents.send('chat:runtime-event', {
            ...identity, type: 'tool.started', toolCallId: 'compact-read', name: 'read_file', ts: Date.now(),
            args: { path: 'C:/workspace/conversation/components/assistant/Message.tsx', limit: 200 },
          });
        }
      }, identity);
      const toggle = page.getByTestId('chat-turn-summary-toggle');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByText(history[1].content, { exact: true })).toBeVisible();
      await expect(page.getByTestId('chat-assistant-avatar')).toHaveCount(0);
      await expect(page.getByTestId('assistant-stream-status')).toHaveCount(0);
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
      const activity = page.getByTestId('chat-turn-current-activity');
      await expect(activity.getByTestId('chat-call-chip')).toHaveAttribute('data-status', 'running');
      const progress = activity.getByTestId('chat-call-chip-progress');
      await expect.poll(() => progress.evaluate(element => getComputedStyle(element).transform)).not.toBe('matrix(0, 0, 0, 1, 0, 0)');
      for (const variant of [{ name: 'light', width: 1280 }, { name: 'dark', width: 1280 }, { name: 'narrow', width: 640 }]) {
        await page.setViewportSize({ width: variant.width, height: 900 });
        await page.evaluate(dark => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.classList.toggle('light', !dark);
        }, variant.name === 'dark');
        const summary = page.getByTestId('chat-turn-summary-card');
        expect(await summary.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`compact-output-${variant.name}.png`), animations: 'disabled' });
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(progress).toHaveCSS('transition-property', 'none');
      await toggle.press('Enter');
      await expect(page.getByTestId('chat-execution-graph')).toBeVisible();
      await expect(activity).toHaveCount(0);
      await expect(page.getByTestId('chat-call-chip')).toHaveCount(1);
      await toggle.press('Enter');
      await expect(activity).toBeVisible();
      await app.evaluate(({ BrowserWindow }, identity) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            ...identity, type: 'tool.completed', toolCallId: 'compact-read', name: 'read_file', ts: Date.now(), result: 'Read complete',
          });
        }
      }, identity);
      await expect(activity).toHaveCount(0);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('chat-turn-summary-orb')).toBeVisible();
      await expect(page.getByTestId('chat-assistant-avatar')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('collapses completed long task process and expands details on demand', async ({ launchElectronApp }, testInfo) => {
    const history = [
      { role: 'user', content: 'Inspect the repo and summarize the work.' },
      {
        role: 'assistant',
        id: 'tool-read',
        content: [
          { type: 'thinking', thinking: 'Inspect the conversation components before changing their visual hierarchy.' },
          { type: 'text', text: 'I will inspect the conversation components and check how tool details are presented.' },
          { type: 'tool_use', id: 'read-1', name: 'read_file', input: { path: '/workspace/src/components/conversation/execution/details/app.ts', limit: 200 } },
          { type: 'tool_use', id: 'plan-1', name: 'update_plan', input: { plan: [
            { step: 'Inspect components', status: 'completed' },
            { step: 'Verify rendering', status: 'completed' },
          ] } },
        ],
      },
      {
        role: 'assistant',
        id: 'tool-search',
        content: [
          { type: 'text', text: 'The output now shares one reading column. I am checking the remaining tool interactions.' },
          { type: 'tool_use', id: 'search-1', name: 'search', input: { pattern: 'TODO' } },
        ],
      },
      {
        role: 'assistant',
        id: 'tool-test',
        content: [{ type: 'tool_use', id: 'test-1', name: 'run_tests', input: { command: 'pnpm test' } }],
      },
      {
        role: 'assistant',
        id: 'final',
        content: [{ type: 'text', text: 'Repo inspection is complete.' }],
      },
    ];
    const { app, page } = await openChatWithHistory(launchElectronApp, history);

    try {
      await expect(page.getByTestId('chat-turn-summary-card')).toBeVisible();
      await expect(page.getByTestId('chat-turn-summary-orb')).toHaveCount(0);
      await expect(page.getByTestId('chat-message-4').getByText('Repo inspection is complete.')).toBeVisible();
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
      await expect(page.getByTestId('chat-turn-summary-badges')).toBeVisible();
      expect(await page.locator('[data-testid^="chat-turn-summary-badge-"]').count()).toBeLessThanOrEqual(2);
      await expect(page.getByTestId('chat-turn-summary-badge-thoughts')).toHaveCount(0);
      await page.setViewportSize({ width: 640, height: 1000 });
      const summary = page.getByTestId('chat-turn-summary-card');
      expect(await summary.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await summary.screenshot({ path: testInfo.outputPath('turn-summary-narrow.png') });

      await page.getByTestId('chat-turn-summary-toggle').focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('chat-turn-summary-details')).toBeVisible();
      await expect(page.getByTestId('chat-execution-graph')).toBeVisible();
      await expect(page.getByTestId('chat-execution-graph').getByText('Main Agent execution', { exact: true })).toHaveCount(0);
      const diagnostics = page.getByTestId('chat-coding-run-evidence');
      if (await diagnostics.count()) {
        await expect(diagnostics).not.toHaveAttribute('open');
        expect(await diagnostics.evaluate(element => element === element.parentElement?.lastElementChild)).toBe(true);
      }
      const readStep = page.getByTestId('chat-execution-step-toggle').filter({ hasText: 'read_file' });
      await expect(readStep).toContainText('/workspace/src/components/conversation/execution/details/app.ts');
      await expect(readStep).not.toContainText('"limit"');
      await readStep.click();
      await expect(page.getByRole('region', { name: 'read_file' })).toContainText('"limit": 200');
      await summary.screenshot({ path: testInfo.outputPath('turn-process-expanded.png') });
      await page.getByTestId('chat-turn-summary-toggle').click();
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
      await expect(page.getByTestId('chat-message-4').getByText('Repo inspection is complete.')).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: testInfo.outputPath('compact-output-completed.png'), animations: 'disabled' });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('leaves short conversations unwrapped', async ({ launchElectronApp }) => {
    const history = [
      { role: 'user', content: 'What is two plus two?' },
      { role: 'assistant', content: [{ type: 'text', text: 'Four.' }] },
    ];
    const { app, page } = await openChatWithHistory(launchElectronApp, history);

    try {
      await expect(page.getByText('Four.')).toBeVisible();
      await expect(page.getByTestId('chat-turn-summary-card')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
