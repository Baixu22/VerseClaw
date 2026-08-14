// R7-1 T1: the Billing page labels every amount as an estimate with an
// explicit source/boundary note, while the money computation itself stays
// byte-identical to the pre-fix behavior.

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Billing } from '@/pages/Billing/index';

const hostApiFetchMock = vi.fn();

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
      recentTokenHistory: () => hostApiFetchMock(),
      // Aggregate route is exercised but returns nothing, so the page falls
      // back to the client-side totals — which keeps the money math below
      // byte-identical to the pre-aggregate behavior.
      aggregateSummary: () => Promise.resolve(null),
    },
  },
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const LABELS: Record<string, string> = {
  'dashboard:billing.kpi.cost': 'Estimated cost',
  'dashboard:billing.kpi.averageCost': 'Average estimated cost',
  'dashboard:billing.kpi.estimated': 'Estimated from provider usage',
  'dashboard:billing.estimateNote':
    'All amounts are estimates: they are aggregated from usage.estimatedCostUsd in local session transcripts. They are not a bill and do not include billing, refund, or discount semantics.',
  'dashboard:billing.kpi.tokens': 'Total tokens',
  'dashboard:billing.kpi.models': 'Active models',
  'dashboard:billing.kpi.records': '{{count}} records',
  'dashboard:billing.kpi.recordsWithUsage': '{{count}} billable records',
  'dashboard:billing.kpi.activeModels': 'In the selected window',
  'dashboard:billing.kpi.perRecord': 'Per usage record',
  'dashboard:billing.window.7d': '7 days',
  'dashboard:billing.window.30d': '30 days',
  'dashboard:billing.window.all': 'All',
  'dashboard:billing.transcriptSource': 'Transcript history',
  'dashboard:billing.gatewayLive': 'Gateway live',
  'dashboard:billing.gatewayOffline': 'Gateway offline',
  'dashboard:billing.dataQuality.scanned': 'Records scanned',
  'dashboard:billing.dataQuality.billable': 'Billable records',
  'dashboard:billing.dataQuality.unavailable': 'Unavailable records',
  'dashboard:billing.dataQuality.latest': 'Latest record',
  'dashboard:billing.chart.title': 'Daily token usage stays complete',
  'dashboard:billing.chart.description': 'Every day in the selected window has a stable bucket.',
  'dashboard:billing.modelChart.title': 'Model concentration',
  'dashboard:billing.modelChart.description': 'Models are ranked by total tokens.',
  'dashboard:billing.heatmap.title': 'Usage rhythm',
  'dashboard:billing.heatmap.description': 'Each square is a day.',
  'dashboard:billing.heatmap.less': 'Less',
  'dashboard:billing.heatmap.more': 'More',
  'dashboard:billing.recent.title': 'Recent billing records',
  'dashboard:billing.recent.description': 'Raw transcript usage rows.',
  'dashboard:billing.tokensSuffix': 'tokens',
  'dashboard:billing.empty': 'No token usage yet',
  'dashboard:recentTokenHistory.inputShort': 'Input',
  'dashboard:recentTokenHistory.outputShort': 'Output',
  'dashboard:recentTokenHistory.cacheShort': 'Cache',
  'dashboard:recentTokenHistory.input': 'Input {{value}}',
  'dashboard:recentTokenHistory.output': 'Output {{value}}',
  'dashboard:recentTokenHistory.unknownModel': 'Unknown model',
  'dashboard:recentTokenHistory.noUsage': 'No usage',
  'dashboard:recentTokenHistory.usageParseError': 'Usage parse error',
  'dashboard:billing.status.available': 'Available',
  'dashboard:billing.status.missing': 'No usage',
  'dashboard:billing.status.error': 'Parse error',
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

function createUsageEntry(costUsd: number, totalTokens: number) {
  return {
    timestamp: new Date().toISOString(),
    sessionId: 'session-billing-1',
    agentId: 'main',
    model: 'gpt-5',
    provider: 'openai',
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
    usageStatus: 'available' as const,
    costUsd,
  };
}

function formatCurrencyLikeBilling(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1 ? 2 : 5,
  }).format(value);
}

describe('Billing estimate semantics (R7-1 T1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    hostApiFetchMock.mockResolvedValue([createUsageEntry(1.5, 10)]);
  });

  it('labels amounts as estimates with a source/boundary note and keeps the numbers identical', async () => {
    render(<Billing embedded />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Pre-fix red proof: no estimate note exists anywhere on the page.
    const note = screen.getByTestId('billing-estimate-note');
    expect(note).toHaveTextContent('usage.estimatedCostUsd');
    expect(note).toHaveTextContent('not a bill');

    // Estimate labels on the money KPIs (average cost gains the qualifier).
    expect(screen.getByText('Estimated cost')).toBeInTheDocument();
    expect(screen.getByText('Average estimated cost')).toBeInTheDocument();

    // Zero behavior change: the money numbers are computed exactly as before.
    const expectedCost = formatCurrencyLikeBilling(1.5);
    const expectedAverage = formatCurrencyLikeBilling(1.5 / 1);
    expect(screen.getAllByText(expectedCost).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(expectedAverage).length).toBeGreaterThanOrEqual(1);
  });
});
