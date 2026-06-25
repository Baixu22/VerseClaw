import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearTaskLoopRunsForTests,
  runTaskLoop,
  type TaskLoopControllerDeps,
} from '../../openclaw_runtime/src/agents/task-loop-controller';
import {
  isRuntimeTaskEvent,
  RuntimeTaskEventLogStore,
  type RuntimeTaskEvent,
} from '../../openclaw_runtime/src/runtime-core';

function fakeResult() {
  const workers = [
    { roleName: 'implementer', task: 'implement' },
    { roleName: 'tester', task: 'test' },
    { roleName: 'reviewer', task: 'review' },
  ];
  return {
    plan: {
      mode: 'lead-workers',
      leadRole: 'planner',
      templateId: 'quick-development',
      verifierRole: 'reviewer',
      reasons: ['template:quick-development'],
      workers,
    },
    outcomes: workers.map((worker, index) => ({
      roleName: worker.roleName,
      task: worker.task,
      isVerifier: false,
      spawn: { status: 'accepted', result: { runId: `run_${index}`, childSessionKey: `child_${index}` } },
    })),
    spawnedRunIds: ['run_0', 'run_1', 'run_2'],
    expectedWorkerRunIds: ['run_0', 'run_1', 'run_2'],
    pendingVerifier: true,
    failures: [],
  };
}

function getEvidenceRun(runId?: string, childSessionKey?: string) {
  if (!runId || !childSessionKey) return null;
  return {
    runId,
    childSessionKey,
    requesterSessionKey: 'agent:main:abc',
    requesterDisplayKey: 'Main',
    task: 'task',
    cleanup: 'delete',
    createdAt: 1,
    endedAt: 2,
    outcome: { status: 'ok' },
    completion: {
      required: true,
      capturedAt: 2,
      resultText: [
        '## Summary',
        `Completed ${runId} with evidence.`,
        '',
        '## Files Touched',
        `src/${runId}.ts`,
        '',
        '## Tests Run',
        `pnpm exec vitest run ${runId}.test.ts passed`,
      ].join('\n'),
    },
  };
}

function successfulSelfCheck() {
  return {
    decision: 'complete',
    confidence: 0.9,
    missingEvidence: [],
    verificationGaps: [],
    risks: [],
    validationState: { status: 'passed', checks: ['unit tests'], evidenceRefs: [] },
    contextSummary: 'done',
  };
}

function baseDeps(loopSuffix: string): TaskLoopControllerDeps {
  return {
    idFactory: (prefix) => `${prefix}_${loopSuffix}`,
    now: () => 1_700_000_000_000,
    ensureTaskLedgerRoot: vi.fn(() => `tlroot_${loopSuffix}`),
    runObserved: (async () => fakeResult()) as never,
    selfCheck: (async () => successfulSelfCheck()) as never,
    getSubagentRun: getEvidenceRun as never,
    recordCheckpoint: vi.fn() as never,
    storeTrace: vi.fn() as never,
  };
}

afterEach(() => {
  clearTaskLoopRunsForTests();
});

describe('TaskLoop RuntimeTaskEvent event-log dual-write shadow', () => {
  it('does not write the event log unless both TaskLoop shadow and Phase-4 event-log flags are enabled', async () => {
    const taskShadowOnlyWriter = vi.fn();
    const taskShadowOnlyShadows: RuntimeTaskEvent[] = [];
    const taskShadowOnly = await runTaskLoop(
      { task: 'implement feature', sessionKey: 'agent:main:abc', workspaceId: 'workspace-a' },
      { agents: { defaults: { taskLoop: { runtimeTaskEventLogShadow: true } } } },
      {
        ...baseDeps('event_log_phase4_off'),
        runtimeTaskEventShadowSink: (event) => taskShadowOnlyShadows.push(event),
        runtimeTaskEventLogWriter: taskShadowOnlyWriter,
      },
    );

    expect(taskShadowOnly).toMatchObject({ status: 'complete', phase: 'complete' });
    expect(taskShadowOnlyShadows.length).toBeGreaterThan(0);
    expect(taskShadowOnlyShadows.every(isRuntimeTaskEvent)).toBe(true);
    expect(taskShadowOnlyWriter).not.toHaveBeenCalled();

    const phase4OnlyWriter = vi.fn();
    const phase4Only = await runTaskLoop(
      { task: 'implement feature', sessionKey: 'agent:main:abc', workspaceId: 'workspace-a' },
      { runtime: { eventLog: { shadow: true } } },
      {
        ...baseDeps('event_log_task_shadow_off'),
        runtimeTaskEventLogWriter: phase4OnlyWriter,
      },
    );

    expect(phase4Only).toMatchObject({ status: 'complete', phase: 'complete' });
    expect(phase4OnlyWriter).not.toHaveBeenCalled();
  });

  it('dual-writes lifecycle and checkpoint RuntimeTaskEvent shadows to the Lane A event-log writer when flags are on', async () => {
    const store = new RuntimeTaskEventLogStore();
    const shadows: RuntimeTaskEvent[] = [];

    const result = await runTaskLoop(
      { task: 'implement feature', sessionKey: 'agent:main:abc', workspaceId: 'workspace-a' },
      {
        runtime: { eventLog: { shadow: true } },
        agents: { defaults: { taskLoop: { runtimeTaskEventLogShadow: true } } },
      },
      {
        ...baseDeps('event_log_dual_write'),
        runtimeTaskEventShadowSink: (event) => shadows.push(event),
        runtimeTaskEventLogWriter: (event) => store.append(event),
      },
    );

    const written = store.search({ taskId: result.loopRunId }).records.map((record) => record.event);
    expect(result).toMatchObject({ loopRunId: 'loop_event_log_dual_write', status: 'complete', phase: 'complete' });
    expect(written.length).toBe(shadows.length);
    expect(written.every(isRuntimeTaskEvent)).toBe(true);
    expect(written.map((event) => event.kind)).toEqual(expect.arrayContaining([
      'created',
      'planning',
      'running',
      'verifying',
      'completed',
      'checkpoint',
    ]));
    expect(written).toContainEqual(expect.objectContaining({
      kind: 'checkpoint',
      taskId: 'loop_event_log_dual_write',
      payload: {
        checkpoint: expect.objectContaining({
          checkpointId: 'task-loop:loop_event_log_dual_write:iteration:1:complete',
          taskId: 'loop_event_log_dual_write',
          state: 'completed',
        }),
      },
    }));
  });

  it('swallows event-log writer failures without changing complete, blocked, or error outcomes', async () => {
    const failingWriter = vi.fn(() => {
      throw new Error('event log unavailable');
    });

    const complete = await runTaskLoop(
      { task: 'implement feature', sessionKey: 'agent:main:abc' },
      {
        runtime: { eventLog: { shadow: true } },
        agents: { defaults: { taskLoop: { runtimeTaskEventLogShadow: true } } },
      },
      {
        ...baseDeps('event_log_writer_complete'),
        runtimeTaskEventLogWriter: failingWriter,
      },
    );
    expect(complete).toMatchObject({ status: 'complete', phase: 'complete' });

    const blocked = await runTaskLoop(
      { task: 'verify release', sessionKey: 'agent:main:abc' },
      {
        runtime: { eventLog: { shadow: true } },
        agents: { defaults: { taskLoop: { maxIterations: 1, maxRepairIterations: 0, runtimeCoreShadow: true } } },
      },
      {
        ...baseDeps('event_log_writer_blocked'),
        selfCheck: (async () => ({
          decision: 'blocked',
          confidence: 0.4,
          missingEvidence: ['manual verification'],
          verificationGaps: ['manual verification'],
          risks: [],
          contextSummary: 'blocked by reviewer',
        })) as never,
        runtimeTaskEventLogWriter: failingWriter,
      },
    );
    expect(blocked).toMatchObject({ status: 'blocked', phase: 'blocked' });

    const error = await runTaskLoop(
      { task: 'fail loudly', sessionKey: 'agent:main:abc' },
      {
        runtime: { eventLog: { shadow: true } },
        agents: { defaults: { taskLoop: { runtimeTaskEventLogShadow: true } } },
      },
      {
        ...baseDeps('event_log_writer_error'),
        runObserved: (async () => {
          throw new Error('orchestrator exploded');
        }) as never,
        selfCheck: vi.fn() as never,
        runtimeTaskEventLogWriter: failingWriter,
      },
    );
    expect(error).toMatchObject({ status: 'error', phase: 'error', error: 'orchestrator exploded' });
    expect(failingWriter).toHaveBeenCalled();
  });

  it('keeps legacy lifecycle callback objects free of event-log metadata when dual-write is enabled', async () => {
    const lifecycle: unknown[] = [];

    const result = await runTaskLoop(
      { task: 'implement feature', sessionKey: 'agent:main:abc', workspaceId: 'workspace-a' },
      {
        runtime: { eventLog: { shadow: true } },
        agents: { defaults: { taskLoop: { runtimeTaskEventLogShadow: true } } },
      },
      {
        ...baseDeps('event_log_lifecycle_clean'),
        lifecycle: (event) => lifecycle.push(event),
        runtimeTaskEventLogWriter: vi.fn(),
      },
    );

    expect(result).toMatchObject({ status: 'complete', phase: 'complete' });
    expect(lifecycle.length).toBeGreaterThan(0);
    expect(lifecycle.at(-1)).toMatchObject({
      loopRunId: 'loop_event_log_lifecycle_clean',
      phase: 'complete',
      status: 'complete',
      selfCheckDecision: 'complete',
    });
    expect(lifecycle.at(-1)).not.toHaveProperty('runtimeTaskEvent');
    expect(lifecycle.at(-1)).not.toHaveProperty('runtimeTaskEventLog');
    expect(JSON.stringify(lifecycle)).not.toContain('eventLog');
  });

  it('keeps persisted checkpoint input free of event-log-only fields when dual-write is enabled', async () => {
    const checkpoints: unknown[] = [];

    const result = await runTaskLoop(
      { task: 'implement feature', sessionKey: 'agent:main:abc', workspaceId: 'workspace-a' },
      {
        runtime: { eventLog: { shadow: true } },
        agents: { defaults: { taskLoop: { runtimeTaskEventLogShadow: true } } },
      },
      {
        ...baseDeps('event_log_checkpoint_clean'),
        recordCheckpoint: ((input: unknown) => checkpoints.push(input)) as never,
        runtimeTaskEventLogWriter: vi.fn(),
      },
    );

    const checkpointInput = checkpoints.at(-1) as { checkpoint?: { metadata?: Record<string, unknown> } } | undefined;
    expect(result).toMatchObject({ status: 'complete', phase: 'complete' });
    expect(checkpointInput).toMatchObject({
      id: 'task-loop:loop_event_log_checkpoint_clean:iteration:1:complete',
      sessionKey: 'agent:main:abc',
      workspaceId: 'workspace-a',
      taskLedgerRootId: 'tlroot_event_log_checkpoint_clean',
      runId: 'loop_event_log_checkpoint_clean',
      checkpoint: expect.objectContaining({
        id: 'task-loop:loop_event_log_checkpoint_clean:iteration:1:complete',
        metadata: expect.objectContaining({
          loopRunId: 'loop_event_log_checkpoint_clean',
          phase: 'complete',
          status: 'complete',
        }),
      }),
    });
    expect(JSON.stringify(checkpointInput)).not.toContain('eventLog');
    expect(JSON.stringify(checkpointInput)).not.toContain('runtimeTaskEvent');
  });
});
