import { expect, it, vi } from "vitest";
import {
  clearActiveEmbeddedRun,
  isEmbeddedAgentExecutionActive,
  setActiveEmbeddedRun,
  type EmbeddedAgentQueueHandle,
} from "./runs.js";

vi.mock("../user-message-queue.js", () => ({ triggerQueueDrain: vi.fn() }));

it("requires the exact live embedded handle and preserves a replacement when an old handle exits", () => {
  const sessionKey = "agent:main:task-scope-handle";
  const sessionId = "task-scope-generation";
  const abort = new AbortController();
  const old: EmbeddedAgentQueueHandle = {
    runId: "old-run",
    queueMessage: async () => {},
    isStreaming: () => false,
    isCompacting: () => false,
    abort: () => {},
  };
  const next = { ...old, runId: "next-run", abortSignal: abort.signal };
  const input = { runId: old.runId!, sessionKey, sessionId };
  try {
    setActiveEmbeddedRun(sessionId, old, sessionKey);
    expect(isEmbeddedAgentExecutionActive(input)).toBe(true);
    for (const patch of [
      { runId: "other-run" },
      { sessionId: "other-generation" },
      { sessionKey: "agent:main:other" },
    ]) {
      expect(isEmbeddedAgentExecutionActive({ ...input, ...patch })).toBe(false);
    }
    setActiveEmbeddedRun(sessionId, next, sessionKey);
    clearActiveEmbeddedRun(sessionId, old, sessionKey);
    expect(isEmbeddedAgentExecutionActive(input)).toBe(false);
    expect(isEmbeddedAgentExecutionActive({ ...input, runId: next.runId })).toBe(true);
    abort.abort();
    expect(isEmbeddedAgentExecutionActive({ ...input, runId: next.runId })).toBe(false);
  } finally {
    clearActiveEmbeddedRun(sessionId, old, sessionKey);
    clearActiveEmbeddedRun(sessionId, next, sessionKey);
  }
  expect(isEmbeddedAgentExecutionActive({ ...input, runId: next.runId })).toBe(false);
});
