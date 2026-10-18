#!/usr/bin/env node
/**
 * Real Electron baseline probe for TF-0406.
 * Runs the existing Main sampler for five minutes and prints one JSON object.
 * The probe does not invent spawn or timer counts; fields not exposed by the
 * current Main contract remain explicitly unavailable.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';

const root = resolve(process.argv[2] ?? process.cwd());
const output = resolve(process.argv[3] ?? join(root, 'artifacts/tf0406-baseline.json'));
const runRoot = resolve(process.argv[4] ?? join(process.env.TMP ?? process.env.TEMP ?? root, 'tf0406-baseline'));
const electronEntry = join(root, 'dist-electron/main/index.js');
const durationMs = Number(process.env.TF0406_DURATION_MS ?? 300_000);
const sampleWaitMs = Math.max(durationMs, 30_000);
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

let startMs = Date.now();
let finalState;
try {
  await app.firstWindow();
  await new Promise(resolveWait => setTimeout(resolveWait, durationMs));
  const page = await app.firstWindow();
  const response = await page.evaluate(async () => {
    const bridge = window.verseClaw;
    return await bridge?.hostInvoke({ id: 'tf0406-final-state', module: 'efficiency', action: 'getState' });
  });
  if (!response?.ok) throw new Error(`efficiency getState failed: ${JSON.stringify(response)}`);
  finalState = response.data;
  const samples = Array.isArray(finalState.samples) ? finalState.samples : [];
  const report = {
    schema: 'clawx.tf0406.resource-baseline/v1',
    driven_by: 'agent',
    actor: 'tf0406-electron-probe',
    candidate: (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    startedAt: new Date(startMs).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    platform: process.platform,
    node: process.version,
    electron: process.versions.electron,
    sampler: {
      running: finalState.running,
      measured: finalState.measured,
      summary: finalState.summary,
      sampleCount: samples.length,
      coverageMs: finalState.summary?.coverageMs ?? 0,
      samples,
    },
    unavailable: {
      spawnCount: 'The current Main efficiency contract exposes no process-spawn counter; no estimated value is substituted.',
      setIntervalCount: 'Node does not expose a supported live interval registry; no estimated value is substituted.',
    },
    boundaries: [
      'This is a real Electron run of the existing Main process sampler, not a synthetic sampler.',
      'Spawn and setInterval counts are unavailable rather than fabricated.',
      'The report is agent-driven and is a P1 before baseline only.',
    ],
  };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output, sampleCount: report.sampler.sampleCount, durationMs: report.durationMs }) + '\n');
} finally {
  try { await app.close(); } catch {
    if (process.platform === 'win32') {
      const { spawn } = await import('node:child_process');
      spawn('taskkill', ['/F', '/T', '/PID', String(app.process().pid)], { stdio: 'ignore', windowsHide: true });
    }
  }
}
