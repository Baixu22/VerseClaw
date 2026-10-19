#!/usr/bin/env node
/**
 * TF-0423 session-loading probe.
 *
 * Runs the real built Electron app against a synthetic 333-session / ~60 MB
 * transcript set and records metrics that exist in BOTH the pre-change and
 * post-change builds:
 *   - sidebar load latency (reload -> first rendered session row)
 *   - per-session switch commit latency (click -> two settled animation frames)
 *   - renderer long tasks >= 50 ms observed during the switch window
 *   - `sessions.summaries` host-call duration and requested key count
 *   - main-process RSS samples while idle
 *
 * Nothing is uploaded; the report is local and driven_by=agent.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';

const root = resolve(process.argv[2] ?? process.cwd());
const output = resolve(process.argv[3] ?? join(root, 'artifacts/tf0423-session-loading.json'));
const runRoot = resolve(process.argv[4] ?? join(process.env.TMP ?? process.env.TEMP ?? root, 'tf0423-session-loading'));
const idleMs = Number(process.env.TF0423_IDLE_MS ?? 300_000);
const idleSampleMs = Number(process.env.TF0423_IDLE_SAMPLE_MS ?? 5_000);
const SWITCH_COUNT = 5;
const SESSION_COUNT = 333;
const TRANSCRIPT_BYTES = 180_000;

const keyOf = (i) => `agent:main:s${String(i).padStart(3, '0')}`;
const percentile = (values, ratio) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? null;
};

async function buildFixture(configDir) {
  const sessionsDir = join(configDir, 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  const sessions = [];
  let bytes = 0;
  for (let index = 0; index < SESSION_COUNT; index += 1) {
    const id = `s${String(index).padStart(3, '0')}`;
    const first = JSON.stringify({ type: 'message', message: { role: 'user', content: `Synthetic session ${index} title`, timestamp: 1_700_000_000 + index } });
    const middle = JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'x'.repeat(Math.max(0, TRANSCRIPT_BYTES - first.length - 200)), timestamp: 1_700_000_001 + index } });
    const last = JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'tail', timestamp: 1_700_100_000 + index } });
    const transcript = `${first}\n${middle}\n${last}\n`;
    await writeFile(join(sessionsDir, `${id}.jsonl`), transcript, 'utf8');
    bytes += Buffer.byteLength(transcript);
    sessions.push({ key: keyOf(index), file: `${id}.jsonl`, updatedAt: 1_700_000_000_000 + index * 1_000, messageCount: 3 });
  }
  sessions.push({ key: 'agent:main:main', displayName: 'main', updatedAt: 1_800_000_000_000, messageCount: 0 });
  await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify({ sessions }, null, 2), 'utf8');
  return { sessions, bytes };
}

await mkdir(runRoot, { recursive: true });
const configDir = join(runRoot, 'openclaw');
const userDataDir = join(runRoot, 'user-data');
const homeDir = join(runRoot, 'home');
await mkdir(userDataDir, { recursive: true });
await mkdir(homeDir, { recursive: true });
await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en', setupComplete: true }, null, 2));

const fixture = await buildFixture(configDir);
const electronEntry = join(root, 'dist-electron/main/index.js');

const app = await electron.launch({
  executablePath: String(electronBinary),
  args: [
    `--user-data-dir=${userDataDir}`,
    '--lang=en-US',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-software-rasterizer',
    '--in-process-gpu',
    '--disable-features=Vulkan,UseSkiaRenderer,CanvasOopRasterization',
    electronEntry,
  ],
  env: {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: join(homeDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
    OPENCLAW_CONFIG_DIR: configDir,
    VERSE_CLAW_E2E: '1',
    VERSE_CLAW_E2E_SKIP_SETUP: '1',
    VERSE_CLAW_USER_DATA_DIR: userDataDir,
    CLAWX_E2E_RUN_ROOT: runRoot,
    CLAWX_AGENT_DEV: '1',
  },
  timeout: 120_000,
});

try {
  await app.evaluate(async (_ctx, sessions) => {
    const { ipcMain } = process.mainModule.require('electron');
    const historyFor = (payload) => {
      const match = /s(\d{3})$/.exec(String(payload?.sessionKey ?? ''));
      const seed = match ? Number(match[1]) : 0;
      return Array.from({ length: 2 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `seed ${seed} message ${index} ${'context '.repeat(12)}`,
        timestamp: 1_700_000_000_000 + seed * 10_000 + index,
        id: `seed-${seed}-${index}`,
      }));
    };
    ipcMain.removeHandler('gateway:rpc');
    ipcMain.handle('gateway:rpc', async (_event, method, params) => {
      if (method === 'sessions.list') return { sessions };
      if (method === 'chat.history') return { messages: historyFor(params) };
      return {};
    });
    ipcMain.removeHandler('gateway:status');
    ipcMain.handle('gateway:status', async () => ({ state: 'running', gatewayReady: true, port: 18789, pid: 42423, connectedAt: Date.now() }));

    const originalHostInvoke = ipcMain._invokeHandlers?.get('host:invoke');
    const respond = (id, data) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
    const workspace = {
      id: 'tf0423-workspace',
      name: 'TF0423',
      rootPath: 'D:/tmp/tf0423-workspace',
      agentId: 'main',
      selectedAgentId: 'main',
      activeSessionKey: 'agent:main:s000',
      agentBindings: { main: { workspaceId: 'tf0423-workspace', agentId: 'main', sessionKey: 'agent:main:s000' } },
      permissionMode: 'acceptEdits',
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
      state: {},
      sessionStates: Object.fromEntries(
        sessions
          .map((session) => session.key)
          .filter((key) => typeof key === 'string')
          .map((key) => [key, { activeTopicId: null }]),
      ),
    };
    const summaryCalls = [];
    globalThis.__tf0423SummaryCalls = summaryCalls;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request) => {
      if (request.module === 'gateway' && request.action === 'rpc') {
        const method = request.payload?.method;
        const params = request.payload?.params ?? {};
        if (method === 'sessions.list') return respond(request.id, { sessions });
        if (method === 'chat.history') return respond(request.id, { messages: historyFor(params) });
        return respond(request.id, {});
      }
      if (request.module === 'gateway' && request.action === 'status') {
        return respond(request.id, { state: 'running', gatewayReady: true, port: 18789, pid: 42423, connectedAt: Date.now() });
      }
      if (request.module === 'sessions' && request.action === 'summaries') {
        const startedAt = Date.now();
        const result = originalHostInvoke ? await originalHostInvoke(event, request) : respond(request.id, {});
        summaryCalls.push({ durationMs: Date.now() - startedAt, keys: request.payload?.sessionKeys?.length ?? null });
        return result;
      }
      if (request.module === 'workspaces' && (request.action === 'list' || request.action === 'getActive')) {
        if (request.action === 'list') {
          return respond(request.id, { success: true, profiles: [workspace], activeWorkspaceId: workspace.id, activeWorkspace: workspace });
        }
        return respond(request.id, { success: true, activeWorkspaceId: workspace.id, activeWorkspace: workspace });
      }
      return originalHostInvoke ? originalHostInvoke(event, request) : respond(request.id, {});
    });
  }, fixture.sessions);

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const loadStartedAt = Date.now();
  await page.reload().catch(() => {});
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="sidebar-session-agent:main:s"]').length > 0,
    undefined,
    { timeout: 120_000 },
  );
  const loadSessionsMs = Date.now() - loadStartedAt;

  // Let the label sweep settle before the switch window opens.
  await page.waitForTimeout(3_000);

  await page.evaluate(() => {
    globalThis.__tf0423LongTasksBefore = (window.__CLAWX_PERF_SNAPSHOT__?.().longTasks ?? []).length;
  });

  // Control window: how many long tasks does the app produce while simply idle?
  const controlBefore = await page.evaluate(() => (window.__CLAWX_PERF_SNAPSHOT__?.().longTasks ?? []).length);
  await page.waitForTimeout(2_500);
  const controlAfter = await page.evaluate(() => window.__CLAWX_PERF_SNAPSHOT__?.().longTasks ?? []);
  const idleLongTasks = controlAfter.slice(controlBefore).filter((task) => task.durationMs >= 50);

  // Open a session whose transcript is one of the large ones and record renderer long tasks.
  const longBefore = await page.evaluate(() => (window.__CLAWX_PERF_SNAPSHOT__?.().longTasks ?? []).length);
  const longOpenMs = await page.evaluate((k) => new Promise((resolvePromise) => {
    const started = performance.now();
    document.querySelector(`[data-testid="sidebar-session-${k}"]`)?.click();
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      resolvePromise(performance.now() - started);
    })));
  }), keyOf(0));
  await page.waitForTimeout(2_500);
  const longOpenDiagnostics = await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-testid^="chat-message-"]').length;
    const snapshot = window.__CLAWX_PERF_SNAPSHOT__?.() ?? null;
    return { rows, longTasks: snapshot?.longTasks ?? [] };
  });
  const longOpenLongTasks = longOpenDiagnostics.longTasks.slice(longBefore).filter((task) => task.durationMs >= 50);

  const switchKeys = Array.from({ length: SWITCH_COUNT }, (_, index) => keyOf(100 + index));
  const switchMs = [];
  for (const key of switchKeys) {
    const elapsed = await page.evaluate((k) => new Promise((resolvePromise) => {
      const started = performance.now();
      const button = document.querySelector(`[data-testid="sidebar-session-${k}"]`);
      button?.click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        resolvePromise(performance.now() - started);
      }));
    }), key);
    switchMs.push(elapsed);
    await page.waitForTimeout(150);
  }

  const renderer = await page.evaluate(() => {
    const snapshot = window.__CLAWX_PERF_SNAPSHOT__?.() ?? null;
    return { longTasks: snapshot?.longTasks ?? [] };
  });
  const summaryCalls = await app.evaluate(() => globalThis.__tf0423SummaryCalls ?? []);

  const beforeCount = await page.evaluate(() => globalThis.__tf0423LongTasksBefore ?? 0);
  const switchLongTasks = renderer.longTasks.slice(beforeCount).filter((task) => task.durationMs >= 50);

  const rssSamples = [];
  const idleDeadline = Date.now() + idleMs;
  while (Date.now() < idleDeadline) {
    const sample = await app.evaluate(() => ({ at: Date.now(), rssBytes: process.memoryUsage().rss }));
    rssSamples.push(sample);
    const remaining = idleDeadline - Date.now();
    if (remaining > 0) await page.waitForTimeout(Math.min(idleSampleMs, remaining));
  }
  const rssValues = rssSamples.map((s) => s.rssBytes).filter((v) => typeof v === 'number');
  let longestRise = 0;
  let currentRise = 1;
  for (let i = 1; i < rssValues.length; i += 1) {
    if (rssValues[i] > rssValues[i - 1]) { currentRise += 1; longestRise = Math.max(longestRise, currentRise); } else { currentRise = 1; }
  }
  const growthBytes = rssValues.length >= 2 ? rssValues[rssValues.length - 1] - rssValues[0] : 0;
  const persistentGrowth = rssValues.length >= 20 && longestRise >= Math.max(12, Math.ceil(rssValues.length * 0.6)) && growthBytes > 64 * 1024 * 1024;

  const report = {
    schema: 'clawx.tf0423.session-loading-probe/v1',
    driven_by: 'agent',
    actor: 'codex-tf0423-session-probe',
    candidate: process.env.TF0423_CANDIDATE ?? null,
    completedAt: new Date().toISOString(),
    platform: process.platform,
    node: process.version,
    fixture: { sessionCount: SESSION_COUNT, transcriptBytes: fixture.bytes, transcriptMiB: Number((fixture.bytes / 1024 / 1024).toFixed(2)) },
    loadSessionsMs,
    idleLongTaskControl: { windowMs: 2_500, longTasksOver50Ms: idleLongTasks },
    longSessionOpen: { sessionKey: keyOf(0), transcriptBytes: TRANSCRIPT_BYTES, durationMs: longOpenMs, renderedRows: longOpenDiagnostics.rows, longTasksOver50Ms: longOpenLongTasks },
    sessionSwitch: { count: switchMs.length, durationsMs: switchMs, p50Ms: percentile(switchMs, 0.5), p95Ms: percentile(switchMs, 0.95), longTasksOver50Ms: switchLongTasks },
    summariesHostCall: {
      calls: summaryCalls,
      requestedKeys: summaryCalls[0]?.keys ?? null,
      durationMs: summaryCalls[0]?.durationMs ?? null,
      durationP50Ms: percentile(summaryCalls.map((c) => c.durationMs).filter((v) => typeof v === 'number'), 0.5),
    },
    idleRss: { durationMs: idleMs, sampleMs: idleSampleMs, samples: rssSamples, longestMonotonicRise: longestRise, growthBytes, persistentGrowth },
    boundaries: [
      'Gateway RPC is agent-mocked; sessions.summaries is the real Electron host service reading synthetic local transcripts.',
      'Synthetic transcripts contain no private user content and are generated at runtime.',
      'Timing is a local Windows Electron sample, not a cross-platform benchmark.',
      'Switch latency is click -> two settled animation frames so the same probe runs on pre-change and post-change builds.',
    ],
  };

  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    output,
    loadSessionsMs: report.loadSessionsMs,
    switchP50Ms: report.sessionSwitch.p50Ms,
    switchP95Ms: report.sessionSwitch.p95Ms,
    requestedKeys: report.summariesHostCall.requestedKeys,
    summariesMs: report.summariesHostCall.durationMs,
    longSessionOpenMs: report.longSessionOpen.durationMs,
    idleLongTasks: report.idleLongTaskControl.longTasksOver50Ms.length,
    longSessionRenderedRows: report.longSessionOpen.renderedRows,
    longSessionLongTasks: report.longSessionOpen.longTasksOver50Ms.length,
    switchLongTasks: report.sessionSwitch.longTasksOver50Ms.length,
    persistentGrowth,
  }, null, 2) + '\n');
} finally {
  try { await app.close(); } catch {
    const { spawn } = await import('node:child_process');
    spawn('taskkill', ['/F', '/T', '/PID', String(app.process().pid)], { stdio: 'ignore', windowsHide: true });
  }
  if (process.env.CLAWX_E2E_KEEP_TEMP !== '1') {
    await rm(runRoot, { recursive: true, force: true }).catch(() => {});
  }
}