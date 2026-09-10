// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { filterLowValuePromotionCandidates } from '../../openclaw_runtime/extensions/memory-core/src/dreaming';

function candidate(partial: Partial<{
  key: string;
  snippet: string;
  claimHash?: string;
}>): {
  key: string;
  path: string;
  startLine: number;
  endLine: number;
  source: 'memory';
  snippet: string;
  recallCount: number;
  avgScore: number;
  maxScore: number;
  uniqueQueries: number;
  claimHash?: string;
  firstRecalledAt: string;
  lastRecalledAt: string;
  ageDays: number;
  score: number;
  recallDays: string[];
  conceptTags: string[];
  components: Record<string, number>;
} {
  return {
    key: partial.key ?? 'k',
    path: '/workspace/memory/m.md',
    startLine: 1,
    endLine: 2,
    source: 'memory',
    snippet: partial.snippet ?? 'A reasonably long memory snippet that qualifies for promotion.',
    recallCount: 1,
    avgScore: 0.5,
    maxScore: 0.6,
    uniqueQueries: 1,
    ...(partial.claimHash !== undefined ? { claimHash: partial.claimHash } : {}),
    firstRecalledAt: '2026-07-01T00:00:00.000Z',
    lastRecalledAt: '2026-07-02T00:00:00.000Z',
    ageDays: 1,
    score: 0.5,
    recallDays: ['2026-07-01'],
    conceptTags: [],
    components: {},
  };
}

describe('P2-2 promotion candidate filtering', () => {
  it('keeps qualifying candidates', () => {
    const result = filterLowValuePromotionCandidates([candidate({ key: 'a' })] as never);
    expect(result).toHaveLength(1);
  });

  it('drops snippets shorter than 24 characters', () => {
    const short = candidate({ key: 'short', snippet: 'too short' });
    const result = filterLowValuePromotionCandidates([short, candidate({ key: 'ok' })] as never);
    expect(result.map((c) => c.key)).toEqual(['ok']);
  });

  it('drops near-duplicate candidates sharing a claim hash', () => {
    const a = candidate({ key: 'a', claimHash: 'hash-1' });
    const b = candidate({ key: 'b', claimHash: 'hash-1' });
    const result = filterLowValuePromotionCandidates([a, b] as never);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('a');
  });

  it('keeps candidates without a claim hash even when duplicates exist', () => {
    const noHashA = candidate({ key: 'a' });
    const noHashB = candidate({ key: 'b' });
    const result = filterLowValuePromotionCandidates([noHashA, noHashB] as never);
    expect(result).toHaveLength(2);
  });

  it('returns an empty list for empty input', () => {
    expect(filterLowValuePromotionCandidates([])).toEqual([] as never);
  });
});
