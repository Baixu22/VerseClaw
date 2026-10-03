import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../types.js";
import type { CompressionSemanticAtom } from "./compression-artifact.js";
import {
  DEFAULT_TIER_THRESHOLDS,
  planCompression,
  planCriticalFirstBudget,
  selectCompressionPlan,
  type CompressionPlannerInput,
} from "./compression-planner.js";
import type { CompactionSettings } from "./compaction.js";

const SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  contextWindow: 1_000,
};

function userMessage(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.now() } as AgentMessage;
}

function atom(text: string): CompressionSemanticAtom {
  return {
    id: `atom-${text.slice(0, 8)}`,
    type: "decision",
    canonicalIdentity: text,
    severity: "critical",
    confidence: 1,
    scope: "session",
    polarity: "neutral",
    status: "verified",
    text,
    evidenceRefs: [{ type: "session", ref: "m1" }],
  };
}

describe("selectCompressionPlan P5 thresholds", () => {
  it("keeps the existing 0.6/0.75/0.85/0.95 ladder when thresholds are absent", () => {
    const expected = [
      [0, "tier0"],
      [0.599, "tier0"],
      [0.6, "tier1"],
      [0.749, "tier1"],
      [0.75, "tier2"],
      [0.849, "tier2"],
      [0.85, "tier3"],
      [0.949, "tier3"],
      [0.95, "tier4"],
      [1.2, "tier4"],
    ] as const;
    for (const [pressure, tier] of expected) {
      const plan = selectCompressionPlan({
        tokensBefore: Math.round(pressure * 1_000),
        settings: SETTINGS,
      });
      expect(plan.tier).toBe(tier);
      expect(plan.pressure).toBeCloseTo(pressure, 4);
    }
  });

  it("only moves thresholds earlier and clamps later user values to production defaults", () => {
    const earlier = selectCompressionPlan({
      tokensBefore: 560,
      settings: SETTINGS,
      thresholds: { tier1: 0.55 },
    });
    expect(earlier.tier).toBe("tier1");

    const unchanged = selectCompressionPlan({ tokensBefore: 560, settings: SETTINGS });
    expect(unchanged.tier).toBe("tier0");

    const clamped = selectCompressionPlan({
      tokensBefore: 650,
      settings: SETTINGS,
      thresholds: { tier1: 0.8 },
    });
    // 0.8 would defer micro-compact past the production 0.6 backstop; it must
    // clamp to 0.6 so the production ladder is never delayed.
    expect(clamped.tier).toBe("tier1");

    expect(DEFAULT_TIER_THRESHOLDS).toEqual({ tier1: 0.6, tier2: 0.75, tier3: 0.85, tier4: 0.95 });
  });
});

describe("planCompression P5 tierSchedule", () => {
  const input: CompressionPlannerInput = {
    tokensBefore: 560,
    settings: SETTINGS,
    messages: [
      userMessage("first message"),
      userMessage(
        Array.from({ length: 80 }, (_, index) => `line ${index} ${"x".repeat(40)}`).join("\n"),
      ),
    ],
  };

  it("leaves plan.tier at tier0 without a schedule and does not micro-compact", () => {
    const result = planCompression(input);
    expect(result.plan.tier).toBe("tier0");
    expect(result.telemetry.tier).toBe("tier0");
    expect((result.messages[1] as { content?: unknown }).content).toContain("line 79");
  });

  it("uses tierSchedule only for plan.tier and keeps the existing tier behavior", () => {
    const result = planCompression({
      ...input,
      tierSchedule: {
        taskClass: "refactor",
        thresholds: { tier1: 0.55 },
        budgetTokens: 900,
        reason: "shadow schedule",
      },
    });
    expect(result.plan.tier).toBe("tier1");
    expect(result.telemetry.tier).toBe("tier1");
    expect(result.telemetry.taskClass).toBe("refactor");
    expect(result.telemetry.budgetTokens).toBe(900);
    const compacted = (result.messages[1] as { content?: unknown }).content as string;
    expect(compacted.length).toBeLessThan(80 * 48);
    expect(compacted).toContain("lines micro-compacted");
  });
});

describe("planCriticalFirstBudget", () => {
  it("keeps the fixed budget order and truncates niceToHaveProse before criticalLedger", () => {
    const result = planCriticalFirstBudget({
      criticalLedger: [atom("ABCDEFGH")],
      latestUserAsk: "ABCDEFGH",
      unfinishedActions: ["ABCDEFGH"],
      failureChainValidation: ["ABCDEFGH"],
      exactIdentifiers: ["ABCDEFGH"],
      importantFacts: ["ABCDEFGH"],
      niceToHaveProse: ["ABCDEFGH"],
      budgetTokens: 12,
    });
    expect(result.order).toEqual([
      "criticalLedger",
      "latestUserAsk",
      "unfinishedActions",
      "failureChainValidation",
      "exactIdentifiers",
      "importantFacts",
      "niceToHaveProse",
    ]);
    // Every supplied item is 8 chars = 2 estimated tokens, so 12 tokens fit
    // everything except niceToHaveProse.
    expect(result.allowedTokens.niceToHaveProse).toBe(0);
    expect(result.truncated).toEqual(["niceToHaveProse"]);
    expect(result.allowedTokens.criticalLedger).toBe(2);
  });

  it("truncates criticalLedger only after every earlier class is exhausted", () => {
    const result = planCriticalFirstBudget({
      criticalLedger: [atom("ABCDEFGH")],
      latestUserAsk: "ABCDEFGH",
      unfinishedActions: ["ABCDEFGH"],
      failureChainValidation: ["ABCDEFGH"],
      exactIdentifiers: ["ABCDEFGH"],
      importantFacts: ["ABCDEFGH"],
      niceToHaveProse: ["ABCDEFGH"],
      budgetTokens: 1,
    });
    expect(result.allowedTokens.criticalLedger).toBe(1);
    expect(result.allowedTokens.latestUserAsk).toBe(0);
    expect(result.allowedTokens.niceToHaveProse).toBe(0);
    expect(result.truncated).toEqual([
      "criticalLedger",
      "latestUserAsk",
      "unfinishedActions",
      "failureChainValidation",
      "exactIdentifiers",
      "importantFacts",
      "niceToHaveProse",
    ]);
  });

  it("returns bounded JSON-serializable diagnostics and never calls a model", () => {
    const result = planCriticalFirstBudget({
      criticalLedger: [atom("ABCDEFGH")],
      latestUserAsk: "ABCDEFGH",
      unfinishedActions: ["ABCDEFGH"],
      failureChainValidation: ["ABCDEFGH"],
      exactIdentifiers: ["ABCDEFGH"],
      importantFacts: ["ABCDEFGH"],
      niceToHaveProse: ["ABCDEFGH"],
      budgetTokens: 5,
    });
    const roundTripped = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(roundTripped).toEqual(result);
    expect(Object.keys(result.allowedTokens).length).toBeLessThanOrEqual(7);
  });
});

describe("P5 planner performance budget", () => {
  it("plans 100 small inputs with p99 <= 30ms", () => {
    const durations: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now();
      planCompression({
        tokensBefore: 700 + index,
        settings: SETTINGS,
        messages: [userMessage(`small input ${index}`)],
        tierSchedule: {
          taskClass: "answer",
          thresholds: { tier1: 0.55 },
          budgetTokens: 800,
        },
      });
      durations.push(performance.now() - started);
    }
    durations.sort((a, b) => a - b);
    const p99 = durations[Math.max(0, Math.ceil(durations.length * 0.99) - 1)] ?? 0;
    expect(p99).toBeLessThanOrEqual(30);
  });
});
