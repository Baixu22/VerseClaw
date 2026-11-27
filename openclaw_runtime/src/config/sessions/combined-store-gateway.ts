// Builds the gateway-visible combined session store across agent-specific stores.
// Gateway callers need canonical per-agent keys even when stores are split by `{agentId}`.

import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import {
  canonicalizeSpawnedByForAgent,
  resolveStoredSessionKeyForAgentStore,
} from "../../gateway/session-store-key.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import type { OpenClawConfig } from "../types.openclaw.js";
import { resolveStorePath } from "./paths.js";
import { loadSessionStore } from "./store-load.js";
import { loadExistingSqliteSessionStoreReadOnly } from './store-sqlite.js';
import {
  resolveAgentSessionStoreTargetsSync,
  resolveAllAgentSessionStoreTargetsSync,
  resolveSessionStoreTargets,
} from "./targets.js";
import type { SessionEntry } from "./types.js";

// Template-backed stores need per-agent scans before they can be merged for Gateway views.
function isStorePathTemplate(store?: string): boolean {
  return typeof store === "string" && store.includes("{agentId}");
}

function mergeSessionEntryIntoCombined(params: {
  cfg: OpenClawConfig;
  combined: Record<string, SessionEntry>;
  entry: SessionEntry;
  agentId: string;
  canonicalKey: string;
  readOnly?: boolean;
}) {
  const { cfg, combined, entry, agentId, canonicalKey } = params;
  const existing = combined[canonicalKey];
  if (params.readOnly) {
    const selected = existing && (existing.updatedAt ?? 0) > (entry.updatedAt ?? 0) ? existing : entry;
    combined[canonicalKey] = { ...selected, spawnedBy: canonicalizeSpawnedByForAgent(cfg, agentId, selected.spawnedBy) };
    return;
  }

  if (existing && (existing.updatedAt ?? 0) > (entry.updatedAt ?? 0)) {
    // Preserve the freshest entry while still canonicalizing spawnedBy for this agent store.
    const spawnedBy = canonicalizeSpawnedByForAgent(
      cfg,
      agentId,
      existing.spawnedBy ?? entry.spawnedBy,
    );
    combined[canonicalKey] = {
      ...entry,
      ...existing,
      spawnedBy,
    };
    return;
  }

  const spawnedBy = canonicalizeSpawnedByForAgent(
    cfg,
    agentId,
    entry.spawnedBy ?? existing?.spawnedBy,
  );
  if (!existing && entry.spawnedBy === spawnedBy) {
    combined[canonicalKey] = entry;
  } else {
    combined[canonicalKey] = {
      ...existing,
      ...entry,
      spawnedBy,
    };
  }
}

/** Loads and canonicalizes session entries for gateway views across one or more agent stores. */
export function loadCombinedSessionStoreForGateway(
  cfg: OpenClawConfig,
  opts: { agentId?: string; configuredAgentsOnly?: boolean; readOnly?: boolean } = {},
): {
  storePath: string;
  store: Record<string, SessionEntry>;
} {
  const storeConfig = cfg.session?.store;
  const readStore = (storePath: string) => opts.readOnly ? loadExistingSqliteSessionStoreReadOnly(storePath) : loadSessionStore(storePath, { clone: false });
  if (storeConfig && !isStorePathTemplate(storeConfig)) {
    // A single shared store still needs keys canonicalized as if owned by the default agent.
    const storePath = resolveStorePath(storeConfig);
    const defaultAgentId = normalizeAgentId(resolveDefaultAgentId(cfg));
    const store = readStore(storePath);
    const combined: Record<string, SessionEntry> = {};
    for (const [key, entry] of Object.entries(store)) {
      const canonicalKey = resolveStoredSessionKeyForAgentStore({
        cfg,
        agentId: defaultAgentId,
        sessionKey: key,
      });
      mergeSessionEntryIntoCombined({
        cfg,
        combined,
        entry,
        agentId: defaultAgentId,
        canonicalKey,
        readOnly: opts.readOnly,
      });
    }
    return { storePath, store: combined };
  }

  const requestedAgentId =
    typeof opts.agentId === "string" && opts.agentId.trim()
      ? normalizeAgentId(opts.agentId)
      : undefined;
  const targets = requestedAgentId
    ? resolveAgentSessionStoreTargetsSync(cfg, requestedAgentId)
    : opts.configuredAgentsOnly === true
      ? resolveSessionStoreTargets(cfg, { allAgents: true })
      : resolveAllAgentSessionStoreTargetsSync(cfg);
  const combined: Record<string, SessionEntry> = {};
  for (const target of targets) {
    const agentId = target.agentId;
    const storePath = target.storePath;
    const store = readStore(storePath);
    for (const [key, entry] of Object.entries(store)) {
      const canonicalKey = resolveStoredSessionKeyForAgentStore({
        cfg,
        agentId,
        sessionKey: key,
      });
      mergeSessionEntryIntoCombined({
        cfg,
        combined,
        entry,
        agentId,
        canonicalKey,
        readOnly: opts.readOnly,
      });
    }
  }

  const storePath =
    targets.length === 1
      ? targets[0].storePath
      : typeof storeConfig === "string" && storeConfig.trim()
        ? storeConfig.trim()
        : "(multiple)";
  return { storePath, store: combined };
}
