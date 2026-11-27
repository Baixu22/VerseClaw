// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { openExecutionStateDatabase } from '../../openclaw_runtime/src/state/execution-state-db';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';

const mocks = vi.hoisted(() => ({ entries: {} as Record<string, { sessionId: string; workspaceId: string; workspaceDir: string }> }));
vi.mock('../../openclaw_runtime/src/gateway/session-utils.js', () => ({
  loadSessionEntry: (key: string) => ({ canonicalKey: key, entry: mocks.entries[key] }),
}));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/session-collaboration-query.js', () => ({
  readSessionCollaborationQuery: async () => ({ state: 'ready' }),
}));
import { readSessionCollaborationTaskContext } from '../../openclaw_runtime/src/gateway/server-methods/session-collaboration-context';

it('keeps current evidence visible after unrelated task activity exceeds the history page', () => {
  const root = mkdtempSync(join(tmpdir(), 'collaboration-context-evidence-'));
  const store = new TaskSystemStore(resolveTaskDomain(root));
  try {
    const path = join(root, 'result.txt'), content = 'Original task evidence';
    writeFileSync(path, content);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const task = store.create({ objective: 'Keep evidence visible', target: 'result.txt', constraints: [], acceptance: [
      { id: 'result', description: 'Original result', verification: { kind: 'file-sha256', path, sha256 } },
    ] }, 'create').task;
    const claim = store.claim(task.contract.taskNodeId, 'agent:main:writer', 'generation', 'claim').claim!;
    const receipt = store.verifyFile(claim, 'result', path, sha256, 'candidate');
    for (let index = 0; index < 50; index++) store.checkpoint(claim, { nextAction: `step-${index}`, completed: [], unresolved: [], artifacts: [] });
    const before = store.history(task.contract.taskNodeId);
    expect(store.sessionContextSnapshot(claim.sessionKey, claim.generation).evidence).toEqual([receipt]);
    expect(store.history(task.contract.taskNodeId)).toEqual(before);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

it.each(['requester', 'target', 'visibility'] as const)('rejects a %s change while reading the original task owner', async role => {
  const root = mkdtempSync(join(tmpdir(), 'collaboration-context-read-'));
  vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', join(root, 'execution.sqlite'));
  const requester = { workspaceId: 'workspace', projectId: 'workspace', sessionKey: 'agent:main:reader', sessionGeneration: 'reader-generation' };
  const target = { ...requester, sessionKey: 'agent:main:writer', sessionGeneration: 'writer-generation' };
  const query = parseSessionCollaborationQuery({ requester, target, limit: 1 });
  mocks.entries = Object.fromEntries([requester, target].map(scope => [scope.sessionKey,
    { workspaceId: scope.workspaceId, workspaceDir: root, sessionId: scope.sessionGeneration }]));
  const store = new TaskSystemStore(resolveTaskDomain(root));
  let visibilityMode = 'all';
  const context = { getRuntimeConfig: () => ({ tools: { sessions: { visibility: visibilityMode } } }) } as never;
  try {
    openExecutionStateDatabase();
    const task = store.create({ objective: 'Original task', target: 'result.txt', constraints: [], acceptance: [
      { id: 'receipt', description: 'Original receipt', verification: { kind: 'owner-receipt', owner: 'fixture' } },
    ] }, 'create').task;
    store.claim(task.contract.taskNodeId, target.sessionKey, target.sessionGeneration, 'claim');
    const before = store.history(task.contract.taskNodeId);
    await expect(readSessionCollaborationTaskContext(query, context)).resolves.toMatchObject({ state: 'ready', task: {
      contract: { taskNodeId: task.contract.taskNodeId },
    } });
    const original = TaskSystemStore.prototype.context;
    vi.spyOn(TaskSystemStore.prototype, 'context').mockImplementationOnce(function (this: TaskSystemStore, ...args) {
      const result = original.apply(this, args);
      if (role === 'visibility') visibilityMode = 'self';
      else mocks.entries[query[role]!.sessionKey].sessionId = 'new-generation';
      return result;
    });
    await expect(readSessionCollaborationTaskContext(query, context)).resolves.toMatchObject({
      state: role === 'visibility' ? 'unavailable' : 'stale', reason: role === 'visibility' ? 'not-visible' : 'generation-changed', task: null, context: null, evidence: [],
    });
    expect(store.history(task.contract.taskNodeId)).toEqual(before);
  } finally {
    vi.restoreAllMocks();
    store.close();
    closeOpenClawStateDatabase();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

it('reads task, context and evidence from one snapshot when another connection changes the task binding', async () => {
  const root = mkdtempSync(join(tmpdir(), 'collaboration-context-snapshot-'));
  vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', join(root, 'execution.sqlite'));
  const scope = { workspaceId: 'workspace', projectId: 'workspace', sessionKey: 'agent:main:writer', sessionGeneration: 'generation' };
  const query = parseSessionCollaborationQuery({ requester: scope, target: scope, limit: 1 });
  mocks.entries = { [scope.sessionKey]: { workspaceId: scope.workspaceId, workspaceDir: root, sessionId: scope.sessionGeneration } };
  const store = new TaskSystemStore(resolveTaskDomain(root));
  try {
    openExecutionStateDatabase();
    const create = (objective: string) => store.create({ objective, target: 'result.txt', constraints: [], acceptance: [
      { id: 'receipt', description: 'Original receipt', verification: { kind: 'owner-receipt', owner: 'fixture' } },
    ] }, objective).task;
    const first = create('Original task snapshot'), second = create('New task snapshot');
    const claim = store.claim(first.contract.taskNodeId, scope.sessionKey, scope.sessionGeneration, 'first-claim').claim!;
    const original = TaskSystemStore.prototype.context;
    vi.spyOn(TaskSystemStore.prototype, 'context').mockImplementationOnce(function (this: TaskSystemStore, ...args) {
      store.control(claim, 'release');
      store.claim(second.contract.taskNodeId, scope.sessionKey, scope.sessionGeneration, 'second-claim');
      return original.apply(this, args);
    });
    const result = await readSessionCollaborationTaskContext(query, { getRuntimeConfig: () => ({ tools: { sessions: { visibility: 'all' } } }) } as never);
    expect(result.state).toBe('ready');
    expect(result.task?.contract.taskNodeId).toBe(first.contract.taskNodeId);
    expect(result.context).toContain('Original task snapshot');
    expect(result.context).not.toContain('New task snapshot');
    expect(store.sessionSnapshot(scope.sessionKey, scope.sessionGeneration).task?.contract.taskNodeId).toBe(second.contract.taskNodeId);
  } finally {
    vi.restoreAllMocks();
    store.close();
    closeOpenClawStateDatabase();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
