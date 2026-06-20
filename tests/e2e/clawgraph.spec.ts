import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const workflowPath = 'C:\\workspace\\.clawx\\clawgraph\\long.yaml';

const compile = {
  ok: true,
  diagnostics: [],
  ir: {
    schemaVersion: 1,
    workflowId: 'long_task_pipeline_v1',
    title: 'Long task pipeline',
    objective: 'Ship a stable long-task feature',
    maxParallel: 3,
    policies: [],
    termination: ['all_required_nodes_done'],
    nodes: [
      {
        id: 'split',
        type: 'agent',
        role: 'planner',
        runtimeRole: 'planner',
        modelRef: 'openai/gpt-5.3-mini',
        task: 'Split the objective.',
        dependsOn: [],
        checks: [],
        required: true,
      },
      {
        id: 'audit',
        type: 'audit',
        role: 'auditor',
        runtimeRole: 'reviewer',
        modelRef: 'openai/gpt-5.3-mini',
        task: 'Audit evidence.',
        dependsOn: ['split'],
        checks: ['schema_valid'],
        required: true,
      },
    ],
  },
};

const runSnapshot = {
  runId: 'clawgraph_run_1',
  workflowId: 'long_task_pipeline_v1',
  title: 'Long task pipeline',
  objective: 'Ship a stable long-task feature',
  status: 'review',
  sessionKey: 'agent:main:main',
  workspaceId: 'default',
  sourcePath: workflowPath,
  progress: 50,
  activeNodeIds: [],
  blockedNodeIds: ['audit'],
  reviewItems: [
    {
      id: 'review_1',
      runId: 'clawgraph_run_1',
      nodeId: 'audit',
      kind: 'audit_failure',
      status: 'open',
      title: 'Review audit',
      reason: 'Audit evidence needs user confirmation.',
      createdAt: Date.now(),
    },
  ],
  nodes: [
    {
      id: 'split',
      type: 'agent',
      role: 'planner',
      runtimeRole: 'planner',
      status: 'done',
      attempt: 1,
      dependsOn: [],
      childRunId: 'run_child',
      handoff: {
        nodeId: 'split',
        status: 'done',
        summary: 'Split completed.',
        evidenceRefs: [{ type: 'subagent', ref: 'run_child' }],
      },
    },
    {
      id: 'audit',
      type: 'audit',
      role: 'auditor',
      runtimeRole: 'reviewer',
      status: 'review',
      attempt: 1,
      dependsOn: ['split'],
      error: 'Audit needs review',
    },
  ],
  eventsCount: 4,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

test.describe('ClawGraph', () => {
  test('lists workflows, runs one, and shows DAG/events/review', async ({ electronApp, page }) => {
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
          messages: [],
        },
        [stableStringify(['clawGraph', 'listWorkflows', { workspaceId: 'default' }])]: {
          success: true,
          available: true,
          workflows: [{
            name: 'long.yaml',
            path: workflowPath,
            relativePath: '.clawx/clawgraph/long.yaml',
            size: 400,
            mtime: Date.now(),
          }],
          workspaceId: 'default',
          workspaceRoot: 'C:\\workspace',
        },
        [stableStringify(['clawGraph', 'compile', { workspaceId: 'default', sourcePath: workflowPath }])]: {
          success: true,
          available: true,
          compile,
        },
        [stableStringify(['clawGraph', 'run', {
          workspaceId: 'default',
          sourcePath: workflowPath,
          sessionKey: 'agent:main:main',
          agentId: 'main',
        }])]: {
          success: true,
          available: true,
          compile,
          snapshot: runSnapshot,
        },
        [stableStringify(['clawGraph', 'events', { runId: 'clawgraph_run_1', limit: 200 }])]: {
          success: true,
          available: true,
          events: [
            { id: 'event_1', runId: 'clawgraph_run_1', type: 'run_started', message: 'start', createdAt: Date.now() },
            { id: 'event_2', runId: 'clawgraph_run_1', type: 'review_requested', nodeId: 'audit', message: 'review', createdAt: Date.now() },
          ],
        },
      },
    });

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-clawgraph').click();
    await expect(page.getByTestId('clawgraph-page')).toBeVisible();
    await expect(page.getByTestId('clawgraph-workflow-select')).toContainText('.clawx/clawgraph/long.yaml');
    await expect(page.getByText('Ready')).toBeVisible();

    await page.getByRole('button', { name: /Run workflow/ }).click();
    await expect(page.getByTestId('clawgraph-dag')).toContainText('split');
    await expect(page.getByTestId('clawgraph-dag')).toContainText('audit');

    await page.getByRole('tab', { name: 'Events' }).click();
    await expect(page.getByTestId('clawgraph-events')).toContainText('Review requested');

    await page.getByRole('tab', { name: 'Review' }).click();
    await expect(page.getByTestId('clawgraph-review')).toContainText('Audit evidence needs user confirmation.');
  });
});
