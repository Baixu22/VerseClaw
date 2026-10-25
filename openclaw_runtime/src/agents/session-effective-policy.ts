/**
 * Builds a read-only SessionEffectivePolicy/v1 projection from current owner facts.
 * It consumes the TF-0512 runtime snapshot instead of creating another capability
 * inventory, and it never writes config, executes tools or expands grants.
 */
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  type SessionEntry,
} from "../config/sessions.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import type { WorkspacePermissionMode } from "../../../shared/types/workspace.js";
import {
  SESSION_EFFECTIVE_POLICY_SCHEMA,
  type SessionBackendDescriptor,
  type SessionCompactionCompatibility,
  type SessionEffectivePolicy,
  type SessionPolicyFact,
  type SessionPolicyFactState,
  type SessionPolicyGenerationState,
} from "../../../shared/types/session-effective-policy.js";
import {
  readRuntimeEffectiveCapabilitySnapshot,
  type RuntimeEffectiveCapabilitySnapshot,
} from "./runtime-effective-capability.js";
import {
  resolvePersistedSessionRuntimeId,
  resolveSessionRuntimeOverrideForProvider,
} from "./session-runtime-compat.js";
import { readCodexAppServerBinding } from "../../extensions/codex/src/app-server/session-binding.js";
import { buildAnthropicCliBackend } from "../../extensions/anthropic/cli-backend.js";

const SESSION_EFFECTIVE_SNAPSHOT_TTL_MS = 30_000;
const CLAUDE_BACKEND = buildAnthropicCliBackend();

type PolicyNow = () => number;

export type BuildSessionEffectivePolicyInput = {
  cfg: OpenClawConfig;
  entry: SessionEntry;
  workspaceId: string;
  sessionKey: string;
  permissionMode: WorkspacePermissionMode;
  sessionFile?: string;
  expectedRuntimeGeneration?: string | null;
  nowMs?: PolicyNow;
  snapshotTtlMs?: number;
};

function fact<T>(
  state: SessionPolicyFactState,
  value: T | null,
  source: string,
  reason: string | null = null,
  observedAt: string | null = null,
): SessionPolicyFact<T> {
  return { state, value, source, reason, observedAt };
}

function iso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function configuredModel(entry: SessionEntry): { provider: string | null; model: string | null } {
  return {
    provider: optionalText(entry.providerOverride) ?? optionalText(entry.modelProvider),
    model: optionalText(entry.modelOverride) ?? optionalText(entry.model),
  };
}

function effortValue(entry: SessionEntry): string | null {
  return optionalText(entry.thinkingLevel)
    ?? optionalText(entry.reasoningLevel)
    ?? optionalText(entry.verboseLevel);
}

function modelFact(
  entry: SessionEntry,
  generationState: SessionPolicyGenerationState,
  observedAt: string | null,
): SessionEffectivePolicy["model"] {
  const configured = configuredModel(entry);
  const hasConfigured = Boolean(configured.provider || configured.model);
  const configuredFact = fact(
    hasConfigured ? "configured" : "unknown",
    hasConfigured ? configured : null,
    "session-entry.model-override",
    hasConfigured ? null : "No session-level provider/model override is recorded.",
    observedAt,
  );
  const actual = {
    provider: optionalText(entry.modelProvider),
    model: optionalText(entry.model),
  };
  const effectiveState = generationState === "current" && Boolean(actual.provider || actual.model)
    ? "effective"
    : generationState === "missing" || generationState === "stale" || generationState === "mismatch"
      ? "unknown"
      : "unverified";
  const effectiveFact = fact(
    effectiveState,
    effectiveState === "effective" ? actual : null,
    "session-entry.model",
    effectiveState === "effective"
      ? null
      : generationState === "current"
        ? "The current runtime snapshot does not include an observed model pair."
        : `Runtime ModelCapabilityProfile is ${generationState}.`,
    observedAt,
  );
  const effort = effortValue(entry);
  const effortFact = fact(
    effort ? (generationState === "current" ? "effective" : "configured") : "unknown",
    effort,
    "session-entry.effort",
    effort ? null : "No session effort preference is recorded.",
    observedAt,
  );
  return { configured: configuredFact, effective: effectiveFact, effort: effortFact };
}

function actionSummary(profile: RuntimeEffectiveCapabilitySnapshot | null): {
  allowed: string[];
  requiresApproval: string[];
  denied: string[];
  unknown: string[];
} | null {
  if (!profile) return null;
  const groups = {
    allowed: new Set<string>(),
    requiresApproval: new Set<string>(),
    denied: new Set<string>(),
    unknown: new Set<string>(),
  };
  for (const entry of profile.profile.entries) {
    if (entry.runtimeAvailability.state !== "enabled") continue;
    for (const action of entry.actionAuthorization) {
      if (action.authorization === "allowed") groups.allowed.add(action.actionId);
      else if (action.authorization === "requires-approval") groups.requiresApproval.add(action.actionId);
      else if (action.authorization === "denied" || action.authorization === "not-applicable") groups.denied.add(action.actionId);
      else groups.unknown.add(action.actionId);
    }
  }
  return {
    allowed: [...groups.allowed].sort(),
    requiresApproval: [...groups.requiresApproval].sort(),
    denied: [...groups.denied].sort(),
    unknown: [...groups.unknown].sort(),
  };
}

function listCompactionPaths(cfg: OpenClawConfig, sessionKey: string): string[] {
  const paths = new Set<string>();
  const agents = record(cfg.agents);
  const defaults = record(agents?.defaults);
  if (record(defaults?.compaction)) paths.add("agents.defaults.compaction");
  const agentId = parseAgentSessionKey(sessionKey)?.agentId;
  const list = Array.isArray(agents?.list) ? agents?.list : [];
  const active = agentId
    ? list.find((candidate) => optionalText(record(candidate)?.id)?.toLowerCase() === agentId.toLowerCase())
    : undefined;
  if (record(record(active)?.compaction)) paths.add(`agents.list.${agentId ?? "unknown"}.compaction`);
  return [...paths].sort();
}

function compatibilityForBackend(
  backendKind: SessionBackendDescriptor["kind"],
  cfg: OpenClawConfig,
  sessionKey: string,
): SessionCompactionCompatibility {
  const paths = listCompactionPaths(cfg, sessionKey);
  if (backendKind === "codex-app-server") {
    return {
      nativeCompactionOwner: "backend",
      parameters: paths.map((path) => ({
        path,
        state: "ignored",
        reason: "Codex app-server owns native compaction; OpenClaw compaction model/provider overrides are not applied.",
      })),
    };
  }
  if (backendKind === "claude-cli" || backendKind === "custom-cli") {
    return {
      nativeCompactionOwner: "backend",
      parameters: paths.map((path) => ({
        path,
        state: "ignored",
        reason: "The CLI backend owns native compaction; OpenClaw compaction overrides are not applied.",
      })),
    };
  }
  if (backendKind === "openclaw-embedded") {
    return {
      nativeCompactionOwner: "openclaw",
      parameters: paths.map((path) => ({ path, state: "effective", reason: null })),
    };
  }
  return {
    nativeCompactionOwner: "unknown",
    parameters: paths.map((path) => ({
      path,
      state: "unknown",
      reason: "The actual backend has not been verified for this session.",
    })),
  };
}

function contextLimit(entry: SessionEntry): SessionEffectivePolicy["limits"]["context"] {
  const status = entry.contextBudgetStatus;
  if (!status) {
    return fact<{ usedTokens: number | null; contextTokenBudget: number | null; reserveTokens: number | null; overflowTokens: number | null }>(
      "unknown",
      null,
      "session-entry.contextBudgetStatus",
      "No context budget observation is available.",
    );
  }
  return fact(
    "effective",
    {
      usedTokens: status.estimatedPromptTokens,
      contextTokenBudget: status.contextTokenBudget,
      reserveTokens: status.effectiveReserveTokens,
      overflowTokens: status.overflowTokens,
    },
    "session-entry.contextBudgetStatus",
    null,
    iso(status.updatedAt),
  );
}

function queueLimit(entry: SessionEntry): SessionEffectivePolicy["limits"]["queue"] {
  const value = {
    mode: entry.queueMode ?? null,
    cap: entry.queueCap ?? null,
    debounceMs: entry.queueDebounceMs ?? null,
    drop: entry.queueDrop ?? null,
  };
  const configured = Boolean(value.mode || value.cap != null || value.debounceMs != null || value.drop);
  return fact(
    configured ? "configured" : "unknown",
    configured ? value : null,
    "session-entry.queue",
    configured ? "Configured queue policy; effective admission still belongs to the runtime queue owner." : "No queue policy is recorded.",
  );
}

async function resolveBackend(
  input: BuildSessionEffectivePolicyInput,
  snapshot: RuntimeEffectiveCapabilitySnapshot | null,
): Promise<SessionEffectivePolicy["backend"]> {
  const configuredRuntime = resolvePersistedSessionRuntimeId(input.entry) ?? "openclaw";
  const provider = optionalText(input.entry.providerOverride)
    ?? optionalText(input.entry.modelProvider)
    ?? "";
  const resolvedRuntime = resolveSessionRuntimeOverrideForProvider({
    provider,
    entry: input.entry,
  }) ?? configuredRuntime;
  const configured = fact(
    "configured",
    configuredRuntime,
    "session-entry.agent-runtime-override",
    null,
  );
  let bindingFact: SessionEffectivePolicy["backend"]["binding"];
  let descriptor: SessionBackendDescriptor | null = null;
  const normalizedRuntime = resolvedRuntime.toLowerCase();
  if (normalizedRuntime.includes("codex")) {
    const binding = input.sessionFile
      ? await readCodexAppServerBinding(input.sessionFile, { config: input.cfg }).catch(() => undefined)
      : undefined;
    descriptor = binding?.threadId
      ? {
          id: "codex-app-server",
          kind: "codex-app-server",
          modelProvider: binding.modelProvider ?? optionalText(input.entry.modelProvider),
          model: binding.model ?? optionalText(input.entry.model),
          nativeThreadId: binding.threadId,
          nativeSessionId: null,
        }
      : null;
    bindingFact = binding?.threadId
      ? fact("effective", { kind: "codex-app-server", id: binding.threadId }, "codex-app-server.binding")
      : fact<{ kind: string; id: string }>("unverified", null, "codex-app-server.binding", "No verified Codex native thread binding is available.");
  } else if (
    normalizedRuntime.includes("claude") ||
    normalizedRuntime.includes("anthropic") ||
    normalizedRuntime === CLAUDE_BACKEND.id
  ) {
    const nativeSessionId = optionalText(input.entry.claudeCliSessionId)
      ?? Object.values(input.entry.cliSessionIds ?? {}).map(optionalText).find(Boolean)
      ?? null;
    descriptor = nativeSessionId
      ? {
          id: CLAUDE_BACKEND.id,
          kind: "claude-cli",
          modelProvider: optionalText(input.entry.modelProvider),
          model: optionalText(input.entry.model),
          nativeThreadId: null,
          nativeSessionId,
        }
      : null;
    bindingFact = nativeSessionId
      ? fact("effective", { kind: "claude-cli", id: nativeSessionId }, "session-entry.claude-cli-session")
      : fact<{ kind: string; id: string }>("unverified", null, "session-entry.claude-cli-session", "No Claude CLI native session binding is available.");
  } else if (snapshot) {
    descriptor = {
      id: "openclaw-embedded",
      kind: "openclaw-embedded",
      modelProvider: optionalText(input.entry.modelProvider),
      model: optionalText(input.entry.model),
      nativeThreadId: null,
      nativeSessionId: null,
    };
    bindingFact = fact(
      "effective",
      { kind: "session", id: input.entry.sessionId },
      "runtime.ModelCapabilityProfile",
      null,
      snapshot.profile.observedAt,
    );
  } else {
    bindingFact = fact<{ kind: string; id: string }>("unknown", null, "runtime.ModelCapabilityProfile", "The current runtime snapshot is unavailable.");
  }

  const effective: SessionEffectivePolicy["backend"]["effective"] = descriptor && snapshot
    ? fact<SessionBackendDescriptor>("effective", descriptor, "runtime.ModelCapabilityProfile", null, snapshot.profile.observedAt)
    : fact<SessionBackendDescriptor>(
        "unknown",
        null,
        "runtime.ModelCapabilityProfile",
        snapshot ? "The configured native backend binding is not verified." : "No fresh runtime capability snapshot exists for this session.",
      );
  const kind = descriptor?.kind ?? "unknown";
  return {
    configured,
    effective,
    binding: bindingFact,
    compatibility: compatibilityForBackend(kind, input.cfg, input.sessionKey),
  };
}

export async function buildSessionEffectivePolicy(
  input: BuildSessionEffectivePolicyInput,
): Promise<SessionEffectivePolicy> {
  const nowMs = input.nowMs?.() ?? Date.now();
  const observedAt = iso(nowMs);
  const ttlMs = input.snapshotTtlMs ?? SESSION_EFFECTIVE_SNAPSHOT_TTL_MS;
  const rawSnapshot = readRuntimeEffectiveCapabilitySnapshot({
    workspaceId: input.workspaceId,
    sessionKey: input.sessionKey,
    nowMs,
    ttlMs: Number.MAX_SAFE_INTEGER,
  });
  const expectedGeneration = input.expectedRuntimeGeneration?.trim() || null;
  let generationState: SessionPolicyGenerationState = "missing";
  let snapshot: RuntimeEffectiveCapabilitySnapshot | null = null;
  if (rawSnapshot) {
    if (expectedGeneration && rawSnapshot.runtimeGeneration !== expectedGeneration) {
      generationState = "mismatch";
    } else if (rawSnapshot.source !== "runtime") {
      generationState = "unverified";
    } else if (nowMs - rawSnapshot.observedAtMs > ttlMs) {
      generationState = "stale";
    } else {
      generationState = "current";
      snapshot = rawSnapshot;
    }
  }
  const profileObservedAt = rawSnapshot?.profile.observedAt ?? null;
  const effectiveBackend = await resolveBackend(input, snapshot);
  const model = modelFact(input.entry, generationState, snapshot?.profile.observedAt ?? null);
  const actionFacts = actionSummary(snapshot);
  const modeFact = fact(
    "effective",
    input.permissionMode,
    "main.workspace.permissionMode",
    "Authorization is reported by the Main workspace owner; this projection does not grant permissions.",
  );
  const actionsFact: SessionEffectivePolicy["grant"]["effectiveActions"] = actionFacts
    ? fact("effective", actionFacts, "runtime.ModelCapabilityProfile.actionAuthorization", null, snapshot?.profile.observedAt ?? null)
    : fact<{ allowed: string[]; requiresApproval: string[]; denied: string[]; unknown: string[] }>(
        "unknown",
        null,
        "runtime.ModelCapabilityProfile.actionAuthorization",
        `Runtime ModelCapabilityProfile is ${generationState}.`,
      );
  const resources: SessionEffectivePolicy["limits"]["resources"] = fact(
    input.entry.spawnDepth != null || input.entry.subagentControlScope
      ? "configured"
      : "unknown",
    input.entry.spawnDepth != null || input.entry.subagentControlScope
      ? {
          spawnDepth: input.entry.spawnDepth ?? null,
          subagentControlScope: input.entry.subagentControlScope ?? null,
          inheritedToolAllowCount: input.entry.inheritedToolAllow?.length ?? 0,
          inheritedToolDenyCount: input.entry.inheritedToolDeny?.length ?? 0,
        }
      : null,
    "session-entry.resource-scope",
    "Resource ownership remains with the terminal/browser/background/worktree owners; this policy only reports the session scope hints.",
  );
  const schedule: SessionEffectivePolicy["limits"]["schedule"] = fact<{ jobIds: string[] }>(
    "unsupported",
    null,
    "cron-workboard.owner",
    "Cron/Workboard scheduling is not owned by the session policy projection; follow-up scheduling is delivered by its existing owner.",
  );
  const diagnostics: SessionEffectivePolicy["diagnostics"] = [];
  if (generationState !== "current") {
    diagnostics.push({
      code: `runtime-profile-${generationState}`,
      severity: "warning",
      message: `Runtime effective facts are ${generationState}; configured values are not promoted to effective.`,
    });
  }
  if (effectiveBackend.compatibility.nativeCompactionOwner === "backend") {
    diagnostics.push({
      code: "native-compaction-owner",
      severity: "info",
      message: "The selected backend owns native compaction; OpenClaw compaction overrides are reported per parameter.",
    });
  }
  return {
    schemaVersion: SESSION_EFFECTIVE_POLICY_SCHEMA,
    generatedAt: observedAt,
    scope: {
      workspaceId: input.workspaceId,
      sessionKey: input.sessionKey,
      sessionId: input.entry.sessionId,
      agentId: parseAgentSessionKey(input.sessionKey)?.agentId ?? "unknown",
      permissionMode: input.permissionMode,
    },
    generation: {
      state: generationState,
      runtimeGeneration: rawSnapshot?.runtimeGeneration ?? null,
      runId: rawSnapshot?.runId ?? null,
      profileObservedAt,
    },
    backend: effectiveBackend,
    model,
    grant: { mode: modeFact, effectiveActions: actionsFact },
    limits: {
      context: contextLimit(input.entry),
      queue: queueLimit(input.entry),
      resources,
      schedule,
    },
    diagnostics,
  };
}
