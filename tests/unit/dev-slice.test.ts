import { describe, expect, it } from "vitest";
import {
  DEV_SLICE_CACHE_VERSION,
  buildStratifiedDevSlice,
  isDevSliceCacheValid,
} from "./helpers/runtime-memory-dev-slice";

describe("runtime memory dev slice", () => {
  it("uses the Stage 2 cache contract with retrieval scores and no profile augmentation", () => {
    expect(DEV_SLICE_CACHE_VERSION).toBe("31.0-p0-sota-aligned-2026-07-05");
  });

  it("builds a deterministic stratified slice", () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => ({
        qa: { id: `s${i}` },
        conversationId: "c1",
        category: "single_hop",
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        qa: { id: `t${i}` },
        conversationId: "c1",
        category: "temporal",
      })),
      { qa: { id: "a0" }, conversationId: "c1", category: "adversarial" },
    ];

    const first = buildStratifiedDevSlice(items, {
      sampleSizes: { single_hop: 3, temporal: 2 },
      seed: 42,
    });
    const second = buildStratifiedDevSlice(items, {
      sampleSizes: { single_hop: 3, temporal: 2 },
      seed: 42,
    });

    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
    expect(first.filter((item) => item.category === "single_hop")).toHaveLength(3);
    expect(first.some((item) => item.category === "adversarial")).toBe(false);
  });

  it("validates cache metadata", () => {
    expect(
      isDevSliceCacheValid({
        version: DEV_SLICE_CACHE_VERSION,
        sampleSeed: 42,
        sampleSizes: { single_hop: 82, temporal: 31, multi_hop: 28, open_domain: 9 },
        questions: [],
      }),
    ).toBe(true);
    expect(
      isDevSliceCacheValid({
        version: "old",
        sampleSeed: 42,
        sampleSizes: { single_hop: 82, temporal: 31, multi_hop: 28, open_domain: 9 },
        questions: [],
      }),
    ).toBe(false);
  });

  it("preserves stable item metadata such as qaIndex", () => {
    const items = Array.from({ length: 4 }, (_, i) => ({
      qa: { id: `q${i}` },
      conversationId: "conv-1",
      category: "single_hop",
      qaIndex: i,
    }));

    const slice = buildStratifiedDevSlice(items, {
      sampleSizes: { single_hop: 2 },
      seed: 42,
    });

    expect(slice[0]).toHaveProperty("qaIndex");
    expect(typeof slice[0].qaIndex).toBe("number");
  });
});
