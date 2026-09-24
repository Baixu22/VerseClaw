// RC-06C: Mission lifecycle cutover to the TaskFlow owner, driven through the
// production controller (createMission / tickMission / pause / resume /
// cancel) with only the task loop, reviewer, and persistence injected.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OpenClawConfig } from '../../config/types.openclaw.js';
import { closeOpenClawStateDatabase } from '../../state/openclaw-state-db.js';
import { TaskFlowCasStore } from '../../tasks/task-flow-cas.js';
import {
  getWorkflowLifecycleDrift,
  readWorkflowLifecycle,
  resetWorkflowLifecycleDriftForTest,
} from '../../tasks/workflow-lifecycle-owner.js';
import {
  cancelMission,
  createMission,
  MissionLifecycleConflictError,
  pauseMission,
  recoverInterruptedMissionLifecycles,
  resumeMission,
  tickMission,
  type MissionControllerDeps,
} from './controller.js';
import type { MissionRunRecord } from './types.js';

const MODE_ENV = 'OPENCLAW_MISSION_LIFECYCLE_WRITER';
const tempRoots: string[] = [];
const cfg = { agents: { defaults: { missionLoop: { enabled: true } } } } as unknown as OpenClawConfig;

function harness(reviewerDecision: 'complete' | 'continue' = 'complete') {
  const missions = new Map<string, MissionRunRecord>();
  let taskLoopRuns = 0;
  const deps: MissionControllerDeps = {
    getMission: (id: string) => {
      const record = missions.get(id);
      return record ? structuredClone(record) : undefined;
    },
    saveMission: (record: MissionRunRecord) => {
      missions.set(record.missionId, structuredClone(record));
      return record;
    },
    recordEvent: () => undefined,
    storeTrace: () => undefined,
    runTaskLoop: (async () => {
      taskLoopRuns += 1;
      return {
        loopRunId: `loop-${taskLoopRuns}`,
        traceId: `trace-${taskLoopRuns}`,
        status: 'complete' as const,
        finalSummary: 'done',
        evidenceRefs: [],
        risks: [],
        remaining: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }) as unknown as NonNullable<MissionControllerDeps['runTaskLoop']>,
    reviewer: async () => ({
      decision: reviewerDecision,
      confidence: 1,
      reason: reviewerDecision,
      missingEvidence: [],
      verificationGaps: [],
      risks: [],
      memoryCandidates: [],
      checkpointSummary: 'summary',
    }),
    reviewerDeps: {},
    taskLoopDeps: {},
  };
  return { deps, missions, taskLoopRuns: () => taskLoopRuns };
}

const flowRow = (missionId: string) => readWorkflowLifecycle('mission', missionId);

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc06c-mission-cutover-'));
  tempRoots.push(root);
  process.env.OPENCLAW_STATE_DIR = path.join(root, 'state');
  fs.mkdirSync(process.env.OPENCLAW_STATE_DIR, { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, 'home');
  fs.mkdirSync(process.env.OPENCLAW_HOME, { recursive: true });
  resetWorkflowLifecycleDriftForTest();
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env[MODE_ENV];
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_HOME;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('RC-06C Mission lifecycle cutover (taskflow writer)', () => {
  beforeEach(() => {
    process.env[MODE_ENV] = 'taskflow';
  });

  it('create -> tick -> complete commits every status to TaskFlow first', async () => {
    const { deps, missions } = harness('complete');
    const mission = createMission({ objective: 'ship it', sessionKey: 'agent:main:s1' }, cfg, deps);
    expect(flowRow(mission.missionId)).toMatchObject({ controller_id: 'mission-lifecycle', status: 'queued' });
    const done = await tickMission({ missionId: mission.missionId, reason: 'manual' }, cfg, deps);
    expect(done.status).toBe('complete');
    expect(flowRow(mission.missionId)?.status).toBe('succeeded');
    expect(missions.get(mission.missionId)?.status).toBe('complete');
    expect(getWorkflowLifecycleDrift()).toEqual([]);
  });

  it('wait / resume: pause before the first tick, resume, then tick again', async () => {
    const { deps } = harness('continue');
    const mission = createMission({ objective: 'wait', sessionKey: 'agent:main:s2' }, cfg, deps);
    expect(pauseMission(mission.missionId, deps).status).toBe('paused');
    expect(flowRow(mission.missionId)?.status).toBe('waiting');
    expect(resumeMission(mission.missionId, deps).status).toBe('sleeping');
    expect(JSON.parse(flowRow(mission.missionId)!.state_json!)).toMatchObject({ missionStatus: 'sleeping', waitMode: 'sleep' });
    const ticked = await tickMission({ missionId: mission.missionId, reason: 'manual' }, cfg, deps);
    expect(ticked.status).toBe('sleeping');
    expect(flowRow(mission.missionId)?.status).toBe('waiting');
  });

  it('cancel commits cancelled and a cancelled mission never ticks again', async () => {
    const { deps, taskLoopRuns } = harness('continue');
    const mission = createMission({ objective: 'cancel', sessionKey: 'agent:main:s3' }, cfg, deps);
    expect(cancelMission(mission.missionId, deps).status).toBe('cancelled');
    expect(flowRow(mission.missionId)?.status).toBe('cancelled');
    await tickMission({ missionId: mission.missionId, reason: 'manual' }, cfg, deps);
    expect(taskLoopRuns()).toBe(0);
  });

  it('legacy freeze: a lifecycle settled elsewhere stops the tick and mission_runs keeps the committed state', async () => {
    const { deps, missions, taskLoopRuns } = harness('complete');
    const mission = createMission({ objective: 'race', sessionKey: 'agent:main:s4' }, cfg, deps);
    // Another process cancels through TaskFlow first.
    const store = new TaskFlowCasStore();
    const row = store.getById(`mission:${mission.missionId}`)!;
    expect(store.casUpsert({ flowId: row.flow_id, expectedRevision: Number(row.revision), status: 'cancelled' }).ok).toBe(true);

    const result = await tickMission({ missionId: mission.missionId, reason: 'manual' }, cfg, deps);
    expect(result.status).toBe('idle');
    expect(missions.get(mission.missionId)?.status).toBe('idle');
    expect(taskLoopRuns()).toBe(0);
    expect(() => pauseMission(mission.missionId, deps)).toThrow(MissionLifecycleConflictError);
    expect(getWorkflowLifecycleDrift()).toEqual(
      expect.arrayContaining([expect.objectContaining({ domain: 'mission', transition: 'cancelled->running' })]),
    );
  });

  it('restart: a mission interrupted mid-tick goes back to sleeping through the lifecycle owner', () => {
    const { deps, missions } = harness();
    const mission = createMission({ objective: 'restart', sessionKey: 'agent:main:s5' }, cfg, deps);
    // Simulate the previous boot dying mid-tick: TaskFlow and mission_runs both say running.
    const store = new TaskFlowCasStore();
    const row = store.getById(`mission:${mission.missionId}`)!;
    store.casUpsert({ flowId: row.flow_id, expectedRevision: Number(row.revision), status: 'running' });
    missions.set(mission.missionId, { ...missions.get(mission.missionId)!, status: 'running', activeTickId: 'tick-1' });

    expect(recoverInterruptedMissionLifecycles(deps)).toEqual([mission.missionId]);
    expect(flowRow(mission.missionId)?.status).toBe('waiting');
    expect(missions.get(mission.missionId)).toMatchObject({ status: 'sleeping', activeTickId: null });
    expect(recoverInterruptedMissionLifecycles(deps)).toEqual([]);
  });
});

describe('RC-06C writer modes', () => {
  it('rollback to legacy freezes the TaskFlow writer', async () => {
    process.env[MODE_ENV] = 'legacy';
    const { deps, missions } = harness('complete');
    const mission = createMission({ objective: 'legacy', sessionKey: 'agent:main:s6' }, cfg, deps);
    await tickMission({ missionId: mission.missionId, reason: 'manual' }, cfg, deps);
    expect(missions.get(mission.missionId)?.status).toBe('complete');
    expect(flowRow(mission.missionId)).toBeUndefined();
    expect(recoverInterruptedMissionLifecycles(deps)).toEqual([]);
  });

  it('projection keeps mission_runs authoritative and records rejected writes as drift', async () => {
    process.env.RC06C_MISSION_PROJECTION = '1';
    try {
      const { deps, missions } = harness('complete');
      const mission = createMission({ objective: 'projection', sessionKey: 'agent:main:s7' }, cfg, deps);
      const store = new TaskFlowCasStore();
      const row = store.getById(`mission:${mission.missionId}`)!;
      store.casUpsert({ flowId: row.flow_id, expectedRevision: Number(row.revision), status: 'cancelled' });
      await tickMission({ missionId: mission.missionId, reason: 'manual' }, cfg, deps);
      expect(missions.get(mission.missionId)?.status).toBe('complete');
      expect(flowRow(mission.missionId)?.status).toBe('cancelled');
      expect(getWorkflowLifecycleDrift().length).toBeGreaterThan(0);
    } finally {
      delete process.env.RC06C_MISSION_PROJECTION;
    }
  });
});
