import { describe, expect, it } from 'vitest';
import {
  MultiAgentBoundary,
  multiAgentBoundary,
} from '../src/collab/multi-agent-boundary';

describe('multi-agent session / tab isolation', () => {
  it('allows one agent to claim a session and rejects a second agent', () => {
    const b = new MultiAgentBoundary();
    const a = b.claim({ agentId: 'claude', sessionId: 's1' });
    expect(a.ok).toBe(true);
    const conflict = b.claim({ agentId: 'grok', sessionId: 's1' });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.code).toBe('E_AGENT_CONFLICT');
      expect(conflict.holder).toBe('claude');
    }
  });

  it('is idempotent for the same agent and refreshes lease', () => {
    const b = new MultiAgentBoundary();
    b.claim({ agentId: 'a', sessionId: 's', leaseMs: 1000 });
    const again = b.claim({ agentId: 'a', sessionId: 's', leaseMs: 60_000 });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.claim.agentId).toBe('a');
      expect(Date.parse(again.claim.expiresAt!)).toBeGreaterThan(Date.now() + 30_000);
    }
  });

  it('pins tabs: tab claim does not block other tabs of the same session', () => {
    const b = new MultiAgentBoundary();
    expect(b.claim({ agentId: 'a', sessionId: 's', tabId: 't1' }).ok).toBe(true);
    expect(b.claim({ agentId: 'b', sessionId: 's', tabId: 't2' }).ok).toBe(true);
    expect(b.claim({ agentId: 'c', sessionId: 's', tabId: 't1' }).ok).toBe(false);
  });

  it('session-level claim covers all tabs for the owner only', () => {
    const b = new MultiAgentBoundary();
    b.claim({ agentId: 'owner', sessionId: 's' });
    expect(() => b.assertMayAct('owner', 's', 't9')).not.toThrow();
    expect(() => b.assertMayAct('other', 's', 't9')).toThrow(/held by agent owner/u);
    try {
      b.assertMayAct('other', 's');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('E_AGENT_CONFLICT');
    }
  });

  it('requires an explicit claim before acting on a tab', () => {
    const b = new MultiAgentBoundary();
    try {
      b.assertMayAct('solo', 's', 't1');
      expect.unreachable();
    } catch (e) {
      expect((e as { code?: string }).code).toBe('E_TAB_NOT_CLAIMED');
    }
  });

  it('never steals a live claim even with force', () => {
    const b = new MultiAgentBoundary();
    b.claim({ agentId: 'first', sessionId: 's' });
    const forced = b.claim({ agentId: 'second', sessionId: 's', force: true });
    expect(forced.ok).toBe(false);
    if (!forced.ok) expect(forced.message).toMatch(/refusing to steal/u);
  });

  it('expires leases and allows re-claim after prune', () => {
    const b = new MultiAgentBoundary();
    b.claim({ agentId: 'a', sessionId: 's', leaseMs: 1 });
    // Force expiry
    const pruned = b.pruneExpired(Date.now() + 10_000);
    expect(pruned).toBeGreaterThanOrEqual(1);
    const again = b.claim({ agentId: 'b', sessionId: 's' });
    expect(again.ok).toBe(true);
  });

  /**
   * The overlap check used to be suppressed by *any* record at the exact key, including an
   * expired one: an agent whose tab lease had lapsed could re-claim that tab while another
   * agent held the whole session, and assertMayAct then allowed it - so the 'session-level
   * claim blocks all tabs' invariant leaked through the stale record (no prune required).
   */
  it('does not let an expired tab record defeat a live session-level claim', async () => {
    const b = new MultiAgentBoundary();
    expect(b.claim({ agentId: 'b', sessionId: 's', tabId: 't1', leaseMs: 1 }).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(b.claim({ agentId: 'a', sessionId: 's' }).ok).toBe(true);
    const reclaim = b.claim({ agentId: 'b', sessionId: 's', tabId: 't1' });
    expect(reclaim.ok, JSON.stringify(reclaim)).toBe(false);
    if (!reclaim.ok) {
      expect(reclaim.code).toBe('E_AGENT_CONFLICT');
      expect(reclaim.holder).toBe('a');
    }
    expect(() => b.assertMayAct('b', 's', 't1')).toThrow(/session held by agent a/u);
  });

  it('only the owner can release', () => {
    const b = new MultiAgentBoundary();
    b.claim({ agentId: 'a', sessionId: 's' });
    expect(() => b.release('b', 's')).toThrow(/claim held by a/u);
    expect(b.release('a', 's')).toBe(true);
    expect(b.listClaims()).toHaveLength(0);
  });

  it('decide() returns allow/deny without throwing', () => {
    const b = new MultiAgentBoundary();
    b.claim({ agentId: 'a', sessionId: 's' });
    expect(b.decide('a', 's')).toEqual({ decision: 'allow' });
    const deny = b.decide('b', 's');
    expect(deny.decision).toBe('deny');
    expect(deny.holder).toBe('a');
  });

  it('exports a process-wide singleton', () => {
    expect(multiAgentBoundary).toBeInstanceOf(MultiAgentBoundary);
  });
});
