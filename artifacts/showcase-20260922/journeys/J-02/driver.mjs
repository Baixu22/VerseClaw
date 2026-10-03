// Real ClawX product journey driver (Playwright over Electron CDP, host API via renderer IPC).
// Usage: SENSEAUDIO_API_KEY=... node driver.mjs [--repo D:/ClawX] [--timeout-min 20]
// The key is passed to the app only through the providers.save host call; it is never written by this script.
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, readdir, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import net from 'node:net';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(Boolean));
const repo = resolve(args.repo ?? 'D:/ClawX');
const timeoutMin = Number(args['timeout-min'] ?? 20);
const apiKey = process.env.SENSEAUDIO_API_KEY;
if (!apiKey) throw new Error('SENSEAUDIO_API_KEY missing in driver env');

const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const { DatabaseSync } = await import('node:sqlite');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = resolve(process.env.LOCALAPPDATA, 'ClawX-live-data', 'journey-20260921', stamp);
const homeDir = join(root, 'home');
const userDataDir = join(root, 'user-data');
const workspaceDir = join(root, 'workspace');
const evidenceDir = join(root, 'evidence');
for (const d of [join(homeDir, '.config'), join(homeDir, 'AppData', 'Local'), join(homeDir, 'AppData', 'Roaming'), userDataDir, workspaceDir, join(evidenceDir, 'screenshots')]) await mkdir(d, { recursive: true });
await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en' }, null, 2));

const events = [];
const log = (event, data = {}) => { const row = { t: new Date().toISOString(), event, ...data }; events.push(row); console.log(JSON.stringify(row)); };
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();

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
const candidate = { commit: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), dirty: git('status', '--porcelain', '--', 'src', 'electron', 'shared', 'openclaw_runtime/src').length > 0 };
const dist = {};
for (const f of ['dist/index.html', 'dist-electron/main/index.js', 'openclaw_runtime/dist/entry.js']) { const s = await stat(join(repo, f)); dist[f] = { mtime: s.mtime.toISOString(), bytes: s.size }; }
log('launch.begin', { candidate, dist, hostApiPort, cdpPort, root });
const appLog = [];
const app = await electron.launch({
  executablePath: electronBinary,
  args: ['--lang=en-US', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--in-process-gpu', join(repo, 'dist-electron', 'main', 'index.js')],
  env: Object.fromEntries(Object.entries({
    ...process.env, SENSEAUDIO_API_KEY: undefined,
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
const save = await host('providers', 'save', { config: { id: 'senseaudio', name: 'SenseAudio', type: 'custom', baseUrl: 'https://api.senseaudio.cn/v1', apiProtocol: 'openai-completions', model: 'senseaudio-s2-flash', enabled: true, createdAt: now, updatedAt: now }, apiKey });
const setDefault = await host('providers', 'setDefault', { providerId: 'senseaudio' });
const hasKey = await host('providers', 'hasApiKey', { providerId: 'senseaudio' });
log('provider.configured', { save, setDefault, hasKey });
await shot('02-provider');

// --- workspace ---
const gw0 = await waitForGateway(180_000);
log('gateway.ready', { state: gw0.state, port: gw0.port, pid: gw0.pid, gatewayReady: gw0.gatewayReady });
const created = await host('workspaces', 'create', { name: 'journey-calc', rootPath: workspaceDir, permissionMode: 'fullAccess' });
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

// --- the task ---
const sessionKey = 'agent:main:main';
const message = 'In this workspace, run `node --test` first. The `total()` function in calc.js ignores item quantity, so the test fails. Fix calc.js so all tests pass. Do not modify calc.test.js. When done, run `node --test` again and report the result.';
const send = await host('chat', 'sendWithMedia', { sessionKey, workspaceId: wsId, message, idempotencyKey: randomUUID() });
const runId = send?.result?.runId;
log('chat.sent', { runId, send });
await shot('04-sent');

// --- observe until done or timeout ---
const deadline = Date.now() + timeoutMin * 60_000;
let history = null; let finished = false; let ticks = 0;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 15_000)); ticks += 1;
  history = (await page.evaluate(({ sessionKey }) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module: 'gateway', action: 'rpc', payload: { method: 'chat.history', params: { sessionKey, limit: 200, maxChars: 400000 }, timeoutMs: 30000 } }), { sessionKey }))?.data ?? null;
  const msgs = history?.messages ?? history?.result?.messages ?? [];
  const last = msgs.at(-1);
  const after = runTests();
  if (ticks % 4 === 0) await shot(`05-progress-${String(ticks).padStart(3, '0')}`);
  log('poll', { messages: msgs.length, lastRole: last?.role, testExit: after.exitCode });
  const assistantIdle = last?.role === 'assistant' && !JSON.stringify(last).includes('"toolCall') && !JSON.stringify(last).includes('tool_use');
  if (after.exitCode === 0 && assistantIdle) { finished = true; break; }
}
await shot('06-final');
const afterSnap = { files: await snapshotWorkspace(), tests: runTests() };
await writeFile(join(evidenceDir, 'session-history.json'), JSON.stringify(history, null, 2));

// --- receipts from the runtime state db ---
let receipts = null;
try {
  const dbPath = join(userDataDir, 'openclaw-source-state', 'state', 'openclaw.sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const count = (t) => { try { return db.prepare(`select count(*) as n from ${t}`).get().n; } catch (e) { return `error: ${e.message}`; } };
  receipts = { dbPath, runtime_receipts: count('runtime_receipts'), effect_receipts: count('effect_receipts'), context_blocks: count('context_blocks'), tables: db.prepare("select name from sqlite_master where type='table' order by name").all().map((r) => r.name) };
  db.close();
} catch (e) { receipts = { error: e.message }; }
log('receipts', receipts);

await app.close().catch(() => {});
await writeFile(join(evidenceDir, 'app.log'), appLog.join(''));
const report = {
  schema: 'clawx-product-journey/v1', scenario: 'J-02 normal coding task (fix failing test)', operator: 'agent-driven (Claude Code via Playwright/CDP)', provider: { endpoint: 'https://api.senseaudio.cn/v1', model: 'senseaudio-s2-flash', real: true, secretSource: 'driver process env -> providers.save (isolated temp user-data, destroyed after)' },
  candidate, dist, runId, sessionKey, startedAt: events[0].t, finishedAt: new Date().toISOString(), finished, timeoutMin, workspace: { before, after: afterSnap }, receipts, events,
};
await writeFile(join(evidenceDir, 'journey.json'), JSON.stringify(report, null, 2));
console.log(`\nEVIDENCE_DIR=${evidenceDir}\nFINISHED=${finished} testExitAfter=${afterSnap.tests.exitCode}`);
