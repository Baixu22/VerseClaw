import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

for (const theme of ['light', 'dark'] as const) {
  for (const surface of ['sidebar', 'setup'] as const) {
    test(`B2 brand stays consistent from boot to ${surface} and reload in ${theme}`, async ({ launchElectronApp }, testInfo) => {
      const app = await launchElectronApp({ skipSetup: surface === 'sidebar', theme, bootHoldMs: 3_000 });
      try {
        const page = await getStableWindow(app);
        const bootLogo = page.locator('#boot-shell .boot-logo');
        await expect(bootLogo).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-boot-theme', theme);
        // Static HTML uses a relative URL; Vite's React import is absolute in Electron.
        const source = await bootLogo.evaluate((img: HTMLImageElement) => img.src);
        expect(await page.locator('link[rel="icon"]').evaluate((link: HTMLLinkElement) => link.href)).toBe(source);
        const bootSize = await bootLogo.boundingBox();
        expect(bootSize!.width).toBe(28);
        expect(bootSize!.height).toBe(28);
        await expect(page.getByTestId('boot-shell')).toHaveCount(0);
        const logo = page.getByTestId('brand-logo').first();
        await expect(logo).toBeVisible();
        await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
        expect(await logo.evaluate((img: HTMLImageElement) => img.src)).toBe(source);
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
        const size = await logo.boundingBox();
        const expectedSize = surface === 'sidebar' ? 28 : 64;
        expect(size!.width).toBeCloseTo(expectedSize, 2);
        expect(size!.height).toBeCloseTo(expectedSize, 2);
        await mkdir(testInfo.outputDir, { recursive: true });
        await page.screenshot({ path: join(testInfo.outputDir, `${theme}-${surface}.png`) });
        await page.reload();
        await expect(page.getByTestId('boot-shell')).toHaveCount(0);
        await expect(logo).toBeVisible();
        expect(await logo.evaluate((img: HTMLImageElement) => img.src)).toBe(source);
        await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      } finally {
        await closeElectronApp(app);
      }
    });
  }
}
