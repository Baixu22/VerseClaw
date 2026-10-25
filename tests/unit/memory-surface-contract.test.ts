import { describe, expect, it } from 'vitest';
import {
  MEMORY_EXPORT_SCHEMA_VERSION,
  MEMORY_SURFACE_SEMANTICS,
  MEMORY_SURFACE_SCHEMA_VERSION,
  buildMemoryExportSnapshot,
  isAcceptedMemoryStatus,
  isCandidateMemoryProposal,
} from '../../src/components/agents/memory-surface';

describe('TF-0498 MemoryProductSurface/v1', () => {
  it('describes one product surface with one action set', () => {
    expect(MEMORY_SURFACE_SEMANTICS.schemaVersion).toBe(MEMORY_SURFACE_SCHEMA_VERSION);
    expect(MEMORY_SURFACE_SEMANTICS.surfaceId).toBe('agents.memory');
    expect(MEMORY_SURFACE_SEMANTICS.productConcept).toBe('memory');
    expect(new Set(MEMORY_SURFACE_SEMANTICS.actions).size).toBe(MEMORY_SURFACE_SEMANTICS.actions.length);
    expect(MEMORY_SURFACE_SEMANTICS.actions).toEqual([
      'view',
      'review',
      'approve',
      'delete',
      'export',
      'remember',
    ]);
  });

  it('keeps candidates non-retrievable and non-injectable until approval', () => {
    expect(isCandidateMemoryProposal({ id: 'candidate', status: 'needs_review' })).toBe(true);
    expect(isCandidateMemoryProposal({ id: 'candidate', status: 'pending' })).toBe(true);
    expect(isCandidateMemoryProposal({ id: 'accepted', status: 'applied' })).toBe(false);
    expect(isAcceptedMemoryStatus('active')).toBe(true);
    expect(isAcceptedMemoryStatus('cold')).toBe(true);
    expect(isAcceptedMemoryStatus('archived')).toBe(false);
    expect(isAcceptedMemoryStatus('tombstone')).toBe(false);
    expect(MEMORY_SURFACE_SEMANTICS.readGate).toMatchObject({
      acceptedOnly: true,
      unapprovedCandidateRetrievable: false,
      unapprovedCandidateInjectable: false,
    });
    expect(MEMORY_SURFACE_SEMANTICS.candidateQueue).toMatchObject({
      persistent: true,
      reviewRequired: true,
      modelVisibleBeforeApproval: false,
    });
  });

  it('closes read, write and injection together without deleting stored data', () => {
    expect(MEMORY_SURFACE_SEMANTICS.masterSwitch).toMatchObject({
      offBlocksRead: true,
      offBlocksWrite: true,
      offBlocksInjection: true,
      deletesStoredMemory: false,
    });
    expect(MEMORY_SURFACE_SEMANTICS.legacyFallback.nativeOpenClawMemory).toBe('unchanged-and-outside-this-surface');
    expect(MEMORY_SURFACE_SEMANTICS.legacyFallback.existingManagedCardsWhenOff).toBe('retained-on-disk-not-injected');
  });

  it('exports accepted memory, candidates and history as separate sections', () => {
    const snapshot = buildMemoryExportSnapshot({
      generatedAt: '2026-10-22T00:00:00.000Z',
      roleName: 'architect',
      cards: [
        { id: 'accepted', status: 'active', content: 'accepted memory', source: 'user', createdAt: '2026-10-21T00:00:00.000Z' },
        { id: 'cold', status: 'cold', content: 'cold memory' },
        { id: 'deleted', status: 'tombstone', content: 'deleted memory' },
      ],
      proposals: [
        { id: 'candidate', status: 'needs_review', proposal: { content: 'pending candidate' } },
        { id: 'history', status: 'applied', proposal: { content: 'approved history' } },
      ],
      injections: [{ id: 'inj-1', roleName: 'architect', cardIds: ['accepted'] }],
    });
    expect(snapshot.schemaVersion).toBe(MEMORY_EXPORT_SCHEMA_VERSION);
    expect(snapshot.counts).toEqual({ accepted: 2, candidates: 1, proposalHistory: 1, injections: 1 });
    expect((snapshot.acceptedMemory as Array<{ id: string }>).map((card) => card.id)).toEqual(['accepted', 'cold']);
    expect((snapshot.candidateQueue as Array<{ id: string }>).map((proposal) => proposal.id)).toEqual(['candidate']);
    expect((snapshot.proposalHistory as Array<{ id: string }>).map((proposal) => proposal.id)).toEqual(['history']);
  });

  it('keeps delete and model visibility semantics explicit', () => {
    expect(MEMORY_SURFACE_SEMANTICS.deletion).toMatchObject({
      userAction: 'delete',
      mechanism: 'tombstone',
      hardDelete: false,
      auditHistoryRetained: true,
      retrievableOrInjectableAfterDelete: false,
    });
    expect(MEMORY_SURFACE_SEMANTICS.modelVisibility).toMatchObject({ approvedOnly: true });
    expect(MEMORY_SURFACE_SEMANTICS.modelVisibility.candidateExplanation).toContain('not accepted');
  });
});
