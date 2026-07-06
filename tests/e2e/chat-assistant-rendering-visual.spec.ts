import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const CLOUD_ARTIFACT_PATH = '/opt/cursor/artifacts/chat_assistant_rendering_visual.png';

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

const fixedTimestamp = 1_772_000_000_000;

const seededHistory = [
  {
    id: 'assistant-rendering-rich',
    role: 'assistant',
    content: [{
      type: 'text',
      text: [
        '### Assistant rendering branch A',
        '',
        'This reply has selectable branches, structured markdown, and a quote target for the toolbar.',
        '',
        '- Markdown stays rich and readable.',
        '- Attachment cards stay separate from raw paths.',
        '',
        toolUiBlock({
          type: 'plan',
          id: 'assistant-render-plan',
          title: 'Render rollout',
          todos: [
            { id: 'model', label: 'Build local model', status: 'completed' },
            { id: 'verify', label: 'Verify cards', status: 'in_progress' },
          ],
        }),
      ].join('\n'),
      assistantRender: {
        branches: [
          {
            id: 'branch-a',
            label: 'A',
            text: '### Assistant rendering branch A\n\nThis reply has selectable branches, structured markdown, and a quote target for the toolbar.',
          },
          {
            id: 'branch-b',
            label: 'B',
            text: '### Assistant rendering branch B\n\nAlternative branch content is active after selecting next.',
          },
        ],
        reasoning: [
          {
            id: 'reasoning-public',
            title: 'Public execution summary',
            summary: 'Mapped runtime metadata into visible cards without exposing hidden chain-of-thought.',
          },
        ],
        toolFallbacks: [
          {
            id: 'tool-unknown-1',
            name: 'very_long_unknown_tool_name_for_rendering_validation',
            status: 'error',
            summary: 'Tool payload did not match a registered Tool UI card, so fallback rendering is used.',
            durationMs: 1250,
          },
        ],
      },
    }],
    _attachedFiles: [
      {
        fileName: 'assistant-rendering-output-with-a-long-name.md',
        mimeType: 'text/markdown',
        fileSize: 4096,
        preview: null,
        filePath: 'C:\\tmp\\assistant-rendering-output.md',
        source: 'tool-result',
      },
    ],
    timestamp: fixedTimestamp,
  },
];

const workspaceSnapshot = {
  profiles: [
    {
      id: 'workspace-e2e',
      name: 'Renderer Workspace',
      rootPath: 'C:\\tmp\\renderer-workspace',
      agentId: 'main',
      selectedAgentId: 'main',
      activeSessionKey: SESSION_KEY,
      permissionMode: 'acceptEdits',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
      lastOpenedAt: fixedTimestamp,
      state: {},
      sessionStates: {},
    },
  ],
  activeWorkspaceId: 'workspace-e2e',
  activeWorkspace: {
    id: 'workspace-e2e',
    name: 'Renderer Workspace',
    rootPath: 'C:\\tmp\\renderer-workspace',
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: SESSION_KEY,
    permissionMode: 'acceptEdits',
    createdAt: fixedTimestamp,
    updatedAt: fixedTimestamp,
    lastOpenedAt: fixedTimestamp,
    state: {},
    sessionStates: {},
  },
};

const liveUsage = {
  success: true,
  usage: {
    sessionKey: SESSION_KEY,
    runId: null,
    inputTokens: 1200,
    outputTokens: 345,
    cacheReadTokens: 80,
    cacheWriteTokens: 20,
    totalTokens: 1645,
    estimatedCostUsd: 0.0123,
    updatedAt: fixedTimestamp,
    status: 'final',
  },
};

const contextRange = {
  success: true,
  range: {
    sessionKey: SESSION_KEY,
    modelRef: null,
    maxTokens: 8000,
    usedTokens: 1645,
    visibleMessageStartIndex: 0,
    visibleMessageEndIndex: 0,
    retainedMessageCount: 1,
    truncatedMessageCount: 0,
    summarizedMessageCount: 0,
    status: 'bestEffort',
  },
};

const usageHistory = [
  {
    timestamp: new Date(fixedTimestamp).toISOString(),
    sessionId: 'assistant-rendering-session',
    agentId: 'main',
    model: 'e2e-model',
    provider: 'e2e',
    usageStatus: 'available',
    inputTokens: 1200,
    outputTokens: 345,
    cacheReadTokens: 80,
    cacheWriteTokens: 20,
    totalTokens: 1645,
    costUsd: 0.0123,
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
    `,
  });
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
}

async function installAssistantRenderingMocks(app: Parameters<typeof installIpcMocks>[0]) {
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
      [stableStringify(['workspaces', 'list', null])]: workspaceSnapshot,
      [stableStringify(['workspaces', 'getActive', null])]: workspaceSnapshot,
      [stableStringify(['workspaces', 'saveState', { id: 'workspace-e2e', sessionKey: SESSION_KEY, state: {} }])]: { success: true },
      [stableStringify(['usage', 'live', { sessionKey: SESSION_KEY, runId: null, streaming: false }])]: liveUsage,
      [stableStringify(['usage', 'contextRange', { sessionKey: SESSION_KEY, modelRef: null, messageCount: 1, usedTokens: null }])]: contextRange,
      [stableStringify(['usage', 'contextRange', { sessionKey: SESSION_KEY, modelRef: null, messageCount: 1, usedTokens: 1645 }])]: contextRange,
      [stableStringify(['usage', 'recentTokenHistory', { limit: 500 }])]: usageHistory,
    },
  });
}

test.describe('Verse Claw assistant-style rendering layer', () => {
  test('renders rich assistant cards and validates branch, quote, token, and heatgraph interactions', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAssistantRenderingMocks(app);
      const page = await getStableWindow(app);
      await openSeededChat(page);

      await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
        localStorage.removeItem('assistant-branch:assistant-rendering-rich');
      });

      const scrollContainer = page.getByTestId('chat-scroll-container');
      await expect(scrollContainer).toBeVisible();
      await expect(page.getByTestId('assistant-branch-picker')).toContainText('1 / 2');
      await expect(page.getByTestId('assistant-reasoning-panel')).toBeVisible();
      await expect(page.getByTestId('assistant-tool-fallback')).toContainText('very_long_unknown_tool_name');
      await expect(page.getByTestId('assistant-attachment-card')).toContainText('assistant-rendering-output');
      await expect(page.getByTestId('assistant-token-usage-roll')).toHaveCount(0);
      await expect(page.getByTestId('assistant-status-dot-matrix')).toHaveCount(0);

      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(scrollContainer).toHaveScreenshot('assistant-render-chat-desktop-light.png', {
        animations: 'disabled',
        caret: 'hide',
      });
      await page.evaluate(() => {
        document.documentElement.classList.remove('light');
        document.documentElement.classList.add('dark');
      });
      await expect(scrollContainer).toHaveScreenshot('assistant-render-chat-desktop-dark.png', {
        animations: 'disabled',
        caret: 'hide',
      });
      await page.setViewportSize({ width: 800, height: 844 });
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      });
      await expect(scrollContainer).toBeVisible();
      await expect(scrollContainer).toHaveScreenshot('assistant-render-chat-narrow-light.png', {
        animations: 'disabled',
        caret: 'hide',
      });
      await page.setViewportSize({ width: 1280, height: 900 });

      await page.getByRole('button', { name: 'Next branch' }).click();
      await expect(page.getByTestId('assistant-branch-picker')).toContainText('2 / 2');
      await expect(page.locator('.prose').filter({ hasText: 'Alternative branch content is active' })).toBeVisible();

      await page.reload();
      await expect(page.getByTestId('assistant-branch-picker')).toContainText('2 / 2');
      await expect(page.locator('.prose').filter({ hasText: 'Alternative branch content is active' })).toBeVisible();

      await page.getByRole('button', { name: 'Previous branch' }).click();
      await expect(page.getByTestId('assistant-branch-picker')).toContainText('1 / 2');
      await page.getByTestId('assistant-reasoning-panel').getByRole('button').click();
      await expect(page.getByText('Mapped runtime metadata into visible cards')).toBeVisible();

      await page.evaluate(() => {
        const target = Array.from(document.querySelectorAll('.prose p'))
          .find((node) => node.textContent?.includes('quote target for the toolbar'));
        if (!target || !target.firstChild) throw new Error('Quote target paragraph not found');
        const range = document.createRange();
        range.setStart(target.firstChild, 0);
        range.setEnd(target.firstChild, Math.min(48, target.firstChild.textContent?.length ?? 0));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await expect(page.getByTestId('assistant-selection-quote-toolbar')).toBeVisible();
      await page.getByTestId('assistant-selection-quote-toolbar').getByRole('button', { name: 'Quote' }).click();
      await expect(page.getByTestId('chat-composer-input')).toContainText('This reply has selectable branches');

      const screenshotPath = testInfo.outputPath('chat_assistant_rendering_visual.png');
      await scrollContainer.screenshot({ path: screenshotPath });
      await testInfo.attach('chat_assistant_rendering_visual', {
        path: screenshotPath,
        contentType: 'image/png',
      });
      try {
        mkdirSync(dirname(CLOUD_ARTIFACT_PATH), { recursive: true });
        copyFileSync(screenshotPath, CLOUD_ARTIFACT_PATH);
      } catch {
        // Optional artifact mirror for hosted runners.
      }

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-overview')).toBeVisible();
      await expect(page.getByTestId('settings-work-heatgraph')).not.toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
