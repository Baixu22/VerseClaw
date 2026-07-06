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
import { buildRolePermissionDenyPatches } from "./role-permissions-policy.js";
import { buildRolePermissionDecisionEvents } from "./role-permission-audit.js";
import { getMemoryCards, ensureMemoryCardsLoaded, recordMemoryInjection, listMemoryConflicts, isMemoryStoreConfigured, isRoleMemoryEnabled } from "../memory/memory-store.js";
import { isInjectableMemoryCard } from "../memory/memory-card.js";
import { buildContextPack, renderContextPack } from "../memory/context-pack.js";
import type { MemoryCard } from "../memory/types.js";
import type { TeamOrchestrationMetadata } from "./subagent-registry.types.js";
import type { PermissionDecisionEvent } from "../../../shared/product-semantics.js";

/** Minimal spawn-param set mapped from a role contract. */
export type RoleSpawnParams = {
  task: string;
  label?: string;
  agentId?: string;
  model?: string;
  thinking?: string;
  mode?: string;
  cwd?: string;
  runTimeoutSeconds?: number;
  roleSystemPrompt?: string;
  orchestration?: TeamOrchestrationMetadata;
};

/** Minimal context for role-spawned workers (structurally compatible with SpawnSubagentContext). */
export type RoleSpawnContext = {
  agentSessionKey?: string;
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
  permissionDecisionEvents?: PermissionDecisionEvent[];
  completionOwnerKey?: string;
};

/** Result shape returned by a spawn call. */
export type RoleSpawnResultShape = {
  status: "accepted" | "forbidden" | "error";
  runId?: string;
  childSessionKey?: string;
  mode?: string;
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
  mode?: string;
  cwd?: string;
  runTimeoutSeconds?: number;
  /** Extra context appended after the role SOUL (e.g. orchestration framing). */
  extraSystemPrompt?: string;
  orchestration?: TeamOrchestrationMetadata;
};

export type RoleSpawnResult = {
  status: RoleSpawnResultShape["status"] | "role-not-found";
  role?: RoleContract;
  result?: RoleSpawnResultShape;
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

/** Compile the system prompt a role-spawned worker should receive.
 * Optionally injects role-tagged memory cards between the SOUL and any extras. */
export function buildRoleSystemPrompt(
  role: RoleContract,
  extra?: string,
  memoryCards?: readonly MemoryCard[],
  injection?: { task?: string; sessionKey?: string },
): string {
  const soul = compileRoleContractToSoul(role);
  const parts: string[] = [soul];
  if (isRoleMemoryEnabled() && memoryCards && memoryCards.length > 0) {
    const injectable = memoryCards.filter((card) =>
      isInjectableMemoryCard(card) || (card.status === "cold" && !card.supersededBy),
    );
    if (injectable.length > 0) {
      const openConflictRecords = listMemoryConflicts({ status: "open" });
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
export function resolveRoleMemoryCards(role: RoleContract): MemoryCard[] {
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
    .filter((card) => card.status === "active" || card.status === "cold");
}

/** Build the spawn params for a role contract (model, thinking, role SOUL). */
export function buildRoleSpawnParams(
  role: RoleContract,
  request: RoleSpawnRequest,
  ctx?: RoleSpawnContext,
): RoleSpawnParams {
  const model = request.modelOverride?.trim() || role.model.default || undefined;
  const thinking = roleEffortToThinking(role.effort);
  const memoryCards = resolveRoleMemoryCards(role);
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
    roleSystemPrompt: buildRoleSystemPrompt(role, request.extraSystemPrompt, memoryCards, {
      task: request.task,
      sessionKey: ctx?.agentSessionKey,
    }),
  };
}

/** Build the spawn context for a role contract — hard tool allowlist + permission-derived deny. */
export function buildRoleSpawnContext(
  role: RoleContract,
  ctx: RoleSpawnContext,
): RoleSpawnContext {
  // A non-empty allowlist is a true allowlist: any tool not listed is denied.
  const allowlist = role.tools.length > 0 ? [...role.tools] : ctx.inheritedToolAllowlist;
  // Build permission-derived deny lists (filesystem / network / commands).
  const permissionPatches = buildRolePermissionDenyPatches(role, ctx.inheritedToolDenylist);
  const deniedTools = permissionPatches.inheritedToolDenylist ?? [];
  const permissionDecisionEvents = deniedTools.length > 0
    ? buildRolePermissionDecisionEvents({
      roleName: role.name,
      deniedTools,
      requestId: ctx.agentSessionKey,
      reason: `role permissions for ${role.name}`,
    })
    : undefined;
  return {
    ...ctx,
    ...(allowlist ? { inheritedToolAllowlist: allowlist } : {}),
    ...permissionPatches,
    ...(permissionDecisionEvents ? { permissionDecisionEvents } : {}),
  };
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
  const roleCtx = buildRoleSpawnContext(role, ctx);
  const result = await deps.spawn(params, roleCtx);
  return { status: result.status, role, result };
}
