// RC-06D: Task Loop lifecycle cutover to the TaskFlow owner, driven through the
// production controller (runTaskLoop / cancelTaskLoopRun) with the orchestrator,
// reviewer, and checkpoint writer injected.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { TaskFlowCasStore } from '../tasks/task-flow-cas.js';
import {
  getWorkflowLifecycleDrift,
  readWorkflowLifecycle,
  resetWorkflowLifecycleDriftForTest,
} from '../tasks/workflow-lifecycle-owner.js';
import {
  cancelTaskLoopRun,
  clearTaskLoopRunsForTests,
  getTaskLoopLifecycle,
  runTaskLoop,
  settleOrphanedTaskLoopLifecycles,
  type TaskLoopControllerDeps,
} from './task-loop-controller.js';

const MODE_ENV = 'OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER';
const tempRoots: string[] = [];

type SelfCheck = Awaited<ReturnType<NonNullable<TaskLoopControllerDeps['selfCheck']>>>;
type Decision = 'complete' | 'repair' | 'blocked' | 'ask_user';

function selfCheckResult(decision: Decision): SelfCheck {
  const askUser = decision === 'ask_user';
  return {
    decision: askUser ? 'blocked' : decision,
    confidence: 1,
    missingEvidence: [],
    verificationGaps: [],
    risks: [],
    repairBrief: decision === 'repair' ? 'fix the remaining gap' : undefined,
    controlSignals: askUser
      ? [
          {
            kind: 'permission_wait',
            severity: 'blocking',
            message: 'needs a human decision',
            suggestedAction: 'ask_user',
            source: 'task_loop.self_check',
          },
        ]
      : [],
    validationState: { status: 'passed', checks: [] },
    contextSummary: `self-check ${decision}`,
  } as never;
}

type Harness = {
  deps: TaskLoopControllerDeps;
  orchestrations: () => number;
  loopRunId: string;
};

let counter = 0;

function harness(options: {
  decisions?: Decision[];
  beforeSelfCheck?: (loopRunId: string) => Promise<void> | void;
  onCheckpoint?: (loopRunId: string) => void;
  storeTrace?: TaskLoopControllerDeps['storeTrace'];
} = {}): Harness {
  counter += 1;
  const loopRunId = `loop-rc06d-${counter}`;
  const decisions = [...(options.decisions ?? ['complete'])];
  let orchestrations = 0;
  const deps: TaskLoopControllerDeps = {
    idFactory: (prefix) => (prefix === 'loop' ? loopRunId : `${prefix}-rc06d-${counter}-${orchestrations}`),
    ensureTaskLedgerRoot: async () => `ledger-${loopRunId}`,
    recordCheckpoint: () => {
      options.onCheckpoint?.(loopRunId);
    },
    storeTrace: options.storeTrace ?? (() => undefined),
    runObserved: async () => {
      orchestrations += 1;
      return {
        plan: { mode: 'serial', leadRole: 'developer', templateId: 'quick-development', workers: [{ roleName: 'developer' }] },
        outcomes: [
          {
            roleName: 'developer',
            isVerifier: false,
            ledger: { taskId: 'task-developer', taskNodeId: 'task-developer' },
            spawn: { status: 'accepted', result: { runId: `child-${loopRunId}`, childSessionKey: `agent:child:${loopRunId}` } },
          },
        ],
        failures: [],
      } as never;
    },
    getSubagentRun: () =>
      ({
        runId: `child-${loopRunId}`,
        childSessionKey: `agent:child:${loopRunId}`,
        completion: { required: true, resultText: 'Implemented the change.\nTests passed.', capturedAt: Date.now() },
        outcome: { status: 'ok' },
      }) as never,
    selfCheck: (async () => {
      await options.beforeSelfCheck?.(loopRunId);
      return selfCheckResult(decisions.length > 1 ? decisions.shift()! : decisions[0]!);
    }) as NonNullable<TaskLoopControllerDeps['selfCheck']>,
  };
  return { deps, orchestrations: () => orchestrations, loopRunId };
}

const run = (h: Harness) =>
  runTaskLoop({ task: 'prove the task loop cutover', sessionKey: 'agent:main:rc06d', agentId: 'main' }, undefined, h.deps);

const flowRow = (loopRunId: string) => readWorkflowLifecycle('task-loop', loopRunId);

function settleExternally(loopRunId: string, status: 'cancelled' | 'failed') {
  // A second writer on its own store instance, as another process would be.
  const store = new TaskFlowCasStore();
  const row = store.getById(`task-loop:${loopRunId}`)!;
  expect(store.casUpsert({ flowId: row.flow_id, expectedRevision: Number(row.revision), status }).ok).toBe(true);
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc06d-taskloop-cutover-'));
  tempRoots.push(root);
  process.env.OPENCLAW_STATE_DIR = path.join(root, 'state');
  fs.mkdirSync(process.env.OPENCLAW_STATE_DIR, { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, 'home');
  fs.mkdirSync(process.env.OPENCLAW_HOME, { recursive: true });
  resetWorkflowLifecycleDriftForTest();
});

afterEach(() => {
  clearTaskLoopRunsForTests();
  closeOpenClawStateDatabase();
  delete process.env[MODE_ENV];
  delete process.env.RC06D_TASK_LOOP_PROJECTION;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_HOME;
  for (const root of tempRoots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Windows can hold the SQLite handle briefly; the root is under the OS temp dir.
    }
  }
});

describe('RC-06D Task Loop lifecycle cutover (taskflow writer)', () => {
  beforeEach(() => {
    process.env[MODE_ENV] = 'taskflow';
  });

  it('a run commits its lifecycle to TaskFlow and settles there as succeeded', async () => {
    const h = harness();
    const result = await run(h);
    expect(result.status).toBe('complete');
    const row = flowRow(h.loopRunId);
    expect(row?.controller_id).toBe('task-loop-lifecycle');
    expect(row?.status).toBe('succeeded');
    expect(row?.ended_at).not.toBeNull();
    expect(getWorkflowLifecycleDrift()).toEqual([]);
  });

  it('a human wait commits waiting; cancel settles it and a second cancel changes nothing', async () => {
    const h = harness({ decisions: ['ask_user'] });
    const result = await run(h);
    expect(result.status).toBe('blocked');
    expect(flowRow(h.loopRunId)?.status).toBe('waiting');
    expect(getTaskLoopLifecycle(h.loopRunId)).toMatchObject({ status: 'blocked', lifecycleSource: 'taskflow' });

    expect(cancelTaskLoopRun(h.loopRunId).status).toBe('cancelled');
    expect(flowRow(h.loopRunId)?.status).toBe('cancelled');
    expect(cancelTaskLoopRun(h.loopRunId).status).toBe('cancelled');
    expect(getWorkflowLifecycleDrift()).toEqual([]);
  });

  it('a guardian-style block without a human wait is blocked, not waiting', async () => {
    const h = harness({ decisions: ['blocked'] });
    expect((await run(h)).status).toBe('blocked');
    expect(flowRow(h.loopRunId)?.status).toBe('blocked');
  });

  it('cancel while running commits cancelled and the loop stops without settling again', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const atSelfCheck = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const h = harness({
      beforeSelfCheck: async () => {
        reached();
        await gate;
      },
    });
    const pending = run(h);
    await atSelfCheck;
    expect(flowRow(h.loopRunId)?.status).toBe('running');
    expect(cancelTaskLoopRun(h.loopRunId).status).toBe('cancelled');
    expect(flowRow(h.loopRunId)?.status).toBe('cancelled');
    release();
    const result = await pending;
    expect(result.status).toBe('cancelled');
    expect(flowRow(h.loopRunId)?.status).toBe('cancelled');
    expect(getWorkflowLifecycleDrift()).toEqual([]);
  });

  it('a cancel that lands during a repair stops the loop before another orchestration', async () => {
    const h = harness({
      decisions: ['repair', 'complete'],
      onCheckpoint: (loopRunId) => {
        cancelTaskLoopRun(loopRunId);
      },
    });
    const result = await run(h);
    expect(result.status).toBe('cancelled');
    expect(h.orchestrations()).toBe(1);
    expect(flowRow(h.loopRunId)?.status).toBe('cancelled');
  });

  it('legacy freeze: a lifecycle another writer settled cannot be moved by the in-memory run', async () => {
    const h = harness({ beforeSelfCheck: (loopRunId) => settleExternally(loopRunId, 'cancelled') });
    const result = await run(h);
    // The run adopts the committed truth instead of writing succeeded.
    expect(result.status).toBe('cancelled');
    expect(result.error).toMatch(/lifecycle rejected by TaskFlow/);
    expect(flowRow(h.loopRunId)?.status).toBe('cancelled');
    expect(getWorkflowLifecycleDrift()).toEqual([
      expect.objectContaining({ domain: 'task-loop', reason: 'illegal-transition', transition: 'cancelled->succeeded' }),
    ]);
  });

  it('a failure after the run settled keeps the settled lifecycle', async () => {
    const h = harness({
      storeTrace: () => {
        throw new Error('trace store unavailable');
      },
    });
    const result = await run(h);
    expect(result.status).toBe('complete');
    expect(result.error).toBe('trace store unavailable');
    expect(flowRow(h.loopRunId)?.status).toBe('succeeded');
    expect(getWorkflowLifecycleDrift()).toEqual([]);
  });

  it('restart: orphaned lifecycles settle as lost and are answered from TaskFlow without replaying effects', async () => {
    const waiting = harness({ decisions: ['ask_user'] });
    await run(waiting);
    const done = harness();
    await run(done);
    const orchestrationsBefore = waiting.orchestrations() + done.orchestrations();

    clearTaskLoopRunsForTests();
    expect(settleOrphanedTaskLoopLifecycles()).toEqual([waiting.loopRunId]);
    expect(flowRow(waiting.loopRunId)?.status).toBe('lost');
    expect(flowRow(waiting.loopRunId)?.current_step).toBe('restart:controller-gone');
    expect(flowRow(done.loopRunId)?.status).toBe('succeeded');
    expect(getTaskLoopLifecycle(waiting.loopRunId)).toMatchObject({ status: 'error', lifecycleSource: 'taskflow' });
    expect(settleOrphanedTaskLoopLifecycles()).toEqual([]);
    expect(waiting.orchestrations() + done.orchestrations()).toBe(orchestrationsBefore);
  });
});

describe('RC-06D writer modes', () => {
  it('rollback to legacy freezes the TaskFlow writer: no row, no restart settlement', async () => {
    process.env[MODE_ENV] = 'taskflow';
    const cutover = harness({ decisions: ['ask_user'] });
    await run(cutover);
    clearTaskLoopRunsForTests();

    process.env[MODE_ENV] = 'legacy';
    const legacy = harness();
    expect((await run(legacy)).status).toBe('complete');
    expect(flowRow(legacy.loopRunId)).toBeUndefined();
    expect(settleOrphanedTaskLoopLifecycles()).toEqual([]);
    expect(flowRow(cutover.loopRunId)?.status).toBe('waiting');
  });

  it('legacy keeps its own error semantics for a failure after the run settled', async () => {
    process.env[MODE_ENV] = 'legacy';
    const h = harness({
      storeTrace: () => {
        throw new Error('trace store unavailable');
      },
    });
    // Unchanged legacy behavior: the error path stores the trace again and the failure propagates.
    await expect(run(h)).rejects.toThrow('trace store unavailable');
    expect(flowRow(h.loopRunId)).toBeUndefined();
  });

  it('projection mirrors the run status and records rejected writes as drift', async () => {
    process.env.RC06D_TASK_LOOP_PROJECTION = '1';
    const mirrored = harness({ decisions: ['ask_user'] });
    await run(mirrored);
    expect(flowRow(mirrored.loopRunId)?.status).toBe('waiting');

    const h = harness({ beforeSelfCheck: (loopRunId) => settleExternally(loopRunId, 'cancelled') });
    // Legacy stays authoritative in projection mode.
    expect((await run(h)).status).toBe('complete');
    expect(flowRow(h.loopRunId)?.status).toBe('cancelled');
    // Every rejected write is recorded, including the phase re-projections after the cancel.
    expect(getWorkflowLifecycleDrift()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'task-loop', reason: 'illegal-transition', transition: 'cancelled->running' }),
        expect.objectContaining({ domain: 'task-loop', reason: 'illegal-transition', transition: 'cancelled->succeeded' }),
      ]),
    );
  });
});
