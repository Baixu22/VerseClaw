import type { Page } from '@playwright/test';
import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

const approval = {
  id: 'approval-e2e',
  workspaceId: 'workspace-e2e',
  sessionKey: 'session-e2e',
  mode: 'readOnly',
  source: 'git',
  requestedAt: Date.parse('2026-07-31T10:00:00.000Z'),
  status: 'pending',
  risk: 'external-write',
  command: 'git push origin main',
  reason: 'Publish the reviewed branch',
};

const remoteTask = {
  id: 'remote-e2e',
  source: 'channel',
  status: 'pendingApproval',
  command: { kind: 'settingsPatch', patch: { theme: 'dark' } },
  reason: 'Apply the requested theme',
  createdAt: '2026-07-31T10:01:00.000Z',
  updatedAt: '2026-07-31T10:01:00.000Z',
  approvedAt: null,
  completedAt: null,
};

const browserTask = {
  id: 'browser-e2e',
  name: 'Check release notes',
  url: 'https://example.com/releases',
  objective: 'Verify the latest release heading',
  profile: 'work',
  mode: 'visible',
  allowedDomains: ['example.com'],
  permissionScope: ['navigate', 'read-page', 'interact-page'],
  steps: [{ id: 'step-1', action: 'click', selector: 'a.release', status: 'pending' }],
  successCriteria: { kind: 'selector-visible', value: 'h1' },
  approval: { status: 'pending', requestedAt: '2026-07-31T10:02:00.000Z' },
  counters: { totalSteps: 1, passedSteps: 0, failedSteps: 0 },
  status: 'waiting-approval',
  retryCount: 0,
  createdAt: '2026-07-31T10:02:00.000Z',
  updatedAt: '2026-07-31T10:02:00.000Z',
};

async function installDynamicInboxMocks(electronApp: Parameters<typeof installIpcMocks>[0]) {
  await installIpcMocks(electronApp, {
    gatewayStatus: { running: true, ready: true },
  });

  await electronApp.evaluate(async ({ ipcMain }, initial) => {
    type HostRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type InvokeHandler = (event: unknown, request: HostRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, InvokeHandler> })._invokeHandlers;
    const original = handlers?.get('host:invoke');
    const state = {
      permissionStatus: 'pending',
      remoteStatus: 'pendingApproval',
      browserPending: true,
    };
    (globalThis as unknown as { __inboxE2eState?: typeof state }).__inboxE2eState = state;

    const respond = (id: unknown, data: unknown) => ({
      id: typeof id === 'string' ? id : undefined,
      ok: true,
      data,
    });
    const record = (request: HostRequest) => {
      (globalThis as unknown as { __verseClawE2eHostCalls?: unknown[] }).__verseClawE2eHostCalls?.push({
        module: request.module,
        action: request.action,
        payload: request.payload ?? null,
      });
    };

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostRequest) => {
      const current = (globalThis as unknown as { __inboxE2eState: typeof state }).__inboxE2eState;
      if (request.module === 'permissions' && request.action === 'approvals') {
        record(request);
        return respond(request.id, {
          success: true,
          approvals: [{
            ...initial.approval,
            status: current.permissionStatus,
            ...(current.permissionStatus === 'pending' ? {} : { resolvedAt: Date.parse('2026-07-31T10:03:00.000Z') }),
          }],
        });
      }
      if (request.module === 'permissions' && request.action === 'decideApproval') {
        record(request);
        current.permissionStatus = request.payload?.decision === 'approved' ? 'approved' : 'denied';
        return respond(request.id, { success: true, approval: { ...initial.approval, status: current.permissionStatus } });
      }
      if (request.module === 'remoteTasks' && request.action === 'list') {
        record(request);
        return respond(request.id, {
          success: true,
          tasks: [{
            ...initial.remoteTask,
            status: current.remoteStatus,
            updatedAt: current.remoteStatus === 'pendingApproval' ? initial.remoteTask.updatedAt : '2026-07-31T10:04:00.000Z',
            ...(current.remoteStatus === 'completed' ? { resultSummary: 'theme', completedAt: '2026-07-31T10:04:00.000Z' } : {}),
          }],
          generatedAt: '2026-07-31T10:04:00.000Z',
        });
      }
      if (request.module === 'remoteTasks' && request.action === 'preview') {
        record(request);
        return respond(request.id, {
          success: true,
          requiresApproval: true,
          changes: [{ key: 'theme', before: 'system', after: 'dark' }],
        });
      }
      if (request.module === 'remoteTasks' && request.action === 'approve') {
        record(request);
        current.remoteStatus = 'pending';
        return respond(request.id, { success: true, task: { ...initial.remoteTask, status: 'pending' } });
      }
      if (request.module === 'remoteTasks' && request.action === 'execute') {
        record(request);
        current.remoteStatus = 'completed';
        return respond(request.id, { success: true, task: { ...initial.remoteTask, status: 'completed', resultSummary: 'theme' } });
      }
      if (request.module === 'agentBrowser' && request.action === 'tasks') {
        record(request);
        return respond(request.id, { success: true, tasks: current.browserPending ? [initial.browserTask] : [] });
      }
      if (request.module === 'agentBrowser' && request.action === 'approveTask') {
        record(request);
        current.browserPending = false;
        return respond(request.id, { success: true, task: { ...initial.browserTask, status: 'completed' } });
      }
      return original?.(event, request) ?? respond(request.id, {});
    });
  }, { approval, remoteTask, browserTask });
}

async function dismissToasts(page: Page) {
  await page.addStyleTag({
    content: '[data-sonner-toaster], [data-sonner-toast] { display: none !important; }',
  });
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0);
}

test.describe('FakeCoding Inbox navigation', () => {
  test('keeps four top-level entries and redirects the legacy Remote Tasks route', async ({ electronApp, page }) => {
    await installDynamicInboxMocks(electronApp);
    await completeSetup(page);

    const primaryNav = page.locator('[data-testid="sidebar"] nav.primary-nav');
    await expect(primaryNav.locator(':scope > button')).toHaveCount(1);
    await expect(primaryNav.locator(':scope > a')).toHaveCount(3);
    await expect(page.getByTestId('sidebar-new-chat')).toContainText('New task');
    await expect(page.getByTestId('sidebar-nav-inbox')).toContainText('Inbox');
    await expect(page.getByTestId('sidebar-nav-cron')).toContainText('Scheduled');
    await expect(page.getByTestId('sidebar-nav-knowledge')).toContainText('Knowledge');
    await expect(page.getByTestId('sidebar-nav-browser')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-nav-code-review')).toHaveCount(0);
    await page.getByTestId('sidebar-footer-menu-trigger').click();
    await expect(page.getByTestId('sidebar-more-browser')).toBeVisible();
    await expect(page.getByTestId('sidebar-more-code-review')).toBeVisible();
    await expect(page.getByTestId('sidebar-more-task-ledger')).toBeVisible();
    await expect(page.getByTestId('sidebar-more-clawgraph')).toBeVisible();
    await page.getByTestId('sidebar-footer-menu-trigger').click();

    await page.evaluate(() => { window.location.hash = '#/remote-tasks'; });
    await expect(page.getByTestId('inbox-page')).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/inbox?source=remote-task');
    await expect(page.getByTestId('inbox-source-filter')).toContainText('Remote Tasks');
  });

  test('aggregates all sources, runs real decisions, and refreshes the pending count', async ({ electronApp, page }, testInfo) => {
    await installDynamicInboxMocks(electronApp);
    await completeSetup(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('sidebar-nav-inbox').click();

    await expect(page.getByTestId('inbox-page')).toBeVisible();
    await expect(page.getByTestId('sidebar-nav-inbox-badge')).toHaveText('3');
    await expect(page.getByTestId('inbox-item-permission:approval-e2e')).toBeVisible();
    await expect(page.getByTestId('inbox-item-remote-task:remote-e2e')).toBeVisible();
    await expect(page.getByTestId('inbox-item-browser-task:browser-e2e')).toBeVisible();
    await dismissToasts(page);

    const lightDesktop = testInfo.outputPath('inbox-1280-light.png');
    await page.screenshot({ path: lightDesktop });
    await testInfo.attach('Inbox 1280 light', { path: lightDesktop, contentType: 'image/png' });
    await page.setViewportSize({ width: 960, height: 800 });
    const lightNarrow = testInfo.outputPath('inbox-960-light.png');
    await page.screenshot({ path: lightNarrow });
    await testInfo.attach('Inbox 960 light', { path: lightNarrow, contentType: 'image/png' });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('sidebar-nav-settings').click();
    const themeMode = page.getByTestId('settings-theme-mode');
    await themeMode.getByRole('button', { name: 'Dark' }).click();
    await page.getByTestId('settings-back-button').click();
    await expect(page.getByTestId('inbox-page')).toBeVisible();
    const darkDesktop = testInfo.outputPath('inbox-1280-dark.png');
    await page.screenshot({ path: darkDesktop });
    await testInfo.attach('Inbox 1280 dark', { path: darkDesktop, contentType: 'image/png' });

    await page.getByTestId('inbox-item-permission:approval-e2e').click();
    await expect(page.getByTestId('inbox-detail')).toContainText('External write requires approval');
    await expect(page.getByTestId('inbox-detail')).toContainText('Details withheld');
    await expect(page.getByTestId('inbox-detail')).toContainText('cannot be automatically rolled back');
    await expect(page.getByTestId('inbox-detail')).not.toContainText('git push origin main');
    await page.getByTestId('inbox-action-approve').click();
    await expect(page.getByTestId('sidebar-nav-inbox-badge')).toHaveText('2');

    await page.getByTestId('inbox-item-remote-task:remote-e2e').click();
    await expect(page.getByTestId('inbox-detail')).toContainText('system');
    await page.getByTestId('inbox-action-approve').click();
    await expect(page.getByTestId('inbox-action-execute')).toBeVisible();
    await page.getByTestId('inbox-action-execute').click();
    await expect(page.getByTestId('sidebar-nav-inbox-badge')).toHaveText('1');

    await page.getByTestId('inbox-item-browser-task:browser-e2e').click();
    await expect(page.getByTestId('inbox-detail')).toContainText('example.com');
    await page.getByTestId('inbox-action-approve-and-run').click();
    await expect(page.getByTestId('sidebar-nav-inbox-badge')).toHaveCount(0);

    await page.getByTestId('inbox-view-history').click();
    await expect(page.getByTestId('inbox-item-permission:approval-e2e')).toBeVisible();
    await expect(page.getByTestId('inbox-item-remote-task:remote-e2e')).toBeVisible();

    await page.setViewportSize({ width: 960, height: 800 });
    await page.getByTestId('inbox-item-remote-task:remote-e2e').click();
    await expect(page.getByTestId('inbox-detail-back')).toBeVisible();
    await expect(page.getByTestId('inbox-list')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await dismissToasts(page);
    const darkNarrow = testInfo.outputPath('inbox-960-dark.png');
    await page.screenshot({ path: darkNarrow });
    await testInfo.attach('Inbox 960 dark', { path: darkNarrow, contentType: 'image/png' });

    const calls = await electronApp.evaluate(() => (
      (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string }> }).__verseClawE2eHostCalls ?? []
    ));
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: 'permissions', action: 'decideApproval' }),
      expect.objectContaining({ module: 'remoteTasks', action: 'approve' }),
      expect.objectContaining({ module: 'remoteTasks', action: 'execute' }),
      expect.objectContaining({ module: 'agentBrowser', action: 'approveTask' }),
    ]));
  });
});
