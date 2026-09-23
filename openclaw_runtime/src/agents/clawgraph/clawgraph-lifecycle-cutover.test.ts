// RC-06B: ClawGraph lifecycle cutover to the TaskFlow owner, driven through the
// production runtime (startClawGraphRun / advanceClawGraphRun /
// abortClawGraphRun), not through hand-made events.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({ runs: [] as Array<Record<string, unknown>> }));
vi.mock('../subagent-registry.js', () => ({
  listSubagentRunsForRequester: (requesterSessionKey: string) =>
    registry.runs.filter((entry) => entry.requesterSessionKey === requesterSessionKey),
}));

import { closeOpenClawStateDatabase } from '../../state/openclaw-state-db.js';
import { CAS_CREATE_SENTINEL, TaskFlowCasStore } from '../../tasks/task-flow-cas.js';
import {
  getWorkflowLifecycleDrift,
  readWorkflowLifecycle,
  resetWorkflowLifecycleDriftForTest,
} from '../../tasks/workflow-lifecycle-owner.js';
import type { SpawnFn } from '../role-spawn.js';
import {
  abortClawGraphRun,
  advanceClawGraphRun,
  getClawGraphRunLifecycleConflict,
  getClawGraphRunStatus,
  resetClawGraphRunsForTests,
  reviewClawGraphRun,
  settleOrphanedClawGraphLifecycles,
  startClawGraphRun,
} from './runtime.js';
import type { ClawGraphIR } from './types.js';

const MODE_ENV = 'OPENCLAW_CLAWGRAPH_LIFECYCLE_WRITER';
const tempRoots: string[] = [];

const IR: ClawGraphIR = {
  schemaVersion: 1,
  workflowId: 'rc06b_flow',
  title: 'RC-06B flow',
  objective: 'Prove the ClawGraph lifecycle cutover',
  maxParallel: 1,
  policies: [{ on: 'node_failed', action: 'retry', maxAttempts: 1 }],
  termination: ['all_required_nodes_done'],
  nodes: [
    {
      id: 'work',
      type: 'agent',
      role: 'planner',
      runtimeRole: 'planner',
      modelRef: null,
      task: 'Do the work.',
      dependsOn: [],
      checks: [],
      required: true,
    },
  ],
};

const accepted: SpawnFn = async () => ({ status: 'accepted', runId: 'child_run', childSessionKey: 'agent:main:child' });
const rejected: SpawnFn = async () => ({ status: 'error', error: 'spawn refused' }) as never;

function completeChild(resultText: string) {
  registry.runs.push({
    runId: 'child_run',
    childSessionKey: 'agent:main:child',
    requesterSessionKey: 'agent:main:parent',
    requesterDisplayKey: 'parent',
    task: 'Do the work.',
    cleanup: 'keep',
    createdAt: Date.now(),
    endedAt: Date.now(),
    outcome: { status: 'ok' },
    completion: { required: true, resultText },
  });
}

const DONE_HANDOFF = [
  '```clawgraph_handoff',
  JSON.stringify({ nodeId: 'work', status: 'done', summary: 'done', evidenceRefs: [{ type: 'subagent', ref: 'child_run' }] }),
  '```',
].join('\n');

const start = (spawn: SpawnFn = accepted) =>
  startClawGraphRun({ ir: IR, sessionKey: 'agent:main:parent', workspaceRoot: process.cwd(), deps: { spawn } });

const advance = (runId: string) =>
  advanceClawGraphRun(runId, { sessionKey: 'agent:main:parent', workspaceRoot: process.cwd() });

const flowRow = (runId: string) => readWorkflowLifecycle('clawgraph', runId);

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc06b-clawgraph-'));
  tempRoots.push(root);
  process.env.OPENCLAW_STATE_DIR = path.join(root, 'state');
  fs.mkdirSync(process.env.OPENCLAW_STATE_DIR, { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, 'home');
  fs.mkdirSync(process.env.OPENCLAW_HOME, { recursive: true });
  resetWorkflowLifecycleDriftForTest();
});

afterEach(() => {
  resetClawGraphRunsForTests();
  registry.runs = [];
  closeOpenClawStateDatabase();
  delete process.env[MODE_ENV];
  delete process.env.RC06B_CLAWGRAPH_PROJECTION;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_HOME;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('RC-06B ClawGraph lifecycle cutover (taskflow writer)', () => {
  beforeEach(() => {
    process.env[MODE_ENV] = 'taskflow';
  });

  it('a run exists only with a TaskFlow row and every status change commits there first', async () => {
    const started = await start();
    expect(started.status).toBe('running');
    const row = flowRow(started.runId);
    expect(row?.controller_id).toBe('clawgraph-lifecycle');
    expect(row?.status).toBe('running');

    completeChild(DONE_HANDOFF);
    const finished = await advance(started.runId);
    expect(finished?.status).toBe('complete');
    expect(flowRow(started.runId)?.status).toBe('succeeded');
    expect(flowRow(started.runId)?.ended_at).not.toBeNull();
    expect(getWorkflowLifecycleDrift()).toEqual([]);
  });

  it('an open review blocks the flow; approving it completes the run', async () => {
    const started = await start(rejected);
    expect(started.status).toBe('review');
    expect(flowRow(started.runId)?.status).toBe('blocked');
    const reviewId = started.reviewItems[0]!.id;
    const approved = await reviewClawGraphRun({ runId: started.runId, reviewId, decision: 'approve' });
    expect(approved?.status).toBe('complete');
    expect(flowRow(started.runId)?.status).toBe('succeeded');
  });

  it('a rejected review leaves the run blocked in TaskFlow too', async () => {
    const started = await start(rejected);
    const rejectedRun = await reviewClawGraphRun({
      runId: started.runId,
      reviewId: started.reviewItems[0]!.id,
      decision: 'reject',
    });
    expect(rejectedRun?.status).toBe('blocked');
    expect(flowRow(started.runId)?.status).toBe('blocked');
  });

  it('cancel commits cancelled; cancelling a settled run changes nothing', async () => {
    const running = await start();
    expect(abortClawGraphRun(running.runId)?.status).toBe('aborted');
    expect(flowRow(running.runId)?.status).toBe('cancelled');

    const done = await start();
    completeChild(DONE_HANDOFF);
    await advance(done.runId);
    const afterCancel = abortClawGraphRun(done.runId);
    expect(afterCancel?.status).toBe('complete');
    expect(afterCancel?.nodes[0]?.status).toBe('done');
    expect(flowRow(done.runId)?.status).toBe('succeeded');
    expect(getClawGraphRunLifecycleConflict(done.runId)).toMatch(/^illegal-transition/);
  });

  it('legacy freeze: the in-memory run cannot move a lifecycle TaskFlow rejects', async () => {
    const started = await start();
    // Another writer settles the flow first.
    const store = new TaskFlowCasStore();
    const current = store.getById(`clawgraph:${started.runId}`)!;
    expect(store.casUpsert({ flowId: current.flow_id, expectedRevision: Number(current.revision), status: 'cancelled' }).ok).toBe(true);

    completeChild(DONE_HANDOFF);
    const advanced = await advance(started.runId);
    expect(advanced?.status).toBe('running');
    expect(flowRow(started.runId)?.status).toBe('cancelled');
    expect(getWorkflowLifecycleDrift()).toEqual([
      expect.objectContaining({ domain: 'clawgraph', reason: 'illegal-transition', transition: 'cancelled->succeeded' }),
    ]);
  });

  it('restart: orphaned lifecycles settle as lost and stay readable from TaskFlow', async () => {
    const started = await start();
    resetClawGraphRunsForTests();
    expect(settleOrphanedClawGraphLifecycles()).toEqual([started.runId]);
    expect(flowRow(started.runId)?.status).toBe('lost');
    const recovered = await getClawGraphRunStatus(started.runId);
    expect(recovered).toMatchObject({
      runId: started.runId,
      status: 'failed',
      title: 'RC-06B flow',
      sessionKey: 'agent:main:parent',
    });
    expect(settleOrphanedClawGraphLifecycles()).toEqual([]);
  });
});

describe('RC-06B writer modes', () => {
  it('rollback to legacy freezes the TaskFlow writer: no row, no restart settlement', async () => {
    process.env[MODE_ENV] = 'taskflow';
    const cutover = await start();
    resetClawGraphRunsForTests();

    process.env[MODE_ENV] = 'legacy';
    const legacy = await start();
    completeChild(DONE_HANDOFF);
    expect((await advance(legacy.runId))?.status).toBe('complete');
    expect(flowRow(legacy.runId)).toBeUndefined();
    expect(settleOrphanedClawGraphLifecycles()).toEqual([]);
    expect(flowRow(cutover.runId)?.status).toBe('running');
    expect(await getClawGraphRunStatus(cutover.runId)).toBeNull();
  });

  it('projection mirrors the run status and records rejected writes as drift', async () => {
    process.env.RC06B_CLAWGRAPH_PROJECTION = '1';
    const inReview = await start(rejected);
    expect(flowRow(inReview.runId)?.status).toBe('blocked');

    const running = await start();
    const store = new TaskFlowCasStore();
    const row = store.getById(`clawgraph:${running.runId}`)!;
    store.casUpsert({ flowId: row.flow_id, expectedRevision: Number(row.revision), status: 'cancelled' });
    completeChild(DONE_HANDOFF);
    // Legacy stays authoritative in projection mode.
    expect((await advance(running.runId))?.status).toBe('complete');
    expect(getWorkflowLifecycleDrift()).toEqual([
      expect.objectContaining({ reason: 'illegal-transition', transition: 'cancelled->succeeded' }),
    ]);
  });

  it('the TaskFlow create sentinel still guards a fresh lifecycle row', () => {
    const store = new TaskFlowCasStore();
    expect(store.casUpsert({ flowId: 'clawgraph:x', expectedRevision: 3, status: 'running' }).ok).toBe(false);
    expect(store.casUpsert({ flowId: 'clawgraph:x', expectedRevision: CAS_CREATE_SENTINEL, status: 'running' }).ok).toBe(true);
  });
});
