import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

const EVIDENCE_DIR = resolve(process.cwd(), 'artifacts', 'first-product-preview', 'FP-P4-02');

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}

test.describe('Agent Browser workbench', () => {
  test('shows real Host API session, task, profile, and Vault metadata', async ({ electronApp, page }) => {
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
    await page.getByTestId('sidebar-footer-menu-trigger').click();
    await page.getByTestId('sidebar-more-browser').click();
    const diskSpaceNotice = page.getByText('Disk space is running low', { exact: true });
    if (await diskSpaceNotice.isVisible().catch(() => false)) {
      await diskSpaceNotice.locator('xpath=ancestor::*[@data-sonner-toast][1]').getByRole('button').click();
    }
    await expect(page.getByTestId('browser-workbench')).toBeVisible();
    await expect(page.getByText('Operations dashboard')).toBeVisible();
    await expect(page.getByText('https://example.com/dashboard')).toBeVisible();

    await page.getByRole('tab', { name: /Tasks|任务|タスク|Задачи/ }).click();
    await expect(page.getByText('Check dashboard')).toBeVisible();
    await expect(page.getByText('Resume interrupted audit')).toBeVisible();
    await expect(page.getByText('Interrupted', { exact: true })).toBeVisible();
    await expect(page.getByTestId('task-row-task-2').getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByTestId('task-steps-task-1')).toContainText(/Wait for element|等待元素|要素を待機|Ждать элемент/);
    await expect(page.getByText(/Verified|验证通过|検証済み|Проверено/)).toBeVisible();
    await expect(page.getByText(/Verification failed|验证失败|検証失敗|Проверка не пройдена/)).toBeVisible();
    await expect(page.getByTestId('task-approval-task-3')).toContainText('example.com');
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: join(EVIDENCE_DIR, 'browser-workbench-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 720, height: 900 });
    await page.screenshot({ path: join(EVIDENCE_DIR, 'browser-workbench-narrow.png'), fullPage: true });
    await page.getByTestId('task-row-task-3').screenshot({ path: join(EVIDENCE_DIR, 'browser-approval-narrow.png') });
    await page.getByRole('button', { name: /Approve and run|批准并运行|承認して実行|Подтвердить и запустить/ }).click();
    const approveCalls = await electronApp.evaluate(() => (
      (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> }).__verseClawE2eHostCalls ?? []
    ).filter((call) => call.module === 'agentBrowser' && call.action === 'approveTask'));
    expect(approveCalls).toEqual([{ module: 'agentBrowser', action: 'approveTask', payload: { taskId: 'task-3' } }]);
    await page.getByTestId('task-row-task-5').getByRole('button').click();
    const cancelCalls = await electronApp.evaluate(() => (
      (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> }).__verseClawE2eHostCalls ?? []
    ).filter((call) => call.module === 'agentBrowser' && call.action === 'cancelTask'));
    expect(cancelCalls).toEqual([{ module: 'agentBrowser', action: 'cancelTask', payload: { taskId: 'task-5' } }]);
    await page.getByRole('tab', { name: /Vault|凭据库|保管庫|Хранилище/ }).click();
    await expect(page.getByText('ada@example.com')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('password');
  });
});
