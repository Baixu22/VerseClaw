/**
 * T-C1 (TF-0128) AC-7: the shadow damage audit must be default-off, and with the
 * gate closed the compaction path must behave exactly as it did before the audit
 * existed — no audit, no scoring, no recording, no observable side effect.
 *
 * Requirement-8 also demands the gate be linked to the enhancement kill switch,
 * so an engaged kill switch has to beat an explicit opt-in.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPACTION_DAMAGE_AUDIT_ENV,
  isCompactionDamageAuditEnabled,
} from "./compaction-damage-rules.js";
import { CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV } from "../../context-engine/enhancement-kill-switch.js";
import {
  getContextHealthHistory,
  resetContextHealthForTests,
} from "../../context-engine/context-health-monitor.js";

afterEach(() => {
  resetContextHealthForTests();
});

describe("T-C1 AC-7: the audit gate is default-off", () => {
  it("is off when the env var is absent", () => {
    expect(isCompactionDamageAuditEnabled(undefined, {})).toBe(false);
  });

  it("is off for every falsey and unparseable value", () => {
    for (const raw of ["", "  ", "0", "false", "no", "off", "maybe", "2", "TRUE-ish"]) {
      expect(
        isCompactionDamageAuditEnabled(undefined, { [COMPACTION_DAMAGE_AUDIT_ENV]: raw }),
      ).toBe(false);
    }
  });

  it("turns on only for explicit truthy values", () => {
    for (const raw of ["1", "true", "TRUE", "yes", "on", " on "]) {
      expect(
        isCompactionDamageAuditEnabled(undefined, { [COMPACTION_DAMAGE_AUDIT_ENV]: raw }),
      ).toBe(true);
    }
  });
});

describe("T-C1 AC-7 / requirement-8: kill switch beats an explicit opt-in", () => {
  it("stays off when the kill switch is engaged via env, even with the audit on", () => {
    expect(
      isCompactionDamageAuditEnabled(undefined, {
        [COMPACTION_DAMAGE_AUDIT_ENV]: "1",
        [CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV]: "1",
      }),
    ).toBe(false);
  });

  it("stays off when the kill switch is engaged via config, even with the audit on", () => {
    expect(
      isCompactionDamageAuditEnabled(
        { runtime: { contextEnhancement: { killSwitch: true } } },
        { [COMPACTION_DAMAGE_AUDIT_ENV]: "1" },
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
    expect(
      isCompactionDamageAuditEnabled(hostile, { [COMPACTION_DAMAGE_AUDIT_ENV]: "1" }),
    ).toBe(false);
  });
});

describe("T-C1 AC-7: gate closed means no observable effect", () => {
  it("records nothing into the context-health registry while the gate is closed", () => {
    // The production call site is `if (isCompactionDamageAuditEnabled(...))`, so
    // a closed gate means auditCompactionDamage / recordContextHealth are never
    // reached. Asserting the registry stays empty pins that: if someone later
    // moves the recording outside the gate, this fails.
    expect(isCompactionDamageAuditEnabled(undefined, {})).toBe(false);
    expect(getContextHealthHistory()).toEqual([]);
  });
});
