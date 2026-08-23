/**
 * TF-0087 generation guard tests for backgrounded exec exit notifications.
 *
 * A backgrounded exec pinned to an old session generation must not inject its
 * exit notification (and the accompanying heartbeat wake) into a
 * post-reset/forked generation's system-event queue. No real pin (absent,
 * blank, or the canonical-key fallback) and an unresolvable current generation
 * keep the legacy liveness-only delivery; store read failures fail open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasPendingHeartbeatWake,
  resetHeartbeatWakeStateForTests,
} from "../infra/heartbeat-wake.js";
import {
  hasSystemEvents,
  peekSystemEventEntries,
  resetSystemEventsForTest,
} from "../infra/system-events.js";
import type { ProcessSession } from "./bash-process-registry.js";
import { testing as execRuntimeTesting } from "./bash-tools.exec-runtime.js";

const mocks = vi.hoisted(() => ({
  loadSessionStore: vi.fn(),
}));

vi.mock("../config/sessions/store-load.js", () => ({
  loadSessionStore: mocks.loadSessionStore,
}));

vi.mock("../config/sessions/paths.js", () => ({
  resolveStorePath: (store?: string) => `/tmp/session-store/${store ?? "default"}.json`,
}));

const SESSION_KEY = "agent:main:main";
const CANONICAL_KEY = "agent:main:main";

function buildSession(overrides?: Partial<ProcessSession>): ProcessSession {
  const now = Date.now();
  return {
    id: "exec-guard-session",
    command: "sleep 1",
    sessionKey: SESSION_KEY,
    lifecycleOwner: "native",
    lifecycleAgentId: "main",
    lifecycleCanonicalSessionKey: CANONICAL_KEY,
    lifecycleExpectedSessionId: "session-generation-1",
    lifecycleSessionStoreTemplate: undefined,
    notifyOnExit: true,
    notifyOnExitEmptySuccess: false,
    exitNotified: false,
    startedAt: now,
    maxOutputChars: 1000,
    totalOutputChars: 4,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    aggregated: "done",
    tail: "done",
    exited: true,
    truncated: false,
    backgrounded: true,
    cursorKeyMode: "normal",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSystemEventsForTest();
  resetHeartbeatWakeStateForTests();
});

afterEach(() => {
  resetSystemEventsForTest();
  resetHeartbeatWakeStateForTests();
});

describe("exec exit notification generation guard", () => {
  it("drops the exit notification when the session key was rebound to a new generation", () => {
    mocks.loadSessionStore.mockReturnValue({
      [SESSION_KEY]: { sessionId: "session-generation-2" },
    });
    const session = buildSession();

    execRuntimeTesting.maybeNotifyOnExit(session, "completed");

    expect(hasSystemEvents(SESSION_KEY)).toBe(false);
    expect(hasPendingHeartbeatWake()).toBe(false);
    expect(session.exitNotified).toBe(true);

    // The drop decision is final for this exit: no repeat store reads, no retry.
    execRuntimeTesting.maybeNotifyOnExit(session, "completed");
    expect(mocks.loadSessionStore).toHaveBeenCalledTimes(1);
    expect(hasSystemEvents(SESSION_KEY)).toBe(false);
  });

  it("delivers the exit notification when the pinned generation matches", () => {
    mocks.loadSessionStore.mockReturnValue({
      [SESSION_KEY]: { sessionId: "session-generation-1" },
    });

    execRuntimeTesting.maybeNotifyOnExit(buildSession(), "completed");

    const events = peekSystemEventEntries(SESSION_KEY);
    expect(events).toHaveLength(1);
    expect(events[0]?.text).toContain("Exec completed");
    expect(hasPendingHeartbeatWake()).toBe(true);
  });

  it("keeps legacy delivery when the pin fell back to the canonical session key", () => {
    mocks.loadSessionStore.mockReturnValue({
      [SESSION_KEY]: { sessionId: "session-generation-2" },
    });

    execRuntimeTesting.maybeNotifyOnExit(
      buildSession({ lifecycleExpectedSessionId: CANONICAL_KEY }),
      "completed",
    );

    expect(peekSystemEventEntries(SESSION_KEY)).toHaveLength(1);
    expect(mocks.loadSessionStore).not.toHaveBeenCalled();
  });

  it("keeps legacy delivery when the pin is blank", () => {
    mocks.loadSessionStore.mockReturnValue({
      [SESSION_KEY]: { sessionId: "session-generation-2" },
    });

    execRuntimeTesting.maybeNotifyOnExit(
      buildSession({ lifecycleExpectedSessionId: "   " }),
      "completed",
    );

    expect(peekSystemEventEntries(SESSION_KEY)).toHaveLength(1);
    expect(mocks.loadSessionStore).not.toHaveBeenCalled();
  });

  it("keeps legacy delivery when the current generation is unresolvable", () => {
    mocks.loadSessionStore.mockReturnValue({});

    execRuntimeTesting.maybeNotifyOnExit(buildSession(), "completed");

    expect(peekSystemEventEntries(SESSION_KEY)).toHaveLength(1);
    expect(hasPendingHeartbeatWake()).toBe(true);
  });

  it("fails open when the session store cannot be read", () => {
    mocks.loadSessionStore.mockImplementation(() => {
      throw new Error("sqlite disk image is malformed");
    });

    execRuntimeTesting.maybeNotifyOnExit(buildSession(), "completed");

    expect(peekSystemEventEntries(SESSION_KEY)).toHaveLength(1);
  });

  it("still applies the pre-existing silent-drop branches before the guard", () => {
    mocks.loadSessionStore.mockReturnValue({
      [SESSION_KEY]: { sessionId: "session-generation-2" },
    });
    const session = buildSession({
      aggregated: "",
      tail: "",
      totalOutputChars: 0,
      exitReason: "manual-cancel",
    });

    execRuntimeTesting.maybeNotifyOnExit(session, "failed");

    expect(hasSystemEvents(SESSION_KEY)).toBe(false);
    expect(session.exitNotified).toBe(true);
    expect(mocks.loadSessionStore).not.toHaveBeenCalled();
  });

  it("also drops notifications for stale subagent session keys", () => {
    const subagentKey = "agent:main:subagent:child";
    mocks.loadSessionStore.mockReturnValue({
      [subagentKey]: { sessionId: "session-generation-2" },
    });

    execRuntimeTesting.maybeNotifyOnExit(
      buildSession({ sessionKey: subagentKey }),
      "completed",
    );

    expect(hasSystemEvents(subagentKey)).toBe(false);
    expect(hasPendingHeartbeatWake()).toBe(false);
  });
});
