import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../../state/openclaw-state-db.js';
import { TaskFlowCasStore } from '../../tasks/task-flow-cas.js';
import {
  projectMissionRun,
  recoverMissionProjection,
} from './mission-taskflow-projection.js';

const tempRoots: string[] = [];
let stateDir = '';

function options(enabled = true) {
  return { enabled, database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } } as const;
}

function input(overrides = {}) {
  return { missionId: 'mission-1', sessionKey: 'sess-1', status: 'running', phase: 'execute', tick: 1, ...overrides };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc06c-mission-'));
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

describe('RC-06C Mission -> TaskFlow read-only projection', () => {
  it('projects mission status transitions into flow_runs', () => {
    expect(projectMissionRun(input({ status: 'idle' }), options()).projected).toBe(true);
    const running = projectMissionRun(input({ status: 'running', phase: 'execute' }), options());
    expect(running.projected).toBe(true);
    expect(running.status).toBe('running');
    const completed = projectMissionRun(input({ status: 'complete' }), options());
    expect(completed.projected).toBe(true);
    expect(completed.status).toBe('succeeded');
  });

  it('preserves wait semantics (ask_user/sleep -> waiting flow status)', () => {
    expect(projectMissionRun(input({ status: 'running' }), options()).projected).toBe(true);
    const ask = projectMissionRun(input({ status: 'ask_user', waitMode: 'ask_user' }), options());
    expect(ask.projected).toBe(true);
    expect(ask.status).toBe('waiting');
    const recovery = recoverMissionProjection('mission-1', options());
    expect(recovery.waitMode).toBe('ask_user');
  });

  it('preserves restart semantics (recover reads the same SQLite rows)', () => {
    expect(projectMissionRun(input({ status: 'running' }), options()).projected).toBe(true);
    expect(projectMissionRun(input({ status: 'blocked' }), options()).projected).toBe(true);
    const recovery = recoverMissionProjection('mission-1', options());
    expect(recovery.recovered).toBe(true);
    expect(recovery.status).toBe('blocked');
  });

  it('preserves resume semantics (blocked -> running)', () => {
    expect(projectMissionRun(input({ status: 'running' }), options()).projected).toBe(true);
    expect(projectMissionRun(input({ status: 'blocked' }), options()).projected).toBe(true);
    const resumed = projectMissionRun(input({ status: 'running', phase: 'execute', tick: 2 }), options());
    expect(resumed.projected).toBe(true);
    expect(resumed.status).toBe('running');
  });

  it('preserves cancel semantics (running -> cancelled)', () => {
    expect(projectMissionRun(input({ status: 'running' }), options()).projected).toBe(true);
    const cancelled = projectMissionRun(input({ status: 'cancelled' }), options());
    expect(cancelled.projected).toBe(true);
    expect(cancelled.status).toBe('cancelled');
  });

  it('is a no-op when the flag is off (pure legacy path)', () => {
    const result = projectMissionRun(input({ status: 'running' }), options(false));
    expect(result.projected).toBe(false);
    expect(result.skippedReason).toBe('flag-off');
    const store = new TaskFlowCasStore(options().database);
    expect(store.getById('mission:mission-1')).toBeUndefined();
  });

  it('skips unknown statuses without failing the legacy path', () => {
    const result = projectMissionRun(input({ status: 'not-a-status' }), options());
    expect(result.projected).toBe(false);
    expect(result.skippedReason).toBe('unknown-status');
  });
});
