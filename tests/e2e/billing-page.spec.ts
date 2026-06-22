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



test('shows no-data guidance when billing history is empty', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });

  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      hostApi: {
        [stableStringify(['usage', 'recentTokenHistory', { limit: 800 }])]: [],
      },
    });

    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible();

    await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-billing').click();
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
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-billing').click();
      await expect(page.getByTestId('billing-page')).toBeVisible();
      await expect(page.getByTestId('billing-page-title')).toBeVisible();
      await expect(page.getByTestId('billing-back-to-models')).toBeVisible();
      await expect(page.getByTestId('billing-window-controls')).toBeVisible();
      await expect(page.getByTestId('billing-data-quality')).toBeVisible();
      await expect(page.getByTestId('billing-data-quality')).toContainText('Billable records');

      await expect(page.getByTestId('billing-token-chart')).toBeVisible();
      await expect(page.getByTestId('billing-token-chart-bar')).toHaveCount(30);
      await expect(page.getByTestId('billing-usage-heatmap')).toBeVisible();
      await expect(page.getByTestId('billing-usage-heatmap-day')).toHaveCount(30);
      await expect(page.getByTestId('billing-model-chart')).toContainText('e2e-model-pro');
      await expect(page.getByTestId('billing-model-chart')).not.toContainText('e2e-model-pending');
      await expect(page.getByTestId('billing-recent-list')).toContainText('billing-session-a');
      await expect(page.getByTestId('billing-recent-list')).toContainText('No usage');

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
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-billing').click();
      await expect(page.getByTestId('billing-page')).toBeVisible();
      await expect(page.getByTestId('billing-token-chart-bar')).toHaveCount(30);
      await expect(page.getByTestId('billing-model-chart')).toContainText('e2e-model-pro');
      await expect(page.getByText('Gateway offline')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
