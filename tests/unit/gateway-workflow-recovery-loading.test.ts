// @vitest-environment node
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import {
  commitWorkflowLifecycle,
  readWorkflowLifecycle,
  type WorkflowLifecycleDomain,
} from '../../openclaw_runtime/src/tasks/workflow-lifecycle-owner';
import { recoverGatewayWorkflowLifecycles } from '../../openclaw_runtime/src/gateway/server-runtime-startup-services';

const controllers = [
  ['clawgraph', '../../openclaw_runtime/src/agents/clawgraph/runtime', 'settleOrphanedClawGraphLifecycles'],
  ['mission', '../../openclaw_runtime/src/agents/mission-control/controller', 'recoverInterruptedMissionLifecycles'],
  ['task-loop', '../../openclaw_runtime/src/agents/task-loop-controller', 'settleOrphanedTaskLoopLifecycles'],
] as const;
const modes = [
  'OPENCLAW_CLAWGRAPH_LIFECYCLE_WRITER',
  'OPENCLAW_MISSION_LIFECYCLE_WRITER',
  'OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER',
];
let root: string;
let loaded: string[];
let called: string[];
let failed: WorkflowLifecycleDomain | undefined;
const log = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  closeOpenClawStateDatabase();
  root = fs.mkdtempSync(path.join(tmpdir(), 'g3-workflow-recovery-'));
  vi.stubEnv('OPENCLAW_STATE_DIR', root);
  for (const key of modes) vi.stubEnv(key, 'taskflow');
  for (const key of ['RC06B_CLAWGRAPH_PROJECTION', 'RC06C_MISSION_PROJECTION', 'RC06D_TASK_LOOP_PROJECTION']) {
    vi.stubEnv(key, '0');
  }
  loaded = [];
  called = [];
  failed = undefined;
  log.info.mockReset();
  log.warn.mockReset();
  for (const [domain, module, entry] of controllers) {
    vi.doMock(module, () => {
      loaded.push(domain);
      return { [entry]: () => {
        called.push(domain);
        if (failed === domain) throw new Error('recovery failed');
        return [domain + '-run'];
      } };
    });
  }
});

afterEach(() => {
  closeOpenClawStateDatabase();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const [, module] of controllers) vi.doUnmock(module);
  fs.rmSync(root, { recursive: true, force: true });
});

function persist(domain: WorkflowLifecycleDomain, status: 'running' | 'waiting' | 'blocked' = 'running') {
  expect(commitWorkflowLifecycle({ domain, id: domain + '-run', status }).ok).toBe(true);
}

it('keeps legacy recovery free of controller imports and database creation', async () => {
  for (const key of modes) vi.stubEnv(key, 'legacy');
  await recoverGatewayWorkflowLifecycles(log);
  expect(loaded).toEqual([]);
  expect(called).toEqual([]);
  expect(log.warn).not.toHaveBeenCalled();
  expect(fs.readdirSync(root)).toEqual([]);
});

it('keeps empty and terminal-only lifecycle stores free of controller imports', async () => {
  await recoverGatewayWorkflowLifecycles(log);
  for (const [domain] of controllers) {
    persist(domain);
    expect(commitWorkflowLifecycle({ domain, id: domain + '-run', status: 'succeeded' }).ok).toBe(true);
  }
  await recoverGatewayWorkflowLifecycles(log);
  expect(loaded).toEqual([]);
  expect(called).toEqual([]);
  expect(log.warn).not.toHaveBeenCalled();
});

it.each(controllers.map(([domain]) => domain))('loads only the %s owner with pending work', async domain => {
  persist(domain);
  const before = readWorkflowLifecycle(domain, domain + '-run');
  await recoverGatewayWorkflowLifecycles(log);
  expect(loaded).toEqual([domain]);
  expect(called).toEqual([domain]);
  expect(log.info).toHaveBeenCalledTimes(1);
  expect(log.warn).not.toHaveBeenCalled();
  expect(readWorkflowLifecycle(domain, domain + '-run')).toEqual(before);
});

it('retains projection recovery for ClawGraph and Task Loop while Mission stays taskflow-only', async () => {
  for (const [domain] of controllers) persist(domain);
  for (const key of modes) vi.stubEnv(key, 'projection');
  await recoverGatewayWorkflowLifecycles(log);
  expect(loaded).toEqual(['clawgraph', 'task-loop']);
  expect(called).toEqual(['clawgraph', 'task-loop']);
  expect(log.warn).not.toHaveBeenCalled();
});

it.each(['waiting', 'blocked'] as const)('leaves a %s Mission lifecycle to its normal owner', async status => {
  persist('mission', status);
  await recoverGatewayWorkflowLifecycles(log);
  expect(loaded).toEqual([]);
  expect(called).toEqual([]);
  expect(log.warn).not.toHaveBeenCalled();
});

it('rereads the owner after an empty scan and leaves pending-effect reconciliation intact', async () => {
  await recoverGatewayWorkflowLifecycles(log);
  expect(loaded).toEqual([]);
  for (const executionPhase of ['admitted', 'dispatched', 'effect_pending'] as const) {
    expect(commitWorkflowLifecycle({
      domain: 'task-loop', id: 'task-loop-run', status: 'running', executionPhase,
    }).ok).toBe(true);
  }
  const before = readWorkflowLifecycle('task-loop', 'task-loop-run');
  await recoverGatewayWorkflowLifecycles(log);
  expect(loaded).toEqual(['task-loop']);
  expect(called).toEqual(['task-loop']);
  expect(readWorkflowLifecycle('task-loop', 'task-loop-run')).toEqual(before);
});

it('keeps a failed controller from suppressing recovery of the remaining domains', async () => {
  for (const [domain] of controllers) persist(domain);
  failed = 'clawgraph';
  await recoverGatewayWorkflowLifecycles(log);
  expect(called).toEqual(['clawgraph', 'mission', 'task-loop']);
  expect(log.warn).toHaveBeenCalledWith('gateway: ClawGraph lifecycle restart recovery failed: Error: recovery failed');
  expect(log.info).toHaveBeenCalledTimes(2);
});
