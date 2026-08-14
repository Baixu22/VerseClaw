// R3-2.4 proposeFacts confirm: promote a shadow candidate into a durable
// human-approved fact, then (in production) persist via the P0-B appendFact port.
import { describe, expect, it } from 'vitest';
import { buildRuntimeMemoryTemporalFactCandidateFixture } from '../../openclaw_runtime/src/runtime-core';
import { promoteRuntimeMemoryFactCandidate } from '../../openclaw_runtime/src/runtime-core/memory-proposal-shadow';

describe('R3-2: proposeFacts confirm (candidate promotion)', () => {
  it('promotes a shadow candidate into a durable human-approved fact', () => {
    const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: 'c1',
      subject: 'User',
      predicate: 'prefers',
      objectSummary: 'dark mode',
    });

    const fact = promoteRuntimeMemoryFactCandidate(candidate, {
      acceptedAt: 2000,
      approvedBy: 'operator',
      evidenceRefs: [{ type: 'test', ref: 'tests/unit/r3-2-propose-facts-confirm.test.ts' }],
    });

    expect(fact.verificationStatus).toBe('human_approved');
    expect(fact.acceptedAt).toBe(2000);
    expect(fact.promotion.promotedBy).toBe('human');
    expect(fact.promotion.approvedBy).toBe('operator');
    expect(fact.factId).toBe('c1');
    expect(fact.subject).toBe('User');
    // Candidate's proposedAt is dropped; the durable fact carries acceptedAt instead.
    expect('proposedAt' in fact).toBe(false);
  });

  it('omits approvedBy when no operator is supplied', () => {
    const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({ factId: 'c2' });
    const fact = promoteRuntimeMemoryFactCandidate(candidate, {
      acceptedAt: 3000,
      evidenceRefs: [{ type: 'test', ref: 'x' }],
    });
    expect(fact.promotion.promotedBy).toBe('human');
    expect('approvedBy' in fact.promotion).toBe(false);
  });
});
