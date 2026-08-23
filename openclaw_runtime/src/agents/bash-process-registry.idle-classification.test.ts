/**
 * TF-0081 idle classification tests for the bash process registry.
 *
 * Classification is observability only: a session with recent output is a
 * running process and must never be treated as a reclamation candidate.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  addSession,
  classifyBashProcessIdle,
  classifyBashProcessSession,
  markBackgrounded,
  markExited,
  resetProcessRegistryForTests,
  type ProcessSession,
} from "./bash-process-registry.js";

function makeSession(params: {
  id: string;
  startedAt: number;
  lastOutputAt?: number;
}): ProcessSession {
  return {
    id: params.id,
    command: "fixture",
    scopeKey: "agent:idle:main",
    sessionKey: "agent:idle:main",
    lifecycleOwner: "native",
    lifecycleAgentId: "idle",
    lifecycleCanonicalSessionKey: "agent:idle:main",
    lifecycleExpectedSessionId: "session-idle",
    startedAt: params.startedAt,
    lastOutputAt: params.lastOutputAt,
    maxOutputChars: 1000,
    totalOutputChars: 0,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    aggregated: "",
    tail: "",
    exited: false,
    truncated: false,
    backgrounded: false,
    cursorKeyMode: "normal",
  };
}

afterEach(() => {
  resetProcessRegistryForTests();
});

describe("classifyBashProcessIdle", () => {
  it("classifies exited sessions as completed regardless of activity", () => {
    expect(
      classifyBashProcessIdle({ exited: true, lastActivityAtMs: 0, nowMs: 1_000_000 }),
    ).toBe("completed");
  });

  it("classifies sessions with recent output as running-process", () => {
    expect(
      classifyBashProcessIdle({ exited: false, lastActivityAtMs: 1_000, nowMs: 2_000, idleMs: 5_000 }),
    ).toBe("running-process");
  });

  it("classifies sessions without output beyond the window as idle, boundary inclusive", () => {
    expect(
      classifyBashProcessIdle({ exited: false, lastActivityAtMs: 0, nowMs: 4_999, idleMs: 5_000 }),
    ).toBe("running-process");
    expect(
      classifyBashProcessIdle({ exited: false, lastActivityAtMs: 0, nowMs: 5_000, idleMs: 5_000 }),
    ).toBe("idle");
    expect(
      classifyBashProcessIdle({ exited: false, lastActivityAtMs: 0, nowMs: 9_999, idleMs: 5_000 }),
    ).toBe("idle");
  });
});

describe("classifyBashProcessSession", () => {
  it("falls back to startedAt when no output has arrived yet", () => {
    const startedAt = Date.now() - 1000;
    addSession(makeSession({ id: "recent-start", startedAt }));
    expect(classifyBashProcessSession("recent-start")).toMatchObject({
      classification: "running-process",
    });
  });

  it("classifies a running session with stale output as idle", () => {
    const startedAt = Date.now() - 60 * 60 * 1000;
    const lastOutputAt = startedAt + 1000;
    addSession(makeSession({ id: "stale-output", startedAt, lastOutputAt }));
    const report = classifyBashProcessSession("stale-output");
    expect(report?.classification).toBe("idle");
    expect(report?.sinceActivityMs).toBeGreaterThan(30 * 60 * 1000);
  });

  it("classifies exited sessions as completed and unknown ids as null", () => {
    const session = makeSession({
      id: "exited",
      startedAt: Date.now() - 5_000,
      lastOutputAt: Date.now() - 4_000,
    });
    addSession(session);
    // Only backgrounded sessions are retained after exit, mirroring the real
    // background exec flow that keeps finished records for reconnect/poll.
    markBackgrounded(session);
    markExited(session, 0, null, "completed");
    expect(classifyBashProcessSession("exited")).toMatchObject({
      classification: "completed",
    });
    expect(classifyBashProcessSession("never-registered")).toBeNull();
  });
});
