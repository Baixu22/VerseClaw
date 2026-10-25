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
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';

const execFileAsync = promisify(execFile);

async function allocatePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to allocate Gateway port'));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function hostInvoke(app, module, action, payload = null) {
  const response = await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule.require('electron');
    const handler = ipcMain._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is unavailable');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('no BrowserWindow for host:invoke');
    const sender = win.webContents;
    return await handler(
      { sender, senderFrame: { url: sender.getURL() } },
      { id: `f2-${Date.now()}-${Math.random()}`, ...request },
    );
  }, { module, action, payload });
  if (!response?.ok) throw new Error(`[${response?.error?.code ?? 'HOST'}] ${response?.error?.message ?? 'host invoke failed'}`);
  return response.data;
}

async function readRuntimeAck(app) {
  const deadline = Date.now() + 120_000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await hostInvoke(app, 'gateway', 'rpc', { method: 'runtime.flags.ack', params: {}, timeoutMs: 30_000 });
      if (typeof last?.childPid === 'number') return last;
    } catch { /* child is between restart and ready */ }
    await new Promise((done) => setTimeout(done, 1_000));
  }
  throw new Error(`runtime.flags.ack did not expose a Gateway child: ${JSON.stringify(last)}`);
}

async function readProcessRss(ids) {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return {};
  const script = `$ids = @(${unique.join(',')}); Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64 | ConvertTo-Json -Compress`;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, encoding: 'utf8', timeout: 10_000,
    });
    const parsed = stdout.trim() ? JSON.parse(stdout.trim()) : [];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return Object.fromEntries(rows.map((row) => [String(row.Id), Number(row.WorkingSet64)]));
  } catch {
    return {};
  }
}


function startMockLlm() {
  const log = [];
  return new Promise((resolveReady, rejectReady) => {
    const server = createHttpServer((req, res) => {
      const url = req.url ?? '';
      if (!url.includes('/chat/completions')) {
        if (url.includes('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: MOCK_MODEL_ID }] }));
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        const userText = (Array.isArray(parsed.messages) ? parsed.messages : [])
          .filter((message) => message?.role === 'user')
          .map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''))
          .join('\n');
        const seed = /F2-SEED-LARGE-(\d+)/.exec(userText);
        const continuation = /F2-CONTINUATION-(\d+)/.exec(userText);
        const reply = seed
          ? `F2-LARGE-REPLY ${seed[1]} ${FILLER.repeat(Math.max(1, Math.ceil(LARGE_REPLY_BYTES / FILLER.length))).slice(0, Math.max(0, LARGE_REPLY_BYTES - 40))}`
          : continuation
            ? `F2-CONT-REPLY ${continuation[1]}`
            : 'F2-IDLE-REPLY';
        log.push({ at: Date.now(), seed: seed?.[1] ?? null, continuation: continuation?.[1] ?? null, chars: userText.length });
        const usage = { prompt_tokens: 100, completion_tokens: Math.ceil(reply.length / 4), total_tokens: 120 };
        if (parsed.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          const chunk = (delta, finish) => `data: ${JSON.stringify({ id: 'chatcmpl-f2', object: 'chat.completion.chunk', created: 1, model: MOCK_MODEL_ID, choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage } : {}) })}\n\n`;
          res.write(chunk({ role: 'assistant', content: reply }, null));
          res.write(chunk({}, 'stop'));
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-f2', object: 'chat.completion', created: 1, model: MOCK_MODEL_ID,
          choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
          usage,
        }));
      });
    });
    server.once('error', rejectReady);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectReady(new Error('mock llm port failed'));
        return;
      }
      resolveReady({ server, port: address.port, log, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

async function directoryBytes(dir) {
  let bytes = 0;
  let files = 0;
  const walk = async (current) => {
    let entries = [];
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) { await walk(child); continue; }
      if (!entry.isFile()) continue;
      try {
        const info = await stat(child);
        bytes += info.size;
        files += 1;
      } catch { /* file vanished mid-walk */ }
    }
  };
  await walk(dir);
  return { bytes, files, mib: Number((bytes / 1024 / 1024).toFixed(2)) };
}

async function listProcessTree(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return { rootPid: null, pids: [], descendants: 0, unavailable: true };
  let rows = [];
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
    ], { windowsHide: true, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    const parsed = stdout.trim() ? JSON.parse(stdout.trim()) : [];
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return { rootPid, pids: [], descendants: 0, unavailable: true };
  }
  const childrenOf = new Map();
  for (const row of rows) {
    const pid = Number(row?.ProcessId);
    const parent = Number(row?.ParentProcessId);
    if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue;
    const list = childrenOf.get(parent) ?? [];
    list.push(pid);
    childrenOf.set(parent, list);
  }
  const pids = [];
  const seen = new Set();
  const stack = [...(childrenOf.get(rootPid) ?? [])];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    pids.push(pid);
    stack.push(...(childrenOf.get(pid) ?? []));
  }
  return { rootPid, pids: pids.sort((left, right) => left - right), descendants: pids.length, unavailable: false };
}

async function readTextIfPresent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function groupHostCalls(calls) {
  const grouped = new Map();
  for (const call of calls) {
    const key = `${call.module}.${call.action}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...grouped.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

const root = resolve(process.argv[2] ?? process.cwd());
const output = resolve(process.argv[3] ?? join(root, 'artifacts/tf0423-session-loading.json'));
const runRoot = resolve(process.argv[4] ?? join(process.env.TMP ?? process.env.TEMP ?? root, 'tf0423-session-loading'));
const idleMs = Number(process.env.TF0423_IDLE_MS ?? 300_000);
const idleSampleMs = Number(process.env.TF0423_IDLE_SAMPLE_MS ?? 5_000);
const SWITCH_COUNT = 5;
const SESSION_COUNT = Number(process.env.TF0423_SESSION_COUNT ?? 333);
const TRANSCRIPT_BYTES = 180_000;
const COMPACT_SESSION_COUNT = Number(process.env.TF0423_COMPACT_SESSIONS ?? 5);
const HIDDEN_WINDOW_MS = Number(process.env.TF0423_HIDDEN_MS ?? 20_000);
const LARGE_REPLY_BYTES = Number(process.env.TF0423_LARGE_REPLY_BYTES ?? 150_000);
const MOCK_MODEL_ID = 'f2-mock-model';
const FILLER = 'The long session transcript records one deterministic engineering turn with measured latency, owner attribution, bounded background work and explicit unmeasured scope. ';

const keyOf = (i) => `agent:main:s${String(i).padStart(3, '0')}`;
const switchBase = Math.max(0, SESSION_COUNT - 20);
const percentile = (values, ratio) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? null;
};

function summarizeSeries(samples, key) {
  const values = samples.map((sample) => sample[key]).filter((value) => typeof value === 'number' && Number.isFinite(value));
  let longestRise = 0;
  let currentRise = values.length > 0 ? 1 : 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[index - 1]) {
      currentRise += 1;
      longestRise = Math.max(longestRise, currentRise);
    } else {
      currentRise = 1;
    }
  }
  return {
    samples: values.length,
    firstBytes: values[0] ?? null,
    lastBytes: values.at(-1) ?? null,
    peakBytes: values.length > 0 ? Math.max(...values) : null,
    growthBytes: values.length >= 2 ? values.at(-1) - values[0] : null,
    longestMonotonicRise: longestRise,
  };
}

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

// Isolated runtime config: written to Main's config dir, the isolated home and
// the source-runtime state dir, because source-runtime isolation owns the
// Gateway's real config (see artifacts/first-product-preview/_map-e2e-harness.md).
const sourceStateDir = join(userDataDir, 'openclaw-source-state');
const runtimeWorkspace = join(runRoot, 'runtime-workspace');
const runtimeSessionsDir = join(sourceStateDir, 'agents', 'main', 'sessions');
const mockLlm = await startMockLlm();
const runtimeConfig = {
  gateway: { mode: 'local', controlUi: { enabled: false } },
  models: {
    mode: 'merge',
    providers: {
      openai: {
        api: 'openai-completions',
        apiKey: 'f2-probe-agent-key',
        baseUrl: `http://127.0.0.1:${mockLlm.port}/v1`,
        models: [{
          id: MOCK_MODEL_ID,
          name: MOCK_MODEL_ID,
          api: 'openai-completions',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
        }],
      },
    },
  },
  runtime: {
    contextBlock: { 'working-memory': { enabled: true }, 'tool-registry': { enabled: true } },
  },
  agents: {
    defaults: {
      model: { primary: `openai/${MOCK_MODEL_ID}`, fallbacks: [] },
      workspace: runtimeWorkspace,
      skipBootstrap: true,
    },
    list: [{ id: 'main', default: true }],
  },
  skills: { allowBundled: [] },
};
const serializedRuntimeConfig = `${JSON.stringify(runtimeConfig, null, 2)}\n`;
await mkdir(runtimeWorkspace, { recursive: true });
await mkdir(sourceStateDir, { recursive: true });
await mkdir(join(homeDir, '.openclaw'), { recursive: true });
await mkdir(configDir, { recursive: true });
await writeFile(join(configDir, 'openclaw.json'), serializedRuntimeConfig, 'utf8');
await writeFile(join(sourceStateDir, 'openclaw.json'), serializedRuntimeConfig, 'utf8');
await writeFile(join(homeDir, '.openclaw', 'openclaw.json'), serializedRuntimeConfig, 'utf8');

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
    '--js-flags=--expose-gc',
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
  // The app registers its own host:invoke/gateway:rpc handlers during startup.
  // Installing the probe intercept first made Electron abort initialization with
  // 'Attempted to register a second handler', so wait for the rendered shell.
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(
    () => Boolean(document.querySelector('[data-testid="main-layout"]')),
    undefined,
    { timeout: 60_000 },
  ).catch(() => {});
  const interceptReceipt = await app.evaluate(async (_ctx, sessions) => {
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
    const originalHostInvoke = ipcMain._invokeHandlers?.get('host:invoke');
    // ResourceFabric blocks Gateway mutations while the real active workspace is
    // read-only, so capture it before the probe replaces the host:invoke route.
    const realWindow = process.mainModule.require('electron').BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    const realActiveResponse = (originalHostInvoke && realWindow)
      ? await originalHostInvoke(
          { sender: realWindow.webContents, senderFrame: { url: realWindow.webContents.getURL() } },
          { id: 'f2-real-active-workspace', module: 'workspaces', action: 'getActive' },
        )
      : null;
    globalThis.__f2RealActiveWorkspace = realActiveResponse?.data?.activeWorkspace ?? null;
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
    const hostCalls = [];
    globalThis.__f2HostCalls = hostCalls;
    const realSessionKeys = new Set();
    globalThis.__f2RealSessionKeys = realSessionKeys;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request) => {
      hostCalls.push({ at: Date.now(), module: request.module, action: request.action });
      if (request.module === 'gateway' && request.action === 'rpc') {
        const method = request.payload?.method;
        const params = request.payload?.params ?? {};
        const requestKey = String(params?.sessionKey ?? params?.key ?? '');
        if (method === 'sessions.list') return respond(request.id, { sessions });
        if (method === 'chat.history') {
          if (requestKey && realSessionKeys.has(requestKey)) {
            return originalHostInvoke ? originalHostInvoke(event, request) : respond(request.id, { messages: [] });
          }
          return respond(request.id, { messages: historyFor(params) });
        }
        return originalHostInvoke ? originalHostInvoke(event, request) : respond(request.id, {});
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
    return { capturedOriginalHandler: typeof originalHostInvoke === 'function' };
  }, fixture.sessions);

  if (!interceptReceipt?.capturedOriginalHandler) {
    throw new Error('F2 probe intercept ran before the app registered its host:invoke handler');
  }
  const interceptProbe = await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.list', params: {} });
  if (!Array.isArray(interceptProbe?.sessions) || interceptProbe.sessions.length !== fixture.sessions.length) {
    throw new Error(`F2 probe intercept is not active: ${JSON.stringify(interceptProbe).slice(0, 200)}`);
  }
  let realWorkspace = await app.evaluate(() => globalThis.__f2RealActiveWorkspace ?? null);
  if (!realWorkspace?.id) {
    const createdWorkspace = await hostInvoke(app, 'workspaces', 'create', {
      name: 'F2 probe workspace',
      rootPath: runtimeWorkspace,
      permissionMode: 'fullAccess',
      agentId: 'main',
    });
    realWorkspace = createdWorkspace?.activeWorkspace ?? createdWorkspace?.profiles?.[0] ?? null;
  }
  if (!realWorkspace?.id) throw new Error(`F2 probe has no real workspace: ${JSON.stringify(realWorkspace).slice(0, 300)}`);
  const permissionUpdate = await hostInvoke(app, 'workspaces', 'update', {
    id: realWorkspace.id,
    permissionMode: 'fullAccess',
  });
  if (permissionUpdate?.success === false) {
    throw new Error(`F2 probe could not raise workspace permission: ${JSON.stringify(permissionUpdate).slice(0, 300)}`);
  }
  const runtimeWorkspaceReceipt = {
    id: realWorkspace.id,
    rootPath: realWorkspace.rootPath ?? null,
    permissionMode: 'fullAccess',
    updateSuccess: permissionUpdate?.success ?? null,
  };
  const gatewayPort = await allocatePort();
  await hostInvoke(app, 'settings', 'set', { key: 'gatewayPort', value: gatewayPort });
  await hostInvoke(app, 'gateway', 'start');
  const runtimeAck = await readRuntimeAck(app);
  const mainPid = app.process().pid;
  const rendererPid = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())?.webContents.getOSProcessId() ?? null);
  const gatewayPid = Number(runtimeAck.childPid);
  const mainGcAvailable = await app.evaluate(() => typeof globalThis.gc === 'function');
  const rendererGcAvailable = await page.evaluate(() => typeof globalThis.gc === 'function');
  if (!mainGcAvailable || !rendererGcAvailable) {
    throw new Error(`explicit GC gate unavailable: main=${mainGcAvailable} renderer=${rendererGcAvailable}`);
  }
  if (mainGcAvailable) await app.evaluate(() => globalThis.gc?.());
  if (rendererGcAvailable) await page.evaluate(() => globalThis.gc?.());
  const createdSession = await hostInvoke(app, 'gateway', 'rpc', {
    method: 'sessions.create',
    params: { agentId: 'main', label: 'F2 long-use probe session' },
    timeoutMs: 60_000,
  });
  const probeSessionKey = createdSession?.key ?? createdSession?.sessionKey ?? createdSession?.entry?.key ?? createdSession?.entry?.sessionKey ?? createdSession?.session?.key ?? createdSession?.result?.key ?? null;
  if (!probeSessionKey) throw new Error(`F2 probe could not create a real session: ${JSON.stringify(createdSession)?.slice(0, 400)}`);
  const ownerBefore = await hostInvoke(app, 'sessionActivity', 'snapshot', {
    sessionKey: probeSessionKey,
    workspaceId: 'tf0423-workspace',
  });


  // --- F2 real-runtime phase: large transcript, manual compaction, continuation ---
  const transcriptFiles = async () => {
    let entries = [];
    try {
      entries = await readdir(runtimeSessionsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const full = join(runtimeSessionsDir, entry.name);
      const info = await stat(full).catch(() => null);
      files.push({ full, mtimeMs: info?.mtimeMs ?? 0, bytes: info?.size ?? 0 });
    }
    return files.sort((left, right) => right.mtimeMs - left.mtimeMs);
  };
  const findTranscriptForMarker = async (marker, sinceMs) => {
    const files = await transcriptFiles();
    for (const file of files) {
      if (file.mtimeMs < sinceMs - 5_000) continue;
      const body = await readTextIfPresent(file.full);
      if (body && body.includes(marker)) return file;
    }
    return null;
  };
  const waitForTranscriptMarker = async (marker, sinceMs, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const file = await findTranscriptForMarker(marker, sinceMs);
      if (file) return file;
      await new Promise((done) => setTimeout(done, 100));
    }
    return null;
  };

  const compactSamples = [];
  const continuationSamples = [];
  for (let index = 0; index < COMPACT_SESSION_COUNT; index += 1) {
    const created = await hostInvoke(app, 'gateway', 'rpc', {
      method: 'sessions.create',
      params: { agentId: 'main', label: `F2 long-use session ${index}` },
      timeoutMs: 60_000,
    });
    const sessionKey = created?.key ?? created?.sessionKey ?? created?.entry?.key ?? created?.entry?.sessionKey ?? created?.session?.key ?? created?.result?.key ?? null;
    if (!sessionKey) throw new Error(`F2 probe could not create real session ${index}: ${JSON.stringify(created)?.slice(0, 400)}`);
    await app.evaluate((_electron, key) => globalThis.__f2RealSessionKeys?.add(key), sessionKey);

    const seedStartedAt = Date.now();
    await hostInvoke(app, 'chat', 'sendWithMedia', {
      sessionKey,
      message: `F2-SEED-LARGE-${index}`,
      idempotencyKey: `f2-seed-large-${index}`,
    });
    const seeded = await waitForTranscriptMarker(`F2-LARGE-REPLY ${index}`, seedStartedAt, 180_000);
    if (!seeded) throw new Error(`F2 probe large transcript was not written for session ${index}`);
    const transcriptBytesBeforeCompact = seeded.bytes;

    // Wait for the runtime to report the session can compact; a compact that
    // arrives while the run is still active is refused, not queued.
    const compactReadyDeadline = Date.now() + 90_000;
    let preCompactStatus = null;
    let compactReadyWaits = 0;
    while (Date.now() < compactReadyDeadline) {
      preCompactStatus = await hostInvoke(app, 'sessions', 'compactionStatus', { sessionKey, agentId: 'main' });
      if (preCompactStatus?.canCompact === true) break;
      compactReadyWaits += 1;
      await new Promise((done) => setTimeout(done, 250));
    }
    if (preCompactStatus?.canCompact !== true) {
      throw new Error(`F2 compact never became available for ${sessionKey}: ${JSON.stringify(preCompactStatus)?.slice(0, 300)}`);
    }
    const compactStartedAt = Date.now();
    const compactResult = await hostInvoke(app, 'sessions', 'compact', { sessionKey, agentId: 'main' });
    const compactDurationMs = Date.now() - compactStartedAt;
    compactSamples.push({
      index,
      sessionKey,
      durationMs: compactDurationMs,
      status: compactResult?.status ?? null,
      compacted: compactResult?.compacted ?? null,
      tokensBefore: compactResult?.tokensBefore ?? null,
      tokensAfter: compactResult?.tokensAfter ?? null,
      transcriptBytesBeforeCompact,
      error: compactResult?.error ?? null,
      compactReadyWaits,
      preCompactStatus: {
        canCompact: preCompactStatus?.canCompact ?? null,
        tokensBefore: preCompactStatus?.tokensBefore ?? null,
        messageCount: preCompactStatus?.messageCount ?? null,
      },
    });

    const continuationStartedAt = Date.now();
    await hostInvoke(app, 'chat', 'sendWithMedia', {
      sessionKey,
      message: `F2-CONTINUATION-${index}`,
      idempotencyKey: `f2-continuation-${index}`,
    });
    const continued = await waitForTranscriptMarker(`F2-CONT-REPLY ${index}`, continuationStartedAt, 90_000);
    continuationSamples.push({
      index,
      sessionKey,
      durationMs: Date.now() - continuationStartedAt,
      observed: continued !== null,
      transcriptBytesAfter: continued?.bytes ?? null,
    });
    if (!continued) throw new Error(`F2 probe continuation was not observed for session ${index}`);
  }
  globalThis.__f2CompactSamples = compactSamples;
  globalThis.__f2ContinuationSamples = continuationSamples;

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
  // Let the post-switch render/commit settle before attributing tasks to the long-session open.
  await page.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
  const longOpenMs = await page.evaluate((k) => new Promise((resolvePromise) => {
    const started = performance.now();
    document.querySelector(`[data-testid="sidebar-session-${k}"]`)?.click();
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      resolvePromise(performance.now() - started);
    })));
  }), keyOf(Math.max(0, SESSION_COUNT - 1)));
  await page.waitForTimeout(2_500);
  const longOpenDiagnostics = await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-testid^="chat-message-"]').length;
    const snapshot = window.__CLAWX_PERF_SNAPSHOT__?.() ?? null;
    return { rows, longTasks: snapshot?.longTasks ?? [] };
  });
  const longOpenLongTasks = longOpenDiagnostics.longTasks.slice(longBefore).filter((task) => task.durationMs >= 50);

  const switchKeys = Array.from({ length: SWITCH_COUNT }, (_, index) => keyOf(switchBase + index));
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


  // --- hidden UI window: no background re-hydration or duplicate notifications ---
  const hiddenCallsBefore = await app.evaluate(() => (globalThis.__f2HostCalls ?? []).length);
  const hiddenLongTasksBefore = await page.evaluate(() => (window.__CLAWX_PERF_SNAPSHOT__?.().longTasks ?? []).length);
  const hiddenStartedAt = Date.now();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((win) => win.hide()));
  await page.waitForTimeout(HIDDEN_WINDOW_MS);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((win) => win.show()));
  const hiddenWindowMs = Date.now() - hiddenStartedAt;
  const hiddenCalls = await app.evaluate((_electron, from) => (globalThis.__f2HostCalls ?? []).slice(from), hiddenCallsBefore);
  const hiddenLongTasks = await page.evaluate((from) => (window.__CLAWX_PERF_SNAPSHOT__?.().longTasks ?? [])
    .slice(from)
    .filter((task) => task.durationMs >= 50), hiddenLongTasksBefore);
  const hiddenRehydrations = hiddenCalls.filter((call) => call.module === 'sessions' && call.action === 'summaries');

  const processTree = await listProcessTree(mainPid);
  const gatewayProcessTree = gatewayPid ? await listProcessTree(gatewayPid) : null;
  const diskUsage = {
    runRoot: await directoryBytes(runRoot),
    fixtureTranscripts: await directoryBytes(join(configDir, 'agents', 'main', 'sessions')),
    runtimeState: await directoryBytes(sourceStateDir),
    runtimeTranscripts: await directoryBytes(runtimeSessionsDir),
  };

  const rssSamples = [];
  const idleDeadline = Date.now() + idleMs;
  while (Date.now() < idleDeadline) {
    const mainRssBytes = await app.evaluate(() => process.memoryUsage().rss);
    const processRss = await readProcessRss([rendererPid, gatewayPid]);
    rssSamples.push({
      at: Date.now(),
      mainRssBytes,
      rendererRssBytes: rendererPid ? processRss[String(rendererPid)] ?? null : null,
      gatewayRssBytes: gatewayPid ? processRss[String(gatewayPid)] ?? null : null,
    });
    const remaining = idleDeadline - Date.now();
    if (remaining > 0) await page.waitForTimeout(Math.min(idleSampleMs, remaining));
  }
  const ownerAfter = await hostInvoke(app, 'sessionActivity', 'snapshot', {
    sessionKey: probeSessionKey,
    workspaceId: 'tf0423-workspace',
  });
  const mainRss = summarizeSeries(rssSamples, 'mainRssBytes');
  const rendererRss = summarizeSeries(rssSamples, 'rendererRssBytes');
  const gatewayRss = summarizeSeries(rssSamples, 'gatewayRssBytes');
  const persistentGrowth = mainRss.samples >= 20
    && mainRss.longestMonotonicRise >= Math.max(12, Math.ceil(mainRss.samples * 0.6))
    && (mainRss.growthBytes ?? 0) > 64 * 1024 * 1024;

  const report = {
    schema: 'clawx.tf0423.session-loading-probe/v1',
    driven_by: 'agent',
    actor: 'codex-tf0423-session-probe',
    candidate: process.env.TF0423_CANDIDATE ?? null,
    completedAt: new Date().toISOString(),
    platform: process.platform,
    node: process.version,
    fixture: { sessionCount: SESSION_COUNT, transcriptBytes: fixture.bytes, transcriptMiB: Number((fixture.bytes / 1024 / 1024).toFixed(2)) },
    runtimeWorkspace: runtimeWorkspaceReceipt,
    processes: { mainPid, rendererPid, gatewayPid, gatewayGeneration: runtimeAck.gatewayGeneration ?? null },
    explicitGc: { mainAvailable: mainGcAvailable, rendererAvailable: rendererGcAvailable },
    ownerAttribution: {
      sessionKey: probeSessionKey,
      before: ownerBefore?.snapshot?.resources ?? null,
      after: ownerAfter?.snapshot?.resources ?? null,
      beforeContinuityQueueCount: ownerBefore?.snapshot?.continuity?.queueCount ?? null,
      afterContinuityQueueCount: ownerAfter?.snapshot?.continuity?.queueCount ?? null,
      afterCompletionBatches: ownerAfter?.snapshot?.completionBatches ?? null,
      firstCompactSession: compactSamples[0]?.sessionKey ?? null,
      realSessionKeys: compactSamples.map((sample) => sample.sessionKey),
    },
    loadSessionsMs,
    idleLongTaskControl: { windowMs: 2_500, longTasksOver50Ms: idleLongTasks },
    longSessionOpen: { sessionKey: keyOf(Math.max(0, SESSION_COUNT - 1)), transcriptBytes: TRANSCRIPT_BYTES, durationMs: longOpenMs, renderedRows: longOpenDiagnostics.rows, longTasksOver50Ms: longOpenLongTasks },
    sessionSwitch: { count: switchMs.length, durationsMs: switchMs, p50Ms: percentile(switchMs, 0.5), p95Ms: percentile(switchMs, 0.95), longTasksOver50Ms: switchLongTasks },
    compact: {
      count: compactSamples.length,
      samples: compactSamples,
      durationsMs: compactSamples.map((sample) => sample.durationMs),
      p50Ms: percentile(compactSamples.map((sample) => sample.durationMs), 0.5),
      p95Ms: percentile(compactSamples.map((sample) => sample.durationMs), 0.95),
      compactedCount: compactSamples.filter((sample) => sample.compacted === true).length,
    },
    continuation: {
      count: continuationSamples.length,
      samples: continuationSamples,
      durationsMs: continuationSamples.map((sample) => sample.durationMs),
      p50Ms: percentile(continuationSamples.map((sample) => sample.durationMs), 0.5),
      p95Ms: percentile(continuationSamples.map((sample) => sample.durationMs), 0.95),
      observedCount: continuationSamples.filter((sample) => sample.observed).length,
    },
    hiddenWindow: {
      windowMs: hiddenWindowMs,
      hostCalls: hiddenCalls,
      hostCallsByTarget: groupHostCalls(hiddenCalls),
      labelRehydrationCalls: hiddenRehydrations.length,
      longTasksOver50Ms: hiddenLongTasks,
    },
    processTree: { main: processTree, gateway: gatewayProcessTree },
    diskUsage,
    mockLlm: { requests: mockLlm.log.length, port: mockLlm.port, log: mockLlm.log },
    summariesHostCall: {
      calls: summaryCalls,
      requestedKeys: summaryCalls[0]?.keys ?? null,
      durationMs: summaryCalls[0]?.durationMs ?? null,
      durationP50Ms: percentile(summaryCalls.map((c) => c.durationMs).filter((v) => typeof v === 'number'), 0.5),
    },
    idleRss: { durationMs: idleMs, sampleMs: idleSampleMs, samples: rssSamples, main: mainRss, renderer: rendererRss, gateway: gatewayRss, persistentGrowth },
    boundaries: [
      'Only session-list/history Gateway RPCs are agent-mocked; a real Gateway child is started for process identity and a real session inventory read.',
      'Synthetic transcripts contain no private user content and are generated at runtime.',
      'Timing is a local Windows Electron sample, not a cross-platform benchmark.',
        'Switch latency is click -> two settled animation frames so the same probe runs on pre-change and post-change builds.',
        'Compaction and continuation are measured against the real Gateway child with the large transcript the runtime itself wrote through the agent-driven mock provider.',
        'Continuation latency is send -> assistant reply persisted in the runtime transcript; it is a local Windows sample, not a cross-platform benchmark.',
        'The 333-session sidebar fixture is agent-generated; the real per-session owner inventory is read through sessionActivity.snapshot.',
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
    compactP50Ms: report.compact.p50Ms,
    compactP95Ms: report.compact.p95Ms,
    continuationP50Ms: report.continuation.p50Ms,
    continuationP95Ms: report.continuation.p95Ms,
    hiddenLabelRehydrationCalls: report.hiddenWindow.labelRehydrationCalls,
    hiddenLongTasks: report.hiddenWindow.longTasksOver50Ms.length,
    processTreeSize: report.processTree.main.descendants,
    runtimeTranscriptMiB: report.diskUsage.runtimeTranscripts.mib,
  }, null, 2) + '\n');
} finally {
  try { await app.close(); } catch {
    const { spawn } = await import('node:child_process');
    spawn('taskkill', ['/F', '/T', '/PID', String(app.process().pid)], { stdio: 'ignore', windowsHide: true });
  }
  await mockLlm.close().catch(() => {});
  if (process.env.CLAWX_E2E_KEEP_TEMP !== '1') {
    await rm(runRoot, { recursive: true, force: true }).catch(() => {});
  }
}
