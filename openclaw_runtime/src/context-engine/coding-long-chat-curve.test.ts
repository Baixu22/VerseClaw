import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codingObservability } from "./coding-observability.js";
import { runLongChatCurve } from "./coding-long-chat-curve.js";

describe("coding-long-chat-curve (C6-H)", () => {
  beforeEach(() => codingObservability.reset());
  afterEach(() => codingObservability.reset());

  it("runs ≥64K cumulative curve with compaction layers and no auto flip", () => {
    const report = runLongChatCurve({
      targetCumulativeChars: 64_000,
      toolOutputCharsPerTurn: 5000,
    });
    expect(report.cumulativeRawChars).toBeGreaterThanOrEqual(64_000);
    expect(report.flipGates.promptNotLinearExploding).toBe(true);
    expect(report.flipGates.compactionLayersHit).toBe(true);
    expect(report.flipGates.readyToConsiderAssemblerFlip).toBe(false);
    expect(report.finalPromptCharsEstimate).toBeLessThan(report.cumulativeRawChars * 0.5);
    expect(report.points.some((p) => p.layers.includes("tool_output_compress"))).toBe(true);
  });
});