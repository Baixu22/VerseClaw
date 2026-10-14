import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAggregatedResourceEnvelopeSnapshot: vi.fn(),
}));

vi.mock("../../electron/services/resource-envelope", () => ({
  getAggregatedResourceEnvelopeSnapshot: mocks.getAggregatedResourceEnvelopeSnapshot,
}));

import { createResourceEnvelopeApi } from "../../electron/services/resource-envelope-api";

describe("resource envelope host api", () => {
  it("fails closed when no trustworthy snapshot exists", async () => {
    mocks.getAggregatedResourceEnvelopeSnapshot.mockResolvedValueOnce({
      schema: "openclaw.resource-envelope/v1",
      generatedAt: 1,
      mode: "shadow",
      entries: [],
      totals: {
        activeSlots: 0,
        queuedCount: 0,
        queueWaitMs: 0,
        processCount: 0,
        treeRssBytes: 0,
        treeCpuPercent: 0,
      },
      exceeded: [],
      warnings: ["gateway snapshot unavailable"],
    });
    await expect(createResourceEnvelopeApi().getState()).resolves.toEqual({
      measured: false,
      snapshot: null,
    });
  });

  it("returns a measured snapshot when entries exist", async () => {
    const snapshot = {
      schema: "openclaw.resource-envelope/v1",
      generatedAt: 1,
      mode: "shadow" as const,
      entries: [{ id: "main:1" }],
      totals: {
        activeSlots: 1,
        queuedCount: 0,
        queueWaitMs: 0,
        processCount: 1,
        treeRssBytes: 10,
        treeCpuPercent: 5,
      },
      exceeded: [],
      warnings: [],
    };
    mocks.getAggregatedResourceEnvelopeSnapshot.mockResolvedValueOnce(snapshot);
    const state = await createResourceEnvelopeApi().getState();
    expect(state.measured).toBe(true);
    expect(state.snapshot?.entries).toHaveLength(1);
  });
});