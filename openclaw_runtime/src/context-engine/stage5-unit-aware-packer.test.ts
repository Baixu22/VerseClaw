import { describe, expect, it } from "vitest";
import { packStage5ContextUnits, type Stage5ContextUnit } from "./stage5-unit-aware-packer.js";

const unit = (
  id: string,
  priority: Stage5ContextUnit["priority"],
  tokenCount: number,
  kind: Stage5ContextUnit["kind"] = "text",
): Stage5ContextUnit => ({
  id,
  priority,
  tokenCount,
  kind,
  sourceRef: `ref:${id}`,
});

describe("stage5 unit-aware packer", () => {
  it("accounts for output reserve and keeps tool/multimodal units atomic", () => {
    const result = packStage5ContextUnits({
      budgetTokens: 20,
      outputReserveTokens: 5,
      units: [unit("tool", "normal", 6, "tool_schema"), unit("image", "optional", 6, "multimodal"), unit("constraint", "constraint", 8)],
    });
    expect(result.selected.map((entry) => entry.id)).toEqual(["constraint", "tool"]);
    expect(result.omitted.map((entry) => entry.id)).toEqual(["image"]);
    expect(result.usedTokens).toBe(14);
    expect(result.reasons).toContain("output-reserve:5");
  });

  it("fails explicitly when an atomic critical unit exceeds the window", () => {
    const result = packStage5ContextUnits({
      budgetTokens: 10,
      outputReserveTokens: 2,
      units: [unit("critical", "critical", 9)],
    });
    expect(result.status).toBe("failed");
    expect(result.decisions).toEqual([{ unitId: "critical", decision: "omitted", reason: "critical-over-window", tokenCount: 9 }]);
    expect(result.reasons).toContain("critical-over-window:critical");
  });

  it("is stable for equal inputs and never prefixes text", () => {
    const input = { budgetTokens: 10, outputReserveTokens: 0, units: [unit("b", "normal", 4), unit("a", "normal", 4)] };
    expect(packStage5ContextUnits(input)).toEqual(packStage5ContextUnits(input));
    expect(packStage5ContextUnits({ ...input, units: [unit("a", "normal", 11)] }).status).toBe("degraded");
  });

  it("fails closed when output reserve exceeds the budget", () => {
    expect(packStage5ContextUnits({ budgetTokens: 2, outputReserveTokens: 3, units: [] })).toMatchObject({
      status: "failed",
      reasons: ["output-reserve-exceeds-budget"],
    });
  });

  it("fails closed on invalid enums, ids, source refs, and duplicate units", () => {
    expect(() =>
      packStage5ContextUnits({ budgetTokens: 10, outputReserveTokens: 0, units: [{ id: "x", kind: "tool_schema", priority: "bogus" as never, tokenCount: 1, sourceRef: "ref:x" }] }),
    ).toThrow("invalid-unit-priority");
    expect(() =>
      packStage5ContextUnits({ budgetTokens: 10, outputReserveTokens: 0, units: [{ id: "x", kind: "bogus" as never, priority: "normal", tokenCount: 1, sourceRef: "ref:x" }] }),
    ).toThrow("invalid-unit-kind");
    expect(() =>
      packStage5ContextUnits({ budgetTokens: 10, outputReserveTokens: 0, units: [{ id: "bad id", kind: "tool_schema", priority: "normal", tokenCount: 1, sourceRef: "ref:x" }] }),
    ).toThrow("invalid-unit-id");
    expect(() =>
      packStage5ContextUnits({ budgetTokens: 10, outputReserveTokens: 0, units: [{ id: "x", kind: "tool_schema", priority: "normal", tokenCount: 1, sourceRef: "bad\nref" }] }),
    ).toThrow("invalid-unit-source-ref");
    expect(() =>
      packStage5ContextUnits({
        budgetTokens: 10,
        outputReserveTokens: 0,
        units: [
          { id: "x", kind: "tool_schema", priority: "normal", tokenCount: 1, sourceRef: "ref:x" },
          { id: "x", kind: "text", priority: "normal", tokenCount: 1, sourceRef: "ref:y" },
        ],
      }),
    ).toThrow("duplicate-unit-id:x");
  });

  it("fails closed on fractional or negative token estimates", () => {
    expect(() => packStage5ContextUnits({ budgetTokens: 10.5, outputReserveTokens: 0, units: [] })).toThrow("invalid-budget-tokens");
    expect(() => packStage5ContextUnits({ budgetTokens: 10, outputReserveTokens: 0.5, units: [] })).toThrow("invalid-output-reserve-tokens");
    expect(() =>
      packStage5ContextUnits({ budgetTokens: 10, outputReserveTokens: 0, units: [{ id: "x", kind: "text", priority: "normal", tokenCount: 1.5, sourceRef: "ref:x" }] }),
    ).toThrow("invalid-token-count");
  });
});
