import type {
  TaskLedgerEdge,
  TaskLedgerEventInput,
  TaskLedgerNode,
  TaskLedgerNodeKind,
} from '@shared/types/task-ledger';

type OrchestrationWorkerLike = {
  roleName?: string;
  task?: string;
  label?: string;
};

type OrchestrationTaskNodeLike = {
  taskNodeId?: string;
  roleName?: string;
  task?: string;
  phase?: string;
  dependsOn?: string[];
  scope?: string;
  requiredCapabilities?: string[];
  isVerifier?: boolean;
};

type OrchestrationTaskEdgeLike = {
  from?: string;
  to?: string;
  type?: string;
};

type OrchestrationTaskGraphLike = {
  graphRunId?: string;
  status?: string;
  nodes?: OrchestrationTaskNodeLike[];
  edges?: OrchestrationTaskEdgeLike[];
};

type OrchestrationPlanLike = {
  mode?: string;
  leadRole?: string;
  verifierRole?: string;
  workers?: OrchestrationWorkerLike[];
  reasons?: string[];
  routeDiagnostics?: unknown;
  taskGraph?: OrchestrationTaskGraphLike;
  graphStatus?: string;
  executionWaves?: unknown;
  capabilityGaps?: unknown;
  estimatedRepairPolicy?: unknown;
};

export type OrchestrationPlanLedgerInput = {
  task: string;
  plan: OrchestrationPlanLike;
  sessionKey?: string | null;
  timestamp?: string;
};

function slugify(value: string | undefined | null, fallback: string): string {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function isVerifierNode(node: OrchestrationTaskNodeLike, plan: OrchestrationPlanLike): boolean {
  return node.isVerifier === true || node.phase === 'verifier' || Boolean(plan.verifierRole && node.roleName === plan.verifierRole);
}

function graphNodesForPlan(plan: OrchestrationPlanLike): OrchestrationTaskNodeLike[] {
  const graphNodes = plan.taskGraph?.nodes?.filter((node) => node.taskNodeId && node.roleName && node.task);
  if (graphNodes && graphNodes.length > 0) return graphNodes;

  const workerNodes = (plan.workers ?? [])
    .filter((worker) => worker.roleName && worker.task)
    .map((worker, index): OrchestrationTaskNodeLike => ({
      taskNodeId: `${slugify(worker.roleName, 'worker')}-${index + 1}`,
      roleName: worker.roleName,
      task: worker.task,
      phase: worker.roleName === plan.leadRole ? 'planning' : 'worker',
      dependsOn: [],
    }));

  if (plan.verifierRole) {
    workerNodes.push({
      taskNodeId: `${slugify(plan.verifierRole, 'verifier')}-1`,
      roleName: plan.verifierRole,
      task: `Verify completion as ${plan.verifierRole}`,
      phase: 'verifier',
      dependsOn: workerNodes.map((node) => node.taskNodeId).filter((id): id is string => Boolean(id)),
      isVerifier: true,
    });
  }

  return workerNodes;
}

function edgeKind(type: string | undefined): TaskLedgerEdge['type'] {
  if (type === 'verification') return 'needs_review';
  if (type === 'repair_of' || type === 'followup_of') return 'derived_from';
  return 'depends_on';
}

function buildProjectionMetadata(input: OrchestrationPlanLedgerInput, node?: OrchestrationTaskNodeLike): Record<string, unknown> {
  return {
    readonlyProjection: true,
    source: 'orchestrator.plan',
    projection: {
      source: 'orchestrator.plan',
      readonly: true,
    },
    orchestration: {
      task: input.task,
      mode: input.plan.mode,
      leadRole: input.plan.leadRole,
      verifierRole: input.plan.verifierRole,
      reasons: input.plan.reasons ?? [],
      graphRunId: input.plan.taskGraph?.graphRunId,
      graphStatus: input.plan.graphStatus ?? input.plan.taskGraph?.status,
      routeDiagnostics: input.plan.routeDiagnostics,
      executionWaves: input.plan.executionWaves,
      capabilityGaps: input.plan.capabilityGaps,
      estimatedRepairPolicy: input.plan.estimatedRepairPolicy,
      ...(node ? {
        taskNodeId: node.taskNodeId,
        phase: node.phase,
        requiredCapabilities: node.requiredCapabilities ?? [],
      } : {}),
    },
  };
}

export function isReadOnlyTaskLedgerProjection(node: Pick<TaskLedgerNode, 'metadata'>): boolean {
  const metadata = node.metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  if (metadata.readonlyProjection === true && (metadata.source === 'orchestrator.plan' || metadata.source === 'task-ledger.execution-contract')) return true;
  const projection = metadata.projection;
  return Boolean(
    projection
      && typeof projection === 'object'
      && (projection as Record<string, unknown>).source === 'orchestrator.plan'
      && (projection as Record<string, unknown>).readonly === true,
  );
}

export function buildOrchestrationPlanLedgerEvents(input: OrchestrationPlanLedgerInput): TaskLedgerEventInput[] {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const sessionSlug = slugify(input.sessionKey, 'detached');
  const taskSlug = slugify(input.task, 'task');
  const prefix = `orch-plan:${sessionSlug}:${taskSlug}`;
  const idempotencyKey = `orchestration-plan:${input.sessionKey ?? 'detached'}:${input.task}`;
  const nodes = graphNodesForPlan(input.plan);
  const idForTaskNode = new Map<string, string>();
  for (const node of nodes) {
    if (node.taskNodeId) idForTaskNode.set(node.taskNodeId, `${prefix}:${slugify(node.taskNodeId, 'node')}`);
  }

  const goalId = `${prefix}:goal`;
  const events: TaskLedgerEventInput[] = [{
    id: `${goalId}:created`,
    type: 'node_created',
    actor: 'assistant',
    taskId: goalId,
    sessionId: input.sessionKey ?? null,
    idempotencyKey,
    createdAt: timestamp,
    payload: {
      node: {
        id: goalId,
        title: truncate(`Plan: ${input.task}`, 160),
        kind: 'goal',
        parentId: null,
        status: 'doing',
        owner: 'agent',
        priority: 'normal',
        tags: ['orchestration-plan', input.plan.mode ?? 'unknown'].filter(Boolean),
        description: truncate(`Lead role: ${input.plan.leadRole ?? 'unknown'}. Workers: ${nodes.length}.`, 500),
        evidenceRefs: input.sessionKey ? [{ type: 'session', ref: input.sessionKey, label: 'Planning session' }] : undefined,
        metadata: buildProjectionMetadata(input),
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      },
    },
  }];

  for (const node of nodes) {
    const nodeId = node.taskNodeId ? idForTaskNode.get(node.taskNodeId) : undefined;
    if (!nodeId || !node.roleName || !node.task) continue;
    const kind: TaskLedgerNodeKind = isVerifierNode(node, input.plan) ? 'review' : 'task';
    events.push({
      id: `${nodeId}:created`,
      type: 'node_created',
      actor: 'assistant',
      taskId: nodeId,
      sessionId: input.sessionKey ?? null,
      idempotencyKey,
      createdAt: timestamp,
      payload: {
        node: {
          id: nodeId,
          title: truncate(`${node.roleName}: ${node.task}`, 160),
          kind,
          parentId: goalId,
          status: kind === 'review' ? 'review' : 'todo',
          owner: 'agent',
          priority: kind === 'review' ? 'high' : 'normal',
          tags: ['orchestration-plan', node.roleName, node.phase ?? 'worker'].filter(Boolean),
          description: node.scope && node.scope !== node.task ? `${node.task}\n\nScope: ${node.scope}` : node.task,
          evidenceRefs: input.sessionKey ? [{ type: 'session', ref: input.sessionKey, label: 'Planning session' }] : undefined,
          metadata: buildProjectionMetadata(input, node),
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
        },
      },
    });
  }

  for (const edge of input.plan.taskGraph?.edges ?? []) {
    if (!edge.from || !edge.to) continue;
    const from = idForTaskNode.get(edge.from);
    const to = idForTaskNode.get(edge.to);
    if (!from || !to) continue;
    const type = edgeKind(edge.type);
    const ledgerEdge: TaskLedgerEdge = {
      id: `${prefix}:edge:${slugify(edge.from, 'from')}:${slugify(edge.to, 'to')}:${type}`,
      from,
      to,
      type,
      label: edge.type,
      metadata: buildProjectionMetadata(input),
      createdAt: timestamp,
    };
    events.push({
      id: `${ledgerEdge.id}:added`,
      type: type === 'depends_on' ? 'dependency_added' : 'edge_added',
      actor: 'assistant',
      taskId: to,
      sessionId: input.sessionKey ?? null,
      idempotencyKey,
      createdAt: timestamp,
      payload: { edge: ledgerEdge },
    });
  }

  if (input.sessionKey) {
    events.push({
      id: `${goalId}:session-linked`,
      type: 'session_linked',
      actor: 'assistant',
      taskId: goalId,
      sessionId: input.sessionKey,
      idempotencyKey,
      createdAt: timestamp,
      payload: {
        sessionLink: {
          id: `${goalId}:session`,
          sessionKey: input.sessionKey,
          nodeId: goalId,
          relation: 'related',
          summary: truncate(`Orchestration plan for ${input.task}`, 300),
          createdAt: timestamp,
        },
      },
    });
  }

  return events;
}
