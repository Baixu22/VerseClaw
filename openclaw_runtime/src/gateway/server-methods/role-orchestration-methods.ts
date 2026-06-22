// Role-first orchestration gateway methods.
//
// Exposes the role registry, team templates, and orchestrator planning/execution
// to operator clients (ClawX UI). Read methods are pure over the runtime config;
// orchestrator.run anchors on a caller-provided sessionKey and spawns real
// role-driven subagents via runOrchestration (orchestrator-run.ts).
//
// Params are parsed defensively here rather than via generated protocol
// validators, so no change to the gateway-protocol package is required.
import crypto from "node:crypto";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { compileRoleContractToSoul } from "../../agents/role-contract.js";
import { listRoleContracts, resolveRoleContract } from "../../agents/role-registry.js";
import { getTeamTemplateSnapshot, resolveTeamTemplate } from "../../agents/team-template.js";
import { createOrchestratorPlan, type OrchestratorWorkerPlan } from "../../agents/orchestrator.js";
import { runOrchestrationObserved, type OrchestrationLifecycleEvent } from "../../agents/orchestrator-run-observed.js";
import {
  normalizeQualityPolicy,
  normalizeGraphMode,
  normalizeRepairPolicy,
  normalizeWorkerCommunication,
  summarizeQuality,
} from "../../agents/orchestration-protocol.js";
import { spawnSubagentDirect } from "../../agents/subagent-spawn.js";
import { getTaskLoopRun, runTaskLoop, type TaskLoopLifecycleEvent } from "../../agents/task-loop-controller.js";
import { DEFAULT_SUBAGENT_MAX_CHILDREN_PER_AGENT } from "../../config/agent-limits.js";
import { storeRuntimeTrace, getRuntimeTraceBuffer, getRuntimeScorecards } from "../../observability/trace-buffer.js";
import type { ObservabilityTrace } from "../../observability/types.js";
import {
  archiveMemoryCard,
  buildMemoryMergeDraft,
  checkMemoryEvidence,
  ensureMemoryCardsLoaded,
  explainMemoryInjection,
  getMemoryCards,
  getMemoryConflictDetail,
  getMemoryDetail,
  getMemoryHealthReport,
  getRoleMemoryPolicy,
  getMemoryStats,
  listMemoryAuditEvents,
  listMemoryConflicts,
  listMemoryProposals,
  listMemoryRetentionCandidates,
  listMemoryVersions,
  mergeMemoryEntries,
  previewMemoryProposal,
  proposeMemoryRetention,
  proposeMemoryCard,
  reviewMemoryProposalBatch,
  reviewMemoryProposalRecord,
  resolveMemoryConflict,
  restoreMemoryCardAsProposal,
  simulateMemoryInjection,
  supersedeMemoryCard,
  updateMemoryCard,
} from "../../memory/memory-store.js";
import type { MemoryPhaseTag, MemoryProposal, MemoryRetentionAction, MemoryReviewAction } from "../../memory/types.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveControlPlaneActor, formatControlPlaneActor } from "../control-plane-audit.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const text = readString(entry);
    return text ? [text] : [];
  });
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const next = Math.floor(value);
  return next > 0 ? next : undefined;
}

/** Config carrier shape the role registry reads (cfg.agents.roles). */
function rolesConfig(cfg: OpenClawConfig): { agents?: { roles?: unknown; teams?: unknown } } {
  return cfg as unknown as { agents?: { roles?: unknown; teams?: unknown } };
}

function respondMissingTask(respond: RespondFn, method: string): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `${method} requires a non-empty "task" string`),
  );
}

function readTemplateId(params: Record<string, unknown>): string | undefined {
  return readString(params.templateId) ?? readString(params.teamTemplateId);
}

function resolveMaxWorkers(params: Record<string, unknown>, cfg: OpenClawConfig): number {
  const configured =
    cfg.agents?.defaults?.subagents?.maxChildrenPerAgent ?? DEFAULT_SUBAGENT_MAX_CHILDREN_PER_AGENT;
  const requested = readPositiveInteger(params.maxWorkers);
  return Math.max(1, Math.min(configured, requested ?? configured));
}

function validateTemplateId(
  respond: RespondFn,
  cfg: OpenClawConfig,
  templateId: string | undefined,
): boolean {
  if (!templateId) {
    return true;
  }
  if (resolveTeamTemplate(templateId, rolesConfig(cfg))) {
    return true;
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `unknown team template "${templateId}"`),
  );
  return false;
}

function readWorkerCommunication(value: unknown): "none" | "lead_mediated" {
  const requested = normalizeWorkerCommunication(value);
  return requested === "bounded_a2a" ? "none" : requested;
}

function readExplicitWorkers(
  params: Record<string, unknown>,
  respond: RespondFn,
  cfg: OpenClawConfig,
): OrchestratorWorkerPlan[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, "workers")) {
    return undefined;
  }
  if (!Array.isArray(params.workers) || params.workers.length === 0) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'orchestrator workers must be a non-empty array'));
    return undefined;
  }
  const workers: OrchestratorWorkerPlan[] = [];
  for (const [index, rawWorker] of params.workers.entries()) {
    if (!isRecord(rawWorker)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `orchestrator worker ${index + 1} must be an object`));
      return undefined;
    }
    const roleName = readString(rawWorker.roleName);
    const task = readString(rawWorker.task);
    if (!roleName || !task) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `orchestrator worker ${index + 1} requires roleName and task`));
      return undefined;
    }
    if (!resolveRoleContract(roleName, rolesConfig(cfg))) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown role "${roleName}"`));
      return undefined;
    }
    workers.push({
      roleName,
      task,
      ...(readString(rawWorker.label) ? { label: readString(rawWorker.label) } : {}),
      ...(readString(rawWorker.modelRef) ? { modelRef: readString(rawWorker.modelRef) } : {}),
    });
  }
  return workers;
}

export const roleOrchestrationHandlers: GatewayRequestHandlers = {
  "roles.list": async ({ respond, context }) => {
    const cfg = context.getRuntimeConfig();
    const roles = listRoleContracts(rolesConfig(cfg));
    respond(true, { roles, count: roles.length }, undefined);
  },

  "roles.get": async ({ params, respond, context }) => {
    const name = readString(params.name) ?? readString(params.role);
    if (!name) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, 'roles.get requires a "name" string'),
      );
      return;
    }
    const cfg = context.getRuntimeConfig();
    const role = resolveRoleContract(name, rolesConfig(cfg));
    if (!role) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown role "${name}"`));
      return;
    }
    respond(true, { role, soul: compileRoleContractToSoul(role) }, undefined);
  },

  "teams.list": async ({ respond, context }) => {
    const cfg = context.getRuntimeConfig();
    respond(true, getTeamTemplateSnapshot(rolesConfig(cfg) as { agents?: { teams?: unknown } }), undefined);
  },

  "orchestrator.plan": async ({ params, respond, context }) => {
    const task = readString(params.task);
    if (!task) {
      respondMissingTask(respond, "orchestrator.plan");
      return;
    }
    const cfg = context.getRuntimeConfig();
    const templateId = readTemplateId(params);
    if (!validateTemplateId(respond, cfg, templateId)) {
      return;
    }
    const workers = readExplicitWorkers(params, respond, cfg);
    if (Object.prototype.hasOwnProperty.call(params, "workers") && !workers) {
      return;
    }
    const plan = createOrchestratorPlan({
      task,
      fileHints: readStringArray(params.fileHints),
      important: readBoolean(params.important) ?? false,
      workers,
      templateId,
      maxWorkers: resolveMaxWorkers(params, cfg),
      graphMode: normalizeGraphMode(params.graphMode),
      allowAutoRepair: readBoolean(params.allowAutoRepair) ?? true,
      cfg: rolesConfig(cfg),
      roles: listRoleContracts(rolesConfig(cfg)),
      preferredLeadRole: readString(params.leadRole) ?? readString(params.preferredLeadRole),
      qualityPolicy: normalizeQualityPolicy(params.qualityPolicy),
      repairPolicy: normalizeRepairPolicy(params.repairPolicy),
      workerCommunication: readWorkerCommunication(params.workerCommunication),
      allowFollowupPlanning: readBoolean(params.allowFollowupPlanning) ?? false,
    });
    respond(true, {
      plan,
      taskGraph: plan.taskGraph,
      executionWaves: plan.executionWaves,
      routeDiagnostics: plan.routeDiagnostics,
      capabilityGaps: plan.capabilityGaps,
      estimatedRepairPolicy: plan.estimatedRepairPolicy,
    }, undefined);
  },

  "orchestrator.run": async ({ params, respond, context, client }) => {
    const task = readString(params.task);
    if (!task) {
      respondMissingTask(respond, "orchestrator.run");
      return;
    }
    const sessionKey = readString(params.sessionKey);
    if (!sessionKey) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          'orchestrator.run requires a "sessionKey" to anchor spawned subagents',
        ),
      );
      return;
    }
    const cfg = context.getRuntimeConfig();
    const templateId = readTemplateId(params);
    if (!validateTemplateId(respond, cfg, templateId)) {
      return;
    }
    const workers = readExplicitWorkers(params, respond, cfg);
    if (Object.prototype.hasOwnProperty.call(params, "workers") && !workers) {
      return;
    }
    const orchestrationRunId = `orch_${crypto.randomUUID()}`;
    // Capture actor identity for the audit log (enterprise: who/which/when).
    const actor = resolveControlPlaneActor(client ?? null);
    const leadRoleHint = readString(params.leadRole) ?? readString(params.preferredLeadRole) ?? "auto";
    // Broadcast lifecycle events to all operator clients so the renderer can
    // show real-time orchestration progress (per-worker started/completed/error).
    const broadcastLifecycle = (event: OrchestrationLifecycleEvent) => {
      try {
        context.broadcast("subagent-lifecycle", { sessionKey, ...event }, { dropIfSlow: true });
      } catch { /* broadcast is best-effort */ }
    };
    try {
      const result = await runOrchestrationObserved(
        {
          task,
          fileHints: readStringArray(params.fileHints),
          important: readBoolean(params.important) ?? false,
          includeVerifier: readBoolean(params.includeVerifier) ?? true,
          agentId: readString(params.agentId),
          workers,
          templateId,
          maxWorkers: resolveMaxWorkers(params, cfg),
          graphMode: normalizeGraphMode(params.graphMode),
          allowAutoRepair: readBoolean(params.allowAutoRepair) ?? true,
          cfg: rolesConfig(cfg),
          roles: listRoleContracts(rolesConfig(cfg)),
          preferredLeadRole: readString(params.leadRole) ?? readString(params.preferredLeadRole),
          qualityPolicy: normalizeQualityPolicy(params.qualityPolicy),
          repairPolicy: normalizeRepairPolicy(params.repairPolicy),
          workerCommunication: readWorkerCommunication(params.workerCommunication),
          allowFollowupPlanning: readBoolean(params.allowFollowupPlanning) ?? false,
          orchestrationRunId,
          patchRegistryMetadata: true,
        },
        {
          agentSessionKey: sessionKey,
          ...(readString(params.agentId) ? { requesterAgentIdOverride: readString(params.agentId) } : {}),
        },
        { spawn: spawnSubagentDirect },
        { sessionKey, runId: orchestrationRunId },
        broadcastLifecycle,
      );
      // Audit log: structured record for enterprise compliance/observability.
      context.logGateway.info(
        `[role-audit] orchestrator.run ${formatControlPlaneActor(actor)} lead=${leadRoleHint} mode=${result.plan.mode} workers=${result.spawnedRunIds.length} failures=${result.failures.length} sessionKey=${sessionKey}`,
      );
      respond(
        true,
        {
          orchestrationRunId,
          plan: result.plan,
          routeDiagnostics: result.plan.routeDiagnostics,
          taskGraph: result.taskGraph,
          graphStatus: result.graphStatus,
          executionWaves: result.executionWaves,
          spawnedRunIds: result.spawnedRunIds,
          expectedChildren: result.outcomes
            .filter((outcome) => !outcome.isVerifier)
            .map((outcome) => ({
              roleName: outcome.roleName,
              task: outcome.task,
              taskId: outcome.ledger.taskId,
              roleInstanceId: outcome.ledger.roleInstanceId,
              runId: outcome.spawn.result?.runId,
              childSessionKey: outcome.spawn.result?.childSessionKey,
            })),
          pendingVerifier: result.pendingVerifier,
          attempts: result.attempts,
          pendingGraphNodes: result.pendingGraphNodes,
          repairNodes: result.repairNodes,
          rerouteRecommendations: result.rerouteRecommendations,
          capabilityGaps: result.plan.capabilityGaps,
          estimatedRepairPolicy: result.plan.estimatedRepairPolicy,
          quality: [],
          qualitySummary: summarizeQuality([]),
          followupCandidates: [],
          memoryCandidates: [],
          outcomes: result.outcomes.map((outcome) => ({
            roleName: outcome.roleName,
            task: outcome.task,
            isVerifier: outcome.isVerifier,
            ledger: outcome.ledger,
            status: outcome.spawn.status,
            runId: outcome.spawn.result?.runId,
            childSessionKey: outcome.spawn.result?.childSessionKey,
            error: outcome.spawn.error ?? outcome.spawn.result?.error,
          })),
          failures: result.failures,
        },
        undefined,
      );
    } catch (err) {
      context.logGateway.warn(
        `[role-audit] orchestrator.run FAILED ${formatControlPlaneActor(actor)} lead=${leadRoleHint} error=${err instanceof Error ? err.message : String(err)} sessionKey=${sessionKey}`,
      );
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `orchestrator.run failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  },

  // ── Observability bridge ──
  "task_loop.run": async ({ params, respond, context, client }) => {
    const task = readString(params.task);
    if (!task) {
      respondMissingTask(respond, "task_loop.run");
      return;
    }
    const sessionKey = readString(params.sessionKey);
    if (!sessionKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, 'task_loop.run requires a "sessionKey"'),
      );
      return;
    }
    const cfg = context.getRuntimeConfig();
    const actor = resolveControlPlaneActor(client ?? null);
    const broadcastLifecycle = (event: TaskLoopLifecycleEvent) => {
      try {
        context.broadcast("task-loop-lifecycle", event, { dropIfSlow: true });
      } catch { /* broadcast is best-effort */ }
    };
    const broadcastSubagentLifecycle = (event: OrchestrationLifecycleEvent) => {
      try {
        context.broadcast("subagent-lifecycle", { sessionKey, ...event }, { dropIfSlow: true });
      } catch { /* broadcast is best-effort */ }
    };
    try {
      const result = await runTaskLoop(
        {
          task,
          sessionKey,
          agentId: readString(params.agentId),
          fileHints: readStringArray(params.fileHints),
          acceptance: readStringArray(params.acceptance),
          important: readBoolean(params.important) ?? false,
          includeVerifier: readBoolean(params.includeVerifier),
          templateId: readTemplateId(params),
          leadRole: readString(params.leadRole),
          preferredLeadRole: readString(params.preferredLeadRole),
          maxWorkers: readPositiveInteger(params.maxWorkers),
        },
        cfg,
        {
          spawn: spawnSubagentDirect,
          lifecycle: broadcastLifecycle,
          orchestrationLifecycle: broadcastSubagentLifecycle,
        },
      );
      context.logGateway.info(
        `[role-audit] task_loop.run ${formatControlPlaneActor(actor)} status=${result.status} loopRunId=${result.loopRunId} sessionKey=${sessionKey}`,
      );
      respond(true, { loop: result }, undefined);
    } catch (err) {
      context.logGateway.warn(
        `[role-audit] task_loop.run FAILED ${formatControlPlaneActor(actor)} error=${err instanceof Error ? err.message : String(err)} sessionKey=${sessionKey}`,
      );
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `task_loop.run failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  },

  "task_loop.status": async ({ params, respond }) => {
    const loopRunId = readString(params.loopRunId);
    if (!loopRunId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, 'task_loop.status requires a "loopRunId"'),
      );
      return;
    }
    const loop = getTaskLoopRun(loopRunId);
    if (!loop) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown task loop "${loopRunId}"`));
      return;
    }
    respond(true, { loop }, undefined);
  },

  "observability.reportTrace": async ({ params, respond }) => {
    const trace = params.trace as ObservabilityTrace | undefined;
    if (!trace || typeof trace !== "object" || !trace.id) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, 'observability.reportTrace requires a { trace } object with at least an "id" field'),
      );
      return;
    }
    storeRuntimeTrace(trace);
    respond(true, { ok: true, traceId: trace.id }, undefined);
  },

  "observability.traces": async ({ respond }) => {
    respond(true, { traces: getRuntimeTraceBuffer(), scorecards: getRuntimeScorecards() }, undefined);
  },

  // ── Memory subsystem ──
  "memory.list": async ({ params, respond }) => {
    ensureMemoryCardsLoaded();
    const cards = getMemoryCards({
      scope: readString(params.scope),
      scopeKey: readString(params.scopeKey),
      roleName: readString(params.roleName),
      status: readString(params.status),
      type: readString(params.type),
      sensitivity: readString(params.sensitivity),
      conflictStatus: readString(params.conflictStatus),
    });
    respond(true, { cards, count: cards.length }, undefined);
  },

  "memory.propose": async ({ params, respond }) => {
    const proposal = params.proposal as MemoryProposal | undefined;
    if (!proposal || typeof proposal !== "object" || !proposal.content) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, 'memory.propose requires a { proposal } object with at least a "content" field'),
      );
      return;
    }
    ensureMemoryCardsLoaded();
    respond(
      true,
      proposeMemoryCard(proposal),
      undefined,
    );
  },

  "memory.previewProposal": async ({ params, respond }) => {
    const proposal = params.proposal as MemoryProposal | undefined;
    const operation = readString(params.operation);
    const targetId = readString(params.targetId ?? params.id);
    if (!proposal || typeof proposal !== "object" || (!proposal.content && !targetId)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, 'memory.previewProposal requires a { proposal } object with content or a target id'),
      );
      return;
    }
    ensureMemoryCardsLoaded();
    respond(
      true,
      {
        preview: previewMemoryProposal(proposal, {
          operation: operation === "create" || operation === "update" || operation === "archive" || operation === "supersede" || operation === "tombstone"
            ? operation
            : undefined,
          targetId,
        }),
      },
      undefined,
    );
  },

  "memory.store": async ({ params, respond }) => {
    const proposal = params.proposal as MemoryProposal | undefined;
    if (!proposal || typeof proposal !== "object" || !proposal.content) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, 'memory.store requires a { proposal } object with at least a "content" field'),
      );
      return;
    }
    ensureMemoryCardsLoaded();
    respond(true, { legacy: true, ...proposeMemoryCard(proposal) }, undefined);
  },

  "memory.update": async ({ params, respond }) => {
    const id = readString(params.id);
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.update requires an "id" string'));
      return;
    }
    respond(true, updateMemoryCard(id, (params.patch ?? params.proposal ?? {}) as Partial<MemoryProposal>), undefined);
  },

  "memory.archive": async ({ params, respond }) => {
    const id = readString(params.id);
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.archive requires an "id" string'));
      return;
    }
    const tombstone = readBoolean(params.tombstone) === true;
    respond(true, archiveMemoryCard(id, tombstone ? "tombstone" : "archived"), undefined);
  },

  "memory.supersede": async ({ params, respond }) => {
    const id = readString(params.id);
    const proposal = params.proposal as MemoryProposal | undefined;
    if (!id || !proposal || typeof proposal !== "object" || !proposal.content) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.supersede requires "id" and { proposal }'));
      return;
    }
    respond(true, supersedeMemoryCard(id, proposal), undefined);
  },

  "memory.conflicts": async ({ params, respond }) => {
    respond(true, { conflicts: listMemoryConflicts({ status: readString(params.status) }) }, undefined);
  },

  "memory.conflictDetail": async ({ params, respond }) => {
    const id = readString(params.id);
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.conflictDetail requires "id"'));
      return;
    }
    respond(true, getMemoryConflictDetail(id), undefined);
  },

  "memory.proposals": async ({ params, respond }) => {
    respond(true, {
      proposals: listMemoryProposals({
        status: readString(params.status),
        roleName: readString(params.roleName),
        scope: readString(params.scope),
        operation: readString(params.operation),
        decision: readString(params.decision),
        limit: typeof params.limit === "number" ? params.limit : undefined,
      }),
    }, undefined);
  },

  "memory.review": async ({ params, respond }) => {
    const id = readString(params.id);
    const action = readString(params.action);
    if (!id || !action || !["approve", "reject", "applyAsCold", "supersede", "merge"].includes(action)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.review requires "id" and a valid "action"'));
      return;
    }
    respond(true, reviewMemoryProposalRecord(id, action as "approve" | "reject" | "applyAsCold" | "supersede" | "merge", {
      reason: readString(params.reason),
    }), undefined);
  },

  "memory.reviewBatch": async ({ params, respond }) => {
    const ids = readStringArray(params.ids ?? params.proposalIds);
    const action = readString(params.action);
    if (ids.length === 0 || !action || !["approve", "reject", "applyAsCold", "supersede", "merge"].includes(action)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.reviewBatch requires "ids" and a valid "action"'));
      return;
    }
    respond(true, reviewMemoryProposalBatch({
      ids,
      action: action as MemoryReviewAction,
      reason: readString(params.reason),
    }), undefined);
  },

  "memory.merge": async ({ params, respond }) => {
    respond(true, mergeMemoryEntries({
      cardIds: readStringArray(params.cardIds),
      proposalIds: readStringArray(params.proposalIds),
      content: readString(params.content),
      roleTags: readStringArray(params.roleTags),
      scope: readString(params.scope) as MemoryProposal["scope"] | undefined,
      scopeKey: readString(params.scopeKey) ?? null,
      reason: readString(params.reason),
    }), undefined);
  },

  "memory.mergeDraft": async ({ params, respond }) => {
    const suggestedAction = readString(params.suggestedAction);
    respond(true, buildMemoryMergeDraft({
      cardIds: readStringArray(params.cardIds),
      proposalIds: readStringArray(params.proposalIds),
      content: readString(params.content),
      roleTags: readStringArray(params.roleTags),
      scope: readString(params.scope) as MemoryProposal["scope"] | undefined,
      scopeKey: readString(params.scopeKey) ?? null,
      suggestedAction: suggestedAction === "supersede" ? "supersede" : "merge",
    }), undefined);
  },

  "memory.versions": async ({ params, respond }) => {
    const cardId = readString(params.cardId ?? params.id);
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.versions requires "cardId"'));
      return;
    }
    respond(true, { versions: listMemoryVersions({ cardId, limit: typeof params.limit === "number" ? params.limit : undefined }) }, undefined);
  },

  "memory.audit": async ({ params, respond }) => {
    respond(true, {
      events: listMemoryAuditEvents({
        cardId: readString(params.cardId),
        action: readString(params.action),
        limit: typeof params.limit === "number" ? params.limit : undefined,
      }),
    }, undefined);
  },

  "memory.stats": async ({ respond }) => {
    respond(true, { stats: getMemoryStats() }, undefined);
  },

  "memory.policy": async ({ respond }) => {
    respond(true, { policy: getRoleMemoryPolicy() }, undefined);
  },

  "memory.retentionCandidates": async ({ params, respond }) => {
    respond(true, {
      candidates: listMemoryRetentionCandidates({
        roleName: readString(params.roleName),
        limit: typeof params.limit === "number" ? params.limit : undefined,
        includeKeep: readBoolean(params.includeKeep) === true,
      }),
    }, undefined);
  },

  "memory.retentionPropose": async ({ params, respond }) => {
    const action = readString(params.action);
    if (action && !["cold", "archive", "tombstone", "review"].includes(action)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.retentionPropose action must be cold, archive, tombstone, or review'));
      return;
    }
    respond(true, proposeMemoryRetention({
      cardId: readString(params.cardId ?? params.id),
      cardIds: readStringArray(params.cardIds),
      roleName: readString(params.roleName),
      action: action as MemoryRetentionAction | undefined,
      limit: typeof params.limit === "number" ? params.limit : undefined,
      reason: readString(params.reason),
    }), undefined);
  },

  "memory.evidenceCheck": async ({ params, respond }) => {
    const kind = readString(params.kind);
    respond(true, checkMemoryEvidence({
      id: readString(params.id),
      kind: kind === "proposal" ? "proposal" : "card",
      refs: Array.isArray(params.refs) ? params.refs as MemoryProposal["evidenceRefs"] : undefined,
      content: readString(params.content),
    }), undefined);
  },

  "memory.simulateInjection": async ({ params, respond }) => {
    const roleName = readString(params.roleName);
    if (!roleName) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.simulateInjection requires "roleName"'));
      return;
    }
    respond(true, simulateMemoryInjection({
      roleName,
      phase: readString(params.phase) as MemoryPhaseTag | undefined,
      task: readString(params.task ?? params.taskState),
    }), undefined);
  },

  "memory.health": async ({ respond }) => {
    respond(true, { health: getMemoryHealthReport() }, undefined);
  },

  "memory.detail": async ({ params, respond }) => {
    const id = readString(params.id);
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.detail requires "id"'));
      return;
    }
    const kind = readString(params.kind);
    respond(true, getMemoryDetail({
      id,
      kind: kind === "card" || kind === "proposal" || kind === "conflict" || kind === "injection" ? kind : undefined,
    }), undefined);
  },

  "memory.restore": async ({ params, respond }) => {
    const id = readString(params.id);
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.restore requires "id"'));
      return;
    }
    respond(true, restoreMemoryCardAsProposal(id, { reason: readString(params.reason) }), undefined);
  },

  "memory.resolveConflict": async ({ params, respond }) => {
    const id = readString(params.id);
    const resolution = readString(params.resolution);
    if (!id || !resolution) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.resolveConflict requires "id" and "resolution"'));
      return;
    }
    const conflict = resolveMemoryConflict(id, resolution);
    respond(true, { resolved: Boolean(conflict), conflict }, undefined);
  },

  "memory.explainInjection": async ({ params, respond }) => {
    respond(
      true,
      {
        injections: explainMemoryInjection({
          id: readString(params.id),
          roleName: readString(params.roleName),
          sessionKey: readString(params.sessionKey),
          limit: typeof params.limit === "number" ? params.limit : undefined,
        }),
      },
      undefined,
    );
  },
};
