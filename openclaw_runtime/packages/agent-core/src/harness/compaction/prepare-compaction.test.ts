/**
 * #178: `prepareCompaction` honors an explicit `keepFromEntryId`, so a located
 * ("summarize up to / from here") compaction keeps exactly the requested tail
 * verbatim and summarizes the rest. An id that is absent, off-branch, or not a
 * valid cut point must fail closed rather than silently widening the range.
 */
import { describe, expect, it } from "vitest";
import type { SessionTreeEntry } from "../types.js";
import { prepareCompaction, type CompactionSettings } from "./compaction.js";

const SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

function userEntry(id: string, parentId: string | null, text: string): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content: text, timestamp: Date.now() },
  } as unknown as SessionTreeEntry;
}

function assistantEntry(id: string, parentId: string | null, text: string): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      provider: "test",
      model: "test",
      timestamp: Date.now(),
    },
  } as unknown as SessionTreeEntry;
}

function toolResultEntry(id: string, parentId: string | null): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "toolResult", content: "ok", timestamp: Date.now() },
  } as unknown as SessionTreeEntry;
}

/** A four-entry conversation long enough to compact. */
function conversation(): SessionTreeEntry[] {
  const filler = "x".repeat(4000);
  return [
    userEntry("u1", null, `first question ${filler}`),
    assistantEntry("a1", "u1", `first answer ${filler}`),
    userEntry("u2", "a1", `second question ${filler}`),
    assistantEntry("a2", "u2", `second answer ${filler}`),
  ];
}

describe("#178 located compaction cut point", () => {
  it("uses the token-budget cut point when no keepFromEntryId is set", () => {
    // A small keepRecentTokens budget so the default cut leaves something to
    // summarize (the fixture is only ~4k tokens).
    const result = prepareCompaction(conversation(), { ...SETTINGS, keepRecentTokens: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.firstKeptEntryId).toBeTruthy();
    expect(result.value?.messagesToSummarize.length ?? 0).toBeGreaterThan(0);
  });

  it("pins firstKeptEntryId and summarizes only the prefix up to it", () => {
    const result = prepareCompaction(conversation(), { ...SETTINGS, keepFromEntryId: "u2" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.firstKeptEntryId).toBe("u2");
    expect(result.value?.isSplitTurn).toBe(false);
    // Only the first turn is summarized; the retained tail starts at u2.
    expect(result.value?.messagesToSummarize).toHaveLength(2);
  });

  it("fails closed when the id is not on the branch", () => {
    const result = prepareCompaction(conversation(), { ...SETTINGS, keepFromEntryId: "nope" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("is not on the session branch");
  });

  it("fails closed when the id is not a valid cut point", () => {
    const entries = [
      userEntry("u1", null, `question ${"x".repeat(4000)}`),
      assistantEntry("a1", "u1", `answer ${"x".repeat(4000)}`),
      toolResultEntry("t1", "a1"),
      assistantEntry("a2", "t1", `reply ${"x".repeat(4000)}`),
    ];
    const result = prepareCompaction(entries, { ...SETTINGS, keepFromEntryId: "t1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("not a valid compaction cut point");
  });
});