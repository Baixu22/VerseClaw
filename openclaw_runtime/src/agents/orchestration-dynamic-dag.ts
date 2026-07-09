import type {
  OrchestrationTaskEdge,
  OrchestrationTaskGraph,
  OrchestrationTaskNode,
  OrchestrationTaskNodePhase,
} from "./orchestration-protocol.js";
import type { RoleContract } from "./role-contract.js";
import {
  scheduleResourceAwareWaves,
  type ResourceScheduleResult,
} from "./orchestration-resource-scheduler.js";

export type LocalDynamicDagIssue = {
  path: string;
  message: string;
};

export type LocalDynamicDagRefinementProposal = {
  taskNodeId: string;
  sourceTaskNodeId: string;
  roleName: string;
  task: string;
  reason: string;
  scope: string;
  attempt: number;
  dependsOn?: string[];
  requiredCapabilities?: string[];
  phase?: OrchestrationTaskNodePhase;
};

export type LocalDynamicDagRefinement = {
  taskNodeId: string;
  sourceTaskNodeId: string;
  reason: string;
  scope: string;
  attempt: number;
};

export type LocalDynamicDagRefinementInput = {
  graph: OrchestrationTaskGraph;
  roles: readonly RoleContract[];
  proposals: readonly LocalDynamicDagRefinementProposal[];
  maxActiveRoles?: number;
  authorizedRoleNames?: readonly string[];
  authorizedCapabilities?: readonly string[];
};

export type LocalDynamicDagRefinementResult = {
  graph: OrchestrationTaskGraph;
  refinements: LocalDynamicDagRefinement[];
  issues: LocalDynamicDagIssue[];
  schedule: ResourceScheduleResult;
};

const UNSAFE_PROPOSAL_KEYS = new Set(["tools", "permissions", "prompt", "memoryWrite"]);

function issue(path: string, message: string): LocalDynamicDagIssue {
  return { path, message };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function schedule(graph: OrchestrationTaskGraph, roles: readonly RoleContract[], maxActiveRoles: number | undefined): ResourceScheduleResult {
  return scheduleResourceAwareWaves({
    graph,
    roles,
    options: { maxActiveRoles },
  });
}

function cloneGraph(graph: OrchestrationTaskGraph): OrchestrationTaskGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      dependsOn: [...node.dependsOn],
      requiredCapabilities: [...node.requiredCapabilities],
      attemptPolicy: { ...node.attemptPolicy },
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

function validateProposal(params: {
  proposal: LocalDynamicDagRefinementProposal;
  index: number;
  source?: OrchestrationTaskNode;
  existingNodeIds: Set<string>;
  proposedNodeIds: Set<string>;
  duplicateProposalIds: Set<string>;
  graphRoleNames: Set<string>;
  knownRoleNames: Set<string>;
  authorizedRoleNames: Set<string>;
  authorizedCapabilities: Set<string>;
}): LocalDynamicDagIssue[] {
  const path = `proposals.${params.index}`;
  const issues: LocalDynamicDagIssue[] = [];
  const record = params.proposal as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (UNSAFE_PROPOSAL_KEYS.has(key)) {
      issues.push(issue(`${path}.${key}`, "Dynamic DAG refinement cannot grant tools, permissions, prompts, or memory writes."));
    }
  }
  if (!hasText(params.proposal.taskNodeId)) {
    issues.push(issue(`${path}.taskNodeId`, "Refinement proposal requires a taskNodeId."));
  }
  if (params.existingNodeIds.has(params.proposal.taskNodeId)) {
    issues.push(issue(`${path}.taskNodeId`, "Refinement proposal cannot reuse an existing task node id."));
  }
  if (params.duplicateProposalIds.has(params.proposal.taskNodeId)) {
    issues.push(issue(`${path}.taskNodeId`, "Refinement proposal task node ids must be unique within the proposal batch."));
  }
  if (!params.source) {
    issues.push(issue(`${path}.sourceTaskNodeId`, "Refinement proposal source node must exist in the current graph."));
  }
  if (!params.knownRoleNames.has(params.proposal.roleName)) {
    issues.push(issue(`${path}.roleName`, "Refinement proposal role must have a known RoleContract."));
  } else if (!params.graphRoleNames.has(params.proposal.roleName) && !params.authorizedRoleNames.has(params.proposal.roleName)) {
    issues.push(issue(`${path}.roleName`, "Refinement proposal role must already be authorized by the current graph."));
  }
  if (!hasText(params.proposal.task)) {
    issues.push(issue(`${path}.task`, "Refinement proposal requires a task."));
  }
  if (!hasText(params.proposal.reason)) {
    issues.push(issue(`${path}.reason`, "Refinement proposal requires a reason."));
  }
  if (!hasText(params.proposal.scope)) {
    issues.push(issue(`${path}.scope`, "Refinement proposal requires a scope."));
  }
  if (!Number.isInteger(params.proposal.attempt) || params.proposal.attempt < 1) {
    issues.push(issue(`${path}.attempt`, "Refinement proposal attempt must be a positive integer."));
  }

  const allowedDependencyIds = new Set([...params.existingNodeIds, ...params.proposedNodeIds]);
  const dependencies = params.proposal.dependsOn ?? [params.proposal.sourceTaskNodeId];
  dependencies.forEach((dependency, dependencyIndex) => {
    if (dependency === params.proposal.taskNodeId) {
      issues.push(issue(`${path}.dependsOn.${dependencyIndex}`, "Refinement proposal cannot depend on itself."));
    }
    if (!allowedDependencyIds.has(dependency)) {
      issues.push(issue(`${path}.dependsOn.${dependencyIndex}`, "Refinement dependency must reference an existing or proposed node."));
    }
  });

  const sourceCapabilities = new Set(params.source?.requiredCapabilities ?? []);
  const requestedCapabilities = params.proposal.requiredCapabilities ?? [...sourceCapabilities];
  requestedCapabilities.forEach((capability, capabilityIndex) => {
    if (!sourceCapabilities.has(capability) && !params.authorizedCapabilities.has(capability)) {
      issues.push(issue(`${path}.requiredCapabilities.${capabilityIndex}`, "Refinement capability must stay within source scope or explicit authorization."));
    }
  });

  return issues;
}

function buildEdges(graph: OrchestrationTaskGraph, newNodes: readonly OrchestrationTaskNode[]): OrchestrationTaskEdge[] {
  const edges = graph.edges.map((edge) => ({ ...edge }));
  for (const node of newNodes) {
    for (const dependency of node.dependsOn) {
      edges.push({
        from: dependency,
        to: node.taskNodeId,
        type: dependency === node.followupOf ? "followup_of" : "dependency",
      });
    }
  }
  return edges;
}

export function refineLocalDynamicDag(input: LocalDynamicDagRefinementInput): LocalDynamicDagRefinementResult {
  const graph = cloneGraph(input.graph);
  const existingNodeIds = new Set(graph.nodes.map((node) => node.taskNodeId));
  const proposedNodeIds = new Set(input.proposals.map((proposal) => proposal.taskNodeId));
  const proposalIdCounts = new Map<string, number>();
  for (const proposal of input.proposals) {
    proposalIdCounts.set(proposal.taskNodeId, (proposalIdCounts.get(proposal.taskNodeId) ?? 0) + 1);
  }
  const duplicateProposalIds = new Set([...proposalIdCounts].filter(([, count]) => count > 1).map(([id]) => id));
  const graphRoleNames = new Set(graph.nodes.map((node) => node.roleName));
  const knownRoleNames = new Set(input.roles.map((role) => role.name));
  const authorizedRoleNames = new Set(input.authorizedRoleNames ?? []);
  const authorizedCapabilities = new Set(input.authorizedCapabilities ?? []);

  const issues = input.proposals.flatMap((proposal, index) => validateProposal({
    proposal,
    index,
    source: graph.nodes.find((node) => node.taskNodeId === proposal.sourceTaskNodeId),
    existingNodeIds,
    proposedNodeIds,
    duplicateProposalIds,
    graphRoleNames,
    knownRoleNames,
    authorizedRoleNames,
    authorizedCapabilities,
  }));

  if (issues.length > 0) {
    return {
      graph,
      refinements: [],
      issues,
      schedule: schedule(graph, input.roles, input.maxActiveRoles),
    };
  }

  const newNodes = input.proposals.map((proposal) => {
    const source = graph.nodes.find((node) => node.taskNodeId === proposal.sourceTaskNodeId)!;
    return {
      taskNodeId: proposal.taskNodeId,
      roleName: proposal.roleName,
      task: proposal.task,
      phase: proposal.phase ?? source.phase,
      dependsOn: [...(proposal.dependsOn ?? [proposal.sourceTaskNodeId])],
      scope: proposal.scope,
      requiredCapabilities: [...(proposal.requiredCapabilities ?? source.requiredCapabilities)],
      attemptPolicy: { ...source.attemptPolicy },
      status: "planned",
      followupOf: proposal.sourceTaskNodeId,
    } satisfies OrchestrationTaskNode;
  });
  const nextGraph: OrchestrationTaskGraph = {
    ...graph,
    nodes: [...graph.nodes, ...newNodes],
    edges: buildEdges(graph, newNodes),
  };

  return {
    graph: nextGraph,
    refinements: input.proposals.map((proposal) => ({
      taskNodeId: proposal.taskNodeId,
      sourceTaskNodeId: proposal.sourceTaskNodeId,
      reason: proposal.reason,
      scope: proposal.scope,
      attempt: proposal.attempt,
    })),
    issues: [],
    schedule: schedule(nextGraph, input.roles, input.maxActiveRoles),
  };
}
