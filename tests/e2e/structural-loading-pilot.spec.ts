import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  test,
} from './fixtures/electron';

const artifactDir = join(process.cwd(), 'artifacts', 'structural-loading-pilot');
type LaunchElectronApp = (options?: {
  skipSetup?: boolean;
  settingsSectionDelayMs?: number;
}) => Promise<ElectronApplication>;

async function openDelayedStorageSection(
  launchElectronApp: LaunchElectronApp,
  delayMs: number,
) {
  const app = await launchElectronApp({ skipSetup: true, settingsSectionDelayMs: delayMs });
  const page = await getStableWindow(app);
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await page.getByTestId('sidebar-nav-settings').click();
  await expect(page.getByTestId('settings-implementation')).toBeVisible();
  await page.getByTestId('settings-nav-storage').click();
  const loading = page.getByTestId('settings-section-loading');
  await expect(loading).toBeVisible();
  return { app, page, loading };
}

test.describe('structural loading adaptive pilot', () => {
  test.beforeAll(async () => {
    await mkdir(artifactDir, { recursive: true });
  });

  test('captures a slow fallback from structure to ready', async ({ launchElectronApp }) => {
    const startedAt = Date.now();
    const { app, page, loading } = await openDelayedStorageSection(launchElectronApp, 1_800);
    try {
      const overlay = loading.locator('.structural-loading-overlay');
      await expect(overlay).toBeVisible();
      await page.screenshot({ path: join(artifactDir, 'slow-early.png'), fullPage: true });

      await page.waitForTimeout(650);
      const stablePhase = await overlay.getAttribute('data-phase');
      const stableBounds = await overlay.getAttribute('data-bounds');
      const stableRegions = await overlay.getAttribute('data-region-count');
      await page.screenshot({ path: join(artifactDir, 'slow-stable.png'), fullPage: true });

      await expect(page.getByTestId('storage-info-ram')).toBeVisible({ timeout: 10_000 });
      const completedMs = Date.now() - startedAt;
      await page.screenshot({ path: join(artifactDir, 'slow-ready.png'), fullPage: true });

      const receipt = {
        driven_by: 'agent',
        actor: 'playwright-electron',
        case: 'slow',
        configuredDelayMs: 1_800,
        completedMs,
        stablePhase,
        stableBounds,
        stableRegions,
        screenshots: artifactDir,
      };
      await writeFile(join(artifactDir, 'slow.json'), JSON.stringify(receipt, null, 2));
      expect(stablePhase).toBe('trace');
      expect(stableRegions).toBe('5');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('captures a fast fallback without delaying ready content', async ({ launchElectronApp }) => {
    const startedAt = Date.now();
    const { app, page, loading } = await openDelayedStorageSection(launchElectronApp, 450);
    try {
      await page.screenshot({ path: join(artifactDir, 'fast-early.png'), fullPage: true });
      await expect(page.getByTestId('storage-info-ram')).toBeVisible({ timeout: 10_000 });
      const completedMs = Date.now() - startedAt;
      await page.screenshot({ path: join(artifactDir, 'fast-ready.png'), fullPage: true });

      const receipt = {
        driven_by: 'agent',
        actor: 'playwright-electron',
        case: 'fast',
        configuredDelayMs: 450,
        completedMs,
        screenshots: artifactDir,
      };
      await writeFile(join(artifactDir, 'fast.json'), JSON.stringify(receipt, null, 2));
      expect(completedMs).toBeLessThan(1_800);
    } finally {
      await closeElectronApp(app);
    }
  });
});



