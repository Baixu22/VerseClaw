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

type OverlayObservation = {
  overlayObserved: boolean;
  phase: string | null;
  bounds: string | null;
  regionCount: string | null;
  loadingFallbackObserved: boolean;
};

/**
 * Opens Settings while an artificial per-section delay is configured.
 *
 * The delay wiring is covered by electron/main/index.ts -> ?e2eSettingsSectionDelayMs
 * and consumed by the preloadable lazy routes in src/pages/Settings.
 * Note: on the current settings shell the section switch resolves through the
 * interactive settings implementation, so the Suspense fallback is not
 * guaranteed to be observable; this pilot records the observation instead of
 * asserting a transient state that the harness cannot guarantee.
 */
async function openDelayedSettingsSection(
  launchElectronApp: LaunchElectronApp,
  delayMs: number,
) {
  const app = await launchElectronApp({ skipSetup: true, settingsSectionDelayMs: delayMs });
  const page = await getStableWindow(app);
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await page.getByTestId('sidebar-nav-settings').click();
  await expect(page.getByTestId('settings-implementation')).toBeVisible();
  await page.getByTestId('settings-nav-archived').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(page.getByTestId('settings-back-button')).toBeVisible();
  return { app, page };
}

async function observeOverlay(
  page: Awaited<ReturnType<typeof getStableWindow>>,
): Promise<OverlayObservation> {
  const overlay = page.locator('.structural-loading-overlay');
  const observed = (await overlay.count()) > 0;
  return {
    overlayObserved: observed,
    phase: observed ? await overlay.first().getAttribute('data-phase') : null,
    bounds: observed ? await overlay.first().getAttribute('data-bounds') : null,
    regionCount: observed ? await overlay.first().getAttribute('data-region-count') : null,
    loadingFallbackObserved: (await page.getByTestId('settings-section-loading').count()) > 0,
  };
}

test.describe('structural loading adaptive pilot', () => {
  test.beforeAll(async () => {
    await mkdir(artifactDir, { recursive: true });
  });

  test('captures the slow settings-shell fallback path', async ({ launchElectronApp }) => {
    const startedAt = Date.now();
    const { app, page } = await openDelayedSettingsSection(launchElectronApp, 1_800);
    try {
      await page.screenshot({ path: join(artifactDir, 'slow-early.png'), fullPage: true });
      const early = await observeOverlay(page);

      await page.waitForTimeout(650);
      await page.screenshot({ path: join(artifactDir, 'slow-stable.png'), fullPage: true });
      const stable = await observeOverlay(page);

      const receipt = {
        driven_by: 'agent',
        actor: 'playwright-electron',
        case: 'slow',
        configuredDelayMs: 1_800,
        completedMs: Date.now() - startedAt,
        early,
        stable,
        screenshots: artifactDir,
      };
      await writeFile(join(artifactDir, 'slow.json'), JSON.stringify(receipt, null, 2));

      // Deterministic assertions only: the settings shell must stay mounted and
      // interactive regardless of whether the transient fallback was observed.
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('settings-page')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('captures the fast settings-shell path', async ({ launchElectronApp }) => {
    const startedAt = Date.now();
    const { app, page } = await openDelayedSettingsSection(launchElectronApp, 450);
    try {
      await page.screenshot({ path: join(artifactDir, 'fast-early.png'), fullPage: true });
      const early = await observeOverlay(page);
      await page.waitForTimeout(450);
      await page.screenshot({ path: join(artifactDir, 'fast-ready.png'), fullPage: true });
      const ready = await observeOverlay(page);

      const receipt = {
        driven_by: 'agent',
        actor: 'playwright-electron',
        case: 'fast',
        configuredDelayMs: 450,
        completedMs: Date.now() - startedAt,
        early,
        ready,
        screenshots: artifactDir,
      };
      await writeFile(join(artifactDir, 'fast.json'), JSON.stringify(receipt, null, 2));

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('settings-page')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
