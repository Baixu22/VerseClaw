import { describe, expect, it } from 'vitest';
import {
  createCodingRunView,
  resolveCodingRun,
  type CodingRunView,
  type RunScope,
  type ScopedRunId,
  type SessionKey,
  type TaskId,
  type WorkspaceId,
} from '@shared/product-semantics';

const workspaceId = 'workspace-a' as WorkspaceId;
const projectId = 'workspace-a' as RunScope['projectId'];
const sessionKey = 'session-a' as SessionKey;
const secondSessionKey = 'session-b' as SessionKey;
const taskId = 'task-root-a' as TaskId;
const scope: RunScope = { workspaceId, projectId, sessionKey };

function scopedRun(runId: string, runScope: RunScope = scope): ScopedRunId {
  return { runId: runId as ScopedRunId['runId'], scope: runScope };
}

function view(input: Partial<Parameters<typeof createCodingRunView>[0]> & { codingRunId: string }): CodingRunView {
  return createCodingRunView(input);
}

describe('CodingRun read-only contract', () => {
  it('keeps every optional association null or empty when the owner has not supplied it', () => {
    const codingRun = view({ codingRunId: 'cr-1' });

    expect(codingRun).toMatchObject({
      codingRunId: 'cr-1',
      objective: null,
      acceptanceContractRef: null,
      sessionIds: [],
      scope: null,
      runIds: [],
      attemptIds: [],
      taskLedgerRootId: null,
      traceId: null,
      permissionEnvelopeRef: null,
      contextFingerprint: null,
      completion: null,
    });
  });

  it('resolves a CodingRun by its stable ID without inventing a second state machine', () => {
    const codingRun = view({
      codingRunId: 'cr-1',
      objective: 'Ship the bounded node',
      sessionIds: [sessionKey],
      scope,
      runIds: [scopedRun('run-1')],
      attemptIds: ['attempt-1'],
      taskLedgerRootId: taskId,
      traceId: 'trace-1',
    });

    expect(resolveCodingRun({
      relation: { kind: 'coding-run', codingRunId: 'cr-1' },
      codingRuns: [codingRun],
    })).toEqual({ status: 'resolved', codingRun });
  });

  it('reports a missing CodingRun ID rather than creating a placeholder', () => {
    expect(resolveCodingRun({
      relation: { kind: 'coding-run', codingRunId: 'cr-missing' },
      codingRuns: [view({ codingRunId: 'cr-1' })],
    })).toMatchObject({ status: 'missing', codingRunId: 'cr-missing' });
  });

  it('reports an unknown relation rather than inferring lineage from a session', () => {
    const codingRun = view({ codingRunId: 'cr-1', sessionIds: [sessionKey] });

    expect(resolveCodingRun({
      relation: { kind: 'session', sessionKey: secondSessionKey },
      codingRuns: [codingRun],
    })).toMatchObject({
      status: 'unknown',
      relation: { kind: 'session', sessionKey: secondSessionKey },
    });
    expect(codingRun.scope).toBeNull();
  });

  it('reports multiple CodingRuns when one owner-supplied run ID is shared', () => {
    const first = view({ codingRunId: 'cr-1', runIds: [scopedRun('run-shared')] });
    const second = view({ codingRunId: 'cr-2', runIds: [scopedRun('run-shared')] });

    expect(resolveCodingRun({
      relation: { kind: 'run', runId: 'run-shared' as ScopedRunId['runId'] },
      codingRuns: [first, second],
    })).toEqual({
      status: 'multiple',
      relation: { kind: 'run', runId: 'run-shared' },
      codingRunIds: ['cr-1', 'cr-2'],
      message: 'Relation points to more than one CodingRun',
    });
  });

  it('reports a duplicate CodingRun ID as a conflict', () => {
    const first = view({ codingRunId: 'cr-1' });
    const second = view({ codingRunId: 'cr-1', traceId: 'trace-2' });

    expect(resolveCodingRun({
      relation: { kind: 'coding-run', codingRunId: 'cr-1' },
      codingRuns: [first, second],
    })).toEqual({
      status: 'conflict',
      codingRunId: 'cr-1',
      message: 'Multiple CodingRun records share one ID',
      conflictingCodingRunIds: ['cr-1', 'cr-1'],
    });
  });

  it('rejects malformed associations instead of normalizing them into a guessed scope', () => {
    expect(() => createCodingRunView({
      codingRunId: 'cr-1',
      sessionIds: [sessionKey, sessionKey],
    })).toThrow('duplicate sessionIds');

    expect(() => createCodingRunView({
      codingRunId: 'cr-1',
      runIds: [scopedRun('run-1', { ...scope, workspaceId: '   ' as WorkspaceId })],
    })).toThrow('runIds[0].scope.workspaceId');
  });
});
