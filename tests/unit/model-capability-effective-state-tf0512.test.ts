// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LegacyContextEngine } from "../../openclaw_runtime/src/context-engine/legacy.js";
import type { OpenClawConfig } from "../../openclaw_runtime/src/config/types.openclaw.js";
import {
  buildRuntimeFlagAck,
  type RuntimeFlagAckPayload,
} from "../../openclaw_runtime/src/context-engine/runtime-flag-ack.js";
import {
  buildRuntimeEffectiveCapabilityProfile,
  composeRuntimeEffectiveCapabilitySystemPrompt,
  createRuntimeCapabilityStateGenerationGuard,
  isRuntimeCapabilityToolOutcomeConsistent,
  type RuntimeEffectiveCapabilityInput,
} from "../../openclaw_runtime/src/runtime-core/model-capability-effective-state.js";
import type { AnyAgentTool } from "../../openclaw_runtime/src/agents/tools/common.js";

const NOW = Date.parse("2026-10-22T04:00:00.000Z");
const CAPABILITY_ID = "component.coding-execution-backend";

function tool(name: string): AnyAgentTool {
  return {
    name,
    label: name,
    description: `${name} fixture`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
  } as unknown as AnyAgentTool;
}

function ack(generation: string, observedAt = new Date(NOW).toISOString()): RuntimeFlagAckPayload {
  return {
    ...buildRuntimeFlagAck({ env: { VERSE_CLAW_GATEWAY_GENERATION: generation } }),
    gatewayGeneration: generation,
    degradedReason: null,
    answeredAt: observedAt,
  };
}

function input(overrides: Partial<RuntimeEffectiveCapabilityInput> = {}): RuntimeEffectiveCapabilityInput {
  return {
    workspaceId: "workspace:fixture",
    workspaceDir: "D:/tmp/runtime-effective-capability-fixture",
    sessionKey: "agent:main:fixture",
    runtimeGeneration: "gateway-17",
    tools: [tool("exec")],
    cfg: { tools: { exec: { mode: "full" } } } as OpenClawConfig,
    env: { VERSE_CLAW_GATEWAY_GENERATION: "gateway-17" },
    runtimeAck: ack("gateway-17"),
    memory: {
      scope: "workspace",
      read: "allowed",
      write: "denied",
      candidate: "available",
    },
    knowledge: {
      appliedState: "stale",
      version: "knowledge-3",
      digest: "sha256:knowledge-fixture",
    },
    nowMs: () => NOW,
    ...overrides,
  };
}

function codingEntry(result: Awaited<ReturnType<typeof buildRuntimeEffectiveCapabilityProfile>>) {
  const entry = result.profile.entries.find((candidate) => candidate.capabilityId === CAPABILITY_ID);
  if (!entry) throw new Error(`missing ${CAPABILITY_ID}`);
  return entry;
}

describe("runtime effective capability adapter", () => {
  it("reports the actual tool, ready driver, effective ack, grants, memory and knowledge", async () => {
    const result = await buildRuntimeEffectiveCapabilityProfile(
      input({
        grants: [{
          capabilityId: CAPABILITY_ID,
          actionIds: ["exec"],
          grantId: "grant-coding",
          state: "active",
          expiresAt: "2026-10-22T05:00:00.000Z",
        }],
      }),
    );
    const entry = codingEntry(result);

    expect(result.source).toBe("runtime");
    expect(result.effectiveToolNames).toContain("exec");
    expect(result.ack).toMatchObject({
      state: "acknowledged",
      generation: "gateway-17",
      source: "runtime.flags.ack",
    });
    expect(entry.tool.callableName).toBe("exec");
    expect(entry.driver).toMatchObject({ id: "openclaw-runtime", kind: "runtime", state: "ready" });
    expect(entry.runtimeAvailability.state).toBe("enabled");
    expect(entry.actionAuthorization.find((action) => action.actionId === "exec")).toMatchObject({
      authorization: "allowed",
      grant: { grantId: "grant-coding", state: "active" },
    });
    expect(entry.memory).toMatchObject({ read: "allowed", write: "denied", candidate: "available" });
    expect(entry.knowledge).toEqual({
      appliedState: "stale",
      version: "knowledge-3",
      digest: "sha256:knowledge-fixture",
    });
  });

  it("keeps runtime availability and drivers unknown when acknowledgement is absent", async () => {
    const result = await buildRuntimeEffectiveCapabilityProfile(input({ runtimeAck: null }));
    const entry = codingEntry(result);

    expect(result.ack.state).toBe("unknown");
    expect(entry.runtimeAvailability.state).toBe("unknown");
    expect(entry.driver).toEqual({ id: "unknown", kind: "unknown", state: "unknown", version: null });
    expect(result.profile.promptAddition.text).toContain(
      "Runtime state is not yet verified for all listed capabilities",
    );
  });

  it("does not trust an unknown gateway generation from a local ack", async () => {
    const result = await buildRuntimeEffectiveCapabilityProfile(
      input({ runtimeAck: ack("unknown"), runtimeGeneration: "unknown" }),
    );
    const entry = codingEntry(result);

    expect(result.ack).toMatchObject({ state: "unknown", generation: null });
    expect(entry.runtimeAvailability.state).toBe("unknown");
    expect(entry.driver.state).toBe("unknown");
  });

  it("accepts a process-owned ack even when it is observed after the initial clock read", async () => {
    const result = await buildRuntimeEffectiveCapabilityProfile(
      input({
        runtimeAck: undefined,
        runtimeGeneration: "gateway-clock",
        env: {
          OPENCLAW_CONFIG_PATH: `${process.cwd()}/package.json`,
          VERSE_CLAW_GATEWAY_GENERATION: "gateway-clock",
        },
        nowMs: () => Date.now() - 1_000,
      }),
    );

    expect(result.ack.state).toBe("acknowledged");
    expect(result.ack.generation).toBe("gateway-clock");
    expect(codingEntry(result).runtimeAvailability.state).toBe("enabled");
  });

  it("expires grants and denies revoked grants at refresh time", async () => {
    const expired = await buildRuntimeEffectiveCapabilityProfile(
      input({
        grants: [{
          capabilityId: CAPABILITY_ID,
          actionIds: ["exec"],
          grantId: "grant-expired",
          state: "active",
          expiresAt: new Date(NOW - 1).toISOString(),
        }],
      }),
    );
    const revoked = await buildRuntimeEffectiveCapabilityProfile(
      input({
        grants: [{
          capabilityId: CAPABILITY_ID,
          actionIds: ["exec"],
          grantId: "grant-revoked",
          state: "revoked",
          expiresAt: null,
        }],
      }),
    );

    const expiredExec = codingEntry(expired).actionAuthorization.find(
      (action) => action.actionId === "exec",
    );
    const revokedExec = codingEntry(revoked).actionAuthorization.find(
      (action) => action.actionId === "exec",
    );
    expect(expiredExec).toMatchObject({
      authorization: "denied",
      grant: { state: "expired" },
    });
    expect(revokedExec).toMatchObject({
      authorization: "denied",
      grant: { state: "revoked" },
    });
  });

  it("fails closed when the coding backend is quarantined", async () => {
    const result = await buildRuntimeEffectiveCapabilityProfile(
      input({
        quarantine: [{
          capabilityId: CAPABILITY_ID,
          state: "quarantined",
          reason: "schema rejected",
          since: "2026-10-22T03:59:00.000Z",
        }],
      }),
    );
    const entry = codingEntry(result);

    expect(entry.runtimeAvailability).toMatchObject({
      state: "quarantined",
      reason: "schema rejected",
    });
    expect(entry.quarantine).toMatchObject({ state: "quarantined", reason: "schema rejected" });
  });

  it("reports loading, unavailable and degraded runtime states without promoting them", async () => {
    const disabled = await buildRuntimeEffectiveCapabilityProfile(
      input({
        driver: { id: "runtime-loading", kind: "runtime", state: "loading", version: null },
        runtimeStates: [{
          capabilityId: CAPABILITY_ID,
          state: "disabled",
          source: "capabilities-api",
          reason: "warmup-not-ready",
        }],
      }),
    );
    const degraded = await buildRuntimeEffectiveCapabilityProfile(
      input({
        driver: { id: "runtime-down", kind: "runtime", state: "unavailable", version: null },
        runtimeStates: [{
          capabilityId: CAPABILITY_ID,
          state: "degraded",
          source: "capabilities-api",
          reason: "partial-provider",
        }],
      }),
    );

    expect(codingEntry(disabled).runtimeAvailability).toMatchObject({
      state: "disabled",
      source: "capabilities-api",
      reason: "warmup-not-ready",
    });
    expect(codingEntry(disabled).driver.state).toBe("loading");
    expect(codingEntry(degraded).runtimeAvailability).toMatchObject({
      state: "degraded",
      source: "capabilities-api",
      reason: "partial-provider",
    });
    expect(codingEntry(degraded).driver.state).toBe("unavailable");
  });

  it("fails closed when the ack generation does not match the runtime generation", async () => {
    const result = await buildRuntimeEffectiveCapabilityProfile(
      input({ runtimeGeneration: "gateway-18" }),
    );

    expect(result.ack.generation).toBe("gateway-17");
    expect(codingEntry(result).runtimeAvailability).toMatchObject({
      state: "unknown",
      source: "runtime.flags.ack",
    });
    expect(codingEntry(result).driver.state).toBe("unknown");
  });

  it("refreshes a config switch into runtime state while keeping the static digest stable", async () => {
    const enabled = await buildRuntimeEffectiveCapabilityProfile(input());
    const disabled = await buildRuntimeEffectiveCapabilityProfile(
      input({
        cfg: {
          tools: { exec: { mode: "full" } },
          runtime: { contextEnhancement: { killSwitch: true } },
        } as OpenClawConfig,
      }),
    );

    expect(codingEntry(enabled).runtimeAvailability.state).toBe("enabled");
    expect(codingEntry(disabled).runtimeAvailability).toMatchObject({
      state: "disabled",
      source: "context-enhancement-kill-switch",
    });
    expect(disabled.profile.staticDigest).toBe(enabled.profile.staticDigest);
    expect(disabled.effectiveDigest).not.toBe(enabled.effectiveDigest);
  });

  it("does not treat tool presence as approval and reconciles an actual denial", async () => {
    const result = await buildRuntimeEffectiveCapabilityProfile(input());
    const exec = codingEntry(result).actionAuthorization.find((action) => action.actionId === "exec");

    expect(exec?.authorization).toBe("requires-approval");
    expect(isRuntimeCapabilityToolOutcomeConsistent(result.profile, {
      capabilityId: CAPABILITY_ID,
      actionId: "exec",
      outcome: "denied",
    })).toBe(true);
    expect(isRuntimeCapabilityToolOutcomeConsistent(result.profile, {
      capabilityId: CAPABILITY_ID,
      actionId: "exec",
      outcome: "succeeded",
    })).toBe(false);
  });
  it("keeps the effective digest stable for observation-only changes", async () => {
    const first = await buildRuntimeEffectiveCapabilityProfile(input());
    const second = await buildRuntimeEffectiveCapabilityProfile(
      input({
        runtimeAck: ack("gateway-17", "2026-10-22T04:00:10.000Z"),
        nowMs: () => NOW + 10_000,
      }),
    );

    expect(second.profile.observedAt).not.toBe(first.profile.observedAt);
    expect(second.effectiveDigest).toBe(first.effectiveDigest);
  });

  it("changes the effective digest when tool, ack or driver facts change", async () => {
    const baseline = await buildRuntimeEffectiveCapabilityProfile(input());
    const noTool = await buildRuntimeEffectiveCapabilityProfile(input({ tools: [] }));
    const noAck = await buildRuntimeEffectiveCapabilityProfile(input({ runtimeAck: null }));
    const changedDriver = await buildRuntimeEffectiveCapabilityProfile(
      input({ driver: { id: "runtime-b", kind: "runtime", state: "ready", version: "2" } }),
    );

    expect(noTool.effectiveDigest).not.toBe(baseline.effectiveDigest);
    expect(noAck.effectiveDigest).not.toBe(baseline.effectiveDigest);
    expect(changedDriver.effectiveDigest).not.toBe(baseline.effectiveDigest);
  });

  it("rejects an older refresh after a newer run generation starts", async () => {
    const guard = createRuntimeCapabilityStateGenerationGuard("run-race");
    const pending = buildRuntimeEffectiveCapabilityProfile(input({ generationGuard: guard }));
    const newerGeneration = guard.next();

    await expect(pending).rejects.toThrow("stale runtime capability generation");
    expect(guard.isCurrent("run-race", newerGeneration)).toBe(true);
    expect(guard.isCurrent("run-race", newerGeneration - 1)).toBe(false);
  });

  it("keeps fallback facts unknown instead of promoting static dispositions", async () => {
    const brokenCfg = Object.defineProperty({}, "tools", {
      get() {
        throw new Error("inventory unavailable");
      },
    }) as OpenClawConfig;
    const result = await buildRuntimeEffectiveCapabilityProfile(input({ cfg: brokenCfg }));

    expect(result.source).toBe("fallback");
    expect(result.effectiveToolNames).toEqual([]);
    expect(result.profile.entries.every((entry) => entry.runtimeAvailability.state === "unknown")).toBe(true);
    expect(result.profile.entries.every((entry) => entry.driver.state === "unknown")).toBe(true);
    expect(result.profile.entries.find((entry) => entry.capabilityId === CAPABILITY_ID)?.static.disposition).toBe("default");
  });

  it("refreshes capability facts at the context-engine assemble boundary", async () => {
    const previousGeneration = process.env.VERSE_CLAW_GATEWAY_GENERATION;
    process.env.VERSE_CLAW_GATEWAY_GENERATION = "gateway-17";
    try {
      let runtimeAck: RuntimeFlagAckPayload | null = ack("gateway-17", new Date().toISOString());
      const engine = new LegacyContextEngine(
        { tools: { exec: { mode: "full" } } } as OpenClawConfig,
        "D:/tmp/model-capability-fixture",
        () => ({ runtimeAck }),
      );
      const common = {
        sessionId: "session-1",
        sessionKey: "agent:main:fixture",
        messages: [],
      };
      const verified = await engine.assemble({
        ...common,
        availableTools: new Set(["exec"]),
      });
      expect(verified.systemPromptAddition).toContain("Capability positioning");
      expect(verified.systemPromptAddition).toContain("Coding tools and file execution");

      runtimeAck = null;
      const unverified = await engine.assemble({
        ...common,
        availableTools: new Set(["exec"]),
      });
      expect(unverified.systemPromptAddition).toContain(
        "Runtime state is not yet verified for all listed capabilities",
      );
      expect(unverified.systemPromptAddition).not.toBe(verified.systemPromptAddition);
    } finally {
      if (previousGeneration === undefined) delete process.env.VERSE_CLAW_GATEWAY_GENERATION;
      else process.env.VERSE_CLAW_GATEWAY_GENERATION = previousGeneration;
    }
  });

  it("does not append capability positioning before the tool surface is known", async () => {
    const engine = new LegacyContextEngine({}, "D:/tmp/model-capability-fixture");
    const result = await engine.assemble({
      sessionId: "session-1",
      sessionKey: "agent:main:fixture",
      messages: [],
    });
    expect(result.systemPromptAddition).toBeUndefined();
  });

  it("appends only a non-empty profile addition to the provider system prompt", async () => {
    const result = await buildRuntimeEffectiveCapabilityProfile(input());
    const composed = composeRuntimeEffectiveCapabilitySystemPrompt("Base system prompt", result);

    expect(composed.startsWith("Base system prompt\n\n")).toBe(true);
    expect(composed.endsWith(result.profile.promptAddition.text.trim())).toBe(true);
  });
});
