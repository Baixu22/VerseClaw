import { routeRole, type RoleRouteMode } from "./role-router.js";
import { BUILT_IN_ROLE_CONTRACTS, type RoleContract } from "./role-contract.js";
import { classifyComplexity, type ComplexityGateDecision } from "./complexity-gate.js";
import { resolveTeamTemplate } from "./team-template.js";
import type { TeamTemplate } from "./team-template.types.js";
import {
  buildExecutionWaves,
  buildRouteDiagnostics,
  buildTaskGraph,
  resolveWorkerWriteSet,
  normalizeGraphMode,
  normalizeIsolationMode,
  normalizeRepairPolicy,
  taskGraphWorkerNodes,
  type CodingIsolationMode,
  type OrchestrationExecutionWave,
  type OrchestrationGraphMode,
  type OrchestrationQualityPolicy,
  type OrchestrationRepairPolicy,
  type OrchestrationTaskGraph,
  type RouteDiagnostics,
  type WorkerCommunicationPolicy,
} from "./orchestration-protocol.js";
import {
  buildMemoShadowReason,
  computeTaskDigest,
  recallRoutingMemos,
  resolveRoutingMemoAuthority,
  resolveRoutingMemoPilotMode,
} from "./routing-memo.js";
import {
  unavailableOrchestrationQualityAuthority,
  type OrchestrationQualityAuthority,
} from "./orchestration-quality-scorecard.js";
import { selectRunbookCandidates, type RunbookSelectionResult } from "./runbook-registry.js";
import { buildTaskGraphFromRunbook } from "./runbook-task-graph.js";
import { DEFAULT_VERIFIER_DISCIPLINE } from "./verifier-discipline.js";

export type OrchestratorRequest = {
  task: string;
  agentId?: string;
  fileHints?: string[];
  /**
   * C4-4: workspace isolation. Default shared. Opt-in worktree for heavy multi-worker jobs.
   * Interface only in this wave — production default must remain shared.
   */
  isolation?: CodingIsolationMode;
  important?: boolean;
  roles?: readonly RoleContract[];
  /** Optional explicit worker plan supplied by operator UI wrappers. */
  workers?: readonly OrchestratorWorkerPlan[];
  /** Optional caller-pinned lead role; when set and present in availableRoles, used as leadRole. */
  preferredLeadRole?: string;
  /** Optional team template id. `teamTemplateId` is accepted by gateway/tool callers as an alias. */
  templateId?: string;
  teamTemplateId?: string;
  explicitRunbookId?: string;
  runbookId?: string;
  riskHints?: readonly string[];
  capabilityHints?: readonly string[];
  toolHints?: readonly string[];
  priorFailureCount?: number;
  /** Max non-verifier workers to plan. Existing subagent depth/children limits still apply at spawn time. */
  maxWorkers?: number;
  /** Config carrier used to resolve config-defined team templates. */
  cfg?: {
    agents?: { teams?: unknown };
    runtime?: { orchestration?: { handoffArtifacts?: "off" | "on" } };
  };
  qualityPolicy?: OrchestrationQualityPolicy;
  qualityAuthority?: OrchestrationQualityAuthority | null;
  repairPolicy?: OrchestrationRepairPolicy;
  workerCommunication?: WorkerCommunicationPolicy;
  allowFollowupPlanning?: boolean;
  graphMode?: OrchestrationGraphMode;
  allowAutoRepair?: boolean;
  /**
   * C7-3: when true (default), verifier failures never self-repair and escalate
   * a lead fix task. Explicit false is compatible opt-out of the factory path.
   */
  verifierNoSelfRepair?: boolean;
  /**
   * Area 3 §3.1: workspace directory for the routing memo store. When present
   * and the routing memo pilot is enabled (`runtime.orchestration.routingMemoPilot`),
   * `createOrchestratorPlan` recalls similar-task memos and either writes
   * `memo-shadow:...` reasons (shadow phase) or adjusts scores (active phase).
   * Undefined → memo recall/record is skipped (degrade to today).
   */
  workspaceDir?: string;
};

export type OrchestratorWorkerPlan = {
  roleName: string;
  task: string;
  label?: string;
  modelRef?: string | null;
  /**
   * Optional C3 write-set. Explicit values win; otherwise writer-like roles may
   * inherit request.fileHints via resolveWorkerWriteSet (no free-text invention).
   */
  writeSet?: string[];
  /** C4-4: per-worker isolation override (defaults to plan/request isolation). */
  isolation?: CodingIsolationMode;
  /** C4-3: worktree id when isolation=worktree. */
  worktreeId?: string;
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
  /** C4-4: plan-level isolation (default shared). */
  isolation: CodingIsolationMode;
  /** C7-3: verifier discipline - default true (no self-repair). */
  verifierNoSelfRepair: boolean;
  complexityDecision: ComplexityGateDecision;
  runbookSelection: RunbookSelectionResult;
  qualityRouting: {
    authority: OrchestrationQualityAuthority;
    affected: boolean;
    reason:
      | "explicit-plan"
      | "template-plan"
      | "runbook-plan"
      | "pilot-off"
      | "authority-shadow"
      | "no-routing-memo-match"
      | "active-routing-memo";
  };
};

type OrchestratorPlanBase = Omit<OrchestratorPlan, "qualityRouting">;

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

function handoffArtifactsEnabled(request: OrchestratorRequest): boolean {
  return request.cfg?.runtime?.orchestration?.handoffArtifacts === "on";
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
  isolation: CodingIsolationMode;
} {
  const repairPolicy = params.request.repairPolicy ?? normalizeRepairPolicy(undefined);
  const graphMode = normalizeGraphMode(params.request.graphMode);
  const isolation = normalizeIsolationMode(params.request.isolation);
  const graphWorkers = params.workers.map((worker) => {
    const writeSet = resolveWorkerWriteSet({
      roleName: worker.roleName,
      explicit: worker.writeSet,
      fileHints: params.request.fileHints,
    });
    const workerIsolation = normalizeIsolationMode(worker.isolation ?? isolation);
    return {
      roleName: worker.roleName,
      task: worker.task,
      ...(worker.modelRef !== undefined ? { modelRef: worker.modelRef } : {}),
      ...(writeSet ? { writeSet } : {}),
      ...(workerIsolation !== "shared" ? { isolation: workerIsolation } : worker.isolation ? { isolation: worker.isolation } : {}),
      ...(worker.worktreeId ? { worktreeId: worker.worktreeId } : {}),
    };
  });
  const taskGraph = buildTaskGraph({
    graphRunId: params.graphRunId,
    agentId: params.request.agentId,
    mode: params.mode,
    graphMode,
    workers: graphWorkers,
    verifierRole: params.verifierRole,
    verifierTask: params.verifierRole
      ? taskForRole(params.verifierRole, params.request.task)
      : undefined,
    verifierModelRef: params.verifierModelRef,
    requiredCapabilities: params.routeDiagnostics.requiredCapabilities,
    repairPolicy,
    includeHandoffEdges: handoffArtifactsEnabled(params.request),
  });
  const executionWaves = buildExecutionWaves(
    taskGraph,
    normalizeMaxWorkers(params.request.maxWorkers),
  );
  const projectedWorkers = taskGraphWorkerNodes(taskGraph).map((node, index) => {
    const source = params.workers[index];
    return {
      roleName: node.roleName,
      task: node.task,
      label: source?.label,
      modelRef: node.modelRef,
      ...(node.writeSet ? { writeSet: [...node.writeSet] } : {}),
      ...(node.isolation ? { isolation: node.isolation } : source?.isolation ? { isolation: source.isolation } : {}),
      ...(node.worktreeId ? { worktreeId: node.worktreeId } : source?.worktreeId ? { worktreeId: source.worktreeId } : {}),
    };
  });
  return {
    taskGraph,
    executionWaves,
    estimatedRepairPolicy: repairPolicy,
    projectedWorkers,
    isolation,
  };
}

function buildP2Metadata(request: OrchestratorRequest): {
  complexityDecision: ComplexityGateDecision;
  runbookSelection: RunbookSelectionResult;
} {
  const explicitRunbookId =
    request.explicitRunbookId?.trim() || request.runbookId?.trim() || undefined;
  const complexityDecision = classifyComplexity({
    task: request.task,
    fileHints: request.fileHints,
    explicitTeamRequested: Boolean(
      request.templateId || request.teamTemplateId || request.workers?.length,
    ),
    explicitRunbookId,
    riskHints: request.riskHints ?? (request.important ? ["important"] : []),
    capabilityHints: request.capabilityHints,
    toolHints: request.toolHints,
    priorFailureCount: request.priorFailureCount,
  });
  const runbookSelection = selectRunbookCandidates({
    task: request.task,
    explicitRunbookId: complexityDecision.selectedRunbookId ?? explicitRunbookId,
    suppressSelection: complexityDecision.mode !== "runbook-orchestrated",
    priorFailureCount: request.priorFailureCount,
    riskHints: request.riskHints,
    fileHints: request.fileHints,
  });
  return { complexityDecision, runbookSelection };
}

function attachP2Metadata(
  plan: Omit<OrchestratorPlanBase, "complexityDecision" | "runbookSelection" | "isolation" | "verifierNoSelfRepair"> & {
    isolation?: CodingIsolationMode;
    verifierNoSelfRepair?: boolean;
  },
  metadata: ReturnType<typeof buildP2Metadata>,
  request?: OrchestratorRequest,
): OrchestratorPlanBase {
  const isolation = normalizeIsolationMode(plan.isolation ?? request?.isolation);
  const verifierNoSelfRepair =
    plan.verifierNoSelfRepair ??
    request?.verifierNoSelfRepair ??
    DEFAULT_VERIFIER_DISCIPLINE.verifierNoSelfRepair;
  return { ...plan, isolation, verifierNoSelfRepair, ...metadata };
}

function createRunbookPlan(
  request: OrchestratorRequest,
  metadata: ReturnType<typeof buildP2Metadata>,
): OrchestratorPlanBase | null {
  const selected = metadata.runbookSelection.selected;
  if (!selected) {
    return null;
  }
  const availableRoles = request.roles ?? BUILT_IN_ROLE_CONTRACTS;
  const graphResult = buildTaskGraphFromRunbook({
    template: selected.template,
    task: request.task,
    graphRunId: selected.template.id,
    knownRoleNames: availableRoles.map((role) => role.name),
    selectionTrace: metadata.runbookSelection,
    fileHints: request.fileHints,
    includeHandoffEdges: handoffArtifactsEnabled(request),
  });
  const taskGraph = request.agentId
    ? { ...graphResult.graph, nodes: graphResult.graph.nodes.map((node) => ({ ...node, agentId: request.agentId })) }
    : graphResult.graph;
  const workerNodes = taskGraphWorkerNodes(taskGraph);
  const verifierNode = taskGraph.nodes.find((node) => node.isVerifier);
  const leadRole = selected.template.requiredRoles[0] ?? workerNodes[0]?.roleName ?? "planner";
  const routeDiagnostics = buildRouteDiagnostics({
    task: request.task,
    fileHints: request.fileHints,
    important: request.important,
    mode: "lead-workers",
    selectedRoleNames: [...new Set(taskGraph.nodes.map((node) => node.roleName))],
    reasons: [`runbook:${selected.template.id}`, ...selected.reasons],
    roles: availableRoles,
    templateId: selected.template.id,
  });
  const repairPolicy = request.repairPolicy ?? normalizeRepairPolicy(undefined);
  return attachP2Metadata(
    {
      mode: "lead-workers",
      leadRole,
      workers: workerNodes.map((node) => ({
        roleName: node.roleName,
        task: node.task,
        modelRef: node.modelRef,
        ...(node.writeSet ? { writeSet: [...node.writeSet] } : {}),
      })),
      ...(verifierNode ? { verifierRole: verifierNode.roleName } : {}),
      templateId: selected.template.id,
      reasons: [`runbook:${selected.template.id}`, ...selected.reasons],
      routeDiagnostics,
      taskGraph,
      graphStatus: taskGraph.status,
      executionWaves: buildExecutionWaves(taskGraph, normalizeMaxWorkers(request.maxWorkers)),
      capabilityGaps: routeDiagnostics.capabilityGaps,
      estimatedRepairPolicy: repairPolicy,
      isolation: normalizeIsolationMode(request.isolation),
    },
    metadata,
    request,
  );
}

function createExplicitWorkersPlan(request: OrchestratorRequest): OrchestratorPlanBase | null {
  const metadata = buildP2Metadata(request);
  const requestedWorkers =
    request.workers?.filter((worker) => worker.roleName.trim() && worker.task.trim()) ?? [];
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
    ...(worker.writeSet !== undefined ? { writeSet: [...worker.writeSet] } : {}),
    ...(worker.isolation ? { isolation: worker.isolation } : {}),
    ...(worker.worktreeId ? { worktreeId: worker.worktreeId } : {}),
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
  return attachP2Metadata(
    {
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
      isolation: graph.isolation,
    },
    metadata,
    request,
  );
}

function templateRoleKnown(
  template: TeamTemplate,
  roleName: string | undefined,
): roleName is string {
  const normalized = roleName?.trim();
  if (!normalized) {
    return false;
  }
  return template.roles.some((role) => role.roleName === normalized);
}

function createTemplatePlan(
  request: OrchestratorRequest,
  template: TeamTemplate,
): OrchestratorPlanBase {
  const metadata = buildP2Metadata(request);
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
  return attachP2Metadata(
    {
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
      isolation: graph.isolation,
    },
    metadata,
    request,
  );
}

function attachQualityRouting(
  plan: OrchestratorPlanBase,
  authority: OrchestrationQualityAuthority,
  affected: boolean,
  reason: OrchestratorPlan["qualityRouting"]["reason"],
): OrchestratorPlan {
  return {
    ...plan,
    qualityRouting: {
      authority,
      affected,
      reason,
    },
  };
}

export function createOrchestratorPlan(request: OrchestratorRequest): OrchestratorPlan {
  const availableRoles = request.roles ?? BUILT_IN_ROLE_CONTRACTS;
  const metadata = buildP2Metadata(request);
  const qualityAuthority =
    request.qualityAuthority ??
    unavailableOrchestrationQualityAuthority("No verified quality authority was supplied for routing.");
  const explicitPlan = createExplicitWorkersPlan(request);
  if (explicitPlan) {
    return attachQualityRouting(explicitPlan, qualityAuthority, false, "explicit-plan");
  }
  const templateId = request.templateId?.trim() || request.teamTemplateId?.trim();
  const template = resolveTeamTemplate(templateId, request.cfg);
  if (template) {
    return attachQualityRouting(
      createTemplatePlan(request, template),
      qualityAuthority,
      false,
      "template-plan",
    );
  }
  // Area 3 §3.1: recall routing memos for similar tasks. Shadow phase writes
  // `memo-shadow:...` reasons only (scores unchanged, byte-identical routing);
  // active phase applies bounded ±2/−1 score adjustments to the primary match
  // inside scoreRole. Both phases degrade to today's routing when the pilot is
  // off, workspaceDir is absent, or recall returns no matches.
  const memoPilotMode = resolveRoutingMemoPilotMode(request.cfg);
  const memoAuthority = resolveRoutingMemoAuthority({
    pilotMode: memoPilotMode,
    qualityAuthority,
  });
  const effectiveMemoMode = memoAuthority.authority;
  const memoMatches =
    effectiveMemoMode !== "off" && request.workspaceDir
      ? recallRoutingMemos(
          computeTaskDigest(request.task, request.fileHints ?? []),
          request.workspaceDir,
        )
      : [];
  const memoSignal =
    effectiveMemoMode !== "off" && memoMatches.length > 0
      ? { matches: memoMatches, mode: effectiveMemoMode }
      : undefined;
  const runbookPlan = createRunbookPlan(request, metadata);
  if (runbookPlan) {
    return attachQualityRouting(runbookPlan, qualityAuthority, false, "runbook-plan");
  }
  const route = routeRole({
    task: request.task,
    fileHints: request.fileHints,
    important: request.important,
    availableRoles,
    memoSignal,
  });
  // Shadow phase: append `memo-shadow:...` reasons (scores already unchanged).
  const memoShadowReasons =
    effectiveMemoMode === "shadow" ? memoMatches.map((match) => buildMemoShadowReason(match)) : [];
  const routingAffected = effectiveMemoMode === "active" && memoMatches.length > 0;
  const qualityRoutingReason: OrchestratorPlan["qualityRouting"]["reason"] =
    effectiveMemoMode === "off"
      ? "pilot-off"
      : effectiveMemoMode === "shadow"
        ? "authority-shadow"
        : memoMatches.length === 0
          ? "no-routing-memo-match"
          : "active-routing-memo";
  // Honor a caller-pinned lead role when it exists in the available pool.
  // In router mode it replaces the primary worker; in team mode it only
  // overrides the leadRole attribution (workers stay as routed).
  const preferredLeadRole = request.preferredLeadRole?.trim();
  const preferredLeadKnown =
    preferredLeadRole && availableRoles.some((role) => role.name === preferredLeadRole);
  const reasons = [
    `primary:${route.primary.role.name}`,
    ...route.primary.reasons,
    ...memoShadowReasons,
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
    return attachQualityRouting(
      attachP2Metadata(
        {
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
          isolation: graph.isolation,
        },
        metadata,
        request,
      ),
      qualityAuthority,
      routingAffected,
      qualityRoutingReason,
    );
  }
  const workerNames = [...new Set(route.supporting.map((match) => match.role.name))];
  const verifierRole = route.mode === "adversarial-review" ? "skeptic" : "reviewer";
  const leadRole = preferredLeadKnown
    ? preferredLeadRole!
    : workerNames.includes("planner")
      ? "planner"
      : route.primary.role.name;
  const allWorkers = workerNames.map((roleName) => ({
    roleName,
    task: taskForRole(roleName, request.task),
  }));
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
  return attachQualityRouting(
    attachP2Metadata(
      {
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
        isolation: graph.isolation,
      },
      metadata,
      request,
    ),
    qualityAuthority,
    routingAffected,
    qualityRoutingReason,
  );
}

export function shouldUpgradeToTeam(plan: OrchestratorPlan): boolean {
  return plan.mode !== "router";
}
