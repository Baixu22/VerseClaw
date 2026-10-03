// Agent-driven RC-10 scenarios on real Electron, Gateway, SQLite and local IRC.
// --development allows a dirty checkout but never produces a formal verdict.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { startIrcServer } from './irc-server.mjs';
import { allocatePort, startScriptedLlm, MOCK_MODEL_ID } from '../../tests/e2e/fixtures/fp-p1-harness.ts';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Per-scenario evidence capture.
 *
 * The default 30 s screenshot timeout is too tight on a loaded acceptance host:
 * H-05 captures the frame immediately after a Gateway restart, and in the
 * 2026-09-29 RC-09 run a slow capture failed the scenario even though every
 * functional assertion in it had already passed. Bounded retries keep the
 * evidence mandatory — the last error is still rethrown and still fails the
 * scenario — without making collection itself the flaky part.
 */
async function captureEvidence(page, file) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.screenshot({ path: file, timeout: 60_000, animations: 'disabled', caret: 'hide' });
      return;
    } catch (error) {
      lastError = error;
      await sleep(2_000);
    }
  }
  throw lastError;
}

export async function runOperatorDriver({ repo, scenario, development = false, dataRoot, timeoutMin = 5 }) {
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
  const candidate = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: Boolean(git('status', '--porcelain')) };
  assert(development || !candidate.dirty, 'Formal scenario runs require a clean candidate; use --development for local debugging');
  const root = dataRoot ? resolve(dataRoot) : await mkdtemp(join(tmpdir(), 'rc10-operator-'));
  const existing = await readdir(root).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
  assert.equal(existing.length, 0, 'Driver output root must be empty; existing profiles are never overwritten');
  const deadline = Date.now() + timeoutMin * 60000;
  const home = join(root, 'home'), userData = join(root, 'user-data'), workspace = join(root, 'workspace'), evidence = join(root, 'evidence');
  // An explicit output directory may not overwrite an earlier evidence bundle.
  await mkdir(evidence, { recursive: false }).catch(async (error) => {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(root, { recursive: true });
    await mkdir(evidence);
  });
  for (const p of [home, userData, workspace, join(home, '.config'), join(home, 'AppData/Local'), join(home, 'AppData/Roaming')]) await mkdir(p, { recursive: true });
  const event = (name, data = {}) => {
    const row = { at: new Date().toISOString(), driven_by: 'agent', actor: 'rc10-operator-driver', event: name, ...data };
    appendFileSync(join(evidence, 'events.jsonl'), JSON.stringify(row) + '\n');
    console.log(JSON.stringify(row));
  };
  const save = (name, value) => writeFile(join(evidence, name), JSON.stringify(value, null, 2) + '\n');
  const report = { schema: 'rc10-operator-scenarios/v1', driven_by: 'agent', actor: 'rc10-operator-driver', candidate, development, formalAcceptance: false, provider: { kind: 'local-scripted', syntheticUsage: true, paidProviderCalls: 0 }, scenarios: [], failures: [] };
  let app, appProcess, peer, llm, page;
  let appLog = '';
  const require = createRequire(join(repo, 'package.json'));
  const { _electron } = require('playwright-core');
  const wait = async (label, probe, maxMs = 30000) => {
    const until = Math.min(deadline, Date.now() + maxMs);
    let last;
    do {
      last = await probe();
      if (last) return last;
      await sleep(250);
    } while (Date.now() < until);
    throw new Error(label + ' timed out after ' + maxMs + 'ms');
  };
  const host = async (module, action, payload) => {
    const r = await page.evaluate(({ module, action, payload }) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module, action, payload }), { module, action, payload });
    if (!r?.ok || r.data?.success === false) throw new Error(module + '.' + action + ': ' + JSON.stringify(r?.error ?? r?.data));
    return r.data;
  };
  const rpc = async (method, params = {}) => {
    const value = await host('gateway', 'rpc', { method, params, timeoutMs: 30000 });
    if (value?.blocked || value?.approvalRequired || value?.success === false) throw new Error(method + ': ' + JSON.stringify(value));
    return value?.result ?? value;
  };
  const gateway = async (previousPid) => wait('gateway ready', async () => {
    const s = await host('gateway', 'status');
    return s.state === 'running' && s.gatewayReady !== false && (!previousPid || s.pid !== previousPid) ? s : false;
  }, 180000);
  const snapshot = async () => {
    const out = { approvals: [], effects: [], receipts: [] };
    for (const file of await readdir(userData, { recursive: true })) {
      if (!/\.(sqlite|db|sqlite3)$/.test(file)) continue;
      let db;
      try {
        db = new DatabaseSync(join(userData, file), { readOnly: true });
        for (const [key, table] of [['approvals', 'approval_ledger'], ['effects', 'effect_receipts'], ['receipts', 'runtime_receipts']]) {
          if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
            out[key].push(...db.prepare('SELECT * FROM ' + table).all());
          }
        }
      } finally { db?.close(); }
    }
    return out;
  };
  const sent = (marker) => peer.events.filter((e) => e.event === 'privmsg' && e.from === 'rc10bot' && e.text.includes(marker));
  const pending = async (jobId) => wait('approval for ' + jobId, async () => {
    const data = await snapshot();
    return data.approvals.find((r) => r.idempotency_key.includes(jobId) && r.state === 'approval_pending');
  });
  const decide = async (approvalId, decision) => {
    await page.getByTestId('sidebar-nav-inbox').click();
    await page.getByTestId('inbox-refresh').click();
    await page.getByTestId('inbox-item-operator:' + approvalId).click({ timeout: 15000 });
    await page.getByTestId('inbox-action-' + (decision === 'approved' ? 'approve' : 'deny')).click();
    return wait('persisted Inbox decision', async () => (await snapshot()).approvals.find((r) => r.approval_id === approvalId && r.decision === decision));
  };
  let workspaceId;
  const createCommand = async (id, options = {}) => {
    const marker = 'RC10-' + id + '-' + randomUUID();
    const sessionKey = options.sessionKey ?? 'agent:main:rc10-operator';
    const job = await rpc('cron.add', {
      name: marker, enabled: false, deleteAfterRun: false, failureAlert: false,
      schedule: { kind: 'every', everyMs: 86400000 }, sessionTarget: 'isolated', sessionKey, wakeMode: 'now',
      payload: { kind: 'command', argv: [process.execPath, '-e', 'console.log(' + JSON.stringify(marker) + ')'], cwd: workspace, timeoutSeconds: 120 },
      delivery: { mode: 'announce', channel: 'irc', to: '#rc10', bestEffort: false },
    });
    assert(job.id, 'cron.add did not return a job id');
    await rpc('cron.run', { id: job.id, mode: 'force' });
    const approval = await pending(job.id);
    assert.equal(sent(marker).length, 0, 'effect happened before approval');
    event('approval.pending', { scenario: id, jobId: job.id, approvalId: approval.approval_id });
    await rpc('inbox.operator.lineage', { sessionKey, runId: approval.idempotency_key.slice(3, -(sessionKey.length + 1)) });
    return { id, jobId: job.id, marker, sessionKey, runId: approval.idempotency_key.slice(3, -(sessionKey.length + 1)), approvalId: approval.approval_id, idempotencyKey: approval.idempotency_key };
  };
  const approved = async (run) => {
    await decide(run.approvalId, 'approved');
    const effect = await wait('one applied EffectReceipt', async () => {
      const rows = (await snapshot()).effects.filter((e) => e.approval_id === run.approvalId);
      assert(rows.length <= 1, 'duplicate EffectReceipt');
      return rows.length === 1 && rows[0].outcome === 'applied' ? rows[0] : false;
    });
    await wait('IRC delivery', () => sent(run.marker).length === 1);
    assert.equal(sent(run.marker).length, 1);
    return { ...run, effectReceiptId: effect.effect_receipt_id, effect, peerMessages: sent(run.marker) };
  };

  const runIdentity = (run) => {
    assert(run.idempotencyKey.endsWith(':' + run.sessionKey), 'approval identity/session mismatch');
    return { sessionKey: run.sessionKey, runId: run.idempotencyKey.slice(3, -(run.sessionKey.length + 1)) };
  };
  const lineage = (run) => rpc('inbox.operator.lineage', runIdentity(run));
  const assertNoEffect = async (run) => {
    assert.equal(sent(run.marker).length, 0, 'unexpected IRC effect');
    assert.equal((await snapshot()).effects.filter((e) => e.approval_id === run.approvalId).length, 0, 'unexpected EffectReceipt');
  };
  const restart = async () => {
    const before = await host('gateway', 'status');
    await host('gateway', 'restart');
    const after = await gateway(before.pid);
    event('gateway.restarted', { oldPid: before.pid, newPid: after.pid });
    return { oldPid: before.pid, newPid: after.pid };
  };
  const completeRun = async (run) => wait('Cron completion', async () => {
    const job = await rpc('cron.get', { id: run.jobId });
    return job.state?.runningAtMs === undefined && job.state?.lastRunAtMs ? job : false;
  });
  let originPlan;
  let handoffMarker;
  const fromChannel = async () => {
    const marker = 'RC10-H-03-' + randomUUID();
    originPlan = { marker, job: {
      name: marker, enabled: true, deleteAfterRun: false,
      schedule: { kind: 'at', at: new Date(Date.now() + 15000).toISOString() },
      sessionTarget: 'isolated', wakeMode: 'now',
      payload: { kind: 'agentTurn', message: 'DELIVER_RESULT ' + marker, timeoutSeconds: 120 },
      delivery: { mode: 'announce', channel: 'irc', to: '#rc10', bestEffort: false },
    } };
    const { createConnection } = await import('node:net');
    const client = createConnection({ host: '127.0.0.1', port: peer.port });
    client.setEncoding('utf8');
    client.on('data', (data) => {
      for (const line of data.split('\r\n')) if (line.startsWith('PING ')) client.write('PONG ' + line.slice(5) + '\r\n');
    });
    try {
      await new Promise((done, fail) => { client.once('connect', done); client.once('error', fail); });
      client.write('NICK rc10driver\r\nUSER rc10driver 0 * :RC10 agent\r\nJOIN #rc10\r\n');
      await wait('IRC driver join', () => peer.events.some((e) => e.event === 'join' && e.nick === 'rc10driver'));
      client.write('PRIVMSG #rc10 :Create the controlled scheduled announcement ' + marker + '.\r\n');
      const job = await wait('channel-originated cron.add', async () => (await rpc('cron.list', { includeDisabled: true })).jobs?.find((j) => j.name === marker), 60000);
      originPlan.jobId = job.id;
      assert.equal(job.delivery?.channel, 'irc');
      assert.equal(job.delivery?.to, '#rc10');
      const originSessions = (await rpc('sessions.list', {})).sessions ?? [];
      const originSession = originSessions.find((s) => s.key?.includes(':irc:'));
      const originReceipt = await wait('channel-originated ContextReceipt', async () => (await snapshot()).receipts.find((r) => r.kind === 'context' && (r.session_key === originSession?.key || r.session_key === originSession?.sessionId)), 15000);
      assert(originReceipt, 'channel-originated model call must have a context receipt');
      const approval = await pending(job.id);
      const identityOffset = approval.idempotency_key.indexOf(':agent:');
      assert(identityOffset > 0, 'approval must carry a canonical agent session');
      const run = { id: 'H-03', marker, jobId: job.id, originSessionKey: originSession.key, sessionKey: approval.idempotency_key.slice(identityOffset + 1), approvalId: approval.approval_id, idempotencyKey: approval.idempotency_key };
      run.runId = runIdentity(run).runId;
      await assertNoEffect(run);
      const done = await approved(run);
      const data = await snapshot();
      const contexts = data.receipts.filter((r) => r.kind === 'context' && r.run_id === runIdentity(run).runId);
      const wires = data.receipts.filter((r) => r.kind === 'wire' && r.run_id === runIdentity(run).runId);
      const paired = (contexts, wires) => contexts.length > 0 && contexts.length === wires.length && contexts.every((c) => wires.filter((w) => w.correlation_digest === c.correlation_digest && w.run_id === c.run_id).length === 1);
      assert(paired(contexts, wires), 'Cron model calls need one context/wire pair each');
      const originContexts = data.receipts.filter((r) => r.kind === 'context' && r.run_id === originReceipt.run_id);
      const originWires = data.receipts.filter((r) => r.kind === 'wire' && r.run_id === originReceipt.run_id);
      assert(paired(originContexts, originWires), 'every origin model call needs a context/wire pair');
      const projection = await lineage(run);
      assert.equal(projection.effectReceipt, done.effectReceiptId);
      assert(contexts.every((c) => projection.contextReceipts.includes(c.receipt_id)));
      return { ...done, lineage: projection, origin: { channel: 'irc', target: '#rc10', sender: 'rc10driver', contextReceiptIds: originContexts.map((r) => r.receipt_id), wireReceiptIds: originWires.map((r) => r.receipt_id) }, contextReceiptIds: contexts.map((r) => r.receipt_id), wireReceiptIds: wires.map((r) => r.receipt_id), modelRunIds: [...new Set(contexts.map((r) => r.run_id))] };
    } finally { client.destroy(); originPlan = undefined; }
  };
  try {
    event('begin', { candidate, scenario, root });
    peer = await startIrcServer({ logPath: join(evidence, 'irc.jsonl') });
    llm = await startScriptedLlm((userText, toolResults) => {
      if (handoffMarker && userText.includes('# Handoff: continue') && userText.includes(handoffMarker)) return { text: 'Handoff received. Preserve the existing result without replay: ' + handoffMarker };
      if (originPlan?.jobId && userText.includes('[cron:' + originPlan.jobId + ' ') && userText.includes('DELIVER_RESULT ' + originPlan.marker)) return { text: originPlan.marker };
      if (originPlan && userText.includes(originPlan.marker) && !toolResults['rc10origincron']) {
        originPlan.job.schedule.at = new Date(Date.now() + 10000).toISOString();
        return { toolCall: { id: 'rc10origincron', name: 'cron', args: { action: 'add', job: originPlan.job } } };
      }
      return { text: 'The requested scheduled task has been created.' };
    });
    // Opt in only this disposable profile to the existing DCS evidence path.
    // The repository and the owner's normal profile retain their defaults.
    await mkdir(join(home, '.openclaw'), { recursive: true });
    await writeFile(join(home, '.openclaw', 'openclaw.json'), JSON.stringify({ runtime: { contextBlock: { 'working-memory': { enabled: true }, 'tool-registry': { enabled: true } }, rc03: { seal: true } } }));
    const port = await allocatePort();
    await writeFile(join(userData, 'settings.json'), JSON.stringify({ language: 'en', gatewayAutoStart: false, gatewayPort: port }));
    const env = Object.fromEntries(Object.entries({
      ...process.env, ELECTRON_RUN_AS_NODE: undefined, RC10_PROVIDER_KEY: undefined,
      HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'), XDG_CONFIG_HOME: join(home, '.config'),
      VERSE_CLAW_USER_DATA_DIR: userData, VERSE_CLAW_E2E: '1', VERSE_CLAW_E2E_SKIP_SETUP: '1', CLAWX_AGENT_DEV: '1',
      RC05_OPERATOR_SLICE: '1', OPENCLAW_RC02_SHADOW_CENSUS: '1', OPENCLAW_RC03_SEAL: '1', OPENCLAW_SKIP_CRON: '0',
    }).filter(([, value]) => value !== undefined));
    app = await _electron.launch({ executablePath: require('electron'), args: ['--disable-gpu', '--in-process-gpu', join(repo, 'dist-electron/main/index.js')], env, timeout: 120000 });
    appProcess = app.process();
    appProcess.stdout?.on('data', (v) => { appLog += v; });
    appProcess.stderr?.on('data', (v) => { appLog += v; });
    page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.verseClaw?.hostInvoke === 'function', null, { timeout: 120000 });
    const now = new Date().toISOString();
    await host('providers', 'save', { config: { id: 'rc10-local', name: 'RC10 local scripted model', type: 'custom', baseUrl: 'http://127.0.0.1:' + llm.port + '/v1', apiProtocol: 'openai-completions', model: MOCK_MODEL_ID, enabled: true, createdAt: now, updatedAt: now }, apiKey: 'rc10-local-placeholder' });
    await host('providers', 'setDefault', { providerId: 'rc10-local' });
    const created = await host('workspaces', 'create', { name: 'rc10-operator', rootPath: workspace, permissionMode: 'fullAccess' });
    workspaceId = created.activeWorkspaceId ?? created.profiles?.find((p) => resolve(p.rootPath) === resolve(workspace))?.id;
    assert(workspaceId, 'workspace id missing');
    await host('workspaces', 'switch', { id: workspaceId });
    await host('channels', 'saveConfig', { channelType: 'irc', config: { enabled: true, host: '127.0.0.1', port: peer.port, tls: false, nick: 'rc10bot', channels: ['#rc10'], groupPolicy: 'open', groups: { '#rc10': { requireMention: false } } } });
    await host('gateway', 'start');
    const ready = await gateway();
    await wait('real IRC channel join', () => peer.events.some((e) => e.event === 'join' && e.nick === 'rc10bot'), 60000);
    event('ready', { gateway: ready, ircPort: peer.port });
    const ids = scenario === 'OPERATOR-ALL' ? ['H-02', 'H-03', 'H-04', 'H-05', 'H-06'] : [scenario];
    for (const id of ids) {
      const startedAt = Date.now();
      try {
        let result;
        if (id === 'H-02') {
          result = await approved(await createCommand(id));
        } else if (id === 'H-03') {
          result = await fromChannel();
        } else if (id === 'H-04') {
          const run = await createCommand(id);
          const processChange = await restart();
          const recovered = (await snapshot()).approvals.find((a) => a.approval_id === run.approvalId);
          assert.equal(recovered?.state, 'approval_pending', 'pending approval must survive restart');
          await assertNoEffect(run);
          const recoveredLineage = await lineage(run);
          assert.equal(recoveredLineage.approval, run.approvalId);
          assert.equal(recoveredLineage.recovery, 'recovered');
          // This scenario observes pending recovery, not replay of an interrupted command.
          await decide(run.approvalId, 'denied');
          await assertNoEffect(run);
          result = { ...run, processChange, recoveredLineage, pendingState: recovered.state, cleanupDecision: 'denied', continuationAfterApproval: 'not-tested' };
        } else if (id === 'H-05') {
          const run = await approved(await createCommand(id));
          await completeRun(run);
          const before = await lineage(run);
          const processChange = await restart();
          const after = await lineage(run);
          assert.equal(after.effectReceipt, run.effectReceiptId);
          assert(after.lineage.includes('effect:' + run.effectReceiptId + ':applied'));
          assert(after.lineage.includes('recovery:none-needed'));
          await sleep(1500);
          assert.equal(sent(run.marker).length, 1, 'completed effect replayed on restart');
          assert.equal((await snapshot()).effects.filter((e) => e.approval_id === run.approvalId).length, 1);
          result = { ...run, processChange, before, after, observation: 'applied message remains delivered; restart performs no automatic replay' };
        } else if (id === 'H-06') {
          const denied = await createCommand('H-06-deny');
          await decide(denied.approvalId, 'denied');
          await completeRun(denied);
          await assertNoEffect(denied);
          const cancelled = await createCommand('H-06-cancel');
          const tasks = await rpc('tasks.list', { limit: 100 });
          const task = tasks.tasks.find((t) => t.runtime === 'cron' && (t.sourceId === cancelled.jobId || t.runId?.includes(cancelled.jobId)));
          assert(task, 'live Cron task must expose its cancellation handle');
          const cancellation = await rpc('tasks.cancel', { taskId: task.taskId, reason: 'RC10 agent cancellation before effect' });
          assert.equal(cancellation.cancelled, true);
          await wait('cancelled approval resolved without effect', async () => (await snapshot()).approvals.find((a) => a.approval_id === cancelled.approvalId && a.state === 'denied'));
          await assertNoEffect(cancelled);
          // Reuse a real channel conversation with an acknowledged prior effect;
          // command-only jobs deliberately do not create a chat transcript.
          const prior = report.scenarios.find((s) => s.id === 'H-03' && s.result === 'pass') ?? await fromChannel();
          await completeRun(prior);
          // Cron receipts identify a run alias; chat history/fork uses the
          // persisted agentSessionKey that owns that run transcript.
          const runAliasOffset = prior.sessionKey.lastIndexOf(':run:');
          assert(runAliasOffset > 0, 'Cron run alias must identify its persisted session');
          const sourceSessionKey = prior.sessionKey.slice(0, runAliasOffset);
          const parentHistory = await rpc('chat.history', { sessionKey: sourceSessionKey, limit: 100 });
          const hasDeliveredText = (history) => (history.messages ?? []).some((message) => message.role === 'assistant' && (typeof message.content === 'string' ? message.content.includes(prior.marker) : message.content?.some((part) => part.type === 'text' && part.text?.includes(prior.marker))));
          assert(hasDeliveredText(parentHistory), 'source transcript must retain the delivered assistant effect');
          const fork = await host('sessions', 'fork', { sessionKey: sourceSessionKey, workspaceId, label: 'RC10 no replay fork' });
          assert(fork.forkedFromParent && fork.sessionKey !== sourceSessionKey);
          const forkHistory = await rpc('chat.history', { sessionKey: fork.sessionKey, limit: 100 });
          assert(hasDeliveredText(forkHistory), 'fork must retain the prior delivered assistant message');
          const handoff = await host('sessions', 'prepareHandoff', { sessionKey: sourceSessionKey, workspaceId });
          assert(handoff.checkpoint?.evidenceRefs?.some((ref) => ref.type === 'session' && ref.ref === sourceSessionKey), 'handoff must reference the source session containing the prior effect');
          assert(handoff.draft?.includes(prior.marker), 'handoff draft must retain the actual prior assistant result');
          handoffMarker = prior.marker;
          const targetSessionKey = 'agent:main:dashboard:' + randomUUID();
          const transfer = await host('chat', 'sendWithMedia', { sessionKey: targetSessionKey, workspaceId, message: handoff.draft, idempotencyKey: randomUUID() });
          const transferRunId = transfer?.result?.runId ?? transfer?.runId;
          assert(transferRunId, 'handoff receiver must start a real run');
          const receiverHistory = await wait('handoff recipient response', async () => {
            const history = await rpc('chat.history', { sessionKey: targetSessionKey, limit: 100 });
            return hasDeliveredText(history) ? history : false;
          }, 60000);
          assert(JSON.stringify(receiverHistory).includes(sourceSessionKey), 'receiver must preserve the handoff source reference');
          const receiverState = await snapshot();
          const receiverContexts = receiverState.receipts.filter((r) => r.kind === 'context' && r.run_id === transferRunId);
          const receiverWires = receiverState.receipts.filter((r) => r.kind === 'wire' && r.run_id === transferRunId);
          assert(receiverContexts.length > 0 && receiverContexts.length === receiverWires.length && receiverContexts.every((c) => receiverWires.some((w) => w.correlation_digest === c.correlation_digest)), 'handoff receiver needs paired receipts');
          const handoffTransfer = { sessionKey: targetSessionKey, runId: transferRunId, history: receiverHistory, contextReceiptIds: receiverContexts.map((r) => r.receipt_id), wireReceiptIds: receiverWires.map((r) => r.receipt_id) };
          handoffMarker = undefined;
          assert.equal(sent(prior.marker).length, 1, 'fork or handoff replayed prior effect');
          result = { runIds: [denied.runId, cancelled.runId, prior.runId, transferRunId], effectReceiptIds: [prior.effectReceiptId], denied, cancelled, cancellation, prior, fork, handoff, handoffTransfer, parentHistory, forkHistory };
        } else {
          throw new Error('Unsupported operator scenario: ' + id);
        }
        const data = await snapshot();
        await save(id + '-state.json', data);
        await captureEvidence(page, join(evidence, id + '.png'));
        const runIds = result.runIds ?? [result.runId];
        assert(runIds.length > 0 && runIds.every((value) => typeof value === 'string' && value), 'scenario run IDs are required');
        const receiptIds = [...new Set([result.effectReceiptId, ...(result.effectReceiptIds ?? []), ...(result.contextReceiptIds ?? []), ...(result.wireReceiptIds ?? []), ...(result.origin?.contextReceiptIds ?? []), ...(result.origin?.wireReceiptIds ?? []), ...(result.handoffTransfer?.contextReceiptIds ?? []), ...(result.handoffTransfer?.wireReceiptIds ?? [])].filter(Boolean))];
        const recoveryObservation = {
          'H-02': 'No restart in this scenario; approved message acknowledged by IRC and one applied EffectReceipt persisted.',
          'H-03': 'Real channel origin and Cron model calls have paired receipts; the same run is linked to the applied channel effect.',
          'H-04': 'The same pending approval survives a changed Gateway PID, with zero result effects before the cleanup denial.',
          'H-05': 'The already delivered IRC message is irreversible by restart; the original applied receipt survives and the message is not repeated.',
          'H-06': 'Deny/cancel produces no result effect; fork and a separate handoff receiver preserve the prior result without replay.',
        }[id];
        report.scenarios.push({ id, result: 'pass', durationMs: Date.now() - startedAt, ...result, runIds, receiptIds, recoveryObservation, note: 'Agent-driven observation: ' + recoveryObservation });

        event('scenario.pass', { id });
      } catch (error) {
        const detail = String(error?.stack ?? error);
        report.scenarios.push({ id, result: 'fail', durationMs: Date.now() - startedAt, error: detail });
        report.failures.push(id);
        await captureEvidence(page, join(evidence, id + '-failed.png')).catch(() => {});
        await save(id + '-state.json', await snapshot());
        event('scenario.fail', { id, error: String(error?.message ?? error) });
        break;
      }
    }
  } catch (error) {
    report.failures.push('setup');
    report.error = String(error?.stack ?? error);
    event('setup.fail', { error: String(error?.message ?? error) });
  } finally {
    if (app) {
      const pid = appProcess?.pid;
      await app.close().catch(() => {});
      if (pid && process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* already closed */ }
      }
    }
    await peer?.close();
    if (llm) { llm.server.closeAllConnections(); await new Promise((done) => llm.server.close(done)); }
    await writeFile(join(evidence, 'app.log'), appLog);
    event('end', { evidence, failures: report.failures });
    if (llm) await save('scripted-provider.json', { driven_by: 'agent', model: MOCK_MODEL_ID, syntheticUsage: true, requests: llm.log, anomalies: llm.anomalies });
    await save('report.json', report);
    const hashes = {};
    for (const file of await readdir(evidence)) hashes[file] = digest(await readFile(join(evidence, file)));
    await save('hashes.json', hashes);
  }
  return report.failures.length ? 1 : 0;
}
