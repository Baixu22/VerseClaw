/**
 * Read-only session derivation lineage.
 *
 * Answers "where did this session come from, and can I prove each hop?" from
 * facts the runtime already persists. It owns no state: no receipt table, no
 * second lineage store, no write path. The existing fork fields and the
 * parent/spawn keys are the only inputs.
 *
 * Two rules make the answer honest:
 *   1. A hop exists only when the child entry names its parent. A missing
 *      parent entry is reported as `parent-missing`, never as "no parent".
 *   2. Traversal is bounded. A cycle or an over-long chain stops at the bound
 *      and is reported, rather than looping or silently truncating.
 */
export const SESSION_DERIVATION_SCHEMA = 'SessionDerivation/v1' as const;

export type SessionDerivationKind =
  | 'fork'
  | 'handoff'
  | 'spawn'
  | 'unknown';

export type SessionDerivationHopStatus =
  | 'resolved'
  | 'parent-missing'
  | 'cycle'
  | 'bound-exceeded';

export type SessionDerivationHop = {
  /** The session this hop was read from. */
  childSessionKey: string;
  childSessionId?: string;
  /** The parent key the child names, when it names one. */
  parentSessionKey?: string;
  kind: SessionDerivationKind;
  status: SessionDerivationHopStatus;
  /** Fork point, when the child recorded one. */
  forkedFromLeafId?: string;
  forkedFromTimestamp?: number;
  /** True when the parent entry itself was found in the store. */
  parentFound: boolean;
};

export type SessionDerivation = {
  schema: typeof SESSION_DERIVATION_SCHEMA;
  rootSessionKey: string;
  /** Hops ordered nearest-parent-first. */
  hops: SessionDerivationHop[];
  /** True when the walk stopped on a bound rather than a root. */
  truncated: boolean;
  /** Stages observed along the chain, so a reader does not re-derive them. */
  chain: Array<{ sessionKey: string; sessionId?: string; kind: SessionDerivationKind }>;
};

/** The facts one lineage hop reads from a session entry. */
export type SessionDerivationEntryFacts = {
  sessionId?: string | null;
  parentSessionKey?: string | null;
  spawnedBy?: string | null;
  forkedFromParent?: boolean | null;
  forkedFromLeafId?: string | null;
  forkedFromTimestamp?: number | null;
};

export type SessionDerivationInput = {
  rootSessionKey: string;
  /** Resolve a session key to its entry facts; `null` means "not found". */
  readEntry: (sessionKey: string) => SessionDerivationEntryFacts | null;
  /** Maximum hops to follow. Guards against a corrupt or cyclic store. */
  maxDepth?: number;
};

const DEFAULT_MAX_DEPTH = 8;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Classify one child entry's derivation kind and the parent key it names.
 *
 * Precedence matches the stage projection: a fork triple proves a fork, a
 * parent key without fork facts proves a handoff, and `spawnedBy` proves a
 * spawn. A child that names no parent at all is `unknown`, not a root.
 */
export function classifyDerivation(entry: SessionDerivationEntryFacts): {
  kind: SessionDerivationKind;
  parentSessionKey?: string;
} {
  const parentKey = nonEmpty(entry.parentSessionKey) ? entry.parentSessionKey.trim() : undefined;
  const spawnedBy = nonEmpty(entry.spawnedBy) ? entry.spawnedBy.trim() : undefined;

  if (entry.forkedFromParent === true || (nonEmpty(entry.forkedFromLeafId) && parentKey)) {
    return { kind: 'fork', ...(parentKey ? { parentSessionKey: parentKey } : {}) };
  }
  if (parentKey) return { kind: 'handoff', parentSessionKey: parentKey };
  if (spawnedBy) return { kind: 'spawn', parentSessionKey: spawnedBy };
  return { kind: 'unknown' };
}

/**
 * Walk the derivation chain upward from `rootSessionKey`.
 *
 * Pure: all I/O is the injected `readEntry`. The same store produces the same
 * derivation, and the function never mutates its inputs.
 */
export function deriveSessionLineage(input: SessionDerivationInput): SessionDerivation {
  const maxDepth = Number.isFinite(input.maxDepth) && (input.maxDepth as number) > 0
    ? Math.floor(input.maxDepth as number)
    : DEFAULT_MAX_DEPTH;

  const hops: SessionDerivationHop[] = [];
  const chain: SessionDerivation['chain'] = [];
  const visited = new Set<string>([input.rootSessionKey]);

  let currentKey = input.rootSessionKey;
  let truncated = false;
  let depth = 0;

  while (depth < maxDepth) {
    const entry = input.readEntry(currentKey);
    if (!entry) break;

    const { kind, parentSessionKey } = classifyDerivation(entry);
    chain.push({
      sessionKey: currentKey,
      ...(nonEmpty(entry.sessionId) ? { sessionId: entry.sessionId.trim() } : {}),
      kind,
    });

    if (!parentSessionKey) {
      // A root: nothing left to prove. This is not a gap in the facts.
      break;
    }

    if (visited.has(parentSessionKey)) {
      hops.push({
        childSessionKey: currentKey,
        ...(nonEmpty(entry.sessionId) ? { childSessionId: entry.sessionId.trim() } : {}),
        parentSessionKey,
        kind,
        status: 'cycle',
        ...(nonEmpty(entry.forkedFromLeafId) ? { forkedFromLeafId: entry.forkedFromLeafId.trim() } : {}),
        ...(typeof entry.forkedFromTimestamp === 'number' && entry.forkedFromTimestamp > 0
          ? { forkedFromTimestamp: entry.forkedFromTimestamp }
          : {}),
        parentFound: true,
      });
      break;
    }

    const parentEntry = input.readEntry(parentSessionKey);
    hops.push({
      childSessionKey: currentKey,
      ...(nonEmpty(entry.sessionId) ? { childSessionId: entry.sessionId.trim() } : {}),
      parentSessionKey,
      kind,
      status: parentEntry ? 'resolved' : 'parent-missing',
      ...(nonEmpty(entry.forkedFromLeafId) ? { forkedFromLeafId: entry.forkedFromLeafId.trim() } : {}),
      ...(typeof entry.forkedFromTimestamp === 'number' && entry.forkedFromTimestamp > 0
        ? { forkedFromTimestamp: entry.forkedFromTimestamp }
        : {}),
      parentFound: Boolean(parentEntry),
    });

    if (!parentEntry) break;

    visited.add(parentSessionKey);
    currentKey = parentSessionKey;
    depth += 1;
  }

  if (depth >= maxDepth) {
    // The loop ended because of the bound, not because it reached a root.
    const last = hops[hops.length - 1];
    if (last && last.status === 'resolved') {
      truncated = true;
      last.status = 'bound-exceeded';
    }
  }

  return {
    schema: SESSION_DERIVATION_SCHEMA,
    rootSessionKey: input.rootSessionKey,
    hops,
    truncated,
    chain,
  };
}
