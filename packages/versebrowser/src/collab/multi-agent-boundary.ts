/**
 * Multi-agent session / tab isolation (TF-0057).
 *
 * Multiple harnesses may share one workspace. This registry enforces:
 * - one active agent claim per session (and optional tab)
 * - tab pinning: an agent may only act on tabs it claimed
 * - lease expiry so abandoned claims do not deadlock the workspace
 *
 * Conflicts fail closed with `E_AGENT_CONFLICT` / `E_TAB_NOT_CLAIMED`.
 * Never mutates browser state — policy only.
 */
import { randomUUID } from 'node:crypto';

export type AgentId = string;

export type SessionClaim = {
  id: string;
  agentId: AgentId;
  sessionId: string;
  /** Optional tab pin; omit to claim the whole session. */
  tabId?: string;
  claimedAt: string;
  expiresAt?: string;
};

export type ClaimInput = {
  agentId: AgentId;
  sessionId: string;
  tabId?: string;
  /** Lease duration in ms; omit for no expiry (host must release). */
  leaseMs?: number;
  /** Force-take an expired claim. Never steals a live claim. */
  force?: boolean;
};

export type ClaimResult =
  | { ok: true; claim: SessionClaim }
  | { ok: false; code: 'E_AGENT_CONFLICT' | 'E_AGENT_ID'; message: string; holder?: AgentId };

export type BoundaryDecision = 'allow' | 'deny';

export function multiAgentBoundaryError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): Error {
  return Object.assign(new Error(message), { code, ...details });
}

function now(): string {
  return new Date().toISOString();
}

function isActive(claim: SessionClaim, atMs: number): boolean {
  if (!claim.expiresAt) return true;
  return Date.parse(claim.expiresAt) > atMs;
}

export class MultiAgentBoundary {
  private readonly claims = new Map<string, SessionClaim>();

  private key(sessionId: string, tabId?: string): string {
    return tabId === undefined ? `session:${sessionId}` : `tab:${sessionId}#${tabId}`;
  }

  private findLiveHolders(sessionId: string, tabId?: string, atMs = Date.now()): SessionClaim[] {
    const holders: SessionClaim[] = [];
    for (const claim of this.claims.values()) {
      if (claim.sessionId !== sessionId) continue;
      if (!isActive(claim, atMs)) continue;
      // Session-level claim blocks all tabs; tab claim blocks only that tab.
      if (tabId === undefined || claim.tabId === undefined || claim.tabId === tabId) {
        holders.push(claim);
      }
    }
    return holders;
  }

  /**
   * Claim a session (and optional tab) for one agent.
   * Fails if another live agent already holds the overlapping claim.
   */
  claim(input: ClaimInput): ClaimResult {
    const agentId = String(input.agentId ?? '').trim();
    if (!agentId) {
      return { ok: false, code: 'E_AGENT_ID', message: 'agentId is required for multi-agent boundary' };
    }
    const sessionId = String(input.sessionId ?? '').trim();
    if (!sessionId) {
      return { ok: false, code: 'E_AGENT_ID', message: 'sessionId is required' };
    }

    const at = Date.now();
    const key = this.key(sessionId, input.tabId);
    const existing = this.claims.get(key);

    if (existing && isActive(existing, at)) {
      if (existing.agentId === agentId) {
        // Idempotent re-claim by same agent refreshes lease.
        const refreshed: SessionClaim = {
          ...existing,
          ...(input.leaseMs ? { expiresAt: new Date(at + input.leaseMs).toISOString() } : {}),
        };
        this.claims.set(key, refreshed);
        return { ok: true, claim: refreshed };
      }
      if (!input.force) {
        return {
          ok: false,
          code: 'E_AGENT_CONFLICT',
          message: `session/tab already claimed by agent ${existing.agentId}`,
          holder: existing.agentId,
        };
      }
      // force only allowed when expired — live claims never stolen
      return {
        ok: false,
        code: 'E_AGENT_CONFLICT',
        message: `refusing to steal live claim from ${existing.agentId}; wait for release or lease expiry`,
        holder: existing.agentId,
      };
    }

    // Also block when a session-level claim exists and we try a tab claim (or vice versa).
    // This must run even when an *expired* claim still sits at this exact key: the stale
    // record used to suppress the overlap check, so an agent whose tab lease had lapsed
    // could re-claim that tab while another agent held the whole session - the
    // 'session-level claim blocks all tabs' invariant leaked through the expired record.
    const holders = this.findLiveHolders(sessionId, input.tabId, at).filter((c) => c.agentId !== agentId);
    if (holders.length > 0) {
      const holder = holders[0]!;
      return {
        ok: false,
        code: 'E_AGENT_CONFLICT',
        message: `overlapping claim held by agent ${holder.agentId}`,
        holder: holder.agentId,
      };
    }

    const claim: SessionClaim = {
      id: randomUUID(),
      agentId,
      sessionId,
      ...(input.tabId !== undefined ? { tabId: input.tabId } : {}),
      claimedAt: now(),
      ...(input.leaseMs ? { expiresAt: new Date(at + input.leaseMs).toISOString() } : {}),
    };
    this.claims.set(key, claim);
    return { ok: true, claim };
  }

  /**
   * Assert the agent may act on this session/tab. Throws `E_AGENT_CONFLICT`
   * or `E_TAB_NOT_CLAIMED` when the actor is not the live holder.
   */
  assertMayAct(agentId: AgentId, sessionId: string, tabId?: string): void {
    const at = Date.now();
    const key = this.key(sessionId, tabId);
    const exact = this.claims.get(key);
    if (exact && isActive(exact, at)) {
      if (exact.agentId === agentId) return;
      throw multiAgentBoundaryError(
        'E_AGENT_CONFLICT',
        `held by agent ${exact.agentId}; ${agentId} may not act`,
        { holder: exact.agentId },
      );
    }

    // Session-level claim covers all tabs for the same agent.
    const sessionClaim = this.claims.get(this.key(sessionId));
    if (sessionClaim && isActive(sessionClaim, at)) {
      if (sessionClaim.agentId === agentId) return;
      throw multiAgentBoundaryError(
        'E_AGENT_CONFLICT',
        `session held by agent ${sessionClaim.agentId}`,
        { holder: sessionClaim.agentId },
      );
    }

    if (tabId !== undefined) {
      // No claim at all: require explicit tab pin for multi-agent safety.
      const anyTab = this.findLiveHolders(sessionId, tabId, at);
      if (anyTab.length === 0) {
        throw multiAgentBoundaryError(
          'E_TAB_NOT_CLAIMED',
          `tab ${tabId} is not claimed by ${agentId}; claim before acting`,
          { sessionId, tabId, agentId },
        );
      }
    }
  }

  /** Release a claim. Only the owner (or empty) can release. */
  release(agentId: AgentId, sessionId: string, tabId?: string): boolean {
    const key = this.key(sessionId, tabId);
    const claim = this.claims.get(key);
    if (!claim) return false;
    if (claim.agentId !== agentId) {
      throw multiAgentBoundaryError(
        'E_AGENT_CONFLICT',
        `claim held by ${claim.agentId}, not ${agentId}`,
        { holder: claim.agentId },
      );
    }
    this.claims.delete(key);
    return true;
  }

  /** Drop expired claims (housekeeping). */
  pruneExpired(atMs = Date.now()): number {
    let n = 0;
    for (const [key, claim] of this.claims) {
      if (!isActive(claim, atMs)) {
        this.claims.delete(key);
        n += 1;
      }
    }
    return n;
  }

  listClaims(): SessionClaim[] {
    return [...this.claims.values()];
  }

  /** Policy check without throwing. */
  decide(agentId: AgentId, sessionId: string, tabId?: string): {
    decision: BoundaryDecision;
    code?: string;
    holder?: AgentId;
  } {
    try {
      this.assertMayAct(agentId, sessionId, tabId);
      return { decision: 'allow' };
    } catch (error) {
      const e = error as { code?: string; holder?: AgentId };
      return {
        decision: 'deny',
        ...(e.code ? { code: e.code } : {}),
        ...(e.holder ? { holder: e.holder } : {}),
      };
    }
  }
}

/** Process-wide default registry (hosts may construct their own). */
export const multiAgentBoundary = new MultiAgentBoundary();
