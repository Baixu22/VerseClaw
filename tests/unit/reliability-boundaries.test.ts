import { describe, expect, it } from 'vitest';
import {
  RELIABILITY_BOUNDARIES,
  findReliabilityBoundary,
  type ReliabilityBoundary,
} from '@shared/reliability-boundaries';

const requiredSubsystems: ReliabilityBoundary['subsystem'][] = [
  'gateway-startup',
  'provider-fallback',
  'host-api-api-client',
  'session-restore-replay',
  'file-writes',
  'dangerous-approvals',
  'task-loop-repair-retry',
];

describe('reliability boundaries', () => {
  it('covers the P2-06 subsystem matrix with complete fields', () => {
    expect(RELIABILITY_BOUNDARIES.map((entry) => entry.subsystem)).toEqual(requiredSubsystems);

    for (const entry of RELIABILITY_BOUNDARIES) {
      expect(entry.retry.trim(), entry.subsystem).not.toHaveLength(0);
      expect(entry.idempotency.trim(), entry.subsystem).not.toHaveLength(0);
      expect(entry.recovery.trim(), entry.subsystem).not.toHaveLength(0);
      expect(entry.noGuarantee.length, entry.subsystem).toBeGreaterThan(0);
      expect(entry.evidenceRefs.length, entry.subsystem).toBeGreaterThan(0);
      expect(entry.relatedTaskIds, entry.subsystem).toContain('P2-06');
    }
  });

  it('keeps dangerous operations explicitly non-idempotent by default', () => {
    expect(findReliabilityBoundary('dangerous-approvals')).toMatchObject({
      idempotency: expect.stringMatching(/not idempotent/i),
      noGuarantee: expect.arrayContaining([
        expect.stringMatching(/not automatically replayed/i),
      ]),
    });
    expect(findReliabilityBoundary('file-writes')).toMatchObject({
      idempotency: expect.stringMatching(/not globally idempotent/i),
    });
  });
});
