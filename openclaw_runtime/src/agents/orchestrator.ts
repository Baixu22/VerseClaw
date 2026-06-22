import { routeRole, type RoleRouteMode } from "./role-router.js";
import { BUILT_IN_ROLE_CONTRACTS, type RoleContract } from "./role-contract.js";
import { resolveTeamTemplate, type TeamTemplate } from "./team-template.js";
import {
  buildExecutionWaves,
  buildRouteDiagnostics,
  buildTaskGraph,
  normalizeGraphMode,
  normalizeRepairPolicy,
  taskGraphWorkerNodes,
  type OrchestrationExecutionWave,
  type OrchestrationGraphMode,
  type OrchestrationQualityPolicy,
  type OrchestrationRepairPolicy,
  type OrchestrationTaskGraph,
  type RouteDiagnostics,
  type WorkerCommunicationPolicy,
} from "./orchestration-protocol.js";

export type OrchestratorRequest = {
  task: string;
  fileHints?: string[];
  important?: boolean;
  roles?: readonly RoleContract[];
  /** Optional explicit worker plan supplied by operator UI wrappers. */
  workers?: readonly OrchestratorWorkerPlan[];
  /** Optional caller-pinned lead role; when set and present in availableRoles, used as leadRole. */
  preferredLeadRole?: string;
  /** Optional team template id. `teamTemplateId` is accepted by gateway/tool callers as an alias. */
  templateId?: string;
  teamTemplateId?: string;
  /** Max non-verifier workers to plan. Existing subagent depth/children limits still apply at spawn time. */
  maxWorkers?: number;
  /** Config carrier used to resolve config-defined team templates. */
  cfg?: { agents?: { teams?: unknown } };
  qualityPolicy?: OrchestrationQualityPolicy;
  repairPolicy?: OrchestrationRepairPolicy;
  workerCommunication?: WorkerCommunicationPolicy;
  allowFollowupPlanning?: boolean;
  graphMode?: OrchestrationGraphMode;
  allowAutoRepair?: boolean;
};

export type OrchestratorWorkerPlan = {
  roleName: string;
  task: string;
  label?: string;
  modelRef?: string | null;
};

export type OrchestratorPlan = {
  mode: RoleRouteMode;
  leadRole: string;
  workers: OrchestratorWorkerPlan[];
  verifierRole?: string;
  verifierModelRef?: string | null;
  templateId?: string;
  reasons: string[];
  routeDiagnostics: RouteDiagnostics;
  taskGraph: OrchestrationTaskGraph;
  graphStatus: OrchestrationTaskGraph["status"];
  executionWaves: OrchestrationExecutionWave[];
  capabilityGaps: RouteDiagnostics["capabilityGaps"];
  estimatedRepairPolicy: OrchestrationRepairPolicy;
};

function taskForRole(roleName: string, task: string): string {
  switch (roleName) {
    case "planner":
      return `Plan execution for: ${task}`;
    case "architect":
      return `Identify architecture constraints for: ${task}`;
    case "tester":
      return `Define verification for: ${task}`;
    case "reviewer":
      return `Review implementation quality for: ${task}`;
    case "security-reviewer":
      return `Review security and permission risks for: ${task}`;
    case "skeptic":
      return `Try to refute completion of: ${task}`;
    default:
      return task;
  }
}

function normalizeMaxWorkers(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const next = Math.floor(value);
  return next > 0 ? next : undefined;
}

function capWorkers(
  workers: OrchestratorWorkerPlan[],
  maxWorkers: number | undefined,
): OrchestratorWorkerPlan[] {
  return maxWorkers === undefined ? workers : workers.slice(0, maxWorkers);
}

function buildPlanGraph(params: {
  request: OrchestratorRequest;
  mode: RoleRouteMode;
  workers: OrchestratorWorkerPlan[];
  verifierRole?: string;
  verifierModelRef?: string | null;
  routeDiagnostics: RouteDiagnostics;
  graphRunId: string;
}): {
  taskGraph: OrchestrationTaskGraph;
  executionWaves: OrchestrationExecutionWave[];
  estimatedRepairPolicy: OrchestrationRepairPolicy;
  projectedWorkers: OrchestratorWorkerPlan[];
} {
  const repairPolicy = params.request.repairPolicy ?? normalizeRepairPolicy(undefined);
  const graphMode = normalizeGraphMode(params.request.graphMode);
  const taskGraph = buildTaskGraph({
    graphRunId: params.graphRunId,
    mode: params.mode,
    graphMode,
    workers: params.workers,
    verifierRole: params.verifierRole,
    verifierTask: params.verifierRole ? taskForRole(params.verifierRole, params.request.task) : undefined,
    verifierModelRef: params.verifierModelRef,
    requiredCapabilities: params.routeDiagnostics.requiredCapabilities,
    repairPolicy,
  });
  const executionWaves = buildExecutionWaves(taskGraph, normalizeMaxWorkers(params.request.maxWorkers));
  const projectedWorkers = taskGraphWorkerNodes(taskGraph).map((node, index) => {
    const source = params.workers[index];
    return {
      roleName: node.roleName,
      task: node.task,
      label: source?.label,
      modelRef: node.modelRef,
    };
  });
  return { taskGraph, executionWaves, estimatedRepairPolicy: repairPolicy, projectedWorkers };
}

function createExplicitWorkersPlan(request: OrchestratorRequest): OrchestratorPlan | null {
  const requestedWorkers = request.workers?.filter((worker) => worker.roleName.trim() && worker.task.trim()) ?? [];
  if (requestedWorkers.length === 0) {
    return null;
  }
  const availableRoles = request.roles ?? BUILT_IN_ROLE_CONTRACTS;
  const preferredLeadRole = request.preferredLeadRole?.trim();
  const preferredLeadKnown =
    preferredLeadRole && availableRoles.some((role) => role.name === preferredLeadRole);
  const leadRole = preferredLeadKnown ? preferredLeadRole! : requestedWorkers[0]!.roleName;
  const maxWorkers = normalizeMaxWorkers(request.maxWorkers);
  const allWorkers = requestedWorkers.map((worker) => ({
    roleName: worker.roleName,
    task: worker.task,
    label: worker.label,
    modelRef: worker.modelRef ?? null,
  }));
  const workers = capWorkers(allWorkers, maxWorkers);
  const reasons = [
    "explicit-workers",
    `lead:${leadRole}`,
    ...(preferredLeadKnown ? [`preferred-lead:${preferredLeadRole}`] : []),
    ...(maxWorkers !== undefined ? [`max-workers:${maxWorkers}`] : []),
  ];
  const routeDiagnostics = buildRouteDiagnostics({
    task: request.task,
    fileHints: request.fileHints,
    important: request.important,
    mode: "lead-workers",
    selectedRoleNames: [leadRole, ...workers.map((worker) => worker.roleName)],
    reasons,
    roles: availableRoles,
  });
  const graph = buildPlanGraph({
    request,
    mode: "lead-workers",
    workers: allWorkers,
    routeDiagnostics,
    graphRunId: "explicit-workers",
  });
  return {
    mode: "lead-workers",
    leadRole,
    workers: graph.projectedWorkers,
    reasons,
    routeDiagnostics,
    taskGraph: graph.taskGraph,
    graphStatus: graph.taskGraph.status,
    executionWaves: graph.executionWaves,
    capabilityGaps: routeDiagnostics.capabilityGaps,
    estimatedRepairPolicy: graph.estimatedRepairPolicy,
  };
}

function templateRoleKnown(template: TeamTemplate, roleName: string | undefined): roleName is string {
  const normalized = roleName?.trim();
  if (!normalized) {
    return false;
  }
  return template.roles.some((role) => role.roleName === normalized);
}

function createTemplatePlan(
  request: OrchestratorRequest,
  template: TeamTemplate,
): OrchestratorPlan {
  const availableRoles = request.roles ?? BUILT_IN_ROLE_CONTRACTS;
  const preferredLead = request.preferredLeadRole?.trim();
  const leadRole = templateRoleKnown(template, preferredLead)
    ? preferredLead
    : template.defaultLeadRole;
  const verifierRole = template.verifierRole?.trim() || undefined;
  const verifierBinding = verifierRole
    ? template.roles.find((binding) => binding.roleName === verifierRole)
    : undefined;
  const maxWorkers = normalizeMaxWorkers(request.maxWorkers);
  const allWorkers = template.roles
    .filter((binding) => binding.roleName !== verifierRole)
    .map((binding) => ({
      roleName: binding.roleName,
      task: taskForRole(binding.roleName, request.task),
      modelRef: binding.modelRef ?? null,
    }));
  const workers = capWorkers(allWorkers, maxWorkers);
  const selectedRoleNames = [
    leadRole,
    ...workers.map((worker) => worker.roleName),
    ...(verifierRole ? [verifierRole] : []),
  ];
  const reasons = [
    `template:${template.id}`,
    `mode:${template.mode}`,
    `lead:${leadRole}`,
    ...(verifierRole ? [`verifier:${verifierRole}`] : []),
    ...(preferredLead && leadRole === preferredLead ? [`preferred-lead:${preferredLead}`] : []),
    ...(maxWorkers !== undefined ? [`max-workers:${maxWorkers}`] : []),
  ];
  const routeDiagnostics = buildRouteDiagnostics({
    task: request.task,
    fileHints: request.fileHints,
    important: request.important,
    mode: template.mode,
    selectedRoleNames,
    reasons,
    roles: availableRoles,
    templateId: template.id,
  });
  const graph = buildPlanGraph({
    request,
    mode: template.mode,
    workers: allWorkers,
    verifierRole,
    verifierModelRef: verifierBinding?.modelRef ?? null,
    routeDiagnostics,
    graphRunId: template.id,
  });
  return {
    mode: template.mode,
    leadRole,
    workers: graph.projectedWorkers,
    ...(verifierRole ? { verifierRole } : {}),
    ...(verifierBinding ? { verifierModelRef: verifierBinding.modelRef ?? null } : {}),
    templateId: template.id,
    reasons,
    routeDiagnostics,
    taskGraph: graph.taskGraph,
    graphStatus: graph.taskGraph.status,
    executionWaves: graph.executionWaves,
    capabilityGaps: routeDiagnostics.capabilityGaps,
    estimatedRepairPolicy: graph.estimatedRepairPolicy,
  };
}

export function createOrchestratorPlan(request: OrchestratorRequest): OrchestratorPlan {
  const availableRoles = request.roles ?? BUILT_IN_ROLE_CONTRACTS;
  const explicitPlan = createExplicitWorkersPlan(request);
  if (explicitPlan) {
    return explicitPlan;
  }
  const templateId = request.templateId?.trim() || request.teamTemplateId?.trim();
  const template = resolveTeamTemplate(templateId, request.cfg);
  if (template) {
    return createTemplatePlan(request, template);
  }
  const route = routeRole({
    task: request.task,
    fileHints: request.fileHints,
    important: request.important,
    availableRoles,
  });
  // Honor a caller-pinned lead role when it exists in the available pool.
  // In router mode it replaces the primary worker; in team mode it only
  // overrides the leadRole attribution (workers stay as routed).
  const preferredLeadRole = request.preferredLeadRole?.trim();
  const preferredLeadKnown =
    preferredLeadRole && availableRoles.some((role) => role.name === preferredLeadRole);
  const reasons = [
    `primary:${route.primary.role.name}`,
    ...route.primary.reasons,
  ];
  if (preferredLeadKnown) {
    reasons.push(`preferred-lead:${preferredLeadRole}`);
  }
  const maxWorkers = normalizeMaxWorkers(request.maxWorkers);
  if (maxWorkers !== undefined) {
    reasons.push(`max-workers:${maxWorkers}`);
  }
  if (route.mode === "router") {
    const leadName = preferredLeadKnown ? preferredLeadRole! : route.primary.role.name;
    const selectedRoleNames = [leadName];
    const routeDiagnostics = buildRouteDiagnostics({
      task: request.task,
      fileHints: request.fileHints,
      important: request.important,
      mode: route.mode,
      selectedRoleNames,
      reasons,
      roles: availableRoles,
    });
    const graph = buildPlanGraph({
      request,
      mode: route.mode,
      workers: [{ roleName: leadName, task: request.task }],
      routeDiagnostics,
      graphRunId: "router",
    });
    return {
      mode: route.mode,
      leadRole: leadName,
      workers: graph.projectedWorkers,
      reasons,
      routeDiagnostics,
      taskGraph: graph.taskGraph,
      graphStatus: graph.taskGraph.status,
      executionWaves: graph.executionWaves,
      capabilityGaps: routeDiagnostics.capabilityGaps,
      estimatedRepairPolicy: graph.estimatedRepairPolicy,
    };
  }
  const workerNames = [...new Set(route.supporting.map((match) => match.role.name))];
  const verifierRole = route.mode === "adversarial-review" ? "skeptic" : "reviewer";
  const leadRole =
    preferredLeadKnown
      ? preferredLeadRole!
      : workerNames.includes("planner")
        ? "planner"
        : route.primary.role.name;
  const allWorkers = workerNames.map((roleName) => ({ roleName, task: taskForRole(roleName, request.task) }));
  const workers = capWorkers(allWorkers, maxWorkers);
  const finalReasons = [...reasons, `mode:${route.mode}`, `verifier:${verifierRole}`];
  const selectedRoleNames = [leadRole, ...workers.map((worker) => worker.roleName), verifierRole];
  const routeDiagnostics = buildRouteDiagnostics({
    task: request.task,
    fileHints: request.fileHints,
    important: request.important,
    mode: route.mode,
    selectedRoleNames,
    reasons: finalReasons,
    roles: availableRoles,
  });
  const graph = buildPlanGraph({
    request,
    mode: route.mode,
    workers: allWorkers,
    verifierRole,
    routeDiagnostics,
    graphRunId: route.mode,
  });
  return {
    mode: route.mode,
    leadRole,
    workers: graph.projectedWorkers,
    verifierRole,
    reasons: finalReasons,
    routeDiagnostics,
    taskGraph: graph.taskGraph,
    graphStatus: graph.taskGraph.status,
    executionWaves: graph.executionWaves,
    capabilityGaps: routeDiagnostics.capabilityGaps,
    estimatedRepairPolicy: graph.estimatedRepairPolicy,
  };
}

export function shouldUpgradeToTeam(plan: OrchestratorPlan): boolean {
  return plan.mode !== "router";
}
