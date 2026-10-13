/** Persisted session lineage owns relay depth; callers must reject failed ledger reads. */
export const DEFAULT_MAX_HANDOFF_DEPTH = 3;
const MAX_ANCESTOR_WALK = 64;

export type HandoffLink = {
  id?: string;
  sessionKey: string;
  relation?: string | null;
  sourceSessionKey?: string | null;
};
export type HandoffChain = {
  ancestors: string[];
  depth: number;
  cycle: boolean;
  incomplete: boolean;
  parentHandoffId?: string;
  rootHandoffId?: string;
};
export type HandoffDerivationDecision = HandoffChain & (
  | { allow: true; parentSessionKey: string; rootSessionKey: string }
  | { allow: false; reason: 'handoff_depth_exceeded' | 'handoff_cycle_detected' | 'handoff_ancestry_unavailable'; maxDepth: number; error: string }
);

export function resolveMaxHandoffDepth(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ANCESTOR_WALK
    ? value : DEFAULT_MAX_HANDOFF_DEPTH;
}

/** Forks preserve ancestry without increasing relay depth. Self-links are cycles. */
export function resolveHandoffChain(
  links: readonly HandoffLink[], sessionKey: string, options: { maxWalk?: number } = {},
): HandoffChain {
  const limit = Math.min(resolveMaxHandoffDepth(options.maxWalk ?? MAX_ANCESTOR_WALK), MAX_ANCESTOR_WALK);
  const parents = new Map<string, HandoffLink>();
  const conflicts = new Set<string>();
  for (const link of links) {
    if (link.relation !== 'handoff_from' && link.relation !== 'forked_from') continue;
    const key = link.sessionKey.trim();
    const prior = parents.get(key);
    if (prior && (prior.sourceSessionKey !== link.sourceSessionKey || prior.relation !== link.relation)) conflicts.add(key);
    if (!prior) parents.set(key, link);
  }
  const chain: HandoffChain = { ancestors: [], depth: 0, cycle: false, incomplete: false };
  const seen = new Set<string>();
  let cursor = sessionKey.trim();
  while (true) {
    if (seen.has(cursor)) { chain.cycle = true; break; }
    if (conflicts.has(cursor)) { chain.incomplete = true; break; }
    const link = parents.get(cursor);
    if (!link) break;
    if (chain.ancestors.length >= limit || !link.sourceSessionKey?.trim()) { chain.incomplete = true; break; }
    seen.add(cursor);
    if (link.relation === 'handoff_from') {
      chain.depth += 1;
      chain.parentHandoffId ??= link.id;
      chain.rootHandoffId = link.id;
    }
    cursor = link.sourceSessionKey.trim();
    chain.ancestors.push(cursor);
  }
  chain.ancestors.reverse();
  return chain;
}

export function evaluateHandoffDerivation(params: {
  links: readonly HandoffLink[]; sessionKey: string; maxDepth?: unknown; maxWalk?: number; enforceDepth?: boolean;
}): HandoffDerivationDecision {
  const chain = resolveHandoffChain(params.links, params.sessionKey, { maxWalk: params.maxWalk });
  const depth = chain.depth + 1;
  const maxDepth = resolveMaxHandoffDepth(params.maxDepth);
  const reason = chain.cycle ? 'handoff_cycle_detected' : chain.incomplete ? 'handoff_ancestry_unavailable'
    : params.enforceDepth !== false && depth > maxDepth ? 'handoff_depth_exceeded' : undefined;
  if (reason) {
    const error = reason === 'handoff_cycle_detected' ? 'Handoff cycle detected.'
      : reason === 'handoff_ancestry_unavailable' ? 'Handoff ancestry unavailable or inconsistent.'
        : `Handoff depth ${depth} exceeds the configured maximum of ${maxDepth}.`;
    return { ...chain, allow: false, reason, depth, maxDepth, error: `${error} Continue in the current session with the objective, unfinished work, dependencies and recent evidence.` };
  }
  return { ...chain, allow: true, depth, parentSessionKey: params.sessionKey, rootSessionKey: chain.ancestors[0] ?? params.sessionKey };
}
