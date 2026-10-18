#!/usr/bin/env node
/**
 * Repeatable startup measurement for TF-0418.
 * Launches the built Electron main output several times, reads the existing
 * TF-0417 performance marks, and writes local P50/P95 evidence.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';

const root = resolve(process.argv[2] ?? process.cwd());
const output = resolve(process.argv[3] ?? join(root, 'artifacts/tf0418-startup.json'));
const runRoot = resolve(process.argv[4] ?? join(process.env.TMP ?? process.env.TEMP ?? root, 'tf0418-startup'));
const runs = Math.max(1, Number(process.env.TF0418_RUNS ?? 5));
const waitMs = Math.max(1_000, Number(process.env.TF0418_WAIT_MS ?? 2_500));
const electronEntry = join(root, 'dist-electron/main/index.js');

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
}

const results = [];
for (let index = 0; index < runs; index += 1) {
  const runDir = join(runRoot, `run-${index + 1}`);
  const userDataDir = join(runDir, 'user-data');
  const homeDir = join(runDir, 'home');
  await mkdir(userDataDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en', setupComplete: true }, null, 2));
  const app = await electron.launch({
    executablePath: String(electronBinary),
    args: [
      ...(process.platform === 'win32' && process.env.ELECTRON_DISABLE_SANDBOX === '1' ? ['--no-sandbox'] : []),
      `--user-data-dir=${userDataDir}`, '--lang=en-US', '--disable-gpu', '--disable-gpu-compositing',
      '--disable-software-rasterizer', '--in-process-gpu', '--disable-features=Vulkan,UseSkiaRenderer,CanvasOopRasterization', electronEntry,
    ],
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
      VERSE_CLAW_E2E: '1',
      VERSE_CLAW_E2E_SKIP_SETUP: '1',
      VERSE_CLAW_USER_DATA_DIR: userDataDir,
      CLAWX_E2E_RUN_ROOT: runDir,
    },
    timeout: 90_000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
    const response = await page.evaluate(async () => {
      const bridge = window.verseClaw;
      return await bridge?.hostInvoke({ id: 'tf0418-startup-state', module: 'efficiency', action: 'getState' });
    });
    const renderer = await page.evaluate(() => {
      const raw = localStorage.getItem('clawx.performance.metrics.v1');
      return raw ? JSON.parse(raw) : null;
    });
    if (!response?.ok) throw new Error(`efficiency getState failed: ${JSON.stringify(response)}`);
    results.push({
      run: index + 1,
      ok: true,
      main: response.data.performance,
      renderer,
    });
  } catch (error) {
    results.push({ run: index + 1, ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    try { await app.close(); } catch {
      if (process.platform === 'win32') {
        const { spawn } = await import('node:child_process');
        spawn('taskkill', ['/F', '/T', '/PID', String(app.process().pid)], { stdio: 'ignore', windowsHide: true });
      }
    }
  }
}

function markValue(result, side, name) {
  const marks = side === 'main' ? result?.main?.marks : result?.renderer?.marks;
  return marks?.find((mark) => mark.name === name)?.fromStartMs ?? null;
}

const metric = (side, name) => {
  const values = results
    .filter((result) => result.ok)
    .map((result) => markValue(result, side, name))
    .filter((value) => typeof value === 'number');
  return { count: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), values };
};

const report = {
  schema: 'clawx.tf0418.startup-measurement/v1',
  driven_by: 'agent',
  actor: 'codex-tf0418-startup-probe',
  candidate: (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  completedAt: new Date().toISOString(),
  runs,
  waitMs,
  platform: process.platform,
  electron: process.versions.electron,
  metrics: {
    appReady: metric('main', 'app-ready'),
    windowCreated: metric('main', 'window-created'),
    readyToShow: metric('main', 'ready-to-show'),
    rendererFirstPaint: metric('renderer', 'renderer-first-paint'),
  },
  successfulRuns: results.filter((result) => result.ok).length,
  failedRuns: results.filter((result) => !result.ok).length,
  results,
  boundaries: [
    'Each run launches a fresh Electron process and a fresh user-data directory.',
    'P50/P95 use the nearest-rank index on the measured runs; no values are synthesized.',
    'This is agent-driven local evidence and does not include a human verdict.',
  ],
};
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({
  output,
  candidate: report.candidate,
  successfulRuns: report.successfulRuns,
  failedRuns: report.failedRuns,
  readyToShow: report.metrics.readyToShow,
  appReady: report.metrics.appReady,
  rendererFirstPaint: report.metrics.rendererFirstPaint,
}, null, 2) + '\n');
