/**
 * Runtime effective-state adapter for ModelCapabilityProfile/v1.
 *
 * The static disposition catalog describes ownership and intended visibility.
 * It cannot prove that a tool, driver, grant, acknowledgement, or quarantine is
 * usable for the next model call. This adapter builds that proof from current
 * runtime facts and deliberately degrades unknown facts instead of inferring
 * availability from configuration or a previous snapshot.
 */
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { AnyAgentTool } from "./tools/common.js";
import { buildRuntimeCompatibleToolInventory } from "./tools-effective-inventory-build.js";
import {
  buildRuntimeFlagAck,
  missingRuntimeFlagAckFields,
  RUNTIME_FLAG_ACK_GENERATION_ENV,
  type RuntimeFlagAckPayload,
} from "../context-engine/runtime-flag-ack.js";
import {
  buildModelCapabilityProfile,
  createModelCapabilityStaticManifest,
  type ModelCapabilityActionFact,
  type ModelCapabilityAckFact,
  type ModelCapabilityDriverFact,
  type ModelCapabilityEffectiveFactInput,
  type ModelCapabilityEffectiveFactsInput,
  type ModelCapabilityGrantFact,
  type ModelCapabilityMemoryFact,
  type ModelCapabilityProfile,
  type ModelCapabilityQuarantineFact,
  type ModelCapabilityScope,
} from "../../../shared/model-capability-profile.js";

const DEFAULT_RUNTIME_FACT_TTL_MS = 30_000;
const CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV = "VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH";

export type RuntimeCapabilityGrantInput = {
  capabilityId: string;
  actionIds: readonly string[];
  grantId: string;
  state: ModelCapabilityGrantFact["state"];
  expiresAt: string | null;
  authorization?: ModelCapabilityActionFact["authorization"];
};

export type RuntimeCapabilityMemoryInput = ModelCapabilityMemoryFact;
export type RuntimeCapabilityKnowledgeInput = ModelCapabilityEffectiveFactInput["knowledge"];
export type RuntimeCapabilityQuarantineInput = ModelCapabilityQuarantineFact & { capabilityId: string };
export type RuntimeCapabilityStateInput = {
  capabilityId: string;
  state: ModelCapabilityEffectiveFactInput["runtimeAvailability"]["state"];
  source: string;
  reason: string | null;
};
export type RuntimeCapabilityStateGenerationGuard = {
  readonly runId: string;
  readonly generation: number;
  isCurrent: (runId: string, generation: number) => boolean;
  next: () => number;
};

export type RuntimeEffectiveCapabilityInput = {
  workspaceId: string;
  workspaceDir: string;
  sessionKey: string;
  sessionId?: string;
  runId?: string;
  backendId?: string;
  provider?: string;
  model?: string;
  effort?: string | null;
  /** Gateway restart generation. Defaults to the generation stamped into this process. */
  runtimeGeneration?: string;
  tools: readonly AnyAgentTool[];
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  runtimeAck?: RuntimeFlagAckPayload | null;
  grants?: readonly RuntimeCapabilityGrantInput[];
  memory?: RuntimeCapabilityMemoryInput;
  knowledge?: RuntimeCapabilityKnowledgeInput;
  quarantine?: readonly RuntimeCapabilityQuarantineInput[];
  runtimeStates?: readonly RuntimeCapabilityStateInput[];
  driver?: ModelCapabilityDriverFact;
  nowMs?: () => number;
  ttlMs?: number;
  generationGuard?: RuntimeCapabilityStateGenerationGuard;
};

export type RuntimeEffectiveCapabilityResult = {
  profile: ModelCapabilityProfile;
  source: "runtime" | "fallback";
  ack: ModelCapabilityAckFact;
  effectiveToolNames: readonly string[];
  effectiveDigest: string;
};

export type RuntimeEffectiveCapabilityObservation = {
  workspaceId: string;
  sessionKey: string;
  sessionId: string | null;
  runId: string | null;
  backendId: string | null;
  provider: string | null;
  model: string | null;
  effort: string | null;
  result: RuntimeEffectiveCapabilityResult;
  observedAtMs: number;
};

export type RuntimeEffectiveCapabilityObservationRead = {
  state: "available" | "unverified" | "stale" | "mismatch" | "missing";
  reason: string | null;
  observation: RuntimeEffectiveCapabilityObservation | null;
};

const runtimeCapabilityObservations = new Map<string, RuntimeEffectiveCapabilityObservation>();
const RUNTIME_CAPABILITY_OBSERVATION_MAX_ENTRIES = 256;
const RUNTIME_CAPABILITY_OBSERVATION_RETENTION_MS = 5 * 60_000;

function observationKey(workspaceId: string, sessionKey: string): string {
  return `${workspaceId.trim()}\u0000${sessionKey.trim()}`;
}

function trimOptional(value: string | undefined | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function recordRuntimeCapabilityObservation(
  input: RuntimeEffectiveCapabilityInput,
  result: RuntimeEffectiveCapabilityResult,
  observedAtMs: number,
): void {
  const now = Date.now();
  for (const [key, observation] of runtimeCapabilityObservations) {
    if (now - observation.observedAtMs > RUNTIME_CAPABILITY_OBSERVATION_RETENTION_MS) {
      runtimeCapabilityObservations.delete(key);
    }
  }
  const key = observationKey(input.workspaceId, input.sessionKey);
  runtimeCapabilityObservations.set(key, {
    workspaceId: input.workspaceId.trim(),
    sessionKey: input.sessionKey.trim(),
    sessionId: trimOptional(input.sessionId),
    runId: trimOptional(input.runId ?? input.generationGuard?.runId),
    backendId: trimOptional(input.backendId),
    provider: trimOptional(input.provider),
    model: trimOptional(input.model),
    effort: trimOptional(input.effort),
    result,
    observedAtMs,
  });
  if (runtimeCapabilityObservations.size > RUNTIME_CAPABILITY_OBSERVATION_MAX_ENTRIES) {
    const oldest = [...runtimeCapabilityObservations.entries()].sort(
      (left, right) => left[1].observedAtMs - right[1].observedAtMs,
    )[0];
    if (oldest) runtimeCapabilityObservations.delete(oldest[0]);
  }
}

export function readRuntimeEffectiveCapabilityObservation(params: {
  workspaceId: string;
  sessionKey: string;
  sessionId?: string | null;
  runId?: string | null;
  runtimeGeneration?: string | null;
  nowMs?: number;
  ttlMs?: number;
}): RuntimeEffectiveCapabilityObservationRead {
  const observation = runtimeCapabilityObservations.get(
    observationKey(params.workspaceId, params.sessionKey),
  );
  if (!observation) {
    return { state: "missing", reason: "no-current-run-capability-profile", observation: null };
  }
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = params.ttlMs ?? DEFAULT_RUNTIME_FACT_TTL_MS;
  if (nowMs - observation.observedAtMs > ttlMs || observation.observedAtMs > nowMs) {
    return { state: "stale", reason: "capability-profile-outside-observation-ttl", observation };
  }
  const requestedSessionId = trimOptional(params.sessionId);
  if (requestedSessionId && observation.sessionId && requestedSessionId !== observation.sessionId) {
    return { state: "mismatch", reason: "session-generation-mismatch", observation };
  }
  const requestedRunId = trimOptional(params.runId);
  if (requestedRunId && observation.runId && requestedRunId !== observation.runId) {
    return { state: "mismatch", reason: "run-generation-mismatch", observation };
  }
  const expectedGeneration = trimOptional(params.runtimeGeneration);
  if (!expectedGeneration) {
    return { state: "unverified", reason: "runtime-generation-unknown", observation };
  }
  if (observation.result.profile.runtimeGeneration !== expectedGeneration) {
    return { state: "mismatch", reason: "gateway-generation-mismatch", observation };
  }
  if (observation.result.source !== "runtime") {
    return { state: "unverified", reason: "capability-profile-fallback", observation };
  }
  return { state: "available", reason: null, observation };
}

/** Test-only reset for the bounded observation cache. */
export function clearRuntimeEffectiveCapabilityObservationsForTest(): void {
  runtimeCapabilityObservations.clear();
}

export function composeRuntimeEffectiveCapabilitySystemPrompt(
  systemPrompt: string,
  result: RuntimeEffectiveCapabilityResult,
): string {
  const addition = result.profile.promptAddition.text.trim();
  return addition ? `${systemPrompt}\n\n${addition}` : systemPrompt;
}

export function createRuntimeCapabilityStateGenerationGuard(
  runId: string,
): RuntimeCapabilityStateGenerationGuard {
  let generation = 0;
  return {
    runId,
    get generation() {
      return generation;
    },
    isCurrent: (candidateRunId, candidateGeneration) =>
      candidateRunId === runId && candidateGeneration === generation,
    next: () => {
      generation += 1;
      return generation;
    },
  };
}

function iso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function toolCallableName(capabilityId: string, names: readonly string[]): string | null {
  const candidates: Record<string, readonly string[]> = {
    "component.coding-execution-backend": ["exec", "apply_patch", "write", "edit"],
    "component.role-memory": ["memory_query", "memory_recall", "memory_update"],
    "component.dcs-context-tools": ["context_read", "context_search", "context_write"],
    "component.working-memory-context": ["context_read", "context_write"],
    "component.browser-session-owner": ["agent_browser", "browser"],
    "component.tool-search-schema-expander": ["tool_search", "tool_describe", "tool_call"],
    "component.skills-mcp-source-registry": ["tool_search", "mcp"],
  };
  return candidates[capabilityId]?.find((name) => names.includes(name)) ?? null;
}

function permissionMode(input: RuntimeEffectiveCapabilityInput): "readOnly" | "plan" | "acceptEdits" | "fullAccess" {
  const mode = input.cfg.tools?.exec?.mode;
  if (mode === "full") return "fullAccess";
  if (mode === "auto") return "acceptEdits";
  if (mode === "ask") return "plan";
  if (mode === "deny" || mode === "allowlist") return "readOnly";
  const security = input.cfg.tools?.exec?.security;
  if (security === "full") return "fullAccess";
  if (security === "deny") return "readOnly";
  return "readOnly";
}

function ackFactFromPayload(payload: RuntimeFlagAckPayload | null): ModelCapabilityAckFact {
  if (!payload) {
    return { state: "unknown", generation: null, source: null, rejectedFields: [], observedAt: null };
  }
  const missing = missingRuntimeFlagAckFields(payload);
  const trustedGeneration = hasTrustedRuntimeGeneration(payload.gatewayGeneration);
  const rejectedFields = uniqueSorted([
    ...missing,
    ...(payload.rejectedFlags ?? []).map((entry) => entry.id),
  ]);
  const complete = trustedGeneration && missing.length === 0 && payload.degradedReason === null;
  return {
    state: complete
      ? "acknowledged"
      : rejectedFields.length > 0
        ? "rejected"
        : trustedGeneration
          ? "pending"
          : "unknown",
    generation: trustedGeneration ? payload.gatewayGeneration.trim() : null,
    source: "runtime.flags.ack",
    rejectedFields,
    observedAt: payload.answeredAt,
  };
}

function collectAck(input: RuntimeEffectiveCapabilityInput): { payload: RuntimeFlagAckPayload | null; fact: ModelCapabilityAckFact } {
  if (input.runtimeAck !== undefined) {
    return { payload: input.runtimeAck, fact: ackFactFromPayload(input.runtimeAck) };
  }
  try {
    const payload = buildRuntimeFlagAck({ cfg: input.cfg, env: input.env ?? process.env });
    return { payload, fact: ackFactFromPayload(payload) };
  } catch {
    return { payload: null, fact: ackFactFromPayload(null) };
  }
}

function ackFresh(fact: ModelCapabilityAckFact, nowMs: number, ttlMs: number): boolean {
  if (fact.state !== "acknowledged" || !fact.observedAt) return false;
  const observedAtMs = Date.parse(fact.observedAt);
  return Number.isFinite(observedAtMs) && nowMs >= observedAtMs && nowMs - observedAtMs <= ttlMs;
}

function hasTrustedRuntimeGeneration(value: string | null | undefined): value is string {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "unknown";
}

function resolveRuntimeGeneration(input: RuntimeEffectiveCapabilityInput): string {
  const explicit = input.runtimeGeneration?.trim();
  if (explicit) return explicit;
  return (input.env ?? process.env)[RUNTIME_FLAG_ACK_GENERATION_ENV]?.trim() || "unknown";
}

/** Returns the current process generation, or null when it is not trustworthy. */
export function resolveCurrentRuntimeGeneration(env: NodeJS.ProcessEnv = process.env): string | null {
  const generation = env[RUNTIME_FLAG_ACK_GENERATION_ENV]?.trim();
  return hasTrustedRuntimeGeneration(generation) ? generation : null;
}

function capabilityRelevantToolNames(names: readonly string[]): string[] {
  const relevant = names.filter((name) =>
    ["context_", "memory_", "browser", "search", "spawn", "loop", "mission", "clawgraph", "task", "write", "edit", "patch", "exec", "shell", "mcp", "skill", "image", "video", "tts", "pdf"]
      .some((prefix) => name.includes(prefix)),
  );
  return uniqueSorted(relevant.length > 0 ? relevant : names);
}

function collectMemory(
  input: RuntimeEffectiveCapabilityInput,
  runtimeVerified: boolean,
): ModelCapabilityMemoryFact {
  if (input.memory) return input.memory;
  const writeGate = input.cfg.runtime?.memory?.persist === true;
  const candidateGate =
    input.cfg.runtime?.memory?.candidateGeneration === true ||
    input.cfg.runtime?.memory?.proposeFacts === true;
  return {
    scope: "workspace",
    read: "unknown",
    write: runtimeVerified && writeGate ? "unknown" : "denied",
    candidate: runtimeVerified && candidateGate ? "unknown" : "unavailable",
  };
}

function quarantineFacts(input: RuntimeEffectiveCapabilityInput): RuntimeCapabilityQuarantineInput[] {
  const notices = buildRuntimeCompatibleToolInventory({
    tools: input.tools,
    cfg: input.cfg,
    workspaceDir: input.workspaceDir,
    modelProvider: "",
    modelId: "",
  }).notices ?? [];
  const fromNotices = notices
    .filter((notice) => notice.severity === "warning" && notice.id.startsWith("unsupported-tool-schema:"))
    .map((notice) => ({
      capabilityId: "component.coding-execution-backend",
      state: "quarantined" as const,
      reason: notice.message,
      since: null,
    }));
  return [...(input.quarantine ?? []), ...fromNotices];
}

function grantFor(
  grants: readonly RuntimeCapabilityGrantInput[],
  capabilityId: string,
  actionId: string,
  nowMs: number,
): ModelCapabilityGrantFact | null {
  const grant = grants.find(
    (entry) => entry.capabilityId === capabilityId && entry.actionIds.includes(actionId),
  );
  if (!grant) return null;
  const expired = grant.expiresAt !== null && Date.parse(grant.expiresAt) <= nowMs;
  return {
    grantId: grant.grantId,
    state: expired ? "expired" : grant.state,
    expiresAt: grant.expiresAt,
  };
}

function actionFacts(input: {
  capabilityId: string;
  names: readonly string[];
  grants: readonly RuntimeCapabilityGrantInput[];
  mode: ReturnType<typeof permissionMode>;
  nowMs: number;
}): ModelCapabilityActionFact[] {
  const actionIds =
    input.capabilityId === "component.coding-execution-backend"
      ? ["apply_patch", "edit", "exec", "write"]
      : input.capabilityId === "component.browser-session-owner"
        ? ["click", "navigate", "screenshot", "type"]
        : input.capabilityId === "component.role-memory"
          ? ["propose", "read"]
          : [];
  return actionIds.map((actionId) => {
    const grant = grantFor(input.grants, input.capabilityId, actionId, input.nowMs);
    const explicitlyDenied = input.mode === "readOnly" || input.mode === "plan";
    return {
      actionId,
      authorization: grant
        ? grant.state === "active"
          ? "allowed"
          : "denied"
        : explicitlyDenied
          ? "denied"
          : input.names.length > 0
            ? "allowed"
            : "unknown",
      grant,
    } satisfies ModelCapabilityActionFact;
  });
}

function driverFor(
  input: RuntimeEffectiveCapabilityInput,
  capabilityId: string,
  available: boolean,
  acknowledged: boolean,
): ModelCapabilityDriverFact {
  if (input.driver) return input.driver;
  if (!acknowledged) {
    return { id: "unknown", kind: "unknown", state: "unknown", version: null };
  }
  if (!available) return { id: "none", kind: "none", state: "disabled", version: null };
  if (capabilityId === "component.browser-session-owner") {
    return { id: "agent-browser-window", kind: "browser", state: "ready", version: null };
  }
  return { id: "openclaw-runtime", kind: "runtime", state: "ready", version: null };
}

function runtimeState(input: {
  available: boolean;
  acknowledged: boolean;
  killSwitch: boolean;
  quarantine: ModelCapabilityQuarantineFact;
  reported?: RuntimeCapabilityStateInput;
  observedAt: string;
}): ModelCapabilityEffectiveFactInput["runtimeAvailability"] {
  if (input.quarantine.state === "quarantined") {
    return { state: "quarantined", source: "tool-schema-quarantine", reason: input.quarantine.reason, observedAt: input.observedAt };
  }
  if (input.killSwitch) {
    return { state: "disabled", source: "context-enhancement-kill-switch", reason: "global kill switch engaged", observedAt: input.observedAt };
  }
  if (!input.acknowledged) {
    return { state: "unknown", source: "runtime.flags.ack", reason: "runtime acknowledgement missing or stale", observedAt: input.observedAt };
  }
  if (input.reported) {
    return {
      state: input.reported.state,
      source: input.reported.source,
      reason: input.reported.reason,
      observedAt: input.observedAt,
    };
  }
  if (input.available) {
    return { state: "enabled", source: "runtime.tool-inventory", reason: null, observedAt: input.observedAt };
  }
  return { state: "disabled", source: "runtime.tool-inventory", reason: "tool-not-present", observedAt: input.observedAt };
}

export async function buildRuntimeEffectiveCapabilityProfile(
  input: RuntimeEffectiveCapabilityInput,
): Promise<RuntimeEffectiveCapabilityResult> {
  const scope: ModelCapabilityScope = {
    workspaceId: input.workspaceId.trim(),
    roleId: null,
    sessionKey: input.sessionKey.trim(),
  };
  if (!scope.workspaceId || !scope.sessionKey) {
    throw new Error("effective capability refresh requires workspaceId and sessionKey");
  }

  const generation = input.generationGuard?.next();
  let nowMs = input.nowMs?.() ?? Date.now();
  let observedAt = iso(nowMs);
  const runtimeGeneration = resolveRuntimeGeneration(input);

  let result: RuntimeEffectiveCapabilityResult;
  try {
    const inventory = buildRuntimeCompatibleToolInventory({
      tools: input.tools,
      cfg: input.cfg,
      workspaceDir: input.workspaceDir,
    });
    const names = capabilityRelevantToolNames(inventory.entries.map((entry) => entry.id));
    const { payload, fact: ack } = collectAck(input);
    const ackObservedAtMs = ack.observedAt ? Date.parse(ack.observedAt) : Number.NaN;
    if (
      input.runtimeAck === undefined &&
      Number.isFinite(ackObservedAtMs) &&
      ackObservedAtMs > nowMs
    ) {
      // A process-owned ack is built after the initial clock read. Advance the
      // observation to that ack so a same-process acknowledgement is not stale.
      nowMs = ackObservedAtMs;
      observedAt = iso(nowMs);
    }
    const acknowledged = ackFresh(ack, nowMs, input.ttlMs ?? DEFAULT_RUNTIME_FACT_TTL_MS);
    const generationMatches =
      hasTrustedRuntimeGeneration(payload?.gatewayGeneration) &&
      payload.gatewayGeneration.trim() === runtimeGeneration;
    const killSwitch =
      input.cfg.runtime?.contextEnhancement?.killSwitch === true ||
      (input.env ?? process.env)[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] === "1";
    const quarantines = quarantineFacts(input);
    const memory = collectMemory(input, acknowledged && generationMatches);
    const knowledge = input.knowledge ?? { appliedState: "unknown", version: null, digest: null };
    const mode = permissionMode(input);
    const staticManifest = createModelCapabilityStaticManifest();

    const facts = staticManifest.entries.map((entry) => {
      const callableName = toolCallableName(entry.capabilityId, names);
      const available = callableName !== null;
      const quarantine = quarantines.find((candidate) => candidate.capabilityId === entry.capabilityId) ?? {
        state: "clear" as const,
        reason: null,
        since: null,
      };
      return {
        capabilityId: entry.capabilityId,
        tool: {
          identity: entry.toolIdentity,
          callableName,
        },
        driver: driverFor(input, entry.capabilityId, available, acknowledged && generationMatches),
        runtimeAvailability: runtimeState({
          available,
          acknowledged: acknowledged && generationMatches,
          killSwitch,
          quarantine,
          reported: input.runtimeStates?.find(
            (candidate) => candidate.capabilityId === entry.capabilityId,
          ),
          observedAt,
        }),
        actionAuthorization: actionFacts({
          capabilityId: entry.capabilityId,
          names,
          grants: input.grants ?? [],
          mode,
          nowMs,
        }),
        memory,
        knowledge,
        ack,
        quarantine,
      } satisfies ModelCapabilityEffectiveFactInput;
    });
    const effectiveFacts: ModelCapabilityEffectiveFactsInput = {
      scope,
      runtimeGeneration,
      observedAt,
      facts,
    };
    const profile = buildModelCapabilityProfile({ ...effectiveFacts, generatedAt: observedAt });
    result = {
      profile,
      source: "runtime",
      ack,
      effectiveToolNames: names,
      effectiveDigest: profile.effectiveDigest,
    };
  } catch {
    const profile = buildModelCapabilityProfile({
      generatedAt: observedAt,
      scope,
      runtimeGeneration,
      observedAt,
      facts: [],
    });
    result = {
      profile,
      source: "fallback",
      ack: { state: "unknown", generation: null, source: null, rejectedFields: [], observedAt: null },
      effectiveToolNames: [],
      effectiveDigest: profile.effectiveDigest,
    };
  }

  // Yield once so a concurrent refresh can advance the generation. A stale
  // completion never reaches the model-call boundary.
  await Promise.resolve();
  if (
    input.generationGuard &&
    generation !== undefined &&
    !input.generationGuard.isCurrent(input.generationGuard.runId, generation)
  ) {
    throw new Error("stale runtime capability generation");
  }
  recordRuntimeCapabilityObservation(input, result, nowMs);
  return result;
}