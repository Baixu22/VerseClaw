/**
 * T-B6 (TF-0126) requirement-5: the working-memory regather gate is default
 * off, truthy-only, and linked to the enhancement kill switch in both forms.
 * Same fail-closed contract as TF-0128's audit gate.
 */
import { describe, expect, it } from "vitest";
import {
  WORKING_MEMORY_REGATHER_ENV,
  isWorkingMemoryRegatherEnabled,
} from "./working-memory-regather.js";
import { CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV } from "./enhancement-kill-switch.js";

describe("T-B6 AC-4: the working-memory regather gate is default-off", () => {
  it("is off when the env var is absent", () => {
    expect(isWorkingMemoryRegatherEnabled(undefined, {})).toBe(false);
  });

  it("is off for every falsey and unparseable value", () => {
    for (const raw of ["", "  ", "0", "false", "no", "off", "maybe", "2", "TRUE-ish"]) {
      expect(isWorkingMemoryRegatherEnabled(undefined, { [WORKING_MEMORY_REGATHER_ENV]: raw })).toBe(false);
    }
  });

  it("turns on only for explicit truthy values", () => {
    for (const raw of ["1", "true", "TRUE", "yes", "on", " on "]) {
      expect(isWorkingMemoryRegatherEnabled(undefined, { [WORKING_MEMORY_REGATHER_ENV]: raw })).toBe(true);
    }
  });
});

describe("T-B6 requirement-5: regather enablement moves with the kill switch", () => {
  it("stays off when the kill switch is engaged via env, even with the gate on", () => {
    expect(
      isWorkingMemoryRegatherEnabled(undefined, {
        [WORKING_MEMORY_REGATHER_ENV]: "1",
        [CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV]: "1",
      }),
    ).toBe(false);
  });

  it("stays off when the kill switch is engaged via config, even with the gate on", () => {
    expect(
      isWorkingMemoryRegatherEnabled(
        { runtime: { contextEnhancement: { killSwitch: true } } },
        { [WORKING_MEMORY_REGATHER_ENV]: "1" },
      ),
    ).toBe(false);
  });

  it("is fail-closed: a throwing config accessor yields off, not on", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile config");
        },
      },
    );
    expect(isWorkingMemoryRegatherEnabled(hostile, { [WORKING_MEMORY_REGATHER_ENV]: "1" })).toBe(false);
  });
});
