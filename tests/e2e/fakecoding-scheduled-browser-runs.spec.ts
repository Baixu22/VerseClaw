import type { Page } from '@playwright/test';
import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}

const cronJob = {
  id: 'cron-e2e',
  name: 'Daily release summary',
  message: 'Summarize the latest release notes',
  schedule: { kind: 'cron', expr: '0 9 * * *' },
  source: 'gateway',
  runtime: { source: 'gateway', sessionTarget: 'isolated', wakeMode: 'next-heartbeat', payloadKind: 'agentTurn' },
  delivery: { mode: 'none' },
  enabled: true,
  createdAt: '2026-07-31T08:00:00.000Z',
  updatedAt: '2026-07-31T08:00:00.000Z',
  nextRun: '2026-08-01T09:00:00.000Z',
  agentId: 'main',
};

const baseBrowserTask = {
  url: 'https://example.com/releases',
  objective: 'Verify the latest release heading',
  profile: 'work',
  mode: 'visible',
  allowedDomains: ['example.com'],
  permissionScope: ['navigate', 'read-page'],
  successCriteria: { kind: 'selector-visible', value: 'h1' },
  retryCount: 0,
  createdAt: '2026-07-31T10:00:00.000Z',
  updatedAt: '2026-07-31T10:00:00.000Z',
};

const browserTasks = [{
  ...baseBrowserTask,
  id: 'browser-waiting',
  name: 'Approve release check',
  steps: [{ id: 'step-1', action: 'wait-for-selector', selector: 'h1', status: 'pending' }],
  approval: { status: 'pending', requestedAt: '2026-07-31T10:00:00.000Z' },
  counters: { totalSteps: 1, passedSteps: 0, failedSteps: 0 },
  status: 'waiting-approval',
}, {
  ...baseBrowserTask,
  id: 'browser-failed',
  name: 'Retry failed check',
  steps: [{ id: 'step-1', action: 'wait-for-selector', selector: 'h1', status: 'failed', errorCode: 'STEP_FAILED', error: 'Heading not found' }],
  approval: { status: 'consumed', requestedAt: '2026-07-31T09:00:00.000Z', consumedAt: '2026-07-31T09:01:00.000Z' },
  counters: { totalSteps: 1, passedSteps: 0, failedSteps: 1 },
  status: 'failed',
  errorCode: 'STEP_FAILED',
  error: 'Heading not found',
}, {
  ...baseBrowserTask,
  id: 'browser-running',
  name: 'Running release check',
  steps: [{ id: 'step-1', action: 'wait-for-selector', selector: 'h1', status: 'running' }],
  approval: { status: 'consumed', requestedAt: '2026-07-31T10:05:00.000Z', consumedAt: '2026-07-31T10:06:00.000Z' },
  counters: { totalSteps: 1, passedSteps: 0, failedSteps: 0 },
  status: 'running',
}];

async function installScheduledMocks(electronApp: Parameters<typeof installIpcMocks>[0]) {
  await installIpcMocks(electronApp, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    gatewayRpc: {},
    hostApi: {
      [stableStringify(['/api/gateway/status', 'GET'])]: {
        ok: true,
        data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true } },
      },
      [stableStringify(['/api/cron/jobs', 'GET'])]: {
        ok: true,
        data: { status: 200, ok: true, json: [cronJob] },
      },
      [stableStringify(['/api/channels/accounts', 'GET'])]: {
        ok: true,
        data: { status: 200, ok: true, json: { success: true, channels: [] } },
      },
    },
  });

  await electronApp.evaluate(async ({ ipcMain }, initial) => {
    type HostRequest = { id?: string; module?: string; action?: string; payload?: Record<string, unknown> };
    type InvokeHandler = (event: unknown, request: HostRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, InvokeHandler> })._invokeHandlers;
    const original = handlers?.get('host:invoke');
    const state = {
      tasks: initial.tasks,
      profiles: [{ profile: 'work', label: 'Work', description: 'Release sites', authStateName: 'work', activeSessions: 0, source: 'metadata' }],
      credentials: [{ id: 'credential-1', profile: 'work', origin: 'https://example.com', username: 'ada@example.com', createdAt: '2026-07-31T08:00:00.000Z', updatedAt: '2026-07-31T08:00:00.000Z' }],
    };
    (globalThis as unknown as { __scheduledE2eState?: typeof state }).__scheduledE2eState = state;
    const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
    const record = (request: HostRequest) => {
      (globalThis as unknown as { __verseClawE2eHostCalls?: unknown[] }).__verseClawE2eHostCalls?.push({
        module: request.module,
        action: request.action,
        payload: request.payload ?? null,
      });
    };

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostRequest) => {
      const current = (globalThis as unknown as { __scheduledE2eState: typeof state }).__scheduledE2eState;
      if (request.module !== 'agentBrowser') return original?.(event, request) ?? respond(request.id, {});
      record(request);
      if (request.action === 'tasks') return respond(request.id, { success: true, tasks: current.tasks });
      if (request.action === 'profiles') return respond(request.id, { success: true, profiles: current.profiles });
      if (request.action === 'vault') return respond(request.id, { success: true, credentials: current.credentials });
      if (request.action === 'vaultHealth') return respond(request.id, { success: true, health: { state: 'ready', path: 'C:/mock/vault.json', credentialCount: current.credentials.length } });
      const taskId = String(request.payload?.taskId || '');
      const taskIndex = current.tasks.findIndex((task) => task.id === taskId);
      if (taskIndex >= 0 && request.action === 'approveTask') {
        current.tasks[taskIndex] = {
          ...current.tasks[taskIndex],
          status: 'completed',
          approval: { ...current.tasks[taskIndex].approval, status: 'consumed', consumedAt: '2026-07-31T10:10:00.000Z' },
          steps: current.tasks[taskIndex].steps.map((step) => ({ ...step, status: 'passed' })),
          counters: { totalSteps: 1, passedSteps: 1, failedSteps: 0 },
          verification: { kind: 'selector-visible', value: 'h1', status: 'passed', reasonCode: 'SUCCESS_CRITERIA_MET', message: 'Heading found', checkedAt: '2026-07-31T10:10:00.000Z' },
          updatedAt: '2026-07-31T10:10:00.000Z',
        };
        return respond(request.id, { success: true, task: current.tasks[taskIndex] });
      }
      if (taskIndex >= 0 && request.action === 'retryTask') {
        current.tasks[taskIndex] = { ...current.tasks[taskIndex], status: 'waiting-approval', approval: { status: 'pending', requestedAt: '2026-07-31T10:11:00.000Z' }, error: undefined, errorCode: undefined };
        return respond(request.id, { success: true, task: current.tasks[taskIndex] });
      }
      if (taskIndex >= 0 && request.action === 'rejectTask') {
        current.tasks[taskIndex] = { ...current.tasks[taskIndex], status: 'cancelled', approval: { ...current.tasks[taskIndex].approval, status: 'rejected', decidedAt: '2026-07-31T10:12:00.000Z' } };
        return respond(request.id, { success: true, task: current.tasks[taskIndex] });
      }
      if (taskIndex >= 0 && request.action === 'cancelTask') {
        current.tasks[taskIndex] = { ...current.tasks[taskIndex], status: 'cancelled', steps: current.tasks[taskIndex].steps.map((step) => ({ ...step, status: 'cancelled' })) };
        return respond(request.id, { success: true, task: current.tasks[taskIndex] });
      }
      if (request.action === 'saveProfile') {
        const profile = { ...request.payload, activeSessions: 0, source: 'metadata' };
        const index = current.profiles.findIndex((entry) => entry.profile === profile.profile);
        if (index >= 0) current.profiles[index] = { ...current.profiles[index], ...profile };
        else current.profiles.push(profile as typeof current.profiles[number]);
        return respond(request.id, { success: true, profile });
      }
      if (request.action === 'saveCredential') {
        const credential = {
          id: String(request.payload?.id || `credential-${current.credentials.length + 1}`),
          profile: String(request.payload?.profile || 'default'),
          origin: String(request.payload?.origin || ''),
          username: String(request.payload?.username || ''),
          createdAt: '2026-07-31T10:13:00.000Z',
          updatedAt: '2026-07-31T10:13:00.000Z',
        };
        current.credentials = [...current.credentials.filter((entry) => entry.id !== credential.id), credential];
        return respond(request.id, { success: true, credential });
      }
      if (request.action === 'deleteCredential') {
        current.credentials = current.credentials.filter((entry) => entry.id !== request.payload?.credentialId);
        return respond(request.id, { success: true });
      }
      return respond(request.id, { success: true });
    });
  }, { tasks: browserTasks });
}

async function hideToasts(page: Page) {
  await page.addStyleTag({ content: '[data-sonner-toaster], [data-sonner-toast] { display: none !important; }' });
}

test.describe('FakeCoding Scheduled and Browser settings', () => {
  test('projects Cron and Browser runs, preserves actions, and manages Browser settings', async ({ electronApp, page }, testInfo) => {
    await installScheduledMocks(electronApp);
    await completeSetup(page);
    await hideToasts(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('sidebar-nav-cron').click();

    await expect(page.getByTestId('cron-job-card-cron-e2e')).toBeVisible();
    await expect(page.getByTestId('browser-task-card-browser-waiting')).toBeVisible();
    await expect(page.getByTestId('scheduled-source-filter')).toContainText('Browser runs');
    const lightDesktop = testInfo.outputPath('scheduled-1280-light.png');
    await page.screenshot({ path: lightDesktop });
    await testInfo.attach('Scheduled 1280 light', { path: lightDesktop, contentType: 'image/png' });

    await page.getByTestId('scheduled-source-browser-task').click();
    await expect(page.getByTestId('cron-job-card-cron-e2e')).toBeHidden();
    await page.getByTestId('browser-task-card-browser-waiting').click();
    const detail = page.getByTestId('browser-task-detail-panel');
    await expect(detail).toContainText('example.com');
    await expect(page.getByTestId('browser-detail-profile')).toContainText('work');
    await expect(page.getByTestId('browser-detail-scope')).toContainText('Read page');
    await expect(page.getByTestId('browser-detail-steps')).toContainText('Wait for element');
    await page.getByTestId('browser-detail-approve').click();
    await expect(detail).toContainText('Completed');

    await page.getByTestId('scheduled-detail-back').click();
    await page.getByTestId('browser-task-card-browser-failed').click();
    await detail.getByRole('button', { name: 'Retry' }).click();
    await expect(detail).toContainText('Waiting approval');
    await detail.getByRole('button', { name: 'Reject' }).click();
    await expect(detail).toContainText('Cancelled');

    await page.getByTestId('scheduled-detail-back').click();
    await page.getByTestId('browser-task-card-browser-running').click();
    await detail.getByRole('button', { name: 'Cancel' }).click();
    await expect(detail).toContainText('Cancelled');

    await page.setViewportSize({ width: 960, height: 800 });
    await expect(page.getByTestId('cron-job-list')).toBeHidden();
    await expect(page.getByTestId('scheduled-detail-back')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const lightNarrow = testInfo.outputPath('scheduled-960-light.png');
    await page.screenshot({ path: lightNarrow });
    await testInfo.attach('Scheduled 960 light', { path: lightNarrow, contentType: 'image/png' });

    await page.getByTestId('scheduled-detail-back').click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-theme-mode').getByRole('button', { name: 'Dark' }).click();
    await page.getByTestId('settings-back-button').click();
    const darkDesktop = testInfo.outputPath('scheduled-1280-dark.png');
    await page.screenshot({ path: darkDesktop });
    await testInfo.attach('Scheduled 1280 dark', { path: darkDesktop, contentType: 'image/png' });
    await page.setViewportSize({ width: 960, height: 800 });
    const darkNarrow = testInfo.outputPath('scheduled-960-dark.png');
    await page.screenshot({ path: darkNarrow });
    await testInfo.attach('Scheduled 960 dark', { path: darkNarrow, contentType: 'image/png' });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('scheduled-browser-settings').click();
    await expect(page.getByTestId('browser-settings-panel')).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toContain('/settings/browser');
    await expect(page.getByTestId('settings-nav-browser')).toBeVisible();
    await expect(page.getByTestId('settings-nav-browser')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('browser-profile-work')).toContainText('Release sites');
    const browserSettings = testInfo.outputPath('browser-settings-1280-dark.png');
    await page.screenshot({ path: browserSettings });
    await testInfo.attach('Browser settings 1280 dark', { path: browserSettings, contentType: 'image/png' });
    await page.getByTestId('browser-profile-new').click();
    await page.getByTestId('browser-profile-id').fill('personal');
    await page.getByTestId('browser-profile-label').fill('Personal');
    await page.getByTestId('browser-profile-save').click();
    await expect(page.getByTestId('browser-profile-personal')).toBeVisible();

    await page.getByTestId('browser-settings-view').getByRole('button', { name: 'Vault' }).click();
    await expect(page.getByTestId('browser-credential-credential-1')).toContainText('ada@example.com');
    await page.getByTestId('browser-credential-new').click();
    await page.getByTestId('browser-credential-profile').fill('personal');
    await page.getByTestId('browser-credential-origin').fill('https://example.org');
    await page.getByTestId('browser-credential-username').fill('lin@example.org');
    await page.getByTestId('browser-credential-password').fill('not-retained-after-save');
    await page.getByTestId('browser-credential-save').click();
    const savedCredential = page.getByTestId('browser-credential-credential-2');
    await expect(savedCredential).toContainText('lin@example.org');
    await expect(page.locator('body')).not.toContainText('not-retained-after-save');
    await savedCredential.getByRole('button', { name: 'Delete' }).click();
    await expect(savedCredential).toHaveCount(0);

    const calls = await electronApp.evaluate(() => (
      (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string }> }).__verseClawE2eHostCalls ?? []
    ));
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: 'agentBrowser', action: 'approveTask' }),
      expect.objectContaining({ module: 'agentBrowser', action: 'retryTask' }),
      expect.objectContaining({ module: 'agentBrowser', action: 'rejectTask' }),
      expect.objectContaining({ module: 'agentBrowser', action: 'cancelTask' }),
      expect.objectContaining({ module: 'agentBrowser', action: 'saveProfile' }),
      expect.objectContaining({ module: 'agentBrowser', action: 'saveCredential' }),
      expect.objectContaining({ module: 'agentBrowser', action: 'deleteCredential' }),
    ]));
  });
});
