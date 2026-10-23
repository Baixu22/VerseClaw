// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../openclaw_runtime/src/config/types.openclaw.js";
import type { SessionEntry } from "../../openclaw_runtime/src/config/sessions/types.js";
import type { RuntimeEffectiveCapabilityObservationRead } from "../../openclaw_runtime/src/agents/runtime-effective-capability.js";
import {
  buildBackendCompatibilityRows,
  buildSessionEffectivePolicy,
} from "../../openclaw_runtime/src/gateway/session-effective-policy.js";

const NOW = Date.parse("2026-10-23T08:00:00.000Z");
const SECRET_PROMPT = "PRIVATE-PROMPT-MUST-NOT-LEAK";

function cfg(): OpenClawConfig {
  return {
    agents: {
      defaults: {
        contextTokens: 200_000,
        thinkingDefault: "medium",
        maxConcurrent: 2,
        subagents: {
          maxConcurrent: 3,
          maxSpawnDepth: 2,
          maxChildrenPerAgent: 5,
        },
      },
      list: [{ id: "main" }],
    },
    cron: {
      enabled: true,
      maxConcurrentRuns: 4,
      sessionRetention: "24h",
    },
  } as OpenClawConfig;
}

function entry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: "session-42",
    updatedAt: NOW,
    modelProvider: "openai",
    model: "gpt-5.4",
    modelOverride: "openai/gpt-5.4",
    providerOverride: "openai",
    agentRuntimeOverride: "codex",
    thinkingLevel: "high",
    contextTokens: 160_000,
    queueMode: "followup",
    queueCap: 8,
    queueDrop: "summarize",
    queueDebounceMs: 250,
    contextBudgetStatus: {
      schemaVersion: 1,
      source: "pre-prompt-estimate",
      updatedAt: NOW,
      provider: "openai",
      model: "gpt-5.4",
      route: "fits",
      shouldCompact: false,
      estimatedPromptTokens: 120_000,
      contextTokenBudget: 160_000,
      promptBudgetBeforeReserve: 150_000,
      reserveTokens: 10_000,
      effectiveReserveTokens: 10_000,
      remainingPromptBudgetTokens: 30_000,
      overflowTokens: 0,
      toolResultReducibleChars: 0,
      messageCount: 20,
      unwindowedMessageCount: 0,
      sessionId: "session-42",
    },
    ...overrides,
  };
}

function observation(
  state: RuntimeEffectiveCapabilityObservationRead["state"] = "available",
): RuntimeEffectiveCapabilityObservationRead {
  return {
    state,
    reason: state === "available" ? null : `${state}-observation`,
    observation: {
      workspaceId: "workspace:fixture",
      sessionKey: "agent:main:main",
      sessionId: "session-42",
      runId: "run-42",
      backendId: "codex",
      provider: "openai",
      model: "gpt-5.4",
      effort: "high",
      observedAtMs: NOW,
      result: {
        source: "runtime",
        effectiveToolNames: ["exec"],
        effectiveDigest: "sha256:effective",
        ack: {
          state: "acknowledged",
          generation: "gateway-42",
          source: "runtime.flags.ack",
          rejectedFields: [],
          observedAt: new Date(NOW).toISOString(),
        },
        profile: {
          runtimeGeneration: "gateway-42",
          promptAddition: { text: SECRET_PROMPT },
          entries: [{
            actionAuthorization: [
              { actionId: "exec", authorization: "allowed", grant: { grantId: "private-grant", state: "active", expiresAt: null } },
              { actionId: "write", authorization: "requires-approval", grant: null },
              { actionId: "browser", authorization: "denied", grant: { grantId: "denied-grant", state: "revoked", expiresAt: null } },
            ],
          }],
        },
      },
    } as never,
  };
}

function build(overrides: Partial<Parameters<typeof buildSessionEffectivePolicy>[0]> = {}) {
  return buildSessionEffectivePolicy({
    cfg: cfg(),
    workspaceId: "workspace:fixture",
    sessionKey: "agent:main:main",
    agentId: "main",
    entry: entry(),
    activeRun: { runId: "run-42", sessionId: "session-42" },
    capabilityObservation: observation(),
    queuedCount: 2,
    nowMs: NOW,
    ...overrides,
  });
}

describe("session effective policy", () => {
  it("separates configured and effective facts and derives only secret-free limits", () => {
    const policy = build();

    expect(policy.schemaVersion).toBe("SessionEffectivePolicy/v1");
    expect(policy.scope).toMatchObject({
      workspaceId: "workspace:fixture",
      sessionKey: "agent:main:main",
      agentId: "main",
      sessionId: "session-42",
      runId: "run-42",
    });
    expect(policy.generation).toMatchObject({
      state: "effective",
      runtimeGeneration: "gateway-42",
    });
    expect(policy.backend.configured.value).toMatchObject({
      runtime: "codex",
      kind: "native",
      ownsNativeCompaction: true,
      provider: "openai",
      model: "gpt-5.4",
    });
    expect(policy.backend.effective).toMatchObject({
      status: "effective",
      value: { runtime: "codex", provider: "openai", model: "gpt-5.4" },
    });
    expect(policy.model.effective.value).toEqual({
      provider: "openai",
      model: "gpt-5.4",
      effort: "high",
    });
    expect(policy.model.configured.reason).toBe("session.entry.thinkingLevel");
    expect(policy.grants.effective.value).toMatchObject({
      total: 3,
      allowed: 1,
      requiresApproval: 1,
      denied: 1,
      unknown: 0,
    });
    expect(policy.context.effective.value).toMatchObject({
      contextTokens: 160_000,
      contextPressure: "medium",
    });
    expect(policy.queue.effective.value).toMatchObject({
      mode: "followup",
      cap: 8,
      drop: "summarize",
      debounceMs: 250,
      queuedCount: 2,
    });
    expect(policy.resources.configured.value).toEqual({
      maxConcurrentRuns: 2,
      maxConcurrentSubagents: 3,
      maxSpawnDepth: 2,
      maxChildrenPerAgent: 5,
    });
    expect(policy.schedule.configured.value).toEqual({
      cronEnabled: true,
      cronMaxConcurrentRuns: 4,
      sessionRetention: "24h",
    });

    const serialized = JSON.stringify(policy);
    expect(serialized).not.toContain(SECRET_PROMPT);
    expect(serialized).not.toContain("private-grant");
    expect(serialized).not.toContain("denied-grant");
  });

  it("keeps current-run facts unverified when the observation is missing or mismatched", () => {
    for (const state of ["missing", "stale", "mismatch", "unverified"] as const) {
      const policy = build({ capabilityObservation: observation(state) });
      expect(policy.generation.state).toBe(state === "missing" ? "missing" : state);
      expect(policy.backend.effective.status).toBe("unverified");
      expect(policy.model.effective.status).toBe("unverified");
      expect(policy.grants.effective.status).toBe("unverified");
      expect(policy.backend.configured.value?.runtime).toBe("codex");
    }
  });

  it("does not promote configured runtime or model settings without a current observation", () => {
    const policy = build({
      capabilityObservation: { state: "missing", reason: "no-profile", observation: null },
    });

    expect(policy.backend.configured).toMatchObject({
      status: "configured",
      value: { runtime: "codex", provider: "openai", model: "gpt-5.4" },
    });
    expect(policy.backend.effective.value).toBeNull();
    expect(policy.model.effective.value).toBeNull();
    expect(policy.context.configured.value).toEqual({
      contextTokens: 160_000,
      contextPressure: null,
    });
    expect(policy.context.effective.status).toBe("effective");
  });

  it("rejects stale observations for a different session generation", () => {
    const policy = build({
      capabilityObservation: observation("mismatch"),
    });
    expect(policy.generation).toMatchObject({
      state: "mismatch",
      reason: "mismatch-observation",
    });
    expect(policy.backend.effective.status).toBe("unverified");
    expect(policy.model.effective.status).toBe("unverified");
    expect(policy.grants.effective.status).toBe("unverified");
  });

  it("does not fill missing observed backend identity from configured values", () => {
    const incomplete = observation();
    if (!incomplete.observation) throw new Error("observation fixture missing");
    incomplete.observation.provider = null;
    incomplete.observation.model = null;
    const policy = build({ capabilityObservation: incomplete });

    expect(policy.backend.configured.value).toMatchObject({
      runtime: "codex",
      provider: "openai",
      model: "gpt-5.4",
    });
    expect(policy.backend.effective).toMatchObject({
      value: null,
      status: "unverified",
    });
    expect(policy.model.effective).toMatchObject({
      value: null,
      status: "unverified",
    });
  });

  it("does not carry a provider-incompatible harness id across model routes", () => {
    const policy = build({
      entry: entry({
        providerOverride: undefined,
        modelOverride: undefined,
        modelProvider: "anthropic",
        model: "claude-sonnet-4-6",
        agentRuntimeOverride: undefined,
        agentHarnessId: "codex",
      }),
    });

    expect(policy.backend.configured.value).toMatchObject({
      runtime: "openclaw",
      kind: "openclaw",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
    expect(policy.backend.configured.value?.runtime).not.toBe("codex");
  });

  it("uses an explicit backend compatibility table for native and OpenClaw compaction", () => {
    const codex = buildBackendCompatibilityRows({
      runtime: "codex",
      kind: "native",
      ownsNativeCompaction: true,
    });
    const claude = buildBackendCompatibilityRows({
      runtime: "claude-cli",
      kind: "cli",
      ownsNativeCompaction: true,
    });
    const openclaw = buildBackendCompatibilityRows({
      runtime: "openclaw",
      kind: "openclaw",
      ownsNativeCompaction: false,
    });

    for (const rows of [codex, claude]) {
      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ parameter: "automatic-compaction", status: "ignored" }),
        expect.objectContaining({ parameter: "compaction.model", status: "ignored" }),
        expect.objectContaining({ parameter: "manual-compaction", status: "effective" }),
        expect.objectContaining({ parameter: "compaction.reserveTokens", status: "unsupported" }),
      ]));
    }
    expect(openclaw).toEqual(expect.arrayContaining([
      expect.objectContaining({ parameter: "automatic-compaction", status: "configured" }),
      expect.objectContaining({ parameter: "compaction.reserveTokens", status: "configured" }),
    ]));
  });
});
