import { closeElectronApp, getStableWindow, pinWindowContentSize, completeSetup, expect, installIpcMocks, test } from './fixtures/electron';
import type { Page } from '@playwright/test';

async function chooseDetailTab(page: Page, name: string) {
  const drawer = page.getByTestId('observability-detail-panel');
  await drawer.getByRole('combobox', { name: 'All tabs' }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(drawer.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
}

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
        id: 'event:heartbeat',
        traceId: 'trace-run-1',
        kind: 'event',
        label: 'runtime.tick',
        subtitle: 'runtime event',
        status: 'completed',
        phase: 'event',
        startedAt: startedAt + 500,
        parentId: 'span:router',
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
      { id: 'edge:router-event', traceId: 'trace-run-1', from: 'span:router', to: 'event:heartbeat', status: 'completed', kind: 'causal' },
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
        eventCount: 1,
        trajectoryEventCount: 1,
        graphNodeCount: 6,
        graphEdgeCount: 5,
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
    { id: 'timeline-event', traceId: 'trace-run-1', nodeId: 'event:heartbeat', type: 'runtime.event', label: 'runtime.tick', timestamp: startedAt + 500, status: 'completed', summary: 'low signal event' },
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

const compareTraceIndexEntry = {
  ...traceIndexEntry,
  id: 'trace-run-2',
  name: 'Agent trace baseline',
  status: 'completed',
  durationMs: 1800,
  updatedAt: startedAt + 1800,
  costUsd: 0.001,
  tokenCount: 90,
  errorCount: 0,
  artifactCount: 0,
  warningCount: 0,
  retryCount: 0,
  approvalCount: 0,
  issueCount: 0,
  firstError: undefined,
  issues: [],
  correlation: {
    traceId: 'trace-run-2',
    runId: 'run-2',
    sessionKey: 'agent:main:baseline',
  },
};

const traceQueryResult = {
  generatedAt: startedAt + 5000,
  items: [traceIndexEntry, compareTraceIndexEntry],
  total: 2,
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
  test('renders graph, details, and timeline from traceGraph host API', async ({ electronApp, page }, info) => {
    test.setTimeout(180000);
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
          sourceHealth: {
            runtime: { status: 'ok', reason: 'available' },
            index: { status: 'ok', reason: 'available' },
            trajectory: { status: 'ok', reason: 'available' },
          },
          traces: [
            { ...traceIndexEntry },
            { ...compareTraceIndexEntry },
          ],
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
    const steps = page.getByTestId('observability-steps');
    await expect(steps).toBeVisible();
    await expect(page.getByTestId('observability-detail-panel')).toBeHidden();
    await expect(steps.getByRole('button', { name: /openai:gpt-5/ })).toBeVisible();
    await expect(steps.getByRole('button', { name: /shell_command/ })).toContainText('Command failed');
    await expect(steps.getByText('runtime.tick')).toHaveCount(0);
    await steps.getByRole('button', { name: /Show other events/ }).click();
    await expect(steps.getByText('runtime.tick')).toBeVisible();
    await steps.getByRole('button', { name: /Hide other events/ }).click();
    await expect(page.getByTestId('observability-primary-metrics')).toHaveCount(0);
    await expect(page.getByTestId('observability-secondary-metrics')).toHaveCount(0);
    await page.getByTestId('observability-metrics-toggle').click();
    await expect(page.getByTestId('observability-primary-metrics')).toBeVisible();
    await expect(page.getByTestId('observability-secondary-metrics')).toBeVisible();

    await page.getByTestId('observability-metrics-toggle').click();
    await page.getByTestId('observability-advanced-filter-toggle').click();
    await expect(page.getByTestId('observability-saved-view')).toBeVisible();
    await page.getByTestId('observability-advanced-filter-toggle').click();
    await steps.getByRole('button', { name: /shell_command/ }).click();
    await expect(page.getByTestId('observability-detail-panel')).toContainText('Command failed');
    await page.keyboard.press('Escape');
    const details = page.getByTestId('observability-summary-header').locator('details');
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details.getByText('150', { exact: true })).toBeVisible();
    await details.locator('summary').click();
    await page.screenshot({ path: info.outputPath('execution-steps.png') });
    await page.getByTestId('observability-view-graph').click();
    await expect(page.getByTestId('observability-trace-graph')).toBeVisible();
    await expect(page.getByTestId('observability-summary-header')).toContainText('Root cause');
    await expect(page.getByTestId('observability-summary-header')).toContainText('150');
    await expect(page.getByTestId('trace-graph-node-root')).toContainText('Agent trace workbench');
    await expect(page.getByTestId('trace-graph-node-router')).toContainText('implementer');
    await expect(page.getByTestId('trace-graph-node-model')).toContainText('model.call');
    await expect(page.getByTestId('trace-graph-node-tool')).toContainText('shell_command');
    await expect(page.getByTestId('trace-graph-node-event')).toHaveCount(0);
    await expect(page.getByTestId('observability-trace-graph')).toContainText('5/6');
    await expect(page.getByTestId('observability-detail-panel')).toBeHidden();
    await page.getByTestId('trace-graph-filter-toggle').click();
    await page.getByTestId('trace-graph-density-full').click();
    await expect(page.getByTestId('trace-graph-node-event')).toContainText('runtime.tick');
    await expect(page.getByTestId('observability-trace-graph')).toContainText('6/6');
    await expect(page.getByTestId('trace-graph-minimap')).toHaveCount(0);
    await page.getByTestId('trace-graph-minimap-toggle').click();
    await expect(page.getByTestId('trace-graph-minimap')).toBeVisible();
    // Node may be obscured by minimap; dispatch a native click via evaluate
    await page.getByTestId('trace-graph-node-tool').dispatchEvent('click');
    await expect(page.getByTestId('observability-detail-panel')).toBeVisible();
    await expect(page.getByTestId('observability-detail-panel')).toContainText('shell_command');
    await expect(page.getByTestId('observability-detail-panel')).toContainText('Command failed');
    await expect(page.getByTestId('observability-trace-list')).toContainText('Command failed');

    // Close drawer before switching view modes (overlay blocks toolbar)
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('observability-detail-panel')).toBeHidden();
    await page.getByTestId('observability-view-tree').click();
    await expect(page.getByTestId('observability-run-tree')).toContainText('shell_command');
    await page.getByTestId('observability-view-swimlane').click();
    await expect(page.getByTestId('observability-swimlane')).toContainText('model.call');
    await page.getByTestId('observability-view-graph').click();

    await page.getByPlaceholder('Search nodes').fill('shell_command');
    await expect(page.getByTestId('trace-graph-node-tool')).toBeVisible();
    await expect(page.getByTestId('trace-graph-node-model')).toHaveCount(0);
    await page.getByPlaceholder('Search nodes').fill('');

    // Reopen drawer to test tab navigation
    await page.getByTestId('trace-graph-node-tool').dispatchEvent('click');
    await expect(page.getByTestId('observability-detail-panel')).toBeVisible();
    await page.getByRole('tab', { name: 'Events' }).click();
    await expect(page.getByTestId('observability-diagnostics-events')).toContainText('shell_command');
    await chooseDetailTab(page, 'Artifacts');
    await expect(page.getByTestId('observability-diagnostics-artifacts')).toContainText('src/App.tsx');
    await chooseDetailTab(page, 'Compare');
    await expect(page.getByTestId('observability-compare-panel')).toContainText('Trace compare');
    await page.getByTestId('observability-compare-panel').getByRole('combobox').click();
    await page.getByRole('option', { name: 'Agent trace baseline' }).click();
    await expect(page.getByTestId('observability-compare-panel')).toContainText('$0.00100');
    await chooseDetailTab(page, 'Notes');
    await page.getByPlaceholder('Add a short diagnosis or follow-up...').fill('Needs command exit-code triage');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByTestId('observability-trace-list')).toContainText('Open');
    await page.getByRole('tab', { name: 'Issues' }).click();
    await expect(page.getByTestId('observability-diagnostics-issues')).toContainText('Root cause');
    await chooseDetailTab(page, 'Attributes');
    await expect(page.getByTestId('observability-diagnostics-attributes')).toContainText('exitCode');

    await chooseDetailTab(page, 'Timeline');
    await expect(page.getByTestId('observability-detail-panel')).toContainText('shell_command');
    await expect(page.getByTestId('observability-detail-panel')).toContainText('Command failed');
    await page.getByTestId('observability-detail-panel').getByRole('button', { name: /src\/App\.tsx/ }).click();
    await expect(page.getByTestId('observability-detail-panel')).toContainText('src/App.tsx');
  });

  test('reads a run from the existing Chinese menu and switches runs in a narrow window', async ({ launchElectronApp }, info) => {
    test.setTimeout(180000);
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark' });
    try {
      const baseline = { ...trace, id: compareTraceIndexEntry.id, name: compareTraceIndexEntry.name, spans: [], events: [], status: 'completed' };
      const reasoning = { id: 'thought', traceId: trace.id, kind: 'event', phase: 'event', label: 'reasoning.summary',
        subtitle: 'custom', summary: '先核对配置，再运行检查。', startedAt: startedAt + 50, status: 'completed' };
      const withReasoning = { ...traceGraph, graph: { ...traceGraph.graph, nodes: [...traceGraph.graph.nodes, reasoning] } };
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
        hostApi: {
          [stableStringify(['observability', 'dashboardSnapshot', null])]: {
            generatedAt: startedAt, cards: [], alerts: [], scorecards: [], traces: [traceIndexEntry, compareTraceIndexEntry],
          },
          [stableStringify(['observability', 'queryTraces', null])]: traceQueryResult,
          [stableStringify(['observability', 'traceGraph', { id: trace.id }])]: withReasoning,
          [stableStringify(['observability', 'traceGraph', { id: baseline.id }])]: {
            trace: baseline, graph: { traceId: baseline.id, nodes: [], edges: [] }, timeline: [],
          },
          [stableStringify(['observability', 'traceNodeDiagnostics', { traceId: trace.id, nodeId: 'span:tool' }])]: toolDiagnostics,
        },
      });
      const page = await getStableWindow(app);
      await page.evaluate(() => window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: 'settings', action: 'set', payload: { key: 'language', value: 'zh' } }));
      await page.reload();
      await page.getByTestId('sidebar-footer-menu-trigger').click();
      await page.getByRole('menuitem', { name: '可观测性', exact: true }).click();
      const steps = page.getByTestId('observability-steps');
      await expect(steps.getByText('shell_command')).toBeVisible();
      await expect(steps.getByRole('button', { name: /思考记录/ })).toContainText(reasoning.summary);
      const order = await steps.locator('li').allTextContents();
      expect(order.findIndex(row => row.includes(reasoning.summary))).toBeLessThan(order.findIndex(row => row.includes('openai:gpt-5')));
      await expect(page.getByTestId('observability-detail-panel')).toBeHidden();
      const views = page.getByTestId('observability-view-modes');
      await views.getByRole('tab', { name: '执行过程' }).press('ArrowRight');
      await expect(page.getByRole('tabpanel', { name: '图谱' })).toBeVisible();
      await page.keyboard.press('End');
      await expect(views.getByRole('tab', { name: '泳道' })).toBeFocused();
      await page.keyboard.press('Home');
      await expect(views.getByRole('tab', { name: '执行过程' })).toHaveAttribute('aria-selected', 'true');
      await page.screenshot({ path: info.outputPath('observability-zh-desktop.png') });
      await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.setMinimumSize(360, 560); });
      await pinWindowContentSize(app, { width: 600, height: 760 });
      const choose = page.getByRole('button', { name: '切换运行', exact: true });
      await expect(choose).toBeVisible();
      await expect(page.getByTestId('observability-trace-list')).toBeHidden();
      await expect(steps.getByRole('button', { name: /shell_command/ })).toBeInViewport();
      expect(await page.getByTestId('observability-page').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath('observability-zh-narrow.png') });
      await choose.click();
      await page.getByTestId('observability-trace-row').filter({ hasText: baseline.name }).click();
      await expect(steps.getByText('这次运行还没有步骤记录。')).toBeVisible();
      await expect(steps.getByText('shell_command')).toHaveCount(0);
      await page.evaluate(() => { window.location.hash = '/observability?traceId=trace-run-1&nodeId=span%3Atool'; });
      await expect(page.getByTestId('observability-detail-panel')).toContainText('Command failed');
      await page.getByRole('combobox', { name: '全部标签' }).click();
      await page.getByRole('option', { name: '时间线', exact: true }).click();
      await expect(page.getByRole('tab', { name: '时间线' })).toBeFocused();
      await page.getByTestId('observability-detail-panel').screenshot({ path: info.outputPath('detail-tabs-zh.png'), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(steps.getByText('shell_command')).toBeVisible();
      await page.evaluate(() => window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: 'settings', action: 'set', payload: { key: 'language', value: 'ru' } }));
      await page.reload();
      await pinWindowContentSize(app, { width: 420, height: 760 });
      await views.getByRole('tab', { name: 'Ход выполнения' }).press('End');
      const lastView = page.getByTestId('observability-view-swimlane');
      await expect(lastView).toBeFocused();
      await expect(lastView).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => lastView.evaluate(el => {
        const bounds = el.closest('[role="tablist"]')!.getBoundingClientRect();
        const tab = el.getBoundingClientRect();
        return tab.right <= bounds.right + 1 && tab.left >= bounds.left - 1;
      })).toBe(true);
      await page.screenshot({ path: info.outputPath('view-tabs-ru-narrow.png'), animations: 'disabled' });
      await page.evaluate(() => { window.location.hash = '/observability?traceId=trace-run-1&nodeId=span%3Atool'; });
      const detail = page.getByTestId('observability-detail-panel');
      await expect(detail).toBeVisible();
      await detail.getByRole('combobox', { name: 'Все вкладки' }).click();
      await page.getByRole('option', { name: 'Атрибуты', exact: true }).click();
      const selectedTab = detail.getByRole('tab', { name: 'Атрибуты', exact: true });
      await expect(selectedTab).toBeFocused();
      await expect.poll(() => selectedTab.evaluate(el => {
        const list = el.closest('[role="tablist"]')!.getBoundingClientRect();
        const tab = el.getBoundingClientRect();
        return tab.right <= list.right + 1 && tab.left >= list.left - 1;
      })).toBe(true);
      const tops = await detail.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.getBoundingClientRect().top));
      expect(new Set(tops).size).toBe(1);
      await expect(detail.getByRole('heading', { name: 'shell_command', exact: true }).last()).toBeInViewport();
      expect(await detail.evaluate(el => [...el.querySelectorAll('div, aside')].filter(child =>
        !child.matches('[role="tablist"]') && !child.closest('[role="tablist"]')).every(child => child.scrollLeft === 0))).toBe(true);
      await detail.screenshot({ path: info.outputPath('detail-tabs-ru-narrow.png'), animations: 'disabled' });
    } finally { await closeElectronApp(app); }
  });

  test('shows each source health and diagnostic reason when no trace is available', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { running: true, ready: true },
      hostApi: {
        [stableStringify(['observability', 'dashboardSnapshot', null])]: {
          generatedAt: startedAt + 5000,
          cards: [{ id: 'traces', label: 'Traces', value: 0, tone: 'neutral' }],
          scorecards: [],
          alerts: [],
          traces: [],
          sourceHealth: {
            runtime: { status: 'error', reason: 'failed', detail: 'Gateway trace RPC unavailable' },
            index: { status: 'empty', reason: 'no-data' },
            trajectory: { status: 'ok', reason: 'available' },
          },
        },
        [stableStringify(['observability', 'queryTraces', null])]: {
          generatedAt: startedAt + 5000,
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
          facets: { status: [], agent: [], role: [], model: [], sourceStatus: [] },
        },
      },
    });

    await completeSetup(page);
    await page.evaluate(() => {
      window.location.hash = '/observability';
    });

    await expect(page.getByTestId('observability-source-health')).toBeVisible();
    await page.getByTestId('observability-source-health').locator('summary').click();
    await expect(page.getByTestId('observability-source-health-runtime')).toContainText('Runtime trace feed');
    await expect(page.getByTestId('observability-source-health-runtime')).toContainText('Unavailable');
    await expect(page.getByTestId('observability-source-health-runtime')).toContainText('Gateway trace RPC unavailable');
    await expect(page.getByTestId('observability-source-health-index')).toContainText('No data');
    await expect(page.getByTestId('observability-source-health-trajectory')).toContainText('Available');
  });
});
