import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateContextRecall,
  computeContextRecall,
  resolveGoldEvidence,
} from "./helpers/runtime-memory-context-recall";

describe("runtime memory context recall", () => {
  it("scores full, partial, and absent evidence", () => {
    const context = "Alice said she moved to Seattle for a robotics role.";
    expect(computeContextRecall(context, ["Alice moved to Seattle for robotics"])).toBe(1);
    expect(computeContextRecall(context, ["Alice moved to Portland for robotics"])).toBe(0.5);
    expect(computeContextRecall(context, ["Caroline adopted a sourdough starter"])).toBe(0);
  });

  it("aggregates by category", () => {
    const aggregate = aggregateContextRecall([
      {
        category: "single_hop",
        assembledContext: "Alice moved to Seattle",
        goldEvidence: ["Alice moved to Seattle"],
      },
      {
        category: "temporal",
        assembledContext: "No matching evidence",
        goldEvidence: ["Caroline visited Rome"],
      },
    ]);

    expect(aggregate.overall.contextRecall).toBe(0.5);
    expect(aggregate.byCategory.single_hop.contextRecall).toBe(1);
    expect(aggregate.byCategory.temporal.contextRecall).toBe(0);
  });
});

describe("LoCoMo evidence ID regression (#134)", () => {
  it("resolves real dataset IDs to text rather than scoring dataset metadata", () => {
    const data = JSON.parse(readFileSync(resolve("tests/fixtures/locomo/locomo10_raw.json"), "utf8")) as Array<{
      conversation: Record<string, unknown>;
      qa: Array<{ category: number; evidence: string[] }>;
    }>;
    for (const sample of data) {
      const turns = Object.entries(sample.conversation)
        .filter(([key, value]) => /^session_\d+$/.test(key) && Array.isArray(value))
        .flatMap(([, value]) => value as Array<{ dia_id: string; text: string }>);
      const map = new Map(turns.map((turn) => [turn.dia_id, turn.text]));
      const qa = sample.qa.find((item) => item.category !== 5 && item.evidence.length > 0
        && resolveGoldEvidence(item.evidence, map).every((text) => text.split(/\s+/).some((word) => word.length > 3)));
      expect(qa).toBeDefined();
      const gold = qa!.evidence;
      const context = resolveGoldEvidence(gold, map).join(" ");
      expect(computeContextRecall(context, gold, map)).toBe(1);
      expect(computeContextRecall("", gold, map)).toBe(0);
      expect(() => computeContextRecall(context, gold)).toThrow("turn-text map");
    }
  });

  it("never awards recall for absent or unresolved gold", () => {
    expect(computeContextRecall("anything", [])).toBe(0);
    expect(computeContextRecall("D1:12", ["D1:12"], new Map())).toBe(0);
    expect(computeContextRecall("anything", ["D"], new Map())).toBe(0);
  });

  it("handles the dataset's compound, malformed and zero-padded ID spellings", () => {
    const map = new Map([["D8:6", "Alice moved to Seattle"], ["D9:17", "Caroline visited Portland"], ["D30:5", "Daniel adopted rabbits"], ["D11:26", "Maria teaches robotics"]]);
    expect(resolveGoldEvidence(["D8:6; D9:17", "D30:05", "D:11:26"], map)).toEqual([...map.values()]);
    expect(computeContextRecall("Alice moved to Seattle", ["D8:6 D999:1"], map)).toBe(0.5);
  });
});
