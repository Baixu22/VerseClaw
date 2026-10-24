// Role-driven subagent spawn.
//
// Turns a role contract into a real subagent run by mapping the contract onto
// the existing spawnSubagentDirect surface:
//   - compiled SOUL    -> params.roleSystemPrompt (appended to the child prompt)
//   - role.tools       -> ctx.inheritedToolAllowlist (HARD allowlist; others denied)
//   - role.model       -> params.model
//   - role.effort      -> params.thinking (via roleEffortToThinking)
//   - permissions.*    -> ctx.inheritedToolDenylist via buildRolePermissionDenyPatches
//                         (HARD-enforced at tool-filter level; filesystem/network/commands
//                         all map to concrete deny lists — see role-permissions-policy.ts)
//
// The spawn function is injectable so this module is unit-testable without the
// gateway/channel stack, mirroring subagent-spawn's __testing seam.
//
// Types are defined locally (not imported from subagent-spawn.ts) so vitest can
// resolve the module without chasing @openclaw/* path aliases that only the
// runtime esbuild plugin handles. The native spawnSubagentDirect is still used
// as the default SpawnFn, but the import is runtime-land only.
import { compileRoleContractToSoul, type RoleContract } from "./role-contract.js";
import { roleEffortToThinking } from "./role-effort.js";
import { resolveRoleContract, type RoleRegistryConfigCarrier } from "./role-registry.js";
import {
  buildRolePermissionDenyPatches,
  clampRolePermissionsToParent,
  clampToolAllowlist,
} from "./role-permissions-policy.js";
import { buildRolePermissionDecisionEvents } from "./role-permission-audit.js";
import { getMemoryCards, ensureMemoryCardsLoaded, recordMemoryInjection, listMemoryConflicts, isMemoryStoreConfigured, isRoleMemoryEnabled } from "../memory/memory-store.js";
import { isInjectableMemoryCard, isMemoryCardInContextScope, type MemoryCardScopeContext } from "../memory/memory-card.js";
import { applyMemoryUseGateOverlay } from "../memory/memory-dual-gate.js";
import { buildContextPack, renderContextPack } from "../memory/context-pack.js";
import { dcsObservability } from "../context-engine/dcs-observability.js";
import { RC03_PRE_SEAL_PRODUCERS } from "../context-engine/rc03-producers.js";
import { recordRc03SystemPromptContribution } from "../context-engine/rc03-seal-hook.js";
import type { MemoryCard } from "../memory/types.js";
import type { TeamOrchestrationMetadata } from "./subagent-registry.types.js";
import type { PermissionDecisionEvent } from "../../../shared/product-semantics.js";
import type { SessionDelegationToolAuthorization } from "../../../shared/types/session-delegation.js";

/** Minimal spawn-param set mapped from a role contract. */
export type RoleSpawnParams = {
  task: string;
  label?: string;
  agentId?: string;
  model?: string;
  thinking?: string;
  mode?: "run" | "session";
  cwd?: string;
  runTimeoutSeconds?: number;
  roleSystemPrompt?: string;
  orchestration?: TeamOrchestrationMetadata;
  /** B-3 v3: write-set coordinate for the spawned worker (from the worker plan). */
  writeSet?: string[];
};

/** Minimal context for role-spawned workers (structurally compatible with SpawnSubagentContext). */
export type RoleSpawnContext = {
  agentSessionKey?: string;
  /** Physical generation used to attribute worktrees and cleanup. */
  expectedSessionId?: string;
  agentChannel?: string;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  agentMemberRoleIds?: string[];
  requesterAgentIdOverride?: string;
  workspaceDir?: string;
  inheritedToolAllowlist?: string[];
  inheritedToolDenylist?: string[];
  /** Parent role contract used to hard-clamp child privileges (P2-003). */
  parentRole?: RoleContract | null;
  permissionDecisionEvents?: PermissionDecisionEvent[];
  completionOwnerKey?: string;
};

/** Result shape returned by a spawn call. */
export type RoleSpawnResultShape = {
  status: "accepted" | "forbidden" | "error";
  runId?: string;
  childSessionKey?: string;
  mode?: "run" | "session";
  taskName?: string;
  note?: string;
  error?: string;
};

export type SpawnFn = (
  params: RoleSpawnParams,
  ctx: RoleSpawnContext,
) => Promise<RoleSpawnResultShape>;

export type RoleSpawnRequest = {
  /** Role name (resolved via the registry) or an already-resolved contract. */
  role: string | RoleContract;
  task: string;
  label?: string;
  /** Target agent id for the spawned worker (defaults to caller agent). */
  agentId?: string;
  /** Config carrier used to resolve config-defined roles. */
  cfg?: RoleRegistryConfigCarrier;
  /** Explicit model ref overriding the role's default model. */
  modelOverride?: string;
  mode?: "run" | "session";
  cwd?: string;
  runTimeoutSeconds?: number;
  /** Extra context appended after the role SOUL (e.g. orchestration framing). */
  extraSystemPrompt?: string;
  orchestration?: TeamOrchestrationMetadata;
  /** B-3 v3: write-set coordinate for the spawned worker. */
  writeSet?: string[];
};

export type RoleSpawnResult = {
  status: RoleSpawnResultShape["status"] | "role-not-found";
  role?: RoleContract;
  result?: RoleSpawnResultShape;
  authorization?: SessionDelegationToolAuthorization;
  error?: string;
};

function resolveRole(
  role: string | RoleContract,
  cfg?: RoleRegistryConfigCarrier,
): RoleContract | undefined {
  if (typeof role !== "string") {
    return role;
  }
  return resolveRoleContract(role, cfg);
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * #183: whether the DCS role-memory knowledge projection owns role-memory
 * injection for subagent sessions (`runtime.contextBlock["role-memory"].enabled`).
 *
 * When it does, `role-spawn` must NOT also render the same cards into the child
 * system prompt. Both paths read the same store (`getMemoryCards` +
 * `buildContextPack`) and render the same cards, so keeping both costs tokens
 * for zero extra information and leaves the model to decide which of the two
 * blocks is authoritative. The projection is the one to keep because it charges
 * the shared turn budget as `knowledge`; the role-spawn block never charged it.
 */
export function isRoleMemoryKnowledgeProjectionEnabled(cfg: unknown): boolean {
  const runtime =
    recordOf(cfg)?.runtime ?? recordOf(recordOf(cfg)?.config)?.runtime;
  const contextBlock = recordOf(runtime)?.contextBlock;
  const roleMemory = recordOf(contextBlock)?.["role-memory"];
  return recordOf(roleMemory)?.enabled === true;
}

/** Compile the system prompt a role-spawned worker should receive.
 * Optionally injects role-tagged memory cards between the SOUL and any extras. */
export function buildRoleSystemPrompt(
  role: RoleContract,
  extra?: string,
  memoryCards?: readonly MemoryCard[],
  injection?: { task?: string; sessionKey?: string; suppressMemoryContext?: boolean },
): string {
  const soul = compileRoleContractToSoul(role);
  const parts: string[] = [soul];
  if (
    injection?.suppressMemoryContext !== true &&
    isRoleMemoryEnabled() &&
    memoryCards &&
    memoryCards.length > 0
  ) {
    const legacyInjectable = memoryCards.filter((card) =>
      isInjectableMemoryCard(card) || (card.status === "cold" && !card.supersededBy),
    );
    // TF-0110 (T-P0-1, req-1): consult the memory use gate on the real
    // role-spawn injection path (same semantics as
    // role-memory-context-provider.ts: gate enabled -> strict filter;
    // gate disabled (default) -> legacy set unchanged).
    const injectable = applyMemoryUseGateOverlay(legacyInjectable);
    if (injectable.length > 0) {
      const injectableIds = new Set(injectable.map((card) => card.id));
      const openConflictRecords = listMemoryConflicts({ status: "open" }).filter((conflict) =>
        conflict.cardIds.some((cardId) => injectableIds.has(cardId)),
      );
      const openConflicts = openConflictRecords.map((conflict) => `${conflict.type}: ${conflict.reason}`);
      const pack = buildContextPack({
        memories: injectable,
        roleName: role.name,
        taskState: injection?.task,
        openConflicts,
        openConflictCardIds: openConflictRecords.flatMap((conflict) => conflict.cardIds),
      });
      const rendered = renderContextPack(pack).trim();
      if (rendered) {
        parts.push(["", "## Memory Context", rendered, ""].join("\n"));
        recordRc03SystemPromptContribution(RC03_PRE_SEAL_PRODUCERS.roleSpawnMemoryPack, rendered);
        // #183: these bytes land in the *child's* system prompt, so they can
        // never be charged to a turn ledger. Count them instead of leaving the
        // bypass invisible.
        dcsObservability.recordRoleSpawnMemoryInjection({
          chars: rendered.length,
          cardCount: injectable.length,
        });
      }
      try {
        recordMemoryInjection({
          roleName: role.name,
          task: injection?.task,
          sessionKey: injection?.sessionKey,
          cards: injectable,
          reasons: Object.fromEntries(injectable.map((card) => [card.id, `role=${role.name}; scope=${card.scope}`])),
          pack,
        });
      } catch {
        // Injection explain logging is best-effort and must never block a spawn.
      }
    }
  }
  const trimmedExtra = extra?.trim();
  if (trimmedExtra) parts.push(trimmedExtra);
  return parts.join("\n");
}

/** Resolve role-tagged memory cards for injection into a role-spawned prompt. */
export function resolveRoleMemoryCards(
  role: RoleContract,
  scopeContext: MemoryCardScopeContext = {},
): MemoryCard[] {
  try {
    if (!isRoleMemoryEnabled()) {
      return [];
    }
    if (!isMemoryStoreConfigured()) {
      return [];
    }
    ensureMemoryCardsLoaded();
  } catch {
    // Memory store not available — skip injection gracefully.
    return [];
  }
  return getMemoryCards({ roleName: role.name, status: "all" })
    .filter((card) => card.status === "active" || card.status === "cold")
    .filter((card) => isMemoryCardInContextScope(card, scopeContext));
}

/** Build the spawn params for a role contract (model, thinking, role SOUL). */
export function buildRoleSpawnParams(
  role: RoleContract,
  request: RoleSpawnRequest,
  ctx?: RoleSpawnContext,
): RoleSpawnParams {
  const model = request.modelOverride?.trim() || role.model.default || undefined;
  const thinking = roleEffortToThinking(role.effort);
  const memoryCards = resolveRoleMemoryCards(role, {
    workspace: ctx?.workspaceDir ?? request.cwd,
    sessionKey: ctx?.agentSessionKey,
  });
  return {
    task: request.task,
    label: request.label ?? role.displayName ?? role.name,
    ...(request.agentId ? { agentId: request.agentId } : {}),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(request.mode ? { mode: request.mode } : {}),
    ...(request.cwd ? { cwd: request.cwd } : {}),
    ...(typeof request.runTimeoutSeconds === "number"
      ? { runTimeoutSeconds: request.runTimeoutSeconds }
      : {}),
    ...(request.orchestration ? { orchestration: request.orchestration } : {}),
    ...(request.writeSet ? { writeSet: [...request.writeSet] } : {}),
    roleSystemPrompt: buildRoleSystemPrompt(role, request.extraSystemPrompt, memoryCards, {
      task: request.task,
      sessionKey: ctx?.agentSessionKey,
      // #183: hand the ownership decision to the renderer so the same cards are
      // never emitted by both the DCS knowledge projection and this block.
      suppressMemoryContext: isRoleMemoryKnowledgeProjectionEnabled(request.cfg),
    }),
  };
}

type RoleSpawnPolicy = {
  context: RoleSpawnContext;
  authorization: SessionDelegationToolAuthorization;
};

/** Build the hard child policy and the secret-free authorization facts used by receipts. */
function buildRoleSpawnPolicy(role: RoleContract, ctx: RoleSpawnContext): RoleSpawnPolicy {
  // P2-003 / F-AUTH-002: child role privileges cannot exceed parent role/tool inheritance.
  const effectiveRole = clampRolePermissionsToParent(role, ctx.parentRole ?? null);
  const parentAllow = ctx.inheritedToolAllowlist;
  const roleTools = effectiveRole.tools.length > 0 ? [...effectiveRole.tools] : undefined;
  const allowlist = clampToolAllowlist(roleTools, parentAllow)
    ?? (roleTools ?? parentAllow);
  // Build permission-derived deny lists (filesystem / network / commands).
  const permissionPatches = buildRolePermissionDenyPatches(effectiveRole, ctx.inheritedToolDenylist);
  const deniedTools = permissionPatches.inheritedToolDenylist ?? [];
  const permissionDecisionEvents = deniedTools.length > 0
    ? buildRolePermissionDecisionEvents({
      roleName: effectiveRole.name,
      deniedTools,
      requestId: ctx.agentSessionKey,
      reason: `role permissions for ${effectiveRole.name}`,
    })
    : undefined;
  return {
    context: {
      ...ctx,
      ...(allowlist ? { inheritedToolAllowlist: allowlist } : {}),
      ...permissionPatches,
      ...(permissionDecisionEvents ? { permissionDecisionEvents } : {}),
    },
    authorization: {
      status: allowlist ? "effective" : "runtime-inherited",
      source: allowlist ? "role-contract+parent-clamp" : "role-contract+runtime-inheritance",
      roleName: role.name,
      effectiveRoleName: effectiveRole.name,
      parentRoleName: ctx.parentRole?.name ?? null,
      allowlist: allowlist ? [...allowlist] : null,
      denylist: [...deniedTools],
    },
  };
}

/** Build the spawn context for a role contract — hard tool allowlist + permission-derived deny. */
export function buildRoleSpawnContext(
  role: RoleContract,
  ctx: RoleSpawnContext,
): RoleSpawnContext {
  return buildRoleSpawnPolicy(role, ctx).context;
}

/** Resolve a role and spawn a subagent that adopts its contract. */
export async function spawnRoleSubagent(
  request: RoleSpawnRequest,
  ctx: RoleSpawnContext,
  deps: { spawn: SpawnFn },
): Promise<RoleSpawnResult> {
  const role = resolveRole(request.role, request.cfg);
  if (!role) {
    const name = typeof request.role === "string" ? request.role : request.role?.name;
    return {
      status: "role-not-found",
      error: `Unknown role contract: ${name ?? "(unnamed)"}`,
    };
  }
  const params = buildRoleSpawnParams(role, request, ctx);
  const policy = buildRoleSpawnPolicy(role, ctx);
  const result = await deps.spawn(params, policy.context);
  return { status: result.status, role, result, authorization: policy.authorization };
}
