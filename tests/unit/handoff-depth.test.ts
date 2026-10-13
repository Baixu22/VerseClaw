// TF-0284 / #179: a relay chain must be bounded and cycle-free, and the bound
// must not be removable by unreadable configuration.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_HANDOFF_DEPTH,
  evaluateHandoffDerivation,
  resolveHandoffChain,
  resolveMaxHandoffDepth,
} from '@shared/handoff-depth';

function handoff(child: string, parent: string) {
  return { sessionKey: child, relation: 'handoff_from', sourceSessionKey: parent };
}

describe('handoff depth and cycle policy', () => {
  it('treats a session with no relay ancestry as a root', () => {
    const chain = resolveHandoffChain([], 'agent:main:root');
    expect(chain).toEqual({ ancestors: [], depth: 0, cycle: false, incomplete: false });

    const decision = evaluateHandoffDerivation({ links: [], sessionKey: 'agent:main:root' });
    expect(decision).toMatchObject({
      allow: true,
      depth: 1,
      parentSessionKey: 'agent:main:root',
      rootSessionKey: 'agent:main:root',
    });
  });

  it('follows handoff_from links root-first and counts the relay depth', () => {
    const links = [handoff('b', 'a'), handoff('c', 'b')];
    expect(resolveHandoffChain(links, 'c')).toEqual({ ancestors: ['a', 'b'], depth: 2, cycle: false, incomplete: false });
  });

  it('follows forks without counting them as relays', () => {
    const links = [{ sessionKey: 'b', relation: 'forked_from', sourceSessionKey: 'a' }];
    expect(resolveHandoffChain(links, 'b')).toEqual({ ancestors: ['a'], depth: 0, cycle: false, incomplete: false });
  });

  it('allows the derivation that lands exactly on the limit and refuses the next hop', () => {
    // depth 2 -> the derived session becomes depth 3 == default limit: allowed.
    const atLimit = evaluateHandoffDerivation({
      links: [handoff('b', 'a'), handoff('c', 'b')],
      sessionKey: 'c',
    });
    expect(atLimit).toMatchObject({ allow: true, depth: 3, rootSessionKey: 'a' });

    // depth 3 -> the derived session would be depth 4 > default limit: refused.
    const overLimit = evaluateHandoffDerivation({
      links: [handoff('b', 'a'), handoff('c', 'b'), handoff('d', 'c')],
      sessionKey: 'd',
    });
    expect(overLimit.allow).toBe(false);
    if (overLimit.allow) throw new Error('expected denial');
    expect(overLimit.reason).toBe('handoff_depth_exceeded');
    expect(overLimit.maxDepth).toBe(DEFAULT_MAX_HANDOFF_DEPTH);
    expect(overLimit.error).toMatch(/continue in the current session/i);
  });

  it('refuses a relay that would close a loop instead of spinning', () => {
    const decision = evaluateHandoffDerivation({
      links: [handoff('b', 'a'), handoff('a', 'b')],
      sessionKey: 'a',
    });
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error('expected denial');
    expect(decision.reason).toBe('handoff_cycle_detected');
    expect(decision.error).toMatch(/cycle detected/i);
  });

  it('honours a configured limit and falls back safely when it is unreadable', () => {
    expect(resolveMaxHandoffDepth(5)).toBe(5);
    expect(resolveMaxHandoffDepth(2.9)).toBe(DEFAULT_MAX_HANDOFF_DEPTH);
    expect(resolveMaxHandoffDepth(0)).toBe(DEFAULT_MAX_HANDOFF_DEPTH);
    expect(resolveMaxHandoffDepth(-1)).toBe(DEFAULT_MAX_HANDOFF_DEPTH);
    expect(resolveMaxHandoffDepth('3')).toBe(DEFAULT_MAX_HANDOFF_DEPTH);
    expect(resolveMaxHandoffDepth(Number.NaN)).toBe(DEFAULT_MAX_HANDOFF_DEPTH);
    expect(resolveMaxHandoffDepth(undefined)).toBe(DEFAULT_MAX_HANDOFF_DEPTH);

    const custom = evaluateHandoffDerivation({
      links: [handoff('b', 'a')],
      sessionKey: 'b',
      maxDepth: 1,
    });
    expect(custom.allow).toBe(false);
    if (custom.allow) throw new Error('expected denial');
    expect(custom.maxDepth).toBe(1);
  });
  it('rejects a self-cycle, conflicting parents and a truncated walk', () => {
    expect(evaluateHandoffDerivation({ links: [handoff('a', 'a')], sessionKey: 'a' })).toMatchObject({ allow: false, reason: 'handoff_cycle_detected' });
    expect(evaluateHandoffDerivation({ links: [handoff('b', 'a'), handoff('b', 'z')], sessionKey: 'b' })).toMatchObject({ allow: false, reason: 'handoff_ancestry_unavailable' });
    expect(evaluateHandoffDerivation({ links: [handoff('b', 'a'), handoff('c', 'b')], sessionKey: 'c', maxWalk: 1 })).toMatchObject({ allow: false, reason: 'handoff_ancestry_unavailable' });
  });

  it('preserves relay depth through forks, so forking does not bypass the bound', () => {
    const links = [handoff('b', 'a'), handoff('c', 'b'), handoff('d', 'c'),
      { sessionKey: 'fork', relation: 'forked_from', sourceSessionKey: 'd' }];
    expect(evaluateHandoffDerivation({ links, sessionKey: 'fork' })).toMatchObject({ allow: false, depth: 4, reason: 'handoff_depth_exceeded' });
    expect(evaluateHandoffDerivation({ links, sessionKey: 'fork', enforceDepth: false })).toMatchObject({ allow: true, depth: 4, rootSessionKey: 'a' });
  });

  it('reads parent/root handoff ids from persisted events', () => {
    expect(evaluateHandoffDerivation({ links: [{ ...handoff('b', 'a'), id: 'root-event' }, { ...handoff('c', 'b'), id: 'parent-event' }], sessionKey: 'c' }))
      .toMatchObject({ allow: true, depth: 3, rootHandoffId: 'root-event', parentHandoffId: 'parent-event' });
  });

});