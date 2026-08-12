/**
 * Regression tests for the parent-fork admission facade (issue #27).
 *
 * The skip decision's message must state only the fact (parent too large);
 * the isolated-context fallback phrasing is opt-in for call sites that really
 * fall back, so fail-closed callers (sessions.fork RPC) never claim a
 * degradation that did not happen.
 */
import { describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";
import { formatParentForkFallbackNote, resolveParentForkDecision } from "./session-fork.js";

const runtimeMock = vi.hoisted(() => ({
  parentTokens: undefined as number | undefined,
}));

vi.mock("./session-fork.runtime.js", () => ({
  resolveParentForkTokenCountRuntime: async () => runtimeMock.parentTokens,
  forkSessionFromParentRuntime: async () => null,
}));

const parentEntry = { sessionId: "parent-1" } as SessionEntry;
const storePath = "/tmp/sessions.json";

describe("resolveParentForkDecision", () => {
  it("skips oversized parents with a fact-only message (issue #27)", async () => {
    runtimeMock.parentTokens = 130_903;
    const decision = await resolveParentForkDecision({ parentEntry, storePath });
    expect(decision.status).toBe("skip");
    if (decision.status !== "skip") {
      throw new Error("expected skip decision");
    }
    expect(decision.reason).toBe("parent-too-large");
    expect(decision.parentTokens).toBe(130_903);
    expect(decision.maxTokens).toBe(100_000);
    expect(decision.message).toBe("Parent context is too large to fork (130903/100000 tokens).");
    expect(decision.message).not.toMatch(/isolated context/i);
  });

  it("forks parents at or under the token ceiling", async () => {
    runtimeMock.parentTokens = 100_000;
    const decision = await resolveParentForkDecision({ parentEntry, storePath });
    expect(decision.status).toBe("fork");
    expect(decision.parentTokens).toBe(100_000);
  });

  it("forks when the parent token count is unknown", async () => {
    runtimeMock.parentTokens = undefined;
    const decision = await resolveParentForkDecision({ parentEntry, storePath });
    expect(decision.status).toBe("fork");
  });
});

describe("formatParentForkFallbackNote", () => {
  it("adds the isolated-context phrasing for callers that really degrade", async () => {
    runtimeMock.parentTokens = 130_903;
    const decision = await resolveParentForkDecision({ parentEntry, storePath });
    if (decision.status !== "skip") {
      throw new Error("expected skip decision");
    }
    expect(formatParentForkFallbackNote(decision)).toBe(
      "Parent context is too large to fork (130903/100000 tokens); " +
        "starting with isolated context instead.",
    );
  });
});
