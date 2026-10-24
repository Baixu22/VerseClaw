/**
 * FP-P0-04 runtime side: the child builds its own acknowledgement.
 *
 * Every field must be derived from this process, not from the host's request, so
 * the host cannot "prove applied" from its own intent.
 */
import { describe, expect, it } from "vitest";
import {
  buildRuntimeFlagAck,
  isCompleteRuntimeFlagAck,
  missingRuntimeFlagAckFields,
  normalizeRequestedFlagId,
  resolveEffectiveRuntimeFlags,
  RUNTIME_FLAG_ACK_GENERATION_ENV,
  RUNTIME_FLAG_ACK_REQUIRED_FIELDS,
} from "./runtime-flag-ack.js";
import { CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV } from "./enhancement-kill-switch.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  [RUNTIME_FLAG_ACK_GENERATION_ENV]: "12",
  OPENCLAW_CONFIG_PATH: "C:/nonexistent/openclaw.json",
};

describe("FP-P0-04 runtime flag ack", () => {
  it("builds a complete seven-field payload", () => {
    const ack = buildRuntimeFlagAck({ env: BASE_ENV });
    expect(missingRuntimeFlagAckFields(ack)).toEqual([]);
    expect(isCompleteRuntimeFlagAck(ack)).toBe(true);
    for (const field of RUNTIME_FLAG_ACK_REQUIRED_FIELDS) {
      expect(field in ack).toBe(true);
    }
  });

  it("reports this process's own pid and the host-stamped generation", () => {
    const ack = buildRuntimeFlagAck({ env: BASE_ENV });
    expect(ack.childPid).toBe(process.pid);
    expect(ack.gatewayGeneration).toBe("12");
  });

  it("falls back to 'unknown' generation rather than omitting the field", () => {
    const ack = buildRuntimeFlagAck({ env: { OPENCLAW_CONFIG_PATH: BASE_ENV.OPENCLAW_CONFIG_PATH } });
    expect(ack.gatewayGeneration).toBe("unknown");
    expect(missingRuntimeFlagAckFields(ack)).toEqual([]);
  });

  it("marks a missing config file as degraded but still complete", () => {
    const ack = buildRuntimeFlagAck({ env: BASE_ENV });
    expect(ack.configSource.exists).toBe(false);
    expect(ack.degradedReason).toContain("config-file-absent");
    expect(isCompleteRuntimeFlagAck(ack)).toBe(true);
  });

  it("records the config origin so env-override vs state-dir is distinguishable", () => {
    expect(buildRuntimeFlagAck({ env: BASE_ENV }).configSource.origin).toBe("env-override");
  });

  it("defaults every enhancement surface off (product default)", () => {
    const flags = resolveEffectiveRuntimeFlags(undefined, BASE_ENV);
    expect(flags["runtime.contextBlock.working_memory.enabled"]).toBe(false);
    expect(flags["runtime.contextBlock.compass.enabled"]).toBe(false);
    expect(flags["runtime.vtoken.assembly.enabled"]).toBe(false);
    expect(flags["dcs.contextViewTools.enabled"]).toBe(false);
    expect(flags["runtime.coding.sekb.retrievalShadow"]).toBe(false);
  });

  it("reports retrieval shadow provenance without treating it as turn injection", () => {
    const ack = buildRuntimeFlagAck({
      env: BASE_ENV,
      cfg: { runtime: { coding: { sekb: { retrievalShadow: true } } } } as never,
    });
    expect(ack.effectiveFlags["runtime.coding.sekb.retrievalShadow"]).toBe(true);
    expect(ack.flagAttribution["runtime.coding.sekb.retrievalShadow"]).toMatchObject({
      value: true,
      origin: "config",
      key: "runtime.coding.sekb.retrievalShadow",
    });
    expect(ack.turnEffectProbe.activeSurfaces).not.toContain(
      "runtime.coding.sekb.retrievalShadow",
    );
  });

  it("turnEffectProbe says no turn change when nothing is enabled", () => {
    const ack = buildRuntimeFlagAck({ env: BASE_ENV });
    expect(ack.turnEffectProbe.wouldChangeTurn).toBe(false);
    expect(ack.turnEffectProbe.activeSurfaces).toEqual([]);
  });

  it("turnEffectProbe reports the active surface when a flag is really on", () => {
    const ack = buildRuntimeFlagAck({
      env: BASE_ENV,
      cfg: {
        runtime: { contextBlock: { "working-memory": { enabled: true } } },
      } as never,
    });
    expect(ack.effectiveFlags["runtime.contextBlock.working_memory.enabled"]).toBe(true);
    expect(ack.turnEffectProbe.wouldChangeTurn).toBe(true);
    expect(ack.turnEffectProbe.activeSurfaces).toContain(
      "runtime.contextBlock.working_memory.enabled",
    );
  });

  it("kill switch zeroes the flags and the turn-effect probe", () => {
    const ack = buildRuntimeFlagAck({
      env: { ...BASE_ENV, [CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV]: "1" },
      cfg: {
        runtime: { contextBlock: { "working-memory": { enabled: true } } },
      } as never,
    });
    expect(ack.effectiveFlags["runtime.contextBlock.working_memory.enabled"]).toBe(false);
    expect(ack.turnEffectProbe.wouldChangeTurn).toBe(false);
    expect(ack.turnEffectProbe.killSwitchEngaged).toBe(true);
  });

  it("expresses a rejected flag when the runtime did not adopt the request", () => {
    const ack = buildRuntimeFlagAck({
      env: { ...BASE_ENV, [CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV]: "1" },
      cfg: {
        runtime: { contextBlock: { "working-memory": { enabled: true } } },
      } as never,
      requestedFlags: { "runtime.contextBlock.working_memory.enabled": true },
    });
    expect(ack.rejectedFlags?.[0]).toMatchObject({
      id: "runtime.contextBlock.working_memory.enabled",
      requested: true,
      effective: false,
      reason: "kill-switch-engaged",
    });
    expect(ack.degradedReason).toContain("partial-flag-reject");
  });

  // FP-P0-05 G3: the ack carries the live shared-budget contract and counters.
  it("reports the shared injection budget contract this child enforces", () => {
    const ack = buildRuntimeFlagAck({ env: BASE_ENV });
    expect(ack.injectionBudget.totalChars).toBeGreaterThan(0);
    expect(ack.injectionBudget.dropAlertRatio).toBeGreaterThan(0);
    // Precedence must be the declared total order, knowledge first, memory pilot last.
    expect(ack.injectionBudget.precedence[0]).toBe("knowledge");
    expect(ack.injectionBudget.precedence).toContain("cvk_addition");
    expect(ack.injectionBudget.precedence).toContain("vtoken");
    expect(ack.injectionBudget.precedence).toContain("memory_pilot");
    // Counters are summable numbers, present even before any turn ran.
    for (const value of Object.values(ack.injectionBudget.counters)) {
      expect(typeof value).toBe("number");
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("maps the host's kebab config path onto the assembler's snake flag key", () => {
    expect(normalizeRequestedFlagId("runtime.contextBlock.working-memory.enabled")).toBe(
      "runtime.contextBlock.working_memory.enabled",
    );
    expect(normalizeRequestedFlagId("runtime.contextBlock.tool-registry.enabled")).toBe(
      "runtime.contextBlock.tool_registry.enabled",
    );
    expect(normalizeRequestedFlagId("OPENCLAW_DCS_CONTEXT_VIEW_TOOLS")).toBe(
      "dcs.contextViewTools.enabled",
    );
    // Coding flags already agree on both sides and must pass through untouched.
    expect(normalizeRequestedFlagId("runtime.coding.staleWriteGuard.enabled")).toBe(
      "runtime.coding.staleWriteGuard.enabled",
    );
  });

  it("does NOT reject a kebab-addressed flag that the runtime really adopted", () => {
    // Regression: before normalizeRequestedFlagId this reported flag-rejected, so the
    // ack state machine failed on a healthy, correctly applied flag.
    const ack = buildRuntimeFlagAck({
      env: BASE_ENV,
      cfg: {
        runtime: { contextBlock: { "working-memory": { enabled: true } } },
      } as never,
      requestedFlags: { "runtime.contextBlock.working-memory.enabled": true },
    });
    expect(ack.rejectedFlags).toBeUndefined();
    expect(ack.degradedReason ?? "").not.toContain("partial-flag-reject");
  });

  it("reports the host's original id when rejecting, not the normalized one", () => {
    const ack = buildRuntimeFlagAck({
      env: { ...BASE_ENV, [CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV]: "1" },
      cfg: {
        runtime: { contextBlock: { "working-memory": { enabled: true } } },
      } as never,
      requestedFlags: { "runtime.contextBlock.working-memory.enabled": true },
    });
    expect(ack.rejectedFlags?.[0]?.id).toBe("runtime.contextBlock.working-memory.enabled");
    expect(ack.rejectedFlags?.[0]?.reason).toBe("kill-switch-engaged");
  });

  it("flags a request for an unknown key rather than silently accepting it", () => {
    const ack = buildRuntimeFlagAck({
      env: BASE_ENV,
      requestedFlags: { "runtime.notARealFlag": true },
    });
    expect(ack.rejectedFlags?.[0]).toMatchObject({
      id: "runtime.notARealFlag",
      reason: "unknown-to-runtime",
    });
  });

  it("hash changes when the effective flags change", () => {
    const off = buildRuntimeFlagAck({ env: BASE_ENV }).runtimeBuildOrConfigHash;
    const on = buildRuntimeFlagAck({
      env: BASE_ENV,
      cfg: {
        runtime: { contextBlock: { "working-memory": { enabled: true } } },
      } as never,
    }).runtimeBuildOrConfigHash;
    expect(off).not.toBe(on);
  });

  it("hash is stable for identical inputs", () => {
    expect(buildRuntimeFlagAck({ env: BASE_ENV }).runtimeBuildOrConfigHash).toBe(
      buildRuntimeFlagAck({ env: BASE_ENV }).runtimeBuildOrConfigHash,
    );
  });
});
