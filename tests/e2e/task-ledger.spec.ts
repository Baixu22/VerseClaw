import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const snapshot = {
  schemaVersion: 1,
  workspaceId: 'default-0000000000',
  generatedAt: '2026-06-16T10:00:00.000Z',
  nodes: [
    {
      id: 'goal-1',
      title: 'Ship long task ledger',
      kind: 'goal',
      status: 'doing',
      parentId: null,
      createdAt: '2026-06-16T09:00:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
    {
      id: 'task-1',
      title: 'Resolve export blocker',
      kind: 'task',
      status: 'blocked',
      parentId: 'goal-1',
      createdAt: '2026-06-16T09:10:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
    {
      id: 'task-2',
      title: 'Review agent-neutral schema',
      kind: 'review',
      status: 'review',
      parentId: 'goal-1',
      createdAt: '2026-06-16T09:20:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
    {
      id: 'decision-1',
      title: 'Use append-only JSONL',
      kind: 'decision',
      status: 'done',
      parentId: 'goal-1',
      createdAt: '2026-06-16T09:30:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
  ],
  edges: [
    {
      id: 'edge-1',
      from: 'task-1',
      to: 'goal-1',
      type: 'depends_on',
      createdAt: '2026-06-16T09:40:00.000Z',
    },
  ],
  sessionLinks: [
    {
      id: 'link-1',
      nodeId: 'task-1',
      sessionKey: 'agent:main:main',
      summary: 'Implementation session',
      createdAt: '2026-06-16T09:50:00.000Z',
    },
  ],
  rootNodeIds: ['goal-1'],
  reviewNodeIds: ['task-2'],
  activeNodeIds: ['goal-1'],
  blockedNodeIds: ['task-1'],
  currentGoalId: 'goal-1',
  recentDecisions: [
    {
      id: 'decision-1',
      title: 'Use append-only JSONL',
      kind: 'decision',
      status: 'done',
      parentId: 'goal-1',
      createdAt: '2026-06-16T09:30:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
  ],
  eventsCount: 8,
  warnings: [],
};

test.describe('Task ledger', () => {
  test('shows task ledger page tabs and chat summary panel', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { running: true, ready: true },
      gatewayRpc: {
        [stableStringify(['sessions.list', {}])]: {
          success: true,
          result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] },
        },
      },
      hostApi: {
        [stableStringify(['sessions', 'history', { sessionKey: 'agent:main:main', limit: 200 }])]: {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Work on long task ledger' }], timestamp: Date.now() }],
        },
        [stableStringify(['taskLedger', 'snapshot', { workspaceId: 'default' }])]: {
          success: true,
          snapshot,
        },
        [stableStringify(['taskLedger', 'snapshot', { workspaceId: null }])]: {
          success: true,
          snapshot,
        },
        [stableStringify(['taskLedger', 'exportHtml', { workspaceId: 'default', includeHistory: true }])]: {
          success: true,
          path: '/tmp/task-ledger.html',
        },
      },
    });

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-task-ledger').click();
    await expect(page.getByTestId('task-ledger-page')).toBeVisible();
    await expect(page.getByTestId('task-ledger-tree')).toContainText('Ship long task ledger');
    await page.getByRole('tab', { name: /DAG/ }).click();
    await expect(page.getByTestId('task-ledger-dag')).toContainText('depends on');
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByTestId('task-ledger-history')).toContainText('8 event records');
    await page.getByRole('tab', { name: 'Review' }).click();
    await expect(page.getByTestId('task-ledger-review')).toContainText('Review agent-neutral schema');

    await page.evaluate(() => {
      window.location.hash = '/';
    });
    await expect(page.getByTestId('chat-page')).toBeVisible();
    await expect(page.getByTestId('task-ledger-summary')).toContainText('Ship long task ledger');
    await expect(page.getByTestId('task-ledger-summary')).toContainText('Resolve export blocker');
  });
});
