import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

const outDir = 'D:\\tmp\\sketch-surfaces';

test('probe sketch surfaces', async ({ launchElectronApp }) => {
  await mkdir(outDir, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, theme: 'light', settingsSectionDelayMs: 1_800 });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'stopped' },
      hostApi: {
        '["agents","list",null]': { success: true, agents: [], defaultAgentId: 'main', defaultModelRef: 'deepseek/deepseek-chat', configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {} },
        '["providers","snapshot",null]': { success: true, accounts: [], statuses: [], vendors: [], defaultAccountId: '' },
        '["usage","recentTokenHistory",{"limit":800}]': { __delayMs: 30_000, result: { success: true, entries: [] } },
        '["usage","aggregateSummary",null]': { success: true, summary: {} },
      },
    });
    const page = await getStableWindow(app);
    await pinWindowContentSize(app, { width: 1280, height: 900 });
    await page.reload();
    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-billing').click();
    const billing = page.locator('[data-structural-surface="billing"]');
    await expect(billing).toHaveAttribute('data-state', 'visible', { timeout: 6_000 });
    const billingBox = await billing.boundingBox();
    const billingSamples: unknown[] = [];
    for (const wait of [150, 400]) {
      await page.waitForTimeout(wait);
      billingSamples.push(await page.evaluate(() => ({
        sketches: document.querySelectorAll('[data-structural-surface="billing"] [data-structural-sketch]').length,
        outlines: document.querySelectorAll('[data-structural-surface="billing"] .structural-sketch__outline rect').length,
        offsets: Array.from(document.querySelectorAll('[data-structural-surface="billing"] [data-structural-sketch] rect')).map((node) => Number.parseFloat(getComputedStyle(node).strokeDashoffset)),
        regions: document.querySelectorAll('[data-structural-surface="billing"] [data-structural-region]').length,
      })));
      await page.screenshot({ path: join(outDir, `billing-${wait}.png`), clip: billingBox ?? undefined });
    }
    await writeFile(join(outDir, 'billing.json'), JSON.stringify(billingSamples, null, 2));

    await page.getByTestId('settings-nav-archived').click();
    const sectionLoading = page.getByTestId('settings-section-loading');
    await expect(sectionLoading).toBeVisible({ timeout: 5_000 });
    const sectionBox = await sectionLoading.boundingBox();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, 'settings-section.png'), clip: sectionBox ?? undefined });
  } finally {
    await closeElectronApp(app);
  }
});
