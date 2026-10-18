#!/usr/bin/env node
/**
 * Controlled read-path probe for TF-0407.
 *
 * The app runs for five minutes and asks the renderer host bridge for
 * git.status once per second. Pre-P1 and P1 builds use the same probe and the
 * same local Electron flags. The report records real Main spawn counters, not
 * static estimates. This is deliberately a controlled read workload, not a
 * claim that a totally idle app has background git reads.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';

const root = resolve(process.argv[2] ?? process.cwd());
const output = resolve(process.argv[3] ?? join(root, 'artifacts/tf0407-p1-read.json'));
const runRoot = resolve(process.argv[4] ?? join(process.env.TMP ?? process.env.TEMP ?? root, 'tf0407-p1-read'));
const electronEntry = join(root, 'dist-electron/main/index.js');
const durationMs = Number(process.env.TF0407_DURATION_MS ?? 300_000);
const readIntervalMs = Number(process.env.TF0407_READ_INTERVAL_MS ?? 1_000);
const userDataDir = join(runRoot, 'user-data');
const homeDir = join(runRoot, 'home');
await mkdir(userDataDir, { recursive: true });
await mkdir(homeDir, { recursive: true });
await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en', setupComplete: true }, null, 2));
await writeFile(join(userDataDir, 'workspaces.json'), JSON.stringify({
  activeWorkspaceId: 'probe-repo',
  profiles: [{
    id: 'probe-repo',
    name: 'Probe Repo',
    rootPath: root,
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode: 'fullAccess',
  }],
}, null, 2));

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
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
  const reads = await page.evaluate(async ({ durationMs: loopDurationMs, readIntervalMs: intervalMs }) => {
    const bridge = window.verseClaw;
    if (!bridge?.hostInvoke) throw new Error('renderer host bridge unavailable');
    const started = performance.now();
    const calls = [];
    let index = 0;
    while (performance.now() - started < loopDurationMs) {
      const callStarted = performance.now();
      const response = await bridge.hostInvoke({
        id: `tf0407-read-${index}`,
        module: 'git',
        action: 'status',
      });
      calls.push({
        index,
        atMs: performance.now() - started,
        durationMs: performance.now() - callStarted,
        ok: response?.ok === true,
      });
      index += 1;
      const remaining = intervalMs - (performance.now() - callStarted);
      if (remaining > 0) await new Promise((resolveWait) => setTimeout(resolveWait, remaining));
    }
    return calls;
  }, { durationMs, readIntervalMs });
  const response = await page.evaluate(async () => {
    const bridge = window.verseClaw;
    return await bridge?.hostInvoke({ id: 'tf0407-final-state', module: 'efficiency', action: 'getState' });
  });
  if (!response?.ok) throw new Error(`efficiency getState failed: ${JSON.stringify(response)}`);
  const report = {
    schema: 'clawx.tf0407.p1-read-benchmark/v1',
    driven_by: 'agent',
    actor: 'tf0407-p1-read-probe',
    candidate: (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    readIntervalMs,
    requestedDurationMs: durationMs,
    readCallCount: reads.length,
    readOkCount: reads.filter((call) => call.ok).length,
    readErrorCount: reads.filter((call) => !call.ok).length,
    reads,
    main: response.data.performance,
    boundaries: [
      'Controlled 1s git.status read workload; this is not a pure-idle background-spawn claim.',
      'Pre-P1 and P1 builds use the same probe, Electron flags, and local user-data setup.',
      'Counts come from the runtime child_process wrapper; no static grep or inferred spawn count is substituted.',
      'The probe is agent-driven, local-only, and does not upload data.',
    ],
  };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    output,
    candidate: report.candidate,
    durationMs: report.durationMs,
    readCallCount: report.readCallCount,
    readErrorCount: report.readErrorCount,
    spawnCount: report.main?.counters?.spawnCount ?? null,
    spawnByMethod: report.main?.counters?.spawnByMethod ?? null,
    activeIntervals: report.main?.counters?.activeIntervals ?? null,
  }) + '\n');
} finally {
  try { await app.close(); } catch {
    if (process.platform === 'win32') {
      const { spawn } = await import('node:child_process');
      spawn('taskkill', ['/F', '/T', '/PID', String(app.process().pid)], { stdio: 'ignore', windowsHide: true });
    }
  }
}
