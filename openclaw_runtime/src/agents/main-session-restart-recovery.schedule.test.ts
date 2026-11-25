import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/sessions.js", () => ({
  loadSessionStore: () => ({}),
  resolveAllAgentSessionStoreTargetsSync: () => [],
  updateSessionStore: async () => {},
  updateSessionStoreAtomic: async () => {},
}));
vi.mock("../gateway/call.js", () => ({ callGateway: vi.fn() }));
vi.mock("../gateway/session-utils.fs.js", () => ({ readSessionMessagesAsync: async () => [] }));
vi.mock("./session-dirs.js", () => ({ resolveAgentSessionDirs: async () => [] }));
vi.mock("./execution-phase/store.js", () => ({
  settleOrphanedExecutionPhases: vi.fn(),
}));

import { scheduleRestartAbortedMainSessionRecovery } from "./main-session-restart-recovery.js";

describe("main session restart recovery scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", "legacy");
    vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", "legacy");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each([
    ["legacy", 5_000],
    ["taskflow", 0],
  ])("starts the first %s recovery scan at %i ms", async (writer, expectedDelay) => {
    vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", writer);
    vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", writer);
    scheduleRestartAbortedMainSessionRecovery({ maxRetries: 1 });
    expect(vi.getTimerCount()).toBe(1);
    if (expectedDelay > 0) {
      await vi.advanceTimersByTimeAsync(expectedDelay - 1);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
    } else {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a failed candidate scan after 250 ms", async () => {
    vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", "taskflow");
    vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", "taskflow");
    scheduleRestartAbortedMainSessionRecovery({ maxRetries: 2, delayMs: 250 });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});