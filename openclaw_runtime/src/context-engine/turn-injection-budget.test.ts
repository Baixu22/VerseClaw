/**
 * FP-P0-05: one shared budget per turn, summable accounting, reproducible
 * degradation order, and zeroed books when the kill switch is engaged.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  beginTurnInjectionBudget,
  chargeTurnInjection,
  decayFactorFor,
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
  TURN_INJECTION_CHANNEL_POLICY,
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

  it("reads runtime.contextBlock.injectionBudget.* from the on-disk config", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-budget-cfg-"));
    const configPath = path.join(dir, "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        runtime: {
          contextBlock: {
            injectionBudget: { totalChars: 8000, dropAlertRatio: 0.05 },
          },
        },
      }),
      "utf-8",
    );
    const prevPath = process.env.OPENCLAW_CONFIG_PATH;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    try {
      expect(getEffectiveTurnInjectionCharBudget()).toBe(8000);
      expect(getEffectiveDropAlertRatio()).toBe(0.05);
      // A turn started without an explicit `total` uses the file override.
      const ledger = beginTurnInjectionBudget({ turnId: "turn-file-total" });
      expect(ledger.budget.total).toBe(8000);
    } finally {
      if (prevPath === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = prevPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an explicit setTurnInjectionBudgetConfig wins over the file override", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-budget-cfg-"));
    const configPath = path.join(dir, "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        runtime: { contextBlock: { injectionBudget: { totalChars: 8000 } } },
      }),
      "utf-8",
    );
    const prevPath = process.env.OPENCLAW_CONFIG_PATH;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    try {
      setTurnInjectionBudgetConfig({ totalChars: 9999 });
      expect(getEffectiveTurnInjectionCharBudget()).toBe(9999);
    } finally {
      if (prevPath === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = prevPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a missing or corrupt config falls back to the FP-P0-05 defaults", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-budget-cfg-"));
    const configPath = path.join(dir, "openclaw.json");
    fs.writeFileSync(configPath, "{ not json", "utf-8");
    const prevPath = process.env.OPENCLAW_CONFIG_PATH;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    try {
      expect(getEffectiveTurnInjectionCharBudget()).toBe(TURN_INJECTION_CHAR_BUDGET);
      expect(getEffectiveDropAlertRatio()).toBe(TURN_INJECTION_DROP_ALERT_RATIO);
    } finally {
      if (prevPath === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = prevPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("B-1 channel policy", () => {
  it("declares a policy for every precedence channel", () => {
    for (const channel of TURN_INJECTION_PRECEDENCE) {
      expect(TURN_INJECTION_CHANNEL_POLICY[channel]).toBeDefined();
      expect(TURN_INJECTION_CHANNEL_POLICY[channel].priority).toBeGreaterThan(0);
      expect(TURN_INJECTION_CHANNEL_POLICY[channel].decayHalfLifeTurns).toBeGreaterThan(0);
    }
  });

  it("keeps policy priority ordered the same way as precedence", () => {
    for (let i = 1; i < TURN_INJECTION_PRECEDENCE.length; i += 1) {
      const earlier = TURN_INJECTION_PRECEDENCE[i - 1]!;
      const later = TURN_INJECTION_PRECEDENCE[i]!;
      expect(TURN_INJECTION_CHANNEL_POLICY[earlier].priority).toBeGreaterThan(
        TURN_INJECTION_CHANNEL_POLICY[later].priority,
      );
    }
  });

  it("decays only when a finite half-life is configured", () => {
    expect(decayFactorFor("knowledge", 10)).toBe(1);
    expect(decayFactorFor("memory_pilot", 0)).toBe(1);
    expect(decayFactorFor("memory_pilot", 1)).toBe(1); // default: Infinity
  });

  it("decayFactorFor follows the exponential half-life curve", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-budget-cfg-"));
    const configPath = path.join(dir, "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        runtime: {
          contextBlock: {
            injectionBudget: { channelDecay: { memory_pilot: 1, vtoken: 2 } },
          },
        },
      }),
      "utf-8",
    );
    const prevPath = process.env.OPENCLAW_CONFIG_PATH;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    try {
      // Half-life 1 turn: each turn halves the ceiling.
      expect(decayFactorFor("memory_pilot", 1)).toBeCloseTo(0.5);
      expect(decayFactorFor("memory_pilot", 2)).toBeCloseTo(0.25);
      // Half-life 2 turns: turn 2 decays to 2^(-2/2) = 0.5.
      expect(decayFactorFor("vtoken", 2)).toBeCloseTo(0.5);
      // A channel not present in channelDecay keeps its default (no decay).
      expect(decayFactorFor("knowledge", 10)).toBe(1);
    } finally {
      if (prevPath === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = prevPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a decaying channel gives budget back to fresher context as turns advance", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-budget-cfg-"));
    const configPath = path.join(dir, "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        runtime: {
          contextBlock: {
            injectionBudget: { channelDecay: { memory_pilot: 1 } },
          },
        },
      }),
      "utf-8",
    );
    const prevPath = process.env.OPENCLAW_CONFIG_PATH;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    try {
      // Same text, same budget, same turnIndex 0: full ceiling (no decay yet).
      const first = beginTurnInjectionBudget({ turnId: "turn-decay-a", total: 100, turnIndex: 0 });
      const firstResult = chargeTurnInjection(first, "memory_pilot", "m".repeat(100));
      expect(firstResult.charsApplied).toBe(100);

      // With turnIndex 1 and half-life 1, the ceiling is halved → truncate to ~50.
      const second = beginTurnInjectionBudget({ turnId: "turn-decay-b", total: 100, turnIndex: 1 });
      const secondResult = chargeTurnInjection(second, "memory_pilot", "m".repeat(100));
      expect(secondResult.charsApplied).toBeLessThanOrEqual(51);
      expect(secondResult.truncated).toBe(true);

      // knowledge is pinned (Infinity): never decays regardless of turn index.
      const third = beginTurnInjectionBudget({ turnId: "turn-decay-c", total: 100, turnIndex: 5 });
      const thirdResult = chargeTurnInjection(third, "knowledge", "k".repeat(100));
      expect(thirdResult.charsApplied).toBe(100);
    } finally {
      if (prevPath === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = prevPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records priority and decayFactor on charged entries for audit", () => {
    const ledger = beginTurnInjectionBudget({ turnId: "turn-audit", total: 1000, turnIndex: 3 });
    chargeTurnInjection(ledger, "knowledge", "k".repeat(10));
    chargeTurnInjection(ledger, "memory_pilot", "m".repeat(10));
    const knowledgeEntry = ledger.entries.find((e) => e.channel === "knowledge");
    const memoryEntry = ledger.entries.find((e) => e.channel === "memory_pilot");
    expect(knowledgeEntry?.priority).toBe(TURN_INJECTION_CHANNEL_POLICY.knowledge.priority);
    expect(knowledgeEntry?.decayFactor).toBe(1);
    expect(memoryEntry?.priority).toBe(TURN_INJECTION_CHANNEL_POLICY.memory_pilot.priority);
  });
});
