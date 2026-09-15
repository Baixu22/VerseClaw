import { describe, expect, it } from "vitest";
import {
  calculateBackoffMs,
  pruneStaleCommandPolls,
  recordCommandPoll,
} from "./command-poll-backoff.js";
import type { SessionState } from "../logging/diagnostic-session-state.js";

function state(): SessionState {
  return {
    lastActivity: Date.now(),
    state: "processing",
    queueDepth: 0,
    commandPollCounts: new Map(),
  };
}

describe("command poll backoff bounds", () => {
  it("TF-0221 clamps direct backoff lookups to the first schedule entry", () => {
    expect(calculateBackoffMs(-1)).toBe(5_000);
    expect(calculateBackoffMs(Number.NaN)).toBe(5_000);
  });

  it("TF-0221 recovers from malformed stored poll counts", () => {
    const session = state();
    session.commandPollCounts!.set("command", { count: Number.NaN, lastPollAt: Date.now() });
    expect(recordCommandPoll(session, "command", false)).toBe(5_000);
    expect(session.commandPollCounts!.get("command")?.count).toBe(0);
  });

  it("TF-0221 treats an invalid prune age as the default retention window", () => {
    const session = state();
    session.commandPollCounts!.set("command", { count: 0, lastPollAt: Date.now() });
    pruneStaleCommandPolls(session, -1);
    expect(session.commandPollCounts!.has("command")).toBe(true);
  });
});
