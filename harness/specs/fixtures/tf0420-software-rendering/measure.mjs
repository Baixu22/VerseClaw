#!/usr/bin/env node
/**
 * Software-rendering A/B probe for TF-0420.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';

const root = resolve(process.argv[2] ?? process.cwd());
const output = resolve(process.argv[3] ?? join(root, 'artifacts/tf0420-software-rendering.json'));
const runRoot = resolve(process.argv[4] ?? join(process.env.TMP ?? process.env.TEMP ?? root, 'tf0420-render'));
const electronEntry = join(root, 'dist-electron/main/index.js');
const workDir = resolve(output, '..');
const shotsDir = join(workDir, 'screenshots');
await mkdir(runRoot, { recursive: true });
await mkdir(shotsDir, { recursive: true });

const app = await electron.launch({
  executablePath: String(electronBinary),
  args: [
    ...(process.platform === 'win32' && process.env.ELECTRON_DISABLE_SANDBOX === '1' ? ['--no-sandbox'] : []),
    '--lang=en-US', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer',
    '--in-process-gpu', '--disable-features=Vulkan,UseSkiaRenderer,CanvasOopRasterization', electronEntry,
  ],
  env: {
    ...process.env,
    VERSE_CLAW_E2E: '1',
    VERSE_CLAW_E2E_SKIP_SETUP: '1',
    VERSE_CLAW_USER_DATA_DIR: join(runRoot, 'user-data'),
    CLAWX_E2E_RUN_ROOT: runRoot,
  },
  timeout: 90_000,
});

function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

let page;

async function readState() {
  const response = await page.evaluate(async () => {
    const bridge = window.verseClaw;
    return await bridge?.hostInvoke({ id: 'tf0420-state', module: 'efficiency', action: 'getState' });
  });
  return response?.ok ? response.data : null;
}

async function capture(label) {
  try {
    const buffer = await page.screenshot({ timeout: 10_000, animations: 'disabled' });
    const path = join(shotsDir, `${label}.png`);
    await writeFile(path, buffer);
    return { path, bytes: buffer.length, sha256: hash(buffer) };
  } catch (error) {
    return { label, error: error instanceof Error ? error.message : String(error) };
  }
}

async function exercise() {
  return page.evaluate(async (durationMs) => {
    const scrollables = [...document.querySelectorAll('*')].filter((element) => {
      const style = getComputedStyle(element);
      return element.clientHeight > 80 && element.scrollHeight > element.clientHeight + 40
        && (style.overflowY === 'auto' || style.overflowY === 'scroll');
    }).slice(0, 12);
    let frames = 0;
    let total = 0;
    let max = 0;
    let last = performance.now();
    const start = performance.now();
    const tick = (now) => {
      frames += 1;
      const delta = now - last;
      last = now;
      total += delta;
      max = Math.max(max, delta);
      if (performance.now() - start < durationMs) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const timer = setInterval(() => {
      for (const element of scrollables) {
        element.scrollTop += 37;
        if (element.scrollTop + element.clientHeight >= element.scrollHeight) element.scrollTop = 0;
      }
    }, 16);
    await new Promise((resolveWait) => setTimeout(resolveWait, durationMs));
    clearInterval(timer);
    return {
      scrollableCount: scrollables.length,
      frames,
      avgFrameMs: frames > 0 ? total / frames : null,
      maxFrameMs: max,
    };
  }, 800);
}

async function snapshot(label, state, shot) {
  const renderer = await page.evaluate(() => window.__CLAWX_PERF_SNAPSHOT__?.() ?? null);
  return {
    label,
    frame: await exercise(),
    screenshot: shot,
    longTaskCount: renderer?.longTasks?.length ?? 0,
    longTaskMaxMs: Math.max(0, ...(renderer?.longTasks ?? []).map((item) => item.durationMs)),
    sampler: state?.summary ?? null,
    mainRssBytes: state?.performance?.rssBytes ?? null,
  };
}

let baseline;
let noFx;
try {
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));

  await page.evaluate(() => { location.hash = '#/'; });
  await new Promise((resolveWait) => setTimeout(resolveWait, 800));
  const baselineChatState = await readState();
  const baselineChat = await snapshot('chat', baselineChatState, await capture('chat-baseline'));

  await page.getByTestId('sidebar-session-search').click().catch(() => {});
  await page.waitForSelector('[data-testid="session-search-modal"]', { timeout: 2_000 }).catch(() => {});
  const baselineDialogState = await readState();
  const baselineDialog = await snapshot('dialog', baselineDialogState, await capture('dialog-baseline'));
  await page.keyboard.press('Escape').catch(() => {});

  await page.evaluate(() => { location.hash = '#/settings'; });
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  const baselineSettingsState = await readState();
  const baselineSettings = await snapshot('settings', baselineSettingsState, await capture('settings-baseline'));
  baseline = { chat: baselineChat, dialog: baselineDialog, settings: baselineSettings };

  await page.addStyleTag({ content: '*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; will-change: auto !important; }' });
  await page.evaluate(() => { location.hash = '#/'; document.querySelectorAll('*').forEach((element) => { element.scrollTop = 0; }); });
  await new Promise((resolveWait) => setTimeout(resolveWait, 800));
  const noFxChatState = await readState();
  const noFxChat = await snapshot('chat-no-fx', noFxChatState, await capture('chat-no-fx'));

  await page.getByTestId('sidebar-session-search').click().catch(() => {});
  await page.waitForSelector('[data-testid="session-search-modal"]', { timeout: 2_000 }).catch(() => {});
  const noFxDialogState = await readState();
  const noFxDialog = await snapshot('dialog-no-fx', noFxDialogState, await capture('dialog-no-fx'));
  await page.keyboard.press('Escape').catch(() => {});

  await page.evaluate(() => { location.hash = '#/settings'; });
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  const noFxSettingsState = await readState();
  const noFxSettings = await snapshot('settings-no-fx', noFxSettingsState, await capture('settings-no-fx'));
  noFx = { chat: noFxChat, dialog: noFxDialog, settings: noFxSettings };

  const report = {
    schema: 'clawx.tf0420.software-rendering-ab/v1',
    driven_by: 'agent',
    actor: 'codex-tf0420-render-probe',
    candidate: (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    completedAt: new Date().toISOString(),
    platform: process.platform,
    electron: process.versions.electron,
    baseline,
    noFx,
    boundaries: [
      'The A/B override is injected in the live renderer; no production CSS is changed by this probe.',
      'The dialog step may be skipped if the sidebar search trigger is unavailable; the report records actual surfaces.',
      'Frame timing is a local Windows software-rendering rAF sample, not a cross-platform benchmark.',
    ],
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    output,
    candidate: report.candidate,
    baseline: Object.fromEntries(Object.entries(baseline).map(([key, value]) => [key, value.frame])),
    noFx: Object.fromEntries(Object.entries(noFx).map(([key, value]) => [key, value.frame])),
    screenshotFiles: [...Object.values(baseline), ...Object.values(noFx)].map((value) => value.screenshot),
  }, null, 2) + '\n');
} finally {
  try { await app.close(); } catch {
    if (process.platform === 'win32') {
      const { spawn } = await import('node:child_process');
      spawn('taskkill', ['/F', '/T', '/PID', String(app.process().pid)], { stdio: 'ignore', windowsHide: true });
    }
  }
}
