import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import type { Page, TestInfo } from '@playwright/test';

async function checkSurface(page: Page, testInfo: TestInfo, name: string, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), animations: 'disabled' });
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${name}: window`).toBeLessThanOrEqual(1);
  for (const selector of ['[data-testid="main-content"]', '.codex-settings-page__scroll']) {
    const container = page.locator(selector);
    if (await container.count()) {
      expect.soft(await container.evaluate((element) => element.scrollWidth - element.clientWidth), `${name}: ${selector}`).toBeLessThanOrEqual(1);
    }
  }
  const controls = await page.locator('button:visible, input:visible, select:visible, [role="combobox"]:visible').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const color = getComputedStyle(element).backgroundColor;
    const channels = color.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    return {
      label: element.getAttribute('data-testid') || element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 80),
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      solidBlue: channels.length >= 3 && (channels[3] ?? 1) >= 0.8 && channels[2] > channels[0] + 40 && channels[2] > channels[1] + 20,
      primary: element.classList.contains('bg-foreground') || element.classList.contains('sp-btn-primary'),
    };
  }));
  expect.soft(controls.filter((control) => control.left < -1 || control.right > width + 1), name).toEqual([]);
  expect.soft(controls.filter((control) => control.solidBlue), name).toEqual([]);
  expect.soft(controls.filter((control) => control.primary && control.top >= 0 && control.bottom <= 800).length, name).toBeLessThanOrEqual(1);
  const headings = await page.locator('h1:visible').evaluateAll((elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)));
  expect.soft(headings.length, name).toBeGreaterThan(0);
  for (const size of headings) expect.soft(size, name).toBeLessThanOrEqual(28);
}

for (const theme of ['light', 'dark'] as const) {
  test(`secondary Settings pages and diagnostics share controls in ${theme}`, async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        hostApi: Object.fromEntries([
          ['agents', 'list', { success: true, agents: [], defaultAgentId: 'main', configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {} }],
          ['providers', 'snapshot', { success: true, accounts: [], statuses: [], vendors: [], defaultAccountId: '' }],
          ['channels', 'accounts', { success: true, channels: [] }],
          ['usage', 'recentTokenHistory', [{ timestamp: new Date().toISOString(), sessionId: 'layout-sample', agentId: 'main', model: 'Local model', provider: 'local', inputTokens: 80, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100 }]],
          ['observability', 'dashboardSnapshot', { generatedAt: 1789344000000, cards: [{ id: 'traces', label: 'Traces', value: 0, tone: 'neutral' }], scorecards: [], alerts: [], traces: [] }],
          ['observability', 'queryTraces', { generatedAt: 1789344000000, items: [], total: 0, page: 1, pageSize: 100, facets: { status: [], agent: [], role: [], model: [], sourceStatus: [] } }],
        ].map(([module, action, result]) => [JSON.stringify([module, action, null]), result])),
      });
      const page = await getStableWindow(app);
      await page.reload();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const section of ['general', 'models', 'agents', 'channels', 'skills', 'browser', 'system', 'developer', 'billing', 'storage', 'archived', 'recovery']) {
        await page.evaluate((selected) => { window.location.hash = `/settings/${selected}`; }, section);
        await expect(page.getByTestId(`settings-nav-${section}`)).toHaveAttribute('aria-current', 'page');
        await expect(page.getByTestId('settings-page')).toBeVisible();
        await expect(page.getByTestId('settings-section-loading')).toHaveCount(0);
        if (section === 'models') await expect(page.getByTestId('token-usage-entry')).toHaveCount(1);
        for (const width of [1280, 960]) await checkSurface(page, testInfo, `${theme}-${section}`, width);
      }
      await page.evaluate(() => { window.location.hash = '/observability'; });
      await expect(page.getByTestId('observability-page')).toBeVisible();
      for (const width of [1280, 960]) {
        await checkSurface(page, testInfo, `${theme}-observability`, width);
        const clippedHeight = await page.getByTestId('observability-primary-metrics').evaluate((element) => {
          const container = element.parentElement!;
          return container.scrollHeight - container.clientHeight;
        });
        expect.soft(clippedHeight, 'metric labels and values must remain visible').toBeLessThanOrEqual(1);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test(`first-run Setup keeps compact navigation in ${theme}`, async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ theme });
    try {
      const page = await getStableWindow(app);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(page.getByTestId('setup-page')).toBeVisible();
      await expect(page.getByTestId('setup-welcome-step')).toBeVisible();
      for (const width of [1280, 960]) await checkSurface(page, testInfo, `${theme}-setup`, width);
    } finally {
      await closeElectronApp(app);
    }
  });
}
