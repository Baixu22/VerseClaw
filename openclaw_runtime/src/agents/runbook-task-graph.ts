import { resolveWorkerWriteSet } from "./orchestration-protocol.js";
import type {
  OrchestrationTaskEdge,
  OrchestrationTaskGraph,
  OrchestrationTaskNode,
  OrchestrationTaskNodePhase,
} from "./orchestration-protocol.js";
import type { RunbookSelectionDetail, RunbookSelectionResult } from "./runbook-registry.js";
import type { RunbookTemplate, RunbookTemplateNode } from "./runbook-template.js";

export type RunbookTaskGraphTrace = {
  selected: RunbookSelectionDetail;
  unselected: RunbookSelectionDetail[];
};

export type RunbookTaskGraphResult = {
  graph: OrchestrationTaskGraph;
  trace: RunbookTaskGraphTrace;
};

export type BuildTaskGraphFromRunbookInput = {
  template: RunbookTemplate;
  task: string;
  graphRunId: string;
  knownRoleNames: readonly string[];
  selectionTrace?: RunbookSelectionResult;
  /** Optional file scope; applied only to writer-like runbook nodes. */
  fileHints?: readonly string[];
  includeHandoffEdges?: boolean;
};

function phaseForRunbookNode(node: RunbookTemplateNode): OrchestrationTaskNodePhase {
  if (node.verifier) {
    return "verifier";
  }
  switch (node.roleName) {
    case "planner":
      return "plan";
    case "architect":
      return "architecture";
    case "implementer":
      return "implementation";
    case "tester":
      return "verification";
    case "reviewer":
      return "review";
    case "security-reviewer":
      return "security";
    case "docs-writer":
      return "docs";
    case "skeptic":
      return "verifier";
    default:
      return "worker";
  }
}

function prefixedNodeId(template: RunbookTemplate, nodeId: string): string {
  return `${template.id}-${nodeId}`;
}

function buildEdges(
  nodes: readonly OrchestrationTaskNode[],
  includeHandoffEdges: boolean,
): OrchestrationTaskEdge[] {
  return nodes.flatMap((node) => node.dependsOn.flatMap((dependency) => {
    const type = node.isVerifier || node.phase === "verification" || node.phase === "review"
      ? "verification"
      : "dependency";
    const dependencyEdge = {
      from: dependency,
      to: node.taskNodeId,
      type,
    } satisfies OrchestrationTaskEdge;
    return includeHandoffEdges && !node.isVerifier
      ? [dependencyEdge, { from: dependency, to: node.taskNodeId, type: "handoff" as const }]
      : [dependencyEdge];
  }));
}

function selectedTrace(params: {
  template: RunbookTemplate;
  selectionTrace?: RunbookSelectionResult;
}): RunbookTaskGraphTrace {
  if (params.selectionTrace?.selected) {
    return {
      selected: {
        runbookId: params.selectionTrace.selected.runbookId,
        reasons: [...params.selectionTrace.selected.reasons],
      },
      unselected: params.selectionTrace.unselected.map((entry) => ({
        runbookId: entry.runbookId,
        reasons: [...entry.reasons],
      })),
    };
  }
  return {
    selected: {
      runbookId: params.template.id,
      reasons: ["explicit-runbook-selected"],
    },
    unselected: [],
  };
}

export function buildTaskGraphFromRunbook(
  input: BuildTaskGraphFromRunbookInput,
): RunbookTaskGraphResult {
  const knownRoles = new Set(input.knownRoleNames);
  const unknownRole = input.template.graph.nodes.find((node) => !knownRoles.has(node.roleName));
  if (unknownRole) {
    throw new Error(`Runbook node references unknown role: ${unknownRole.roleName}`);
  }

  const idMap = new Map(input.template.graph.nodes.map((node) => [node.id, prefixedNodeId(input.template, node.id)]));
  const nodes = input.template.graph.nodes.map((node) => {
    const isVerifier = node.verifier === true || node.roleName === input.template.verification.verifierRole;
    const writeSet = isVerifier
      ? undefined
      : resolveWorkerWriteSet({
          roleName: node.roleName,
          fileHints: input.fileHints,
        });
    return {
      taskNodeId: idMap.get(node.id)!,
      roleName: node.roleName,
      task: `${node.task}: ${input.task}`,
      phase: isVerifier ? "verifier" : phaseForRunbookNode(node),
      dependsOn: (node.dependsOn ?? []).map((dependency) => idMap.get(dependency) ?? dependency),
      scope: input.task,
      requiredCapabilities: [...input.template.verification.expectedEvidence],
      attemptPolicy: {
        maxRepairAttempts: isVerifier ? 0 : 1,
        maxRedoAttempts: isVerifier ? 0 : 1,
      },
      status: node.dependsOn?.length ? "planned" : "ready",
      ...(isVerifier ? { isVerifier: true } : {}),
      ...(writeSet ? { writeSet } : {}),
    } satisfies OrchestrationTaskNode;
  });

  return {
    graph: {
      graphRunId: input.graphRunId,
      mode: "staged",
      status: "planned",
      nodes,
      edges: buildEdges(nodes, input.includeHandoffEdges === true),
    },
    trace: selectedTrace({ template: input.template, selectionTrace: input.selectionTrace }),
  };
}
