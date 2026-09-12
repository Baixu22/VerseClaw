import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addSession,
  appendOutput,
  getSession,
  markExited,
  resetProcessRegistryForTests,
  type ProcessSession,
} from "./bash-process-registry.js";
import { createProcessTool } from "./bash-tools.process.js";

const supervisor = vi.hoisted(() => ({ getRecord: vi.fn(), cancel: vi.fn() }));
vi.mock("../process/supervisor/index.js", () => ({ getProcessSupervisor: () => supervisor }));

function session(): ProcessSession {
  const value: ProcessSession = {
    id: "process-lifecycle",
    command: "waiting-command",
    startedAt: Date.now(),
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
    backgrounded: true,
    cursorKeyMode: "normal",
    stdin: { write: vi.fn((_data, cb) => cb?.()), end: vi.fn((cb) => cb?.()) },
  };
  addSession(value);
  return value;
}

afterEach(() => {
  resetProcessRegistryForTests();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("process control lifecycle", () => {
  it.each(["write", "submit", "paste", "send-keys", "remove", "poll"] as const)(
    "TF-0182 pre-aborted %s has no process or output side effects",
    async (action) => {
      const value = session();
      appendOutput(value, "stdout", "unread output");
      const abort = new AbortController();
      const reason = new DOMException("operator cancelled", "AbortError");
      abort.abort(reason);
      await expect(
        createProcessTool().execute(
          "cancel-control",
          { action, sessionId: value.id, data: "input", text: "input", literal: "input" },
          abort.signal,
        ),
      ).rejects.toBe(reason);
      expect(value.stdin!.write).not.toHaveBeenCalled();
      expect(value.stdin!.end).not.toHaveBeenCalled();
      expect(supervisor.cancel).not.toHaveBeenCalled();
      expect(getSession(value.id)).toBe(value);
      expect(value.pendingStdout).toEqual(["unread output"]);
    },
  );

  it("TF-0182 does not close stdin if cancelled while a write completes", async () => {
    const value = session();
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    vi.mocked(value.stdin!.write).mockImplementation((_data, cb) => {
      abort.abort(reason);
      cb?.();
    });
    await expect(
      createProcessTool().execute(
        "cancel-eof",
        { action: "write", sessionId: value.id, data: "input", eof: true },
        abort.signal,
      ),
    ).rejects.toBe(reason);
    expect(value.stdin!.end).not.toHaveBeenCalled();
  });

  it("TF-0183 preserves signal termination on the first poll that observes exit", async () => {
    vi.useFakeTimers();
    const value = session();
    const tool = createProcessTool();
    const result = tool.execute("exit-poll", {
      action: "poll",
      sessionId: value.id,
      timeout: 1000,
    });
    markExited(value, null, "SIGTERM", "failed");
    await vi.advanceTimersByTimeAsync(250);
    const first = await result;
    const repeated = await tool.execute("finished-poll", { action: "poll", sessionId: value.id });
    expect(first.details).toMatchObject({
      status: "failed",
      exitCode: null,
      exitSignal: "SIGTERM",
    });
    expect(repeated.details).toMatchObject({
      status: "failed",
      exitCode: null,
      exitSignal: "SIGTERM",
    });
  });
});
