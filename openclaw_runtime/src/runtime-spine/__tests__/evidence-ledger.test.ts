// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

import { describe, expect, it } from 'vitest';

import { evidenceLedger } from '../evidence-ledger.js';
import type { CompletionEvidence, EvidenceItem, MutationEvidence } from '../types.js';

const item: EvidenceItem = {
  itemId: 'item-1',
  label: 'diagnostic payload',
  value: { ok: true },
  capturedAt: 1,
};

describe('EvidenceLedger', () => {
  it('creates a pending envelope when evidence is collected', () => {
    const envelope = evidenceLedger.collect('entity-pending', 'diagnostic_snapshot', 'collector', [
      item,
    ]);

    expect(envelope).toMatchObject({
      entityId: 'entity-pending',
      kind: 'diagnostic_snapshot',
      collector: 'collector',
      status: 'pending',
      items: [item],
    });
  });

  it('updates collected evidence to verified', () => {
    const envelope = evidenceLedger.collect('entity-verified', 'completion_evidence', 'collector', [
      item,
    ]);

    const result = evidenceLedger.verify(envelope.envelopeId, 'verifier');

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.value.status).toBe('verified');
    expect(result.value.verifiedBy).toBe('verifier');
    expect(result.value.verifiedAt).toEqual(expect.any(Number));
  });

  it('updates collected evidence to rejected', () => {
    const envelope = evidenceLedger.collect('entity-rejected', 'mutation_evidence', 'collector', [
      item,
    ]);

    const result = evidenceLedger.reject(envelope.envelopeId, 'reviewer');

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.value.status).toBe('rejected');
    expect(result.value.rejectedBy).toBe('reviewer');
    expect(result.value.rejectedAt).toEqual(expect.any(Number));
  });

  it('identifies mutation evidence', () => {
    const mutation = evidenceLedger.collect('entity-mutation', 'mutation_evidence', 'collector', [
      item,
    ]);
    const completion = evidenceLedger.collect(
      'entity-completion',
      'completion_evidence',
      'collector',
      [item],
    );

    expect(evidenceLedger.isMutationEvidence(mutation)).toBe(true);
    expect(evidenceLedger.isMutationEvidence(completion)).toBe(false);
  });

  it('identifies completion evidence', () => {
    const mutation = evidenceLedger.collect('entity-mutation-2', 'mutation_evidence', 'collector', [
      item,
    ]);
    const completion = evidenceLedger.collect(
      'entity-completion-2',
      'completion_evidence',
      'collector',
      [item],
    );

    expect(evidenceLedger.isCompletionEvidence(completion)).toBe(true);
    expect(evidenceLedger.isCompletionEvidence(mutation)).toBe(false);
  });

  it('keeps mutation evidence incompatible with completion evidence at the type level', () => {
    const mutation = evidenceLedger.collect('entity-type', 'mutation_evidence', 'collector', [
      item,
    ]);

    if (!evidenceLedger.isMutationEvidence(mutation)) {
      throw new Error('expected mutation evidence');
    }

    const mutationEvidence: MutationEvidence = mutation;
    // @ts-expect-error mutation evidence must not be assignable to completion evidence
    const completionEvidence: CompletionEvidence = mutationEvidence;

    expect(completionEvidence).toBe(mutationEvidence);
  });
});
