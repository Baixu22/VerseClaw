/**
 * Headless evidence capture for reports/frontend-render-fix-verification.
 * Drives the mock scenarios on the already-running dev:web server and saves
 * the screenshots the layer-3 walkthrough cites. Ad-hoc tool, not a test.
 *
 * Usage: node scripts/capture-render-evidence.cjs  (server on :5273 required)
 */
const { chromium } = require('@playwright/test');
const { mkdirSync } = require('node:fs');

const BASE = 'http://localhost:5273';
const OUT = 'reports/assets/frontend-render-fix-20260811';

async function openScenario(page, scenario) {
  await page.goto(`${BASE}/?mock=1${scenario ? `&script=${scenario}` : ''}#/`);
  await page.getByTestId('chat-composer-input').waitFor({ state: 'visible', timeout: 20000 });
}

async function send(page, text) {
  const input = page.getByTestId('chat-composer-input');
  await input.click();
  await input.fill(text);
  await page.getByTestId('chat-composer-send').click();
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  // 1. full — pending approval forced open inside the turn summary.
  await openScenario(page, 'full');
  await send(page, '全量冒烟走查');
  await page.locator('[data-slot="approval-card"]:not([data-receipt="true"])').waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/01-full-approval-forced-open.png`, fullPage: false });

  // …then approve and let it settle to the showcase reply.
  await page.getByRole('button', { name: '批准' }).click();
  await page.getByText('Tool UI 卡片总览').first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${OUT}/02-full-settled-reply.png` });

  // 2. planonly — collapsed header carrying the plan badge.
  await openScenario(page, 'planonly');
  await send(page, '只做计划');
  await page.getByTestId('chat-turn-summary-badge-plan').waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/03-planonly-collapsed-badge.png` });

  // 3. thinking — streaming shimmer, then settled summary.
  await openScenario(page, 'thinking');
  await send(page, '排查 auth 中间件');
  await page.getByTestId('assistant-reasoning-panel').first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/04-thinking-streaming.png` });
  await page.getByText('推理过程通过真实的').waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/05-thinking-settled.png` });

  // 4. toolcall — tool_use cards live inside the run segment.
  await openScenario(page, 'toolcall');
  await send(page, 'toolcall 对照组');
  await page.getByTestId('chat-tool-ui-weather').waitFor({ timeout: 20000 });
  await page.getByText('互为对照组').waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/06-toolcall-cards.png` });

  // 5. sidebar — move menu open on the deeply nested session, unclipped.
  await openScenario(page);
  const grand = page.getByTestId('sidebar-folder-folder-grandchild-a2');
  await grand.waitFor({ timeout: 20000 });
  const row = grand.getByTestId('sidebar-session-agent:main:deep-case');
  await row.hover();
  await page.getByTestId('sidebar-session-move-agent:main:deep-case').click();
  await page.getByTestId('sidebar-session-move-menu-agent:main:deep-case').waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${OUT}/07-sidebar-deep-move-menu.png` });

  await browser.close();
  console.log('captured to', OUT);
})().catch((error) => { console.error(error); process.exit(1); });
