// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import type { TaskContractInput, TaskView } from '../../shared/task-system/types';
import { createTaskRuntimeGuard, executeTaskGuarded, finishPersistentTaskRun, restoreTaskModelContext } from '../../shared/task-system/runtime';
import { isReadOnlyTaskTool } from '../../shared/task-system/tool-policy';
import { requiresSessionTaskScope } from '../../openclaw_runtime/src/agents/tool-mutation';
import { executeManagedTaskTool } from '../../openclaw_runtime/src/agents/execution-checkout-tools';
import { createPersistentTaskTool } from '../../openclaw_runtime/src/agents/tools/persistent-task-tool';
import { persistentTaskChatContext, readManagedSessionReference, restoreManagedSessionTask, taskSystemCommand } from '../../electron/services/task-system-service';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { closeOpenClawAgentDatabasesForTest } from '../../openclaw_runtime/src/state/openclaw-agent-db';

const state = vi.hoisted(() => ({ root: '', generation: 'generation-before' }));
vi.mock('../../electron/services/workspaces-api', () => ({
  getWorkspaceRootPathById: async () => state.root,
  getProjectCoordinatorProfiles: async () => [],
  getPersistedCoordinatorBinding: async () => ({ state: 'active', sessionGeneration: state.generation,
    environment: { canonicalRoot: state.root } }),
}));
vi.mock('../../electron/utils/paths', () => ({ getOpenClawConfigDir: () => state.root }));
vi.mock('../../electron/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const sessionKey = 'agent:main:writer';
const generation = 'generation-before';
const activeRuns: Array<{ sessionKey: string; runId: string }> = [];
let store: TaskSystemStore;

function contract(objective = 'Preserve the scoped execution'): TaskContractInput {
  return { objective, target: '.', constraints: ['Preserve other sessions'],
    acceptance: [{ id: 'owner', description: 'Read the owner receipt', verification: { kind: 'owner-receipt', owner: 'agent-fixture' } }] };
}
function start(objective?: string) {
  return store.start({ contract: contract(objective) }, sessionKey, generation, `start:${objective ?? 'default'}`);
}
function guardFor(task: TaskView, runId: string) {
  activeRuns.push({ sessionKey: task.claim!.sessionKey, runId });
  return createTaskRuntimeGuard(state.root, task.claim!.sessionKey, task.claim!.generation, runId);
}
function gateway(stop: { ok: boolean; sessionId: string } = { ok: true, sessionId: generation }) {
  return { rpc: vi.fn(async (method: string) => {
    if (method === 'sessions.describe') return { session: { sessionId: state.generation } };
    if (method === 'sessions.stop') return stop;
    throw new Error(`Unexpected RPC: ${method}`);
  }) };
}

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'session-task-fixes-'));
  state.generation = generation;
  vi.stubEnv('OPENCLAW_STATE_DIR', join(state.root, 'runtime-state'));
  vi.stubEnv('CLAWX_WORKSPACE_OWNER_PATH', '');
  vi.stubEnv('CLAWX_TASK_SCOPE_BRIDGE', '0');
  store = new TaskSystemStore(resolveTaskDomain(state.root));
});
afterEach(() => {
  for (const run of activeRuns.splice(0)) finishPersistentTaskRun(state.root, run.sessionKey, run.runId);
  store.close();
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  rmSync(state.root, { recursive: true, force: true });
});

describe('task cancellation waits for the run owner', () => {
  it('stops an active model with no tool operation before releasing its claim', async () => {
    const task = start();
    restoreTaskModelContext(guardFor(task, 'model-run'), 'Original prompt');
    const runtime = gateway();
    const result = await taskSystemCommand('workspace', { action: 'cancel', credential: task.claim! }, runtime as never) as TaskView;
    expect(runtime.rpc.mock.calls.filter(([method]) => method === 'sessions.stop')).toHaveLength(1);
    expect(runtime.rpc).toHaveBeenCalledWith('sessions.stop', { key: sessionKey, expectedSessionId: generation }, 20_000);
    expect(result.contract.state).toBe('cancelled');
    expect(result.claim?.state).toBe('released');
    expect(store.activeTaskRun(task.contract.taskNodeId)).toBeNull();
  });
  it.each([{ ok: false, sessionId: generation }, { ok: true, sessionId: 'different-generation' }])('retains cancellation when stop is unconfirmed: %j', async (stop) => {
    const task = start();
    restoreTaskModelContext(guardFor(task, 'model-run'), 'Original prompt');
    await expect(taskSystemCommand('workspace', { action: 'cancel', credential: task.claim! }, gateway(stop) as never)).rejects.toThrow('TASK_CANCEL_STOP_UNCONFIRMED');
    expect(store.get(task.contract.taskNodeId)).toMatchObject({ contract: { state: 'cancelling' }, claim: { state: 'active', epoch: task.claim!.epoch } });
    expect(store.activeTaskRun(task.contract.taskNodeId)?.runId).toBe('model-run');
    finishPersistentTaskRun(state.root, sessionKey, 'model-run');
    expect(store.get(task.contract.taskNodeId).contract.state).toBe('cancelled');
  });
  it('also tracks a model reading a paused task', async () => {
    const task = start();
    const paused = store.control(task.claim!, 'pause');
    restoreTaskModelContext(guardFor(paused, 'paused-reader'), 'Read the paused task');
    const runtime = gateway();
    await taskSystemCommand('workspace', { action: 'cancel', credential: paused.claim! }, runtime as never);
    expect(runtime.rpc).toHaveBeenCalledWith('sessions.stop', { key: sessionKey, expectedSessionId: generation }, 20_000);
    expect(store.get(task.contract.taskNodeId).contract.state).toBe('cancelled');
  });
  it('keeps a decomposing coordinator pending until its exact model run ends', async () => {
    const task = start();
    restoreTaskModelContext(guardFor(task, 'planner-run'), 'Plan the task');
    store.decompose(task.claim!, [{ key: 'leaf', contract: contract('Implement the leaf') }], 'plan');
    const coordinator = store.get(task.contract.taskNodeId).claim!;
    const runtime = { rpc: vi.fn(async (method: string) => {
      if (method === 'sessions.describe') return { session: { sessionId: generation } };
      if (method === 'taskScope.runState') return { active: true, currentGeneration: generation };
      if (method === 'chat.abort') return { aborted: true, runIds: ['planner-run'] };
      throw new Error(`Unexpected RPC: ${method}`);
    }) };
    const result = await taskSystemCommand('workspace', { action: 'cancel', credential: coordinator }, runtime as never) as TaskView;
    expect(result.contract.state).toBe('cancelling');
    expect(runtime.rpc).toHaveBeenCalledWith('chat.abort', { sessionKey, runId: 'planner-run' }, 20_000);
    expect(runtime.rpc.mock.calls.some(([method]) => method === 'sessions.stop')).toBe(false);
    finishPersistentTaskRun(state.root, sessionKey, 'planner-run');
    expect(store.get(task.contract.taskNodeId).contract.state).toBe('cancelled');
  });
  it('does not stop a newer unrelated task when a completed planner is cancelled', async () => {
    const first = start('Original plan');
    restoreTaskModelContext(guardFor(first, 'old-planner'), 'Plan');
    store.decompose(first.claim!, [{ key: 'leaf', contract: contract('Original leaf') }], 'plan');
    finishPersistentTaskRun(state.root, sessionKey, 'old-planner');
    const second = start('Unrelated task');
    restoreTaskModelContext(guardFor(second, 'new-model'), 'Continue the other task');
    const runtime = gateway();
    await taskSystemCommand('workspace', { action: 'cancel', credential: store.get(first.contract.taskNodeId).claim! }, runtime as never);
    expect(runtime.rpc.mock.calls.some(([method]) => ['sessions.stop', 'chat.abort'].includes(method))).toBe(false);
    expect(store.get(second.contract.taskNodeId).contract.state).toBe('doing');
    expect(store.activeTaskRun(second.contract.taskNodeId)?.runId).toBe('new-model');
  });
});

describe('restored session identity remains fenced', () => {
  it('migrates a writer and a different retained reference in the same transaction', () => {
    const referenced = store.create(contract('Retained reference'), 'reference').task;
    store.selectReference(referenced.contract.taskNodeId, sessionKey, generation, 'select-reference');
    const writer = start('Separate writer');
    const input = { workspaceRoot: state.root, sessionKey, previousGeneration: generation, generation: 'restored' };
    const restored = restoreManagedSessionTask(input)!;
    expect(readManagedSessionReference(state.root, sessionKey, 'restored', referenced.contract.taskNodeId)?.referenceOnly).toBe(true);
    store.db.prepare('UPDATE task_references SET generation=? WHERE session_key=?').run(generation, sessionKey);
    expect(restoreManagedSessionTask(input)?.claim).toEqual(restored.claim);
    store.control(restored.claim!, 'release');
    expect(store.binding(sessionKey, 'restored')?.contract.taskNodeId).toBe(referenced.contract.taskNodeId);
    expect(store.get(writer.contract.taskNodeId).claim?.state).toBe('released');
  });
  it('keeps parent and child identities unchanged while a delegation is unresolved', () => {
    const task = start();
    store.beginOperation(task.claim!, 'spawn', 'sessions_spawn');
    const delegation = store.prepareWriterDelegation(task.claim!, { delegationId: 'delegation', childSessionKey: 'agent:main:child',
      childGeneration: 'child-generation', childWorktree: state.root, childRunId: 'child-run', mode: 'writer' });
    expect(() => store.restoreSessionScope(sessionKey, generation, 'parent-restored')).toThrow('TASK_DELEGATION_RECOVERY_REQUIRED');
    expect(() => store.restoreSessionScope('agent:main:child', 'child-generation', 'child-restored')).toThrow('TASK_DELEGATION_RECOVERY_REQUIRED');
    expect(store.delegationForChild('agent:main:child')).toEqual(delegation);
    store.returnDelegatedWriter('agent:main:child', { runId: 'child-run', endedAt: Date.now(), outcome: 'completed', parentGeneration: generation });
    store.finishOperation(task.claim!, 'spawn', 'completed', 'Confirmed dispatch');
    expect(store.restoreSessionScope(sessionKey, generation, 'parent-restored')?.claim?.generation).toBe('parent-restored');
  });
  it('migrates the writer once and allows chat preflight for the restored generation', async () => {
    const task = start();
    const oldGuard = guardFor(task, 'old-run');
    restoreTaskModelContext(oldGuard, 'Original prompt');
    finishPersistentTaskRun(state.root, sessionKey, 'old-run');
    const restore = { workspaceRoot: state.root, sessionKey, previousGeneration: generation, generation: 'generation-restored' };
    const restored = restoreManagedSessionTask(restore)!;
    expect(restored.claim).toMatchObject({ generation: restore.generation, epoch: task.claim!.epoch + 1 });
    expect(restoreManagedSessionTask(restore)?.claim).toEqual(restored.claim);
    expect(() => store.binding(sessionKey, generation)).toThrow('TASK_GENERATION_STALE');
    await expect(executeTaskGuarded(oldGuard, 'stale-write', 'write', async () => { throw new Error('The old writer executed'); })).rejects.toThrow('TASK_GENERATION_STALE');
    state.generation = restore.generation;
    await expect(persistentTaskChatContext('workspace', sessionKey, gateway() as never, state.root)).resolves.toContain(task.contract.objective);
    expect(store.history(task.contract.taskNodeId).filter(event => event.kind === 'session_restored')).toHaveLength(1);
  });
  it('migrates an observer reference while preserving its original writer', async () => {
    const task = start();
    store.inheritReference(sessionKey, generation, 'agent:main:reader', 'reader-before');
    const restored = restoreManagedSessionTask({ workspaceRoot: state.root, sessionKey: 'agent:main:reader', previousGeneration: 'reader-before', generation: 'reader-after' })!;
    expect(restored.referenceOnly).toBe(true);
    expect(store.get(task.contract.taskNodeId).claim).toEqual(task.claim);
    expect(() => store.binding('agent:main:reader', 'reader-before')).toThrow('TASK_GENERATION_STALE');
    const reader = createTaskRuntimeGuard(state.root, 'agent:main:reader', 'reader-after', 'reader-run');
    await expect(executeTaskGuarded(reader, 'history', 'sessions_history', async () => 'original history')).resolves.toBe('original history');
  });
  it('refuses restoration while an operation or live run remains', () => {
    const task = start();
    const input = { workspaceRoot: state.root, sessionKey, previousGeneration: generation, generation: 'restored' };
    store.beginOperation(task.claim!, 'unfinished', 'write');
    const originalClaim = store.binding(sessionKey, generation)?.claim;
    expect(() => restoreManagedSessionTask(input)).toThrow('TASK_OPERATIONS_PENDING');
    expect(store.binding(sessionKey, generation)?.claim).toEqual(originalClaim);
    store.finishOperation(task.claim!, 'unfinished', 'completed', 'The owner finished');
    restoreTaskModelContext(guardFor(task, 'live-run'), 'Keep running');
    expect(() => restoreManagedSessionTask(input)).toThrow('TASK_OPERATIONS_PENDING');
    expect(store.binding(sessionKey, generation)?.claim?.generation).toBe(generation);
  });
  it('preserves an explicit pause across restoration', () => {
    const task = start();
    const paused = store.control(task.claim!, 'pause');
    const restored = restoreManagedSessionTask({ workspaceRoot: state.root, sessionKey, previousGeneration: generation, generation: 'restored' })!;
    expect(restored.contract.state).toBe('paused');
    expect(restored.claim).toMatchObject({ state: 'paused', epoch: paused.claim!.epoch + 1, generation: 'restored' });
  });
});

describe('agent resume uses the paused epoch of its new run', () => {
  it('continues model calls and an actual file write after resume', async () => {
    const task = start();
    const paused = store.control(task.claim!, 'pause');
    const guard = guardFor(paused, 'resume-run');
    restoreTaskModelContext(guard, 'Read the paused task');
    const tool = createPersistentTaskTool({ workspace: state.root, sessionKey, generation, runId: 'resume-run' });
    const resumed = (await tool.execute('resume', { action: 'resume' })).details as TaskView;
    expect(resumed.claim?.epoch).toBe(paused.claim!.epoch);
    expect(() => restoreTaskModelContext(guard, 'Continue')).not.toThrow();
    await executeTaskGuarded(guard, 'write', 'write', async () => { writeFileSync(join(state.root, 'result.txt'), 'resumed'); return { ok: true }; });
    expect(readFileSync(join(state.root, 'result.txt'), 'utf8')).toBe('resumed');
    await expect(executeTaskGuarded(createTaskRuntimeGuard(state.root, sessionKey, generation, 'old-run'), 'other-run', 'write', async () => 1)).rejects.toThrow('TASK_RUN_ALREADY_ACTIVE');
  });
  it('does not reactivate the run invalidated by pause', async () => {
    const task = start();
    const oldGuard = guardFor(task, 'old-run');
    restoreTaskModelContext(oldGuard, 'Before pause');
    const paused = store.control(task.claim!, 'pause');
    const tool = createPersistentTaskTool({ workspace: state.root, sessionKey, generation, runId: 'old-run' });
    await expect(tool.execute('resume', { action: 'resume' })).rejects.toThrow('TASK_OPERATIONS_PENDING');
    expect(store.get(task.contract.taskNodeId).claim?.epoch).toBe(paused.claim!.epoch);
    await expect(executeTaskGuarded(oldGuard, 'old-write', 'write', async () => 1)).rejects.toThrow('TASK_STALE_OWNER');
  });
});

describe('all tool boundaries use the same read-only policy', () => {
  it.each([
    ['memory_search', { query: 'prior decisions' }], ['memory_get', { path: 'memory.md' }],
    ['sessions_list', {}], ['sessions_history', { sessionKey }], ['get_goal', {}],
    ['read_file', { path: 'result.txt' }], ['grep', { pattern: 'task' }], ['glob', { pattern: '*.ts' }],
    ['exec', { command: 'git status' }], ['exec', { command: 'rg --files' }], ['process', { action: 'list' }],
    ['exec', { command: 'git log --no-textconv --no-ext-diff -c' }],
    ['exec', { command: 'git diff --no-textconv --no-ext-diff -C' }],
    ['exec', { command: 'git show --no-textconv --no-ext-diff -c' }],
    ['subagents', { action: 'info' }],
  ])('permits %s for an observer without claiming execution', async (toolName, params) => {
    const task = start();
    store.inheritReference(sessionKey, generation, 'agent:main:reader', 'reader-generation');
    const guard = createTaskRuntimeGuard(state.root, 'agent:main:reader', 'reader-generation', 'read-run');
    const execute = vi.fn(async () => 'read result');
    vi.stubEnv('CLAWX_TASK_SCOPE_BRIDGE', '1');
    expect(isReadOnlyTaskTool(toolName as string, params)).toBe(true);
    expect(requiresSessionTaskScope(toolName as string, params)).toBe(false);
    await expect(executeManagedTaskTool({ sessionKey: 'agent:main:reader', sessionId: 'reader-generation', runId: 'read-run', workspaceDir: state.root },
      guard, 'query', toolName as string, params, undefined, execute)).resolves.toBe('read result');
    expect(store.get(task.contract.taskNodeId).claim).toEqual(task.claim);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each(['git -c core.pager=bad status', 'git -ccore.pager=bad status', 'git -C/tmp status',
    'rg --pre=bad query', 'rg --pre bad query', 'rg --hostname-bin=bad query', 'rg --hostname-bin bad query',
    'git diff', 'git log -p', 'git show HEAD', 'git diff --textconv', 'git grep --textconv query',
    'git diff --no-textconv --no-ext-diff --textconv', 'git diff --no-textconv --no-ext-diff --ext-diff',
    'git diff -- --no-textconv --no-ext-diff', 'git -p diff --no-textconv --no-ext-diff',
    'git diff --word-diff-regex --no-textconv --no-ext-diff',
    'git --paginate diff --no-textconv --no-ext-diff',
    'echo hello > result.txt', 'git status; touch result.txt'])('still requires admission for shell effects: %s', async (command) => {
    const execute = vi.fn(async () => 1);
    const guard = createTaskRuntimeGuard(state.root, 'agent:main:unbound', 'unbound-generation', 'run');
    expect(requiresSessionTaskScope('exec', { command })).toBe(true);
    await expect(executeTaskGuarded(guard, 'unsafe', 'exec', execute, { command })).rejects.toThrow('TASK_CLAIM_REQUIRED');
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(['rg --hostname-bin=bad query', 'rg --hostname-bin bad query'])('does not execute a hostname helper through an observer: %s', async (command) => {
    const task = start();
    store.inheritReference(sessionKey, generation, 'agent:main:reader', 'reader-generation');
    const guard = createTaskRuntimeGuard(state.root, 'agent:main:reader', 'reader-generation', 'read-run');
    const execute = vi.fn(async () => 'unexpected helper execution');
    vi.stubEnv('CLAWX_TASK_SCOPE_BRIDGE', '1');
    await expect(executeManagedTaskTool({ sessionKey: 'agent:main:reader', sessionId: 'reader-generation', runId: 'read-run', workspaceDir: state.root },
      guard, 'hostname-helper', 'exec', { command }, undefined, execute)).rejects.toThrow('TASK_CLAIM_REQUIRED');
    expect(execute).not.toHaveBeenCalled();
    expect(store.get(task.contract.taskNodeId).claim).toEqual(task.claim);
  });
  it('does not classify unknown tools or model changes as reads', () => {
    expect(isReadOnlyTaskTool('unknown_extension', { action: 'read' })).toBe(false);
    expect(isReadOnlyTaskTool('session_status', { model: 'different/model' })).toBe(false);
  });
  it('reads an actual Git diff without invoking its configured converter', async () => {
    const repository = join(state.root, 'git-reader');
    mkdirSync(repository);
    const invocation = join(repository, 'converter-invoked.txt');
    const converter = join(repository, 'converter.cjs');
    writeFileSync(converter, `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(invocation)}, 'called'); process.stdout.write(fs.readFileSync(process.argv[2]));`);
    const git = (args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', windowsHide: true });
    git(['init', '--quiet']);
    git(['config', 'diff.reader.textconv', `"${process.execPath.replaceAll('\\', '/')}" "${converter.replaceAll('\\', '/')}"`]);
    writeFileSync(join(repository, '.gitattributes'), 'input.txt diff=reader\n');
    writeFileSync(join(repository, 'input.txt'), 'before\n');
    git(['add', '.gitattributes', 'input.txt']);
    writeFileSync(join(repository, 'input.txt'), 'after\n');
    const guard = createTaskRuntimeGuard(state.root, 'agent:main:unbound', 'unbound-generation', 'run');
    const command = 'git diff --no-textconv --no-ext-diff -- input.txt';
    const diff = await executeTaskGuarded(guard, 'safe-diff', 'exec', async () => git(command.split(' ').slice(1)), { command });
    expect(diff).toContain('+after');
    expect(existsSync(invocation)).toBe(false);
    const execute = vi.fn(async () => git(['diff', '--', 'input.txt']));
    await expect(executeTaskGuarded(guard, 'configured-diff', 'exec', execute, { command: 'git diff -- input.txt' })).rejects.toThrow('TASK_CLAIM_REQUIRED');
    expect(execute).not.toHaveBeenCalled();
    expect(existsSync(invocation)).toBe(false);
    git(['diff', '--', 'input.txt']);
    expect(readFileSync(invocation, 'utf8')).toBe('called');
  });
});
