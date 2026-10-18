#!/usr/bin/env node
/**
 * Real Electron probe for TF-0417 performance instrumentation.
 * Runs the app for TF0417_DURATION_MS (default five minutes), reads the Main
 * efficiency state plus the renderer localStorage ring buffer, and writes one
 * local JSON report. It never uploads and never substitutes static estimates.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';

const root = resolve(process.argv[2] ?? process.cwd());
const output = resolve(process.argv[3] ?? join(root, 'artifacts/tf0417-performance.json'));
const runRoot = resolve(process.argv[4] ?? join(process.env.TMP ?? process.env.TEMP ?? root, 'tf0417-performance'));
const electronEntry = join(root, 'dist-electron/main/index.js');
const durationMs = Number(process.env.TF0417_DURATION_MS ?? 300_000);
const userDataDir = join(runRoot, 'user-data');
const homeDir = join(runRoot, 'home');
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
    CLAWX_E2E_RUN_ROOT: runRoot,
  },
  timeout: 90_000,
});

const startedAt = Date.now();
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await new Promise((resolveWait) => setTimeout(resolveWait, durationMs));
  // Exercise the real click/key listeners while the ring buffer is live.
  await page.mouse.click(40, 40).catch(() => {});
  await page.keyboard.press('Tab').catch(() => {});
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const response = await page.evaluate(async () => {
    const bridge = window.verseClaw;
    return await bridge?.hostInvoke({ id: 'tf0417-final-state', module: 'efficiency', action: 'getState' });
  });
  if (!response?.ok) throw new Error(`efficiency getState failed: ${JSON.stringify(response)}`);
  const renderer = await page.evaluate(() => {
    const raw = localStorage.getItem('clawx.performance.metrics.v1');
    return raw ? JSON.parse(raw) : null;
  });
  const report = {
    schema: 'clawx.tf0417.performance-probe/v1',
    driven_by: 'agent',
    actor: 'tf0417-electron-probe',
    candidate: (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    platform: process.platform,
    node: process.version,
    electron: process.versions.electron,
    main: response.data.performance,
    renderer,
    sampler: {
      running: response.data.running,
      measured: response.data.measured,
      summary: response.data.summary,
    },
    boundaries: [
      'This is a real Electron run; spawn, interval, watcher, renderer long-task and IPC values come from runtime counters.',
      'The renderer ring buffer is local JSON in localStorage; the Main snapshot is returned by the existing efficiency host API.',
      'No static grep estimate is substituted and no real-human evidence is claimed.',
    ],
  };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    output,
    durationMs: report.durationMs,
    marks: report.main?.marks?.map((mark) => mark.name) ?? [],
    spawnCount: report.main?.counters?.spawnCount ?? null,
    activeIntervals: report.main?.counters?.activeIntervals ?? null,
    activeWatchers: report.main?.counters?.activeWatchers ?? null,
    rendererMarkCount: report.renderer?.marks?.length ?? null,
    ipcCount: report.renderer?.ipc?.count ?? null,
  }) + '\n');
} finally {
  try { await app.close(); } catch {
    if (process.platform === 'win32') {
      const { spawn } = await import('node:child_process');
      spawn('taskkill', ['/F', '/T', '/PID', String(app.process().pid)], { stdio: 'ignore', windowsHide: true });
    }
  }
}
