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
  id: 'trace-run-1',
  name: 'Agent trace workbench',
  status: 'error',
  startedAt,
  durationMs: 2500,
  runId: 'run-1',
  sessionKey: 'agent:main:main',
  task: 'Implement agent trace visualization',
  mode: 'router',
  tokenUsage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, costUsd: 0.003 },
  metrics: {},
  tags: ['role-first'],
  events: [],
  spans: [
    {
      id: 'router',
      traceId: 'trace-run-1',
      name: 'role-router',
      kind: 'role-router',
      roleName: 'implementer',
      status: 'completed',
      startedAt,
      durationMs: 20,
    },
    {
      id: 'model',
      traceId: 'trace-run-1',
      parentSpanId: 'router',
      name: 'model.call',
      kind: 'model',
      modelRef: 'openai:gpt-5',
      status: 'completed',
      startedAt: startedAt + 100,
      durationMs: 900,
    },
    {
      id: 'tool',
      traceId: 'trace-run-1',
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
    traceId: 'trace-run-1',
    nodes: [
      {
        id: 'trace:trace-run-1',
        traceId: 'trace-run-1',
        kind: 'root',
        label: 'Agent trace workbench',
        status: 'error',
        phase: 'input',
        startedAt,
        durationMs: 2500,
        summary: 'Implement agent trace visualization',
        critical: true,
      },
      {
        id: 'span:router',
        traceId: 'trace-run-1',
        kind: 'router',
        label: 'implementer',
        subtitle: 'role-router',
        status: 'completed',
        phase: 'routing',
        startedAt,
        durationMs: 20,
        roleName: 'implementer',
        spanId: 'router',
        parentId: 'trace:trace-run-1',
        critical: true,
      },
      {
        id: 'span:model',
        traceId: 'trace-run-1',
        kind: 'model',
        label: 'model.call',
        subtitle: 'model',
        status: 'completed',
        phase: 'model',
        startedAt: startedAt + 100,
        durationMs: 900,
        modelRef: 'openai:gpt-5',
        spanId: 'model',
        parentId: 'span:router',
        tokenUsage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, costUsd: 0.003 },
      },
      {
        id: 'span:tool',
        traceId: 'trace-run-1',
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
      {
        id: 'trajectory:trace-run-1:patch.completed',
        traceId: 'trace-run-1',
        kind: 'file',
        phase: 'artifact',
        label: 'src/App.tsx',
        subtitle: 'patch.completed',
        status: 'completed',
        startedAt: startedAt + 1400,
        parentId: 'span:tool',
        artifactCount: 1,
      },
    ],
    edges: [
      { id: 'edge:root-router', traceId: 'trace-run-1', from: 'trace:trace-run-1', to: 'span:router', status: 'completed', kind: 'parent-child', critical: true },
      { id: 'edge:router-model', traceId: 'trace-run-1', from: 'span:router', to: 'span:model', status: 'completed', kind: 'parent-child' },
      { id: 'edge:router-tool', traceId: 'trace-run-1', from: 'span:router', to: 'span:tool', status: 'error', kind: 'parent-child', critical: true },
      { id: 'edge:tool-file', traceId: 'trace-run-1', from: 'span:tool', to: 'trajectory:trace-run-1:patch.completed', status: 'completed', kind: 'artifact' },
    ],
    summary: {
      criticalPathNodeIds: ['trace:trace-run-1', 'span:router', 'span:tool'],
      errorNodeIds: ['span:tool'],
      slowNodeIds: ['trace:trace-run-1', 'span:model'],
      tokenHotspotNodeIds: ['span:model'],
      artifactNodeIds: ['trajectory:trace-run-1:patch.completed'],
      sourceStatus: 'live',
      staleRunningNodeIds: [],
      coverage: {
        spanCount: 3,
        eventCount: 0,
        trajectoryEventCount: 1,
        graphNodeCount: 5,
        graphEdgeCount: 4,
        hasRuntimeSpans: true,
        hasTrajectory: true,
        redacted: true,
      },
      issues: [
        {
          id: 'issue:trace-run-1:error-root-cause:span:tool',
          traceId: 'trace-run-1',
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
    { id: 'timeline-start', traceId: 'trace-run-1', nodeId: 'trace:trace-run-1', type: 'trace.started', label: 'Agent trace workbench', timestamp: startedAt, status: 'error' },
    { id: 'timeline-router', traceId: 'trace-run-1', nodeId: 'span:router', spanId: 'router', type: 'span.completed', label: 'implementer', timestamp: startedAt, status: 'completed' },
    { id: 'timeline-tool', traceId: 'trace-run-1', nodeId: 'span:tool', spanId: 'tool', type: 'span.error', label: 'shell_command', timestamp: startedAt + 1200, status: 'error', summary: 'Command failed' },
    { id: 'timeline-file', traceId: 'trace-run-1', nodeId: 'trajectory:trace-run-1:patch.completed', type: 'patch.completed', label: 'src/App.tsx', timestamp: startedAt + 1400, status: 'completed', summary: '1 file changed' },
  ],
};

const traceIndexEntry = {
  id: 'trace-run-1',
  name: 'Agent trace workbench',
  status: 'error',
  durationMs: 2500,
  updatedAt: startedAt + 2500,
  sourceStatus: 'live',
  costUsd: 0.003,
  tokenCount: 150,
  spanCount: 3,
  errorCount: 1,
  startedAt,
  sessionKey: 'agent:main:main',
  runId: 'run-1',
  leadRole: 'implementer',
  role: 'implementer',
  agent: 'implementer',
  model: 'openai:gpt-5',
  hasToolCalls: true,
  hasArtifacts: true,
  hasApproval: false,
  hasRetries: false,
  hasWarnings: false,
  toolCallCount: 1,
  artifactCount: 1,
  warningCount: 0,
  retryCount: 0,
  approvalCount: 0,
  issueCount: 1,
  firstError: 'Command failed',
  slowestNodeLabel: 'model.call',
  issues: traceGraph.graph.summary.issues,
  correlation: {
    traceId: 'trace-run-1',
    runId: 'run-1',
    sessionKey: 'agent:main:main',
    filePaths: ['src/App.tsx'],
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
  traceId: 'trace-run-1',
  nodeId: 'span:tool',
  summary: 'Shell command failed after producing a file artifact.',
  inputPreview: 'redacted-preview:42',
  outputPreview: 'redacted-preview:64',
  error: 'Command failed',
  redacted: true,
  events: [
    { id: 'diag-tool', traceId: 'trace-run-1', nodeId: 'span:tool', spanId: 'tool', type: 'span.error', label: 'shell_command', timestamp: startedAt + 1200, status: 'error', summary: 'Command failed' },
    { id: 'diag-file', traceId: 'trace-run-1', nodeId: 'trajectory:trace-run-1:patch.completed', type: 'patch.completed', label: 'src/App.tsx', timestamp: startedAt + 1400, status: 'completed', summary: '1 file changed' },
  ],
  artifacts: [
    { id: 'trajectory:trace-run-1:patch.completed', type: 'file', label: 'src/App.tsx', preview: '1 file changed', path: 'src/App.tsx', status: 'completed' },
  ],
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
        { id: 'phase', label: 'Phase', value: 'tool' },
      ],
    },
    {
      id: 'hotspots',
      label: 'Hotspots',
      items: [
        { id: 'events', label: 'Events', value: '2' },
        { id: 'artifacts', label: 'Artifacts', value: '1' },
      ],
    },
  ],
};

test.describe('Observability trace graph workbench', () => {
  test('renders graph, details, and timeline from traceGraph host API', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { running: true, ready: true },
      hostApi: {
        [stableStringify(['observability', 'dashboardSnapshot', null])]: {
          generatedAt: startedAt + 5000,
          cards: [
            { id: 'traces', label: 'Traces', value: 1, tone: 'neutral' },
            { id: 'errors', label: 'Errors', value: 1, tone: 'bad' },
            { id: 'tools', label: 'Tools', value: 1, tone: 'neutral' },
          ],
          scorecards: [],
          alerts: ['1 trace contains an error'],
          traces: [{
            ...traceIndexEntry,
          }],
        },
        [stableStringify(['observability', 'queryTraces', null])]: traceQueryResult,
        [stableStringify(['observability', 'traceGraph', { id: 'trace-run-1' }])]: traceGraph,
        [stableStringify(['observability', 'traceNodeDiagnostics', { traceId: 'trace-run-1', nodeId: 'span:tool' }])]: toolDiagnostics,
        [stableStringify(['observability', 'traceNodeDiagnostics', { traceId: 'trace-run-1', nodeId: 'trajectory:trace-run-1:patch.completed' }])]: {
          ...toolDiagnostics,
          nodeId: 'trajectory:trace-run-1:patch.completed',
        },
      },
    });

    await completeSetup(page);
    await page.evaluate(() => {
      window.location.hash = '/observability';
    });
    await expect(page.getByTestId('observability-page')).toBeVisible();

    await page.getByTestId('observability-trace-row').click();
    await expect(page.getByTestId('observability-trace-graph')).toBeVisible();
    await expect(page.getByTestId('trace-graph-node-root')).toContainText('Agent trace workbench');
    await expect(page.getByTestId('trace-graph-node-router')).toContainText('implementer');
    await expect(page.getByTestId('trace-graph-node-model')).toContainText('model.call');
    await expect(page.getByTestId('trace-graph-node-tool')).toContainText('shell_command');
    await expect(page.getByTestId('trace-graph-minimap')).toBeVisible();
    await expect(page.getByTestId('observability-detail-panel')).toContainText('trace-run-1');
    await expect(page.getByTestId('observability-detail-panel')).toContainText('Command failed');
    await expect(page.getByTestId('observability-trace-list')).toContainText('Root cause');

    await page.getByPlaceholder('Search nodes').fill('shell_command');
    await expect(page.getByTestId('trace-graph-node-tool')).toBeVisible();
    await expect(page.getByTestId('trace-graph-node-model')).toHaveCount(0);
    await page.getByPlaceholder('Search nodes').fill('');

    await page.getByRole('tab', { name: 'Events' }).click();
    await expect(page.getByTestId('observability-diagnostics-events')).toContainText('shell_command');
    await page.getByRole('tab', { name: 'Artifacts' }).click();
    await expect(page.getByTestId('observability-diagnostics-artifacts')).toContainText('src/App.tsx');
    await page.getByRole('tab', { name: 'Issues' }).click();
    await expect(page.getByTestId('observability-diagnostics-issues')).toContainText('Root cause');
    await page.getByRole('tab', { name: 'Attributes' }).click();
    await expect(page.getByTestId('observability-diagnostics-attributes')).toContainText('exitCode');

    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.getByTestId('observability-detail-panel')).toContainText('shell_command');
    await expect(page.getByTestId('observability-detail-panel')).toContainText('Command failed');
    await page.getByTestId('observability-detail-panel').getByRole('button', { name: /src\/App\.tsx/ }).click();
    await expect(page.getByTestId('observability-detail-panel')).toContainText('src/App.tsx');
  });
});
