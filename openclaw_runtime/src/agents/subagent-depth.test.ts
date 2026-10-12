/**
 * #179: the spawn-depth invariant ("no unbounded recursion") is enforced by
 * `getSubagentDepthFromSessionStore` (store-backed, restart-safe, cycle-safe)
 * plus the `maxSpawnDepth` gate in `subagent-spawn.ts`. Neither had any test
 * coverage, so a regression there would only surface as a runaway spawn chain.
 */
import { describe, expect, it } from 'vitest';
import {
  getSubagentDepthFromSessionStore,
  getSubagentRootFromSessionStore,
  isSpawnedByParentKey,
} from './subagent-depth.js';
import { getSubagentDepth } from '../sessions/session-key-utils.js';

describe('#179 subagent spawn depth', () => {
  it('reads the persisted spawnDepth when the store has one', () => {
    const store = {
      'agent:main:subagent:x': { sessionId: 'x', spawnDepth: 3 },
    };
    expect(getSubagentDepthFromSessionStore('agent:main:subagent:x', { store })).toBe(3);
  });

  it('walks spawnedBy to recover depth when spawnDepth is absent', () => {
    const store = {
      'agent:main:subagent:a': { sessionId: 'a', spawnedBy: 'agent:main:main' },
      'agent:main:subagent:b': { sessionId: 'b', spawnedBy: 'agent:main:subagent:a' },
    };
    expect(getSubagentDepthFromSessionStore('agent:main:subagent:b', { store })).toBe(2);
  });

  it('falls back to the session-key shape when no store entry exists', () => {
    expect(getSubagentDepthFromSessionStore('agent:main:subagent:a', { store: {} })).toBe(
      getSubagentDepth('agent:main:subagent:a'),
    );
    expect(getSubagentDepthFromSessionStore(undefined, { store: {} })).toBe(0);
  });

  it('terminates on a spawnedBy cycle instead of recursing forever', () => {
    const store = {
      'agent:main:subagent:c': { sessionId: 'c', spawnedBy: 'agent:main:subagent:d' },
      'agent:main:subagent:d': { sessionId: 'd', spawnedBy: 'agent:main:subagent:c' },
    };
    const depth = getSubagentDepthFromSessionStore('agent:main:subagent:c', { store });
    expect(Number.isInteger(depth)).toBe(true);
    expect(depth).toBeGreaterThanOrEqual(1);
  });

  it('counts nested subagent segments in the session key', () => {
    expect(getSubagentDepth('agent:main:main')).toBe(0);
    expect(getSubagentDepth('agent:main:subagent:a')).toBe(1);
    expect(getSubagentDepth('agent:main:subagent:a:subagent:b')).toBe(2);
  });
});
describe("#179 spawn chain root (depth + origin on the row)", () => {
  it("returns the top-most ancestor reachable through spawnedBy", () => {
    const store = {
      'agent:main:subagent:a': { sessionId: 'a', spawnedBy: 'agent:main:main' },
      'agent:main:subagent:b': { sessionId: 'b', spawnedBy: 'agent:main:subagent:a' },
    };
    expect(getSubagentRootFromSessionStore('agent:main:subagent:b', { store })).toBe(
      'agent:main:main',
    );
  });

  it("returns undefined when the session has no recorded parent", () => {
    expect(getSubagentRootFromSessionStore('agent:main:main', { store: {} })).toBeUndefined();
    expect(getSubagentRootFromSessionStore(undefined, { store: {} })).toBeUndefined();
  });

  it("terminates on a spawnedBy cycle instead of looping forever", () => {
    const store = {
      'agent:main:subagent:c': { sessionId: 'c', spawnedBy: 'agent:main:subagent:d' },
      'agent:main:subagent:d': { sessionId: 'd', spawnedBy: 'agent:main:subagent:c' },
    };
    const root = getSubagentRootFromSessionStore('agent:main:subagent:c', { store });
    expect(root).toBeDefined();
    // Never reports the session as its own root.
    expect(root).not.toBe('agent:main:subagent:c');
  });
});
describe("child lookup matches the parent session key, not its UUID", () => {
  const parentKey = 'agent:main:main';

  it("matches spawnedBy against the parent key", () => {
    expect(isSpawnedByParentKey({ spawnedBy: parentKey }, parentKey)).toBe(true);
  });

  it("never matches a session UUID (the mismatch that emptied the briefing)", () => {
    // `attempt.ts` used to compare `spawnedBy` to `sessionEntry.sessionId`, so a
    // real child row could never be found.
    expect(
      isSpawnedByParentKey(
        { spawnedBy: 'e7c1f0a2-1111-4222-8333-444455556666' },
        parentKey,
      ),
    ).toBe(false);
  });

  it("accepts parentSessionKey for forked children", () => {
    expect(isSpawnedByParentKey({ parentSessionKey: parentKey }, parentKey)).toBe(true);
  });

  it("rejects missing or blank inputs", () => {
    expect(isSpawnedByParentKey(undefined, parentKey)).toBe(false);
    expect(isSpawnedByParentKey({ spawnedBy: parentKey }, '')).toBe(false);
    expect(isSpawnedByParentKey({}, parentKey)).toBe(false);
  });
});