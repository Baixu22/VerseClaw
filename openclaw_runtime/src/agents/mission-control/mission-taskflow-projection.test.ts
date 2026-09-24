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
  // Match the env-default path used by the production controller projection
  // (controller.ts calls projectMissionRun with { enabled: true } and no
  // database override -> resolveOpenClawStateSqlitePath = OPENCLAW_STATE_DIR
  // + '/state/openclaw.sqlite'), so the real-pause test hits one file.
  return { enabled, database: { env: process.env, path: path.join(stateDir, 'state', 'openclaw.sqlite') } } as const;
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
    expect(projectMissionRun(input({ status: 'sleeping', waitMode: 'sleep' }), options()).projected).toBe(true);
    const recovery = recoverMissionProjection('mission-1', options());
    expect(recovery.recovered).toBe(true);
    expect(recovery.status).toBe('waiting');
    expect(recovery.missionStatus).toBe('sleeping');
  });

  it('a blocked mission is final: it settles as failed and cannot resume', () => {
    expect(projectMissionRun(input({ status: 'running' }), options()).projected).toBe(true);
    const blocked = projectMissionRun(input({ status: 'blocked' }), options());
    expect(blocked.status).toBe('failed');
    const store = new TaskFlowCasStore(options().database);
    expect(store.getById('mission:mission-1')?.ended_at).not.toBeNull();
    expect(projectMissionRun(input({ status: 'running', tick: 2 }), options()).projected).toBe(false);
  });

  it('preserves resume semantics (sleeping -> running on the next tick)', () => {
    expect(projectMissionRun(input({ status: 'running' }), options()).projected).toBe(true);
    expect(projectMissionRun(input({ status: 'sleeping' }), options()).projected).toBe(true);
    const resumed = projectMissionRun(input({ status: 'running', phase: 'execute', tick: 2 }), options());
    expect(resumed.projected).toBe(true);
    expect(resumed.status).toBe('running');
  });

  it('real pauseMission -> resumeMission projects wait semantics through the production path', async () => {
    // Enable the production projection gate and drive the REAL controller
    // functions (not synthetic projection inputs): pauseMission emits paused
    // (waiting + waitMode=pause), resumeMission emits sleeping (waiting +
    // waitMode=sleep) through controller.ts emit().
    process.env.RC06C_MISSION_PROJECTION = '1';
    const { createMission, pauseMission, resumeMission } = await import('./controller.js');
    const { projectMissionRun } = await import('./mission-taskflow-projection.js');
    const missions = new Map<string, { missionId: string; status: string; phase: string; tick: number }>();
    const deps = {
      getMission: (id: string) => missions.get(id),
      saveMission: (record: { missionId: string; status: string; phase: string; tick: number }) => {
        missions.set(record.missionId, record);
        return record;
      },
    };
    const mission = createMission(
      { objective: 'task', sessionKey: 'agent::s1' },
      { runtime: { mission: { enabled: true } } } as never,
      deps as never,
    );
    missions.set(mission.missionId, mission);
    // A new mission can be paused before its first tick (queued -> waiting).

    const paused = pauseMission(mission.missionId, deps as never);
    expect(paused.status).toBe('paused');
    const pausedRecovery = recoverMissionProjection(mission.missionId, options());
    expect(pausedRecovery.status).toBe('waiting');
    expect(pausedRecovery.waitMode).toBe('pause');

    const resumed = resumeMission(mission.missionId, deps as never);
    expect(resumed.status).toBe('sleeping');
    const resumedRecovery = recoverMissionProjection(mission.missionId, options());
    expect(resumedRecovery.status).toBe('waiting');
    expect(resumedRecovery.waitMode).toBe('sleep');

    delete process.env.RC06C_MISSION_PROJECTION;
  });

  it('preserves cancel semantics (running -> cancelled)', () => {
    expect(projectMissionRun(input({ status: 'running' }), options()).projected).toBe(true);
    const cancelled = projectMissionRun(input({ status: 'cancelled' }), options());
    expect(cancelled.projected).toBe(true);
    expect(cancelled.status).toBe('cancelled');
  });

  it('cancel survives restart and terminal is absorbing', () => {
    expect(projectMissionRun(input({ status: 'running' }), options()).projected).toBe(true);
    expect(projectMissionRun(input({ status: 'cancelled' }), options()).projected).toBe(true);

    // Terminal is absorbing: a late running event cannot resurrect the mission.
    const late = projectMissionRun(input({ status: 'running', tick: 9 }), options());
    expect(late.projected).toBe(false);
    expect(late.skippedReason).toBe('conflict');

    // Restart recovery sees the terminal truth from flow_runs.
    const recovery = recoverMissionProjection('mission-1', options());
    expect(recovery.recovered).toBe(true);
    expect(recovery.status).toBe('cancelled');
    const store = new TaskFlowCasStore(options().database);
    expect(store.getById('mission:mission-1')?.ended_at).not.toBeNull();
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
