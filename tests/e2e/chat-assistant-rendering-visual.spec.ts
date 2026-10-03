import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

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
        reasoning: [
          {
            id: 'reasoning-public',
            title: 'Public execution summary',
            summary: 'Mapped runtime metadata into visible cards without exposing hidden chain-of-thought.',
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
  test('renders rich assistant cards and validates quote, token, and heatgraph interactions', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAssistantRenderingMocks(app);
      const page = await getStableWindow(app);
      await openSeededChat(page);

      await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      });

      const scrollContainer = page.getByTestId('chat-scroll-container');
      await expect(scrollContainer).toBeVisible();
      await expect(page.getByTestId('assistant-reasoning-panel')).toBeVisible();
      await expect(page.getByTestId('assistant-attachment-card')).toContainText('assistant-rendering-output');
      await expect(page.getByTestId('assistant-token-usage-roll')).toHaveCount(0);
      await expect(page.getByTestId('assistant-status-dot-matrix')).toHaveCount(0);

      // Screenshot widths must come from the real window: Electron clamps
      // `page.setViewportSize()` to the BrowserWindow, which is why these
      // baselines drifted (they were committed at a ~960px window while the app
      // default is 1280px). Pin the content size first, then wait for the
      // renderer to actually re-lay-out — the sidebar density effect and the
      // chat re-wrap land after the resize, and capturing in between freezes a
      // half-relaid frame into the baseline. 800x844 is below the app's
      // `minWidth: 960`, so it clamps to the minimum-window state.
      const pinCapture = async (width: number, height: number) => {
        await pinWindowContentSize(app, { width, height });
        await page.setViewportSize({ width, height });
        let previous = '';
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const current = await page.evaluate(() => {
            const container = document.querySelector<HTMLElement>('[data-testid="chat-scroll-container"]');
            const rect = container?.getBoundingClientRect();
            return `${window.innerWidth}x${window.innerHeight}|${Math.round(rect?.width ?? 0)}x${Math.round(rect?.height ?? 0)}`;
          });
          if (current === previous) return current;
          previous = current;
          await page.waitForTimeout(100);
        }
        throw new Error(`chat layout never settled at ${width}x${height}`);
      };

      await pinCapture(1280, 900);
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
      await pinCapture(800, 844);
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      });
      await expect(scrollContainer).toBeVisible();
      await expect(scrollContainer).toHaveScreenshot('assistant-render-chat-narrow-light.png', {
        animations: 'disabled',
        caret: 'hide',
      });
      await pinCapture(1280, 900);

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
      await expect(page.getByTestId('settings-sidebar')).toBeVisible();
      await expect(page.getByTestId('settings-work-heatgraph')).not.toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
