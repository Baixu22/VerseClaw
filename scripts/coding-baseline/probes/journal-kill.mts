/** Agent-driven process kill windows around the existing Coding journal owner. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The common baseline bootstrap creates its config with wx; each child must
// own its state instead of re-running that bootstrap against the parent's path.
const repoRoot = process.cwd();
if (!process.env.CODING_BASELINE_OUTPUT) throw new Error('CODING_BASELINE_OUTPUT is required');
const outRoot = path.resolve(process.env.CODING_BASELINE_OUTPUT);
const sourceUrl = (relative: string) => pathToFileURL(path.join(repoRoot, relative)).href;

const mode = process.argv[2];
if (mode === '--child' || mode === '--readback') {
  const window = process.argv[3];
  const workspace = process.argv[4];
  process.env.OPENCLAW_HOME = workspace;
  process.env.OPENCLAW_STATE_DIR = path.join(workspace, '.state');
  process.env.OPENCLAW_CONFIG_PATH = path.join(workspace, 'openclaw.json');
  const journal = await import(sourceUrl('openclaw_runtime/src/agents/tools/write-journal-core.ts'));
  if (mode === '--readback') {
    const entries = journal.getOrCreateWriteJournal(workspace, 'kill-window').entries;
    const beforeRecovery = { bytes: fs.readFileSync(path.join(workspace, 'a.txt'), 'utf8'),
      states: entries.map((entry) => entry.batch?.state), ref: journal.writeJournalRecoveryRef(entries) };
    const first = await journal.undoLastWrites({ workspaceRoot: workspace, sessionId: 'kill-window', steps: entries.length, workspaceOnly: true });
    const second = await journal.undoLastWrites({ workspaceRoot: workspace, sessionId: 'kill-window', steps: 1, workspaceOnly: true });
    process.send?.({ beforeRecovery, first, second, bytes: fs.readFileSync(path.join(workspace, 'a.txt'), 'utf8') });
    process.disconnect?.();
  } else {
    const { parsePatchText, resolvePatchPath, assertPatchParentPath } = await import(sourceUrl('openclaw_runtime/src/agents/apply-patch.ts'));
    const { preflightPatch, applyPreparedBatch } = await import(sourceUrl('openclaw_runtime/src/agents/apply-patch-preflight.ts'));
    const { decodeTextFile } = await import(sourceUrl('openclaw_runtime/src/agents/sessions/tools/text-file-codec.ts'));
    const { root } = await import(sourceUrl('openclaw_runtime/src/infra/fs-safe.ts'));
    const fileRoot = await root(workspace);
    const park = async (stage: string): Promise<never> => {
      setInterval(() => {}, 1000);
      process.send?.({ stage });
      return await new Promise<never>(() => {});
    };
    const options = { cwd: workspace, workspaceOnly: true,
      journal: { workspaceRoot: workspace, sessionId: 'kill-window', requestId: 'kill-batch', enabled: true } };
    const ops = {
      exists: async (file: string) => fs.existsSync(file),
      readFile: async (file: string) => decodeTextFile(await fileRoot.readBytes(path.relative(workspace, file)), file),
      writeFile: async (file: string, bytes: Buffer | string) => {
        await fileRoot.write(path.relative(workspace, file), bytes, { mkdir: true });
        if (window === 'effect-written') await park(window);
      },
      remove: async (file: string) => fileRoot.remove(path.relative(workspace, file)),
      mkdirp: async (dir: string) => { if (path.relative(workspace, dir)) await fileRoot.mkdir(path.relative(workspace, dir)); },
    };
    const hunks = parsePatchText('*** Begin Patch\n*** Update File: a.txt\n@@\n-before\n+after\n*** End Patch').hunks;
    const batch = await preflightPatch(hunks, options, ops, {
      resolvePath: (file, policy) => resolvePatchPath(file, options, policy),
      assertParentPath: (file) => assertPatchParentPath(file, options),
    });
    if (window === 'prepared') await park(window);
    const result = await applyPreparedBatch(batch, options, ops);
    if (result.batchState !== 'committed') throw new Error('normal journal commit failed');
    await park('committed');
  }
} else {
  fs.mkdirSync(outRoot, { recursive: true });
  const area = fs.mkdtempSync(path.join(outRoot, 'journal-kill-'));
  const childRun = (args: string[], killAt?: string) => new Promise<{ message: any; code: number | null; signal: string | null; stderr: string }>((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), args, { cwd: repoRoot, windowsHide: true, silent: true,
      env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp' } });
    let message: unknown; let stderr = '';
    child.stderr?.on('data', (bytes) => { stderr += String(bytes); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('journal kill driver timed out')); }, 90_000);
    child.on('message', (value: { stage?: string }) => {
      message = value;
      if (killAt && value.stage === killAt) child.kill('SIGKILL');
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ message, code, signal, stderr }); });
  });
  const rows = [];
  for (const window of ['prepared', 'effect-written', 'committed']) {
    const workspace = path.join(area, window); await fsp.mkdir(workspace);
    await fsp.writeFile(path.join(workspace, 'a.txt'), 'before\n');
    await fsp.writeFile(path.join(workspace, 'openclaw.json'), '{}');
    const killed = await childRun(['--child', window, workspace], window);
    if (killed.message?.stage !== window || (killed.code === 0 && !killed.signal)) {
      rows.push({ window, killed, pass: false, reason: 'kill-window-not-reached' });
      break;
    }
    const restarted = await childRun(['--readback', window, workspace]);
    const actual = restarted.message;
    const expectedState = window === 'committed' ? 'committed' : 'prepared';
    const pass = restarted.code === 0 && actual?.beforeRecovery?.bytes === (window === 'prepared' ? 'before\n' : 'after\n')
      && actual.beforeRecovery.states.length === 1 && actual.beforeRecovery.states[0] === expectedState
      && actual.beforeRecovery.ref?.includes('batch=kill-batch') && actual.first.errors.length === 0
      && actual.first.restored.length === 1 && actual.second.errors.length === 0 && actual.second.restored.length === 0
      && actual.bytes === 'before\n';
    rows.push({ window, killed, restarted, pass });
  }
  const report = { schema: 'CodingJournalKillWindows/v1', driven_by: 'agent', actor: 'codex-coding-s6',
    realHumanEvidence: false, rows, pass: rows.every((row) => row.pass) };
  fs.writeFileSync(path.join(outRoot, 'journal-kill-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!report.pass) process.exitCode = 1;
}
