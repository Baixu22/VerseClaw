import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const createdTask = {
  id: 'remote-task-e2e',
  source: 'local',
  status: 'pending',
  command: {
    kind: 'message',
    title: 'Check remote task inbox',
    body: 'This is a local test task.',
  },
  reason: 'Created from the local Remote Tasks page',
  createdAt: '2026-06-23T00:00:00.000Z',
  updatedAt: '2026-06-23T00:00:00.000Z',
  approvedAt: null,
  completedAt: null,
};

test.describe('Remote tasks', () => {
  test('opens the inbox and creates a local message task', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { running: true, ready: true },
      hostApi: {
        [stableStringify(['remoteTasks', 'list', null])]: {
          success: true,
          tasks: [],
          generatedAt: '2026-06-23T00:00:00.000Z',
        },
        [stableStringify(['remoteTasks', 'create', {
          source: 'local',
          reason: 'Created from the local Remote Tasks page',
          command: {
            kind: 'message',
            title: 'Check remote task inbox',
            body: 'This is a local test task.',
          },
        }])]: {
          success: true,
          task: createdTask,
        },
        [stableStringify(['remoteTasks', 'preview', { id: 'remote-task-e2e' }])]: {
          success: true,
          requiresApproval: false,
          changes: [],
        },
      },
    });

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-remote-tasks').click();
    await expect(page.getByTestId('remote-tasks-page')).toBeVisible();
    await page.getByTestId('remote-task-create').click();
    await expect(page.getByTestId('remote-task-list')).toContainText('Check remote task inbox');
    await expect(page.getByTestId('remote-task-detail')).toContainText('This is a local test task.');
  });
});
