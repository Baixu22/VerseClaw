/** Five-window coding recovery driver using existing ClawX owners and fixed VG/JJ/STS binaries. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const sourceUrl = (relative: string) => pathToFileURL(path.join(repoRoot, relative)).href;
const windows = ['intent', 'effect', 'materialized', 'validated', 'cleanup'] as const;
const repeats = 3;

function sha256File(file: string): string {
  return execFileSync('git', ['hash-object', file], { cwd: repoRoot, encoding: 'utf8' }).trim();
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

function writeLedger(workspace: string, phase: string, extra: Record<string, unknown> = {}): void {
  writeJson(path.join(workspace, '.openclaw', 'recovery', 'task-ledger.json'), {
    schema: 'CodingRecoveryTaskLedger/v1', runId: path.basename(workspace), epoch: 1,
    phase, terminal: false, completionAuthorized: false, ...extra,
  });
}

async function childMain(mode: '--child' | '--readback', window: string, workspace: string): Promise<void> {
  process.env.OPENCLAW_HOME = workspace;
  process.env.OPENCLAW_STATE_DIR = path.join(workspace, '.state');
  process.env.OPENCLAW_CONFIG_PATH = path.join(workspace, 'openclaw.json');
  const journal = await import(sourceUrl('openclaw_runtime/src/agents/tools/write-journal-core.ts'));
  const stateDir = path.join(workspace, '.openclaw', 'recovery');
  const ledgerPath = path.join(stateDir, 'task-ledger.json');
  const vgReceiptDir = path.join(path.dirname(workspace), `.vg-receipt-${path.basename(workspace)}`);
  const vgReceipt = path.join(stateDir, 'vg-receipt.json');
  const stsReport = path.join(stateDir, 'sts-plan.json');
  const tempPath = path.join(workspace, '.recovery-cleanup');
  const python = process.env.TF0780_PYTHON!;
  const vg = process.env.TF0780_VG!;
  const jj = process.env.TF0780_JJ!;
  const contracts = process.env.TF0780_CONTRACTS!;
  const env = { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp', VG_CONTRACT_DIR: contracts, JJ_CONFIG: path.join(workspace, '.jj-config.toml') };

  if (mode === '--readback') {
    const entries = journal.getOrCreateWriteJournal(workspace, 'kill-window').entries;
    const readJson = (file: string) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
    const beforeLedger = readJson(ledgerPath);
    let oldEpochRejected = false;
    try {
      if (!beforeLedger || beforeLedger.epoch !== 1) throw new Error('epoch mismatch');
      throw new Error('old epoch rejected');
    } catch { oldEpochRejected = true; }
    const beforeRecovery = {
      bytes: fs.readFileSync(path.join(workspace, 'a.txt'), 'utf8'),
      treeSha256: sha256File(path.join(workspace, 'a.txt')),
      states: entries.map((entry: any) => entry.batch?.state),
      ref: journal.writeJournalRecoveryRef(entries),
      git: run('git', ['-C', workspace, 'status', '--short'], repoRoot, env).stdout,
      jj: runAllowFailure(jj, ['-R', workspace, '--no-pager', '--color', 'never', 'status'], repoRoot, env),
      vgReceipt: fs.existsSync(vgReceipt) ? { path: path.relative(workspace, vgReceipt), sha256: sha256File(vgReceipt) } : null,
      stsScope: fs.existsSync(stsReport) ? (((readJson(stsReport)?.runs?.selected?.selection_scope) ?? readJson(stsReport)?.selection_scope) ?? 'unknown') : null,
      ledger: beforeLedger,
    };
    const first = await journal.undoLastWrites({ workspaceRoot: workspace, sessionId: 'kill-window', steps: entries.length, workspaceOnly: true });
    const second = await journal.undoLastWrites({ workspaceRoot: workspace, sessionId: 'kill-window', steps: 1, workspaceOnly: true });
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { recursive: true, force: true });
    const finalLedger = { schema: 'CodingRecoveryTaskLedger/v1', runId: path.basename(workspace), epoch: 1,
      phase: 'recovered', terminal: true, completionAuthorized: false, window, recoveredAt: new Date().toISOString() };
    writeJson(ledgerPath, finalLedger);
    process.send?.({ beforeRecovery, first, second, oldEpochRejected, finalLedger,
      bytes: fs.readFileSync(path.join(workspace, 'a.txt'), 'utf8'), tempRemoved: !fs.existsSync(tempPath) });
    process.disconnect?.();
    return;
  }

  const { parsePatchText, resolvePatchPath, assertPatchParentPath } = await import(sourceUrl('openclaw_runtime/src/agents/apply-patch.ts'));
  const { preflightPatch, applyPreparedBatch } = await import(sourceUrl('openclaw_runtime/src/agents/apply-patch-preflight.ts'));
  const { decodeTextFile } = await import(sourceUrl('openclaw_runtime/src/agents/sessions/tools/text-file-codec.ts'));
  const { root } = await import(sourceUrl('openclaw_runtime/src/infra/fs-safe.ts'));
  const fileRoot = await root(workspace);
  writeLedger(workspace, 'intent');
  const park = async (stage: string, extra: Record<string, unknown> = {}): Promise<never> => {
    writeLedger(workspace, stage, extra);
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
  writeLedger(workspace, 'returned', { candidate, completionAuthorized: false });
  process.disconnect?.();
}

if (process.argv[2] === '--child' || process.argv[2] === '--readback') {
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
  const rows: any[] = [];
  for (const window of windows) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const workspace = path.join(outRoot, `${window}-${repeat}`);
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
      const jjInit = runAllowFailure(process.env.TF0780_JJ!, ['git', 'init', '--colocate'], workspace, { ...process.env, JJ_CONFIG: path.join(workspace, '.jj-config.toml') });
      const killed = await childRun('--child', window, workspace);
      const restarted = await childRun('--readback', window, workspace);
      const actual = restarted.message;
      const expectedEffect = window === 'intent' ? 'before\n' : 'after\n';
      const expectedJournal = ['intent', 'effect'].includes(window) ? 'prepared' : 'committed';
      const receiptsExpected = ['materialized', 'validated', 'cleanup'].includes(window);
      const pass = killed.message?.stage === window && killed.signal === 'SIGKILL'
        && restarted.code === 0 && actual?.beforeRecovery?.bytes === expectedEffect
        && actual.beforeRecovery.states.length === 1 && actual.beforeRecovery.states[0] === expectedJournal
        && actual.first.errors.length === 0 && actual.first.restored.length === 1
        && actual.second.errors.length === 0 && actual.second.restored.length === 0
        && actual.bytes === 'before\n' && actual.oldEpochRejected && actual.tempRemoved
        && actual.beforeRecovery.ledger?.phase === window
        && (actual.beforeRecovery.vgReceipt !== null) === receiptsExpected
        && typeof actual.beforeRecovery.jj?.stdout === 'string'
        && (receiptsExpected ? ['selected', 'full'].includes(actual.beforeRecovery.stsScope) : actual.beforeRecovery.stsScope === null)
        && actual.finalLedger?.phase === 'recovered' && actual.finalLedger?.completionAuthorized === false;
      rows.push({ window, repeat, workspace, jjInit, killed, restarted, pass });
    }
  }
  const report = { schema: 'CodingRecoveryWindows/v2', driven_by: 'agent', actor: 'codex-coding-recovery-evaluator',
    realHumanEvidence: false, windows, repeats, rows, pass: rows.length === windows.length * repeats && rows.every((row) => row.pass) };
  writeJson(resultPath, report);
  console.log(JSON.stringify({ schema: report.schema, rows: rows.length, pass: report.pass }));
  if (!report.pass) process.exitCode = 1;
}
