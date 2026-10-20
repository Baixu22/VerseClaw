import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

const outDir = 'D:\\tmp\\billing-timing';

test('probe billing sketch timing', async ({ launchElectronApp }) => {
  await mkdir(outDir, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, theme: 'light' });
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
    const atVisible = await page.evaluate(() => performance.now());
    const read = () => page.evaluate(() => {
      const surface = document.querySelector('[data-structural-surface="billing"]');
      const skeleton = surface?.querySelector('.progressive-loading-skeleton');
      const rects = Array.from(surface?.querySelectorAll('[data-structural-sketch] rect') ?? []);
      return {
        now: performance.now(),
        skeletonState: skeleton?.getAttribute('data-state') ?? null,
        skeletonVisibility: skeleton ? getComputedStyle(skeleton).visibility : null,
        samples: rects.slice(0, 8).map((node) => {
          const style = getComputedStyle(node);
          const animation = node.getAnimations()[0];
          return {
            delay: style.animationDelay,
            duration: style.animationDuration,
            playState: style.animationPlayState,
            offset: style.strokeDashoffset,
            currentTime: animation?.currentTime ?? null,
            startTime: animation?.startTime ?? null,
            state: animation?.playState ?? null,
          };
        }),
        finished: rects.filter((node) => Number.parseFloat(getComputedStyle(node).strokeDashoffset) === 0).length,
        total: rects.length,
      };
    });
    const samples: unknown[] = [{ sinceVisibleMs: 0, ...(await read()) }];
    for (const wait of [100, 150, 200, 300]) {
      await page.waitForTimeout(wait);
      samples.push({ sinceVisibleMs: (await page.evaluate(() => performance.now())) - atVisible, ...(await read()) });
    }
    await writeFile(join(outDir, 'samples.json'), JSON.stringify(samples, null, 2));
  } finally {
    await closeElectronApp(app);
  }
});
