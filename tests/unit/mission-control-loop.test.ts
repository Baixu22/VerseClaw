import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    controlSignals: input.controlSignals,
    validationState: input.validationState,
    acceptanceStatus: input.acceptanceStatus,
    metadata: input.metadata,
    createdAt: new Date(input.createdAt as number).toISOString(),
  })),
  recordLongTaskCheckpoint: vi.fn(),
  listLongTaskCheckpoints: vi.fn(() => []),
}));

import {
  cancelMission,
  createMission,
  pauseMission,
  resumeMission,
  runMission,
  tickMission,
} from '../../openclaw_runtime/src/agents/mission-control/controller';
import { getMissionRun } from '../../openclaw_runtime/src/agents/mission-control/store';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { listLongTaskCheckpoints, type LongTaskCheckpointRecord } from '../../openclaw_runtime/src/agents/long-task-control/store';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw';

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
  } as unknown as TaskLoopRunResult;
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
  createKnowledgeInboxItem?: MissionControllerDeps['createKnowledgeInboxItem'];
}) {
  const store = new Map<string, MissionRunRecord>();
  let id = 0;
  let now = 1_000;
  const lifecycle: string[] = [];
  const lifecycleEvents: Array<Record<string, unknown>> = [];
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
    createKnowledgeInboxItem: params?.createKnowledgeInboxItem ?? vi.fn(),
    lifecycle: (event) => {
      lifecycle.push(`${event.phase}:${event.status}:${event.reviewerDecision ?? ''}`);
      lifecycleEvents.push(JSON.parse(JSON.stringify(event)) as Record<string, unknown>);
    },
  };
  return { deps, store, lifecycle, lifecycleEvents };
}

describe('Mission Control controller', () => {
  let stateRoot: string;
  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), 'mission-controller-test-'));
    vi.stubEnv('OPENCLAW_STATE_DIR', stateRoot);
  });
  afterEach(() => {
    closeOpenClawStateDatabase();
    vi.unstubAllEnvs();
    rmSync(stateRoot, { recursive: true, force: true });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listLongTaskCheckpoints).mockReturnValue([]);
  });

  describe.each([
    ['legacy', false], ['legacy', true], ['taskflow', false],
  ] as const)('SQLite owner with writer=%s fencing=%s', (writer, fencing) => {
    beforeEach(() => {
      vi.stubEnv('RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED', fencing ? '1' : '0');
      vi.stubEnv('OPENCLAW_MISSION_LIFECYCLE_WRITER', writer);
    });
    describe.each(['resolve', 'reject'] as const)('pending stage %s', (outcome) => {
      it.each([
        ['task-loop', 'paused'], ['task-loop', 'cancelled'], ['task-loop', 'sleeping'],
        ['reviewer', 'paused'], ['reviewer', 'cancelled'], ['reviewer', 'sleeping'],
      ] as const)('retains %s in-flight control %s', async (stage, status) => {
        let ready!: () => void; let release!: () => void;
        const entered = new Promise<void>(done => { ready = done; });
        const held = new Promise<void>(done => { release = done; });
        const waitForControl = async () => {
          ready(); await held;
          if (outcome === 'reject') throw new Error('In-flight stage failed after control');
        };
        const reviewer = vi.fn(async () => {
          if (stage === 'reviewer') await waitForControl();
          return review('complete', { memoryCandidates: [{ kind: 'role_memory', summary: 'Review evidence', evidenceRefs: ['trace-loop'] }] });
        });
        const original = createDeps({ reviewer, runTaskLoop: async () => {
          if (stage === 'task-loop') await waitForControl();
          return taskLoop();
        } });
        const deps = { ...original.deps, getMission: undefined, saveMission: undefined, getLatestMissionForSession: undefined };
        const created = createMission({ objective: 'Preserve accepted controls', sessionKey: 'agent:main:control-race' }, {}, deps);
        const running = tickMission({ missionId: created.missionId, reason: 'manual' }, {}, deps);
        await entered;
        let control = status === 'cancelled' ? cancelMission(created.missionId, deps) : pauseMission(created.missionId, deps);
        if (status === 'sleeping') control = resumeMission(created.missionId, deps);
        expect(control.status).toBe(status);
        const acceptedIndex = original.lifecycleEvents.length;
        release();
        const settled = await running;
        const stored = getMissionRun(created.missionId);
        expect(settled.status).toBe(status);
        expect(stored?.status).toBe(status);
        expect(stored?.completedAt).toBe(control.completedAt);
        expect(stored?.metadata?.controlRevision).toBe(control.metadata?.controlRevision);
        expect(stored?.activeTickId).toBeNull();
        expect(original.lifecycleEvents.slice(acceptedIndex).every(event => event.status === status)).toBe(true);
        if (stage === 'task-loop') expect(reviewer).not.toHaveBeenCalled();
        if (stage === 'reviewer' || outcome === 'resolve') {
          expect(stored?.taskLoopRunId).toBe('loop-1');
          expect(stored?.evidenceRefs).toContainEqual(expect.objectContaining({ ref: 'trace-loop' }));
        }
        expect(deps.proposeMemory).not.toHaveBeenCalled();
        expect(deps.storeTrace).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'aborted', endedAt: expect.any(Number) }), expect.anything());
      });
    });
  });

  it('keeps a newer SQLite owner tick intact when the resumed older tick returns', async () => {
    let ready!: () => void; let release!: () => void;
    const entered = new Promise<void>(done => { ready = done; });
    const held = new Promise<void>(done => { release = done; });
    let calls = 0;
    const original = createDeps({ runTaskLoop: async () => {
      const call = ++calls;
      if (call === 1) { ready(); await held; }
      return { ...taskLoop(), loopRunId: `loop-${call}`, traceId: `trace-${call}` };
    } });
    const deps = { ...original.deps, getMission: undefined, saveMission: undefined, getLatestMissionForSession: undefined };
    const created = createMission({ objective: 'Preserve the new tick', sessionKey: 'agent:main:new-tick' }, {}, deps);
    const running = tickMission({ missionId: created.missionId, reason: 'manual' }, {}, deps);
    await entered;
    pauseMission(created.missionId, deps);
    resumeMission(created.missionId, deps);
    const newer = await tickMission({ missionId: created.missionId, reason: 'manual' }, {}, deps);
    const stored = getMissionRun(created.missionId);
    release();
    const settled = await running;
    expect(newer).toMatchObject({ status: 'complete', tick: 2, taskLoopRunId: 'loop-2' });
    expect(settled).toMatchObject({ status: 'complete', tick: 2, taskLoopRunId: 'loop-2' });
    expect(getMissionRun(created.missionId)).toEqual(stored);
    expect(vi.mocked(deps.storeTrace!).mock.calls.map(([trace]) => trace.status)).toEqual(['completed', 'aborted']);
  });

  it.each([
    ['paused', 'resolve'], ['cancelled', 'resolve'],
    ['paused', 'reject'], ['cancelled', 'reject'],
  ] as const)('retains %s while rollback %s settles through the SQLite owner', async (status, outcome) => {
    vi.stubEnv('RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED', '0');
    vi.stubEnv('OPENCLAW_MISSION_LIFECYCLE_WRITER', 'legacy');
    let ready!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { ready = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const original = createDeps({ reviewer: async () => review('repair', { repairBrief: 'Restore the prior receipt' }) });
    const rollback: NonNullable<MissionControllerDeps['rollback']> = {
      loadCheckpoint: vi.fn(async () => ({ id: 'prior-control-checkpoint' })),
      validateCheckpoint: vi.fn(async () => ({ ok: true as const })),
      applyCheckpoint: vi.fn(async () => { ready(); await held; if (outcome === 'reject') throw new Error('Fixture restore failed'); }),
      replayEventLog: vi.fn(async () => ({ ok: false as const, reason: 'Pilot remains off' })),
      recordOutcome: vi.fn(),
    };
    const deps = { ...original.deps, getMission: undefined, saveMission: undefined, getLatestMissionForSession: undefined, rollback };
    const config: OpenClawConfig = {
      agents: { defaults: { missionLoop: { memory: { proposeAfterTick: false } } } },
      runtime: { mission: { rollback: { enabled: true } } },
    };
    const created = createMission({ objective: 'Preserve rollback control', sessionKey: `agent:main:rollback-${status}-${outcome}` }, config, deps);
    const first = await tickMission({ missionId: created.missionId, reason: 'manual' }, config, deps);
    expect(first.status).toBe('sleeping');
    const checkpoint: LongTaskCheckpointRecord = {
      id: 'prior-control-checkpoint', sessionKey: created.sessionKey, trigger: 'guide', status: 'repair',
      checkpoint: { schemaVersion: 1, id: 'prior-control-checkpoint', sessionKey: created.sessionKey, trigger: 'guide',
        openBlockers: [], decisions: [], deviations: [], filesTouched: [], testsRun: [], reviewNeededItems: [], evidenceRefs: [], createdAt: '2026-11-21T00:00:00.000Z' },
      createdAt: 1, updatedAt: 1,
    };
    vi.mocked(listLongTaskCheckpoints).mockReturnValue([{ ...checkpoint, id: 'current-control-checkpoint' }, checkpoint]);
    const running = tickMission({ missionId: created.missionId, reason: 'manual' }, config, deps);
    await entered;
    const control = status === 'paused' ? pauseMission(created.missionId, deps) : cancelMission(created.missionId, deps);
    const acceptedIndex = original.lifecycleEvents.length;
    release();
    const settled = await running;
    expect(settled.status).toBe(status);
    expect(getMissionRun(created.missionId)).toMatchObject({ status, traceId: settled.traceId });
    expect(getMissionRun(created.missionId)?.completedAt).toBe(control.completedAt);
    expect(original.lifecycleEvents.slice(acceptedIndex).every(event => event.status === status)).toBe(true);
    expect(rollback.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({ ok: outcome === 'resolve' }));
    expect(rollback.replayEventLog).not.toHaveBeenCalled();
    expect(vi.mocked(deps.storeTrace!).mock.calls.map(([trace]) => trace.status)).toEqual(['completed', 'aborted']);
    expect(deps.proposeMemory).not.toHaveBeenCalled();
  });

  it('creates and completes a mission through one tick', async () => {
    let innerRequest: Parameters<NonNullable<MissionControllerDeps['runTaskLoop']>>[0] | undefined;
    const { deps, lifecycle } = createDeps({ reviewerDecision: 'complete', runTaskLoop: async (request) => {
      innerRequest = request;
      return taskLoop();
    } });
    const mission = await runMission(
      {
        objective: 'Ship Mission Control',
        sessionKey: 'agent:main:session',
        acceptance: ['tests pass'],
        maxWorkers: 1,
        includeVerifier: false,
      },
      {},
      deps,
    );

    expect(mission.status).toBe('complete');
    expect(mission.phase).toBe('complete');
    expect(mission.tick).toBe(1);
    expect(mission.taskLoopRunId).toBe('loop-1');
    expect(innerRequest).toMatchObject({ maxWorkers: 1, includeVerifier: false });
    expect(mission.ticks[0]?.reviewer?.decision).toBe('complete');
    expect(lifecycle).toContain('complete:complete:complete');
  });

  it('reuses the original Mission ledger event across ticks without minting a child root', async () => {
    const { readLongTaskLedgerRevision, ensureLongTaskLedgerRoot } = await import('../../openclaw_runtime/src/agents/long-task-control/task-ledger');
    const checked: string[] = [];
    const { deps } = createDeps({ runTaskLoop: async (request, _cfg, child = {}) => {
      const root = request.taskLedgerRootId!;
      const input = { taskLedgerRootId: root, sessionKey: request.sessionKey, workspaceId: request.workspaceId,
        runId: `child-${checked.length}`, title: request.task, source: 'task_loop' as const };
      const read = () => readLongTaskLedgerRevision(input);
      const prior = read(); expect(prior?.eventCount).toBeGreaterThan(0);
      expect(await (child.ensureTaskLedgerRoot ?? ensureLongTaskLedgerRoot)(input)).toBe(root);
      expect(read()).toEqual(prior); checked.push(root);
      return taskLoop();
    }, reviewer: async () => review(checked.length === 1 ? 'sleep' : 'complete') });
    const first = await runMission({ objective: 'Check the ledger receipt', sessionKey: 'agent:main:ledger-reuse' }, {}, deps);
    expect(first.status, first.blockedReason).toBe('sleeping');
    const second = await tickMission({ missionId: first.missionId, reason: 'manual' }, {}, deps);
    expect(second.status, second.blockedReason).toBe('complete');
    expect(checked).toEqual([first.metadata?.taskLedgerRootId, first.metadata?.taskLedgerRootId]);
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

  it('persists reviewer control signals through mission state, lifecycle, and checkpoint records', async () => {
    const { recordLongTaskCheckpoint } = await import('../../openclaw_runtime/src/agents/long-task-control/store');
    const { deps, lifecycleEvents } = createDeps({
      reviewer: async () => review('repair', {
        missingEvidence: ['missing test evidence'],
        verificationGaps: ['unit test not run'],
        repairBrief: 'run tests',
        controlSignals: [{
          kind: 'validation_missing',
          severity: 'warning',
          message: 'unit test not run',
          suggestedAction: 'verify',
          source: 'mission.reviewer',
        }],
        validationState: {
          status: 'missing',
          checks: ['unit test not run'],
          evidenceRefs: [],
        },
        acceptanceStatus: {
          status: 'partial',
          criteria: ['tests pass'],
          gaps: ['unit test not run'],
        },
      }),
    });

    const created = createMission(
      {
        objective: 'Fix the flow',
        sessionKey: 'agent:main:session',
        acceptance: ['tests pass'],
      },
      {},
      deps,
    );
    const ticked = await tickMission({ missionId: created.missionId }, {}, deps);

    expect(ticked.controlSignals?.[0]).toMatchObject({ kind: 'validation_missing' });
    expect(ticked.validationState).toMatchObject({ status: 'missing' });
    expect(ticked.acceptanceStatus).toMatchObject({ status: 'partial' });
    expect(ticked.ticks[0]?.controlSignals?.[0]).toMatchObject({ kind: 'validation_missing' });
    expect(lifecycleEvents.some((event) => Array.isArray(event.controlSignals))).toBe(true);
    expect(recordLongTaskCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      controlSignals: expect.arrayContaining([expect.objectContaining({ kind: 'validation_missing' })]),
      validationState: expect.objectContaining({ status: 'missing' }),
      acceptanceStatus: expect.objectContaining({ status: 'partial' }),
    }));
  });

  it('does not complete when an injected reviewer leaves validation missing', async () => {
    const { deps } = createDeps({
      reviewer: async () => review('complete', {
        controlSignals: [{
          kind: 'validation_missing',
          severity: 'blocking',
          message: 'validation did not run',
          suggestedAction: 'verify',
          source: 'mission.reviewer',
        }],
        validationState: {
          status: 'missing',
          checks: [],
          evidenceRefs: [],
        },
      }),
    });
    const mission = await runMission(
      {
        objective: 'Ship Mission Control',
        sessionKey: 'agent:main:session',
        acceptance: ['tests pass'],
      },
      {},
      deps,
    );

    expect(mission.status).not.toBe('complete');
    expect(mission.lastDecision).toBe('repair');
    expect(mission.remaining).toContain('Mission validation or acceptance evidence is missing.');
  });

  it('creates a pending Knowledge Inbox item for mission knowledge draft candidates', async () => {
    const createKnowledgeInboxItem = vi.fn();
    const { deps } = createDeps({
      createKnowledgeInboxItem,
      reviewer: async () => review('complete', {
        validationState: {
          status: 'passed',
          checks: ['unit tests'],
          evidenceRefs: [{ type: 'trace', ref: 'trace-loop' }],
        },
        memoryCandidates: [{
          kind: 'knowledge_draft',
          summary: 'Workflow lesson: verify Mission evidence before applying knowledge.',
          evidenceRefs: ['trace-loop'],
        }],
      }),
    });

    const mission = await runMission(
      {
        objective: 'Capture reusable Mission knowledge',
        sessionKey: 'agent:main:session',
        acceptance: ['tests pass'],
      },
      {},
      deps,
    );

    expect(mission.status).toBe('complete');
    expect(createKnowledgeInboxItem).toHaveBeenCalledTimes(1);
    expect(createKnowledgeInboxItem).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Workflow lesson: verify Mission evidence before applying knowledge.',
      body: 'Workflow lesson: verify Mission evidence before applying knowledge.',
      kind: 'task-ledger',
      status: 'pending',
      createdBy: 'agent',
      tags: expect.arrayContaining(['mission-control', 'knowledge-interaction-mvp']),
      sourceRefs: expect.arrayContaining([
        expect.objectContaining({ id: 'trace:trace-loop', kind: 'trace' }),
        expect.objectContaining({ id: 'task_loop:loop-1', kind: 'task_loop' }),
        expect.objectContaining({ kind: 'task_ledger' }),
      ]),
      metadata: expect.objectContaining({
        mvpVersion: 'knowledge-interaction-mvp-1',
        recommendation: 'save',
        missionId: mission.missionId,
        tick: 1,
        outcome: 'complete',
        evidenceRefs: expect.arrayContaining(['trace:trace-loop']),
        captureKey: expect.stringMatching(/^mission:mission-1:tick:1:knowledge:[a-f0-9]{16}$/),
      }),
    }));
    expect(createKnowledgeInboxItem.mock.calls[0]?.[0].metadata.score.overall).toBeGreaterThan(0);
  });

  it('keeps role memory candidates on the existing memory proposal path', async () => {
    const createKnowledgeInboxItem = vi.fn();
    const { deps } = createDeps({
      createKnowledgeInboxItem,
      reviewer: async () => review('complete', {
        memoryCandidates: [{
          kind: 'role_memory',
          summary: 'Remember that Mission Control evidence should stay review-gated.',
          evidenceRefs: ['trace-loop'],
        }],
      }),
    });

    await runMission(
      {
        objective: 'Keep role memory behavior',
        sessionKey: 'agent:main:session',
        acceptance: ['tests pass'],
      },
      {},
      deps,
    );

    expect(deps.proposeMemory).toHaveBeenCalledTimes(1);
    expect(deps.proposeMemory).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Remember that Mission Control evidence should stay review-gated.',
      scope: 'session', scopeKey: 'agent:main:session', expiresAt: expect.any(String),
    }), expect.anything());
    expect(createKnowledgeInboxItem).not.toHaveBeenCalled();
  });

  it('does not send knowledge draft candidates to role memory proposals', async () => {
    const createKnowledgeInboxItem = vi.fn();
    const { deps } = createDeps({
      createKnowledgeInboxItem,
      reviewer: async () => review('complete', {
        memoryCandidates: [{
          kind: 'knowledge_draft',
          summary: 'Decision: keep Mission knowledge drafts in the Knowledge Inbox.',
          evidenceRefs: ['trace-loop'],
        }],
      }),
    });

    await runMission(
      {
        objective: 'Separate knowledge candidates from role memory',
        sessionKey: 'agent:main:session',
        acceptance: ['tests pass'],
      },
      {},
      deps,
    );

    expect(deps.proposeMemory).not.toHaveBeenCalled();
    expect(createKnowledgeInboxItem).toHaveBeenCalledTimes(1);
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

  it('extracts explicit remember statements into role memory proposals (P1-3)', async () => {
    const { deps } = createDeps({
      reviewer: async () => review('complete', {
        memoryCandidates: [],
        reason: 'Remember to verify Mission evidence before reuse.',
      }),
    });

    await runMission(
      {
        objective: 'Capture durable guidance',
        sessionKey: 'agent:main:session',
        acceptance: ['tests pass'],
      },
      {},
      deps,
    );

    // The reviewer reason contains an explicit "Remember" statement, so the
    // extractor path must produce exactly one role-memory proposal beyond any
    // reviewer role_memory candidates (none here). The extractor strips the
    // leading "remember" keyword from the stored content.
    expect(deps.proposeMemory).toHaveBeenCalledTimes(1);
    expect(deps.proposeMemory).toHaveBeenCalledWith(expect.objectContaining({
      content: 'to verify Mission evidence before reuse.',
      source: 'trace',
      scope: 'session', scopeKey: 'agent:main:session',
    }), expect.anything());
  });

  it('does not extract when reviewer text lacks remember patterns (P1-3)', async () => {
    const { deps } = createDeps({
      reviewer: async () => review('complete', {
        memoryCandidates: [],
        reason: 'The evidence satisfies the acceptance criteria.',
      }),
    });

    await runMission(
      {
        objective: 'No explicit memory guidance',
        sessionKey: 'agent:main:session',
        acceptance: ['tests pass'],
      },
      {},
      deps,
    );

    // No "remember"-style statement: the extractor gate must stay closed and
    // the plain reviewer reason must not become a role-memory proposal.
    expect(deps.proposeMemory).not.toHaveBeenCalled();
  });
});
