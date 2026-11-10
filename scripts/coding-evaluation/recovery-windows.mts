/** Five-window coding recovery driver using existing ClawX owners and fixed VG/JJ/STS binaries. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const sourceUrl = (relative: string) => pathToFileURL(path.join(repoRoot, relative)).href;
const windows = ['intent', 'effect', 'materialized', 'validated', 'cleanup'] as const;
const repeats = 3;

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function run(exe: string, args: string[], cwd: string, env = process.env): { code: number; stdout: string; stderr: string } {
  const result = execFileSync(exe, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: 0, stdout: String(result), stderr: '' };
}

function runAllowFailure(exe: string, args: string[], cwd: string, env = process.env): { code: number; stdout: string; stderr: string } {
  try { return run(exe, args, cwd, env); }
  catch (error: any) { return { code: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }; }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function findTaskLedgerEvents(workspace: string): string[] {
  const root = path.join(workspace, '.state', 'task-ledgers', 'workspaces');
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name === 'events.jsonl') found.push(target);
    }
  };
  visit(root);
  return found.sort();
}

function readTaskLedgerProjection(workspace: string): Record<string, any> {
  const eventsPath = findTaskLedgerEvents(workspace)[0];
  if (!eventsPath) {
    return { schema: 'CodingRecoveryTaskLedgerProjection/v1', rootId: null, eventCount: 0,
      phase: null, status: null, terminal: false, completionAuthorized: null, ownerEpoch: null, eventsPath: null };
  }
  const events = fs.readFileSync(eventsPath, 'utf8').split(/\r?\n/u).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const created = events.find((event) => event?.type === 'node_created' && event?.payload?.node?.kind === 'goal');
  const rootId = created?.payload?.node?.id ?? created?.taskId ?? null;
  let metadata: Record<string, unknown> = rootId ? { ...(created?.payload?.node?.metadata ?? {}) } : {};
  let status: string | null = created?.payload?.node?.status ?? null;
  for (const event of events) {
    if (event?.type !== 'node_updated' || event?.taskId !== rootId) continue;
    const patch = event?.payload?.patch ?? {};
    if (patch.status) status = patch.status;
    if (patch.metadata) metadata = { ...metadata, ...patch.metadata };
  }
  return {
    schema: 'CodingRecoveryTaskLedgerProjection/v1', rootId,
    eventCount: events.length, eventsPath: path.relative(workspace, eventsPath),
    phase: metadata.phase ?? null, status, terminal: metadata.terminal === true,
    completionAuthorized: metadata.completionAuthorized === true,
    ownerEpoch: typeof metadata.ownerEpoch === 'string' ? metadata.ownerEpoch : null,
    latestEventId: events.at(-1)?.id ?? null,
  };
}

async function childMain(mode: '--child' | '--readback' | '--inspect', window: string, workspace: string): Promise<void> {
  process.env.OPENCLAW_HOME = workspace;
  process.env.OPENCLAW_STATE_DIR = path.join(workspace, '.state');
  process.env.OPENCLAW_CONFIG_PATH = path.join(workspace, 'openclaw.json');
  const journal = await import(sourceUrl('openclaw_runtime/src/agents/tools/write-journal-core.ts'));
  const ledgerOwner = await import(sourceUrl('openclaw_runtime/src/agents/long-task-control/task-ledger.ts'));
  const processOwner = await import(sourceUrl('openclaw_runtime/src/agents/goal-wake-helper-protocol.ts'));
  const { ProcessRunReconciler } = await import(sourceUrl('openclaw_runtime/src/agents/process-run-reconciler.ts'));
  const stateDir = path.join(workspace, '.openclaw', 'recovery');
  const vgReceiptDir = path.join(path.dirname(workspace), `.vg-receipt-${path.basename(workspace)}`);
  const vgReceipt = path.join(stateDir, 'vg-receipt.json');
  const stsReport = path.join(stateDir, 'sts-plan.json');
  const tempPath = path.join(workspace, '.recovery-cleanup');
  const python = process.env.TF0780_PYTHON!;
  const vg = process.env.TF0780_VG!;
  const jj = process.env.TF0780_JJ!;
  const contracts = process.env.TF0780_CONTRACTS!;
  const env = { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp', VG_CONTRACT_DIR: contracts, JJ_CONFIG: path.join(workspace, '.jj-config.toml') };
  const runId = path.basename(workspace);
  const sessionKey = 'kill-window';
  const ownerEpoch = `epoch-${sha256Text(runId).slice(0, 16)}`;
  const restartEpoch = `restart-${sha256Text(`${runId}:restart`).slice(0, 16)}`;
  const ledgerRootId = ledgerOwner.stableLongTaskLedgerRootId({ workspaceId: runId, sessionKey, runId, source: 'task_loop' });
  const durableRoot = path.join(workspace, '.state', 'background-processes');
  fs.mkdirSync(stateDir, { recursive: true });
  let ledgerInitialized = false;
  const readJson = (file: string) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

  const appendLedger = (phase: string, extra: Record<string, unknown> = {}, status = 'doing'): Record<string, any> => {
    if (!ledgerInitialized) {
      ledgerOwner.ensureLongTaskLedgerRoot({
        workspaceId: runId, taskLedgerRootId: ledgerRootId, sessionKey,
        agentId: 'codex-coding-recovery-evaluator', runId,
        title: 'TF-0780 cross-process recovery window', source: 'task_loop',
        metadata: { taskLedgerRootId: ledgerRootId, window, ownerEpoch }, env,
      });
      ledgerInitialized = true;
    }
    const updatedAt = new Date().toISOString();
    ledgerOwner.appendLongTaskLedgerEvents(runId, [{
      type: 'node_updated', actor: 'assistant', taskId: ledgerRootId, sessionId: sessionKey,
      idempotencyKey: `tf0780:${runId}:${phase}:${status}`,
      payload: {
        nodeId: ledgerRootId,
        patch: {
          status,
          updatedAt,
          metadata: { phase, window, ownerEpoch, terminal: false, completionAuthorized: false, ...extra },
        },
        note: `TF-0780 phase ${phase}`,
      },
    }] as any, env);
    return readTaskLedgerProjection(workspace);
  };

  const inspectState = async (): Promise<Record<string, any>> => {
    const entries = journal.getOrCreateWriteJournal(workspace, sessionKey).entries;
    const durableFiles = await processOwner.readDurableHelperFiles(runId, { rootDir: durableRoot });
    const reconciler = new ProcessRunReconciler({ rootDir: durableRoot });
    const oldEpochAttempt = await reconciler.reconcile({ runId, ownerEpoch: restartEpoch });
    const expectedEpochAttempt = durableFiles.intent
      ? await reconciler.reconcile({ runId, ownerEpoch: durableFiles.intent.ownerEpoch })
      : { runId, state: 'missing', reason: 'intent-missing' };
    const gitStatus = run('git', ['-C', workspace, 'status', '--short'], repoRoot, env);
    const gitHead = run('git', ['-C', workspace, 'rev-parse', 'HEAD'], repoRoot, env);
    const base = fs.existsSync(path.join(workspace, '.tf0780-base'))
      ? fs.readFileSync(path.join(workspace, '.tf0780-base'), 'utf8').trim() : null;
    const jjStatus = runAllowFailure(jj, ['-R', workspace, '--no-pager', '--color', 'never', 'status'], repoRoot, env);
    const jjOperation = runAllowFailure(jj, ['-R', workspace, '--no-pager', '--color', 'never', 'op', 'log', '-n', '1', '--no-graph', '-T', 'self.id() ++ "\\n"'], repoRoot, env);
    const receiptDoc = readJson(vgReceipt);
    const stsDoc = readJson(stsReport);
    return {
      bytes: fs.readFileSync(path.join(workspace, 'a.txt'), 'utf8'),
      treeSha256: sha256File(path.join(workspace, 'a.txt')),
      states: entries.map((entry: any) => entry.batch?.state),
      ref: journal.writeJournalRecoveryRef(entries),
      git: gitStatus.stdout, gitHead: gitHead.stdout.trim(), base,
      jj: { ...jjStatus, operation: jjOperation },
      vgReceipt: receiptDoc ? {
        path: path.relative(workspace, vgReceipt), sha256: sha256File(vgReceipt),
        materialized: receiptDoc.materialized === true, candidate: receiptDoc.candidate ?? null,
      } : null,
      stsScope: stsDoc ? ((stsDoc.runs?.selected?.selection_scope ?? stsDoc.selection_scope) ?? 'unknown') : null,
      ledger: readTaskLedgerProjection(workspace),
      durableProcess: { files: durableFiles, oldEpochAttempt, expectedEpochAttempt },
      tempRemoved: !fs.existsSync(tempPath),
    };
  };

  if (mode === '--inspect') {
    process.send?.({ beforeRecovery: await inspectState(), inspected: true });
    process.disconnect?.();
    return;
  }

  if (mode === '--readback') {
    const beforeRecovery = await inspectState();
    const entries = journal.getOrCreateWriteJournal(workspace, sessionKey).entries;
    const oldEpochRejected = beforeRecovery.durableProcess.oldEpochAttempt?.state === 'lost'
      && beforeRecovery.durableProcess.oldEpochAttempt?.reason === 'owner-epoch-mismatch';
    const first = await journal.undoLastWrites({ workspaceRoot: workspace, sessionId: 'kill-window', steps: entries.length, workspaceOnly: true });
    const second = await journal.undoLastWrites({ workspaceRoot: workspace, sessionId: 'kill-window', steps: 1, workspaceOnly: true });
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { recursive: true, force: true });
    appendLedger('recovered', { terminal: true, completionAuthorized: false, recoveredAt: new Date().toISOString() }, 'review');
    const finalLedger = readTaskLedgerProjection(workspace);
    process.send?.({ beforeRecovery, first, second, oldEpochRejected, durableProcess: beforeRecovery.durableProcess, finalLedger,
      bytes: fs.readFileSync(path.join(workspace, 'a.txt'), 'utf8'), tempRemoved: !fs.existsSync(tempPath) });
    process.disconnect?.();
    return;
  }

  const { parsePatchText, resolvePatchPath, assertPatchParentPath } = await import(sourceUrl('openclaw_runtime/src/agents/apply-patch.ts'));
  const { preflightPatch, applyPreparedBatch } = await import(sourceUrl('openclaw_runtime/src/agents/apply-patch-preflight.ts'));
  const { decodeTextFile } = await import(sourceUrl('openclaw_runtime/src/agents/sessions/tools/text-file-codec.ts'));
  const { root } = await import(sourceUrl('openclaw_runtime/src/infra/fs-safe.ts'));
  const fileRoot = await root(workspace);
  const commandDigest = sha256Text(`tf0780:${runId}:${window}`);
  const durableIntent = await processOwner.createDurableHelperIntent({
    runId, commandDigest, policyRevision: 'tf0780-cross-process-recovery-v1', ownerEpoch,
  }, { rootDir: durableRoot });
  await processOwner.writeDurableHelperStarted({
    runId, runNonce: durableIntent.nonce, helperPid: process.pid, childPid: process.pid,
    startedAtMs: Date.now(), commandDigest,
  }, { rootDir: durableRoot });
  appendLedger('intent', { durableRunId: runId });
  const park = async (stage: string, extra: Record<string, unknown> = {}): Promise<never> => {
    appendLedger(stage, extra);
    setInterval(() => {}, 1000);
    process.send?.({ stage, extra });
    return await new Promise<never>(() => {});
  };
  const options = { cwd: workspace, workspaceOnly: true,
    journal: { workspaceRoot: workspace, sessionId: 'kill-window', requestId: 'kill-batch', enabled: true } };
  const ops = {
    exists: async (file: string) => fs.existsSync(file),
    readFile: async (file: string) => decodeTextFile(await fileRoot.readBytes(path.relative(workspace, file)), file),
    writeFile: async (file: string, bytes: Buffer | string) => {
      await fileRoot.write(path.relative(workspace, file), bytes, { mkdir: true });
      if (window === 'effect') await park('effect');
    },
    remove: async (file: string) => fileRoot.remove(path.relative(workspace, file)),
    mkdirp: async (dir: string) => { if (path.relative(workspace, dir)) await fileRoot.mkdir(path.relative(workspace, dir)); },
  };
  const hunks = parsePatchText('*** Begin Patch\n*** Update File: a.txt\n@@\n-before\n+after\n*** End Patch').hunks;
  const batch = await preflightPatch(hunks, options, ops, {
    resolvePath: (file: string, policy: any) => resolvePatchPath(file, options, policy),
    assertParentPath: (file: string) => assertPatchParentPath(file, options),
  });
  if (window === 'intent') await park('intent');
  const result = await applyPreparedBatch(batch, options, ops);
  if (result.batchState !== 'committed') throw new Error('normal journal commit failed');

  fs.writeFileSync(path.join(workspace, 'tests', 'test_extra.py'), 'def test_extra():\n    assert True\n', 'utf8');
  run('git', ['-C', workspace, 'add', 'a.txt', 'tests/test_extra.py'], repoRoot, env);
  run('git', ['-C', workspace, '-c', 'user.name=recovery-eval', '-c', 'user.email=recovery@example.invalid', 'commit', '-qm', 'candidate'], repoRoot, env);
  const base = fs.readFileSync(path.join(workspace, '.tf0780-base'), 'utf8').trim();
  const candidate = run('git', ['-C', workspace, 'rev-parse', 'HEAD'], repoRoot, env).stdout.trim();
  const vgResult = runAllowFailure(vg, ['verify', 'candidate', '--repo', workspace, '--ours', base, '--theirs', candidate, '--out-dir', vgReceiptDir, '--keep', '--json'], repoRoot, env);
  if (![0, 3].includes(vgResult.code)) throw new Error('VG candidate receipt failed: ' + vgResult.stderr);
  const vgPayload = JSON.parse(vgResult.stdout);
  if (vgPayload.materialized !== true || vgPayload.candidate?.parents?.[1] !== candidate) throw new Error('VG candidate receipt is not bound to the candidate');
  fs.writeFileSync(vgReceipt, vgResult.stdout, 'utf8');
  const stsResult = runAllowFailure(python, ['-B', '-m', 'smart_sorter.shadow', '--repo', workspace, '--test-dir', 'tests/test_extra.py', '--out', stsReport, '--timeout', '120'], repoRoot, env);
  if (stsResult.code !== 0) throw new Error('STS scope failed: ' + stsResult.stderr);
  const stsPayload = JSON.parse(fs.readFileSync(stsReport, 'utf8'));
  if (window === 'materialized') await park('materialized', { candidate, receiptSha256: sha256File(vgReceipt), stsScope: stsPayload.runs?.selected?.selection_scope ?? stsPayload.selection_scope });
  const validation = runAllowFailure(python, ['-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider'], workspace, env);
  writeJson(path.join(stateDir, 'validation.json'), { exitCode: validation.code, stdout: validation.stdout, stderr: validation.stderr, candidate });
  if (validation.code !== 0) throw new Error('validation failed');
  if (window === 'validated') await park('validated', { candidate, vgTarget: vgPayload.selection?.candidateIdentity ?? vgPayload.target_identity ?? null });
  fs.mkdirSync(tempPath, { recursive: true });
  fs.writeFileSync(path.join(tempPath, 'transient.txt'), 'cleanup pending\n');
  if (window === 'cleanup') await park('cleanup', { cleanupPending: true });
  fs.rmSync(tempPath, { recursive: true, force: true });
  appendLedger('returned', { candidate, completionAuthorized: false });
  if (window === 'control') {
    await processOwner.writeDurableHelperExit({
      runId, nonce: durableIntent.nonce, exitCode: 0, signal: null, timedOut: false,
      endedAtMs: Date.now(), outcomeDigest: processOwner.durableOutcomeDigest({ exitCode: 0, signal: null, timedOut: false }),
    }, { rootDir: durableRoot });
    process.send?.({ stage: 'returned', controlled: true, candidate });
  }
  process.disconnect?.();
}

if (process.argv[2] === '--child' || process.argv[2] === '--readback' || process.argv[2] === '--inspect') {
  await childMain(process.argv[2], process.argv[3], process.argv[4]);
} else {
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error('--output is required');
  const outRoot = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(outRoot, { recursive: true });
  const resultPath = path.join(outRoot, 'recovery-windows.json');
  if (fs.existsSync(resultPath)) throw new Error('output already exists');
  const childRun = (mode: string, window: string, workspace: string) => new Promise<any>((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [mode, window, workspace], { cwd: repoRoot, windowsHide: true, silent: true,
      env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp' } });
    let message: any = null; let stderr = '';
    child.stdout?.resume();
    child.stderr?.on('data', (bytes) => { stderr += String(bytes); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('recovery child timed out')); }, 180_000);
    child.on('message', (value: any) => {
      message = value;
      if (mode === '--child' && value?.stage === window) child.kill('SIGKILL');
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ message, code, signal, stderr }); });
  });
  const prepareWorkspace = (workspace: string) => {
    fs.mkdirSync(path.join(workspace, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'a.txt'), 'before\n');
    fs.writeFileSync(path.join(workspace, 'calc.py'), 'def add(a, b):\n    return a + b\n');
    fs.writeFileSync(path.join(workspace, 'tests', 'test_calc.py'), 'from calc import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n');
    fs.writeFileSync(path.join(workspace, '.gitignore'), '.openclaw/\n.state/\n.recovery-cleanup/\n.tf0780-base\n__pycache__/\n*.pyc\n');
    fs.writeFileSync(path.join(workspace, '.jj-config.toml'), '[user]\nname="Recovery Eval"\nemail="recovery@example.invalid"\n');
    run('git', ['init', '-q', '-b', 'main'], workspace);
    run('git', ['config', 'user.name', 'recovery-eval'], workspace);
    run('git', ['config', 'user.email', 'recovery@example.invalid'], workspace);
    run('git', ['add', '-A'], workspace);
    run('git', ['commit', '-qm', 'base'], workspace);
    fs.writeFileSync(path.join(workspace, '.tf0780-base'), run('git', ['rev-parse', 'HEAD'], workspace).stdout + '\n');
    return runAllowFailure(process.env.TF0780_JJ!, ['git', 'init', '--colocate'], workspace,
      { ...process.env, JJ_CONFIG: path.join(workspace, '.jj-config.toml') });
  };

  const controlWorkspace = path.join(outRoot, 'control');
  const controlJjInit = prepareWorkspace(controlWorkspace);
  const controlRun = await childRun('--child', 'control', controlWorkspace);
  const controlInspect = await childRun('--inspect', 'control', controlWorkspace);
  const controlled = controlInspect.message?.beforeRecovery;
  const control = {
    jjInit: controlJjInit, run: controlRun, inspect: controlInspect,
    pass: controlJjInit.code === 0 && controlRun.code === 0 && controlRun.signal === null
      && controlRun.message?.stage === 'returned' && controlInspect.code === 0
      && controlled?.bytes === 'after\n' && controlled?.states?.length === 1 && controlled?.states?.[0] === 'committed'
      && controlled?.ledger?.phase === 'returned' && controlled?.ledger?.terminal === false
      && controlled?.ledger?.completionAuthorized === false
      && controlled?.vgReceipt?.materialized === true && ['selected', 'full'].includes(controlled?.stsScope)
      && controlled?.jj?.code === 0 && controlled?.jj?.operation?.code === 0
      && controlled?.durableProcess?.oldEpochAttempt?.reason === 'owner-epoch-mismatch'
      && controlled?.durableProcess?.expectedEpochAttempt?.state === 'terminal'
      && controlled?.durableProcess?.expectedEpochAttempt?.reason === 'exit-observed'
      && controlled?.durableProcess?.files?.exit?.exitCode === 0 && controlled?.tempRemoved === true,
  };

  const rows: any[] = [];
  for (const window of windows) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const workspace = path.join(outRoot, `${window}-${repeat}`);
      const jjInit = prepareWorkspace(workspace);
      const killed = await childRun('--child', window, workspace);
      const restarted = await childRun('--readback', window, workspace);
      const actual = restarted.message;
      const expectedEffect = window === 'intent' ? 'before\n' : 'after\n';
      const expectedJournal = ['intent', 'effect'].includes(window) ? 'prepared' : 'committed';
      const receiptsExpected = ['materialized', 'validated', 'cleanup'].includes(window);
      const pass = killed.message?.stage === window && killed.signal === 'SIGKILL'
        && jjInit.code === 0 && restarted.code === 0 && actual?.beforeRecovery?.bytes === expectedEffect
        && actual?.beforeRecovery?.treeSha256 === sha256Text(expectedEffect)
        && actual.beforeRecovery.states.length === 1 && actual.beforeRecovery.states[0] === expectedJournal
        && actual.first.errors.length === 0 && actual.first.restored.length === 1
        && actual.second.errors.length === 0 && actual.second.restored.length === 0
        && actual.bytes === 'before\n' && actual.oldEpochRejected && actual.tempRemoved
        && actual.beforeRecovery.ledger?.phase === window
        && actual.beforeRecovery.ledger?.terminal === false && actual.beforeRecovery.ledger?.completionAuthorized === false
        && actual.beforeRecovery.ledger?.ownerEpoch === actual.beforeRecovery.durableProcess?.files?.intent?.ownerEpoch
        && actual.beforeRecovery.durableProcess?.oldEpochAttempt?.state === 'lost'
        && actual.beforeRecovery.durableProcess?.oldEpochAttempt?.reason === 'owner-epoch-mismatch'
        && actual.beforeRecovery.durableProcess?.expectedEpochAttempt?.state === 'lost'
        && actual.beforeRecovery.durableProcess?.expectedEpochAttempt?.reason === 'started-helper-dead'
        && (actual.beforeRecovery.vgReceipt !== null) === receiptsExpected
        && (!receiptsExpected || actual.beforeRecovery.vgReceipt?.materialized === true)
        && (!receiptsExpected || actual.beforeRecovery.vgReceipt?.candidate?.parents?.[1] === actual.beforeRecovery.gitHead)
        && typeof actual.beforeRecovery.jj?.stdout === 'string'
        && actual.beforeRecovery.jj?.code === 0 && actual.beforeRecovery.jj?.operation?.code === 0
        && typeof actual.beforeRecovery.jj?.operation?.stdout === 'string' && actual.beforeRecovery.jj.operation.stdout.trim().length > 0
        && (receiptsExpected ? ['selected', 'full'].includes(actual.beforeRecovery.stsScope) : actual.beforeRecovery.stsScope === null)
        && actual.finalLedger?.phase === 'recovered' && actual.finalLedger?.terminal === true
        && actual.finalLedger?.status === 'review' && actual.finalLedger?.completionAuthorized === false;
      rows.push({ window, repeat, workspace, jjInit, killed, restarted, pass });
    }
  }
  const report = { schema: 'CodingRecoveryWindows/v2', driven_by: 'agent', actor: 'codex-coding-recovery-evaluator',
    realHumanEvidence: false, windows, repeats, control, rows,
    pass: control.pass && rows.length === windows.length * repeats && rows.every((row) => row.pass) };
  writeJson(resultPath, report);
  console.log(JSON.stringify({ schema: report.schema, rows: rows.length, pass: report.pass }));
  if (!report.pass) process.exitCode = 1;
}
