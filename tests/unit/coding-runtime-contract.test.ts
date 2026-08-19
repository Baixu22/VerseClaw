import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';

import {
  assertCodingAuditEvent,
  assertCodingMutation,
  assertFileVersion,
  isCodingAuditEvent,
  isCodingMutation,
  isFileVersion,
  parseCodingAuditEvent,
  parseCodingMutation,
  parseFileVersion,
  AuditQuerySchema,
  CodingAuditPageSchema,
  CodingRuntimeErrorSchema,
  CommitResultSchema,
  MutationPrepareOptionsSchema,
  PreparedMutationSchema,
  RollbackOptionsSchema,
  RollbackResultSchema,
  validateCodingAuditEvent,
  validateCodingMutation,
  validateFileVersion,
} from '@shared/coding-runtime/schema';
import {
  CODING_RUNTIME_EVENT_TYPES,
  CODING_RUNTIME_SCHEMA_VERSION,
  DEFAULT_CODING_RUNTIME_FLAGS,
  type CodingAuditEvent,
  type CodingExecEvent,
  type CodingMutation,
  type CodingMutationEvent,
  type CodingRollbackEvent,
  type FileVersion,
} from '@shared/coding-runtime/types';

const beforeVersion: FileVersion = {
  path: 'src/app.ts',
  contentHash: 'a'.repeat(64),
  mtimeMs: 1_700_000_000_000,
  size: 128,
};

const afterVersion: FileVersion = {
  ...beforeVersion,
  contentHash: 'b'.repeat(64),
  mtimeMs: beforeVersion.mtimeMs + 1,
  size: 132,
};

function mutationEvent(overrides: Partial<CodingMutationEvent> = {}): CodingMutationEvent {
  return {
    schemaVersion: CODING_RUNTIME_SCHEMA_VERSION,
    eventId: 'evt-mutation-1',
    eventType: CODING_RUNTIME_EVENT_TYPES.MUTATION,
    sessionId: 'session-1',
    requestId: 'request-1',
    toolName: 'write',
    timestamp: beforeVersion.mtimeMs + 2,
    path: 'src/app.ts',
    beforeHash: beforeVersion.contentHash,
    afterHash: afterVersion.contentHash,
    workspaceRoot: '/work/root',
    phase: 'committed',
    mutationId: 'mutation-1',
    batchId: 'batch-1',
    kind: 'write',
    mutation: { kind: 'write', path: 'src/app.ts', content: 'export const app = 1;\n' },
    hadPrior: true,
    bytesBefore: beforeVersion.size,
    bytesAfter: afterVersion.size,
    beforeVersion,
    afterVersion,
    ...overrides,
  };
}

function execEvent(overrides: Partial<CodingExecEvent> = {}): CodingExecEvent {
  return {
    schemaVersion: CODING_RUNTIME_SCHEMA_VERSION,
    eventId: 'evt-exec-1',
    eventType: CODING_RUNTIME_EVENT_TYPES.EXEC,
    sessionId: 'session-1',
    requestId: 'request-1',
    toolName: 'exec',
    timestamp: beforeVersion.mtimeMs + 10,
    path: '/work/root',
    beforeHash: 'c'.repeat(64),
    afterHash: 'd'.repeat(64),
    workspaceRoot: '/work/root',
    commandId: 'command-1',
    commandHash: 'e'.repeat(64),
    commandRedacted: 'pnpm test -- --run',
    cwd: '/work/root',
    shell: '/bin/sh',
    status: 'succeeded',
    approval: { decision: 'allow', policyId: 'ci-safe' },
    exitCode: 0,
    durationMs: 250,
    timeoutMs: 30_000,
    outputTruncated: false,
    sideEffects: [{
      path: 'src/app.test.ts',
      status: 'modified',
      beforeHash: 'f'.repeat(64),
      afterHash: 'a'.repeat(64),
      beforeVersion: { path: 'src/app.test.ts', contentHash: 'f'.repeat(64), mtimeMs: 1_700_000_000_000, size: 64 },
      afterVersion: { path: 'src/app.test.ts', contentHash: 'a'.repeat(64), mtimeMs: 1_700_000_000_010, size: 68 },
      bytesBefore: 64,
      bytesAfter: 68,
    }],
    ...overrides,
  };
}

function rollbackEvent(overrides: Partial<CodingRollbackEvent> = {}): CodingRollbackEvent {
  return {
    schemaVersion: CODING_RUNTIME_SCHEMA_VERSION,
    eventId: 'evt-rollback-1',
    eventType: CODING_RUNTIME_EVENT_TYPES.ROLLBACK,
    sessionId: 'session-1',
    requestId: 'request-1',
    toolName: 'rollback',
    timestamp: beforeVersion.mtimeMs + 20,
    path: '.',
    beforeHash: afterVersion.contentHash,
    afterHash: beforeVersion.contentHash,
    workspaceRoot: '/work/root',
    batchId: 'batch-1',
    rollbackId: 'rollback-1',
    status: 'rolled_back',
    preview: false,
    diff: '-export const app = 1;\n+export const app = 0;\n',
    files: [{
      path: 'src/app.ts',
      status: 'restored',
      beforeHash: afterVersion.contentHash,
      afterHash: beforeVersion.contentHash,
      beforeVersion: afterVersion,
      afterVersion: beforeVersion,
    }],
    ...overrides,
  };
}

describe('coding-runtime P0 contract', () => {
  it('validates FileVersion and rejects malformed versions', () => {
    expect(isFileVersion(beforeVersion)).toBe(true);
    expect(validateFileVersion(beforeVersion)).toEqual({ ok: true, errors: [] });
    expect(parseFileVersion(beforeVersion)).toEqual({ ok: true, value: beforeVersion });
    expect(() => assertFileVersion(beforeVersion)).not.toThrow();

    expect(isFileVersion({ ...beforeVersion, size: -1 })).toBe(false);
    expect(validateFileVersion({ ...beforeVersion, contentHash: '' }).ok).toBe(false);
    expect(() => assertFileVersion({ ...beforeVersion, mtimeMs: Number.NaN })).toThrow(
      /Invalid file version/,
    );
  });

  it('validates every normalized mutation kind', () => {
    const mutations: CodingMutation[] = [
      { kind: 'write', path: 'a.ts', content: 'x' },
      { kind: 'edit', path: 'a.ts', edits: [{ oldText: 'x', newText: 'y' }] },
      { kind: 'apply_patch', input: '*** Begin Patch\n*** End Patch' },
      { kind: 'delete', path: 'a.ts' },
      { kind: 'move', from: 'a.ts', to: 'b.ts' },
    ];

    for (const mutation of mutations) {
      expect(validateCodingMutation(mutation).ok).toBe(true);
      expect(isCodingMutation(mutation)).toBe(true);
      expect(parseCodingMutation(mutation)).toEqual({ ok: true, value: mutation });
      expect(() => assertCodingMutation(mutation)).not.toThrow();
    }

    expect(isCodingMutation({ kind: 'write', path: 'a.ts' })).toBe(false);
    expect(validateCodingMutation({ kind: 'edit', path: 'a.ts', edits: [] }).ok).toBe(false);
    expect(validateCodingMutation({ kind: 'unknown', path: 'a.ts' }).ok).toBe(false);
  });

  it('requires the P0 mutation audit fields on CodingMutationEvent', () => {
    const event = mutationEvent();
    expect(validateCodingAuditEvent(event)).toEqual({ ok: true, errors: [] });
    expect(isCodingAuditEvent(event)).toBe(true);
    expect(parseCodingAuditEvent(event)).toEqual({ ok: true, value: event });
    expect(() => assertCodingAuditEvent(event)).not.toThrow();

    const requiredFields = [
      'sessionId',
      'requestId',
      'toolName',
      'path',
      'beforeHash',
      'afterHash',
      'timestamp',
    ] as const;
    for (const field of requiredFields) {
      const { [field]: _removed, ...withoutField } = event;
      expect(validateCodingAuditEvent(withoutField).ok).toBe(false);
    }

    // Deleted files may legitimately have no after-content.
    expect(isCodingAuditEvent(mutationEvent({
      kind: 'delete',
      mutation: { kind: 'delete', path: 'src/app.ts' },
      hadPrior: true,
      bytesAfter: 0,
      afterHash: null,
      afterVersion: null,
    }))).toBe(true);

    // Unknown fields are not silently accepted into the audit contract.
    expect(isCodingAuditEvent({ ...event, rawContent: 'sensitive' })).toBe(false);
  });

  it('validates exec events and keeps raw command text out of the contract', () => {
    const event = execEvent();
    expect(isCodingAuditEvent(event)).toBe(true);

    expect(isCodingAuditEvent(execEvent({ status: 'failed', exitCode: 2 }))).toBe(true);
    expect(isCodingAuditEvent(execEvent({ status: 'denied', exitCode: null }))).toBe(true);
    expect(isCodingAuditEvent(execEvent({ status: 'not-a-status' } as unknown as Partial<CodingExecEvent>))).toBe(false);
    expect(isCodingAuditEvent({ ...event, command: 'rm -rf /' })).toBe(false);
  });

  it('validates rollback events including recovery_required', () => {
    expect(isCodingAuditEvent(rollbackEvent())).toBe(true);
    expect(isCodingAuditEvent(rollbackEvent({ preview: true }))).toBe(true);
    expect(isCodingAuditEvent(rollbackEvent({
      status: 'recovery_required',
      error: 'journal retained',
      files: [{ path: 'src/app.ts', status: 'restore_failed', beforeHash: null, afterHash: null }],
    }))).toBe(true);
    expect(isCodingAuditEvent(rollbackEvent({ status: 'prepared' } as unknown as Partial<CodingRollbackEvent>))).toBe(false);
  });

  it('discriminates the three event families through the unified audit union', () => {
    const events: CodingAuditEvent[] = [mutationEvent(), execEvent(), rollbackEvent()];
    for (const event of events) {
      expect(validateCodingAuditEvent(event)).toEqual({ ok: true, errors: [] });
    }

    const invalid = mutationEvent({ eventType: 'coding.unknown.v1' } as unknown as Partial<CodingMutationEvent>);
    expect(validateCodingAuditEvent(invalid).ok).toBe(false);
    expect(() => assertCodingAuditEvent(invalid)).toThrow(/Invalid coding audit event/);
  });

  it('validates the P0 transaction-service data contracts', () => {
    const prepared = {
      mutationId: 'mutation-1',
      batchId: 'batch-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      workspaceRoot: '/work/root',
      preparedAt: beforeVersion.mtimeMs,
      mutation: { kind: 'write', path: 'src/app.ts', content: 'x' },
      baseVersions: [beforeVersion],
      status: 'prepared',
    } as const;

    expect(Value.Check(MutationPrepareOptionsSchema, {
      sessionId: 'session-1',
      requestId: 'request-1',
      workspaceRoot: '/work/root',
      batchId: 'batch-1',
      baseVersion: beforeVersion,
    })).toBe(true);
    expect(Value.Check(PreparedMutationSchema, prepared)).toBe(true);
    expect(Value.Check(RollbackOptionsSchema, { preview: true })).toBe(true);

    const commit = {
      mutationId: prepared.mutationId,
      batchId: prepared.batchId,
      status: 'committed',
      files: [{
        path: 'src/app.ts',
        status: 'committed',
        beforeVersion,
        afterVersion,
      }],
      events: [mutationEvent()],
    } as const;
    expect(Value.Check(CommitResultSchema, commit)).toBe(true);
    expect(Value.Check(CommitResultSchema, {
      ...commit,
      status: 'recovery_required',
      error: 'journal retained',
      recoveryRef: 'journal#batch=batch-1&entries=write-journal:session-1:1',
    })).toBe(true);

    const rollback = {
      batchId: prepared.batchId,
      status: 'rolled_back',
      preview: false,
      diff: '',
      files: [],
      events: [rollbackEvent()],
    } as const;
    expect(Value.Check(RollbackResultSchema, rollback)).toBe(true);
    expect(Value.Check(RollbackResultSchema, {
      ...rollback,
      status: 'recovery_required',
      error: 'journal retained',
      recoveryRef: 'journal#batch=batch-1&entries=write-journal:session-1:1',
    })).toBe(true);

    expect(Value.Check(AuditQuerySchema, {
      fromMs: 1_700_000_000_000,
      toMs: 1_700_000_000_999,
      toolName: 'write',
      path: 'src/app.ts',
      limit: 25,
    })).toBe(true);
    expect(Value.Check(CodingAuditPageSchema, {
      items: [mutationEvent()],
      nextCursor: 'cursor-1',
    })).toBe(true);
    expect(Value.Check(CodingRuntimeErrorSchema, {
      code: 'E_CONFLICT',
      message: 'base version changed',
      path: 'src/app.ts',
      baseVersion: beforeVersion,
      currentVersion: afterVersion,
      diff: '-x\n+y\n',
    })).toBe(true);
  });

  it('keeps every UFTK capability default-off in the shared contract', () => {
    expect(CODING_RUNTIME_SCHEMA_VERSION).toBe(1);
    expect(CODING_RUNTIME_EVENT_TYPES.MUTATION).toBe('coding.mutation.v1');
    expect(CODING_RUNTIME_EVENT_TYPES.EXEC).toBe('coding.exec.v1');
    expect(CODING_RUNTIME_EVENT_TYPES.ROLLBACK).toBe('coding.rollback.v1');
    expect(Object.values(DEFAULT_CODING_RUNTIME_FLAGS)).toHaveLength(12);
    expect(Object.values(DEFAULT_CODING_RUNTIME_FLAGS).every((value) => value === false)).toBe(true);
    // P6B leaves must be present and default-off alongside the P1-P6A set.
    expect(DEFAULT_CODING_RUNTIME_FLAGS['runtime.coding.uftk.gitCheckpoint.pathScoped.enabled']).toBe(false);
    expect(DEFAULT_CODING_RUNTIME_FLAGS['runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled']).toBe(false);
    expect(DEFAULT_CODING_RUNTIME_FLAGS['runtime.coding.uftk.gitCheckpoint.lifecycle.enabled']).toBe(false);
    // P7 leaves: exec file side-effect undo and turn/long-task auto checkpoint.
    expect(DEFAULT_CODING_RUNTIME_FLAGS['runtime.coding.uftk.execUndo.enabled']).toBe(false);
    expect(DEFAULT_CODING_RUNTIME_FLAGS['runtime.coding.uftk.autoCheckpoint.enabled']).toBe(false);
  });

  it('accepts the P6B recovery_required error code', () => {
    expect(Value.Check(CodingRuntimeErrorSchema, {
      code: 'E_GIT_CHECKPOINT_RECOVERY_REQUIRED',
      message: 'restore left the workspace mid-apply; recover from recoveryRef',
    })).toBe(true);
  });
});
