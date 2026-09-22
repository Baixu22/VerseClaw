// Real ClawX product journey driver (Playwright over Electron CDP, host API via renderer IPC).
// Usage: SENSEAUDIO_API_KEY=... node driver.mjs [--repo D:/ClawX] [--timeout-min 20]
// The key is passed to the app only through the providers.save host call; it is never written by this script.
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, readdir, cp, stat } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import net from 'node:net';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(Boolean));
const repo = resolve(args.repo ?? 'D:/ClawX');
const timeoutMin = Number(args['timeout-min'] ?? 20);
const apiKey = process.env.SENSEAUDIO_API_KEY;
const providerStore = args['provider-store'];
if (!apiKey && !providerStore) throw new Error('Supply SENSEAUDIO_API_KEY or --provider-store from an existing isolated run');

const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const { DatabaseSync } = await import('node:sqlite');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = resolve(args['data-root'] ?? 'C:/Users/27933/AppData/Local/ClawX-live-data/journey-20260922-j04-r2', stamp);
const homeDir = join(root, 'home');
const userDataDir = join(root, 'user-data');
const workspaceDir = join(root, 'workspace');
const evidenceDir = join(root, 'evidence');
for (const d of [join(homeDir, '.config'), join(homeDir, 'AppData', 'Local'), join(homeDir, 'AppData', 'Roaming'), userDataDir, workspaceDir, join(evidenceDir, 'screenshots')]) await mkdir(d, { recursive: true });
await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en' }, null, 2));

if (providerStore) await cp(resolve(providerStore), join(userDataDir, 'clawx-providers.json'));
const events = [];
const log = (event, data = {}) => { const row = { t: new Date().toISOString(), event, ...data }; events.push(row); appendFileSync(join(evidenceDir, 'events.jsonl'), JSON.stringify(row) + '\n'); console.log(JSON.stringify(row)); };
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (...a) => execFileSync('C:/Program Files/Git/cmd/git.exe', a, { cwd: repo, encoding: 'utf8' }).trim();

// --- workload: a tiny Node project with a real bug and a real test ---
await cp(join(resolve(import.meta.dirname), 'workload'), workspaceDir, { recursive: true });
async function snapshotWorkspace() {
  const out = {};
  for (const f of await readdir(workspaceDir, { recursive: true })) {
    const p = join(workspaceDir, f); const s = await stat(p);
    if (s.isFile() && !f.includes('node_modules')) out[f.replaceAll('\\', '/')] = { bytes: s.size, sha256: sha256(await readFile(p)) };
  }
  return out;
}
function runTests() {
  const r = spawnSync(process.execPath, ['--test'], { cwd: workspaceDir, encoding: 'utf8', timeout: 60_000 });
  return { exitCode: r.status, stdout: r.stdout.slice(-4000), stderr: r.stderr.slice(-4000) };
}
const before = { files: await snapshotWorkspace(), tests: runTests() };
log('workspace.before', { files: Object.keys(before.files), testExit: before.tests.exitCode });

// --- launch ---
const allocatePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const hostApiPort = await allocatePort(); const cdpPort = await allocatePort();
const electronBinary = join(repo, 'node_modules', 'electron', 'dist', (await readFile(join(repo, 'node_modules', 'electron', 'path.txt'), 'utf8')).trim());
const candidate = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), statusPorcelain: git('status', '--porcelain', '--untracked-files=all'), sourceStatusPorcelain: git('status', '--porcelain', '--', 'src', 'electron', 'shared', 'openclaw_runtime/src') };
candidate.dirty = candidate.statusPorcelain.length > 0;
await writeFile(join(evidenceDir, 'candidate.json'), JSON.stringify(candidate, null, 2));
if (candidate.dirty) throw new Error('Candidate must be clean before Electron launch');
const dist = {};
for (const f of ['dist/index.html', 'dist-electron/main/index.js', 'openclaw_runtime/dist/entry.js']) { const s = await stat(join(repo, f)); dist[f] = { mtime: s.mtime.toISOString(), bytes: s.size }; }
log('launch.begin', { candidate, dist, hostApiPort, cdpPort, root });
const appLog = [];
const app = await electron.launch({
  executablePath: electronBinary,
  args: ['--lang=en-US', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--in-process-gpu', join(repo, 'dist-electron', 'main', 'index.js')],
  env: Object.fromEntries(Object.entries({
    ...process.env, SENSEAUDIO_API_KEY: undefined,
    OPENCLAW_RC02_SHADOW_CENSUS: '1', OPENCLAW_RC03_SEAL: '1',
    HOME: homeDir, USERPROFILE: homeDir, APPDATA: join(homeDir, 'AppData', 'Roaming'), LOCALAPPDATA: join(homeDir, 'AppData', 'Local'), XDG_CONFIG_HOME: join(homeDir, '.config'),
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', LANGUAGE: 'en',
    VERSE_CLAW_E2E: '1', CLAWX_AGENT_DEV: '1', VERSE_CLAW_E2E_SKIP_SETUP: '1',
    VERSE_CLAW_USER_DATA_DIR: userDataDir, VERSE_CLAW_PORT_CLAWX_HOST_API: String(hostApiPort), VERSE_CLAW_REMOTE_DEBUGGING_PORT: String(cdpPort),
  }).filter(([, v]) => v !== undefined)),
  timeout: 120_000,
});
app.process().stdout?.on('data', (c) => appLog.push(`[out] ${c}`));
app.process().stderr?.on('data', (c) => appLog.push(`[err] ${c}`));
const page = await app.firstWindow();
await page.waitForFunction(() => typeof window.verseClaw?.hostInvoke === 'function', null, { timeout: 120_000 });
log('launch.ready', { url: page.url() });
const shot = async (name) => { await page.screenshot({ path: join(evidenceDir, 'screenshots', `${name}.png`) }).catch(() => {}); };
const host = async (module, action, payload) => {
  const r = await page.evaluate(({ module, action, payload }) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module, action, payload }), { module, action, payload });
  log('host', { module, action, ok: r?.ok ?? null, error: r?.error ?? undefined, dataKeys: r?.data && typeof r.data === 'object' ? Object.keys(r.data).slice(0, 12) : typeof r?.data });
  return r?.ok ? r.data : { hostError: r?.error ?? r };
};
const waitForGateway = async (maxMs) => {
  const until = Date.now() + maxMs;
  let status = null;
  while (Date.now() < until) {
    status = await host('gateway', 'status');
    if (status?.state === 'running' && status?.gatewayReady !== false) return status;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`gateway not ready: ${JSON.stringify(status)}`);
};
await shot('01-launched');

// --- configure provider through the product path ---
const now = new Date().toISOString();
const save = providerStore ? { reusedEncryptedStore: true } : await host('providers', 'save', { config: { id: 'senseaudio', name: 'SenseAudio', type: 'custom', baseUrl: 'https://api.senseaudio.cn/v1', apiProtocol: 'openai-completions', model: 'senseaudio-s2-flash', enabled: true, createdAt: now, updatedAt: now }, apiKey });
const setDefault = await host('providers', 'setDefault', { providerId: 'senseaudio' });
const hasKey = await host('providers', 'hasApiKey', { providerId: 'senseaudio' });
log('provider.configured', { save, setDefault, hasKey });
await shot('02-provider');

// --- workspace ---
const gw0 = await waitForGateway(180_000);
log('gateway.ready', { state: gw0.state, port: gw0.port, pid: gw0.pid, gatewayReady: gw0.gatewayReady });
const created = await host('workspaces', 'create', { name: 'journey-calc', rootPath: workspaceDir, permissionMode: 'readOnly' });
const norm = (p) => String(p ?? '').split(String.fromCharCode(92)).join('/').toLowerCase();
const wsId = (created?.profiles ?? []).find((w) => norm(w.rootPath) === norm(workspaceDir))?.id ?? created?.activeWorkspaceId;
log('workspace.created', { wsId, profiles: (created?.profiles ?? []).map((w) => ({ id: w.id, name: w.name, permissionMode: w.permissionMode })) });
const switched = await host('workspaces', 'switch', { id: wsId });
log('workspace.switched', { wsId, active: switched?.activeWorkspace?.rootPath ?? switched, permissionMode: switched?.activeWorkspace?.permissionMode });
// Provider key env and workspace tools.exec policy are both applied at Gateway launch;
// the post-save reload is skipped while the Gateway is <8s connected, so restart explicitly.
await host('gateway', 'restart');
await new Promise((r) => setTimeout(r, 4000));
const gw = await waitForGateway(180_000);
log('gateway.restarted', { state: gw.state, port: gw.port, pid: gw.pid, gatewayReady: gw.gatewayReady, pidChanged: gw.pid !== gw0.pid });
await shot('03-workspace');

// --- J-04: capture the host decision for the runtime approval RPCs before the task ---
const rpc = async (method, params, extra = {}) => {
  const response = await page.evaluate(async ({ method, params, extra }) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module: 'gateway', action: 'rpc', payload: { method, params, timeoutMs: 30000, ...extra } }), { method, params, extra });
  log('gateway.rpc', { method, ok: response?.ok ?? null, error: response?.error ?? response?.data?.error ?? undefined, blocked: response?.data?.blocked ?? undefined, approvalRequired: response?.data?.approvalRequired ?? undefined, dataKeys: response?.data && typeof response.data === 'object' ? Object.keys(response.data).slice(0, 16) : typeof response?.data });
  return response;
};
const directGateway = async (port, token, method, params) => await new Promise((resolve) => {
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  const timer = setTimeout(() => { try { ws.close(); } catch {} resolve({ error: 'direct gateway timeout' }); }, 15000);
  ws.onerror = () => { clearTimeout(timer); resolve({ error: 'direct gateway socket error' }); };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      ws.send(JSON.stringify({ type: 'req', id: 'connect-j04', method: 'connect', params: { minProtocol: 4, maxProtocol: 4, client: { id: 'gateway-client', displayName: 'J-04 driver', version: '0.0.0', platform: 'win32', mode: 'backend' }, auth: { token }, caps: ['tool-events'], role: 'operator', scopes: ['operator.admin', 'operator.read', 'operator.approvals'] } }));
      return;
    }
    if (msg.type === 'res' && msg.id === 'connect-j04') {
      if (msg.ok === false) { clearTimeout(timer); ws.close(); resolve({ connectError: msg.error ?? msg }); return; }
      ws.send(JSON.stringify({ type: 'req', id: 'call-j04', method, params }));
      return;
    }
    if (msg.type === 'res' && msg.id === 'call-j04') { clearTimeout(timer); ws.close(); resolve(msg); }
  };
});
const approvalProbe = {};
approvalProbe.listBefore = await rpc('exec.approval.list', {});
const boundary = { permissionMode: 'readOnly', hostGate: null, directGateway: [], runtimeResolve: null, continued: false };
log('approval.boundary.begin', { permissionMode: 'readOnly' });

// --- the task ---
const sessionKey = 'agent:main:main';
const message = 'In this workspace, run `node --test` first. The `total()` function in calc.js ignores item quantity, so the test fails. Fix calc.js so all tests pass. Do not modify calc.test.js. When done, run `node --test` again and report the result.';
const send = await host('chat', 'sendWithMedia', { sessionKey, workspaceId: wsId, message, idempotencyKey: randomUUID() });
const runId = send?.result?.runId;
log('chat.sent', { runId, send });
await shot('04-sent');

// --- observe until done or timeout ---
const deadline = Date.now() + timeoutMin * 60_000;
let stopReason = 'timeout';
let runError = null;
let sessionRows = [];
const sessionsDir = join(userDataDir, 'openclaw-source-state', 'agents', 'main', 'sessions');
const readSession = async () => {
  const paths = (await readdir(sessionsDir)).filter((f) => f.endsWith('.jsonl'));
  const matched = [];
  for (const f of paths) {
    const text = await readFile(join(sessionsDir, f), 'utf8');
    const rows = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    if (rows.some((r) => r.type === 'session' && norm(r.cwd) === norm(workspaceDir))) {
      await writeFile(join(evidenceDir, 'session.jsonl'), text);
      matched.push(...rows);
    }
  }
  return matched;
};
let history = null; let finished = false; let ticks = 0;
try {
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 15_000)); ticks += 1;
  history = (await page.evaluate(({ sessionKey }) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module: 'gateway', action: 'rpc', payload: { method: 'chat.history', params: { sessionKey, limit: 200, maxChars: 400000 }, timeoutMs: 30000 } }), { sessionKey }))?.data ?? null;
  const msgs = history?.messages ?? history?.result?.messages ?? [];
  const last = msgs.at(-1);
  const after = runTests();
  if (ticks % 4 === 0) await shot(`05-progress-${String(ticks).padStart(3, '0')}`);
  log('poll', { messages: msgs.length, lastRole: last?.role, testExit: after.exitCode });
  const text = JSON.stringify(last ?? {});
  const assistantIdle = last?.role === 'assistant' && !text.includes('"toolCall') && !text.includes('tool_use');
  const approvalPending = text.includes('exec.approval') || text.includes('approval requested') || text.includes('needs approval');
  if (!boundary.hostGate) {
    const hostList = await rpc('exec.approval.list', {});
    boundary.hostGate = { at: new Date().toISOString(), method: 'exec.approval.list', via: 'host gateway.rpc', response: hostList };
  }
  if (ticks >= 2 && !boundary.runtimeResolve) {
    const gwStatus = await host('gateway', 'status');
    const tokenResult = await host('settings', 'get', { key: 'gatewayToken' });
    const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.value ?? tokenResult?.gatewayToken ?? '';
    const listed = await directGateway(gwStatus?.port ?? 18789, token, 'exec.approval.list', {});
    log('direct.gateway', { method: 'exec.approval.list', ok: listed?.ok ?? null, error: listed?.error ?? listed?.connectError ?? undefined });
    boundary.directGateway.push({ at: new Date().toISOString(), method: 'exec.approval.list', response: listed });
    const payload = listed?.payload ?? listed?.result ?? null;
    const pending = Array.isArray(payload) ? payload : payload?.requests ?? payload?.pending ?? [];
    const first = Array.isArray(pending) ? pending[0] : null;
    const approvalId = first?.id ?? first?.approvalId ?? null;
    if (approvalId) {
      const resolved = await directGateway(gwStatus?.port ?? 18789, token, 'exec.approval.resolve', { id: approvalId, decision: 'allow-once' });
      log('direct.gateway', { method: 'exec.approval.resolve', ok: resolved?.ok ?? null });
      boundary.runtimeResolve = { at: new Date().toISOString(), approvalId, request: first, resolveParams: { id: approvalId, decision: 'allow-once' }, resolve: resolved, via: 'direct gateway websocket, because host gateway.rpc blocks exec.approval.* outside fullAccess' };
    }
  }
  sessionRows = await readSession();
  const continuation = sessionRows.find((r) => r.message?.role === 'toolResult' && r.message?.toolName === 'exec' && Date.parse(r.timestamp) > Date.parse(boundary.runtimeResolve?.at ?? ''));
  if (boundary.runtimeResolve?.resolve?.ok === true && continuation) {
    boundary.continued = true;
    boundary.continuation = continuation;
    stopReason = 'approval-boundary-observed';
    break;
  }
  if (after.exitCode === 0 && assistantIdle) { finished = true; stopReason = 'coding-task-finished'; break; }
}
} catch (error) { runError = error.message; stopReason = 'driver-error'; }
await shot('06-final');
const afterSnap = { files: await snapshotWorkspace(), tests: runTests() };
await writeFile(join(evidenceDir, 'session-history.json'), JSON.stringify(history, null, 2));

// --- receipts from the runtime state db (read-only) ---
let receipts = null;
let receiptJoin = null;
try {
  const dbPath = join(userDataDir, 'openclaw-source-state', 'state', 'openclaw.sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const count = (t) => { try { return db.prepare(`select count(*) as n from ${t}`).get().n; } catch (e) { return `error: ${e.message}`; } };
  const columns = (() => { try { return db.prepare('pragma table_info(runtime_receipts)').all().map((row) => row.name); } catch { return []; } })();
  let pairs = [];
  let byKind = [];
  let joinError = null;
  try {
    byKind = db.prepare('select kind, version, count(*) as n from runtime_receipts group by kind, version').all();
    pairs = db.prepare(`select a.correlation_digest as correlation_digest,
        a.kind as left_kind, a.version as left_version,
        b.kind as right_kind, b.version as right_version,
        count(*) as n
      from runtime_receipts a
      join runtime_receipts b
        on a.correlation_digest = b.correlation_digest and a.rowid < b.rowid
      where (a.kind = 'context' and a.version = '1' and b.kind = 'wire' and b.version = '1')
         or (a.kind = 'wire' and a.version = '1' and b.kind = 'context' and b.version = '1')
         or (a.kind = 'shadow_context' and a.version = '0' and b.kind = 'shadow_wire' and b.version = '0')
         or (a.kind = 'shadow_wire' and a.version = '0' and b.kind = 'shadow_context' and b.version = '0')
      group by a.correlation_digest, a.kind, a.version, b.kind, b.version`).all();
  } catch (e) { joinError = e.message; }
  const sample = (() => { try { return db.prepare('select receipt_id, kind, version, correlation_digest, provider_id, adapter_id, attempt_index, model_call_index from runtime_receipts limit 40').all(); } catch (e) { return { error: e.message }; } })();
    receipts = { dbPath, runtime_receipts: count('runtime_receipts'), effect_receipts: count('effect_receipts'), context_blocks: count('context_blocks'), columns, flags: { OPENCLAW_RC02_SHADOW_CENSUS: '1', OPENCLAW_RC03_SEAL: '1', scope: 'driver process env only; product defaults unchanged' } };
  receiptJoin = { byKind, pairs, v1ContextWirePairs: pairs.filter((row) => (row.left_kind === 'context' && row.right_kind === 'wire') || (row.left_kind === 'wire' && row.right_kind === 'context')).length, joinError, sample };
  db.close();
} catch (e) { receipts = { error: e.message }; }
log('receipts', receipts);

await app.close().catch(() => {});
sessionRows = await readSession().catch(() => sessionRows);
await writeFile(join(evidenceDir, 'approval-boundary.json'), JSON.stringify(boundary, null, 2));
await writeFile(join(evidenceDir, 'app.log'), appLog.join(''));
const report = { receiptJoin, approvalBoundary: boundary, 
  schema: 'clawx-product-journey/v1', scenario: 'J-04 non-fullAccess approval boundary (fix failing test)', operator: 'agent-driven (Codex via Playwright/CDP)', provider: { endpoint: 'https://api.senseaudio.cn/v1', model: 'senseaudio-s2-flash', real: true, secretSource: providerStore ? 'existing encrypted provider store copied into isolated user-data; not exported with evidence' : 'driver env -> providers.save; isolated user-data retained locally, not exported' },
  stopReason, runError, boundaryProven: boundary.continued, limitations: ['ClawX host gateway.rpc blocks exec.approval.* in readOnly mode; no in-app approval UI', 'Runtime decision uses a direct Gateway websocket from the driver', 'Coding completion is not the J-04 boundary criterion; finished remains false unless observed', 'Receipt flags are driver environment only; product defaults unchanged'], candidate, dist, runId, sessionKey, startedAt: events[0].t, finishedAt: new Date().toISOString(), finished, timeoutMin, workspace: { before, after: afterSnap }, receipts, events,
};
await writeFile(join(evidenceDir, 'journey.json'), JSON.stringify(report, null, 2));
console.log(`\nEVIDENCE_DIR=${evidenceDir}\nFINISHED=${finished} testExitAfter=${afterSnap.tests.exitCode}`);
