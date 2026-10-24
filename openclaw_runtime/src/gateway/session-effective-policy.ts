/** Builds a secret-free, read-only session policy from existing owner facts. */
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveCliBackendConfig } from "../agents/cli-backends.js";
import { resolveThinkingDefault } from "../agents/model-thinking-default.js";
import {
  resolvePersistedSessionRuntimeId,
  resolveSessionRuntimeOverrideForProvider,
} from "../agents/session-runtime-compat.js";
import type {
  RuntimeEffectiveCapabilityObservationRead,
} from "../agents/runtime-effective-capability.js";
import { resolveSessionModelRef } from "./session-utils.js";
import {
  SESSION_EFFECTIVE_POLICY_SCHEMA,
  type SessionBackendCompatibilityRow,
  type SessionEffectivePolicy,
  type SessionPolicyAxis,
  type SessionPolicyBackend,
  type SessionPolicyContextLimits,
  type SessionPolicyFact,
  type SessionPolicyFactStatus,
  type SessionPolicyGrantSummary,
  type SessionPolicyModel,
  type SessionPolicyQueueLimits,
  type SessionPolicyResourceLimits,
  type SessionPolicyScheduleLimits,
} from "../../../shared/types/session-effective-policy.js";
import { resolveLongSessionCoordinationPolicy } from "../../../shared/long-session-resource-reclamation.js";

export type BuildSessionEffectivePolicyInput = {
  cfg: OpenClawConfig;
  workspaceId: string;
  sessionKey: string;
  agentId?: string;
  entry?: SessionEntry;
  activeRun?: { runId: string; sessionId: string; startedAtMs: number } | null;
  capabilityObservation: RuntimeEffectiveCapabilityObservationRead;
  queuedCount: number;
  nowMs?: number;
};

function fact<T>(
  value: T | null,
  status: SessionPolicyFactStatus,
  source: string,
  reason: string | null = null,
): SessionPolicyFact<T> {
  return { value, status, source, reason };
}

function axis<T>(
  configured: SessionPolicyFact<T>,
  effective: SessionPolicyFact<T>,
): SessionPolicyAxis<T> {
  return { configured, effective };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function backendKind(params: {
  runtime: string;
  cfg: OpenClawConfig;
  agentId: string;
}): { kind: SessionPolicyBackend["kind"]; ownsNativeCompaction: boolean | null } {
  if (params.runtime === "codex") {
    return { kind: "native", ownsNativeCompaction: true };
  }
  if (params.runtime === "openclaw") {
    return { kind: "openclaw", ownsNativeCompaction: false };
  }
  try {
    const cli = resolveCliBackendConfig(params.runtime, params.cfg, {
      agentId: params.agentId,
    });
    if (cli) {
      return {
        kind: "cli",
        ownsNativeCompaction: cli.ownsNativeCompaction === true,
      };
    }
  } catch {
    // A runtime not registered in this process remains unknown, not executable.
  }
  return { kind: "unknown", ownsNativeCompaction: null };
}

function resolveEffort(params: {
  cfg: OpenClawConfig;
  entry?: SessionEntry;
  agentId: string;
  provider: string;
  model: string;
}): { value: string | null; source: string } {
  const persisted = nullableString(params.entry?.thinkingLevel);
  if (persisted) return { value: persisted, source: "session.entry.thinkingLevel" };
  const agent = params.cfg.agents?.list?.find(
    (candidate) => candidate.id?.trim().toLowerCase() === params.agentId,
  );
  if (agent?.thinkingDefault) {
    return { value: agent.thinkingDefault, source: "agents.list.thinkingDefault" };
  }
  const configured = nullableString(params.cfg.agents?.defaults?.thinkingDefault);
  if (configured) {
    return { value: configured, source: "agents.defaults.thinkingDefault" };
  }
  return {
    value: resolveThinkingDefault({
      cfg: params.cfg,
      provider: params.provider,
      model: params.model,
    }),
    source: "model.thinkingDefault",
  };
}

function aggregateGrants(
  observation: RuntimeEffectiveCapabilityObservationRead,
): SessionPolicyGrantSummary | null {
  const profile = observation.state === "available" ? observation.observation?.result.profile : undefined;
  if (!profile) return null;
  const actions = profile.entries.flatMap((entry) =>
    entry.actionAuthorization.map((action) => ({
      actionId: action.actionId,
      authorization: action.authorization,
      grantState: action.grant?.state ?? null,
    })),
  );
  return {
    total: actions.length,
    allowed: actions.filter((action) => action.authorization === "allowed").length,
    requiresApproval: actions.filter((action) => action.authorization === "requires-approval").length,
    denied: actions.filter((action) => action.authorization === "denied").length,
    unknown: actions.filter((action) => action.authorization === "unknown").length,
    actions: actions.slice(0, 64),
  };
}

function contextPressure(params: {
  estimatedPromptTokens: number | null;
  contextTokenBudget: number | null;
}): "low" | "medium" | "high" | null {
  if (
    params.estimatedPromptTokens === null ||
    params.contextTokenBudget === null ||
    params.contextTokenBudget <= 0
  ) return null;
  const ratio = params.estimatedPromptTokens / params.contextTokenBudget;
  if (ratio >= 0.9) return "high";
  if (ratio >= 0.7) return "medium";
  return "low";
}

export function buildBackendCompatibilityRows(params: {
  runtime: string;
  kind: SessionPolicyBackend["kind"];
  ownsNativeCompaction: boolean | null;
}): SessionBackendCompatibilityRow[] {
  const nativeOwner = params.ownsNativeCompaction === true || params.runtime === "codex";
  if (nativeOwner) {
    return [
      {
        backend: params.runtime,
        parameter: "automatic-compaction",
        status: "ignored",
        reason: "the native backend owns automatic compaction",
      },
      {
        backend: params.runtime,
        parameter: "compaction.provider",
        status: "ignored",
        reason: "provider selection belongs to the native transcript backend",
      },
      {
        backend: params.runtime,
        parameter: "compaction.model",
        status: "ignored",
        reason: "model selection belongs to the native transcript backend",
      },
      {
        backend: params.runtime,
        parameter: "manual-compaction",
        status: "effective",
        reason: "manual compaction routes through the native backend",
      },
      {
        backend: params.runtime,
        parameter: "compaction.reserveTokens",
        status: "unsupported",
        reason: "native compaction does not consume OpenClaw reserve-token arguments",
      },
    ];
  }
  if (params.runtime === "openclaw" || params.kind === "openclaw") {
    return [
      { backend: params.runtime, parameter: "automatic-compaction", status: "configured", reason: null },
      { backend: params.runtime, parameter: "compaction.provider", status: "configured", reason: null },
      { backend: params.runtime, parameter: "compaction.model", status: "configured", reason: null },
      { backend: params.runtime, parameter: "compaction.reserveTokens", status: "configured", reason: null },
      { backend: params.runtime, parameter: "manual-compaction", status: "effective", reason: null },
    ];
  }
  return [
    {
      backend: params.runtime,
      parameter: "compaction",
      status: "unverified",
      reason: "runtime backend is not registered or its compaction ownership is unknown",
    },
  ];
}

export function buildSessionEffectivePolicy(
  input: BuildSessionEffectivePolicyInput,
): SessionEffectivePolicy {
  const nowMs = input.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const agentId =
    input.agentId?.trim() ||
    normalizeAgentIdFromKey(input.sessionKey) ||
    resolveDefaultAgentId(input.cfg);
  const persistedRuntime = resolvePersistedSessionRuntimeId(input.entry);
  const modelRef = resolveSessionModelRef(input.cfg, input.entry, agentId);
  const effectiveRuntime =
    resolveSessionRuntimeOverrideForProvider({
      provider: modelRef.provider,
      entry: persistedRuntime ? { agentRuntimeOverride: persistedRuntime } : undefined,
    }) ?? "openclaw";
  const configuredKind = backendKind({
    runtime: effectiveRuntime,
    cfg: input.cfg,
    agentId,
  });
  const configuredBackend: SessionPolicyBackend = {
    runtime: effectiveRuntime,
    kind: configuredKind.kind,
    ownsNativeCompaction: configuredKind.ownsNativeCompaction,
    provider: modelRef.provider || null,
    model: modelRef.model || null,
  };
  const effort = resolveEffort({
    cfg: input.cfg,
    entry: input.entry,
    agentId,
    provider: modelRef.provider,
    model: modelRef.model,
  });
  const configuredModel: SessionPolicyModel = {
    provider: modelRef.provider || null,
    model: modelRef.model || null,
    effort: effort.value,
  };

  const observation = input.capabilityObservation;
  const observed = observation.state === "available" ? observation.observation : undefined;
  const observedBackendId = observed?.backendId ?? null;
  const observedProvider = observed?.provider ?? null;
  const observedModel = observed?.model ?? null;
  const observedEffort = observed?.effort ?? null;
  const backendMatches =
    Boolean(observedBackendId) &&
    Boolean(observedProvider) &&
    Boolean(observedModel) &&
    observedBackendId === effectiveRuntime &&
    observedProvider === configuredBackend.provider &&
    observedModel === configuredBackend.model;
  const modelMatches =
    Boolean(observedProvider) &&
    Boolean(observedModel) &&
    observedProvider === configuredModel.provider &&
    observedModel === configuredModel.model;
  const effectiveBackend = observed && backendMatches
    ? fact(
        {
          ...configuredBackend,
          runtime: observedBackendId!,
          provider: observedProvider,
          model: observedModel,
        },
        "effective",
        "runtime-effective-capability.observation",
      )
    : fact<SessionPolicyBackend>(
        null,
        "unverified",
        "runtime-effective-capability.observation",
        observation.reason ?? "current-run backend identity is unavailable",
      );
  const effectiveModel = observed && modelMatches
    ? fact<SessionPolicyModel>(
        {
          provider: observedProvider,
          model: observedModel,
          effort: observedEffort,
        },
        "effective",
        "runtime-effective-capability.observation",
      )
    : fact<SessionPolicyModel>(
        null,
        "unverified",
        "runtime-effective-capability.observation",
        observation.reason ?? "current-run model identity is unavailable",
      );

  const configuredContext: SessionPolicyContextLimits = {
    contextTokens: nullableNumber(
      input.entry?.contextTokens ??
        input.cfg.agents?.list?.find(
          (agent) => agent.id?.trim().toLowerCase() === agentId,
        )?.contextTokens ??
        input.cfg.agents?.defaults?.contextTokens,
    ),
    contextPressure: null,
  };
  const budget = input.entry?.contextBudgetStatus;
  const budgetCurrent =
    input.activeRun !== null &&
    input.activeRun !== undefined &&
    budget !== undefined &&
    budget.sessionId === input.activeRun.sessionId &&
    budget.provider === configuredModel.provider &&
    budget.model === configuredModel.model &&
    budget.updatedAt >= input.activeRun.startedAtMs &&
    budget.contextTokenBudget > 0;
  const effectiveContext = budgetCurrent && budget
    ? fact<SessionPolicyContextLimits>(
        {
          contextTokens: budget.contextTokenBudget,
          contextPressure: contextPressure({
            estimatedPromptTokens: budget.estimatedPromptTokens,
            contextTokenBudget: budget.contextTokenBudget,
          }),
        },
        "effective",
        "session.contextBudgetStatus",
      )
    : fact<SessionPolicyContextLimits>(
        null,
        "unverified",
        "session.contextBudgetStatus",
        "no fresh context-budget observation for the current generation",
      );

  const configuredQueue: SessionPolicyQueueLimits = {
    mode: input.entry?.queueMode ?? null,
    cap: nullableNumber(input.entry?.queueCap),
    drop: input.entry?.queueDrop ?? null,
    debounceMs: nullableNumber(input.entry?.queueDebounceMs),
    queuedCount: input.queuedCount,
  };
  const hasConfiguredQueue =
    configuredQueue.mode !== null ||
    configuredQueue.cap !== null ||
    configuredQueue.drop !== null ||
    configuredQueue.debounceMs !== null;
  const effectiveQueue = fact<SessionPolicyQueueLimits>(
    configuredQueue,
    hasConfiguredQueue || input.queuedCount >= 0 ? "effective" : "unverified",
    "session.entry.queue + long-task-control.queue",
    hasConfiguredQueue || input.queuedCount >= 0 ? null : "queue owner read unavailable",
  );

  const defaults = input.cfg.agents?.defaults;
  const longSessionPolicy = resolveLongSessionCoordinationPolicy();
  const configuredResources: SessionPolicyResourceLimits = {
    maxConcurrentRuns: nullableNumber(defaults?.maxConcurrent),
    maxConcurrentSubagents: nullableNumber(defaults?.subagents?.maxConcurrent),
    maxSpawnDepth: nullableNumber(defaults?.subagents?.maxSpawnDepth),
    maxChildrenPerAgent: nullableNumber(defaults?.subagents?.maxChildrenPerAgent),
    maxProcesses: longSessionPolicy.maxProcesses,
    maxRssMb: longSessionPolicy.maxRssMb,
    maxBackgroundTerminals: longSessionPolicy.maxBackgroundTerminals,
    maxWorktrees: longSessionPolicy.maxWorktrees,
    idleTtlMs: longSessionPolicy.idleTtlMs,
    keepOnLeave: longSessionPolicy.keepOnLeave,
  };
  const configuredSchedule: SessionPolicyScheduleLimits = {
    cronEnabled: typeof input.cfg.cron?.enabled === "boolean" ? input.cfg.cron.enabled : null,
    cronMaxConcurrentRuns: nullableNumber(input.cfg.cron?.maxConcurrentRuns),
    sessionRetention:
      input.cfg.cron?.sessionRetention === false
        ? "disabled"
        : nullableString(input.cfg.cron?.sessionRetention),
  };
  const grantSummary = aggregateGrants(observation);
  const runtimeGeneration =
    observed?.result.profile.runtimeGeneration ??
    null;
  const generationState =
    observation.state === "available"
      ? "effective"
      : observation.state === "stale"
        ? "stale"
        : observation.state === "mismatch"
          ? "mismatch"
          : observation.state === "missing"
            ? "missing"
            : "unverified";

  return {
    schemaVersion: SESSION_EFFECTIVE_POLICY_SCHEMA,
    generatedAt,
    scope: {
      workspaceId: input.workspaceId.trim() || "unknown",
      sessionKey: input.sessionKey.trim(),
      agentId,
      sessionId: input.entry?.sessionId ?? input.activeRun?.sessionId ?? null,
      runId: input.activeRun?.runId ?? null,
    },
    generation: {
      state: generationState,
      runtimeGeneration,
      capabilityProfileGeneration: runtimeGeneration,
      observedAt: observed ? new Date(observed.observedAtMs).toISOString() : null,
      reason: observation.reason,
    },
    backend: axis(
      fact(configuredBackend, "configured", "session.runtime + model resolution"),
      effectiveBackend,
    ),
    model: axis(
      fact(configuredModel, "configured", "session.model + model resolution + effort defaults", effort.source),
      effectiveModel,
    ),
    grants: axis(
      fact<SessionPolicyGrantSummary>(null, "unverified", "runtime-effective-capability.observation", "grants are owned by runtime facts"),
      fact<SessionPolicyGrantSummary>(
        grantSummary,
        grantSummary ? "effective" : "unverified",
        "runtime-effective-capability.observation",
        grantSummary ? null : observation.reason ?? "grants unavailable",
      ),
    ),
    context: axis(
      fact(configuredContext, configuredContext.contextTokens === null ? "unverified" : "configured", "session/agent context limits"),
      effectiveContext,
    ),
    queue: axis(
      fact(configuredQueue, hasConfiguredQueue ? "configured" : "unverified", "session.entry.queue", hasConfiguredQueue ? null : "no persisted queue override"),
      effectiveQueue,
    ),
    resources: axis(
      fact(configuredResources, Object.values(configuredResources).some((value) => value !== null) ? "configured" : "unverified", "agents.defaults concurrency/subagent limits + explicit long-session flags"),
      fact<SessionPolicyResourceLimits>(
        configuredResources,
        Object.values(configuredResources).some((value) => value !== null) ? "effective" : "unverified",
        "session coordination policy (explicit values only)",
        Object.values(configuredResources).some((value) => value !== null)
          ? null
          : "no explicit long-session resource policy or agent.defaults limits are configured",
      ),
    ),
    schedule: axis(
      fact(configuredSchedule, Object.values(configuredSchedule).some((value) => value !== null) ? "configured" : "unverified", "cron configuration"),
      fact<SessionPolicyScheduleLimits>(null, "unverified", "cron.owner", "current schedule state is not part of this read"),
    ),
    compatibility: buildBackendCompatibilityRows({
      runtime: effectiveRuntime,
      kind: configuredKind.kind,
      ownsNativeCompaction: configuredKind.ownsNativeCompaction,
    }),
    sources: [
      "session.entry",
      "agents.defaults",
      "model resolution",
      "runtime-effective-capability.observation",
      "long-task-control.queue",
      "cron configuration",
    ],
  };
}

function normalizeAgentIdFromKey(sessionKey: string): string | null {
  const parts = sessionKey.trim().toLowerCase().split(":").filter(Boolean);
  return parts[0] === "agent" ? parts[1] ?? null : null;
}
