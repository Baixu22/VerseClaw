import { describe, expect, it } from 'vitest';
import {
  canTransitionLifecycle,
  normalizeArchiveHandle,
  normalizeContextItem,
  normalizeContextItemId,
  normalizeLifecycleEvent,
  normalizeProjectionSpec,
  normalizeStatusSnapshot,
  stableStringifyContextFamily,
} from '../../shared/types/context-family';

const VALID_CHECKSUM = `sha256:${'b'.repeat(64)}`;

describe('Context Family protocol contracts', () => {
  it('serializes ContextItem metadata deterministically without raw payloads', () => {
    const item = normalizeContextItem({
      id: 'ctx:session-123/observation/tool-call-1',
      schemaVersion: 1,
      kind: 'observation',
      lifecycleState: 'active',
      source: {
        type: 'tool_call',
        sessionId: 'session-123',
        turnId: 'turn-7',
        toolCallId: 'tool-call-1',
      },
      projection: {
        mode: 'index_only',
        tokenEstimate: 32,
        metadata: { title: 'shell output' },
        cvk: {
          resourceId: 'trace:session-123/tool-call-1@v1',
          selector: 'trace:tool-call-1.result',
          checksum: VALID_CHECKSUM,
        },
      },
      provenance: {
        createdAt: '2026-07-08T00:00:00.000Z',
        producer: 'context-family-contract-test',
        evidence: [{
          type: 'cvk',
          resourceId: 'trace:session-123/tool-call-1@v1',
          selector: 'trace:tool-call-1.result',
          checksum: VALID_CHECKSUM,
        }],
      },
      contentHash: VALID_CHECKSUM,
      metadata: { byteLength: 2048 },
    });

    const serialized = stableStringifyContextFamily(item);

    expect(JSON.parse(serialized)).toEqual(item);
    expect(serialized).toBe(stableStringifyContextFamily(JSON.parse(serialized)));
    expect(serialized).not.toContain('rawPayload');
  });

  it('rejects invalid item ids, archive handles, lifecycle transitions, and oversized projection metadata', () => {
    expect(() => normalizeContextItemId('bad id')).toThrow(/Invalid context item id/);
    expect(() => normalizeArchiveHandle({
      uri: 'context-archive://session-123/tool-call-1',
      checksum: 'sha256:abc',
      byteLength: 128,
      createdAt: '2026-07-08T00:00:00.000Z',
    })).toThrow(/Invalid checksum/);
    expect(canTransitionLifecycle('evicted', 'active')).toBe(false);
    expect(() => normalizeLifecycleEvent({
      id: 'evt:session-123/revive',
      itemId: 'ctx:session-123/observation/tool-call-1',
      from: 'evicted',
      to: 'active',
      reason: 'revive evicted text',
      occurredAt: '2026-07-08T00:00:00.000Z',
    })).toThrow(/Invalid lifecycle transition/);
    expect(() => normalizeProjectionSpec({
      mode: 'summary',
      tokenEstimate: 16,
      metadata: { large: 'x'.repeat(4097) },
    })).toThrow(/Projection metadata is too large/);
  });

  it('supports archive-backed masked projections and status snapshots', () => {
    const archive = normalizeArchiveHandle({
      uri: 'context-archive://session-123/tool-call-1',
      checksum: VALID_CHECKSUM,
      byteLength: 8192,
      source: {
        type: 'transcript',
        sessionId: 'session-123',
        entryId: 'entry-4',
      },
      createdAt: '2026-07-08T00:00:00.000Z',
    });
    const projection = normalizeProjectionSpec({
      mode: 'masked',
      tokenEstimate: 12,
      archiveHandle: archive,
      metadata: { placeholder: '[tool result masked]' },
    });
    const snapshot = normalizeStatusSnapshot({
      schemaVersion: 1,
      generatedAt: '2026-07-08T00:00:01.000Z',
      totalItems: 3,
      countsByKind: { observation: 2, instruction: 1 },
      countsByLifecycleState: { active: 1, masked: 1, archived: 1 },
      archiveAvailable: true,
      recoveryAvailable: false,
      warnings: ['recall surface is not implemented in this slice'],
    });

    expect(projection.archiveHandle).toEqual(archive);
    expect(snapshot.countsByKind.observation).toBe(2);
    expect(snapshot.countsByLifecycleState.masked).toBe(1);
  });
});
