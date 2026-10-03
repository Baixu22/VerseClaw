import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deprecationCounters } from "../../observability/deprecation-counters.js";
import {
  buildCompactionBudgetShadow,
  type CompactionBudgetShadow,
  type TierSchedule,
} from "../../../packages/agent-core/src/harness/compaction/compression-planner.js";
import { buildDeterministicCompressionArtifact } from "../../../packages/agent-core/src/harness/compaction/compression-artifact.js";
import type { CompactionSettings } from "../../../packages/agent-core/src/harness/compaction/compaction.js";
import { recordSafeguardBudgetShadow } from "./compaction-safeguard.js";
import { recordEmbeddedCompactionBudgetCounters } from "../embedded-agent-runner/compact.js";

const SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  contextWindow: 1_000,
};

const SCHEDULE: TierSchedule = {
  taskClass: "refactor",
  thresholds: { tier1: 0.55 },
  budgetTokens: 900,
  reason: "P5 shadow schedule",
};

function shadow(overrides: Partial<CompactionBudgetShadow> = {}): CompactionBudgetShadow {
  return {
    taskClass: "refactor",
    plannedTier: "tier1",
    actualTier: "tier1",
    ignored: false,
    budgetExceeded: false,
    generatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("compaction budget shadow", () => {
  beforeEach(() => deprecationCounters.reset());
  afterEach(() => deprecationCounters.reset());

  it("buildCompactionBudgetShadow is absent without a schedule", () => {
    expect(buildCompactionBudgetShadow({
      schedule: undefined,
      settings: SETTINGS,
      tokensBefore: 560,
    })).toBeUndefined();
  });

  it("buildCompactionBudgetShadow locks planned/actual tier, earlier-only thresholds, and budget diagnostics", () => {
    const value = buildCompactionBudgetShadow({
      schedule: SCHEDULE,
      settings: SETTINGS,
      tokensBefore: 560,
    });
    expect(value).toMatchObject({
      taskClass: "refactor",
      plannedTier: "tier1",
      actualTier: "tier1",
      ignored: false,
      budgetExceeded: false,
    });
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);

    const exceeded = buildCompactionBudgetShadow({
      schedule: SCHEDULE,
      settings: SETTINGS,
      tokensBefore: 950,
    });
    expect(exceeded?.budgetExceeded).toBe(true);
  });

  it("budgetShadow is diagnostics-only and never enters CompressionArtifact", () => {
    const value = buildCompactionBudgetShadow({
      schedule: SCHEDULE,
      settings: SETTINGS,
      tokensBefore: 560,
    });
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    expect(value).not.toHaveProperty("artifact");

    const artifact = buildDeterministicCompressionArtifact({
      messages: [],
      summary: "projection only",
      telemetry: {
        tier: value?.plannedTier ?? "tier0",
        strategy: "micro-compact",
        pressure: 0.56,
        tokensBefore: 560,
        warnings: [],
        staleExcludedCount: 0,
        causalAnchorCount: 0,
        rehydratedFiles: [],
      },
    });
    expect(JSON.stringify(artifact)).not.toContain("budgetShadow");
  });

  it("recordEmbeddedCompactionBudgetCounters writes the three real A5 counters", () => {
    recordEmbeddedCompactionBudgetCounters(shadow());
    expect(deprecationCounters.snapshot().a5.planAdoptedCount).toBe(1);
    expect(deprecationCounters.snapshot().a5.planIgnoredCount).toBe(0);

    recordEmbeddedCompactionBudgetCounters(shadow({ ignored: true, budgetExceeded: true }));
    expect(deprecationCounters.snapshot().a5.planIgnoredCount).toBe(1);
    expect(deprecationCounters.snapshot().a5.budgetExceededCount).toBe(1);
  });

  it("recordSafeguardBudgetShadow records ignored plans when safeguard overrides the planner", () => {
    const value = recordSafeguardBudgetShadow({
      schedule: SCHEDULE,
      settings: SETTINGS,
      tokensBefore: 560,
    });
    expect(value?.ignored).toBe(true);
    expect(deprecationCounters.snapshot().a5.planIgnoredCount).toBe(1);
    expect(deprecationCounters.snapshot().a5.planAdoptedCount).toBe(0);

    recordSafeguardBudgetShadow({ schedule: undefined, settings: SETTINGS, tokensBefore: 560 });
    expect(deprecationCounters.snapshot().a5.planIgnoredCount).toBe(1);
  });

  it("ignored rate > 20% keeps triggering degrade_to_default_budget in the existing registry", () => {
    deprecationCounters.incrementA5PlanAdopted(79);
    deprecationCounters.incrementA5PlanIgnored(21);
    const result = deprecationCounters.checkBudgetViolation("a5");
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.action).toBe("degrade_to_default_budget");
    }
  });
});
