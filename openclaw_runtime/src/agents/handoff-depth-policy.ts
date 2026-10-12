// FP-P1-179 (TF-0284): bound session handoff / subagent derivation depth and detect cycles.
//
// Neither relay path had a depth field or any ancestry check. The parent-fork admission
// that does exist (resolveParentForkDecision) caps TOKEN volume, which is a different
// axis: twenty derivations of 1K tokens each are perfectly legal by tokens and still an
// unbounded chain that loses context at every hop.
//
// This module is the decision core the handoff and spawn paths call. It is deliberately
// pure: the caller owns the ancestry (the session store) and the convergence behaviour
// (returning the work to the same controller), so the rule can be asserted in tests
// without standing up a session.

/**
 * Default, per the issue and TF-0284: beyond this depth a hop must converge back into the
 * same controller instead of deriving another session. Opt-in configuration may lower or
 * raise it; the value is NOT a frozen product default until a spec says so.
 */
export const DEFAULT_MAX_HANDOFF_DEPTH = 3;

export const HANDOFF_DENY_REASONS = [
  /** The hop would sit deeper than the configured limit. */
  "handoff_depth_exceeded",
  /** The target session already appears in the ancestor chain: A -> B -> A. */
  "handoff_cycle_detected",
] as const;
export type HandoffDenyReason = (typeof HANDOFF_DENY_REASONS)[number];

export type HandoffDepthDecision =
  | { allow: true; depth: number }
  | { allow: false; reason: HandoffDenyReason; detail: string; convergence: string };

/**
 * Resolves the configured limit. Anything not a positive integer falls back to the
 * default rather than disabling the bound: an unreadable config must not silently remove
 * the only limit that exists.
 */
export function resolveMaxHandoffDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return DEFAULT_MAX_HANDOFF_DEPTH;
  }
  return Math.floor(value);
}

/** The depth a derived session would have. Roots are 0, their children 1, and so on. */
export function nextHandoffDepth(parentDepth: unknown): number {
  if (typeof parentDepth !== "number" || !Number.isFinite(parentDepth) || parentDepth < 0) {
    return 0;
  }
  return Math.floor(parentDepth) + 1;
}

export function evaluateHandoffDepth(params: {
  /** Depth the derived session WOULD have (see nextHandoffDepth). */
  depth: number;
  /** Session key being derived, checked against the ancestry. */
  targetSessionKey?: string;
  /** Ancestor session keys, root first. The caller owns this list. */
  ancestorSessionKeys?: readonly string[];
  maxDepth?: number;
}): HandoffDepthDecision {
  const maxDepth = resolveMaxHandoffDepth(params.maxDepth);
  const depth = typeof params.depth === "number" && params.depth >= 0 ? Math.floor(params.depth) : 0;
  const ancestors = params.ancestorSessionKeys ?? [];

  if (params.targetSessionKey && ancestors.includes(params.targetSessionKey)) {
    return {
      allow: false,
      reason: "handoff_cycle_detected",
      detail:
        `session ${params.targetSessionKey} is already in the handoff ancestry ` +
        `(${ancestors.join(" -> ")})`,
      convergence:
        "Refuse the hop and continue in the current session: a handoff back into its own ancestry cannot make progress.",
    };
  }

  if (depth > maxDepth) {
    return {
      allow: false,
      reason: "handoff_depth_exceeded",
      detail: `handoff depth ${depth} exceeds the configured maximum of ${maxDepth}`,
      convergence:
        "Do not derive another session. Converge back into the same controller with a " +
        "recovery summary (goal, unfinished work, dependencies, most recent evidence) " +
        "marked with its depth, per TF-0284.",
    };
  }

  return { allow: true, depth };
}
