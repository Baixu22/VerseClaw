import { existsSync, writeFileSync } from 'node:fs';
import { createExecutionTaskAccess, openExecutionTaskStore } from '../../../openclaw_runtime/src/agents/execution-task-authority.js';
import { registerExecutionDomain } from '../../../openclaw_runtime/src/agents/execution-domain.js';
import { createWorktreeService } from '../../../openclaw_runtime/src/agents/worktree-service.js';
import { TaskSystemStore } from '../../../shared/task-system/store.js';
import { closeOpenClawStateDatabaseForTest } from '../../../openclaw_runtime/src/state/openclaw-state-db.js';

const input = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
if (input.mode === 'cleanup-crash') {
  const original = TaskSystemStore.prototype.withWorktreeCleanup;
  TaskSystemStore.prototype.withWorktreeCleanup = function<T>(worktree: string, effect: () => T): T {
    return (original as (this: TaskSystemStore, root: string, effect: () => T) => T).call(this, worktree, () => {
      effect();
      process.exit(23); // Native removal happened; the Task cleanup transaction has not committed.
    });
  };
  createWorktreeService(input.repository, { backend: 'git' }).cleanup(input.id);
  throw new Error('Crash boundary not reached');
}
let store: TaskSystemStore | undefined;
const access = createExecutionTaskAccess(input.workspace);
if (input.mode === 'checkpoint' || input.mode === 'claim') store = openExecutionTaskStore(input.workspace);
writeFileSync(input.ready, JSON.stringify({ pid: process.pid, basis: access.basis }));
const pause = new Int32Array(new SharedArrayBuffer(4)), deadline = Date.now() + 30000;
while (!existsSync(input.start)) {
  if (Date.now() > deadline) throw new Error('Parent did not release fixture');
  Atomics.wait(pause, 0, 0, 10);
}
try {
  if (input.mode === 'first-open') {
    store = new TaskSystemStore(access.domain, undefined, access);
    const created = store.create(input.contract, 'late-create');
    if (input.claimAfterCreate) store.claim(created.task.contract.taskNodeId, 'late-session', 'late-generation', 'late-claim');
  } else if (input.mode === 'checkpoint') {
    store!.checkpoint(input.credential, { completed: [], nextAction: 'continue', unresolved: [], artifacts: [input.artifact] });
  } else if (input.mode === 'claim') {
    store!.claim(input.taskId, 'late-session', 'late-generation', 'late-claim');
  } else if (input.mode === 'register') {
    registerExecutionDomain({ workspaceRoot: input.workspace, authorityRoot: input.authority, actor: 'agent',
      operationId: 'late-register', expectedRevision: 0, projectRevision: 1 });
  }
  writeFileSync(input.result, JSON.stringify({ pid: process.pid, success: true }));
} catch (error) {
  writeFileSync(input.result, JSON.stringify({ pid: process.pid, rejected: String(error), pathExists: existsSync(input.workspace) }));
} finally {
  store?.close();
  closeOpenClawStateDatabaseForTest();
}
