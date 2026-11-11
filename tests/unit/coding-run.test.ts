import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectTaskLoopCodingRun } from '../../shared/types/coding-run';
import {
  createCodingRunView,
  parseCodingRunJsonl,
  resolveCodingRun,
  serializeCodingRunJsonl,
  summarizeCodingRunJsonl,
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
const cliRoots: string[] = [];
afterEach(() => { for (const root of cliRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function cli(input: string) {
  const root = mkdtempSync(join(tmpdir(), 'coding-run-cli-')); cliRoots.push(root);
  const file = join(root, 'export.jsonl'); writeFileSync(file, input);
  return spawnSync(process.execPath, ['scripts/coding-run-summary.mjs', file], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 20_000 });
}

function scopedRun(runId: string, runScope: RunScope = scope): ScopedRunId {
  return { runId: runId as ScopedRunId['runId'], scope: runScope };
}

function view(input: Partial<Parameters<typeof createCodingRunView>[0]> & { codingRunId: string }): CodingRunView {
  return createCodingRunView(input);
}

describe('CodingRun read-only contract', () => {
  it.each([
    ['complete', true, 'completed'], ['complete', false, 'unavailable'],
    ['cancelled', false, 'aborted'], ['aborted', false, 'aborted'], ['error', false, 'error'], ['blocked', false, 'unavailable'],
  ] as const)('runs the real CLI for Task Loop %s (gate=%s) without inventing completion', (status, gate, expected) => {
    const projection = projectTaskLoopCodingRun({ loopRunId: 'loop', phase: 'verify', status,
      ...(gate ? { evidenceGate: { status: 'pass' } } : {}), testsRun: ['pnpm test'] });
    const jsonl = serializeCodingRunJsonl(projection.codingRun, projection.events);
    expect(parseCodingRunJsonl(jsonl).status).toBe('ok');
    const result = cli(jsonl);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).finalStatus).toBe(expected);
    expect(projection.codingRun.completion?.completionAuthority).not.toBe('task-ledger');
  });

  it.each(['cross-run', 'empty-scope', 'numeric-run', 'bad-completion', 'bad-event', 'bad-iteration', 'bad-sequence', 'bad-version'])(
    'rejects %s in the actual CLI', (kind) => {
      const projection = projectTaskLoopCodingRun({ loopRunId: 'negative', phase: 'verify', status: 'complete', evidenceGate: { status: 'pass' } });
      const rows = serializeCodingRunJsonl(projection.codingRun, projection.events).split('\n').map((line) => JSON.parse(line));
      if (kind === 'cross-run') rows[2].payload.codingRunId = 'different-run';
      if (kind === 'empty-scope') rows[0].payload.scope = {};
      if (kind === 'numeric-run') rows[0].payload.runIds = [42];
      if (kind === 'bad-completion') rows[0].payload.completion.taskStatus = 'invented';
      if (kind === 'bad-event') rows[2].payload.status = 'invented';
      if (kind === 'bad-iteration') rows[1].payload.iteration = -1;
      if (kind === 'bad-sequence') rows[1].sequence = 9;
      if (kind === 'bad-version') rows[0].schema = 'coding-run/v2';
      const result = cli(rows.map((row) => JSON.stringify(row)).join('\n'));
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(JSON.parse(result.stderr)).toMatchObject({ status: 'error' });
    },
  );

  it('round-trips optional loop and run warnings when omitted', () => {
    const jsonl = serializeCodingRunJsonl(view({ codingRunId: 'optional' }), [
      { type: 'run', codingRunId: 'optional', event: 'projected', runIds: [] },
      { type: 'loop', codingRunId: 'optional', phase: 'verify', status: 'complete', iteration: null },
    ]);
    expect(parseCodingRunJsonl(jsonl).status).toBe('ok');
  });

  it('rejects another run verification before it can become a passed summary', () => {
    const jsonl = serializeCodingRunJsonl(view({ codingRunId: 'run-A' }), [
      { type: 'verification', codingRunId: 'run-B', status: 'passed', authority: 'task-loop-verification' },
    ]);
    expect(summarizeCodingRunJsonl(jsonl)).toMatchObject({ status: 'error', field: 'codingRunId' });
  });

  it.each([
    ['scope', {}], ['runIds', [42]], ['taskLedgerRootId', 42],
    ['completion', { turnStatus: 'completed', runStatus: 'completed', verification: 'passed', taskStatus: 'made-up', completionAuthority: 'task-ledger' }],
  ])('rejects invalid nested %s', (field, invalid) => {
    const record = JSON.parse(serializeCodingRunJsonl(view({ codingRunId: 'nested' })));
    record.payload[String(field)] = invalid;
    expect(parseCodingRunJsonl(JSON.stringify(record))).toMatchObject({ status: 'error' });
  });

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
  it('serializes display events as JSONL without adding persistence or inferred scope', () => {
    const codingRun = view({
      codingRunId: 'cr-jsonl',
      scope,
      runIds: [scopedRun('run-jsonl')],
      traceId: 'trace-jsonl',
    });
    const jsonl = serializeCodingRunJsonl(codingRun, [
      {
        type: 'loop',
        codingRunId: 'cr-jsonl',
        phase: 'verify',
        status: 'complete',
        iteration: 2,
      },
      {
        type: 'verification',
        codingRunId: 'cr-jsonl',
        status: 'passed',
        authority: 'task-loop-verification',
      },
    ]);
    const lines = jsonl.split('\n').map((line) => JSON.parse(line));

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ schema: 'coding-run/v1', sequence: 0, recordType: 'coding-run' });
    expect(lines[0].payload).toMatchObject({ codingRunId: 'cr-jsonl', traceId: 'trace-jsonl' });
    expect(lines[1]).toMatchObject({ sequence: 1, recordType: 'loop', payload: { phase: 'verify' } });
    expect(lines[2]).toMatchObject({ sequence: 2, recordType: 'verification', payload: { status: 'passed' } });
    expect(lines[0].payload.scope).toEqual(scope);
  });

  it('parses valid versioned JSONL and produces a stable CI summary', () => {
    const jsonl = serializeCodingRunJsonl(view({ codingRunId: 'cr-summary', scope }), [
      { type: 'test', codingRunId: 'cr-summary', command: 'pnpm test', status: 'passed' },
      { type: 'verification', codingRunId: 'cr-summary', status: 'passed', authority: 'task-loop-verification' },
    ]);

    expect(parseCodingRunJsonl(jsonl)).toMatchObject({ status: 'ok' });
    expect(summarizeCodingRunJsonl(jsonl)).toEqual({
      codingRunId: 'cr-summary',
      records: 3,
      turns: 0,
      approvals: 0,
      files: 0,
      tests: 1,
      verification: 'passed',
      finalStatus: null,
    });
  });

  it.each([
    ['missing field', 'coding-run/v1', '{"schema":"coding-run/v1","sequence":0,"recordType":"coding-run","payload":{"codingRunId":"cr"}}', 'MISSING_FIELD'],
    ['unknown field', 'coding-run/v1', '{"schema":"coding-run/v1","sequence":0,"recordType":"coding-run","payload":{"codingRunId":"cr","objective":null,"acceptanceContractRef":null,"sessionIds":[],"scope":null,"runIds":[],"attemptIds":[],"taskLedgerRootId":null,"traceId":null,"permissionEnvelopeRef":null,"contextFingerprint":null,"completion":null,"extra":true}}', 'UNKNOWN_FIELD'],
    ['unknown event field', 'coding-run/v1', '{"schema":"coding-run/v1","sequence":0,"recordType":"coding-run","payload":{"codingRunId":"cr","objective":null,"acceptanceContractRef":null,"sessionIds":[],"scope":null,"runIds":[],"attemptIds":[],"taskLedgerRootId":null,"traceId":null,"permissionEnvelopeRef":null,"contextFingerprint":null,"completion":null}}\n{"schema":"coding-run/v1","sequence":1,"recordType":"test","payload":{"type":"test","codingRunId":"cr","command":"pnpm test","status":"passed","extra":true}}', 'UNKNOWN_FIELD'],
    ['invalid schema', 'coding-run/v2', '{"schema":"coding-run/v2","sequence":0,"recordType":"coding-run","payload":{}}', 'INVALID_SCHEMA'],
  ] as const)('fails closed on %s', (_label, _schema, line, code) => {
    const result = parseCodingRunJsonl(line);
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.code).toBe(code);
  });

  it('fails closed when sequence order is wrong', () => {
    const valid = serializeCodingRunJsonl(view({ codingRunId: 'cr-sequence' }));
    const first = valid.split('\n')[0];
    const malformed = `${first.replace('"sequence":0', '"sequence":2')}\n${first}`;
    const result = parseCodingRunJsonl(malformed);
    expect(result).toMatchObject({ status: 'error', code: 'INVALID_SEQUENCE', line: 1 });
  });
});
