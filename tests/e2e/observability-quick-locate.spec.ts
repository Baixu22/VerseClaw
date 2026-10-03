import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const startedAt = Date.parse('2026-06-27T10:00:00.000Z');

// Multi-turn trace: 6 graph nodes (>3 threshold) → quick-locate panel appears.
const multiTurnTrace = {
  id: 'trace-multi-turn',
  name: 'Multi-turn agent run',
  status: 'completed',
  startedAt,
  durationMs: 4200,
  runId: 'run-multi',
  sessionKey: 'agent:main:multi',
  task: 'Implement multi-turn navigator',
  mode: 'router',
  tokenUsage: { input: 320, output: 180, cacheRead: 0, cacheWrite: 0, totalTokens: 500, costUsd: 0.012 },
  metrics: {},
  tags: [],
  events: [],
  spans: [
    { id: 'router', traceId: 'trace-multi-turn', name: 'role-router', kind: 'role-router', roleName: 'implementer', status: 'completed', startedAt, durationMs: 20 },
    { id: 'turn-1', traceId: 'trace-multi-turn', parentSpanId: 'router', name: 'model.call', kind: 'model', modelRef: 'openai:gpt-5', status: 'completed', startedAt: startedAt + 100, durationMs: 900 },
    { id: 'turn-2', traceId: 'trace-multi-turn', parentSpanId: 'router', name: 'model.call', kind: 'model', modelRef: 'openai:gpt-5', status: 'completed', startedAt: startedAt + 1100, durationMs: 800 },
    { id: 'turn-3', traceId: 'trace-multi-turn', parentSpanId: 'router', name: 'model.call', kind: 'model', modelRef: 'openai:gpt-5', status: 'completed', startedAt: startedAt + 2000, durationMs: 700 },
    { id: 'turn-4', traceId: 'trace-multi-turn', parentSpanId: 'router', name: 'shell_command', kind: 'tool', status: 'completed', startedAt: startedAt + 2800, durationMs: 200 },
  ],
};

const multiTurnGraph = {
  trace: multiTurnTrace,
  graph: {
    traceId: 'trace-multi-turn',
    nodes: [
      { id: 'trace:trace-multi-turn', traceId: 'trace-multi-turn', kind: 'root', label: 'Multi-turn agent run', status: 'completed', phase: 'input', startedAt, durationMs: 4200, sequence: 0, summary: 'Implement multi-turn navigator', critical: true },
      { id: 'span:router', traceId: 'trace-multi-turn', kind: 'router', label: 'implementer', subtitle: 'role-router', status: 'completed', phase: 'routing', startedAt, durationMs: 20, roleName: 'implementer', spanId: 'router', parentId: 'trace:trace-multi-turn', sequence: 1, critical: true },
      { id: 'span:turn-1', traceId: 'trace-multi-turn', kind: 'model', label: 'Plan steps', subtitle: 'model', status: 'completed', phase: 'model', startedAt: startedAt + 100, durationMs: 900, modelRef: 'openai:gpt-5', spanId: 'turn-1', parentId: 'span:router', sequence: 2, tokenUsage: { input: 120, output: 60, cacheRead: 0, cacheWrite: 0, totalTokens: 180, costUsd: 0.005 } },
      { id: 'span:turn-2', traceId: 'trace-multi-turn', kind: 'model', label: 'Write code', subtitle: 'model', status: 'completed', phase: 'model', startedAt: startedAt + 1100, durationMs: 800, modelRef: 'openai:gpt-5', spanId: 'turn-2', parentId: 'span:router', sequence: 3, tokenUsage: { input: 100, output: 70, cacheRead: 0, cacheWrite: 0, totalTokens: 170, costUsd: 0.004 } },
      { id: 'span:turn-3', traceId: 'trace-multi-turn', kind: 'model', label: 'Review output', subtitle: 'model', status: 'completed', phase: 'model', startedAt: startedAt + 2000, durationMs: 700, modelRef: 'openai:gpt-5', spanId: 'turn-3', parentId: 'span:router', sequence: 4, tokenUsage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, costUsd: 0.003 } },
      { id: 'span:turn-4', traceId: 'trace-multi-turn', kind: 'tool', label: 'shell_command', subtitle: 'tool', status: 'completed', phase: 'tool', startedAt: startedAt + 2800, durationMs: 200, spanId: 'turn-4', parentId: 'span:router', sequence: 5 },
    ],
    edges: [
      { id: 'edge:root-router', traceId: 'trace-multi-turn', from: 'trace:trace-multi-turn', to: 'span:router', status: 'completed', kind: 'parent-child', critical: true },
      { id: 'edge:router-1', traceId: 'trace-multi-turn', from: 'span:router', to: 'span:turn-1', status: 'completed', kind: 'parent-child' },
      { id: 'edge:router-2', traceId: 'trace-multi-turn', from: 'span:router', to: 'span:turn-2', status: 'completed', kind: 'parent-child' },
      { id: 'edge:router-3', traceId: 'trace-multi-turn', from: 'span:router', to: 'span:turn-3', status: 'completed', kind: 'parent-child' },
      { id: 'edge:router-4', traceId: 'trace-multi-turn', from: 'span:router', to: 'span:turn-4', status: 'completed', kind: 'parent-child' },
    ],
    summary: {
      criticalPathNodeIds: ['trace:trace-multi-turn', 'span:router'],
      errorNodeIds: [],
      slowNodeIds: ['span:turn-1'],
      tokenHotspotNodeIds: ['span:turn-1'],
      artifactNodeIds: [],
      sourceStatus: 'live',
      staleRunningNodeIds: [],
      coverage: {
        spanCount: 4,
        eventCount: 0,
        trajectoryEventCount: 0,
        graphNodeCount: 6,
        graphEdgeCount: 5,
        hasRuntimeSpans: true,
        hasTrajectory: false,
        redacted: false,
      },
      issues: [],
    },
  },
  timeline: [
    { id: 'timeline-start', traceId: 'trace-multi-turn', nodeId: 'trace:trace-multi-turn', type: 'trace.started', label: 'Multi-turn agent run', timestamp: startedAt, status: 'completed' },
    { id: 'timeline-router', traceId: 'trace-multi-turn', nodeId: 'span:router', spanId: 'router', type: 'span.completed', label: 'implementer', timestamp: startedAt, status: 'completed' },
    { id: 'timeline-turn-1', traceId: 'trace-multi-turn', nodeId: 'span:turn-1', spanId: 'turn-1', type: 'span.completed', label: 'Plan steps', timestamp: startedAt + 100, status: 'completed' },
    { id: 'timeline-turn-2', traceId: 'trace-multi-turn', nodeId: 'span:turn-2', spanId: 'turn-2', type: 'span.completed', label: 'Write code', timestamp: startedAt + 1100, status: 'completed' },
    { id: 'timeline-turn-3', traceId: 'trace-multi-turn', nodeId: 'span:turn-3', spanId: 'turn-3', type: 'span.completed', label: 'Review output', timestamp: startedAt + 2000, status: 'completed' },
    { id: 'timeline-turn-4', traceId: 'trace-multi-turn', nodeId: 'span:turn-4', spanId: 'turn-4', type: 'span.completed', label: 'shell_command', timestamp: startedAt + 2800, status: 'completed' },
  ],
};

const multiTurnIndexEntry = {
  id: 'trace-multi-turn',
  name: 'Multi-turn agent run',
  status: 'completed',
  durationMs: 4200,
  updatedAt: startedAt + 4200,
  sourceStatus: 'live',
  costUsd: 0.012,
  tokenCount: 500,
  spanCount: 4,
  errorCount: 0,
  startedAt,
  sessionKey: 'agent:main:multi',
  runId: 'run-multi',
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
  issueCount: 0,
  firstError: undefined,
  slowestNodeLabel: 'Plan steps',
  issues: [],
  correlation: { traceId: 'trace-multi-turn', runId: 'run-multi', sessionKey: 'agent:main:multi' },
};

// Short trace: only 3 graph nodes (≤3 threshold) → quick-locate panel stays hidden.
const shortTrace = {
  id: 'trace-short',
  name: 'Short agent run',
  status: 'completed',
  startedAt,
  durationMs: 1200,
  runId: 'run-short',
  sessionKey: 'agent:main:short',
  task: 'Quick task',
  mode: 'router',
  tokenUsage: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 70, costUsd: 0.001 },
  metrics: {},
  tags: [],
  events: [],
  spans: [
    { id: 'router', traceId: 'trace-short', name: 'role-router', kind: 'role-router', roleName: 'implementer', status: 'completed', startedAt, durationMs: 20 },
    { id: 'model', traceId: 'trace-short', parentSpanId: 'router', name: 'model.call', kind: 'model', modelRef: 'openai:gpt-5', status: 'completed', startedAt: startedAt + 100, durationMs: 1000 },
  ],
};

const shortGraph = {
  trace: shortTrace,
  graph: {
    traceId: 'trace-short',
    nodes: [
      { id: 'trace:trace-short', traceId: 'trace-short', kind: 'root', label: 'Short agent run', status: 'completed', phase: 'input', startedAt, durationMs: 1200, sequence: 0, summary: 'Quick task', critical: true },
      { id: 'span:router', traceId: 'trace-short', kind: 'router', label: 'implementer', subtitle: 'role-router', status: 'completed', phase: 'routing', startedAt, durationMs: 20, roleName: 'implementer', spanId: 'router', parentId: 'trace:trace-short', sequence: 1, critical: true },
      { id: 'span:model', traceId: 'trace-short', kind: 'model', label: 'model.call', subtitle: 'model', status: 'completed', phase: 'model', startedAt: startedAt + 100, durationMs: 1000, modelRef: 'openai:gpt-5', spanId: 'model', parentId: 'span:router', sequence: 2 },
    ],
    edges: [
      { id: 'edge:root-router', traceId: 'trace-short', from: 'trace:trace-short', to: 'span:router', status: 'completed', kind: 'parent-child', critical: true },
      { id: 'edge:router-model', traceId: 'trace-short', from: 'span:router', to: 'span:model', status: 'completed', kind: 'parent-child' },
    ],
    summary: {
      criticalPathNodeIds: ['trace:trace-short', 'span:router'],
      errorNodeIds: [],
      slowNodeIds: ['span:model'],
      tokenHotspotNodeIds: ['span:model'],
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
        redacted: false,
      },
      issues: [],
    },
  },
  timeline: [
    { id: 'timeline-start', traceId: 'trace-short', nodeId: 'trace:trace-short', type: 'trace.started', label: 'Short agent run', timestamp: startedAt, status: 'completed' },
    { id: 'timeline-router', traceId: 'trace-short', nodeId: 'span:router', spanId: 'router', type: 'span.completed', label: 'implementer', timestamp: startedAt, status: 'completed' },
    { id: 'timeline-model', traceId: 'trace-short', nodeId: 'span:model', spanId: 'model', type: 'span.completed', label: 'model.call', timestamp: startedAt + 100, status: 'completed' },
  ],
};

const shortIndexEntry = {
  id: 'trace-short',
  name: 'Short agent run',
  status: 'completed',
  durationMs: 1200,
  updatedAt: startedAt + 1200,
  sourceStatus: 'live',
  costUsd: 0.001,
  tokenCount: 70,
  spanCount: 2,
  errorCount: 0,
  startedAt,
  sessionKey: 'agent:main:short',
  runId: 'run-short',
  leadRole: 'implementer',
  role: 'implementer',
  agent: 'implementer',
  model: 'openai:gpt-5',
  hasToolCalls: false,
  hasArtifacts: false,
  hasApproval: false,
  hasRetries: false,
  hasWarnings: false,
  toolCallCount: 0,
  artifactCount: 0,
  warningCount: 0,
  retryCount: 0,
  approvalCount: 0,
  issueCount: 0,
  firstError: undefined,
  slowestNodeLabel: 'model.call',
  issues: [],
  correlation: { traceId: 'trace-short', runId: 'run-short', sessionKey: 'agent:main:short' },
};

const traceQueryResult = {
  generatedAt: startedAt + 5000,
  items: [multiTurnIndexEntry, shortIndexEntry],
  total: 2,
  page: 1,
  pageSize: 100,
  facets: {
    status: [{ value: 'completed', count: 2 }],
    agent: [{ value: 'implementer', count: 2 }],
    role: [{ value: 'implementer', count: 2 }],
    model: [{ value: 'openai:gpt-5', count: 2 }],
    sourceStatus: [{ value: 'live', count: 2 }],
  },
};

const turnTwoDiagnostics = {
  traceId: 'trace-multi-turn',
  nodeId: 'span:turn-2',
  summary: 'Assistant produced the code change for the navigator.',
  inputPreview: 'redacted-preview:32',
  outputPreview: 'redacted-preview:48',
  redacted: true,
  events: [
    { id: 'diag-turn-2', traceId: 'trace-multi-turn', nodeId: 'span:turn-2', spanId: 'turn-2', type: 'span.completed', label: 'Write code', timestamp: startedAt + 1100, status: 'completed', summary: 'Code change produced' },
  ],
  artifacts: [],
  attributes: { modelRef: 'openai:gpt-5' },
  sections: [],
};

test.describe('Observability quick-locate navigator', () => {
  test('shows quick-locate panel for multi-turn traces and jumps to a turn', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { running: true, ready: true },
      hostApi: {
        [stableStringify(['observability', 'dashboardSnapshot', null])]: {
          generatedAt: startedAt + 5000,
          cards: [
            { id: 'traces', label: 'Traces', value: 2, tone: 'neutral' },
            { id: 'errors', label: 'Errors', value: 0, tone: 'neutral' },
            { id: 'tools', label: 'Tools', value: 1, tone: 'neutral' },
          ],
          scorecards: [],
          alerts: [],
          traces: [multiTurnIndexEntry, shortIndexEntry],
        },
        [stableStringify(['observability', 'queryTraces', null])]: traceQueryResult,
        [stableStringify(['observability', 'traceGraph', { id: 'trace-multi-turn' }])]: multiTurnGraph,
        [stableStringify(['observability', 'traceGraph', { id: 'trace-short' }])]: shortGraph,
        [stableStringify(['observability', 'traceNodeDiagnostics', { traceId: 'trace-multi-turn', nodeId: 'span:turn-2' }])]: turnTwoDiagnostics,
      },
    });

    await completeSetup(page);
    await page.evaluate(() => {
      window.location.hash = '/observability';
    });
    await expect(page.getByTestId('observability-page')).toBeVisible();

    // Open the multi-turn trace (6 graph nodes → panel should appear).
    await page.getByTestId('observability-trace-row').filter({ hasText: 'Multi-turn agent run' }).click();
    await expect(page.getByTestId('observability-trace-graph')).toBeVisible();
    // Close the auto-selected node before typing into controls behind the drawer.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('observability-detail-panel')).toBeHidden();

    // Quick-locate panel renders all 6 turns.
    const panel = page.getByTestId('observability-quick-locate');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Quick locate');
    await expect(panel.getByText('6')).toBeVisible();
    await expect(panel.getByTestId('observability-quick-locate-row')).toHaveCount(6);
    await expect(panel.getByTestId('observability-quick-locate-row').filter({ hasText: 'Write code' })).toBeVisible();

    // Filter turns by label.
    await page.getByPlaceholder('Filter turns...').fill('Write');
    await expect(panel.getByTestId('observability-quick-locate-row')).toHaveCount(1);
    await expect(panel.getByTestId('observability-quick-locate-row').filter({ hasText: 'Write code' })).toBeVisible();
    await page.getByPlaceholder('Filter turns...').fill('nonexistent');
    await expect(panel.getByTestId('observability-quick-locate-list')).toContainText('No matching turns.');
    await page.getByPlaceholder('Filter turns...').fill('');

    // Auto-selected node opens the drawer; close it so overlay never blocks clicks.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('observability-detail-panel')).toBeHidden();

    // Click "Write code" turn → drawer opens with that turn's content.
    await panel.getByTestId('observability-quick-locate-row').filter({ hasText: 'Write code' }).click();
    await expect(page.getByTestId('observability-detail-panel')).toBeVisible();
    await expect(page.getByTestId('observability-detail-panel')).toContainText('Write code');
    await expect(page.getByTestId('observability-detail-panel')).toContainText('Assistant produced the code change');
    await expect(page.getByTestId('observability-detail-panel')).toContainText('openai:gpt-5');

    // Collapse and re-expand the panel.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('observability-detail-panel')).toBeHidden();
    await page.getByTestId('observability-quick-locate-toggle').click();
    await expect(page.getByPlaceholder('Filter turns...')).toHaveCount(0);
    await page.getByTestId('observability-quick-locate-toggle').click();
    await expect(page.getByPlaceholder('Filter turns...')).toBeVisible();
  });

  test('hides quick-locate panel when the selected trace has three or fewer nodes', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { running: true, ready: true },
      hostApi: {
        [stableStringify(['observability', 'dashboardSnapshot', null])]: {
          generatedAt: startedAt + 5000,
          cards: [
            { id: 'traces', label: 'Traces', value: 2, tone: 'neutral' },
            { id: 'errors', label: 'Errors', value: 0, tone: 'neutral' },
            { id: 'tools', label: 'Tools', value: 1, tone: 'neutral' },
          ],
          scorecards: [],
          alerts: [],
          traces: [multiTurnIndexEntry, shortIndexEntry],
        },
        [stableStringify(['observability', 'queryTraces', null])]: traceQueryResult,
        [stableStringify(['observability', 'traceGraph', { id: 'trace-multi-turn' }])]: multiTurnGraph,
        [stableStringify(['observability', 'traceGraph', { id: 'trace-short' }])]: shortGraph,
      },
    });

    await completeSetup(page);
    await page.evaluate(() => {
      window.location.hash = '/observability';
    });
    await expect(page.getByTestId('observability-page')).toBeVisible();

    // Multi-turn trace shows the panel.
    await page.getByTestId('observability-trace-row').filter({ hasText: 'Multi-turn agent run' }).click();
    await expect(page.getByTestId('observability-trace-graph')).toBeVisible();
    await expect(page.getByTestId('observability-quick-locate')).toBeVisible();

    // Close the auto-opened drawer so its overlay does not intercept the next click.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('observability-detail-panel')).toBeHidden();

    // Switch to the short trace (3 nodes) → panel disappears.
    await page.getByTestId('observability-trace-row').filter({ hasText: 'Short agent run' }).click();
    await expect(page.getByTestId('observability-trace-graph')).toBeVisible();
    await expect(page.getByTestId('observability-quick-locate')).toHaveCount(0);
  });
});
