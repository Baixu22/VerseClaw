/**
 * B-4: ContextHealthMonitor v1 — deterministic four-dimension scoring,
 * rolling-window novelty, in-memory registry, and explicit snapshot.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeNovelty,
  contextHealthScoreToScorecard,
  getContextHealthHistory,
  recordContextHealth,
  resetContextHealthForTests,
  scoreContextHealth,
  scoreGoalAlignment,
  scoreInformationNovelty,
  scoreInjectionPressure,
  scoreStructuralFidelity,
  writeContextHealthSnapshot,
} from "./context-health-monitor.js";
import type { TurnInjectionAccounting } from "./turn-injection-budget.js";
import {
  beginTurnInjectionBudget,
  chargeTurnInjection,
  endTurnInjectionBudget,
} from "./turn-injection-budget.js";

afterEach(() => {
  resetContextHealthForTests();
});

describe("B-4 computeNovelty", () => {
  it("returns 1 for an empty window (everything is new)", () => {
    expect(computeNovelty("fresh text", [])).toBe(1);
  });

  it("returns 0 for identical text", () => {
    const text = "the quick brown fox jumps over the lazy dog repeatedly";
    expect(computeNovelty(text, [text])).toBe(0);
  });

  it("returns a low score for near-duplicate text", () => {
    const base = "the quick brown fox jumps over the lazy dog repeatedly";
    const near = "the quick brown fox jumps over the lazy dog again";
    expect(computeNovelty(near, [base])).toBeLessThan(0.5);
  });

  it("returns a high score for unrelated text", () => {
    const base = "the quick brown fox jumps over the lazy dog repeatedly";
    const other = "quantum entangled photons never obey classical locality bounds";
    expect(computeNovelty(other, [base])).toBeGreaterThan(0.9);
  });

  it("handles short texts by degrading to a single shingle", () => {
    expect(computeNovelty("hi", ["hi"])).toBe(0);
    expect(computeNovelty("hi", ["there"])).toBe(1);
  });
});

describe("B-4 dimension scorers", () => {
  it("scoreInjectionPressure maps dropRatio to a health score", () => {
    const accounting = (dropRatio: number): TurnInjectionAccounting => ({
      turnId: "t",
      total: 100,
      charsApplied: 100 - dropRatio * 100,
      charsRequested: 100,
      charsDropped: dropRatio * 100,
      charsTruncated: 0,
      remaining: 0,
      dropRatio,
      alert: dropRatio > 0.1,
      killed: false,
      byChannel: {},
      degradationOrder: [],
    });
    expect(scoreInjectionPressure(accounting(0))).toBe(100);
    expect(scoreInjectionPressure(accounting(0.1))).toBe(70);
    expect(scoreInjectionPressure(accounting(0.3))).toBe(10);
    expect(scoreInjectionPressure(accounting(1))).toBe(0);
  });

  it("scoreStructuralFidelity counts missing sections", () => {
    expect(scoreStructuralFidelity([])).toBe(100);
    expect(scoreStructuralFidelity(["## Decisions"])).toBe(80);
    expect(scoreStructuralFidelity(["## Decisions", "## Open TODOs"])).toBe(60);
    expect(scoreStructuralFidelity(["a", "b", "c", "d", "e"])).toBe(0);
  });

  it("scoreGoalAlignment measures objective coverage in context", () => {
    const objective = "refactor the auth middleware to use JWT rotation";
    const covered = "We should refactor the auth middleware to use JWT rotation today.";
    const missing = "The weather is nice and the build pipeline is green.";
    expect(scoreGoalAlignment(objective, covered)).toBeGreaterThan(50);
    expect(scoreGoalAlignment(objective, missing)).toBeLessThan(30);
    expect(scoreGoalAlignment(undefined, missing)).toBe(100);
    expect(scoreGoalAlignment(objective, undefined)).toBe(100);
  });

  it("scoreInformationNovelty averages samples", () => {
    expect(scoreInformationNovelty([])).toBe(100);
    expect(
      scoreInformationNovelty([
        { channel: "memory_pilot", novelty: 1 },
        { channel: "memory_pilot", novelty: 0.5 },
      ]),
    ).toBe(75);
  });
});

describe("B-4 scoreContextHealth", () => {
  it("blends provided dimensions and stays 100 when nothing is missing", () => {
    const score = scoreContextHealth({
      turnId: "turn-1",
      injectionPressure: 100,
      structuralFidelity: 100,
      goalAlignment: 100,
      informationNovelty: 100,
    });
    expect(score.overall).toBe(100);
    expect(score.reasons).toEqual([]);
    expect(score.schema).toBe("context-health/v1");
  });

  it("attaches reasons for dimensions below their alert thresholds", () => {
    const score = scoreContextHealth({
      structuralFidelity: 40,
      goalAlignment: 55,
    });
    expect(score.reasons.some((reason) => reason.startsWith("STRUCTURE_DAMAGE"))).toBe(true);
    expect(score.reasons.some((reason) => reason.startsWith("GOAL_DRIFT"))).toBe(true);
  });

  it("re-weights when only a subset of dimensions is provided", () => {
    const onlyPressure = scoreContextHealth({ injectionPressure: 0 });
    const onlyFidelity = scoreContextHealth({ structuralFidelity: 0 });
    // Both would blend to a low overall; exact weights differ but both alert.
    expect(onlyPressure.overall).toBeLessThan(50);
    expect(onlyFidelity.overall).toBeLessThan(50);
  });
});

describe("B-4 registry and snapshot", () => {
  it("records and returns history", () => {
    recordContextHealth(scoreContextHealth({ turnId: "turn-a", injectionPressure: 100 }));
    recordContextHealth(scoreContextHealth({ turnId: "turn-b", injectionPressure: 0 }));
    const history = getContextHealthHistory();
    expect(history).toHaveLength(2);
    expect(history.map((score) => score.turnId)).toContain("turn-a");
    expect(history.map((score) => score.turnId)).toContain("turn-b");
  });

  it("writes an explicit snapshot file", () => {
    recordContextHealth(scoreContextHealth({ turnId: "turn-a", injectionPressure: 90 }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-health-"));
    try {
      const result = writeContextHealthSnapshot(dir);
      expect(fs.existsSync(result.path)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(result.path, "utf-8"));
      expect(parsed.schema).toBe("context-health/v1");
      expect(parsed.scores).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("endTurnInjectionBudget records an injection-pressure score", () => {
    const ledger = beginTurnInjectionBudget({ turnId: "turn-health", total: 100 });
    chargeTurnInjection(ledger, "knowledge", "k".repeat(100));
    chargeTurnInjection(ledger, "vtoken", "v".repeat(100)); // fully dropped
    endTurnInjectionBudget("turn-health");
    const history = getContextHealthHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.turnId).toBe("turn-health");
    // dropRatio = 1.0 → pressure 0.
    expect(history[0]?.dimensions.injectionPressure).toBe(0);
  });
});

describe("B-4 v2 contextHealthScoreToScorecard", () => {
  it("projects a ContextHealthScore onto the Observability scorecard shape", () => {
    const score = scoreContextHealth({
      turnId: "turn-9",
      injectionPressure: 100,
      structuralFidelity: 100,
      goalAlignment: 100,
      informationNovelty: 100,
    });
    const card = contextHealthScoreToScorecard(score);
    expect(card.traceId).toBe("ctx-health-turn-9");
    expect(card.score).toBe(100);
    expect(card.grade).toBe("A");
    expect(card.items).toHaveLength(4);
    expect(card.items.map((item) => item.id)).toEqual([
      "injectionPressure",
      "structuralFidelity",
      "goalAlignment",
      "informationNovelty",
    ]);
  });

  it("maps low overall scores to F and keeps reasons on every item", () => {
    const score = scoreContextHealth({
      turnId: "turn-10",
      structuralFidelity: 40,
    });
    const card = contextHealthScoreToScorecard(score);
    expect(card.grade).toBe("F");
    expect(card.items.every((item) => item.reason.includes("STRUCTURE_DAMAGE"))).toBe(true);
  });
});
