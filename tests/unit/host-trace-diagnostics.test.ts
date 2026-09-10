import { describe, expect, it, vi } from 'vitest';

import {
  createHostTraceDiagnosticsService,
  MAX_HOST_TRACE_DIAGNOSTICS_RECORDS,
  type HostTraceDiagnosticsEvidence,
} from '@electron/services/host-trace-diagnostics';
import type { PermissionApprovalEvent } from '@shared/types/workspace';

const SECRET = new Uint8Array(32).fill(11);

function approval(overrides: Partial<PermissionApprovalEvent> = {}): PermissionApprovalEvent {
  return {
    id: 'approval-1',
    workspaceId: 'workspace-1',
    sessionKey: 'agent:main:main',
    runId: 'run-1',
    mode: 'acceptEdits',
    source: 'terminal',
    requestedAt: 1,
    resolvedAt: 2,
    status: 'approved',
    risk: 'dangerous',
    command: 'pnpm test --token private',
    cwd: '/workspace',
    paths: undefined,
    requestHash: 'request-hash-1',
    paramsPreview: undefined,
    reason: 'approved by test',
    ...overrides,
  } as PermissionApprovalEvent;
}

describe('host trace diagnostics service', () => {
  it('records only approved failures and omits raw approval and execution fields', () => {
    const service = createHostTraceDiagnosticsService({ secret: SECRET });
    const pending = service.record({
      approval: approval({ status: 'pending' }),
      evidence: { exitCode: 1 },
    });
    expect(pending).toBeUndefined();

    const wrongSource = service.record({
      approval: approval({ source: 'gateway' }),
      evidence: { exitCode: 1 },
    });
    expect(wrongSource).toBeUndefined();

    const record = service.record({
      approval: approval(),
      evidence: {
        code: 'RUNTIME_ERROR',
        exitCode: 1,
        durationMs: 123,
      },
    });
    expect(record).toBeDefined();
    expect(record?.summary.failureKind).toBe('runtime');
    expect(record?.summary.suggestedAction).toBe('retry');
    expect(record?.summary.exitCode).toBe(1);
    expect(record?.summary.durationMs).toBe(123);

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('pnpm test');
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('raw output');
    expect(serialized).not.toContain('command');
    expect(serialized).not.toContain('message');
  });

  it('uses approval-bound, host-generated lineage', () => {
    const service = createHostTraceDiagnosticsService({ secret: SECRET });
    const record = service.record({
      approval: approval(),
      evidence: { exitCode: 2 },
    });

    expect(record?.envelope.lineage.requestId).toBe('approval-1');
    expect(record?.envelope.lineage.runId).toBe('run-1');
    expect(record?.envelope.lineage.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(record?.envelope.lineage.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(record?.envelope.lineage.correlationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.envelope.signature).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
  });

  it('keeps a bounded sink and drops the oldest record first', () => {
    const service = createHostTraceDiagnosticsService({ secret: SECRET, capacity: 2 });
    service.record({ approval: approval({ id: 'approval-1' }), evidence: { exitCode: 1 } });
    service.record({ approval: approval({ id: 'approval-2' }), evidence: { exitCode: 1 } });
    service.record({ approval: approval({ id: 'approval-3' }), evidence: { exitCode: 1 } });

    const records = service.records();
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.envelope.lineage.requestId)).toEqual([
      'approval-2',
      'approval-3',
    ]);
  });

  it('uses the documented default capacity', () => {
    expect(MAX_HOST_TRACE_DIAGNOSTICS_RECORDS).toBe(200);
  });

  it('keeps configured capacity finite and capped', () => {
    const oversized = createHostTraceDiagnosticsService({ secret: SECRET, capacity: 500 });
    for (let index = 0; index < 201; index += 1) {
      oversized.record({ approval: approval({ id: `approval-${index}` }), evidence: { exitCode: 1 } });
    }
    expect(oversized.records()).toHaveLength(200);

    const invalid = createHostTraceDiagnosticsService({ secret: SECRET, capacity: Number.NaN });
    for (let index = 0; index < 201; index += 1) {
      invalid.record({ approval: approval({ id: `approval-${index}` }), evidence: { exitCode: 1 } });
    }
    expect(invalid.records()).toHaveLength(200);
  });

  it('notifies a consumer with the verified safe summary only', () => {
    const onSummary = vi.fn();
    const service = createHostTraceDiagnosticsService({ secret: SECRET, onSummary });
    service.record({
      approval: approval(),
      evidence: {
        code: 'RUNTIME_ERROR',
        message: 'private command and output',
        exitCode: 1,
      } as HostTraceDiagnosticsEvidence,
    });

    expect(onSummary).toHaveBeenCalledWith(expect.objectContaining({
      failureKind: 'runtime',
      suggestedAction: 'retry',
      redaction: 'raw-fields-omitted',
    }));
    const serialized = JSON.stringify(onSummary.mock.calls[0]?.[0]);
    expect(serialized).not.toContain('private command and output');
    expect(serialized).not.toContain('signature');
  });
});
