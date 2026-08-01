import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import type { Page, TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SESSION_KEY = 'agent:main:main';
const SECOND_SESSION_KEY = 'agent:main:follow-up';
const WORKSPACE_ID = 'workspace-layout-cdp';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function buildWorkspace() {
  return {
    id: WORKSPACE_ID,
    name: 'Layout Workspace',
    rootPath: 'C:/workspace-layout-cdp',
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: SESSION_KEY,
    agentBindings: {
      main: {
        workspaceId: WORKSPACE_ID,
        agentId: 'main',
        sessionKey: SESSION_KEY,
      },
    },
    permissionMode: 'acceptEdits' as const,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
    sessionStates: {
      [SESSION_KEY]: {},
      [SECOND_SESSION_KEY]: {},
    },
  };
}

function chatLayoutMocks() {
  const workspace = buildWorkspace();
  const sessions = [
    { key: SESSION_KEY, displayName: 'main', label: 'Main conversation', updatedAt: Date.now() },
    { key: SECOND_SESSION_KEY, displayName: 'follow-up', label: 'Follow up notes', updatedAt: Date.now() - 60_000 },
  ];
  const contextRange = {
    success: true,
    range: {
      sessionKey: SESSION_KEY,
      usedTokens: 0,
      maxTokens: 128000,
      truncatedMessageCount: 0,
      status: 'bestEffort',
    },
  };

  return {
    gatewayStatus: {
      state: 'running',
      port: 18789,
      pid: 12345,
      gatewayReady: true,
    },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: { success: true, result: { sessions } },
      [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
        success: true,
        result: { sessions },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: {
          messages: [
            { id: 'user-1', role: 'user', content: 'Please check the layout alignment.', timestamp: 1 },
            { id: 'assistant-1', role: 'assistant', content: 'The chat body should stay centered and usable.', timestamp: 2 },
          ],
        },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
        success: true,
        result: { messages: [] },
      },
    },
    hostApi: {
      [stableStringify(['agents', 'list', null])]: { success: true, agents: [{ id: 'main', name: 'Main' }] },
      [stableStringify(['workspaces', 'getActive', null])]: {
        success: true,
        activeWorkspaceId: WORKSPACE_ID,
        activeWorkspace: workspace,
      },
      [stableStringify(['workspaces', 'list', null])]: {
        profiles: [workspace],
        activeWorkspaceId: WORKSPACE_ID,
        activeWorkspace: workspace,
      },
      [stableStringify(['usage', 'contextRange', {
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 2,
        usedTokens: null,
      }])]: contextRange,
      [stableStringify(['usage', 'contextRange', {
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 2,
        usedTokens: 0,
      }])]: contextRange,
      [stableStringify(['taskLedger', 'snapshot', { workspaceId: WORKSPACE_ID }])]: {
        snapshot: {
          workspaceId: WORKSPACE_ID,
          nodes: [],
          edges: [],
          eventsCount: 0,
          activeNodeIds: [],
          blockedNodeIds: [],
          reviewNodeIds: [],
          recentDecisions: [],
        },
      },
    },
  };
}

async function captureLayoutScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const testPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: testPath, fullPage: false });
  await testInfo.attach(name, { path: testPath, contentType: 'image/png' });

  const screenshotDir = process.env.CLAWX_LAYOUT_SCREENSHOT_DIR;
  if (screenshotDir) {
    const resolvedDir = join(process.cwd(), screenshotDir);
    await mkdir(resolvedDir, { recursive: true });
    await page.screenshot({ path: join(resolvedDir, `${name}.png`), fullPage: false });
  }
}

test.describe('Chat page layout CDP checks', () => {
  test('keeps chat content, session search modal, and window controls aligned', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, chatLayoutMocks());
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1600, height: 800 });
      const url = new URL(page.url());
      url.searchParams.set('e2eSkipSetup', '1');
      await page.goto(url.toString());

      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      const composerShell = page.getByTestId('chat-composer-shell');
      await expect(composerShell).toBeVisible();
      await expect(page.getByTestId('chat-composer-context-strip')).toHaveCount(0);
      const composerMetrics = await composerShell.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          borderRadius: style.borderRadius,
          minHeight: style.minHeight,
          width: rect.width,
        };
      });
      expect(composerMetrics.borderRadius).toBe('25px');
      expect(composerMetrics.minHeight).toBe('98px');
      expect(composerMetrics.width).toBeLessThanOrEqual(736);
      await expect(page.getByTestId('chat-composer-actions')).not.toHaveAttribute('title');
      await page.getByTestId('chat-composer-actions').hover();
      const composerTooltip = page.locator('[data-radix-popper-content-wrapper] > [data-side]').filter({ hasText: '@' }).last();
      await expect(composerTooltip).toBeVisible();
      await expect(composerTooltip).toHaveCSS('border-radius', '12.5px');
      await expect(composerTooltip).toContainText('@');
      await expect(page.getByTestId('chat-composer-context-menu-trigger')).toHaveCount(0);
      const permissionTrigger = page.getByTestId('chat-composer-permission-mode');
      await expect(permissionTrigger).toBeVisible();
      const composerControlAlignment = await composerShell.evaluate((shell) => {
        const actions = shell.querySelector('[data-testid="chat-composer-actions"]');
        const permission = shell.querySelector('[data-testid="chat-composer-permission-mode"]');
        if (!actions || !permission) throw new Error('Missing composer controls');
        const actionsRect = actions.getBoundingClientRect();
        const permissionRect = permission.getBoundingClientRect();
        return {
          actionsCenterY: actionsRect.top + actionsRect.height / 2,
          permissionCenterY: permissionRect.top + permissionRect.height / 2,
        };
      });
      expect(Math.abs(composerControlAlignment.actionsCenterY - composerControlAlignment.permissionCenterY)).toBeLessThanOrEqual(1);
      await expect(page.getByTestId('chat-composer-skill')).toHaveCount(0);
      await expect(page.getByTestId('chat-knowledge-quick-toggle')).toHaveCount(0);
      await expect(page.getByTestId('chat-knowledge-scope-button')).toBeVisible();
      await page.getByTestId('chat-composer-actions').click();
      const actionMenu = page.getByTestId('chat-composer-actions-menu');
      await expect(actionMenu).toBeVisible();
      const actionMenuMetrics = await actionMenu.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const shell = element.closest('[data-testid="chat-composer-shell"]');
        const shellRect = shell?.getBoundingClientRect();
        return {
          borderRadius: style.borderRadius,
          backdropFilter: style.backdropFilter,
          maxHeight: style.maxHeight,
          width: rect.width,
          shellWidth: shellRect?.width ?? 0,
        };
      });
      expect(actionMenuMetrics.borderRadius).toBe('20px');
      expect(actionMenuMetrics.backdropFilter).toContain('blur(8px)');
      expect(actionMenuMetrics.maxHeight).toBe('320px');
      expect(Math.abs(actionMenuMetrics.width - actionMenuMetrics.shellWidth)).toBeLessThanOrEqual(1);
      const attachAction = page.getByTestId('chat-composer-action-attach-files');
      await expect(attachAction).toHaveCSS('border-radius', '12.5px');
      await expect(attachAction.locator('svg')).toHaveCSS('width', '16px');
      await captureLayoutScreenshot(page, testInfo, 'chat-layout-add-menu');
      await page.getByTestId('chat-composer-input').click();
      await expect(actionMenu).not.toBeVisible();
      await expect(page.getByTestId('chat-composer-permission-menu')).not.toBeVisible();
      await expect(page.getByTestId('sidebar-session-search')).toBeVisible({ timeout: 30_000 });
      await captureLayoutScreenshot(page, testInfo, 'chat-layout-before-search');
      await page.getByTestId('chat-composer-permission-mode').click();
      await expect(page.getByTestId('chat-composer-permission-menu')).toBeVisible();
      const permissionOption = page.getByTestId('chat-composer-permission-option-acceptEdits');
      await expect(permissionOption).toBeVisible();
      const dropdownMetrics = await page.getByTestId('chat-composer-permission-menu').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          borderRadius: style.borderRadius,
          backdropFilter: style.backdropFilter,
        };
      });
      expect(dropdownMetrics.borderRadius).toBe('15px');
      expect(dropdownMetrics.backdropFilter).toContain('blur(8px)');
      await expect(permissionOption).toHaveCSS('min-height', '47px');
      await expect(permissionOption).toHaveCSS('border-radius', '12.5px');
      await expect(permissionOption.locator('svg')).toHaveCount(2);
      await expect(permissionOption).toContainText(/risk|风险/);
      await captureLayoutScreenshot(page, testInfo, 'chat-layout-permission-menu');
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await expect(composerShell).toHaveCSS('background-color', 'rgba(45, 45, 45, 0.9)');
      await captureLayoutScreenshot(page, testInfo, 'chat-layout-permission-menu-dark');
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      await page.getByTestId('chat-composer-input').fill('/');
      await expect(page.getByTestId('chat-slash-command-menu')).toBeVisible();
      await captureLayoutScreenshot(page, testInfo, 'chat-layout-slash-menu');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('chat-question-directory')).toHaveCount(0);
      await expect(page.getByTestId('chat-assistive-rail')).toHaveCount(0);

      const platform = await page.getByTestId('main-layout').getAttribute('data-platform');
      if (platform === 'win32') {
        const titlebar = page.getByTestId('windows-titlebar');
        await expect(titlebar).toBeVisible();
        await expect(titlebar.getByTitle('Minimize')).toBeVisible();
        await expect(titlebar.getByTitle(/Maximize|Restore/)).toBeVisible();
        await expect(titlebar.getByTitle('Close')).toBeVisible();
      }

      await page.locator('.section-heading').first().hover();
      await page.getByTestId('sidebar-session-search').click();
      const modal = page.getByTestId('session-search-modal');
      await expect(modal).toBeVisible();
      await expect(page.getByTestId('session-search-result-0')).toBeVisible();

      await captureLayoutScreenshot(page, testInfo, 'chat-layout-session-search-modal');

      const metrics = await page.evaluate(() => {
        const modalEl = document.querySelector('[data-testid="session-search-modal"]') as HTMLElement | null;
        const chatEl = document.querySelector('[data-testid="chat-page"]') as HTMLElement | null;
        const messageLayoutEl = document.querySelector('[data-testid="chat-message-layout"]') as HTMLElement | null;
        const scrollEl = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
        const mainEl = document.querySelector('[data-testid="main-content"]') as HTMLElement | null;
        const titlebarEl = document.querySelector('[data-testid="windows-titlebar"]') as HTMLElement | null;
        if (!modalEl || !chatEl || !messageLayoutEl || !scrollEl || !mainEl) throw new Error('Missing layout elements');
        const modalRect = modalEl.getBoundingClientRect();
        const chatRect = chatEl.getBoundingClientRect();
        const messageLayoutRect = messageLayoutEl.getBoundingClientRect();
        const scrollRect = scrollEl.getBoundingClientRect();
        const mainRect = mainEl.getBoundingClientRect();
        const titlebarRect = titlebarEl?.getBoundingClientRect() ?? null;
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          modal: {
            left: modalRect.left,
            top: modalRect.top,
            width: modalRect.width,
            height: modalRect.height,
            centerX: modalRect.left + modalRect.width / 2,
            centerY: modalRect.top + modalRect.height / 2,
          },
          chat: {
            left: chatRect.left,
            top: chatRect.top,
            width: chatRect.width,
            height: chatRect.height,
          },
          messageLayout: {
            left: messageLayoutRect.left,
            width: messageLayoutRect.width,
            centerX: messageLayoutRect.left + messageLayoutRect.width / 2,
          },
          scroll: {
            left: scrollRect.left,
            width: scrollRect.width,
            centerX: scrollRect.left + scrollRect.width / 2,
          },
          main: {
            left: mainRect.left,
            top: mainRect.top,
            width: mainRect.width,
            height: mainRect.height,
          },
          titlebar: titlebarRect && {
            left: titlebarRect.left,
            top: titlebarRect.top,
            width: titlebarRect.width,
            height: titlebarRect.height,
          },
        };
      });

      testInfo.attach('layout-metrics', {
        body: JSON.stringify(metrics, null, 2),
        contentType: 'application/json',
      });

      expect(Math.abs(metrics.modal.centerX - metrics.viewport.width / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(metrics.modal.centerY - metrics.viewport.height / 2)).toBeLessThanOrEqual(2);
      expect(metrics.modal.left).toBeGreaterThanOrEqual(16);
      expect(metrics.modal.left + metrics.modal.width).toBeLessThanOrEqual(metrics.viewport.width - 16);
      expect(Math.abs(metrics.chat.top - metrics.main.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.chat.height - metrics.main.height)).toBeLessThanOrEqual(1);
      expect(metrics.messageLayout.width).toBeLessThanOrEqual(1030);
      expect(Math.abs(metrics.messageLayout.centerX - (metrics.chat.left + metrics.chat.width / 2))).toBeLessThanOrEqual(2);
      expect(Math.abs(metrics.scroll.centerX - metrics.messageLayout.centerX)).toBeLessThanOrEqual(2);
      if (platform === 'win32') {
        expect(metrics.titlebar?.height).toBe(34);
        expect(metrics.titlebar?.top).toBe(0);
      }
    } finally {
      await closeElectronApp(app);
    }
  });
});
