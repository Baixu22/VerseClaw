// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskSystemStore } from '../../shared/task-system/store';
import { canonicalPath, resolveTaskDomain } from '../../shared/task-system/identity';
import { createExecutionTaskAccess, openExecutionTaskStore } from '../../openclaw_runtime/src/agents/execution-task-authority';
import { createWorktreeService, resolveExecutionCheckout } from '../../openclaw_runtime/src/agents/worktree-service';
import * as registry from '../../openclaw_runtime/src/agents/worktree-registry';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { registerExecutionDomain, resolveExecutionDomain } from '../../openclaw_runtime/src/agents/execution-domain';
import { createPersistentTaskTool } from '../../openclaw_runtime/src/agents/tools/persistent-task-tool';

let fixture: string, repository: string, stateFile: string;
const stores: TaskSystemStore[] = [];
const bytes = Buffer.from('accepted historical artifact\n');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const contract = { objective: 'Keep the accepted result readable after cleanup', target: 'artifact.txt', constraints: [],
  acceptance: [{ id: 'file', description: 'Exact artifact', verification: { kind: 'file-sha256' as const, path: 'artifact.txt', sha256 } }] };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=NUL', ...args], { cwd, windowsHide: true, stdio: 'pipe', encoding: 'utf8' }).trim();
const storeAt = (root: string) => { const store = openExecutionTaskStore(root); stores.push(store); return store; };
function initialize(root: string) {
  mkdirSync(root, { recursive: true }); git(root, 'init', '-q', '-b', 'fixture-main');
  git(root, 'config', 'user.name', 'Agent fixture'); git(root, 'config', 'user.email', 'agent@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(root, '.gitignore'), '.openclaw/\n'); writeFileSync(path.join(root, 'artifact.txt'), bytes);
  git(root, 'add', '.gitignore', 'artifact.txt'); git(root, 'commit', '-qm', 'initial');
}
function accepted(root: string) {
  const store = storeAt(root), task = store.create(contract, 'create').task;
  const claim = store.claim(task.contract.taskNodeId, 'session-a', 'generation-a', 'claim').claim!;
  store.checkpoint(claim, { completed: ['write'], nextAction: 'verify', unresolved: [], artifacts: [{ path: 'artifact.txt', sha256 }] });
  store.verifyFile(claim, 'file', 'artifact.txt', sha256, 'candidate'); store.submit(claim, 'candidate'); store.accept(claim, 'candidate');
  return { store, taskId: task.contract.taskNodeId, claim };
}
function child(input: Record<string, unknown>) {
  const worker = spawn(process.execPath, ['--import', 'tsx', path.resolve('tests/unit/fixtures/task-retention-worker.mts'), Buffer.from(JSON.stringify(input)).toString('base64')],
    { cwd: path.resolve('openclaw_runtime'), env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; worker.stdout!.on('data', chunk => output += String(chunk)); worker.stderr!.on('data', chunk => output += String(chunk));
  const exited = new Promise<number | null>((resolve, reject) => { worker.once('exit', resolve); worker.once('error', reject); });
  return { worker, exited, output: () => output };
}
beforeEach(() => {
  fixture = mkdtempSync(path.join(tmpdir(), 'task-retention-')); repository = path.join(fixture, 'repository');
  stateFile = path.join(fixture, 'execution.sqlite');
  vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', stateFile); vi.stubEnv('OPENCLAW_STATE_DIR', path.join(fixture, 'state'));
  initialize(repository);
});
afterEach(() => {
  vi.restoreAllMocks(); for (const store of stores.splice(0)) store.close();
  closeOpenClawStateDatabaseForTest(); vi.unstubAllEnvs(); rmSync(fixture, { recursive: true, force: true });
});

describe('Task evidence retention and original checkout cleanup', () => {
  it('retains exact old bytes through newer HEAD, deletion, owner reopen and repeated cleanup', () => {
    const service = createWorktreeService(repository, { backend: 'git' }), row = service.create('history');
    const { taskId } = accepted(row.root);
    writeFileSync(path.join(row.root, 'artifact.txt'), 'new current revision\n');
    git(row.root, 'add', 'artifact.txt'); git(row.root, 'commit', '-qm', 'new current revision');
    const current = git(row.root, 'rev-parse', 'HEAD'); git(repository, 'branch', 'retained-current', current);
    const reader = storeAt(repository);
    expect(reader.worktreeTaskReferences(row.root)).toContain(taskId);
    service.cleanup(row.id);
    expect(existsSync(row.root)).toBe(false);
    const receipts = reader.retentionReceipts(taskId);
    expect(receipts).toHaveLength(2);
    for (const receipt of receipts) {
      expect(receipt.retained.commitOid).not.toBe(current);
      expect(reader.readRetainedArtifact(taskId, receipt.receiptId)).toEqual(bytes);
    }
    expect(reader.history(taskId).filter(event => event.kind === 'worktree_cleanup_completed')).toHaveLength(1);
    service.cleanup(row.id);
    const reopened = storeAt(repository);
    expect(reopened.retentionReceipts(taskId)).toEqual(receipts);
    expect(reopened.history(taskId).filter(event => event.kind === 'worktree_cleanup_completed')).toHaveLength(1);
    expect(() => reopened.readRetainedArtifact('wrong-task', receipts[0].receiptId)).toThrow('TASK_RETENTION_RECEIPT_NOT_FOUND');
  });

  it('retains overwritten legacy checkpoint paths using their historical writer after handoff', () => {
    const service = createWorktreeService(repository, { backend: 'git' }), row = service.create('legacy');
    const source = storeAt(row.root), task = source.create(contract, 'create').task;
    const claim = source.claim(task.contract.taskNodeId, 'a', 'ga', 'claim').claim!;
    const checkpoint = { completed: [], nextAction: 'handoff', unresolved: [], artifacts: [{ path: 'artifact.txt', sha256 }] };
    source.checkpoint(claim, checkpoint);
    source.db.prepare("UPDATE task_events SET json=? WHERE task_id=? AND kind='checkpoint'").run(JSON.stringify(checkpoint), claim.taskNodeId);
    const next = source.handoff(claim, 'b', 'gb', repository).claim!, target = storeAt(repository);
    target.checkpoint(next, { completed: [], nextAction: 'review', unresolved: [], artifacts: [] });
    expect(target.worktreeArtifactReferences(row.root)).toMatchObject([{ kind: 'checkpoint', worktree: canonicalPath(row.root), sha256 }]);
    service.cleanup(row.id);
    expect(target.get(next.taskNodeId).claim?.state).toBe('active');
    expect(target.readRetainedArtifact(next.taskNodeId, target.retentionReceipts(next.taskNodeId)[0].receiptId)).toEqual(bytes);
  });

  it('keeps a tree when a persisted retention ref is lost and never substitutes another receipt', () => {
    const service = createWorktreeService(repository, { backend: 'git' }), row = service.create('missing-ref');
    accepted(row.root); const reader = storeAt(repository);
    reader.prepareWorktreeCleanup(row.root, repository, `worktree-cleanup:${row.generation}`);
    const taskId = reader.worktreeArtifactReferences(row.root)[0].taskNodeId;
    const receipt = reader.retentionReceipts(taskId)[0]; git(repository, 'update-ref', '-d', receipt.retained.ref);
    expect(() => service.cleanup(row.id)).toThrow();
    expect(readFileSync(path.join(row.root, 'artifact.txt'))).toEqual(bytes);
    expect(service.list()[0].status).toBe('active');
  });

  it.each(['before-cleanup', 'after-preparation'] as const)('preserves an external edit inside the declared write set (%s)', phase => {
    const service = createWorktreeService(repository, { backend: 'git' });
    const row = service.create('external-edit', { writeSet: ['artifact.txt'] });
    const { taskId } = accepted(row.root), reader = storeAt(repository), changed = Buffer.from('external bytes after acceptance\n');
    const edit = () => writeFileSync(path.join(row.root, 'artifact.txt'), changed);
    if (phase === 'before-cleanup') edit();
    else {
      const save = registry.saveWorktreeRegistryScope;
      vi.spyOn(registry, 'saveWorktreeRegistryScope').mockImplementation(scope => {
        const result = save(scope);
        if (scope.records.get(row.id)?.status === 'cleaning') edit();
        return result;
      });
    }
    expect(() => service.cleanup(row.id)).toThrow(/worktree_cleanup_user_content_present|modified|untracked/i);
    expect(readFileSync(path.join(row.root, 'artifact.txt'))).toEqual(changed);
    expect(reader.history(taskId).some(event => event.kind === 'worktree_cleanup_completed')).toBe(false);
    for (const receipt of reader.retentionReceipts(taskId)) expect(reader.readRetainedArtifact(taskId, receipt.receiptId)).toEqual(bytes);
  });

  it('reads cleanup history and retained binary pages through the production task tool', async () => {
    const service = createWorktreeService(repository, { backend: 'git' }), row = service.create('tool-history');
    const { taskId } = accepted(row.root); service.cleanup(row.id);
    const tool = createPersistentTaskTool({ workspace: repository, sessionKey: 'reader', generation: 'reader-generation' });
    const history = (await tool.execute('history', { action: 'history', taskNodeId: taskId })).details as Array<{ kind: string; json: string }>;
    expect(history.some(event => event.kind === 'accepted')).toBe(true);
    expect(history.some(event => event.kind === 'worktree_cleanup_completed')).toBe(true);
    const receiptId = JSON.parse(history.find(event => event.kind === 'artifact_retained')!.json).receiptId;
    const output: Buffer[] = []; let offset: number | null = 0;
    while (offset !== null) {
      const page = (await tool.execute('read', { action: 'readRetainedArtifact', taskNodeId: taskId, receiptId, offset, length: 7 })).details as {
        content: string; nextOffset: number | null; sizeBytes: number;
      };
      expect(page.sizeBytes).toBe(bytes.length); output.push(Buffer.from(page.content, 'base64')); offset = page.nextOffset;
    }
    expect(Buffer.concat(output)).toEqual(bytes);
    await expect(tool.execute('wrong-task', { action: 'readRetainedArtifact', taskNodeId: 'wrong-task', receiptId })).rejects.toThrow('TASK_RETENTION_RECEIPT_NOT_FOUND');
    await expect(tool.execute('bad-range', { action: 'readRetainedArtifact', taskNodeId: taskId, receiptId, offset: -1 })).rejects.toThrow('TASK_ARTIFACT_RANGE_INVALID');
    expect(storeAt(repository).binding('reader', 'reader-generation')).toBeNull();
  });

  it('refuses active claims and pending effects before preparing historical receipts', () => {
    const service = createWorktreeService(repository, { backend: 'git' }), row = service.create('active');
    const store = storeAt(row.root), task = store.create(contract, 'create').task;
    const claim = store.claim(task.contract.taskNodeId, 'a', 'ga', 'claim').claim!;
    store.checkpoint(claim, { completed: [], nextAction: 'continue', unresolved: [], artifacts: [{ path: 'artifact.txt', sha256 }] });
    expect(() => service.cleanup(row.id)).toThrow('TASK_WORKTREE_HAS_UNFINISHED_TASKS');
    expect(store.retentionReceipts(task.contract.taskNodeId)).toEqual([]);
    expect(existsSync(row.root)).toBe(true);
  });

  it('rejects stale access after the same pathname is replaced', () => {
    const loose = path.join(fixture, 'loose'); mkdirSync(loose);
    const access = createExecutionTaskAccess(loose);
    rmSync(loose, { recursive: true }); mkdirSync(loose);
    expect(() => new TaskSystemStore(access.domain, undefined, access)).toThrow('TASK_AUTHORITY_STALE');
    expect(existsSync(access.domain.database)).toBe(false);
  });

  it('refuses shared core.worktree redirection at admission and cleanup', () => {
    const service = createWorktreeService(repository, { backend: 'git' }), row = service.create('native');
    const neighbour = path.join(fixture, 'neighbour'); initialize(neighbour);
    const nativeBinding = readFileSync(path.join(row.root, '.git'), 'utf8');
    git(repository, 'config', 'core.worktree', neighbour);
    expect(() => resolveExecutionCheckout(repository)).toThrow('GIT_WORKTREE_ROOT_MISMATCH');
    expect(() => service.cleanup(row.id)).toThrow('GIT_WORKTREE_ROOT_MISMATCH');
    expect(readFileSync(path.join(row.root, '.git'), 'utf8')).toBe(nativeBinding);
    expect(readFileSync(path.join(neighbour, 'artifact.txt'))).toEqual(bytes);
    expect(existsSync(row.root)).toBe(true);
  });

  it('uses the registered Task authority while retaining bytes in the source clone', () => {
    const authority = path.join(fixture, 'authority'); initialize(authority); const reader = storeAt(authority);
    registerExecutionDomain({ workspaceRoot: repository, authorityRoot: authority, actor: 'agent', operationId: 'register', expectedRevision: 0, projectRevision: 1 });
    const service = createWorktreeService(repository, { backend: 'git' }), row = service.create('registered');
    const { taskId } = accepted(row.root);
    expect(() => registerExecutionDomain({ workspaceRoot: repository, authorityRoot: authority, actor: 'agent', operationId: 'register-again', expectedRevision: 1, projectRevision: 2 }))
      .toThrow('execution_clone_has_task_references');
    service.cleanup(row.id);
    const receipt = reader.retentionReceipts(taskId)[0];
    expect(receipt.retained.repository).toBe(canonicalPath(path.join(repository, '.git')));
    expect(reader.readRetainedArtifact(taskId, receipt.receiptId)).toEqual(bytes);
  });

  it.each([false, true])('prevents authority reassignment with an external linked checkout reference (done=%s)', done => {
    const authority = path.join(fixture, 'authority'); initialize(authority); storeAt(authority);
    registerExecutionDomain({ workspaceRoot: repository, authorityRoot: authority, actor: 'agent', operationId: 'register', expectedRevision: 0, projectRevision: 1 });
    const external = path.join(fixture, 'external-linked'); git(repository, 'worktree', 'add', '--detach', external, 'HEAD');
    if (done) accepted(external);
    else {
      const store = storeAt(external), task = store.create(contract, 'external').task;
      store.claim(task.contract.taskNodeId, 'outside', 'generation', 'claim');
    }
    expect(() => registerExecutionDomain({ workspaceRoot: repository, authorityRoot: authority, actor: 'agent', operationId: 'reassign', expectedRevision: 1, projectRevision: 2 }))
      .toThrow('execution_clone_has_task_references');
  });

  it('reconciles a real process exit after removal using committed retention receipts', async () => {
    const service = createWorktreeService(repository, { backend: 'git' }), row = service.create('crash');
    const { taskId } = accepted(row.root), reader = storeAt(repository);
    const run = child({ mode: 'cleanup-crash', repository, id: row.id });
    expect(await run.exited, run.output()).toBe(23);
    expect(existsSync(row.root)).toBe(false);
    expect(reader.retentionReceipts(taskId)).toHaveLength(2);
    expect(reader.history(taskId).some(event => event.kind === 'worktree_cleanup_completed')).toBe(false);
    createWorktreeService(repository, { backend: 'git' }).cleanup(row.id);
    expect(reader.history(taskId).filter(event => event.kind === 'worktree_cleanup_completed')).toHaveLength(1);
    expect(reader.readRetainedArtifact(taskId, reader.retentionReceipts(taskId)[0].receiptId)).toEqual(bytes);
  }, 45000);

  it.each(['first-open', 'checkpoint', 'claim', 'register'] as const)('serializes cleanup against a competing process %s', async mode => {
    const service = createWorktreeService(repository, { backend: 'git' }), row = service.create(mode);
    const authority = path.join(fixture, 'authority'); initialize(authority); storeAt(authority);
    let credential, taskId;
    if (mode === 'checkpoint') {
      const store = storeAt(repository), task = store.create(contract, 'task').task;
      credential = store.claim(task.contract.taskNodeId, 'b', 'gb', 'claim').claim!;
    }
    if (mode === 'claim') taskId = storeAt(repository).create(contract, 'task').task.contract.taskNodeId;
    const ready = path.join(fixture, 'ready.json'), start = path.join(fixture, 'start'), result = path.join(fixture, 'result.json');
    const run = child({ mode, workspace: mode === 'checkpoint' ? repository : row.root, authority, contract, credential, taskId,
      artifact: { path: path.join(row.root, 'artifact.txt'), sha256 }, ready, start, result });
    try {
      await expect.poll(() => existsSync(ready), { timeout: 20000 }).toBe(true);
      const lock = `${stateFile}.task-domain-${createHash('sha256').update(resolveTaskDomain(row.root).id).digest('hex')}.clawx-write.lock`;
      const save = registry.saveWorktreeRegistryScope;
      const spy = vi.spyOn(registry, 'saveWorktreeRegistryScope').mockImplementation(scope => {
        if (scope.records.get(row.id)?.status === 'cleaning' && !existsSync(start)) {
          writeFileSync(start, 'start');
          const pause = new Int32Array(new SharedArrayBuffer(4)), deadline = Date.now() + 15000;
          while (readdirSync(lock).filter(name => name.endsWith('.json')).length < 2) {
            if (Date.now() > deadline) throw new Error(`No barrier contention: ${run.output()}`);
            Atomics.wait(pause, 0, 0, 5);
          }
        }
        return save(scope);
      });
      let cleanupMs = -1;
      try {
        const cleanupStarted = Date.now();
        service.cleanup(row.id);
        cleanupMs = Date.now() - cleanupStarted;
      } finally {
        spy.mockRestore();
      }
      expect(await run.exited, run.output()).toBe(0);
      const proof = JSON.parse(readFileSync(result, 'utf8'));
      expect(proof).toMatchObject({ success: false, operation: mode, operationStarted: true });
      expect(cleanupMs).toBeLessThan(20000);
      if (mode === 'first-open') expect(['open', 'create']).toContain(proof.stage);
      else expect(proof.stage).toBe(mode);
      if (proof.code === 'LOCK_TIMEOUT') {
        expect(proof.retryable).toBe(true);
        expect(proof.rejected.toLowerCase()).toContain(lock.toLowerCase());
      } else {
        expect(proof.code).toBe('ENOENT');
        expect(proof.retryable).toBe(false);
        expect(proof.rejected.toLowerCase()).toContain(row.root.toLowerCase());
      }
      expect(existsSync(row.root)).toBe(false);
      if (mode === 'first-open') expect(existsSync(resolveTaskDomain(repository).database)).toBe(false);
      if (mode === 'register') expect(resolveExecutionDomain(repository).state).toBe('independent');
      if (credential) expect(storeAt(repository).history(credential.taskNodeId).filter(event => event.kind === 'checkpoint')).toEqual([]);
    } finally {
      if (run.worker.exitCode === null && run.worker.signalCode === null) run.worker.kill('SIGKILL');
      await run.exited.catch(() => undefined);
    }
  }, 45000);
});
