import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import {
  canEnterHighTrustContext,
  ConfirmProvenanceError,
  resolveConfirmIntegrity,
  assertConfirmSession,
} from '../../openclaw_runtime/src/knowledge/sekb/confirm-provenance';
import { DistillationTool } from '../../openclaw_runtime/src/knowledge/sekb/distillation-tool';
import { handleConfirmAndSave } from '../../openclaw_runtime/src/knowledge/sekb/experience-block-bridge';
import { KnowledgeStore } from '../../openclaw_runtime/src/knowledge/sekb/knowledge-store';
import type { ContextBlockSink } from '../../openclaw_runtime/src/context-engine/block';
import type { DistillationSuggestion } from '../../openclaw_runtime/src/knowledge/sekb/types';

const tempRoots: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createStore(): KnowledgeStore {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sekb-p3-002-'));
  tempRoots.push(root);
  return new KnowledgeStore({ database: { path: path.join(root, 'state.sqlite') } });
}

function seedTrajectory(store: KnowledgeStore, id: string) {
  store.save_trajectory({
    trajectory_id: id,
    created_at: '2026-07-17T09:00:00.000Z',
    task_intent: 'connect db',
    task_type: 'config/db',
    context_fingerprint: ['postgresql'],
    steps: [],
    outcome: 'failure',
    error_signature: 'ConnectionError::db',
    cost: { tokens: 1, duration_seconds: 1, retries: 0 },
    distilled: false,
    distilled_into: [],
    expires_at: null,
    metadata: {},
  });
}

function suggestion(ids: string[] = ['traj-p3-002-a']): DistillationSuggestion {
  return {
    cluster_summary: 'Similar failures',
    source_trajectory_ids: ids,
    suggested_principle: {
      title: 'Check access',
      condition: 'When connection refused',
      action: 'Verify network',
      reason: 'Common env issue',
      task_types: ['config/db'],
      context_tags: ['postgresql'],
    },
    confidence: 0.9,
  };
}

describe('P3-002 DCS provenance / session lineage / confirm sink', () => {
  it('A1: confirm retains session and provenance lineage', async () => {
    const store = createStore();
    seedTrajectory(store, 'traj-p3-002-a');
    const tool = new DistillationTool({ store });
    const sink: ContextBlockSink = vi.fn(async (writes) => writes.map(() => ({ accepted: true })));

    const result = await tool.confirm_and_save_with_lineage(suggestion(), null, {
      sessionId: 'session:p3-002:main',
      sourceSystem: 'ui-confirm',
      contextBlockSink: sink,
      requireSession: true,
    });

    expect(result.principleId).toBeTruthy();
    expect(result.provenance).toMatchObject({
      schema: 'sekb-confirm-provenance.v1',
      sessionId: 'session:p3-002:main',
      sourceSystem: 'ui-confirm',
      sourceTrajectoryIds: ['traj-p3-002-a'],
      integrity: 'confirmed',
      taskId: 'P3-002',
    });
    expect(result.provenance?.revokeKey).toContain(result.principleId);
    expect(result.dcsWrite).toBe('persisted');

    const principle = store.get_principle(result.principleId);
    expect(principle.metadata.confirmProvenance).toMatchObject({
      sessionId: 'session:p3-002:main',
      sourceTrajectoryIds: ['traj-p3-002-a'],
    });

    expect(sink).toHaveBeenCalled();
    const write = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0][0];
    expect(write.block.session_id).toBe('session:p3-002:main');
    expect(write.admission.session_id).toBe('session:p3-002:main');
    expect(write.admission.verification_status).toBe('confirmed');
  });

  it('A1: confirm without session is rejected in strict host path', async () => {
    const store = createStore();
    seedTrajectory(store, 'traj-p3-002-a');
    const tool = new DistillationTool({ store });

    await expect(
      tool.confirm_and_save_with_lineage(suggestion(), null, {
        requireSession: true,
        contextBlockSink: vi.fn(async (writes) => writes.map(() => ({ accepted: true }))),
      }),
    ).rejects.toBeInstanceOf(ConfirmProvenanceError);

    expect(() => assertConfirmSession(undefined, { requireSession: true })).toThrow(/sessionId/i);
  });

  it('A2: summary-only claims cannot auto-elevate integrity to high_trust', () => {
    const resolved = resolveConfirmIntegrity({
      claimed: 'high_trust',
      sourceSystem: 'sekb',
      sessionId: 'session-x',
      sourceTrajectoryIds: ['t1'],
      summaryOnly: true,
    });
    expect(resolved.integrity).toBe('confirmed');
    expect(resolved.summaryOnlyClaimDowngraded).toBe(true);
    expect(resolved.highTrustEligible).toBe(false);
    expect(resolved.reasons).toContain('summary_only_cannot_elevate_high_trust');
  });

  it('A2: non-summary high_trust with lineage remains eligible', () => {
    const resolved = resolveConfirmIntegrity({
      claimed: 'high_trust',
      sourceSystem: 'sekb',
      sessionId: 'session-x',
      sourceTrajectoryIds: ['t1'],
      summaryOnly: false,
    });
    expect(resolved.integrity).toBe('high_trust');
    expect(resolved.highTrustEligible).toBe(true);
  });

  it('A3: unknown source cannot enter high-trust context', async () => {
    const unknown = resolveConfirmIntegrity({
      claimed: 'high_trust',
      sourceSystem: 'unknown',
      sessionId: 'session-x',
      sourceTrajectoryIds: ['t1'],
    });
    expect(unknown.integrity).toBe('advisory');
    expect(
      canEnterHighTrustContext({
        integrity: 'high_trust',
        sourceSystem: 'unknown',
        sessionId: 'session-x',
        sourceTrajectoryIds: ['t1'],
      }),
    ).toBe(false);

    const store = createStore();
    seedTrajectory(store, 'traj-p3-002-a');
    const tool = new DistillationTool({ store });
    const sink: ContextBlockSink = vi.fn(async (writes) => writes.map(() => ({ accepted: true })));

    const result = await tool.confirm_and_save_with_lineage(suggestion(), null, {
      sessionId: 'session:unknown-source',
      sourceSystem: 'unknown',
      integrityClaim: 'high_trust',
      contextBlockSink: sink,
    });

    expect(result.provenance?.integrity).toBe('advisory');
    expect(result.highTrustEligible).toBe(false);
    expect(result.dcsWrite).toBe('persisted');
    const write = (sink as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]?.[0];
    expect(write.admission.integrity).toBe('advisory');
    expect(write.block.presence.always_on).toBe(false);
  });

  it('A3: high_trust without eligibility is rejected by experience sink', async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const rejected = await handleConfirmAndSave({
      principle: {
        principle_id: 'p-1',
        created_at: '2026-07-17T09:00:00.000Z',
        updated_at: '2026-07-17T09:00:00.000Z',
        title: 't',
        condition: 'c',
        action: 'a',
        reason: 'r',
        full_content: 'full',
        task_types: [],
        context_tags: [],
        embedding: null,
        source_trajectories: [],
        created_by: 'human',
        status: 'active',
        retrieval_count: 0,
        adoption_count: 0,
        post_adoption_success: 0,
        criticality: 'medium',
        pinned: false,
        metadata: {},
      },
      suggestion: suggestion([]),
      sessionId: 'session-a',
      contextBlockSink: sink,
      integrity: 'high_trust',
      highTrustEligible: false,
    });
    expect(rejected).toMatchObject({ accepted: false });
    expect(rejected?.blockId).toContain('experience-projection/v1');
    expect(sink).not.toHaveBeenCalled();
  });
});
