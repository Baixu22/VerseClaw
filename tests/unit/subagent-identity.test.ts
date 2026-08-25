// A worker's name and face must be stable across renders and reloads, and
// spread across the pool — those are the two properties the UI depends on.
import { describe, expect, it } from 'vitest';
import { AGENT_AVATAR_BACKGROUNDS } from '@shared/agent-avatar';
import { subagentIdentity, subagentIdentityKey } from '@shared/subagent-identity';

describe('subagent identity', () => {
  it('gives the same worker the same name and face every time', () => {
    const first = subagentIdentity('agent:explorer:rail-scout');
    const second = subagentIdentity('agent:explorer:rail-scout');

    expect(second.name).toBe(first.name);
    expect(second.avatar.revision).toBe(first.avatar.revision);
    expect(second.avatar.preset).toEqual(first.avatar.preset);
  });

  it('separates two workers of the same role', () => {
    // A fan-out spawning two reviewers is exactly the case role names cannot
    // disambiguate, which is why this generator exists.
    const left = subagentIdentity('agent:reviewer:child-1');
    const right = subagentIdentity('agent:reviewer:child-2');

    expect(left.name).not.toBe(right.name);
    expect(left.avatar.revision).not.toBe(right.avatar.revision);
  });

  it('produces a renderable avatar preset', () => {
    const identity = subagentIdentity('agent:planner:child-9');

    expect(identity.avatar.kind).toBe('fallback');
    expect(identity.avatar.preset?.seed).toBe('agent:planner:child-9');
    expect(AGENT_AVATAR_BACKGROUNDS).toContain(identity.avatar.preset?.backgroundColor);
  });

  it('spreads names and colours across the pool rather than clustering', () => {
    const names = new Set<string>();
    const colours = new Set<string>();
    for (let index = 0; index < 40; index += 1) {
      const identity = subagentIdentity(`agent:worker:child-${index}`);
      names.add(identity.name);
      colours.add(identity.avatar.preset!.backgroundColor);
    }

    // Not asserting 40 distinct names — birthday collisions in a 48-entry pool
    // are expected. Asserting the hash is not degenerate.
    expect(names.size).toBeGreaterThan(20);
    expect(colours.size).toBeGreaterThan(3);
  });

  it('prefers the child session key so a status change cannot rename a worker', () => {
    const started = { id: 'node-1', agentId: 'explorer', childSessionKey: 'agent:explorer:child-1' };
    const completed = { id: 'node-1', childSessionKey: 'agent:explorer:child-1' };

    expect(subagentIdentityKey(started)).toBe('agent:explorer:child-1');
    expect(subagentIdentityKey(completed)).toBe(subagentIdentityKey(started));
  });

  it('falls back through agent id to roster id when there is no child session', () => {
    expect(subagentIdentityKey({ id: 'node-2', agentId: 'reviewer' })).toBe('reviewer');
    expect(subagentIdentityKey({ id: 'node-3' })).toBe('node-3');
    expect(subagentIdentityKey({})).toBe('subagent');
  });
});
