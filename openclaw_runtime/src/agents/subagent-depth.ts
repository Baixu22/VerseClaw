/**
 * Subagent spawn-depth lookup helpers.
 *
 * Reads persisted session store state to recover spawn depth and parent lineage across restarts.
 */
import { resolveStorePath } from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store-load.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { parseStrictNonNegativeInteger } from "../infra/parse-finite-number.js";
import { getSubagentDepth, parseAgentSessionKey } from "../sessions/session-key-utils.js";
import { resolveDefaultAgentId } from "./agent-scope.js";
import { normalizeSubagentSessionKey } from "./subagent-session-key.js";

type SessionDepthEntry = {
  sessionId?: unknown;
  spawnDepth?: unknown;
  spawnedBy?: unknown;
};

function normalizeSpawnDepth(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === "string") {
    return parseStrictNonNegativeInteger(value);
  }
  return undefined;
}

function readSessionStore(storePath: string): Record<string, SessionDepthEntry> {
  try {
    return loadSessionStore(storePath, { skipCache: true }) as Record<string, SessionDepthEntry>;
  } catch {
    return {};
  }
}

function buildKeyCandidates(rawKey: string, cfg?: OpenClawConfig): string[] {
  if (!cfg) {
    return [rawKey];
  }
  if (rawKey === "global" || rawKey === "unknown") {
    return [rawKey];
  }
  if (parseAgentSessionKey(rawKey)) {
    return [rawKey];
  }
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const prefixed = `agent:${defaultAgentId}:${rawKey}`;
  return prefixed === rawKey ? [rawKey] : [rawKey, prefixed];
}

function findEntryBySessionId(
  store: Record<string, SessionDepthEntry>,
  sessionId: string,
): SessionDepthEntry | undefined {
  const normalizedSessionId = normalizeSubagentSessionKey(sessionId);
  if (!normalizedSessionId) {
    return undefined;
  }
  for (const entry of Object.values(store)) {
    const candidateSessionId = normalizeSubagentSessionKey(entry?.sessionId);
    if (candidateSessionId && candidateSessionId === normalizedSessionId) {
      return entry;
    }
  }
  return undefined;
}

function resolveEntryForSessionKey(params: {
  sessionKey: string;
  cfg?: OpenClawConfig;
  store?: Record<string, SessionDepthEntry>;
  cache: Map<string, Record<string, SessionDepthEntry>>;
}): SessionDepthEntry | undefined {
  const candidates = buildKeyCandidates(params.sessionKey, params.cfg);

  if (params.store) {
    for (const key of candidates) {
      const entry = params.store[key];
      if (entry) {
        return entry;
      }
    }
    return findEntryBySessionId(params.store, params.sessionKey);
  }

  if (!params.cfg) {
    return undefined;
  }

  for (const key of candidates) {
    const parsed = parseAgentSessionKey(key);
    if (!parsed?.agentId) {
      continue;
    }
    const storePath = resolveStorePath(params.cfg.session?.store, { agentId: parsed.agentId });
    let store = params.cache.get(storePath);
    if (!store) {
      store = readSessionStore(storePath);
      params.cache.set(storePath, store);
    }
    const entry = store[key] ?? findEntryBySessionId(store, params.sessionKey);
    if (entry) {
      return entry;
    }
  }

  return undefined;
}

/**
 * #179: the top-most ancestor session key reachable from `sessionKey` through
 * `spawnedBy` links, or `undefined` when the session has no recorded parent.
 *
 * Reads the same persisted store as the depth lookup (restart-safe) and is
 * cycle-safe: a corrupt `spawnedBy` loop terminates instead of recursing. The
 * result is the chain's origin, which is what a session-event consumer needs to
 * group spawned sessions without walking the chain itself.
 */
export function getSubagentRootFromSessionStore(
  sessionKey: string | undefined | null,
  opts?: {
    cfg?: OpenClawConfig;
    store?: Record<string, SessionDepthEntry>;
  },
): string | undefined {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return undefined;
  }
  const cache = new Map<string, Record<string, SessionDepthEntry>>();
  const visited = new Set<string>();
  let current = normalizeSubagentSessionKey(raw);
  let root: string | undefined;
  while (current && !visited.has(current)) {
    visited.add(current);
    const entry = resolveEntryForSessionKey({
      sessionKey: current,
      cfg: opts?.cfg,
      store: opts?.store,
      cache,
    });
    const parent = normalizeSubagentSessionKey(entry?.spawnedBy);
    if (!parent || visited.has(parent)) {
      break;
    }
    root = parent;
    current = parent;
  }
  return root;
}

/**
 * Whether a session-store row is a child of `parentKey`.
 *
 * A spawned session records its parent's **session key** in `spawnedBy` (see
 * `SessionEntry.spawnedBy`), not the parent's transcript UUID — so comparing
 * `spawnedBy` against a `sessionId` can never match. That mismatch silently
 * produced fallback-model briefings which claimed there were no active
 * subordinates. Forked sessions use `parentSessionKey` instead, so both links
 * are accepted here, matching `isDirectChildSessionEntry` in the gateway.
 */
export function isSpawnedByParentKey(
  entry: { spawnedBy?: unknown; parentSessionKey?: unknown } | undefined | null,
  parentKey: string | undefined | null,
): boolean {
  const key = (parentKey ?? "").trim();
  if (!key || !entry) {
    return false;
  }
  const spawnedBy = typeof entry.spawnedBy === "string" ? entry.spawnedBy.trim() : "";
  const parentSessionKey =
    typeof entry.parentSessionKey === "string" ? entry.parentSessionKey.trim() : "";
  return spawnedBy === key || parentSessionKey === key;
}

export function getSubagentDepthFromSessionStore(
  sessionKey: string | undefined | null,
  opts?: {
    cfg?: OpenClawConfig;
    store?: Record<string, SessionDepthEntry>;
  },
): number {
  const raw = (sessionKey ?? "").trim();
  const fallbackDepth = getSubagentDepth(raw);
  if (!raw) {
    return fallbackDepth;
  }

  const cache = new Map<string, Record<string, SessionDepthEntry>>();
  const visited = new Set<string>();

  const depthFromStore = (key: string): number | undefined => {
    const normalizedKey = normalizeSubagentSessionKey(key);
    if (!normalizedKey) {
      return undefined;
    }
    if (visited.has(normalizedKey)) {
      return undefined;
    }
    visited.add(normalizedKey);

    const entry = resolveEntryForSessionKey({
      sessionKey: normalizedKey,
      cfg: opts?.cfg,
      store: opts?.store,
      cache,
    });

    const storedDepth = normalizeSpawnDepth(entry?.spawnDepth);
    if (storedDepth !== undefined) {
      return storedDepth;
    }

    const spawnedBy = normalizeSubagentSessionKey(entry?.spawnedBy);
    if (!spawnedBy) {
      return undefined;
    }

    const parentDepth = depthFromStore(spawnedBy);
    if (parentDepth !== undefined) {
      return parentDepth + 1;
    }

    return getSubagentDepth(spawnedBy) + 1;
  };

  return depthFromStore(raw) ?? fallbackDepth;
}
