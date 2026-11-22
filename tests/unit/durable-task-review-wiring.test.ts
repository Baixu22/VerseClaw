import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { createOpenClawCodingTools } from '../../openclaw_runtime/src/agents/agent-tools';

const { createOpenClawTools, spawnRoleSubagent } = vi.hoisted(() => ({
  createOpenClawTools: vi.fn(() => [
    { name: 'sessions_spawn', execute: vi.fn() },
    { name: 'team_orchestrate', execute: vi.fn() },
  ]),
  spawnRoleSubagent: vi.fn(async () => ({ status: 'accepted', result: {
    status: 'accepted', runId: 'review-run', childSessionKey: 'review-child',
  } })),
}));

vi.mock('../../openclaw_runtime/src/agents/openclaw-tools.js', () => ({ createOpenClawTools }));
vi.mock('../../openclaw_runtime/src/agents/role-spawn.js', () => ({ spawnRoleSubagent }));
vi.mock('../../openclaw_runtime/src/agents/subagent-spawn.js', () => ({ spawnSubagentDirect: vi.fn() }));
vi.mock('../../openclaw_runtime/src/config/config.js', () => ({ getRuntimeConfig: () => ({}) }));
vi.mock('../../openclaw_runtime/src/agents/orchestration-workspace-context.js', () => ({
  resolveOrchestrationContext: (params: { workspaceDir: string }) => ({ workspaceDir: params.workspaceDir }),
}));

let root: string;

beforeEach(() => {
  spawnRoleSubagent.mockClear();
  createOpenClawTools.mockClear();
  root = mkdtempSync(join(tmpdir(), 'task-review-wiring-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function seedSubmittedTask() {
  writeFileSync(join(root, 'result.txt'), 'review this');
  const store = new TaskSystemStore(resolveTaskDomain(root));
  try {
    const task = store.start({ contract: {
      objective: 'Review the delivered file',
      target: 'result.txt',
      constraints: [],
      maxRepairAttempts: 1,
      acceptance: [{ id: 'review', description: 'Independent review', verification: {
        kind: 'owner-receipt', owner: 'subagent-verifier', files: ['result.txt'],
      } }],
    } }, 'parent', 'generation', 'task');
    store.submit(task.claim!, 'candidate');
  } finally {
    store.close();
  }
}

function buildTools(config: { tools: { allow?: string[]; deny?: string[] } }) {
  return createOpenClawCodingTools({
    cwd: root,
    workspaceDir: root,
    sessionKey: 'parent',
    sessionId: 'generation',
    config: config as never,
    toolConstructionPlan: {
      includeBaseCodingTools: true,
      includeShellTools: false,
      includeChannelTools: false,
      includeOpenClawTools: true,
      includePluginTools: false,
    },
  });
}

function taskControl(config: { tools: { allow?: string[]; deny?: string[] } }) {
  seedSubmittedTask();
  const tool = buildTools(config).find(({ name }) => name === 'task_control');
  if (!tool) throw new Error('task_control tool missing');
  return tool;
}

it('denies review dispatch when deny-only policy removes both delegation tools', async () => {
  const control = taskControl({ tools: { deny: ['sessions_spawn', 'team_orchestrate'] } });

  await expect(control.execute('review', {
    action: 'review', candidate: 'candidate', requestId: 'denied-review',
  })).rejects.toThrow('TASK_REVIEW_DELEGATION_NOT_ALLOWED');
  expect(spawnRoleSubagent).not.toHaveBeenCalled();
});

it('dispatches review through the existing spawn path with the final read-only allowlist', async () => {
  const control = taskControl({ tools: {
    allow: ['task_control', 'read', 'sessions_spawn', 'team_orchestrate'],
  } });

  await expect(control.execute('review', {
    action: 'review', candidate: 'candidate', requestId: 'allowed-review',
  })).resolves.toMatchObject({ details: { status: 'accepted', runId: 'review-run' } });
  expect(spawnRoleSubagent).toHaveBeenCalledWith(
    expect.objectContaining({
      role: 'reviewer',
      task: expect.stringContaining('candidate'),
      writeSet: [],
      orchestration: expect.objectContaining({ isVerifier: true, verifierNoSelfRepair: true }),
    }),
    expect.objectContaining({
      inheritedToolAllowlist: ['read'],
      workspaceDir: root,
    }),
    expect.anything(),
  );
});
