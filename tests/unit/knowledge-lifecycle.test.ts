import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import type { KnowledgeChangeOperation } from '../../shared/host-api/contract';

vi.mock('electron', () => ({
  shell: { openPath: vi.fn(async () => '') },
}));

const root = join(tmpdir(), `clawx-knowledge-lifecycle-${Date.now()}`);

vi.mock('@electron/utils/paths', () => ({
  expandPath: (path: string) => path,
  getOpenClawConfigDir: () => root,
  getDataDir: () => join(root, 'userData'),
  getOpenClawRuntimeDir: () => join(root, 'missing-openclaw-runtime'),
}));

const LIFECYCLE_OPS: Exclude<KnowledgeChangeOperation, 'create'>[] = [
  'update',
  'merge',
  'archive',
  'revoke',
  'delete',
  'restore',
];

describe('KS-08 memory-wiki lifecycle Main RPC wiring', () => {
  beforeEach(async () => {
    closeOpenClawStateDatabaseForTest();
    const mod = await import('@electron/services/knowledge-api');
    mod.__resetKnowledgeGovernanceForTests();
    mod.__resetGovernanceWriterQueueForTests();
    mod.__resetHostGovernedAdaptersForTests();
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    closeOpenClawStateDatabaseForTest();
    rmSync(root, { recursive: true, force: true });
  });

  for (const operation of LIFECYCLE_OPS) {
    it(`routes ${operation} through wiki.${operation} with expectedRevision CAS and EffectReceipt`, async () => {
      const gatewayManager = {
        rpc: vi.fn(async (method: string) => {
          if (method === 'wiki.get') return { revision: 1, status: 'active', path: 'notes/target.md' };
          if (method === `wiki.${operation}`) return { changed: true, revision: 2, status: operation === 'delete' ? 'deleted' : 'active' };
          throw new Error(`unexpected rpc ${method}`);
        }),
      };
      const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
      const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

      const draft = await api.createDraft({
        title: `${operation} proposal`,
        body: operation === 'update' || operation === 'merge' ? `Updated body for ${operation}.` : `Reason for ${operation}.`,
        type: 'procedure',
        sourceIds: operation === 'create' ? ['notes/target.md'] : [],
        createdBy: 'user',
      });
      expect(draft.success).toBe(true);
      const proposal = await api.proposeChange({
        operation,
        targetPageIds: ['notes/target.md'],
        draftId: draft.draft!.id,
        reason: `KS-08 ${operation} lifecycle test`,
        ...(operation === 'update' || operation === 'merge'
          ? { diff: `- old\n+ ${operation}` }
          : {}),
        sources: [{ id: 'notes/target.md', kind: 'wiki' }],
      });
      expect(proposal.success).toBe(true);
      expect(proposal.proposal?.expectedRevision).toBe(1);

      await api.reviewDraft({ id: draft.draft!.id, action: 'approve' });
      const applied = await api.applyReviewedChange({
        reviewBundleId: `kb_${proposal.proposal!.id}_${draft.draft!.id}`,
      });
      expect(applied.success).toBe(true);
      expect(gatewayManager.rpc).toHaveBeenCalledWith(
        `wiki.${operation}`,
        expect.objectContaining({
          lookup: 'notes/target.md',
          expectedRevision: 1,
          idempotencyKey: expect.any(String),
        }),
        120000,
      );
      expect(applied.receipt).toMatchObject({
        schema: 'knowledge-governance-receipt.v1',
        operation,
        owner: 'memory-wiki',
        subjectId: 'notes/target.md',
        idempotencyKey: expect.any(String),
        status: 'committed',
      });
      expect(applied.compensation?.status).toBe(operation === 'delete' ? 'unrecoverable' : 'partial');

      const duplicate = await api.applyReviewedChange({
        reviewBundleId: `kb_${proposal.proposal!.id}_${draft.draft!.id}`,
      });
      expect(duplicate).toMatchObject({ success: true, changed: false, operation: 'duplicate' });
      expect(gatewayManager.rpc).toHaveBeenCalledTimes(3); // proposal read + apply read + one mutation

      const receipts = await api.listGovernanceReceipts();
      expect(receipts.success).toBe(true);
      expect(receipts.receipts).toHaveLength(1);
      expect(receipts.receipts[0]).toMatchObject({ operation, subjectId: 'notes/target.md', status: 'committed' });
    });
  }

  it('rejects stale target wiki revision before calling any lifecycle RPC', async () => {
    let wikiRevision = 1;
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'wiki.get') return { revision: wikiRevision, path: 'notes/target.md' };
        if (method.startsWith('wiki.')) throw new Error('lifecycle RPC must not run for stale revision');
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    const draft = await api.createDraft({
      title: 'Stale archive',
      body: 'Archive target after review.',
      type: 'procedure',
      sourceIds: [],
      createdBy: 'user',
    });
    const proposal = await api.proposeChange({
      operation: 'archive',
      targetPageIds: ['notes/target.md'],
      draftId: draft.draft!.id,
      reason: 'archive target',
    });
    await api.reviewDraft({ id: draft.draft!.id, action: 'approve' });
    wikiRevision = 2;
    const applied = await api.applyReviewedChange({
      reviewBundleId: `kb_${proposal.proposal!.id}_${draft.draft!.id}`,
    });
    expect(applied.success).toBe(false);
    expect(applied.conflict?.code).toBe('stale_revision');
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.archive', expect.anything(), expect.anything());
  });

  it('rejects the same lifecycle idempotency key with a different draft digest', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'wiki.get') return { revision: 1, path: 'notes/target.md' };
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    const firstDraft = await api.createDraft({
      title: 'Merge one',
      body: 'First merge body.',
      type: 'procedure',
      sourceIds: [],
      createdBy: 'user',
    });
    const first = await api.proposeChange({
      operation: 'merge',
      targetPageIds: ['notes/target.md', 'notes/source.md'],
      draftId: firstDraft.draft!.id,
      reason: 'merge source into target',
      diff: '+ first merge body',
    });
    expect(first.success).toBe(true);

    const secondDraft = await api.createDraft({
      title: 'Merge one',
      body: 'Second merge body with a different digest.',
      type: 'procedure',
      sourceIds: [],
      createdBy: 'user',
    });
    const second = await api.proposeChange({
      operation: 'merge',
      targetPageIds: ['notes/target.md', 'notes/source.md'],
      draftId: secondDraft.draft!.id,
      reason: 'merge source into target',
      diff: '+ second merge body',
      idempotencyKey: first.proposal!.idempotencyKey,
    });
    expect(second.success).toBe(false);
    expect(second.error).toContain('idempotency conflict');
  });
});
