/**
 * FP-P0-05: one shared budget per turn, summable accounting, reproducible
 * degradation order, and zeroed books when the kill switch is engaged.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  beginTurnInjectionBudget,
  chargeTurnInjection,
  endTurnInjectionBudget,
  getTurnInjectionBudget,
  getEffectiveDropAlertRatio,
  getEffectiveTurnInjectionCharBudget,
  precedenceIndexOf,
  resetTurnInjectionBudgetsForTests,
  reserveTurnInjectionCapacity,
  setTurnInjectionBudgetConfig,
  skipTurnInjection,
  summarizeTurnInjection,
  TURN_INJECTION_CHAR_BUDGET,
  TURN_INJECTION_DROP_ALERT_RATIO,
  TURN_INJECTION_PRECEDENCE,
} from "./turn-injection-budget.js";

afterEach(() => {
  resetTurnInjectionBudgetsForTests();
});

describe("FP-P0-05 precedence", () => {
  it("orders correctness-bearing context before enrichment", () => {
    expect(precedenceIndexOf("knowledge")).toBeLessThan(precedenceIndexOf("working_memory"));
    expect(precedenceIndexOf("working_memory")).toBeLessThan(precedenceIndexOf("tool_registry"));
    expect(precedenceIndexOf("tool_registry")).toBeLessThan(precedenceIndexOf("cvk_addition"));
    expect(precedenceIndexOf("cvk_addition")).toBeLessThan(precedenceIndexOf("vtoken"));
    expect(precedenceIndexOf("vtoken")).toBeLessThan(precedenceIndexOf("memory_pilot"));
  });

  it("declares a total order with no duplicates", () => {
    expect(new Set(TURN_INJECTION_PRECEDENCE).size).toBe(TURN_INJECTION_PRECEDENCE.length);
  });
});

describe("FP-P0-05 shared budget", () => {
  it("all sources in one turn share a single budget instance", () => {
    const a = beginTurnInjectionBudget({ turnId: "turn-1", total: 100 });
    const b = beginTurnInjectionBudget({ turnId: "turn-1", total: 100 });
    expect(b).toBe(a);
    chargeTurnInjection(a, "knowledge", "x".repeat(60));
    // The second holder sees the first holder's spend — that is the whole point.
    expect(b.budget.used).toBe(60);
  });

  it("keeps separate turns on separate accounts", () => {
    const a = beginTurnInjectionBudget({ turnId: "turn-a", total: 100 });
    const b = beginTurnInjectionBudget({ turnId: "turn-b", total: 100 });
    chargeTurnInjection(a, "knowledge", "x".repeat(90));
    expect(b.budget.used).toBe(0);
  });

  it("accounting sums: applied + dropped + truncated-loss == requested", () => {
    const ledger = beginTurnInjectionBudget({ turnId: "turn-sum", total: 100 });
    chargeTurnInjection(ledger, "knowledge", "k".repeat(40));
    chargeTurnInjection(ledger, "working_memory", "w".repeat(40));
    chargeTurnInjection(ledger, "tool_registry", "t".repeat(40));
    chargeTurnInjection(ledger, "vtoken", "v".repeat(40));
    const acc = summarizeTurnInjection(ledger);
    expect(acc.charsApplied + acc.charsDropped + acc.charsTruncated).toBe(acc.charsRequested);
    expect(acc.charsApplied).toBeLessThanOrEqual(acc.total);
  });

  it("degrades later-precedence sources first and the order is reproducible", () => {
    const run = () => {
      resetTurnInjectionBudgetsForTests();
      const ledger = beginTurnInjectionBudget({ turnId: "turn-order", total: 100 });
      for (const channel of ["knowledge", "working_memory", "tool_registry", "vtoken"] as const) {
        chargeTurnInjection(ledger, channel, channel[0]!.repeat(40));
      }
      return summarizeTurnInjection(ledger);
    };
    const first = run();
    const second = run();
    expect(first.degradationOrder).toEqual(second.degradationOrder);
    // knowledge (40) and working_memory (40) fit; tool_registry truncates; vtoken drops.
    expect(first.byChannel.knowledge?.applied).toBe(40);
    expect(first.byChannel.working_memory?.applied).toBe(40);
    expect(first.byChannel.tool_registry?.disposition).toBe("truncate");
    expect(first.byChannel.vtoken?.disposition).toBe("drop");
  });

  it("protects later-charging DCS capacity from an earlier CVK charge without fake entries", () => {
    const ledger = beginTurnInjectionBudget({ turnId: "turn-reserved", total: 100 });
    reserveTurnInjectionCapacity(
      ledger,
      ["knowledge", "working_memory", "tool_registry"],
      40,
    );

    const cvk = chargeTurnInjection(ledger, "cvk_addition", "c".repeat(100));
    expect(cvk.charsApplied).toBe(60);
    expect(cvk.truncated).toBe(true);
    expect(ledger.entries).toHaveLength(1);
    expect(summarizeTurnInjection(ledger).byChannel).not.toHaveProperty("knowledge");

    expect(chargeTurnInjection(ledger, "knowledge", "k".repeat(20)).charsApplied).toBe(20);
    expect(chargeTurnInjection(ledger, "working_memory", "w".repeat(20)).charsApplied).toBe(20);
    const accounting = summarizeTurnInjection(ledger);
    expect(accounting.charsApplied).toBe(100);
    expect(accounting.byChannel.knowledge?.disposition).toBe("applied");
    expect(accounting.byChannel.working_memory?.disposition).toBe("applied");
  });

  it("distinguishes drop / truncate / skip in observation", () => {
    const ledger = beginTurnInjectionBudget({ turnId: "turn-disp", total: 30 });
    chargeTurnInjection(ledger, "knowledge", "k".repeat(20));
    chargeTurnInjection(ledger, "working_memory", "w".repeat(40)); // truncate into 10
    chargeTurnInjection(ledger, "tool_registry", "t".repeat(10)); // nothing left → drop
    skipTurnInjection(ledger, "memory_pilot");
    const acc = summarizeTurnInjection(ledger);
    expect(acc.byChannel.knowledge?.disposition).toBe("applied");
    expect(acc.byChannel.working_memory?.disposition).toBe("truncate");
    expect(acc.byChannel.tool_registry?.disposition).toBe("drop");
    expect(acc.byChannel.memory_pilot?.disposition).toBe("skip");
  });

  it("treats an empty/absent injection as skip, not as a drop", () => {
    const ledger = beginTurnInjectionBudget({ turnId: "turn-empty", total: 100 });
    chargeTurnInjection(ledger, "vtoken", undefined);
    chargeTurnInjection(ledger, "memory_pilot", "");
    const acc = summarizeTurnInjection(ledger);
    expect(acc.charsDropped).toBe(0);
    expect(acc.byChannel.vtoken?.disposition).toBe("skip");
    expect(acc.byChannel.memory_pilot?.disposition).toBe("skip");
  });

  it("kill switch zeroes the books: total 0, nothing applied, every entry skip", () => {
    const ledger = beginTurnInjectionBudget({ turnId: "turn-killed", killed: true });
    const charged = chargeTurnInjection(ledger, "knowledge", "k".repeat(500));
    expect(charged.text).toBeUndefined();
    const acc = summarizeTurnInjection(ledger);
    expect(acc.killed).toBe(true);
    expect(acc.total).toBe(0);
    expect(acc.charsApplied).toBe(0);
    expect(acc.charsRequested).toBe(0);
    expect(acc.charsDropped).toBe(0);
    expect(acc.dropRatio).toBe(0);
    expect(acc.alert).toBe(false);
  });

  it("raises the drop alert only past the declared ratio", () => {
    const quiet = beginTurnInjectionBudget({ turnId: "turn-quiet", total: 1000 });
    chargeTurnInjection(quiet, "knowledge", "k".repeat(900));
    chargeTurnInjection(quiet, "vtoken", "v".repeat(50)); // fits in remaining 100
    expect(summarizeTurnInjection(quiet).alert).toBe(false);

    const loud = beginTurnInjectionBudget({ turnId: "turn-loud", total: 1000 });
    chargeTurnInjection(loud, "knowledge", "k".repeat(1000));
    chargeTurnInjection(loud, "vtoken", "v".repeat(500)); // fully dropped = 50%
    const acc = summarizeTurnInjection(loud);
    expect(acc.dropRatio).toBeGreaterThan(TURN_INJECTION_DROP_ALERT_RATIO);
    expect(acc.alert).toBe(true);
  });

  it("does not eliminate degradation by enlarging the total (accounting stays honest)", () => {
    const small = beginTurnInjectionBudget({ turnId: "turn-small", total: 50 });
    chargeTurnInjection(small, "knowledge", "k".repeat(200));
    const smallAcc = summarizeTurnInjection(small);
    expect(smallAcc.charsTruncated).toBeGreaterThan(0);
    // The requested amount is recorded regardless of what fit, so widening the
    // budget cannot make the loss disappear retroactively.
    expect(smallAcc.charsRequested).toBe(200);
  });

  it("end frees the ledger so turns cannot leak into each other", () => {
    beginTurnInjectionBudget({ turnId: "turn-end", total: 100 });
    expect(getTurnInjectionBudget("turn-end")).toBeDefined();
    const acc = endTurnInjectionBudget("turn-end");
    expect(acc?.turnId).toBe("turn-end");
    expect(getTurnInjectionBudget("turn-end")).toBeUndefined();
    expect(endTurnInjectionBudget("turn-end")).toBeUndefined();
  });
});

describe("FP-P2-04 config overrides", () => {
  it("defaults to the FP-P0-05 starting-line values", () => {
    expect(getEffectiveTurnInjectionCharBudget()).toBe(TURN_INJECTION_CHAR_BUDGET);
    expect(getEffectiveDropAlertRatio()).toBe(TURN_INJECTION_DROP_ALERT_RATIO);
  });

  it("setTurnInjectionBudgetConfig overrides the effective total", () => {
    setTurnInjectionBudgetConfig({ totalChars: 8000 });
    expect(getEffectiveTurnInjectionCharBudget()).toBe(8000);
    // A turn started without an explicit `total` now uses the override.
    const ledger = beginTurnInjectionBudget({ turnId: "turn-cfg-total" });
    expect(ledger.budget.total).toBe(8000);
  });

  it("setTurnInjectionBudgetConfig overrides the effective drop alert ratio", () => {
    setTurnInjectionBudgetConfig({ dropAlertRatio: 0.05 });
    expect(getEffectiveDropAlertRatio()).toBe(0.05);
    // A 6% drop now trips the alert at the tighter 5% threshold.
    const ledger = beginTurnInjectionBudget({ turnId: "turn-cfg-ratio", total: 1000 });
    chargeTurnInjection(ledger, "knowledge", "k".repeat(1000));
    chargeTurnInjection(ledger, "vtoken", "v".repeat(60)); // fully dropped = 6%
    expect(summarizeTurnInjection(ledger).alert).toBe(true);
  });

  it("resetTurnInjectionBudgetsForTests restores the FP-P0-05 defaults", () => {
    setTurnInjectionBudgetConfig({ totalChars: 9999, dropAlertRatio: 0.42 });
    resetTurnInjectionBudgetsForTests();
    expect(getEffectiveTurnInjectionCharBudget()).toBe(TURN_INJECTION_CHAR_BUDGET);
    expect(getEffectiveDropAlertRatio()).toBe(TURN_INJECTION_DROP_ALERT_RATIO);
  });
});
