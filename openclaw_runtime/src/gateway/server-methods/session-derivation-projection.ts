/**
 * Read-only derivation lineage for the activity snapshot.
 *
 * The only inputs are the session store the gateway already loads. This module
 * adds no receipt table, no write path, and no second lineage owner: it reads
 * `parentSessionKey` / `spawnedBy` / the fork fields that fork and handoff
 * already persist, and reports the chain with its gaps named honestly.
 */
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { loadCombinedSessionStoreForGateway } from "../../config/sessions/combined-store-gateway.js";
import {
  deriveSessionLineage,
  type SessionDerivation,
  type SessionDerivationEntryFacts,
} from "../../../../shared/types/session-derivation.js";

/** Build a lineage reader over one combined session store snapshot. */
export function readSessionDerivation(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  maxDepth?: number;
}): SessionDerivation {
  const { store } = loadCombinedSessionStoreForGateway(params.cfg);
  const readEntry = (sessionKey: string): SessionDerivationEntryFacts | null => {
    const entry = store[sessionKey];
    if (!entry) return null;
    return {
      sessionId: entry.sessionId ?? null,
      parentSessionKey: entry.parentSessionKey ?? null,
      spawnedBy: entry.spawnedBy ?? null,
      forkedFromParent: entry.forkedFromParent ?? null,
      forkedFromLeafId: entry.forkedFromLeafId ?? null,
      forkedFromTimestamp: entry.forkedFromTimestamp ?? null,
    };
  };
  return deriveSessionLineage({
    rootSessionKey: params.sessionKey,
    readEntry,
    ...(params.maxDepth !== undefined ? { maxDepth: params.maxDepth } : {}),
  });
}
