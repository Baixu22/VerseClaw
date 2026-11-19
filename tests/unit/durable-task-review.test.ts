// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { createPersistentTaskTool } from '../../openclaw_runtime/src/agents/tools/persistent-task-tool';

const spawn = vi.hoisted(() => vi.fn(async () => ({ status: 'accepted', result: {
  status: 'accepted', runId: 'review-run', childSessionKey: 'review-child',
} })));
vi.mock('../../openclaw_runtime/src/agents/role-spawn', () => ({ spawnRoleSubagent: spawn }));
vi.mock('../../openclaw_runtime/src/agents/subagent-spawn', () => ({ spawnSubagentDirect: vi.fn() }));
vi.mock('../../openclaw_runtime/src/config/config', () => ({ getRuntimeConfig: () => ({}) }));
vi.mock('../../openclaw_runtime/src/agents/orchestration-workspace-context', () => ({
  resolveOrchestrationContext: (params: { workspaceDir: string }) => ({ workspaceDir: params.workspaceDir }),
}));
let root: string, store: TaskSystemStore;
beforeEach(() => {
  spawn.mockClear();
  root = mkdtempSync(join(tmpdir(), 'project-review-'));
  writeFileSync(join(root, 'result.txt'), 'review this');
  store = new TaskSystemStore(resolveTaskDomain(root));
  const task = store.start({ contract: { objective: 'Review the delivered file', target: 'result.txt', constraints: [], maxRepairAttempts: 1,
    acceptance: [{ id: 'review', description: 'Read independent review', verification: {
      kind: 'owner-receipt', owner: 'subagent-verifier', files: ['result.txt'],
    } }] } }, 'parent', 'generation', 'task');
  store.submit(task.claim!, 'candidate');
});
afterEach(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
it('dispatches a read-only role using the submitted files and replays one durable receipt', async () => {
  const tool = createPersistentTaskTool({ workspace: root, sessionKey: 'parent', generation: 'generation',
    inheritedToolAllowlist: ['read', 'sessions_spawn'], inheritedToolDenylist: ['exec'] });
  const request = { action: 'review', candidate: 'candidate', requestId: 'review-request' };
  expect((await tool.execute('first', request)).details).toMatchObject({ status: 'accepted', runId: 'review-run' });
  expect((await tool.execute('retry', request)).details).toMatchObject({ replayed: true, runId: 'review-run' });
  const current = store.binding('parent', 'generation')!.claim!;
  store.control(current, 'renew');
  const rebuilt = createPersistentTaskTool({ workspace: root, sessionKey: 'parent', generation: 'generation',
    inheritedToolAllowlist: ['read', 'sessions_spawn'], inheritedToolDenylist: ['exec'] });
  expect((await rebuilt.execute('after-rebuild', request)).details).toMatchObject({ replayed: true, runId: 'review-run' });
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn.mock.calls[0]).toEqual([
    expect.objectContaining({ role: 'reviewer', writeSet: [], task: expect.stringContaining('candidate'),
      orchestration: expect.objectContaining({ isVerifier: true, verifierNoSelfRepair: true }) }),
    expect.objectContaining({ inheritedToolAllowlist: ['read'], inheritedToolDenylist: ['exec'], workspaceDir: root }),
    expect.anything(),
  ]);
});
it.each([[], ['read'], ['sessions_spawn'], ['sessions_spawn', 'glob'], ['sessions_spawn', 'grep']])('rejects a parent without both read and delegation authority: %j', async (...tools) => {
  const tool = createPersistentTaskTool({ workspace: root, sessionKey: 'parent', generation: 'generation', inheritedToolAllowlist: tools });
  await expect(tool.execute('review', { action: 'review', candidate: 'candidate', requestId: 'request' })).rejects.toThrow(/TASK_REVIEW_(DELEGATION_NOT_ALLOWED|READ_PERMISSION_REQUIRED)/);
  expect(spawn).not.toHaveBeenCalled();
});
it('honors an explicit delegation denylist before reserving or spawning', async () => {
  const tool = createPersistentTaskTool({ workspace: root, sessionKey: 'parent', generation: 'generation',
    inheritedToolDenylist: ['sessions_spawn', 'team_orchestrate'] });
  await expect(tool.execute('review', { action: 'review', candidate: 'candidate', requestId: 'request' })).rejects.toThrow('TASK_REVIEW_DELEGATION_NOT_ALLOWED');
  expect(spawn).not.toHaveBeenCalled();
});
