// FP-P1-182: COMPASS and the runtime-memory memory pilot read the same fact store, so the
// fact lines had to become individually addressable. Exposing them must not move a single
// injected byte, which this pins by rebuilding the rendered text from the split lines.
import { describe, expect, it } from "vitest";
import {
  TOP5_FACTS_HEADER,
  serializeTop5Facts,
  splitTop5FactLines,
} from "./memory-pre-reply-injection.js";

const hits = [
  { fact: { factId: "f1", subject: "Bob", objectSummary: "likes tea", confidence: 0.9 } },
  { fact: { factId: "f2", subject: "Ann", objectSummary: "y".repeat(150) } },
] as never;

describe("top5 fact lines (FP-P1-182)", () => {
  it("exposes one line per fact for the same rendered text", () => {
    const entries = splitTop5FactLines(hits);

    expect(entries.map((entry) => entry.factId)).toEqual(["f1", "f2"]);
    expect([TOP5_FACTS_HEADER, ...entries.map((entry) => entry.text)].join("\n")).toBe(
      serializeTop5Facts(hits),
    );
  });

  it("keeps the per-line truncation and confidence formatting", () => {
    const entries = splitTop5FactLines(hits);

    expect(entries[0]!.text).toBe("1. Bob: likes tea (conf: 0.90)");
    // 150 chars are truncated to 100 with an ellipsis; missing confidence is 0.00.
    expect(entries[1]!.text.endsWith("(conf: 0.00)")).toBe(true);
    expect(entries[1]!.text).toContain("...");
  });

  it("returns nothing for an empty hit list", () => {
    expect(splitTop5FactLines([])).toEqual([]);
    expect(serializeTop5Facts([])).toBe("");
  });
});
