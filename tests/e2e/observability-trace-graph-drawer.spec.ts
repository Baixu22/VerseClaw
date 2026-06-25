import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const startedAt = Date.parse('2026-06-16T10:00:00.000Z');

const trace = {
  id: 'trace-drawer-1',
  name: 'Drawer interaction trace',
  status: 'error',
  startedAt,
  durationMs: 2500,
  runId: 'run-drawer-1',
  sessionKey: 'agent:main:main',
  task: 'Test drawer interactions',
  mode: 'router',
  tokenUsage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, costUsd: 0.003 },
  metrics: {},
  tags: [],
  events: [],
  spans: [
    {
      id: 'router',
      traceId: 'trace-drawer-1',
      name: 'role-router',
      kind: 'role-router',
      roleName: 'implementer',
      status: 'completed',
      startedAt,
      durationMs: 20,
    },
    {
      id: 'tool',
      traceId: 'trace-drawer-1',
      parentSpanId: 'router',
      name: 'shell_command',
      kind: 'tool',
      status: 'error',
      startedAt: startedAt + 1200,
      durationMs: 100,
      error: 'Command failed',
    },
  ],
};

const traceGraph = {
  trace,
  graph: {
    traceId: 'trace-drawer-1',
    nodes: [
      {
        id: 'trace:trace-drawer-1',
        traceId: 'trace-drawer-1',
        kind: 'root',
        label: 'Drawer interaction trace',
        status: 'error',
        phase: 'input',
        startedAt,
        durationMs: 2500,
        summary: 'Test drawer interactions',
        critical: true,
      },
      {
        id: 'span:router',
        traceId: 'trace-drawer-1',
        kind: 'router',
        label: 'implementer',
        subtitle: 'role-router',
        status: 'completed',
        phase: 'routing',
        startedAt,
        durationMs: 20,
        roleName: 'implementer',
        spanId: 'router',
        parentId: 'trace:trace-drawer-1',
        critical: true,
      },
      {
        id: 'span:tool',
        traceId: 'trace-drawer-1',
        kind: 'tool',
        label: 'shell_command',
        subtitle: 'tool',
        status: 'error',
        phase: 'tool',
        startedAt: startedAt + 1200,
        durationMs: 100,
        spanId: 'tool',
        parentId: 'span:router',
        error: 'Command failed',
        critical: true,
        eventCount: 2,
        artifactCount: 1,
      },
    ],
    edges: [
      { id: 'edge:root-router', traceId: 'trace-drawer-1', from: 'trace:trace-drawer-1', to: 'span:router', status: 'completed', kind: 'parent-child', critical: true },
      { id: 'edge:router-tool', traceId: 'trace-drawer-1', from: 'span:router', to: 'span:tool', status: 'error', kind: 'parent-child', critical: true },
    ],
    summary: {
      criticalPathNodeIds: ['trace:trace-drawer-1', 'span:router', 'span:tool'],
      errorNodeIds: ['span:tool'],
      slowNodeIds: ['trace:trace-drawer-1'],
      tokenHotspotNodeIds: [],
      artifactNodeIds: [],
      sourceStatus: 'live',
      staleRunningNodeIds: [],
      coverage: {
        spanCount: 2,
        eventCount: 0,
        trajectoryEventCount: 0,
        graphNodeCount: 3,
        graphEdgeCount: 2,
        hasRuntimeSpans: true,
        hasTrajectory: false,
        redacted: true,
      },
      issues: [
        {
          id: 'issue:trace-drawer-1:error-root-cause:span:tool',
          traceId: 'trace-drawer-1',
          nodeId: 'span:tool',
          severity: 'critical',
          category: 'error-root-cause',
          title: 'Runtime error',
          detail: 'Command failed',
          evidence: ['shell_command / tool'],
          recommendation: 'Inspect command exit metadata.',
        },
      ],
    },
  },
  timeline: [
    { id: 'timeline-start', traceId: 'trace-drawer-1', nodeId: 'trace:trace-drawer-1', type: 'trace.started', label: 'Drawer interaction trace', timestamp: startedAt, status: 'error' },
    { id: 'timeline-tool', traceId: 'trace-drawer-1', nodeId: 'span:tool', spanId: 'tool', type: 'span.error', label: 'shell_command', timestamp: startedAt + 1200, status: 'error', summary: 'Command failed' },
  ],
};

const traceIndexEntry = {
  id: 'trace-drawer-1',
  name: 'Drawer interaction trace',
  status: 'error',
  durationMs: 2500,
  updatedAt: startedAt + 2500,
  sourceStatus: 'live',
  costUsd: 0.003,
  tokenCount: 150,
  spanCount: 2,
  errorCount: 1,
  startedAt,
  sessionKey: 'agent:main:main',
  runId: 'run-drawer-1',
  leadRole: 'implementer',
  role: 'implementer',
  agent: 'implementer',
  model: 'openai:gpt-5',
  hasToolCalls: true,
  hasArtifacts: false,
  hasApproval: false,
  hasRetries: false,
  hasWarnings: false,
  toolCallCount: 1,
  artifactCount: 0,
  warningCount: 0,
  retryCount: 0,
  approvalCount: 0,
  issueCount: 1,
  firstError: 'Command failed',
  slowestNodeLabel: 'shell_command',
  issues: traceGraph.graph.summary.issues,
  correlation: {
    traceId: 'trace-drawer-1',
    runId: 'run-drawer-1',
    sessionKey: 'agent:main:main',
  },
};

const traceQueryResult = {
  generatedAt: startedAt + 5000,
  items: [traceIndexEntry],
  total: 1,
  page: 1,
  pageSize: 100,
  facets: {
    status: [{ value: 'error', count: 1 }],
    agent: [{ value: 'implementer', count: 1 }],
    role: [{ value: 'implementer', count: 1 }],
    model: [{ value: 'openai:gpt-5', count: 1 }],
    sourceStatus: [{ value: 'live', count: 1 }],
  },
};

const toolDiagnostics = {
  traceId: 'trace-drawer-1',
  nodeId: 'span:tool',
  summary: 'Shell command failed.',
  inputPreview: 'redacted-preview:42',
  outputPreview: 'redacted-preview:64',
  error: 'Command failed',
  redacted: true,
  events: [
    { id: 'diag-tool', traceId: 'trace-drawer-1', nodeId: 'span:tool', spanId: 'tool', type: 'span.error', label: 'shell_command', timestamp: startedAt + 1200, status: 'error', summary: 'Command failed' },
  ],
  artifacts: [],
  attributes: {
    exitCode: '1',
    command: 'pnpm test',
  },
  sections: [
    {
      id: 'runtime',
      label: 'Runtime',
      items: [
        { id: 'status', label: 'Status', value: 'error', tone: 'bad' },
      ],
    },
  ],
};

const routerDiagnostics = {
  traceId: 'trace-drawer-1',
  nodeId: 'span:router',
  summary: 'Router completed.',
  inputPreview: 'redacted-preview:20',
  outputPreview: 'redacted-preview:30',
  redacted: true,
  events: [],
  artifacts: [],
  attributes: {},
  sections: [],
};

test.describe('Observability trace graph drawer', () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { running: true, ready: true },
      hostApi: {
        [stableStringify(['observability', 'dashboardSnapshot', null])]: {
          generatedAt: startedAt + 5000,
          cards: [
            { id: 'traces', label: 'Traces', value: 1, tone: 'neutral' },
            { id: 'errors', label: 'Errors', value: 1, tone: 'bad' },
          ],
          scorecards: [],
          alerts: [],
          traces: [traceIndexEntry],
        },
        [stableStringify(['observability', 'queryTraces', null])]: traceQueryResult,
        [stableStringify(['observability', 'traceGraph', { id: 'trace-drawer-1' }])]: traceGraph,
        [stableStringify(['observability', 'traceNodeDiagnostics', { traceId: 'trace-drawer-1', nodeId: 'span:tool' }])]: toolDiagnostics,
        [stableStringify(['observability', 'traceNodeDiagnostics', { traceId: 'trace-drawer-1', nodeId: 'span:router' }])]: routerDiagnostics,
      },
    });

    await completeSetup(page);
    // Navigate to observability without any persisted nodeId/traceId params
    await page.evaluate(() => {
      window.location.hash = '/observability';
    });
    await expect(page.getByTestId('observability-page')).toBeVisible();
    await page.getByTestId('observability-trace-row').first().click();
    await expect(page.getByTestId('observability-trace-graph')).toBeVisible();
    // Drawer may auto-open from persisted selectedNodeId in store; close it if present
    try {
      await expect(page.getByTestId('observability-detail-panel')).toBeVisible({ timeout: 2000 });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('observability-detail-panel')).toBeHidden();
    } catch {
      // Drawer was not open — nothing to close
    }
  });

  test('drawer is hidden until a node is clicked', async ({ page }) => {
    await expect(page.getByTestId('observability-detail-panel')).toHaveCount(0);
    await page.getByTestId('trace-graph-node-tool').click();
    await expect(page.getByTestId('observability-detail-panel')).toBeVisible();
  });

  test('drawer header shows node label and subtitle', async ({ page }) => {
    await page.getByTestId('trace-graph-node-tool').click();
    await expect(page.getByTestId('observability-detail-panel')).toContainText('shell_command');
  });

  test('clicking overlay closes the drawer', async ({ page }) => {
    await page.getByTestId('trace-graph-node-tool').click();
    await expect(page.getByTestId('observability-detail-panel')).toBeVisible();
    await page.getByTestId('trace-drawer-overlay').click();
    await expect(page.getByTestId('observability-detail-panel')).toBeHidden();
  });

  test('ESC key closes the drawer', async ({ page }) => {
    await page.getByTestId('trace-graph-node-tool').click();
    await expect(page.getByTestId('observability-detail-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('observability-detail-panel')).toBeHidden();
  });

  test('close button closes the drawer', async ({ page }) => {
    await page.getByTestId('trace-graph-node-tool').click();
    await expect(page.getByTestId('observability-detail-panel')).toBeVisible();
    await page.getByTestId('trace-drawer-close').click();
    await expect(page.getByTestId('observability-detail-panel')).toBeHidden();
  });

  test('switching nodes updates drawer content', async ({ page }) => {
    await page.getByTestId('trace-graph-node-tool').click();
    await expect(page.getByTestId('observability-detail-panel')).toContainText('shell_command');
    await expect(page.getByTestId('observability-detail-panel')).toContainText('Command failed');

    // Close drawer before clicking another node (overlay blocks graph clicks)
    await page.getByTestId('trace-drawer-close').click();
    await expect(page.getByTestId('observability-detail-panel')).toBeHidden();
    await page.getByTestId('trace-graph-node-router').click();
    await expect(page.getByTestId('observability-detail-panel')).toContainText('implementer');
  });

  test('drawer preserves tab navigation', async ({ page }) => {
    await page.getByTestId('trace-graph-node-tool').click();
    await expect(page.getByTestId('observability-detail-panel')).toBeVisible();

    await page.getByRole('tab', { name: 'Events' }).click();
    await expect(page.getByTestId('observability-diagnostics-events')).toContainText('shell_command');

    await page.getByRole('tab', { name: 'Attributes' }).click();
    await expect(page.getByTestId('observability-diagnostics-attributes')).toContainText('exitCode');
  });
});
