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
  test('collapses completed long task process and expands details on demand', async ({ launchElectronApp }) => {
    const history = [
      { role: 'user', content: 'Inspect the repo and summarize the work.' },
      {
        role: 'assistant',
        id: 'tool-read',
        content: [{ type: 'tool_use', id: 'read-1', name: 'read_file', input: { path: '/workspace/src/app.ts' } }],
      },
      {
        role: 'assistant',
        id: 'tool-search',
        content: [{ type: 'tool_use', id: 'search-1', name: 'search', input: { pattern: 'TODO' } }],
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

      await page.getByTestId('chat-turn-summary-toggle').click();
      await expect(page.getByTestId('chat-turn-summary-details')).toBeVisible();
      await expect(page.getByTestId('chat-execution-graph')).toBeVisible();
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
