import { describe, expect, it } from "vitest";
import { SessionSummaryIndex } from "./helpers/runtime-memory-session-summary-index";

describe("runtime memory session summary index", () => {
  it("builds and searches session summaries", async () => {
    const index = new SessionSummaryIndex();
    await index.buildFromTurns(
      "conv-1",
      [
        {
          conversationId: "conv-1",
          sessionId: "session_1",
          sessionDate: Date.UTC(2023, 0, 1),
          speaker: "Alice",
          text: "I started work at Acme Robotics.",
          turnIndex: 0,
        },
        {
          conversationId: "conv-1",
          sessionId: "session_2",
          sessionDate: Date.UTC(2023, 0, 2),
          speaker: "Alice",
          text: "I visited Rome.",
          turnIndex: 1,
        },
      ],
      {
        id: "fake",
        dimension: 2,
        embedQuery: async () => [1, 0],
        embedBatch: async (texts) =>
          texts.map((text) => (text.includes("Acme") ? [1, 0] : [0, 1])),
      },
      async (_system, user) => ({
        content: user.includes("Acme")
          ? "Alice discussed Acme Robotics."
          : "Alice discussed Rome.",
      }),
    );

    const hits = await index.search("Where does Alice work?", new Float32Array([1, 0]), 1);
    expect(index.size).toBe(2);
    expect(index.records).toHaveLength(2);
    expect(hits[0].summary).toContain("Acme");
  });
});
