import type {
  OrchestrationExecutionWave,
  OrchestrationTaskGraph,
  OrchestrationTaskNode,
} from "./orchestration-protocol.js";
import type { RoleContract } from "./role-contract.js";

export type ResourceSchedulerOptions = {
  maxActiveRoles?: number;
  exclusiveToolGroups?: readonly (readonly string[])[];
  roleCost?: Partial<Record<string, number>>;
};

export type ScheduledOrchestrationWave = OrchestrationExecutionWave & {
  reason: string;
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

function takeContentionSafeChunk(params: {
  ready: readonly OrchestrationTaskNode[];
  concurrencyCap: number;
  roles: Map<string, RoleContract>;
  options?: ResourceSchedulerOptions;
}): { chunk: OrchestrationTaskNode[]; deferred: number; deferredTaskNodeIds: string[] } {
  const chunk: OrchestrationTaskNode[] = [];
  const usedExclusiveKeys = new Set<string>();
  let deferred = 0;
  const deferredTaskNodeIds: string[] = [];
  for (const node of params.ready) {
    if (chunk.length >= params.concurrencyCap) {
      deferred += 1;
      deferredTaskNodeIds.push(node.taskNodeId);
      continue;
    }
    const keys = exclusiveToolKeys(node, params.roles, params.options);
    const conflicts = [...keys].some((key) => usedExclusiveKeys.has(key));
    if (conflicts) {
      deferred += 1;
      deferredTaskNodeIds.push(node.taskNodeId);
      continue;
    }
    chunk.push(node);
    for (const key of keys) {
      usedExclusiveKeys.add(key);
    }
  }
  return { chunk, deferred, deferredTaskNodeIds };
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

    const { chunk, deferred, deferredTaskNodeIds } = takeContentionSafeChunk({
      ready,
      concurrencyCap,
      roles,
      options: params.options,
    });
    const includesPreviouslyDeferred = chunk.some((node) => deferredForContention.has(node.taskNodeId));
    const wave = waves.length + 1;
    waves.push({
      wave,
      taskNodeIds: chunk.map((node) => node.taskNodeId),
      roles: chunk.map((node) => node.roleName),
      reason: includesPreviouslyDeferred
        ? `scheduled ${chunk.length} node(s) previously deferred for tool contention`
        : deferred > 0
        ? `scheduled ${chunk.length} ready node(s); deferred ${deferred} for tool contention or concurrency cap ${concurrencyCap}`
        : `scheduled ${chunk.length} ready node(s) within concurrency cap ${concurrencyCap}`,
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
