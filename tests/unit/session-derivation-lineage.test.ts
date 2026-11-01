import { describe, expect, it } from 'vitest';

import {
  SESSION_DERIVATION_SCHEMA,
  classifyDerivation,
  deriveSessionLineage,
  type SessionDerivationEntryFacts,
} from '../../shared/types/session-derivation';

function storeOf(map: Record<string, SessionDerivationEntryFacts>) {
  return (key: string): SessionDerivationEntryFacts | null => map[key] ?? null;
}

describe('classifyDerivation', () => {
  it('classifies a fork triple as fork and keeps the parent key', () => {
    expect(
      classifyDerivation({
        forkedFromParent: true,
        forkedFromLeafId: 'leaf-1',
        parentSessionKey: 'agent:main:parent',
      }),
    ).toEqual({ kind: 'fork', parentSessionKey: 'agent:main:parent' });
  });

  it('classifies a parent key without fork facts as handoff', () => {
    expect(classifyDerivation({ parentSessionKey: 'agent:main:parent' })).toEqual({
      kind: 'handoff',
      parentSessionKey: 'agent:main:parent',
    });
  });

  it('classifies spawnedBy as spawn', () => {
    expect(classifyDerivation({ spawnedBy: 'agent:main:parent' })).toEqual({
      kind: 'spawn',
      parentSessionKey: 'agent:main:parent',
    });
  });

  it('returns unknown when the entry names no parent at all', () => {
    expect(classifyDerivation({ sessionId: 'sid-1' })).toEqual({ kind: 'unknown' });
  });
});

describe('deriveSessionLineage', () => {
  it('returns no hops for a root session', () => {
    const out = deriveSessionLineage({
      rootSessionKey: 'agent:main:main',
      readEntry: storeOf({ 'agent:main:main': { sessionId: 'sid-root' } }),
    });
    expect(out.schema).toBe(SESSION_DERIVATION_SCHEMA);
    expect(out.hops).toEqual([]);
    expect(out.truncated).toBe(false);
    expect(out.chain).toEqual([{ sessionKey: 'agent:main:main', sessionId: 'sid-root', kind: 'unknown' }]);
  });

  it('walks fork then handoff hops with the fork point preserved', () => {
    const out = deriveSessionLineage({
      rootSessionKey: 'agent:main:child',
      readEntry: storeOf({
        'agent:main:child': {
          sessionId: 'sid-child',
          forkedFromParent: true,
          forkedFromLeafId: 'leaf-9',
          forkedFromTimestamp: 1_700_000_000_000,
          parentSessionKey: 'agent:main:mid',
        },
        'agent:main:mid': { sessionId: 'sid-mid', parentSessionKey: 'agent:main:root' },
        'agent:main:root': { sessionId: 'sid-root' },
      }),
    });

    expect(out.hops).toHaveLength(2);
    expect(out.hops[0]).toMatchObject({
      kind: 'fork',
      status: 'resolved',
      parentSessionKey: 'agent:main:mid',
      forkedFromLeafId: 'leaf-9',
      parentFound: true,
    });
    expect(out.hops[1]).toMatchObject({
      kind: 'handoff',
      status: 'resolved',
      parentSessionKey: 'agent:main:root',
    });
    expect(out.chain.map((c) => c.kind)).toEqual(['fork', 'handoff', 'unknown']);
  });

  it('reports parent-missing instead of a fabricated root when the parent entry is absent', () => {
    const out = deriveSessionLineage({
      rootSessionKey: 'agent:main:child',
      readEntry: storeOf({
        'agent:main:child': { sessionId: 'sid-child', parentSessionKey: 'agent:main:gone' },
      }),
    });
    expect(out.hops).toHaveLength(1);
    expect(out.hops[0]).toMatchObject({
      status: 'parent-missing',
      parentSessionKey: 'agent:main:gone',
      parentFound: false,
    });
  });

  it('stops on a cycle instead of looping', () => {
    const out = deriveSessionLineage({
      rootSessionKey: 'a',
      readEntry: storeOf({
        a: { sessionId: 'sid-a', parentSessionKey: 'b' },
        b: { sessionId: 'sid-b', parentSessionKey: 'a' },
      }),
    });
    expect(out.hops.at(-1)).toMatchObject({ status: 'cycle', parentSessionKey: 'a' });
    expect(out.hops.length).toBeLessThanOrEqual(2);
  });

  it('stops at the depth bound and says so', () => {
    const map: Record<string, SessionDerivationEntryFacts> = {};
    for (let i = 0; i < 10; i += 1) {
      map['s' + i] = { sessionId: 'sid-' + i, parentSessionKey: 's' + (i + 1) };
    }
    const out = deriveSessionLineage({ rootSessionKey: 's0', readEntry: storeOf(map), maxDepth: 3 });
    expect(out.truncated).toBe(true);
    expect(out.hops).toHaveLength(3);
    expect(out.hops.at(-1)!.status).toBe('bound-exceeded');
  });

  it('is pure: repeated calls agree and inputs are not mutated', () => {
    const map: Record<string, SessionDerivationEntryFacts> = {
      child: { sessionId: 'sid-child', parentSessionKey: 'root' },
      root: { sessionId: 'sid-root' },
    };
    const snapshot = JSON.stringify(map);
    const read = storeOf(map);
    const first = deriveSessionLineage({ rootSessionKey: 'child', readEntry: read });
    const second = deriveSessionLineage({ rootSessionKey: 'child', readEntry: read });
    expect(first).toEqual(second);
    expect(JSON.stringify(map)).toBe(snapshot);
  });

  it('degrades to an empty derivation when the root entry is unreadable', () => {
    const out = deriveSessionLineage({
      rootSessionKey: 'ghost',
      readEntry: storeOf({}),
    });
    expect(out.hops).toEqual([]);
    expect(out.chain).toEqual([]);
  });
});
