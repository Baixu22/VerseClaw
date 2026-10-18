import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  completionView,
  displayCompletionStatus,
  isTaskLoopPassed,
  normalizeRunScope,
  normalizeTaskReference,
  resolveProjectIdForWorkspace,
  resolveWorkspaceIdForProject,
  type ProjectId,
  type RunId,
  type ScopedRunId,
  type SessionKey,
  type TaskId,
  type TaskIdentityReference,
  type WorkspaceId,
} from '@shared/product-semantics';

describe('identity and scope boundary', () => {
  it("does not let a completed label invent completion authority", () => {
    expect(displayCompletionStatus({ status: "completed" })).toBe("unavailable");
    expect(displayCompletionStatus({ status: "completed", authority: "turn" })).toBe("completed");
    expect(displayCompletionStatus({ status: "running" })).toBe("running");
  });

  it('keeps Chat final, Task Loop pass, and unavailable verification distinct', () => {
    const chat = completionView({ turnStatus: 'completed', runStatus: 'completed', authority: 'run' });
    expect(chat).toMatchObject({
      turnStatus: 'completed',
      runStatus: 'completed',
      verification: 'unavailable',
      taskStatus: 'unavailable',
      completionAuthority: 'run',
    });

    const noAuthority = completionView({ turnStatus: 'completed', runStatus: 'completed' });
    expect(noAuthority.turnStatus).toBe('unavailable');
    expect(noAuthority.runStatus).toBe('unavailable');
    expect(noAuthority.taskStatus).toBe('unavailable');
    expect(noAuthority.completionAuthority).toBeNull();

    const taskLoop = completionView({
      runStatus: 'completed',
      verification: 'passed',
      taskStatus: 'completed',
      authority: 'task-loop-verification',
    });
    expect(taskLoop).toMatchObject({
      runStatus: 'completed',
      verification: 'passed',
      taskStatus: 'completed',
      completionAuthority: 'task-loop-verification',
    });

    const noVerification = completionView({
      runStatus: 'completed',
      verification: 'unavailable',
      taskStatus: 'completed',
      authority: 'task-loop-verification',
    });
    expect(noVerification.verification).toBe('unavailable');
    expect(noVerification.taskStatus).toBe('unavailable');

    expect(isTaskLoopPassed({ status: 'complete', evidenceGate: { status: 'pass' } })).toBe(true);
    expect(isTaskLoopPassed({ status: 'complete', evidenceGate: { status: 'repair' } })).toBe(false);
    expect(isTaskLoopPassed({ status: 'blocked', evidenceGate: { status: 'pass' } })).toBe(false);
  });
  it('keeps identity brands distinct and requires scope at typed run boundaries', () => {
    // These assertions are checked by pnpm typecheck (tsconfig.test.json), not Vitest alone.
    expectTypeOf<WorkspaceId>().toExtend<string>();
    expectTypeOf<ProjectId>().not.toExtend<WorkspaceId>();
    expectTypeOf<WorkspaceId>().not.toExtend<ProjectId>();
    expectTypeOf<SessionKey>().not.toExtend<WorkspaceId>();
    expectTypeOf<SessionKey>().not.toExtend<RunId>();
    expectTypeOf<RunId>().not.toExtend<TaskId>();
    expectTypeOf<TaskId>().not.toExtend<RunId>();
    expectTypeOf<string>().not.toExtend<TaskId>();
    expectTypeOf<{ runId: RunId }>().not.toExtend<ScopedRunId>();
    expectTypeOf<{ workspaceKey: SessionKey }>().not.toExtend<{ workspaceKey: WorkspaceId }>();
    expectTypeOf<{ kind: 'runtime'; taskId: string }>().not.toExtend<TaskIdentityReference>();
  });

  it('centralizes a byte-preserving workspace/project compatibility mapping', () => {
    const workspaceId = 'existing-workspace-01' as WorkspaceId;
    const projectId = resolveProjectIdForWorkspace(workspaceId);
    expect(projectId).toBe(workspaceId);
    expect(resolveWorkspaceIdForProject(projectId, workspaceId)).toBe(workspaceId);
    expect(() => resolveWorkspaceIdForProject('another-project' as ProjectId, workspaceId))
      .toThrow(/does not match/);
  });

  it('normalizes an owner-resolved legacy workspace spelling without mutating its input', () => {
    const legacy = {
      runId: 'existing-run:01',
      scope: { workspaceKey: 'existing-workspace-01', sessionKey: 'agent:main:conversation' },
    };
    const stored = JSON.stringify(legacy);
    expect(normalizeRunScope(legacy)).toEqual({
      runId: legacy.runId,
      scope: {
        workspaceId: legacy.scope.workspaceKey,
        projectId: legacy.scope.workspaceKey,
        sessionKey: legacy.scope.sessionKey,
      },
    });
    expect(JSON.stringify(legacy)).toBe(stored);
  });

  it('keeps an explicit project association and every identifier byte unchanged', () => {
    const input = {
      runId: ' run-A ',
      scope: { workspaceId: 'workspace-A', projectId: 'project-B', sessionKey: 'conversation-C' },
    };
    expect(JSON.stringify(normalizeRunScope(input))).toBe(JSON.stringify(input));
  });

  it.each([
    { runId: 'run' },
    { runId: 'run', scope: null },
    { runId: 'run', scope: [] },
    { runId: 'run', scope: {} },
    { runId: 'run', scope: { sessionKey: 'session' } },
    { runId: 'run', scope: { sessionId: 'physical-session' } },
    { runId: 'run', scope: { projectId: 'project' } },
    { runId: 'run', scope: { workspaceId: '' } },
    { runId: 'run', scope: { workspaceKey: 42 } },
    { runId: ' ', scope: { workspaceId: 'workspace' } },
  ])('rejects a run without valid explicit workspace scope: %j', (input) => {
    expect(() => normalizeRunScope(input)).toThrow(TypeError);
  });

  it('rejects conflicting legacy and canonical workspace identities', () => {
    expect(() => normalizeRunScope({
      runId: 'run', scope: { workspaceId: 'one', workspaceKey: 'two' },
    })).toThrow(/Conflicting/);
    expect(normalizeRunScope({
      runId: 'run', scope: { workspaceId: 'one', workspaceKey: 'one' },
    }).scope.workspaceId).toBe('one');
  });

  it('keeps same-session attempts independent and never converts a physical sessionId', () => {
    const scope = { workspaceId: 'workspace', sessionKey: 'agent:main:conversation' };
    const first = normalizeRunScope({ runId: 'attempt-A', scope });
    const second = normalizeRunScope({ runId: 'attempt-B', scope });
    expect(first.runId).not.toBe(second.runId);
    expect(first.scope).toEqual(second.scope);
    expect(Object.keys(second).sort()).toEqual(['runId', 'scope']);
    expect(normalizeRunScope({
      runId: 'attempt-C', scope: { workspaceId: 'workspace', sessionId: 'physical' },
    }).scope).not.toHaveProperty('sessionKey');
  });

  it.each([
    ['ledger', 'taskNodeId'],
    ['runtime', 'runtimeTaskId'],
    ['browser', 'browserTaskId'],
    ['cron', 'cronRunId'],
    ['install', 'installTaskId'],
  ] as const)('requires the %s owner-specific task field', (kind, field) => {
    const reference = { kind, [field]: 'existing-id' };
    expect(normalizeTaskReference(reference)).toEqual(reference);
    expect(() => normalizeTaskReference({ kind, taskId: 'existing-id' }))
      .toThrow(/bare or mixed/);
    expect(() => normalizeTaskReference({ ...reference, taskId: 'ambiguous' }))
      .toThrow(/bare or mixed/);
    expect(() => normalizeTaskReference({ kind, [field]: '' })).toThrow(TypeError);
  });

  it.each([null, [], {}, { taskId: 'bare' }, { kind: 'toString' }, { kind: 'unknown' }])(
    'rejects a task reference without a declared owner: %j', (input) => {
      expect(() => normalizeTaskReference(input)).toThrow(TypeError);
    },
  );
});
