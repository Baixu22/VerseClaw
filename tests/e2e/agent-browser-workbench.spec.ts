import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}

test.describe('Agent Browser workbench', () => {
  test('shows Host API session, task, profile, and Vault metadata at their workspace destinations', async ({ electronApp, page }, testInfo) => {
    await installIpcMocks(electronApp, {
      hostApi: {
        [stableStringify(['agentBrowser', 'status', null])]: {
          success: true,
          sessions: [{
            id: 'session-1',
            profile: 'work',
            mode: 'headless',
            url: 'https://example.com/dashboard',
            title: 'Operations dashboard',
            createdAt: '2026-07-11T08:00:00.000Z',
            updatedAt: '2026-07-11T08:01:00.000Z',
          }],
        },
        [stableStringify(['agentBrowser', 'tasks', null])]: {
          success: true,
          tasks: [{
            id: 'task-1',
            name: 'Check dashboard',
            url: 'https://example.com/dashboard',
            objective: 'Read current service health',
            profile: 'work',
            mode: 'headless',
            allowedDomains: ['example.com'],
            permissionScope: ['navigate', 'read-page'],
            steps: [
              { id: 'step-1', action: 'navigate', url: 'https://example.com/dashboard', status: 'passed' },
              { id: 'step-2', action: 'wait-for-selector', selector: 'main', status: 'passed' },
            ],
            successCriteria: { kind: 'text-includes', value: 'Operational' },
            verification: { kind: 'text-includes', value: 'Operational', status: 'passed', reasonCode: 'SUCCESS_CRITERIA_MET', message: 'matched', checkedAt: '2026-07-11T08:01:00.000Z' },
            approval: { status: 'consumed', requestedAt: '2026-07-11T08:00:00.000Z', consumedAt: '2026-07-11T08:00:10.000Z' },
            counters: { totalSteps: 2, passedSteps: 2, failedSteps: 0 },
            status: 'completed',
            retryCount: 0,
            createdAt: '2026-07-11T08:00:00.000Z',
            updatedAt: '2026-07-11T08:01:00.000Z',
            sessionId: 'session-1',
          }, {
            id: 'task-2',
            name: 'Resume interrupted audit',
            url: 'https://example.com/audit',
            objective: 'Continue after app restart',
            profile: 'work',
            mode: 'headless',
            allowedDomains: ['example.com'],
            permissionScope: ['navigate'],
            steps: [{ id: 'step-1', action: 'navigate', url: 'https://example.com/audit', status: 'pending' }],
            successCriteria: { kind: 'url-includes', value: '/audit' },
            approval: { status: 'consumed', requestedAt: '2026-07-11T08:02:00.000Z', consumedAt: '2026-07-11T08:02:10.000Z' },
            counters: { totalSteps: 1, passedSteps: 0, failedSteps: 0 },
            status: 'interrupted',
            statusExplain: 'Interrupted by app restart while task was running',
            retryCount: 0,
            createdAt: '2026-07-11T08:02:00.000Z',
            updatedAt: '2026-07-11T08:03:00.000Z',
          }, {
            id: 'task-3',
            name: 'Approve release check',
            url: 'https://example.com/releases',
            objective: 'Open release notes and verify the heading',
            profile: 'work',
            mode: 'visible',
            allowedDomains: ['example.com'],
            permissionScope: ['navigate', 'read-page', 'interact-page'],
            steps: [
              { id: 'step-1', action: 'navigate', url: 'https://example.com/releases', status: 'pending' },
              { id: 'step-2', action: 'click', selector: 'a.release', status: 'pending' },
            ],
            successCriteria: { kind: 'selector-visible', value: 'h1' },
            approval: { status: 'pending', requestedAt: '2026-07-11T08:04:00.000Z' },
            counters: { totalSteps: 2, passedSteps: 0, failedSteps: 0 },
            status: 'waiting-approval',
            retryCount: 0,
            createdAt: '2026-07-11T08:04:00.000Z',
            updatedAt: '2026-07-11T08:04:00.000Z',
          }, {
            id: 'task-4',
            name: 'Failed verification',
            url: 'https://example.com/status',
            objective: 'Verify the status page',
            profile: 'work',
            mode: 'headless',
            allowedDomains: ['example.com'],
            permissionScope: ['navigate', 'read-page'],
            steps: [
              { id: 'step-1', action: 'navigate', url: 'https://example.com/status', status: 'passed' },
              { id: 'step-2', action: 'wait-for-selector', selector: '#healthy', status: 'failed', errorCode: 'STEP_FAILED' },
            ],
            successCriteria: { kind: 'selector-visible', value: '#healthy' },
            verification: { kind: 'selector-visible', value: '#healthy', status: 'failed', reasonCode: 'SELECTOR_CRITERIA_NOT_MET', message: 'missing', checkedAt: '2026-07-11T08:05:00.000Z' },
            approval: { status: 'consumed', requestedAt: '2026-07-11T08:04:30.000Z', consumedAt: '2026-07-11T08:04:40.000Z' },
            counters: { totalSteps: 2, passedSteps: 1, failedSteps: 1 },
            status: 'failed',
            retryCount: 0,
            createdAt: '2026-07-11T08:04:30.000Z',
            updatedAt: '2026-07-11T08:05:00.000Z',
          }, {
            id: 'task-5',
            name: 'Running release check',
            url: 'https://example.com/releases',
            objective: 'Wait for the release check to finish',
            profile: 'work',
            mode: 'headless',
            allowedDomains: ['example.com'],
            permissionScope: ['navigate', 'read-page'],
            steps: [
              { id: 'step-1', action: 'navigate', url: 'https://example.com/releases', status: 'passed' },
              { id: 'step-2', action: 'wait-for-selector', selector: '#complete', status: 'running' },
            ],
            successCriteria: { kind: 'selector-visible', value: '#complete' },
            approval: { status: 'consumed', requestedAt: '2026-07-11T08:05:30.000Z', consumedAt: '2026-07-11T08:05:40.000Z' },
            counters: { totalSteps: 2, passedSteps: 1, failedSteps: 0 },
            status: 'running',
            retryCount: 0,
            createdAt: '2026-07-11T08:05:30.000Z',
            updatedAt: '2026-07-11T08:06:00.000Z',
          }],
        },
        [stableStringify(['agentBrowser', 'profiles', null])]: {
          success: true,
          profiles: [{ profile: 'work', label: 'Work', activeSessions: 1, source: 'metadata' }],
        },
        [stableStringify(['agentBrowser', 'vault', null])]: {
          success: true,
          credentials: [{
            id: 'credential-1',
            profile: 'work',
            origin: 'https://example.com',
            username: 'ada@example.com',
            createdAt: '2026-07-11T08:00:00.000Z',
            updatedAt: '2026-07-11T08:00:00.000Z',
          }],
        },
        [stableStringify(['agentBrowser', 'vaultHealth', null])]: {
          success: true,
          health: { state: 'ready', path: '/mock/vault.json', credentialCount: 1 },
        },
        [stableStringify(['agentBrowser', 'approveTask', { taskId: 'task-3' }])]: {
          success: true,
          task: { id: 'task-3', status: 'completed' },
        },
        [stableStringify(['agentBrowser', 'cancelTask', { taskId: 'task-5' }])]: {
          success: true,
          task: { id: 'task-5', status: 'cancelled' },
        },
      },
    });

    await completeSetup(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('sidebar-footer-menu-trigger').click();
    await page.getByTestId('sidebar-more-browser').click();
    const live = page.getByTestId('workspace-browser-live');
    await expect(live).toBeVisible();
    await expect(live.getByRole('combobox')).toHaveValue('session-1');
    await expect(live.getByRole('option', { name: 'Operations dashboard' })).toHaveCount(1);
    await expect(live.locator('input.rs-browser-address-input')).toHaveValue('https://example.com/dashboard');
    await page.screenshot({ path: testInfo.outputPath('browser-live-1280.png') });

    await page.getByTestId('sidebar-nav-cron').click();
    await page.getByTestId('scheduled-source-browser-task').click();
    await expect(page.getByTestId('browser-task-card-task-1')).toContainText('Check dashboard');
    await expect(page.getByTestId('browser-task-card-task-2')).toContainText('Resume interrupted audit');
    await page.getByTestId('browser-task-card-task-2').click();
    const detail = page.getByTestId('browser-task-detail-panel');
    await expect(detail).toContainText('Interrupted');
    await expect(detail.getByRole('button', { name: 'Retry' })).toBeVisible();
    await page.getByTestId('scheduled-detail-back').click();
    await page.getByTestId('browser-task-card-task-1').click();
    await expect(page.getByTestId('browser-detail-steps')).toContainText('Wait for element');
    await expect(page.getByTestId('browser-detail-verification')).toContainText('Verified');
    await page.getByTestId('scheduled-detail-back').click();
    await page.getByTestId('browser-task-card-task-4').click();
    await expect(page.getByTestId('browser-detail-verification')).toContainText('Verification failed');
    await page.getByTestId('scheduled-detail-back').click();
    await page.getByTestId('browser-task-card-task-3').click();
    await expect(page.getByTestId('browser-detail-domains')).toContainText('example.com');
    await page.screenshot({ path: testInfo.outputPath('browser-tasks-1280.png') });
    await page.setViewportSize({ width: 960, height: 800 });
    await page.screenshot({ path: testInfo.outputPath('browser-tasks-960.png') });
    await detail.screenshot({ path: testInfo.outputPath('browser-approval-960.png') });
    await page.getByTestId('browser-detail-approve').click();
    const approveCalls = await electronApp.evaluate(() => (
      (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> }).__verseClawE2eHostCalls ?? []
    ).filter((call) => call.module === 'agentBrowser' && call.action === 'approveTask'));
    expect(approveCalls).toEqual([{ module: 'agentBrowser', action: 'approveTask', payload: { taskId: 'task-3' } }]);
    await page.getByTestId('scheduled-detail-back').click();
    await page.getByTestId('browser-task-card-task-5').click();
    await detail.getByRole('button', { name: 'Cancel', exact: true }).click();
    const cancelCalls = await electronApp.evaluate(() => (
      (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> }).__verseClawE2eHostCalls ?? []
    ).filter((call) => call.module === 'agentBrowser' && call.action === 'cancelTask'));
    expect(cancelCalls).toEqual([{ module: 'agentBrowser', action: 'cancelTask', payload: { taskId: 'task-5' } }]);
    await page.getByTestId('scheduled-detail-back').click();
    await page.getByTestId('scheduled-browser-settings').click();
    await expect(page.getByTestId('browser-settings-panel')).toBeVisible();
    await expect(page.getByTestId('browser-profile-work')).toContainText('Work');
    await page.getByTestId('browser-settings-view').getByRole('button', { name: 'Vault' }).click();
    await expect(page.getByText('ada@example.com')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('password');
  });
});
