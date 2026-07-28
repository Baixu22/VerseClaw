/**
 * FP-P1-10: per-flag provenance. The point of this file is the distinction
 * `configSource` could never make — off-because-unset vs off-because-configured
 * vs off-because-killed all used to look identical in the ack.
 */
import { describe, expect, it } from "vitest";
import {
  resolveEffectiveRuntimeFlagsWithSources,
  buildRuntimeFlagAck,
} from "./runtime-flag-ack.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

const WM = "runtime.contextBlock.working_memory.enabled";

describe("FP-P1-10 per-flag attribution", () => {
  it("reports `default` for a flag nobody set", () => {
    const { attribution } = resolveEffectiveRuntimeFlagsWithSources(undefined, {});
    expect(attribution[WM]).toEqual({ value: false, origin: "default" });
  });

  it("distinguishes explicitly-configured false from unset false", () => {
    const cfg = {
      runtime: { contextBlock: { "working-memory": { enabled: false } } },
    } as unknown as OpenClawConfig;
    const { attribution } = resolveEffectiveRuntimeFlagsWithSources(cfg, {});
    // Same VALUE as the default case above, different ORIGIN — this is the
    // whole reason the task exists.
    expect(attribution[WM]).toEqual({
      value: false,
      origin: "config",
      key: "runtime.contextBlock.working-memory.enabled",
    });
  });

  it("reports `config` when the operator turned a flag on", () => {
    const cfg = {
      runtime: { contextBlock: { "working-memory": { enabled: true } } },
    } as unknown as OpenClawConfig;
    const { flags, attribution } = resolveEffectiveRuntimeFlagsWithSources(cfg, {});
    expect(flags[WM]).toBe(true);
    expect(attribution[WM]?.origin).toBe("config");
  });

  it("reports `kill` — not a bare false — when the kill switch overrides an ON flag", () => {
    const cfg = {
      runtime: { contextBlock: { "working-memory": { enabled: true } } },
    } as unknown as OpenClawConfig;
    const { flags, attribution } = resolveEffectiveRuntimeFlagsWithSources(cfg, {
      VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH: "1",
    });
    expect(flags[WM]).toBe(false);
    expect(attribution[WM]).toEqual({
      value: false,
      origin: "kill",
      key: "runtime.contextEnhancement.killSwitch",
    });
  });

  it("reports `env` for env-controlled surfaces, and names the variable", () => {
    const { attribution } = resolveEffectiveRuntimeFlagsWithSources(undefined, {
      OPENCLAW_DCS_CONTEXT_VIEW_TOOLS: "1",
    });
    expect(attribution["dcs.contextViewTools.enabled"]).toEqual({
      value: true,
      origin: "env",
      key: "OPENCLAW_DCS_CONTEXT_VIEW_TOOLS",
    });
  });

  it("attributes the kill switch itself to env vs config", () => {
    const viaEnv = resolveEffectiveRuntimeFlagsWithSources(undefined, {
      VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH: "1",
    }).attribution["runtime.contextEnhancement.killSwitch"];
    expect(viaEnv).toMatchObject({ origin: "env", key: "VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH" });

    const cfg = {
      runtime: { contextEnhancement: { killSwitch: true } },
    } as unknown as OpenClawConfig;
    const viaConfig = resolveEffectiveRuntimeFlagsWithSources(cfg, {}).attribution[
      "runtime.contextEnhancement.killSwitch"
    ];
    expect(viaConfig).toMatchObject({ origin: "config" });
  });

  it("covers every effective flag — no flag may ship without provenance", () => {
    const { flags, attribution } = resolveEffectiveRuntimeFlagsWithSources(undefined, {});
    for (const name of Object.keys(flags)) {
      expect(attribution[name], `missing attribution for ${name}`).toBeDefined();
      expect(attribution[name]?.value).toBe(flags[name]);
    }
  });

  it("rides along in the ack payload", () => {
    const ack = buildRuntimeFlagAck({ env: {} });
    expect(ack.flagAttribution).toBeDefined();
    expect(Object.keys(ack.flagAttribution).length).toBe(
      Object.keys(ack.effectiveFlags).length,
    );
  });
});
