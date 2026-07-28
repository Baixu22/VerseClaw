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
            status: 'interrupted',
            statusExplain: 'Interrupted by app restart while task was running',
            retryCount: 0,
            createdAt: '2026-07-11T08:02:00.000Z',
            updatedAt: '2026-07-11T08:03:00.000Z',
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
      },
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-browser').click();
    await expect(page.getByTestId('browser-workbench')).toBeVisible();
    await expect(page.getByText('Operations dashboard')).toBeVisible();
    await expect(page.getByText('https://example.com/dashboard')).toBeVisible();

    await page.getByRole('tab', { name: /Tasks|任务|タスク|Задачи/ }).click();
    await expect(page.getByText('Check dashboard')).toBeVisible();
    await expect(page.getByText('Resume interrupted audit')).toBeVisible();
    await expect(page.getByText('Interrupted', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await page.getByRole('tab', { name: /Vault|凭据库|保管庫|Хранилище/ }).click();
    await expect(page.getByText('ada@example.com')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('password');
  });
});
