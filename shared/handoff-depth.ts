/**
 * Handoff derivation depth + cycle guard.
 *
 * WHY THIS EXISTS (TF-0284 / issue #179). "Conversation relay" lets a session
 * spawn a fresh session that carries the current objective, blockers and
 * evidence forward. Nothing bounded how many times that could repeat: session A
 * relays to B, B relays to C, and every hop loses context and can hand a wrong
 * conclusion to the next one. The runtime already bounds SUB-AGENT spawn depth
 * (`getSubagentDepthFromSessionStore` in the spawn path), but the product-level
 * session handoff had no depth field and no ancestry check at all. A 1K-token
 * chain twenty hops deep is perfectly legal by tokens and still unbounded in
 * depth, which is a different axis from the parent-fork token admission.
 *
 * This module is the pure decision core: it reads the Task Ledger's
 * `handoff_from` links, walks the ancestry, and decides whether one more
 * derivation is allowed. The caller owns the side effects (refusing the hop and
 * telling the operator why), so the rule can be asserted without a UI.
 *
 * NOT A FROZEN DEFAULT. The limit is opt-in configuration with a documented
 * default; it is deliberately not a product lock.
 */

export const DEFAULT_MAX_HANDOFF_DEPTH = 3;

/** A `handoff_from` link as projected into the Task Ledger snapshot. */
export type HandoffLink = {
  sessionKey: string;
  relation?: string | null;
  sourceSessionKey?: string | null;
};

export type HandoffChain = {
  /** Ancestor session keys, root first. Excludes the session itself. */
  ancestors: string[];
  /** Depth of the session itself: 0 for a root session. */
  depth: number;
  /** True when the walk hit a repeated key instead of a root. */
  cycle: boolean;
};

export type HandoffDerivationDecision =
  | {
    allow: true;
    /** Depth the derived session WOULD have. */
    depth: number;
    parentSessionKey: string;
    rootSessionKey: string;
    ancestors: string[];
  }
  | {
    allow: false;
    reason: 'handoff_depth_exceeded' | 'handoff_cycle_detected';
    /** Depth the derived session WOULD have. */
    depth: number;
    maxDepth: number;
    error: string;
    ancestors: string[];
  };

/**
 * Resolves the configured limit. Anything that is not a positive integer falls
 * back to the default rather than disabling the bound: unreadable configuration
 * must not silently remove the only limit that exists.
 */
export function resolveMaxHandoffDepth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return DEFAULT_MAX_HANDOFF_DEPTH;
  }
  return Math.floor(value);
}

/**
 * Walks `handoff_from` links upward from `sessionKey` to the root.
 *
 * Only `handoff_from` links are followed: a fork is a different session, not a
 * relay, and following it would inflate the chain. The walk is bounded and
 * cycle-safe — a malformed link loop stops and reports `cycle` instead of
 * spinning.
 */
export function resolveHandoffChain(
  links: readonly HandoffLink[],
  sessionKey: string,
  options: { maxWalk?: number } = {},
): HandoffChain {
  const maxWalk = typeof options.maxWalk === 'number' && Number.isInteger(options.maxWalk) && options.maxWalk > 0
    ? options.maxWalk
    : 64;
  const parentOf = new Map<string, string>();
  for (const link of links) {
    if (link.relation !== 'handoff_from') continue;
    const child = typeof link.sessionKey === 'string' ? link.sessionKey.trim() : '';
    const parent = typeof link.sourceSessionKey === 'string' ? link.sourceSessionKey.trim() : '';
    if (!child || !parent || child === parent) continue;
    if (!parentOf.has(child)) parentOf.set(child, parent);
  }

  const ancestors: string[] = [];
  const seen = new Set<string>([sessionKey]);
  let cursor = parentOf.get(sessionKey);
  let cycle = false;
  while (cursor && ancestors.length < maxWalk) {
    if (seen.has(cursor)) {
      cycle = true;
      break;
    }
    seen.add(cursor);
    ancestors.push(cursor);
    cursor = parentOf.get(cursor);
  }
  ancestors.reverse();
  return { ancestors, depth: ancestors.length, cycle };
}

/**
 * Decides whether one more handoff derivation is allowed from `sessionKey`.
 *
 * Denies with an actionable message rather than a bare boolean so the caller
 * can surface something an operator can act on.
 */
export function evaluateHandoffDerivation(params: {
  links: readonly HandoffLink[];
  sessionKey: string;
  maxDepth?: unknown;
  maxWalk?: number;
}): HandoffDerivationDecision {
  const maxDepth = resolveMaxHandoffDepth(params.maxDepth);
  const chain = resolveHandoffChain(params.links, params.sessionKey, { maxWalk: params.maxWalk });
  const desiredDepth = chain.depth + 1;

  if (chain.cycle) {
    return {
      allow: false,
      reason: 'handoff_cycle_detected',
      depth: desiredDepth,
      maxDepth,
      error:
        'Handoff cycle detected: this session already appears in its own handoff ancestry '
        + `(${[...chain.ancestors, params.sessionKey].join(' -> ')}). `
        + 'Refusing to relay; continue in the current session.',
      ancestors: chain.ancestors,
    };
  }

  if (desiredDepth > maxDepth) {
    return {
      allow: false,
      reason: 'handoff_depth_exceeded',
      depth: desiredDepth,
      maxDepth,
      error:
        `Handoff depth ${desiredDepth} exceeds the configured maximum of ${maxDepth}. `
        + 'Converge in the current session instead of relaying again: keep the objective, unfinished work, '
        + 'dependencies and most recent evidence here.',
      ancestors: chain.ancestors,
    };
  }

  return {
    allow: true,
    depth: desiredDepth,
    parentSessionKey: params.sessionKey,
    rootSessionKey: chain.ancestors[0] ?? params.sessionKey,
    ancestors: chain.ancestors,
  };
}