// R7-2: the Billing page surfaces cache-hit-rate statistics — KPI, daily
// trend, per-model/per-agent tables, and per-record hit rate — driven by the
// new no-cap aggregate route.

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Billing } from '@/pages/Billing/index';

const recentTokenHistoryMock = vi.fn();
const aggregateSummaryMock = vi.fn();

const { gatewayState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789, connectedAt: 1, pid: 1234 },
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    usage: {
      recentTokenHistory: () => recentTokenHistoryMock(),
      aggregateSummary: () => aggregateSummaryMock(),
    },
  },
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const LABELS: Record<string, string> = {
  'dashboard:billing.transcriptSource': 'Transcript history',
  'dashboard:billing.gatewayLive': 'Gateway live',
  'dashboard:billing.gatewayOffline': 'Gateway offline',
  'dashboard:billing.refreshing': 'Refreshing',
  'dashboard:billing.backToModels': 'Back to Models',
  'dashboard:billing.window.30d': '30 days',
  'dashboard:billing.kpi.records': '{{count}} records',
  'dashboard:billing.kpi.tokens': 'Total tokens',
  'dashboard:billing.kpi.recordsWithUsage': '{{count}} billable records',
  'dashboard:billing.kpi.cost': 'Estimated cost',
  'dashboard:billing.kpi.estimated': 'Estimated from provider usage',
  'dashboard:billing.kpi.models': 'Active models',
  'dashboard:billing.kpi.activeModels': 'In the selected window',
  'dashboard:billing.kpi.averageCost': 'Average estimated cost',
  'dashboard:billing.kpi.perRecord': 'Per usage record',
  'dashboard:billing.kpi.cacheHitRate': 'Cache hit rate',
  'dashboard:billing.kpi.hitRateDetail': 'Share of prompt served from cache',
  'dashboard:billing.kpi.cacheReadTokens': 'Cache read tokens',
  'dashboard:billing.kpi.cacheReadDetail': 'Tokens served from cache',
  'dashboard:billing.kpi.cacheWriteTokens': 'Cache write tokens',
  'dashboard:billing.kpi.cacheWriteDetail': 'Tokens written to cache',
  'dashboard:billing.kpi.promptTokens': 'Prompt tokens',
  'dashboard:billing.kpi.promptDetail': 'Input + cache tokens',
  'dashboard:billing.estimateNote': 'All amounts are estimates.',
  'dashboard:billing.aggregateNote': 'Totals aggregate every local transcript ({{files}} files scanned).',
  'dashboard:billing.aggregateNoteFallback': 'Totals are computed from the recent records list only.',
  'dashboard:billing.dataQuality.scanned': 'Records scanned',
  'dashboard:billing.dataQuality.scannedFiles': 'Transcript files',
  'dashboard:billing.dataQuality.billable': 'Billable records',
  'dashboard:billing.dataQuality.unavailable': 'Unavailable records',
  'dashboard:billing.dataQuality.cacheRead': 'Cache read tokens',
  'dashboard:billing.dataQuality.latest': 'Latest record',
  'dashboard:billing.chart.title': 'Daily token usage stays complete',
  'dashboard:billing.chart.description': 'Every day in the selected window has a stable bucket.',
  'dashboard:billing.costChart.title': 'Cost & cache trends',
  'dashboard:billing.costChart.description': 'Daily estimated cost and cache hit rate.',
  'dashboard:billing.noHitRateData': 'No prompt tokens recorded yet.',
  'dashboard:billing.heatmap.title': 'Usage rhythm',
  'dashboard:billing.heatmap.description': 'Each square is a day.',
  'dashboard:billing.heatmap.less': 'Less',
  'dashboard:billing.heatmap.more': 'More',
  'dashboard:billing.modelChart.title': 'Model concentration',
  'dashboard:billing.modelChart.description': 'Models are ranked by total tokens.',
  'dashboard:billing.tableSection.title': 'Breakdown',
  'dashboard:billing.tableSection.description': 'Per-model and per-agent aggregates.',
  'dashboard:billing.modelTable.title': 'By model',
  'dashboard:billing.agentTable.title': 'By agent',
  'dashboard:billing.table.name': 'Name',
  'dashboard:billing.table.records': 'Records',
  'dashboard:billing.table.tokens': 'Tokens',
  'dashboard:billing.table.input': 'Input',
  'dashboard:billing.table.output': 'Output',
  'dashboard:billing.table.cacheRead': 'Cache read',
  'dashboard:billing.table.hitRate': 'Hit rate',
  'dashboard:billing.table.cost': 'Est. cost',
  'dashboard:billing.recent.title': 'Recent billing records',
  'dashboard:billing.recent.description': 'Raw transcript usage rows.',
  'dashboard:billing.recent.cacheHit': 'Cache hit {{value}}',
  'dashboard:billing.tokensSuffix': 'tokens',
  'dashboard:billing.empty': 'No token usage yet',
  'dashboard:billing.status.available': 'Available',
  'dashboard:recentTokenHistory.inputShort': 'Input',
  'dashboard:recentTokenHistory.outputShort': 'Output',
  'dashboard:recentTokenHistory.cacheShort': 'Cache',
  'dashboard:recentTokenHistory.input': 'Input {{value}}',
  'dashboard:recentTokenHistory.output': 'Output {{value}}',
  'dashboard:recentTokenHistory.unknownModel': 'Unknown model',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const label = LABELS[key];
      if (!label) return key;
      if (!values) return label;
      return label.replace(/\{\{[^}]+\}\}/g, (token) => String(values[token.slice(2, -2).trim()] ?? token));
    },
    i18n: { language: 'en' },
  }),
}));

function createUsageEntry(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: new Date().toISOString(),
    sessionId: 'session-cache-1',
    agentId: 'main',
    model: 'gpt-5',
    provider: 'openai',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 100,
    cacheWriteTokens: 0,
    totalTokens: 250,
    usageStatus: 'available' as const,
    costUsd: 0.05,
    ...overrides,
  };
}

function createAggregateSummary() {
  return {
    window: '30d' as const,
    generatedAt: Date.now(),
    scannedFiles: 3,
    scannedEntries: 2,
    entriesInWindow: 2,
    billableEntries: 2,
    missingEntries: 0,
    errorEntries: 0,
    inputTokens: 200,
    outputTokens: 100,
    cacheReadTokens: 125,
    cacheWriteTokens: 10,
    totalTokens: 435,
    costUsd: 0.07,
    promptTokens: 335,
    cacheHitRate: 125 / 335,
    earliestTimestamp: new Date().toISOString(),
    latestTimestamp: new Date().toISOString(),
    days: [{
      date: new Date().toISOString().slice(0, 10),
      key: new Date().toISOString().slice(0, 10),
      label: new Date().toISOString().slice(0, 10),
      records: 2,
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 125,
      cacheWriteTokens: 10,
      totalTokens: 435,
      costUsd: 0.07,
      promptTokens: 335,
      cacheHitRate: 125 / 335,
    }],
    models: [{
      key: 'gpt-5',
      label: 'gpt-5',
      records: 2,
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 125,
      cacheWriteTokens: 10,
      totalTokens: 435,
      costUsd: 0.07,
      promptTokens: 335,
      cacheHitRate: 125 / 335,
    }],
    agents: [{
      key: 'main',
      label: 'main',
      records: 2,
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 125,
      cacheWriteTokens: 10,
      totalTokens: 435,
      costUsd: 0.07,
      promptTokens: 335,
      cacheHitRate: 125 / 335,
    }],
  };
}

describe('Billing cache-hit-rate statistics (R7-2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    recentTokenHistoryMock.mockResolvedValue([
      createUsageEntry(),
      createUsageEntry({ sessionId: 'session-cache-2', cacheReadTokens: 25, cacheWriteTokens: 10, totalTokens: 185, costUsd: 0.02 }),
    ]);
    aggregateSummaryMock.mockResolvedValue(createAggregateSummary());
  });

  it('renders hit-rate KPIs, trends, and per-model/per-agent tables from the aggregate', async () => {
    render(<Billing embedded />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('billing-kpi-hit-rate')).toHaveTextContent('%');
    expect(screen.getByTestId('billing-kpi-cache-read')).toBeInTheDocument();
    expect(screen.getByTestId('billing-kpi-cache-write')).toBeInTheDocument();
    expect(screen.getByTestId('billing-kpi-prompt')).toBeInTheDocument();

    expect(screen.getByTestId('billing-cost-chart')).toBeInTheDocument();
    expect(screen.getByTestId('billing-hit-rate-chart')).toBeInTheDocument();

    expect(screen.getByTestId('billing-model-table')).toHaveTextContent('gpt-5');
    expect(screen.getByTestId('billing-model-table')).toHaveTextContent('Hit rate');
    expect(screen.getByTestId('billing-agent-table')).toHaveTextContent('main');

    expect(screen.getByTestId('billing-recent-list')).toHaveTextContent('Cache hit');
    expect(screen.getByTestId('billing-aggregate-note')).toHaveTextContent('3');
    expect(screen.getByTestId('billing-data-quality')).toHaveTextContent('Transcript files');
  });

  it('falls back to client-side rows when the aggregate route returns nothing', async () => {
    aggregateSummaryMock.mockResolvedValue(null);

    render(<Billing embedded />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('billing-aggregate-note')).toHaveTextContent('recent records list only');
    expect(screen.getByTestId('billing-model-table')).toHaveTextContent('gpt-5');
    expect(screen.getByTestId('billing-recent-list')).toHaveTextContent('Cache hit');
  });
});
