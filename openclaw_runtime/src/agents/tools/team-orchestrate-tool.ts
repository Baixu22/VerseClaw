/**
 * team_orchestrate built-in tool.
 *
 * Stable role-first multi-agent coordination entrypoint for lead agents.
 * It plans with role contracts/team templates, spawns through the existing
 * subagent runtime, and relies on push-based completion announcements.
 */
import crypto from "node:crypto";
import { Type } from "typebox";
import { DEFAULT_SUBAGENT_MAX_CHILDREN_PER_AGENT } from "../../config/agent-limits.js";
import { getRuntimeConfig } from "../../config/config.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { createOrchestratorPlan } from "../orchestrator.js";
import {
  runOrchestrationObserved,
  type ObservedOrchestrationRunRequest,
} from "../orchestrator-run-observed.js";
import {
  normalizeQualityPolicy,
  normalizeGraphMode,
  normalizeRepairPolicy,
  normalizeWorkerCommunication,
  summarizeQuality,
} from "../orchestration-protocol.js";
import { synthesizeOrchestrationResult } from "../orchestration-synthesizer.js";
import type { RoleRegistryConfigCarrier } from "../role-registry.js";
import { listRoleContracts } from "../role-registry.js";
import type { SpawnFn } from "../role-spawn.js";
import { spawnSubagentDirect } from "../subagent-spawn.js";
import { buildSynthesisContract } from "../synthesis-contract.js";
import { resolveTeamTemplate } from "../team-template.js";
import type { AnyAgentTool } from "./common.js";
import {
  jsonResult,
  readPositiveIntegerParam,
  readStringParam,
  ToolInputError,
} from "./common.js";

const TEAM_ORCHESTRATE_NEXT_ACTIONS = ["yield_for_results", "synthesize_now"] as const;
const TEAM_ORCHESTRATE_STATUSES = ["accepted", "partial", "error"] as const;
const TEAM_ORCHESTRATE_QUALITY_STATE_REASON =
  "Ordinary team_orchestrate quality is scored from shadow evidence; Task Loop owns active repair quality semantics.";

type TeamOrchestrateStatus = (typeof TEAM_ORCHESTRATE_STATUSES)[number];
type TeamOrchestrateNextAction = (typeof TEAM_ORCHESTRATE_NEXT_ACTIONS)[number];

type TeamOrchestrateDeps = {
  spawn: SpawnFn;
  runObserved: typeof runOrchestrationObserved;
  idFactory: () => string;
};

const defaultDeps: TeamOrchestrateDeps = {
  spawn: spawnSubagentDirect,
  runObserved: runOrchestrationObserved,
  idFactory: () => `orch_${crypto.randomUUID()}`,
};

type TeamOrchestrateToolOptions = {
  agentSessionKey?: string;
  completionOwnerKey?: string;
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
  config?: OpenClawConfig;
  inheritedToolAllowlist?: string[];
  inheritedToolDenylist?: string[];
  deps?: Partial<TeamOrchestrateDeps>;
};

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry !== "string") {
      return [];
    }
    const trimmed = entry.trim();
    return trimmed ? [trimmed] : [];
  });
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function rolesConfig(cfg: OpenClawConfig): RoleRegistryConfigCarrier {
  return cfg as unknown as RoleRegistryConfigCarrier;
}

function readTemplateId(params: Record<string, unknown>): string | undefined {
  return readStringParam(params, "templateId") ?? readStringParam(params, "teamTemplateId");
}

function resolveMaxWorkers(params: Record<string, unknown>, cfg: OpenClawConfig): number {
  const configured =
    cfg.agents?.defaults?.subagents?.maxChildrenPerAgent ?? DEFAULT_SUBAGENT_MAX_CHILDREN_PER_AGENT;
  const requested = readPositiveIntegerParam(params, "maxWorkers");
  return Math.max(1, Math.min(configured, requested ?? configured));
}

function resolveStatus(spawnedCount: number, failureCount: number): TeamOrchestrateStatus {
  if (spawnedCount > 0 && failureCount === 0) {
    return "accepted";
  }
  if (spawnedCount > 0) {
    return "partial";
  }
  return "error";
}

function resolveNextAction(spawnedCount: number): TeamOrchestrateNextAction {
  return spawnedCount > 0 ? "yield_for_results" : "synthesize_now";
}

function buildYieldMessage(orchestrationRunId: string): string {
  return `Waiting for team_orchestrate results (${orchestrationRunId}).`;
}

export function createTeamOrchestrateTool(opts?: TeamOrchestrateToolOptions): AnyAgentTool {
  const deps = { ...defaultDeps, ...(opts?.deps ?? {}) };
  return {
    label: "Team Orchestrate",
    name: "team_orchestrate",
    displaySummary: "Spawn a role-first subagent team.",
    description:
      "Plan and start a stable role-first multi-agent workflow. Uses existing subagent completion events; after accepted spawns, call sessions_yield instead of polling.",
    parameters: Type.Object({
      task: Type.String(),
      templateId: Type.Optional(Type.String()),
      teamTemplateId: Type.Optional(Type.String()),
      runbookId: Type.Optional(Type.String()),
      explicitRunbookId: Type.Optional(Type.String()),
      fileHints: Type.Optional(Type.Array(Type.String())),
      riskHints: Type.Optional(Type.Array(Type.String())),
      capabilityHints: Type.Optional(Type.Array(Type.String())),
      toolHints: Type.Optional(Type.Array(Type.String())),
      priorFailureCount: Type.Optional(Type.Number()),
      important: Type.Optional(Type.Boolean()),
      leadRole: Type.Optional(Type.String()),
      preferredLeadRole: Type.Optional(Type.String()),
      includeVerifier: Type.Optional(Type.Boolean()),
      maxWorkers: Type.Optional(Type.Number()),
      graphMode: Type.Optional(Type.Union([
        Type.Literal("auto"),
        Type.Literal("flat"),
        Type.Literal("staged"),
      ])),
      allowAutoRepair: Type.Optional(Type.Boolean()),
      qualityPolicy: Type.Optional(Type.Union([Type.Literal("standard"), Type.Literal("strict")])),
      repairPolicy: Type.Optional(Type.Object({
        maxRepairAttempts: Type.Optional(Type.Number()),
        maxRedoAttempts: Type.Optional(Type.Number()),
        maxFollowupRuns: Type.Optional(Type.Number()),
      })),
      workerCommunication: Type.Optional(Type.Union([
        Type.Literal("none"),
        Type.Literal("lead_mediated"),
        Type.Literal("bounded_a2a"),
      ])),
      allowFollowupPlanning: Type.Optional(Type.Boolean()),
    }),
    execute: async (_toolCallId, args) => {
      const params = args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {};
      const task = readStringParam(params, "task", { required: true });
      const cfg = opts?.config ?? getRuntimeConfig();
      const cfgCarrier = rolesConfig(cfg);
      const templateId = readTemplateId(params);
      if (templateId && !resolveTeamTemplate(templateId, cfgCarrier)) {
        throw new ToolInputError(`unknown team template "${templateId}"`);
      }
      const orchestrationRunId = deps.idFactory();
      const qualityPolicy = normalizeQualityPolicy(params.qualityPolicy);
      const repairPolicy = normalizeRepairPolicy(params.repairPolicy);
      const requestedWorkerCommunication = normalizeWorkerCommunication(params.workerCommunication);
      const workerCommunication =
        requestedWorkerCommunication === "bounded_a2a" ? "none" : requestedWorkerCommunication;
      const request: ObservedOrchestrationRunRequest = {
        task,
        fileHints: readStringArray(params.fileHints),
        important: readBoolean(params.important) ?? false,
        includeVerifier: readBoolean(params.includeVerifier) ?? true,
        cfg: cfgCarrier,
        roles: listRoleContracts(cfgCarrier),
        preferredLeadRole:
          readStringParam(params, "leadRole") ?? readStringParam(params, "preferredLeadRole"),
        templateId,
        explicitRunbookId: readStringParam(params, "runbookId") ?? readStringParam(params, "explicitRunbookId"),
        riskHints: readStringArray(params.riskHints),
        capabilityHints: readStringArray(params.capabilityHints),
        toolHints: readStringArray(params.toolHints),
        priorFailureCount: readPositiveIntegerParam(params, "priorFailureCount"),
        maxWorkers: resolveMaxWorkers(params, cfg),
        graphMode: normalizeGraphMode(params.graphMode),
        allowAutoRepair: readBoolean(params.allowAutoRepair) ?? true,
        qualityPolicy,
        repairPolicy,
        workerCommunication,
        allowFollowupPlanning: readBoolean(params.allowFollowupPlanning) ?? false,
        agentId: opts?.requesterAgentIdOverride,
        orchestrationRunId,
        patchRegistryMetadata: !opts?.deps,
        // Area 3 §3.1: workspace dir enables routing memo recall/record.
        // Undefined when the caller has no workspace context → memo pilot
        // degrades to no-op (today's routing unchanged).
        workspaceDir: opts?.workspaceDir,
      };
      const plan = createOrchestratorPlan(request);
      const result = await deps.runObserved(
        request,
        {
          agentSessionKey: opts?.agentSessionKey,
          completionOwnerKey: opts?.completionOwnerKey,
          agentChannel: opts?.agentChannel,
          agentAccountId: opts?.agentAccountId,
          agentTo: opts?.agentTo,
          agentThreadId: opts?.agentThreadId,
          agentGroupId: opts?.agentGroupId,
          agentGroupChannel: opts?.agentGroupChannel,
          agentGroupSpace: opts?.agentGroupSpace,
          agentMemberRoleIds: opts?.agentMemberRoleIds,
          requesterAgentIdOverride: opts?.requesterAgentIdOverride,
          workspaceDir: opts?.workspaceDir,
          inheritedToolAllowlist: opts?.inheritedToolAllowlist,
          inheritedToolDenylist: opts?.inheritedToolDenylist,
        },
        { spawn: deps.spawn },
        { runId: orchestrationRunId, sessionKey: opts?.agentSessionKey },
      );
      const spawnedCount = result.spawnedRunIds.length;
      const status = resolveStatus(spawnedCount, result.failures.length);
      const nextAction = resolveNextAction(spawnedCount);
      const qualityScorecard = result.qualityScorecard ?? null;
      const quality = qualityScorecard?.workerScores ?? [];
      // Area 3 §3.2: build the structured synthesis contract from the plan's
      // worker output schemas. `undefined` for single-worker router-mode plans
      // (no synthesis needed) — callers degrade to today's free-form behavior.
      const synthesisContract = buildSynthesisContract(plan, cfgCarrier);
      const synthesis = synthesizeOrchestrationResult({
        bundle: result.resultBundle,
        blackboardSummary: result.blackboardSummary,
      });
      const quality: unknown[] = [];
      return jsonResult({
        status,
        plan,
        synthesisContract,
        routeDiagnostics: result.plan.routeDiagnostics,
        taskGraph: result.taskGraph,
        resultBundle: result.resultBundle,

        blackboardState: result.blackboardState,
        blackboardSummary: result.blackboardSummary,
        synthesis,
        complexityDecision: result.plan.complexityDecision,
        runbookSelection: result.plan.runbookSelection,
        graphStatus: result.graphStatus,
        executionWaves: result.executionWaves,
        schedulerMetrics: result.schedulerMetrics,
        pendingGraphNodes: result.pendingGraphNodes,
        orchestrationDiagnostics: result.orchestrationDiagnostics,
        rerouteRecommendations: result.rerouteRecommendations,
        runId: orchestrationRunId,
        orchestrationRunId,
        children: result.outcomes.map((outcome) => ({
          roleName: outcome.roleName,
          task: outcome.task,
          isVerifier: outcome.isVerifier,
          ledger: outcome.ledger,
          status: outcome.spawn.status,
          runId: outcome.spawn.result?.runId,
          childSessionKey: outcome.spawn.result?.childSessionKey,
          error: outcome.spawn.error ?? outcome.spawn.result?.error,
        })),
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
        capabilityGaps: result.plan.capabilityGaps,
        estimatedRepairPolicy: result.plan.estimatedRepairPolicy,
        quality,
        qualityState: qualityScorecard?.state ?? null,
        qualityStateReason: qualityScorecard?.reason ?? TEAM_ORCHESTRATE_QUALITY_STATE_REASON,
        qualityScorecard,
        qualitySummary: qualityScorecard?.summary ?? summarizeQuality([]),
        followupCandidates: [],
        memoryCandidates: [],
        resultPolicy: {
          completion: "team_result_bundle",
          verifier: result.pendingVerifier ? "deferred_until_workers_terminal" : "none",
          workerCommunication,
          requestedWorkerCommunication,
          boundedA2aEnabled: true,
          repairPolicy,
          qualityPolicy,
        },
        failures: result.failures,
        nextAction,
        yieldMessage: nextAction === "yield_for_results" ? buildYieldMessage(orchestrationRunId) : undefined,
      });
    },
  };
}
