import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV,
  isContextEnhancementAllowed,
  isContextEnhancementKillSwitchEngaged,
} from "./enhancement-kill-switch.js";

describe("context enhancement kill switch", () => {
  const prev = process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];

  beforeEach(() => {
    delete process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV];
    else process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = prev;
  });

  it("defaults to not engaged", () => {
    expect(isContextEnhancementKillSwitchEngaged({})).toBe(false);
    expect(isContextEnhancementAllowed({})).toBe(true);
  });

  it("engages via env", () => {
    process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = "1";
    expect(isContextEnhancementKillSwitchEngaged({})).toBe(true);
    expect(isContextEnhancementAllowed({})).toBe(false);
  });

  it("engages via config runtime.contextEnhancement.killSwitch", () => {
    expect(
      isContextEnhancementKillSwitchEngaged({
        runtime: { contextEnhancement: { killSwitch: true } },
      }),
    ).toBe(true);
  });

  it("does not engage on explicit false / omitted", () => {
    process.env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV] = "0";
    expect(
      isContextEnhancementKillSwitchEngaged({
        runtime: { contextEnhancement: { killSwitch: false } },
      }),
    ).toBe(false);
  });
});
