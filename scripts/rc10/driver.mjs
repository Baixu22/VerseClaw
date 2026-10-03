// RC-10 agent-driven live acceptance driver.
//
// Owner policy (AGENTS.md §Human-in-the-loop policy): there is no human operator.
// This driver IS the operator, and every artifact it writes is agent-driven.
// The provider key is read from the environment only and is never written to any
// evidence file or tracked path.
//
// Usage:
//   RC10_PROVIDER_KEY=... node scripts/rc10/driver.mjs --scenario H-01 [--repo D:/ClawX]
//
// Scenarios are added one at a time; each run records its own evidence directory
// and appends a row to journey.json so RC-10 can be assembled from real runs.
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, readdir, cp, stat, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import net from 'node:net';
import { parseArgs } from 'node:util';
import { evaluateRc10ChannelProbe, evaluateRc10H01, sealRc10Evidence, summarizeRc10Receipts } from '../lib/rc10-evidence.mjs';

const { values: args } = parseArgs({
  options: Object.fromEntries(
    [...['repo', 'scenario', 'timeout-min', 'data-root', 'workload', 'permission-mode']
      .map((name) => [name, { type: 'string' }]), ['development', { type: 'boolean' }], ['list-scenarios', { type: 'boolean' }]],
  ),
});
if (args['list-scenarios']) {
  console.log(JSON.stringify(['H-01', 'H-02', 'H-03', 'H-04', 'H-05', 'H-06', 'OPERATOR-ALL', 'CHANNEL-PROBE']));
  process.exit(0);
}
const repo = resolve(args.repo ?? 'D:/ClawX');
const scenario = String(args.scenario ?? 'H-01');
// Reject before reading credentials, writing files or launching Electron. Without
// this guard an unimplemented H-02 request ran H-01 and mislabelled its evidence.
if (!['H-01', 'H-02', 'H-03', 'H-04', 'H-05', 'H-06', 'OPERATOR-ALL', 'CHANNEL-PROBE'].includes(scenario)) {
  throw new Error('Unsupported RC-10 scenario: ' + scenario + '. Implemented: H-01..H-06, OPERATOR-ALL, CHANNEL-PROBE.');
}
const timeoutMin = Number(args['timeout-min'] ?? 15);
if (!Number.isFinite(timeoutMin) || timeoutMin <= 0) {
  throw new Error('--timeout-min must be a positive finite number');
}
if (['H-02', 'H-03', 'H-04', 'H-05', 'H-06', 'OPERATOR-ALL'].includes(scenario)) {
  const { runOperatorDriver } = await import('./operator-driver.mjs');
  process.exit(await runOperatorDriver({ repo, scenario, timeoutMin, dataRoot: args['data-root'], development: args.development === true }));
}
const apiKey = process.env.RC10_PROVIDER_KEY;
const providerBaseUrl = process.env.RC10_PROVIDER_BASE_URL ?? 'http://127.0.0.1:3065/v1';
const providerModel = process.env.RC10_PROVIDER_MODEL ?? 'glm-5.3-flash';
if (!apiKey) throw new Error('Supply RC10_PROVIDER_KEY in the environment (never on the command line or in a file).');

const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runRoot = resolve(args['data-root'] ?? `C:/Users/27933/AppData/Local/ClawX-live-data/rc10/${scenario}/${stamp}`);
const homeDir = join(runRoot, 'home');
const userDataDir = join(runRoot, 'user-data');
const workspaceDir = join(runRoot, 'workspace');
const evidenceDir = join(runRoot, 'evidence');
const existingEvidence = await readdir(evidenceDir).catch((error) => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
if (existingEvidence.length > 0) throw new Error('Evidence directory must be empty; use a new --data-root to preserve earlier runs.');
for (const d of [
  join(homeDir, '.config'),
  join(homeDir, 'AppData', 'Local'),
  join(homeDir, 'AppData', 'Roaming'),
  userDataDir,
  workspaceDir,
  join(evidenceDir, 'screenshots'),
]) await mkdir(d, { recursive: true });
await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en' }, null, 2));

const events = [];
const log = (event, data = {}) => {
  const row = { t: new Date().toISOString(), driven_by: 'agent', actor: 'rc10-driver', scenario, event, ...data };
  events.push(row);
  appendFileSync(join(evidenceDir, 'events.jsonl'), `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify(row));
};
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (...a) => execFileSync('C:/Program Files/Git/cmd/git.exe', a, { cwd: repo, encoding: 'utf8' }).trim();

// --- workload: a tiny Node project with a real bug and a real test ---
const workloadSource = resolve(args.workload ?? 'D:/ClawX/artifacts/live-model-cdp/20260922-senseaudio-journey-J04/workload');
await cp(workloadSource, workspaceDir, { recursive: true });
async function snapshotWorkspace() {
  const out = {};
  for (const f of await readdir(workspaceDir, { recursive: true })) {
    const p = join(workspaceDir, f);
    const s = await stat(p);
    if (s.isFile() && !f.includes('node_modules')) out[f.replaceAll('\\', '/')] = { bytes: s.size, sha256: sha256(await readFile(p)) };
  }
  return out;
}
const runTests = () => {
  const r = spawnSync(process.execPath, ['--test'], { cwd: workspaceDir, encoding: 'utf8', timeout: 60_000 });
  return { exitCode: r.status, stdout: (r.stdout ?? '').slice(-4000), stderr: (r.stderr ?? '').slice(-4000) };
};
const before = { files: await snapshotWorkspace(), tests: runTests() };
log('workspace.before', { files: Object.keys(before.files), testExit: before.tests.exitCode });

// --- candidate identity ---
const candidate = {
  commit: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  statusPorcelain: git('status', '--porcelain', '--untracked-files=all'),
};
candidate.dirty = candidate.statusPorcelain.length > 0;
await writeFile(join(evidenceDir, 'candidate.json'), JSON.stringify(candidate, null, 2));
if (candidate.dirty) throw new Error('Candidate must be clean before launching Electron');

// --- launch ---
const allocatePort = () =>
  new Promise((res) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
const hostApiPort = await allocatePort();
const cdpPort = await allocatePort();
const electronBinary = join(
  repo,
  'node_modules',
  'electron',
  'dist',
  (await readFile(join(repo, 'node_modules', 'electron', 'path.txt'), 'utf8')).trim(),
);
log('launch.begin', { candidate, hostApiPort, cdpPort, runRoot, providerBaseUrl, providerModel });

const appLog = [];
const app = await electron.launch({
  executablePath: electronBinary,
  args: ['--lang=en-US', '--disable-gpu', '--in-process-gpu', join(repo, 'dist-electron', 'main', 'index.js')],
  env: Object.fromEntries(
    Object.entries({
      ...process.env,
      RC10_PROVIDER_KEY: undefined,
      OPENCLAW_RC02_SHADOW_CENSUS: '1',
      OPENCLAW_RC03_SEAL: '1',
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(homeDir, '.config'),
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LANGUAGE: 'en',
      VERSE_CLAW_E2E: '1',
      CLAWX_AGENT_DEV: '1',
      VERSE_CLAW_E2E_SKIP_SETUP: '1',
      VERSE_CLAW_USER_DATA_DIR: userDataDir,
      VERSE_CLAW_PORT_CLAWX_HOST_API: String(hostApiPort),
      VERSE_CLAW_REMOTE_DEBUGGING_PORT: String(cdpPort),
      // The qqbot manifest declares channelEnvVars, so credentials can arrive as
      // process env instead of channel config. RC10_CHANNEL_VIA=env takes that
      // path, which avoids the gateway start-up env assembly that rejects the
      // config-configured account.
      ...(process.env.RC10_CHANNEL_VIA === 'env' && process.env.RC10_QQBOT_APP_ID
        ? { QQBOT_APP_ID: process.env.RC10_QQBOT_APP_ID, QQBOT_CLIENT_SECRET: process.env.RC10_QQBOT_CLIENT_SECRET }
        : {}),
    }).filter(([, v]) => v !== undefined),
  ),
  timeout: 120_000,
});
app.process().stdout?.on('data', (c) => appLog.push(`[out] ${c}`));
app.process().stderr?.on('data', (c) => appLog.push(`[err] ${c}`));
const page = await app.firstWindow();
await page.waitForFunction(() => typeof window.verseClaw?.hostInvoke === 'function', null, { timeout: 120_000 });
log('launch.ready', { url: page.url() });

const shot = async (name) => {
  await page.screenshot({ path: join(evidenceDir, 'screenshots', `${name}.png`) }).catch(() => {});
};
const host = async (module, action, payload) => {
  const r = await page.evaluate(
    ({ module, action, payload }) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module, action, payload }),
    { module, action, payload },
  );
  log('host', { module, action, ok: r?.ok ?? null, error: r?.error ?? undefined });
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

// --- provider through the product path ---
const now = new Date().toISOString();
const providerId = 'rc10-live';
const save = await host('providers', 'save', {
  config: {
    id: providerId,
    name: 'RC-10 live provider',
    type: 'custom',
    baseUrl: providerBaseUrl,
    apiProtocol: 'openai-responses',
    model: providerModel,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  },
  apiKey,
});
const setDefault = await host('providers', 'setDefault', { providerId });
const hasKey = await host('providers', 'hasApiKey', { providerId });
log('provider.configured', { save, setDefault, hasKey: hasKey === true });
await shot('02-provider');

// --- workspace ---
const gw0 = await waitForGateway(180_000);
log('gateway.ready', { state: gw0.state, port: gw0.port, pid: gw0.pid, gatewayReady: gw0.gatewayReady });
const workspacePermissionMode = String(args['permission-mode'] ?? 'fullAccess');
const created = await host('workspaces', 'create', { name: 'rc10-live', rootPath: workspaceDir, permissionMode: workspacePermissionMode });
const norm = (p) => String(p ?? '').split(String.fromCharCode(92)).join('/').toLowerCase();
const wsId = (created?.profiles ?? []).find((w) => norm(w.rootPath) === norm(workspaceDir))?.id ?? created?.activeWorkspaceId;
await host('workspaces', 'switch', { id: wsId });
// Provider key + workspace exec policy are applied at Gateway launch, so restart explicitly.
await host('gateway', 'restart');
await new Promise((r) => setTimeout(r, 4000));
const gw = await waitForGateway(180_000);
log('gateway.restarted', { state: gw.state, port: gw.port, pid: gw.pid, pidChanged: gw.pid !== gw0.pid });
await shot('03-workspace');

// --- CHANNEL-PROBE: configure a real channel through the product path and prove it connects.
// Sends nothing outward; it only installs the credential, restarts, then validates and probes.
if (scenario === 'CHANNEL-PROBE') {
  const channelType = process.env.RC10_CHANNEL ?? 'qqbot';
  const appId = process.env.RC10_QQBOT_APP_ID;
  const clientSecret = process.env.RC10_QQBOT_CLIENT_SECRET;
  if (!appId || !clientSecret) throw new Error('Supply RC10_QQBOT_APP_ID and RC10_QQBOT_CLIENT_SECRET in the environment.');
  const via = process.env.RC10_CHANNEL_VIA === 'env' ? 'env' : 'config';
  // `env` mode relies on the manifest's channelEnvVars being present on the
  // Electron process; `config` mode installs an account through the host API.
  const saved = via === 'env'
    ? { skipped: 'credentials supplied through the process environment' }
    : await host('channels', 'saveConfig', { channelType, config: { enabled: true, appId, clientSecret } });
  if (via === 'config') await host('channels', 'setEnabled', { channelType, enabled: true });
  const configured = await host('channels', 'configured');
  // `gateway.restart` throws {"code":"INTERNAL","message":"Invalid value for env"} once a channel
  // account exists, so fall back to an explicit stop+start and record which path worked.
  const restarted = await host('gateway', 'restart');
  let restartPath = 'restart';
  if (restarted?.hostError || restarted?.ok === false) {
    await host('gateway', 'stop');
    await new Promise((r) => setTimeout(r, 3000));
    await host('gateway', 'start');
    restartPath = 'stop+start';
  }
  await new Promise((r) => setTimeout(r, 4000));
  let gwProbe;
  try {
    gwProbe = await waitForGateway(180_000);
  } catch (error) {
    // Capture the app's own stderr and the gateway status so a failed start is
    // diagnosable instead of just a timeout.
    await writeFile(join(evidenceDir, 'app.log'), appLog.join(''));
    await writeFile(
      join(evidenceDir, 'channel-probe-failure.json'),
      JSON.stringify(
        {
          schema: 'rc10-channel-probe-failure/v1',
          driven_by: 'agent',
          via,
          restartPath,
          restartResult: restarted,
          error: String(error?.message ?? error),
          gatewayStatus: await host('gateway', 'status'),
        },
        null,
        2,
      ),
    );
    log('channel.probe.failed', { via, restartPath, error: String(error?.message ?? error) });
    await app.close().catch(() => {});
    process.exit(1);
  }
  log('channel.restartPath', { restartPath, restartResult: restarted });
  const validation = await host('channels', 'validateCredentials', { channelType });
  const accounts = await host('channels', 'accounts', { channelType });
  const targets = await host('channels', 'targets', { channelType });
  const assessment = evaluateRc10ChannelProbe({ channelType, validation, accounts, targets });
  await shot('04-channel-probe');
  const probe = {
    schema: 'rc10-channel-probe/v1',
    driven_by: 'agent',
    channelType,
    via,
    restartPath,
    saved,
    configured,
    gateway: { state: gwProbe.state, port: gwProbe.port, pid: gwProbe.pid },
    validation,
    accounts,
    targets,
    assessment,
    at: new Date().toISOString(),
  };
  await writeFile(join(evidenceDir, 'channel-probe.json'), JSON.stringify(probe, null, 2));
  log('channel.probe', {
    channelType,
    via,
    ok: saved?.ok ?? null,
    valid: validation?.valid ?? null,
    validationErrors: validation?.errors ?? null,
    accountKeys: accounts && typeof accounts === 'object' ? Object.keys(accounts).slice(0, 8) : typeof accounts,
    targetKeys: targets && typeof targets === 'object' ? Object.keys(targets).slice(0, 8) : typeof targets,
  });
  await app.close().catch(() => {});
  await writeFile(join(evidenceDir, 'app.log'), appLog.join(''));
  const seal = await sealRc10Evidence(evidenceDir, [apiKey, clientSecret, appId]);
  console.log(JSON.stringify({ scenario, channelType, result: assessment.result, credentialScanHits: seal.credentialScanHits.length, evidenceDir }));
  process.exit(assessment.result === 'pass' && seal.credentialScanHits.length === 0 ? 0 : 1);
}

// --- H-01: send a normal desktop task ---
const sessionKey = 'agent:main:main';
const message = [
  'In this workspace, run `node --test` first.',
  'The `total()` function in calc.js ignores item quantity, so the test fails.',
  'Fix calc.js so all tests pass. Do not modify calc.test.js.',
  'When done, run `node --test` again and report the result.',
].join(' ');
const send = await host('chat', 'sendWithMedia', { sessionKey, workspaceId: wsId, message, idempotencyKey: randomUUID() });
const runId = send?.result?.runId ?? send?.runId ?? null;
log('chat.sent', { runId, send });
await shot('04-sent');

const sessionsDir = join(userDataDir, 'openclaw-source-state', 'agents', 'main', 'sessions');
const readSession = async () => {
  let names = [];
  try {
    names = (await readdir(sessionsDir)).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return { rows: [], path: null };
  }
  for (const f of names) {
    const text = await readFile(join(sessionsDir, f), 'utf8');
    const rows = text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    if (rows.some((r) => r.type === 'session' && norm(r.cwd) === norm(workspaceDir))) {
      await writeFile(join(evidenceDir, 'session.jsonl'), text);
      return { rows, path: join(sessionsDir, f) };
    }
  }
  return { rows: [], path: null };
};

const deadline = Date.now() + timeoutMin * 60_000;
let history = null;
let ticks = 0;
let finished = false;
let stopReason = 'timeout';
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 15_000));
  ticks += 1;
  history = (
    await page.evaluate(
      ({ sessionKey }) =>
        window.verseClaw.hostInvoke({
          id: crypto.randomUUID(),
          module: 'gateway',
          action: 'rpc',
          payload: { method: 'chat.history', params: { sessionKey, limit: 200, maxChars: 400000 }, timeoutMs: 30000 },
        }),
      { sessionKey },
    )
  )?.data ?? null;
  const msgs = history?.messages ?? history?.result?.messages ?? [];
  const last = msgs.at(-1);
  const after = runTests();
  log('poll', { ticks, messages: msgs.length, lastRole: last?.role, testExit: after.exitCode });
  if (ticks % 4 === 0) await shot(`05-progress-${String(ticks).padStart(3, '0')}`);
  const idle = last?.role === 'assistant';
  if (idle && after.exitCode === 0) {
    finished = true;
    stopReason = 'task-complete';
    break;
  }
  if (idle && ticks >= 6 && after.exitCode !== 0) {
    stopReason = 'assistant-idle-without-green-tests';
  }
}

const after = { files: await snapshotWorkspace(), tests: runTests() };
const session = await readSession();
await shot('06-final');
log('task.finished', { stopReason, finished, testExitBefore: before.tests.exitCode, testExitAfter: after.tests.exitCode, sessionRows: session.rows.length });

// --- context lineage: the runtime receipts written for this run ---
const receipts = { available: false, reason: null, context: [], wire: [], pairs: 0 };
try {
  const { DatabaseSync } = await import('node:sqlite');
  const dbCandidates = [];
  for (const root of [userDataDir, homeDir, join(homeDir, '.openclaw')]) {
    const found = await readdir(root, { recursive: true }).catch(() => []);
    for (const f of found) {
      if (String(f).endsWith('.sqlite') || String(f).endsWith('.db') || String(f).endsWith('.sqlite3')) {
        dbCandidates.push(join(root, f));
      }
    }
  }
  for (const dbPath of dbCandidates) {
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
    } catch {
      continue;
    }
    let tableRows = [];
    try {
      // The table keeps digests and the selected/omitted source lists, never raw
      // prompt or tool text. selected_json/omitted_json are exactly the context
      // lineage H-01 has to explain.
      tableRows = db
        .prepare(
          'SELECT receipt_id, kind, version, runtime_mode, correlation_digest, run_id, selected_json, omitted_json FROM runtime_receipts WHERE run_id = ?',
        )
        .all(runId);
    } catch {
      db.close();
      continue;
    }
    db.close();
    Object.assign(receipts, summarizeRc10Receipts(tableRows, runId), { dbPath });
    break;
  }
  if (!receipts.available) receipts.reason = 'no runtime_receipts table found under the isolated user-data dir';
} catch (error) {
  receipts.reason = String(error?.message ?? error);
}
log('receipts.read', { available: receipts.available, total: receipts.total ?? 0, context: receipts.context.length, wire: receipts.wire.length, pairs: receipts.pairs, reason: receipts.reason });

// --- evidence bundle ---
await writeFile(join(evidenceDir, 'final-history.json'), JSON.stringify(history ?? null, null, 2));
await writeFile(join(evidenceDir, 'workspace-after.json'), JSON.stringify(after.files, null, 2));
await writeFile(join(evidenceDir, 'receipts.json'), JSON.stringify(receipts, null, 2));
await writeFile(join(evidenceDir, 'app.log'), appLog.join(''));

const assessment = evaluateRc10H01({ candidate, runId, finished, before, after, receipts });
const journey = {
  assessment,
  schema: 'rc10-journey/v1',
  scenario,
  driven_by: 'agent',
  actor: 'rc10-driver',
  operator: 'agent-driven (Playwright over Electron CDP); no human operator',
  candidate,
  provider: { id: providerId, baseUrl: providerBaseUrl, apiProtocol: 'openai-responses', model: providerModel, keySource: 'process environment only' },
  workspace: { id: wsId, rootPath: workspaceDir, permissionMode: workspacePermissionMode },
  run: { runId, sessionKey, stopReason, finished },
  observations: {
    taskCompleted: finished && after.tests.exitCode === 0,
    testsBefore: before.tests.exitCode,
    testsAfter: after.tests.exitCode,
    contextReceipts: receipts.context.length,
    wireReceipts: receipts.wire.length,
    receiptPairs: receipts.pairs,
  },
  startedAt: events[0]?.t ?? null,
  finishedAt: new Date().toISOString(),
  evidence: 'events.jsonl, candidate.json, session.jsonl, final-history.json, receipts.json, workspace-after.json, screenshots/',
};
await writeFile(join(evidenceDir, 'journey.json'), JSON.stringify(journey, null, 2));

// Finish event and application-log writes before creating the immutable seal.
log('evidence.ready', { evidenceDir, result: assessment.result, errors: assessment.errors });
await app.close().catch(() => {});
await writeFile(join(evidenceDir, 'app.log'), appLog.join(''));
const seal = await sealRc10Evidence(evidenceDir, [apiKey]);
console.log(JSON.stringify({ scenario, runId, stopReason, finished, result: assessment.result, testsAfter: after.tests.exitCode, contextReceipts: receipts.context.length, credentialScanHits: seal.credentialScanHits.length, evidenceDir }));
process.exit(assessment.result === 'pass' && seal.credentialScanHits.length === 0 ? 0 : 1);
