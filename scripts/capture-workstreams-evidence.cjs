/** One-off: capture the workstream sidebar states for visual review. */
const { chromium } = require('@playwright/test');
const { mkdirSync } = require('node:fs');

const BASE = 'http://localhost:5273';
const OUT = 'reports/assets/session-workstreams-20260811';

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(`${BASE}/?mock=1#/`);
  await page.getByTestId('sidebar-folder-folder-root-a').waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);

  // 1. Resting state — streams, prefixes, lineage, time slices.
  await page.screenshot({ path: `${OUT}/01-sidebar-resting.png`, clip: { x: 0, y: 0, width: 300, height: 960 } });

  // 2. Hover a stream header — actions visible.
  await page.getByTestId('sidebar-folder-folder-root-b').locator('.sidebar-row').first().hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/02-stream-hover.png`, clip: { x: 0, y: 0, width: 300, height: 960 } });

  // 3. Move menu open on the deep session (portal + accent dots + new-stream footer).
  const row = page.getByTestId('sidebar-session-agent:main:deep-case');
  await row.hover();
  await page.getByTestId('sidebar-session-move-agent:main:deep-case').click();
  await page.getByTestId('sidebar-session-move-menu-agent:main:deep-case').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/03-move-menu.png`, clip: { x: 0, y: 0, width: 460, height: 960 } });

  // 4. New-stream inline input inside the menu.
  await page.getByTestId('sidebar-stream-new-inline').click();
  await page.getByTestId('sidebar-stream-new-input').fill('新验证线');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/04-menu-new-stream.png`, clip: { x: 0, y: 0, width: 460, height: 960 } });

  // 5. Light theme resting state (drive the app's own theme store).
  await page.evaluate(async () => {
    const mod = await import('/src/stores/settings.ts');
    const state = mod.useSettingsStore.getState();
    if (typeof state.setTheme === 'function') await state.setTheme('light');
  });
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${OUT}/05-sidebar-light.png`, clip: { x: 0, y: 0, width: 300, height: 960 } });

  await browser.close();
  console.log('captured to', OUT);
})().catch((error) => { console.error(error); process.exit(1); });
