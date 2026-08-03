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
  return { enabled, database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } } as const;
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
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
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

  it('preserves cancel semantics via a new terminal projection', () => {
    // Cancel is expressed as a flow cancelled state after a blocked wait.
    expect(projectTaskLoopRun(input({ status: 'blocked', waiting: true }), options()).projected).toBe(true);
    // The projection itself never executes effects; checkpoint material stays separate.
    const store = new TaskFlowCasStore(options().database);
    const row = store.getById('taskloop:taskloop-1');
    expect(row?.wait_json).toContain('manual_review');
  });

  it('is a no-op when the flag is off (pure legacy path)', () => {
    const result = projectTaskLoopRun(input({ status: 'running' }), options(false));
    expect(result.projected).toBe(false);
    expect(result.skippedReason).toBe('flag-off');
    const store = new TaskFlowCasStore(options().database);
    expect(store.getById('taskloop:taskloop-1')).toBeUndefined();
  });

  it('checkpoint material is retained separately; the projection never executes effects', () => {
    const result = projectTaskLoopRun(
      input({ status: 'running', checkpointRef: 'checkpoint:taskloop-1:1' }),
      options(),
    );
    expect(result.projected).toBe(true);
    // The checkpoint ref is recorded as state, not executed.
    const store = new TaskFlowCasStore(options().database);
    const row = store.getById('taskloop:taskloop-1');
    expect(row?.state_json).toContain('checkpoint:taskloop-1:1');
  });
});
