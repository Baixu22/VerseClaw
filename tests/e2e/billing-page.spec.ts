import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function usageTimestamp(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function usageDayKey(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const usageHistory = [
  {
    timestamp: usageTimestamp(0),
    sessionId: 'billing-session-missing',
    agentId: 'main',
    model: 'e2e-model-pending',
    provider: 'e2e',
    usageStatus: 'missing',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    attributionStatus: 'unknown',
  },
  {
    timestamp: usageTimestamp(1),
    sessionId: 'billing-session-a',
    agentId: 'main',
    model: 'e2e-model-pro',
    provider: 'e2e',
    usageStatus: 'available',
    inputTokens: 1800,
    outputTokens: 760,
    cacheReadTokens: 240,
    cacheWriteTokens: 100,
    totalTokens: 2900,
    costUsd: 0.0312,
    executionStatus: 'failed',
    retryKind: 'retry',
    attributionStatus: 'known',
    runId: 'run-billing-retry',
    attemptIndex: 0,
    modelCallIndex: 0,
    wireAttemptIndex: 1,
    correlationDigest: 'a'.repeat(64),
  },
  {
    timestamp: usageTimestamp(6),
    sessionId: 'billing-session-b',
    agentId: 'main',
    model: 'e2e-model-lite',
    provider: 'e2e',
    usageStatus: 'available',
    inputTokens: 820,
    outputTokens: 360,
    cacheReadTokens: 90,
    cacheWriteTokens: 30,
    totalTokens: 1300,
    costUsd: 0.0084,
  },
  {
    timestamp: usageTimestamp(17),
    sessionId: 'billing-session-c',
    agentId: 'main',
    model: 'e2e-model-pro',
    provider: 'e2e',
    usageStatus: 'available',
    inputTokens: 1200,
    outputTokens: 620,
    cacheReadTokens: 120,
    cacheWriteTokens: 60,
    totalTokens: 2000,
    costUsd: 0.022,
  },
];

function aggregateDimension(record: (typeof usageHistory)[number] & { costUsd?: number }) {
  const promptTokens = record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens;
  return {
    key: record.model,
    label: record.model,
    records: 1,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    totalTokens: record.totalTokens,
    costUsd: record.costUsd ?? 0,
    promptTokens,
    cacheHitRate: promptTokens > 0 ? record.cacheReadTokens / promptTokens : null,
  };
}

function buildAggregateSummary() {
  const billable = usageHistory.filter((record) => record.usageStatus === 'available');
  const totals = billable.reduce(
    (sum, record) => ({
      inputTokens: sum.inputTokens + record.inputTokens,
      outputTokens: sum.outputTokens + record.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + record.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + record.cacheWriteTokens,
      totalTokens: sum.totalTokens + record.totalTokens,
      costUsd: sum.costUsd + (record.costUsd ?? 0),
      promptTokens: sum.promptTokens + record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: 0, promptTokens: 0 },
  );

  return {
    window: '30d',
    generatedAt: Date.now(),
    scannedFiles: 4,
    scannedEntries: 4,
    entriesInWindow: 4,
    billableEntries: 3,
    missingEntries: 1,
    errorEntries: 0,
    ...totals,
    cacheHitRate: totals.promptTokens > 0 ? totals.cacheReadTokens / totals.promptTokens : null,
    earliestTimestamp: usageHistory[3].timestamp,
    latestTimestamp: usageHistory[0].timestamp,
    days: billable.map((record) => ({
      ...aggregateDimension(record),
      date: usageDayKey(record.timestamp),
    })),
    models: [
      (() => {
        const proRecords = billable.filter((record) => record.model === 'e2e-model-pro');
        const dimension = proRecords.map((record) => aggregateDimension(record));
        const merged = dimension.reduce(
          (sum, item) => ({
            ...sum,
            records: sum.records + item.records,
            inputTokens: sum.inputTokens + item.inputTokens,
            outputTokens: sum.outputTokens + item.outputTokens,
            cacheReadTokens: sum.cacheReadTokens + item.cacheReadTokens,
            cacheWriteTokens: sum.cacheWriteTokens + item.cacheWriteTokens,
            totalTokens: sum.totalTokens + item.totalTokens,
            costUsd: sum.costUsd + item.costUsd,
            promptTokens: sum.promptTokens + item.promptTokens,
          }),
          { ...dimension[0], records: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: 0, promptTokens: 0 },
        );
        return { ...merged, cacheHitRate: merged.promptTokens > 0 ? merged.cacheReadTokens / merged.promptTokens : null };
      })(),
      aggregateDimension(billable.find((record) => record.model === 'e2e-model-lite')!),
    ],
    agents: [
      (() => {
        const dimensions = billable.map((record) => aggregateDimension(record));
        const merged = dimensions.reduce(
          (sum, item) => ({
            ...sum,
            records: sum.records + item.records,
            inputTokens: sum.inputTokens + item.inputTokens,
            outputTokens: sum.outputTokens + item.outputTokens,
            cacheReadTokens: sum.cacheReadTokens + item.cacheReadTokens,
            cacheWriteTokens: sum.cacheWriteTokens + item.cacheWriteTokens,
            totalTokens: sum.totalTokens + item.totalTokens,
            costUsd: sum.costUsd + item.costUsd,
            promptTokens: sum.promptTokens + item.promptTokens,
          }),
          { ...dimensions[0], key: 'main', label: 'main', records: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: 0, promptTokens: 0 },
        );
        return { ...merged, cacheHitRate: merged.promptTokens > 0 ? merged.cacheReadTokens / merged.promptTokens : null };
      })(),
    ],
  };
}

function buildEmptyAggregateSummary() {
  return {
    window: '30d',
    generatedAt: Date.now(),
    scannedFiles: 0,
    scannedEntries: 0,
    entriesInWindow: 0,
    billableEntries: 0,
    missingEntries: 0,
    errorEntries: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    promptTokens: 0,
    cacheHitRate: null,
    earliestTimestamp: null,
    latestTimestamp: null,
    days: [],
    models: [],
    agents: [],
  };
}

async function openBillingSettingsPage(page: Awaited<ReturnType<typeof getStableWindow>>) {
  await page.evaluate(() => {
    window.location.hash = '#/settings/billing';
  });
  await expect(page).toHaveURL(/#\/settings\/billing/);
}



test('shows no-data guidance when billing history is empty', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });

  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      hostApi: {
        [stableStringify(['usage', 'recentTokenHistory', { limit: 800 }])]: [],
        [stableStringify(['usage', 'aggregateSummary', { window: '30d' }])]: buildEmptyAggregateSummary(),
      },
    });

    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible();

    await openBillingSettingsPage(page);
    await expect(page.getByTestId('billing-page')).toBeVisible();
    await expect(page.getByTestId('billing-page-title')).toBeVisible();
    await expect(page.getByTestId('billing-empty')).toBeVisible();
    await expect(page.getByTestId('billing-empty')).toContainText('No usage data yet');

    await expect(page.getByTestId('billing-window-controls')).toBeVisible();
    await expect(page.getByTestId('billing-data-quality')).not.toBeVisible();
    await expect(page.getByTestId('billing-token-chart')).not.toBeVisible();
  } finally {
    await closeElectronApp(app);
  }
});

test.describe('Billing page', () => {
  test('renders a dedicated token billing page with complete charts', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [] },
          },
        },
        hostApi: {
          [stableStringify(['usage', 'recentTokenHistory', { limit: 800 }])]: usageHistory,
          [stableStringify(['usage', 'aggregateSummary', { window: '30d' }])]: buildAggregateSummary(),
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openBillingSettingsPage(page);
      await expect(page.getByTestId('billing-page')).toBeVisible();
      await expect(page.getByTestId('billing-page-title')).toBeVisible();
      await expect(page.getByTestId('billing-page-title')).toHaveCount(1);
      await expect(page.getByTestId('billing-back-to-models')).toBeVisible();
      await expect(page.getByTestId('billing-window-controls')).toBeVisible();
      await expect(page.getByTestId('billing-data-quality')).toBeVisible();
      await expect(page.getByTestId('billing-data-quality')).toContainText('Billable records');
      await expect(page.getByTestId('billing-data-quality')).toContainText('Transcript files');

      await expect(page.getByTestId('billing-token-chart')).toBeVisible();
      await expect(page.getByTestId('billing-token-chart').locator('svg')).toBeVisible();
      await expect(page.getByTestId('billing-usage-heatmap')).toBeVisible();
      expect(await page.getByTestId('billing-usage-heatmap-day').count()).toBeGreaterThanOrEqual(30);
      await expect(page.getByTestId('billing-usage-heatmap-day').first()).toHaveCSS('border-radius', '2px');
      await page.setViewportSize({ width: 800, height: 760 });
      await expect(page.getByTestId('billing-usage-heatmap-day').first()).toHaveCSS('width', '12px');
      await expect(page.getByTestId('billing-usage-heatmap-day').first()).toHaveCSS('height', '12px');
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(page.getByTestId('billing-usage-heatmap-day').first()).toHaveCSS('width', '13px');
      await expect(page.getByTestId('billing-usage-heatmap-day').first()).toHaveCSS('height', '13px');
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      await expect(page.getByTestId('billing-usage-heatmap')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(page.getByTestId('billing-usage-heatmap-day').first()).toHaveCSS('background-color', 'rgb(235, 237, 240)');
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await expect(page.getByTestId('billing-usage-heatmap')).toHaveCSS('background-color', 'rgb(13, 17, 23)');
      await expect(page.getByTestId('billing-usage-heatmap-day').first()).toHaveCSS('background-color', 'rgb(22, 27, 34)');
      const actualUsageDate = usageDayKey(usageHistory[1].timestamp);
      const actualUsageCell = page.locator(`[data-billing-usage-date="${actualUsageDate}"]`);
      await expect(actualUsageCell).toHaveAttribute('data-billing-usage-tokens', '2900');
      await expect(actualUsageCell).toHaveAttribute('data-billing-usage-records', '1');
      await expect(actualUsageCell).toHaveAttribute('title', /2,900/);
      await expect(actualUsageCell).not.toHaveCSS('background-color', 'rgb(22, 27, 34)');
      await expect(page.getByTestId('billing-model-chart')).toContainText('e2e-model-pro');
      await expect(page.getByTestId('billing-model-chart')).not.toContainText('e2e-model-pending');
      await expect(page.getByTestId('billing-recent-list')).toContainText('billing-session-a');
      await expect(page.getByTestId('billing-recent-list')).toContainText('No usage');
      await expect(page.getByTestId('billing-execution-status').first()).toContainText('Failed');
      await expect(page.getByTestId('billing-retry-status').first()).toContainText('Retry');
      await expect(page.getByTestId('billing-attribution-status').first()).toContainText('Cost attribution unknown');

      await expect(page.getByTestId('billing-kpi-hit-rate')).toBeVisible();
      await expect(page.getByTestId('billing-cost-chart')).toBeVisible();
      await expect(page.getByTestId('billing-cost-chart').locator('svg')).toBeVisible();
      await expect(page.getByTestId('billing-hit-rate-chart')).toBeVisible();
      await expect(page.getByTestId('billing-hit-rate-chart').locator('svg')).toBeVisible();
      await expect(page.getByTestId('billing-model-table')).toContainText('e2e-model-pro');
      await expect(page.getByTestId('billing-model-table')).not.toContainText('e2e-model-pending');
      await expect(page.getByTestId('billing-agent-table')).toContainText('main');
      await expect(page.getByTestId('billing-aggregate-note')).toContainText('4');
      await expect(page.getByTestId('billing-recent-list')).toContainText('Cache hit');

      await page.getByTestId('billing-back-to-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps transcript-backed billing history visible when gateway is offline', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'stopped' },
        hostApi: {
          [stableStringify(['usage', 'recentTokenHistory', { limit: 800 }])]: usageHistory,
          [stableStringify(['usage', 'aggregateSummary', { window: '30d' }])]: buildAggregateSummary(),
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openBillingSettingsPage(page);
      await expect(page.getByTestId('billing-page')).toBeVisible();
      await expect(page.getByTestId('billing-token-chart').locator('svg')).toBeVisible();
      await expect(page.getByTestId('billing-hit-rate-chart').locator('svg')).toBeVisible();
      await expect(page.getByTestId('billing-model-chart')).toContainText('e2e-model-pro');
      await expect(page.getByText('Gateway offline')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
