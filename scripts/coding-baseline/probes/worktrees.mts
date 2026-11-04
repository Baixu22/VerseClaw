import { repoRoot, outRoot, sourceUrl } from '../support.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const auditRoot = outRoot;
const fixtureRoot = mkdtempSync(path.join(auditRoot, 'fixtures-'));
const rows: Array<Record<string, unknown>> = [];
const record = (id: string, expected: unknown, actual: unknown, reproduced: boolean) => rows.push({ id, expected, actual, reproduced });
const ownRoot = (name: string) => {
  const root = path.resolve(fixtureRoot, name);
  if (!root.startsWith(path.resolve(fixtureRoot) + path.sep)) throw new Error('fixture boundary');
  mkdirSync(root, { recursive: true });
  return root;
};

try {
  const coding = await import(sourceUrl('shared/types/coding-run.ts'));
  const view = coding.createCodingRunView({ codingRunId: 'run-A' });
  const roundtrip = coding.parseCodingRunJsonl(coding.serializeCodingRunJsonl(view, [
    { type: 'loop', codingRunId: 'run-A', phase: 'verify', status: 'complete', iteration: null },
  ]));
  record('coding-run-optional-warning-roundtrip', 'status=ok for a valid typed event without optional warning', roundtrip, roundtrip.status === 'error');
  const wrongRun = coding.summarizeCodingRunJsonl(coding.serializeCodingRunJsonl(view, [
    { type: 'verification', codingRunId: 'run-B', status: 'passed', authority: 'task-loop-verification' },
  ]));
  record('coding-run-cross-run-verification', 'reject verification associated with run-B', wrongRun, 'verification' in wrongRun && wrongRun.verification === 'passed');
  const malformed = JSON.stringify({ schema: 'coding-run/v1', sequence: 0, recordType: 'coding-run', payload: { ...view, scope: {}, runIds: [42], taskLedgerRootId: 42, completion: { taskStatus: 'invented-status' } } });
  const nested = coding.parseCodingRunJsonl(malformed);
  record('coding-run-nested-schema-validation', 'reject malformed scope/runIds/taskLedgerRootId/completion', nested, nested.status === 'ok');
} catch (error) { rows.push({ id: 'coding-run-probe-error', error: String(error) }); }

try {
  const { createWorktreeService } = await import(sourceUrl('openclaw_runtime/src/agents/worktree-service.ts'));
  const { mergeOrchestrationWorktrees } = await import(sourceUrl('openclaw_runtime/src/agents/orchestration-worktree-merge.ts'));
  const merge = (root: string, id: string) => mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ taskNodeId: id, worktreeId: id, declaredWriteSet: ['a.txt'] }] });

  const deletionRoot = ownRoot('delete');
  writeFileSync(path.join(deletionRoot, 'a.txt'), 'baseline');
  const deletionService = createWorktreeService(deletionRoot);
  const deletionWorker = deletionService.create('delete-worker', { writeSet: ['a.txt'], seedFiles: ['a.txt'] });
  unlinkSync(path.join(deletionWorker.root, 'a.txt'));
  const deletionResult = merge(deletionRoot, deletionWorker.id);
  const deletionActual = { result: deletionResult, baseFileStillExists: existsSync(path.join(deletionRoot, 'a.txt')) };
  record('worktree-deletion-silently-not-merged', 'delete a.txt in base or report a failure', deletionActual, deletionActual.baseFileStillExists && deletionResult[0]?.status === 'merged');

  const staleRoot = ownRoot('stale-base');
  writeFileSync(path.join(staleRoot, 'a.txt'), 'baseline');
  const staleService = createWorktreeService(staleRoot);
  const staleWorker = staleService.create('stale-worker', { writeSet: ['a.txt'], seedFiles: ['a.txt'] });
  writeFileSync(path.join(staleWorker.root, 'a.txt'), 'worker-change');
  writeFileSync(path.join(staleRoot, 'a.txt'), 'concurrent-owner-change');
  const staleResult = merge(staleRoot, staleWorker.id);
  const staleActual = { result: staleResult, baseContents: readFileSync(path.join(staleRoot, 'a.txt'), 'utf8') };
  record('worktree-overwrites-concurrent-base-edit', 'conflict and preserve concurrent-owner-change', staleActual, staleActual.baseContents === 'worker-change' && staleResult[0]?.status === 'merged');

  for (const scenario of ['delete', 'stale'] as const) {
    const root = ownRoot('git-' + scenario);
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init']);
    git(['config', 'user.email', 'audit@example.invalid']);
    git(['config', 'user.name', 'Audit Fixture']);
    writeFileSync(path.join(root, 'a.txt'), 'baseline');
    git(['add', 'a.txt']);
    git(['-c', 'core.hooksPath=NUL', 'commit', '-m', 'fixture baseline']);
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('git-' + scenario, { writeSet: ['a.txt'], seedFiles: ['a.txt'] });
    if (scenario === 'delete') unlinkSync(path.join(worker.root, 'a.txt'));
    else {
      writeFileSync(path.join(worker.root, 'a.txt'), 'worker-change');
      writeFileSync(path.join(root, 'a.txt'), 'concurrent-owner-change');
    }
    const result = merge(root, worker.id);
    const contents = existsSync(path.join(root, 'a.txt')) ? readFileSync(path.join(root, 'a.txt'), 'utf8') : null;
    record('git-worktree-' + scenario, scenario === 'delete' ? 'delete a.txt or report failure' : 'preserve concurrent base edit and report conflict', { backend: worker.backend, result, contents }, worker.backend === 'git' && result[0]?.status === 'merged' && (scenario === 'delete' ? contents === 'baseline' : contents === 'worker-change'));
  }

  const traversalRoot = ownRoot('reserved-id');
  const controlDir = path.join(traversalRoot, '.openclaw');
  mkdirSync(controlDir);
  const marker = path.join(controlDir, 'owned-marker.txt');
  writeFileSync(marker, 'private runtime metadata fixture');
  const traversalService = createWorktreeService(traversalRoot);
  let traversalResult: unknown;
  try { traversalResult = traversalService.create('..'); }
  catch (error) { traversalResult = { error: String(error) }; }
  const traversalActual = { result: traversalResult, markerPreserved: existsSync(marker), fixtureBoundary: traversalRoot };
  record('worktree-dotdot-id-deletes-control-directory', 'reject reserved id before any mutation', traversalActual, !traversalActual.markerPreserved);
} catch (error) { rows.push({ id: 'worktree-probe-error', error: String(error) }); }

const report = { schema: 'CodingAuditProbe/v1', driven_by: 'agent', actor: 'codex-coding-audit', realHumanEvidence: false, recordedAt: new Date().toISOString(), candidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim(), fixtureRoot, rows };
writeFileSync(path.join(auditRoot, 'probe-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = rows.some(row => 'error' in row) ? 2 : 0;
