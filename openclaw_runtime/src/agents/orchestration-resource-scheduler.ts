import {
  isWriterLikeRole,
  writeSetsConflict,
  type OrchestrationExecutionWave,
  type OrchestrationTaskGraph,
  type OrchestrationTaskNode,
} from "./orchestration-protocol.js";
import type { RoleContract } from "./role-contract.js";
import { isVerifiedGitWorktree, type WorktreeRecord } from "./worktree-service.js";

export type ResourceSchedulerOptions = {
  maxActiveRoles?: number;
  exclusiveToolGroups?: readonly (readonly string[])[];
  roleCost?: Partial<Record<string, number>>;
  /** Node-to-checkout records issued by the existing worktree owner. */
  worktreeRecords?: ReadonlyMap<string, WorktreeRecord>;
};

export type ResourceScheduleDeferReason =
  | "write-set-conflict"
  | "insufficient-writeSet-proof"
  | "tool-contention"
  | "concurrency-cap";

export type ScheduledOrchestrationWave = OrchestrationExecutionWave & {
  reason: string;
  deferredReasons?: ResourceScheduleDeferReason[];
};

export type SchedulerSkippedNode = {
  taskNodeId: string;
  roleName: string;
  reason: string;
};

export type ResourceSchedulerMetrics = {
  queued: number;
  running: number;
  completed: number;
  skipped: number;
  concurrencyCap: number;
  budgetEstimate: number;
  roleCostSummary: Array<{ roleName: string; taskNodeIds: string[]; estimatedCost: number }>;
};

export type ResourceScheduleResult = {
  waves: ScheduledOrchestrationWave[];
  skipped: SchedulerSkippedNode[];
  metrics: ResourceSchedulerMetrics;
};

const DEFAULT_ROLE_COST = 1;
const DEFAULT_EXCLUSIVE_TOOLS = new Set(["bash", "exec", "write", "edit", "apply_patch"]);
const EFFORT_COST: Record<RoleContract["effort"], number> = {
  auto: 2,
  minimal: 0.5,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

function resolveConcurrencyCap(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : Number.MAX_SAFE_INTEGER;
}

function roleByName(roles: readonly RoleContract[]): Map<string, RoleContract> {
  return new Map(roles.map((role) => [role.name, role]));
}

function estimateNodeCost(
  node: OrchestrationTaskNode,
  roles: Map<string, RoleContract>,
  roleCost: Partial<Record<string, number>> | undefined,
): number {
  const configured = roleCost?.[node.roleName];
  if (typeof configured === "number" && Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  const role = roles.get(node.roleName);
  return role ? EFFORT_COST[role.effort] : DEFAULT_ROLE_COST;
}

function buildRoleCostSummary(params: {
  graph: OrchestrationTaskGraph;
  roles: Map<string, RoleContract>;
  roleCost?: Partial<Record<string, number>>;
}): ResourceSchedulerMetrics["roleCostSummary"] {
  const byRole = new Map<string, { roleName: string; taskNodeIds: string[]; estimatedCost: number }>();
  for (const node of params.graph.nodes) {
    const entry = byRole.get(node.roleName) ?? {
      roleName: node.roleName,
      taskNodeIds: [],
      estimatedCost: 0,
    };
    entry.taskNodeIds.push(node.taskNodeId);
    entry.estimatedCost += estimateNodeCost(node, params.roles, params.roleCost);
    byRole.set(node.roleName, entry);
  }
  return [...byRole.values()];
}

function exclusiveToolKeys(
  node: OrchestrationTaskNode,
  roles: Map<string, RoleContract>,
  options: ResourceSchedulerOptions | undefined,
): Set<string> {
  const role = roles.get(node.roleName);
  const toolNames = new Set([...(role?.toolRequirements ?? []), ...(role?.tools ?? [])]);
  const keys = new Set<string>();
  for (const tool of toolNames) {
    if (DEFAULT_EXCLUSIVE_TOOLS.has(tool)) {
      keys.add(tool === "bash" || tool === "exec" ? "shell" : "write");
    }
  }
  for (const group of options?.exclusiveToolGroups ?? []) {
    if (group.some((tool) => toolNames.has(tool))) {
      keys.add(`group:${group.join("|")}`);
    }
  }
  return keys;
}

function isWriteCapableNode(
  node: OrchestrationTaskNode,
  roles: Map<string, RoleContract>,
): boolean {
  if (isWriterLikeRole(node.roleName) || (node.writeSet?.length ?? 0) > 0) {
    return true;
  }
  const role = roles.get(node.roleName);
  const tools = new Set([...(role?.tools ?? []), ...(role?.toolRequirements ?? [])]);
  return ["write", "edit", "apply_patch", "bash", "exec"].some((tool) => tools.has(tool));
}

function writeSetDeferReason(
  candidate: OrchestrationTaskNode,
  chunk: readonly OrchestrationTaskNode[],
  roles: Map<string, RoleContract>,
  options: ResourceSchedulerOptions | undefined,
): ResourceScheduleDeferReason | undefined {
  if (!isWriteCapableNode(candidate, roles)) return undefined;

  for (const existing of chunk) {
    if (!isWriteCapableNode(existing, roles)) continue;
    if (
      hasIndependentCheckouts(existing, candidate, options)
    ) {
      continue;
    }
    if (!existing.writeSet?.length || !candidate.writeSet?.length) {
      return "insufficient-writeSet-proof";
    }
    if (writeSetsConflict(existing.writeSet, candidate.writeSet)) {
      return "write-set-conflict";
    }
  }
  return undefined;
}

function hasIndependentCheckouts(
  left: OrchestrationTaskNode,
  right: OrchestrationTaskNode,
  options?: ResourceSchedulerOptions,
): boolean {
  if (left.isolation !== "worktree" || right.isolation !== "worktree") return false;
  const a = options?.worktreeRecords?.get(left.taskNodeId);
  const b = options?.worktreeRecords?.get(right.taskNodeId);
  return Boolean(a && b && a.id !== b.id && a.root !== b.root && a.baseRoot === b.baseRoot
    && isVerifiedGitWorktree(a) && isVerifiedGitWorktree(b));
}

function formatDeferredReasons(reasons: ReadonlySet<ResourceScheduleDeferReason>): string {
  const labels: string[] = [];
  if (reasons.has("write-set-conflict")) labels.push("write-set conflict");
  if (reasons.has("insufficient-writeSet-proof")) labels.push("insufficient-writeSet-proof");
  if (reasons.has("tool-contention")) labels.push("tool contention");
  if (reasons.has("concurrency-cap")) labels.push("concurrency cap");
  return labels.join(" or ");
}

function takeContentionSafeChunk(params: {
  ready: readonly OrchestrationTaskNode[];
  concurrencyCap: number;
  roles: Map<string, RoleContract>;
  options?: ResourceSchedulerOptions;
}): {
  chunk: OrchestrationTaskNode[];
  deferred: number;
  deferredTaskNodeIds: string[];
  deferredReasons: Set<ResourceScheduleDeferReason>;
} {
  const chunk: OrchestrationTaskNode[] = [];
  const usedExclusiveKeys = new Map<string, OrchestrationTaskNode[]>();
  const deferredReasons = new Set<ResourceScheduleDeferReason>();
  let deferred = 0;
  const deferredTaskNodeIds: string[] = [];
  for (const node of params.ready) {
    if (chunk.length >= params.concurrencyCap) {
      deferred += 1;
      deferredTaskNodeIds.push(node.taskNodeId);
      deferredReasons.add("concurrency-cap");
      continue;
    }
    const writeSetReason = writeSetDeferReason(node, chunk, params.roles, params.options);
    if (writeSetReason) {
      deferred += 1;
      deferredTaskNodeIds.push(node.taskNodeId);
      deferredReasons.add(writeSetReason);
      continue;
    }
    const keys = exclusiveToolKeys(node, params.roles, params.options);
    const conflictingKeys = [...keys].filter((key) => usedExclusiveKeys.has(key));
    const canBypassWriteOnlyContention =
      conflictingKeys.length > 0 &&
      conflictingKeys.every((key) => key === "write") &&
      conflictingKeys.every((key) =>
        (usedExclusiveKeys.get(key) ?? []).every(
          (existing) =>
            hasIndependentCheckouts(existing, node, params.options) ||
            (Boolean(existing.writeSet?.length) &&
              Boolean(node.writeSet?.length) &&
              !writeSetsConflict(existing.writeSet, node.writeSet)),
        ),
      );
    if (conflictingKeys.length > 0 && !canBypassWriteOnlyContention) {
      deferred += 1;
      deferredTaskNodeIds.push(node.taskNodeId);
      deferredReasons.add("tool-contention");
      continue;
    }
    chunk.push(node);
    for (const key of keys) {
      const owners = usedExclusiveKeys.get(key) ?? [];
      owners.push(node);
      usedExclusiveKeys.set(key, owners);
    }
  }
  return { chunk, deferred, deferredTaskNodeIds, deferredReasons };
}

export function scheduleResourceAwareWaves(params: {
  graph: OrchestrationTaskGraph;
  roles: readonly RoleContract[];
  options?: ResourceSchedulerOptions;
}): ResourceScheduleResult {
  const remaining = new Map(params.graph.nodes.map((node) => [node.taskNodeId, node]));
  const completed = new Set<string>();
  const waves: ScheduledOrchestrationWave[] = [];
  const skipped: SchedulerSkippedNode[] = [];
  const concurrencyCap = resolveConcurrencyCap(params.options?.maxActiveRoles);
  const roles = roleByName(params.roles);
  const deferredForContention = new Set<string>();

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((node) =>
      node.dependsOn.every((dependency) => completed.has(dependency))
    );
    if (ready.length === 0) {
      for (const node of remaining.values()) {
        skipped.push({
          taskNodeId: node.taskNodeId,
          roleName: node.roleName,
          reason: "dependencies could not be satisfied",
        });
      }
      break;
    }

    const { chunk, deferred, deferredTaskNodeIds, deferredReasons } = takeContentionSafeChunk({
      ready,
      concurrencyCap,
      roles,
      options: params.options,
    });
    const includesPreviouslyDeferred = chunk.some((node) => deferredForContention.has(node.taskNodeId));
    const deferredReasonText = formatDeferredReasons(deferredReasons);
    const wave = waves.length + 1;
    waves.push({
      wave,
      taskNodeIds: chunk.map((node) => node.taskNodeId),
      roles: chunk.map((node) => node.roleName),
      reason: includesPreviouslyDeferred
        ? `scheduled ${chunk.length} node(s) previously deferred for tool contention or write-set proof`
        : deferred > 0
        ? `scheduled ${chunk.length} ready node(s); deferred ${deferred} for ${deferredReasonText || `concurrency cap ${concurrencyCap}`}`
        : `scheduled ${chunk.length} ready node(s) within concurrency cap ${concurrencyCap}`,
      ...(deferredReasons.size > 0 ? { deferredReasons: [...deferredReasons] } : {}),
    });
    for (const taskNodeId of deferredTaskNodeIds) {
      deferredForContention.add(taskNodeId);
    }
    for (const node of chunk) {
      remaining.delete(node.taskNodeId);
      completed.add(node.taskNodeId);
      deferredForContention.delete(node.taskNodeId);
    }
  }

  const roleCostSummary = buildRoleCostSummary({
    graph: params.graph,
    roles,
    roleCost: params.options?.roleCost,
  });
  return {
    waves,
    skipped,
    metrics: {
      queued: params.graph.nodes.length,
      running: 0,
      completed: completed.size,
      skipped: skipped.length,
      concurrencyCap,
      budgetEstimate: roleCostSummary.reduce((total, entry) => total + entry.estimatedCost, 0),
      roleCostSummary,
    },
  };
}
