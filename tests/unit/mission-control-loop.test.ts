import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskLoopRunResult } from '../../openclaw_runtime/src/agents/task-loop-controller';
import type {
  MissionControllerDeps,
} from '../../openclaw_runtime/src/agents/mission-control/controller';
import type {
  MissionDecision,
  MissionReviewerResult,
  MissionRunRecord,
} from '../../openclaw_runtime/src/agents/mission-control/types';

vi.mock('../../openclaw_runtime/src/agents/long-task-control/store', () => ({
  getLatestLongTaskCheckpoint: vi.fn(() => undefined),
  buildRuntimeResumeCheckpoint: vi.fn((input: Record<string, unknown>) => ({
    schemaVersion: 1,
    id: input.id,
    sessionKey: input.sessionKey,
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    trigger: input.trigger,
    activeTask: input.activeTask,
    nextAction: input.nextAction,
    openBlockers: [],
    decisions: [],
    deviations: [],
    filesTouched: [],
    testsRun: [],
    reviewNeededItems: input.reviewNeededItems ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    metadata: input.metadata,
    createdAt: new Date(input.createdAt as number).toISOString(),
  })),
  recordLongTaskCheckpoint: vi.fn(),
}));

import {
  cancelMission,
  createMission,
  pauseMission,
  resumeMission,
  runMission,
  tickMission,
} from '../../openclaw_runtime/src/agents/mission-control/controller';

function taskLoop(status: TaskLoopRunResult['status'] = 'complete', remaining: string[] = []): TaskLoopRunResult {
  return {
    loopRunId: 'loop-1',
    sessionKey: 'agent:main:session',
    task: 'ship',
    status,
    phase: status === 'complete' ? 'complete' : 'blocked',
    iteration: 1,
    maxIterations: 3,
    maxRepairIterations: 2,
    orchestrationRunIds: ['orch-1'],
    evidenceRefs: [{ type: 'trace', ref: 'orch-1', summary: 'worker evidence' }],
    risks: [],
    remaining,
    nextActions: [],
    finalSummary: status === 'complete' ? 'done' : 'blocked',
    traceId: 'trace-loop',
    createdAt: 1,
    updatedAt: 2,
    iterations: [],
  };
}

function review(decision: MissionDecision, patch: Partial<MissionReviewerResult> = {}): MissionReviewerResult {
  return {
    decision,
    confidence: decision === 'complete' ? 0.9 : 0.6,
    reason: `${decision} reason`,
    missingEvidence: [],
    verificationGaps: [],
    risks: [],
    memoryCandidates: [],
    checkpointSummary: `${decision} summary`,
    ...patch,
  };
}

function createDeps(params?: {
  reviewerDecision?: MissionDecision;
  reviewer?: MissionControllerDeps['reviewer'];
  runTaskLoop?: MissionControllerDeps['runTaskLoop'];
}) {
  const store = new Map<string, MissionRunRecord>();
  let id = 0;
  let now = 1_000;
  const lifecycle: string[] = [];
  const deps: MissionControllerDeps = {
    idFactory: (prefix) => `${prefix}-${++id}`,
    now: () => now++,
    saveMission: (record) => {
      store.set(record.missionId, JSON.parse(JSON.stringify(record)) as MissionRunRecord);
      return record;
    },
    getMission: (missionId) => store.get(missionId),
    getLatestMissionForSession: (sessionKey) => [...store.values()].find((record) => record.sessionKey === sessionKey),
    recordEvent: vi.fn(),
    runTaskLoop: params?.runTaskLoop ?? (async () => taskLoop()),
    reviewer: params?.reviewer ?? (async () => review(params?.reviewerDecision ?? 'complete')),
    storeTrace: vi.fn() as never,
    proposeMemory: vi.fn() as never,
    lifecycle: (event) => lifecycle.push(`${event.phase}:${event.status}:${event.reviewerDecision ?? ''}`),
  };
  return { deps, store, lifecycle };
}

describe('Mission Control controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates and completes a mission through one tick', async () => {
    const { deps, lifecycle } = createDeps({ reviewerDecision: 'complete' });
    const mission = await runMission(
      {
        objective: 'Ship Mission Control',
        sessionKey: 'agent:main:session',
        acceptance: ['tests pass'],
      },
      {},
      deps,
    );

    expect(mission.status).toBe('complete');
    expect(mission.phase).toBe('complete');
    expect(mission.tick).toBe(1);
    expect(mission.taskLoopRunId).toBe('loop-1');
    expect(mission.ticks[0]?.reviewer?.decision).toBe('complete');
    expect(lifecycle).toContain('complete:complete:complete');
  });

  it('sleeps after a scoped repair decision and blocks repeated no-progress repair', async () => {
    const { deps } = createDeps({
      runTaskLoop: async () => taskLoop('blocked', ['missing tests']),
      reviewer: async () => review('repair', {
        missingEvidence: ['missing tests'],
        verificationGaps: ['missing tests'],
        repairBrief: 'add tests',
      }),
    });
    const created = createMission(
      {
        objective: 'Fix the flow',
        sessionKey: 'agent:main:session',
        maxTicks: 8,
        maxRepairTicks: 3,
      },
      {},
      deps,
    );

    const first = await tickMission({ missionId: created.missionId }, {}, deps);
    expect(first.status).toBe('sleeping');
    expect(first.phase).toBe('schedule');
    expect(first.repairTicks).toBe(1);

    const second = await tickMission({ missionId: created.missionId }, {}, deps);
    expect(second.status).toBe('blocked');
    expect(second.blockedReason).toMatch(/repeated/i);
  });

  it('blocks when max tick budget is exhausted before executing', async () => {
    const { deps } = createDeps({ reviewerDecision: 'sleep' });
    const created = createMission(
      {
        objective: 'Long goal',
        sessionKey: 'agent:main:session',
        maxTicks: 1,
      },
      {},
      deps,
    );
    await tickMission({ missionId: created.missionId }, {}, deps);
    const blocked = await tickMission({ missionId: created.missionId }, {}, deps);

    expect(blocked.status).toBe('blocked');
    expect(blocked.blockedReason).toMatch(/maximum tick/i);
  });

  it('pauses, resumes, and cancels non-terminal missions', () => {
    const { deps } = createDeps({ reviewerDecision: 'sleep' });
    const created = createMission(
      {
        objective: 'Scheduled goal',
        sessionKey: 'agent:main:session',
      },
      {},
      deps,
    );

    const paused = pauseMission(created.missionId, deps);
    expect(paused.status).toBe('paused');
    const resumed = resumeMission(created.missionId, deps);
    expect(resumed.status).toBe('sleeping');
    const cancelled = cancelMission(created.missionId, deps);
    expect(cancelled.status).toBe('cancelled');
  });
});
