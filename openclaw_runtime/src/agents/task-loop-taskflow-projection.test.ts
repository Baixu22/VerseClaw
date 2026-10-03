import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { TaskFlowCasStore } from '../tasks/task-flow-cas.js';
import {
  projectTaskLoopRun,
  recoverTaskLoopProjection,
} from './task-loop-taskflow-projection.js';

const tempRoots: string[] = [];
let stateDir = '';

function options(enabled = true) {
  // Match the env-default path used by the production controller projection
  // (controller.ts calls projectTaskLoopRun with { enabled: true } and no
  // database override -> OPENCLAW_STATE_DIR + '/state/openclaw.sqlite'), so
  // the real-cancel test hits one file.
  return { enabled, database: { env: process.env, path: path.join(stateDir, 'state', 'openclaw.sqlite') } } as const;
}

function input(overrides = {}) {
  return { runId: 'taskloop-1', sessionKey: 'sess-1', status: 'running', phase: 'execute', ...overrides };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc06d-taskloop-'));
  tempRoots.push(root);
  stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, 'home');
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const root of tempRoots.splice(0)) {
    try {
      // Windows may hold file handles briefly after runTaskLoop tears down
      // (agent-side ledger/db handles); the temp root is under the OS temp
      // dir, so a failed cleanup is tolerable and must not fail the suite.
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Best-effort cleanup only.
    }
  }
});

describe('RC-06D Task Loop -> TaskFlow read-only projection', () => {
  it('projects lifecycle statuses into flow_runs', () => {
    expect(projectTaskLoopRun(input({ status: 'running' }), options()).projected).toBe(true);
    const complete = projectTaskLoopRun(input({ status: 'complete' }), options());
    expect(complete.projected).toBe(true);
    expect(complete.status).toBe('succeeded');
  });

  it('preserves wait semantics (blocked-for-review -> waiting flow status)', () => {
    expect(projectTaskLoopRun(input({ status: 'running' }), options()).projected).toBe(true);
    const blocked = projectTaskLoopRun(input({ status: 'blocked', waiting: true }), options());
    expect(blocked.projected).toBe(true);
    expect(blocked.status).toBe('waiting');
    const recovery = recoverTaskLoopProjection('taskloop-1', options());
    expect(recovery.waiting).toBe(true);
  });

  it('preserves terminal states (error -> failed, complete -> succeeded)', () => {
    expect(projectTaskLoopRun(input({ status: 'running' }), options()).projected).toBe(true);
    const error = projectTaskLoopRun(input({ status: 'error' }), options());
    expect(error.projected).toBe(true);
    expect(error.status).toBe('failed');
  });

  it('preserves restart semantics (recover reads the same SQLite rows)', () => {
    expect(projectTaskLoopRun(input({ status: 'running' }), options()).projected).toBe(true);
    expect(projectTaskLoopRun(input({ status: 'blocked', waiting: true }), options()).projected).toBe(true);
    const recovery = recoverTaskLoopProjection('taskloop-1', options());
    expect(recovery.recovered).toBe(true);
    expect(recovery.status).toBe('waiting');
    expect(recovery.waiting).toBe(true);
  });

  it('preserves cancel semantics: cancelled is an EXPLICIT terminal, never blocked/waiting', () => {
    expect(projectTaskLoopRun(input({ status: 'running' }), options()).projected).toBe(true);
    const cancelled = projectTaskLoopRun(input({ status: 'cancelled' }), options());
    expect(cancelled.projected).toBe(true);
    // The TaskFlow state model records cancelled as cancelled — the projection
    // never collapses a real cancel into blocked/waiting.
    expect(cancelled.status).toBe('cancelled');
    const store = new TaskFlowCasStore(options().database);
    const row = store.getById('task-loop:taskloop-1');
    expect(row?.status).toBe('cancelled');
    expect(row?.status).not.toBe('blocked');
    expect(row?.status).not.toBe('waiting');
  });

  it('cancel survives restart and terminal is absorbing; late events cannot resurrect', () => {
    expect(projectTaskLoopRun(input({ status: 'running' }), options()).projected).toBe(true);
    expect(projectTaskLoopRun(input({ status: 'cancelled' }), options()).projected).toBe(true);

    // Terminal absorbing: a late running/waiting event is rejected.
    const late = projectTaskLoopRun(input({ status: 'blocked', waiting: true, phase: 'verify' }), options());
    expect(late.projected).toBe(false);
    expect(late.skippedReason).toBe('conflict');

    const recovery = recoverTaskLoopProjection('taskloop-1', options());
    expect(recovery.recovered).toBe(true);
    expect(recovery.status).toBe('cancelled');
    const store = new TaskFlowCasStore(options().database);
    expect(store.getById('task-loop:taskloop-1')?.ended_at).not.toBeNull();
  });

  it('waiting (manual review) and cancel are distinguishable states', () => {
    // waiting: blocked + waiting -> flow waiting with wait_json.
    expect(projectTaskLoopRun(input({ status: 'blocked', waiting: true }), options()).projected).toBe(true);
    expect(recoverTaskLoopProjection('taskloop-1', options()).status).toBe('waiting');
    expect(recoverTaskLoopProjection('taskloop-1', options()).waiting).toBe(true);
    // A real cancel is recorded as cancelled (waiting=false, not blocked).
    expect(projectTaskLoopRun(input({ status: 'cancelled' }), options()).projected).toBe(true);
    const recovery = recoverTaskLoopProjection('taskloop-1', options());
    expect(recovery.status).toBe('cancelled');
    expect(recovery.waiting).toBe(false);
  });

  it('real cancelTaskLoopRun drives a terminal cancelled projection through the production path', async () => {
    // Enable the production projection gate and drive the REAL controller
    // cancel API (not synthetic projection inputs): runTaskLoop registers the
    // run, cancelTaskLoopRun flips status -> cancelled and emit() projects the
    // terminal state exactly like every other lifecycle transition.
    process.env.RC06D_TASK_LOOP_PROJECTION = '1';
    const { runTaskLoop, cancelTaskLoopRun, getTaskLoopRun, clearTaskLoopRunsForTests } = await import(
      './task-loop-controller.js'
    );
    let releaseSelfCheck!: () => void;
    const selfCheckGate = new Promise<void>((resolve) => {
      releaseSelfCheck = resolve;
    });
    const runPromise = runTaskLoop(
      { task: 'audit the sandbox', sessionKey: 'agent::s1', agentId: 'agent' },
      undefined,
      {
        idFactory: () => 'loop-cancel-test',
        selfCheck: async () => {
          await selfCheckGate;
          return {
            decision: 'complete' as const,
            confidence: 1,
            missingEvidence: [],
            verificationGaps: [],
            risks: [],
            controlSignals: [],
            validationState: { status: 'passed' as const, checks: [] },
            contextSummary: 'done',
          };
        },
      } as never,
    );
    // Wait for runTaskLoop to register its record (after the ledger root await).
    for (let i = 0; i < 200; i += 1) {
      if (getTaskLoopRun('loop-cancel-test')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(getTaskLoopRun('loop-cancel-test')?.status).toBe('running');

    const cancelled = cancelTaskLoopRun('loop-cancel-test');
    expect(cancelled.status).toBe('cancelled');
    // The projection records the REAL terminal cancelled: never waiting/blocked.
    const recovery = recoverTaskLoopProjection('loop-cancel-test', options());
    expect(recovery.recovered).toBe(true);
    expect(recovery.status).toBe('cancelled');
    expect(recovery.waiting).toBe(false);

    releaseSelfCheck();
    await runPromise;
    clearTaskLoopRunsForTests();
    delete process.env.RC06D_TASK_LOOP_PROJECTION;
  });

  it('is a no-op when the flag is off (pure legacy path)', () => {
    const result = projectTaskLoopRun(input({ status: 'running' }), options(false));
    expect(result.projected).toBe(false);
    expect(result.skippedReason).toBe('flag-off');
    const store = new TaskFlowCasStore(options().database);
    expect(store.getById('task-loop:taskloop-1')).toBeUndefined();
  });

  it('checkpoint material is retained separately; the projection never executes effects', () => {
    const result = projectTaskLoopRun(
      input({ status: 'running', checkpointRef: 'checkpoint:taskloop-1:1' }),
      options(),
    );
    expect(result.projected).toBe(true);
    // The checkpoint ref is recorded as state, not executed.
    const store = new TaskFlowCasStore(options().database);
    const row = store.getById('task-loop:taskloop-1');
    expect(row?.state_json).toContain('checkpoint:taskloop-1:1');
  });
});
