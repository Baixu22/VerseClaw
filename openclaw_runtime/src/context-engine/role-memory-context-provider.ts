// Role Memory Context Provider.
//
// Exposes Role Memory's existing `buildContextPack` output as a
// `RuntimeContextProvider` (the same interface `memory-context-provider.ts`
// implements), so ordinary chat turns can receive role-memory cards through
// the identical context-provider seam Runtime Memory uses.
//
// Design (area-4-role-memory-completion.md §3.2): federate, don't unify.
// This provider does *not* re-implement retrieval — it calls `getMemoryCards`
// + `buildContextPack` exactly as `role-spawn.ts:116-159` does today, then
// adapts `ContextPack` buckets into `ContextItem`s. Activation is governed by
// the chat-turn injection pilot flag (`runtimeMemory.injectPilot`, §3.4); the
// provider is registered alongside `RUNTIME_MEMORY_CONTEXT_PROVIDER_ID` and
// only queried when the pilot is on.
//
// Error handling mirrors `role-spawn.ts:142-153`: any store/pack failure
// returns an empty provider result and never blocks the turn.

import {
  ensureMemoryCardsLoaded,
  getMemoryCards,
  isMemoryStoreConfigured,
  isRoleMemoryEnabled,
  listMemoryConflicts,
  recordMemoryInjection,
} from "../memory/memory-store.js";
import { isInjectableMemoryCard } from "../memory/memory-card.js";
import { buildContextPack } from "../memory/context-pack.js";
import type {
  ContextPack,
  ContextPackBucketName,
  MemoryCard,
} from "../memory/types.js";
import type {
  ContextItem,
  ContextItemPriority,
  EvidenceRef,
  RuntimeContextProvider,
  RuntimeContextProviderExtras,
  RuntimeContextProviderQuery,
  RuntimeContextProviderResult,
  RuntimeCoreJsonObject,
  RuntimeRegistryDiagnostic,
  RuntimeRegistryDiagnosticReason,
} from "../runtime-core/index.js";

export const ROLE_MEMORY_CONTEXT_PROVIDER_ID = "role-memory";

const DEFAULT_TOKEN_BUDGET = 512;
const TOKEN_CHAR_WIDTH = 4;

const PROVIDER_EVIDENCE_REF: EvidenceRef = {
  type: "other",
  ref: ROLE_MEMORY_CONTEXT_PROVIDER_ID,
  label: "Role memory context provider",
};

const BUCKET_PRIORITY: Record<ContextPackBucketName, ContextItemPriority> = {
  hardConstraints: "P0",
  openConflicts: "P0",
  rolePlaybook: "P1",
  projectFacts: "P1",
  teamHandoffs: "P1",
  taskState: "P1",
  recentEpisodes: "P2",
};

const BUCKET_LABEL: Record<ContextPackBucketName, string> = {
  hardConstraints: "Hard Constraints",
  rolePlaybook: "Role Playbook",
  projectFacts: "Project Facts",
  teamHandoffs: "Team Handoffs",
  recentEpisodes: "Recent Episodes",
  openConflicts: "Open Conflicts",
  taskState: "Task State",
};

export type RoleMemoryContextProviderOptions = {
  // Resolves which role identity applies to this turn (Area 1 taxonomy):
  // for a main-agent chat turn, the Agent's persona-derived role name or 'main';
  // for a role-spawned subagent, RoleContract.name (already available).
  resolveRoleName: (query: RuntimeContextProviderQuery) => string | undefined;
  defaultTokenBudget?: number; // reuse ContextPackBudget.total, default 512
};

export function createRoleMemoryContextProvider(
  opts: RoleMemoryContextProviderOptions,
): RuntimeContextProvider {
  const manifest = {
    id: ROLE_MEMORY_CONTEXT_PROVIDER_ID,
    kind: "context" as const,
    title: "Role Memory Context Provider",
    description:
      "Budgeted role-tagged memory cards (governance-curated) exposed as context items for chat-turn injection.",
    source: "runtime-core" as const,
    capabilities: ["context.memory", "context.role-memory"],
    priority: 80,
    order: 80,
    permission: {
      decision: "allow" as const,
      capability: "context.memory",
      reason:
        "Readonly budgeted role memory packs only; no completion, verifier, tool, retry, security, or runtime authority.",
    },
    enabledByDefault: false,
    shadowOnly: false,
    fallbackReasons: [
      "flag_disabled" as const,
      "no_result" as const,
      "provider_error" as const,
    ],
    evidenceRefs: [
      {
        type: "file" as const,
        ref: "openclaw_runtime/src/context-engine/role-memory-context-provider.ts",
      },
    ],
    outputKinds: ["memory" as const, "evidence" as const],
    dependsOnIndexing: false,
    metadata: {
      readonlyMemoryContext: true,
      governanceCurated: true,
      noMemoryDump: true,
      noCompletionAuthority: true,
      noVerifierAuthority: true,
      noSecurityAuthority: true,
      noRetryAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
    },
  };

  return {
    manifest,
    async getContext(
      query: RuntimeContextProviderQuery,
      extras?: RuntimeContextProviderExtras,
    ): Promise<RuntimeContextProviderResult> {
      // Gate 1: Role Memory system disabled (env or store not configured).
      if (!isRoleMemoryEnabled() || !isMemoryStoreConfigured()) {
        return fallbackResult({
          reason: "flag_disabled",
          message: "Role memory is disabled or store is not configured.",
          metadata: {
            providerId: manifest.id,
            enabled: false,
            legacyBehaviorUnaffected: true,
            requiredFlag: "OPENCLAW_ROLE_MEMORY_ENABLED",
          },
        });
      }

      // Gate 2: Resolve role identity for this turn.
      let roleName: string | undefined;
      try {
        roleName = opts.resolveRoleName(query);
      } catch {
        roleName = undefined;
      }
      if (!roleName) {
        return fallbackResult({
          reason: "no_result",
          message:
            "No role identity resolved for this turn; role memory injection skipped.",
          metadata: {
            providerId: manifest.id,
            enabled: false,
            legacyBehaviorUnaffected: true,
          },
        });
      }

      // Load cards (mirror role-spawn.ts:162-177 resolveRoleMemoryCards).
      let cards: MemoryCard[] = [];
      try {
        ensureMemoryCardsLoaded();
        cards = getMemoryCards({ roleName, status: "all" }).filter(
          (card) => card.status === "active" || card.status === "cold",
        );
      } catch {
        // Store unavailable — skip injection gracefully (mirror role-spawn.ts:170-173).
        return fallbackResult({
          reason: "provider_error",
          message: "Role memory store could not be loaded; injection skipped.",
          metadata: {
            providerId: manifest.id,
            roleName,
            legacyBehaviorUnaffected: true,
          },
        });
      }

      // Filter injectable cards (mirror role-spawn.ts:124-127).
      const injectable = cards.filter(
        (card) =>
          isInjectableMemoryCard(card) ||
          (card.status === "cold" && !card.supersededBy),
      );
      if (injectable.length === 0) {
        return fallbackResult({
          reason: "no_result",
          message: "No injectable role memory cards for this role.",
          metadata: {
            providerId: manifest.id,
            roleName,
            cardCount: cards.length,
          },
        });
      }

      // Build context pack (mirror role-spawn.ts:128-141).
      let pack: ContextPack;
      try {
        const openConflictRecords = listMemoryConflicts({ status: "open" });
        const openConflicts = openConflictRecords.map(
          (conflict) => `${conflict.type}: ${conflict.reason}`,
        );
        const totalBudget = Math.max(
          1,
          Math.floor(
            query.tokenBudget ??
              opts.defaultTokenBudget ??
              DEFAULT_TOKEN_BUDGET,
          ),
        );
        pack = buildContextPack({
          memories: injectable,
          roleName,
          taskState: query.goal,
          openConflicts,
          openConflictCardIds: openConflictRecords.flatMap(
            (conflict) => conflict.cardIds,
          ),
          budget: { total: totalBudget },
        });
      } catch {
        // Pack assembly failure — never block the turn (mirror role-spawn.ts:142-153).
        return fallbackResult({
          reason: "provider_error",
          message: "Role memory context pack assembly failed; injection skipped.",
          metadata: {
            providerId: manifest.id,
            roleName,
            cardCount: injectable.length,
            legacyBehaviorUnaffected: true,
          },
        });
      }

      // Adapt buckets to ContextItems.
      const contextItems = adaptPackToContextItems(pack, roleName);
      if (contextItems.length === 0) {
        return fallbackResult({
          reason: "no_result",
          message: "Role memory context pack produced no non-empty buckets.",
          metadata: {
            providerId: manifest.id,
            roleName,
            cardCount: injectable.length,
            truncated: pack.truncated,
          },
        });
      }

      // Record injection (best-effort, mirror role-spawn.ts:142-153).
      const sessionKey = resolveSessionKey(query, extras);
      try {
        recordMemoryInjection({
          roleName,
          task: query.goal,
          sessionKey,
          cards: injectable,
          reasons: Object.fromEntries(
            injectable.map((card) => [
              card.id,
              `role=${roleName}; scope=${card.scope}; provider=${ROLE_MEMORY_CONTEXT_PROVIDER_ID}`,
            ]),
          ),
          pack,
        });
      } catch {
        // Injection explain logging is best-effort and must never block a turn.
      }

      return {
        status: "success",
        contextItems,
        diagnostics: [
          {
            surface: "context",
            providerId: ROLE_MEMORY_CONTEXT_PROVIDER_ID,
            status: "ok",
            reason: "registered",
            message: `Injected ${injectable.length} role memory card(s) across ${contextItems.length} bucket(s).`,
            evidenceRefs: [PROVIDER_EVIDENCE_REF],
            metadata: {
              providerId: manifest.id,
              roleName,
              cardCount: injectable.length,
              bucketCount: contextItems.length,
              truncated: pack.truncated,
              totalEstimatedTokens: pack.estimatedTokens.total,
              budgetTotal: pack.budget.total,
            },
          },
        ],
        evidenceRefs: uniqueEvidenceRefs([
          ...manifest.evidenceRefs,
          PROVIDER_EVIDENCE_REF,
          ...contextItems.flatMap((item) => item.evidenceRefs),
        ]),
        metadata: {
          providerId: manifest.id,
          roleName,
          cardCount: injectable.length,
          bucketCount: contextItems.length,
          truncated: pack.truncated,
          estimatedTokens: pack.estimatedTokens.total,
          budgetTotal: pack.budget.total,
          source: "role-memory",
        },
      };
    },
  };
}

function adaptPackToContextItems(
  pack: ContextPack,
  roleName: string,
): ContextItem[] {
  const items: ContextItem[] = [];
  const bucketNames = Object.keys(pack.buckets) as ContextPackBucketName[];
  for (const bucketName of bucketNames) {
    const lines = pack.buckets[bucketName];
    if (!lines || lines.length === 0) continue;
    const text = lines.join("\n").trim();
    if (!text) continue;
    const estimatedTokens =
      pack.estimatedTokens[bucketName] ??
      Math.ceil(text.length / TOKEN_CHAR_WIDTH);
    items.push({
      id: `${ROLE_MEMORY_CONTEXT_PROVIDER_ID}:${roleName}:${bucketName}`,
      kind: "memory",
      text,
      source: `role-memory:${roleName}:${bucketName}`,
      priority: BUCKET_PRIORITY[bucketName],
      evidenceRefs: [
        PROVIDER_EVIDENCE_REF,
        {
          type: "other",
          ref: `role-memory-bucket:${bucketName}`,
          label: BUCKET_LABEL[bucketName],
        },
      ],
      createdAt: Date.now(),
      metadata: {
        bucket: bucketName,
        roleName,
        lineCount: lines.length,
        estimatedTokens,
        budget: pack.budget[bucketName],
      },
    });
  }
  return items;
}

function resolveSessionKey(
  query: RuntimeContextProviderQuery,
  extras?: RuntimeContextProviderExtras,
): string | undefined {
  if (extras?.metadata && typeof extras.metadata === "object") {
    const value = (extras.metadata as { sessionKey?: unknown }).sessionKey;
    if (typeof value === "string" && value) return value;
  }
  if (query.metadata && typeof query.metadata === "object") {
    const value = (query.metadata as { sessionKey?: unknown }).sessionKey;
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function fallbackResult(params: {
  reason: RuntimeRegistryDiagnosticReason;
  message: string;
  metadata?: RuntimeCoreJsonObject;
}): RuntimeContextProviderResult {
  return {
    status: "fallback",
    contextItems: [],
    diagnostics: [
      {
        surface: "context",
        providerId: ROLE_MEMORY_CONTEXT_PROVIDER_ID,
        status: "skipped",
        reason: params.reason,
        message: params.message,
        evidenceRefs: [PROVIDER_EVIDENCE_REF],
        metadata: params.metadata,
      },
    ],
    evidenceRefs: [PROVIDER_EVIDENCE_REF],
    metadata: {
      providerId: ROLE_MEMORY_CONTEXT_PROVIDER_ID,
      enabled: false,
      legacyBehaviorUnaffected: true,
      ...(params.metadata ?? {}),
    },
  };
}

function uniqueEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const result: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.type}:${ref.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}
