import { EventEmitter, getEventListeners, once } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addSession,
  appendOutput,
  getSession,
  getFinishedSession,
  markExited,
  resetProcessRegistryForTests,
  type ProcessSession,
} from "./bash-process-registry.js";
import { createProcessTool } from "./bash-tools.process.js";
import { getDiagnosticSessionState } from "../logging/diagnostic-session-state.js";

const supervisor = vi.hoisted(() => ({ getRecord: vi.fn(), cancel: vi.fn() }));
vi.mock("../process/supervisor/index.js", () => ({ getProcessSupervisor: () => supervisor }));
vi.mock("../process/kill-tree.js", () => ({ killProcessTree: vi.fn() }));

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
  it.each(["write", "write-eof", "send-keys", "submit", "paste", "eof"] as const)(
    "TF-0211 %s reports the owner's terminal outcome after input completes",
    async (action) => {
      for (const status of ["completed", "failed"] as const) {
        const value = session();
        const stdin = value.stdin!;
        stdin.destroy = vi.fn();
        const finish = (cb?: (error?: Error | null) => void) => {
          appendOutput(value, "stdout", "final output\n");
          markExited(value, 0, null, status, status === "failed" ? "overall-timeout" : "exit");
          cb?.();
        };
        if (action === "eof") vi.mocked(stdin.end).mockImplementation(finish);
        else vi.mocked(stdin.write).mockImplementation((_data, cb) => finish(cb));
        const tool = createProcessTool();
        const input = await tool.execute("finishing-input", {
          action: action === "eof" || action === "write-eof" ? "write" : action,
          sessionId: value.id,
          data: "input",
          literal: "input",
          text: "input",
          eof: action === "eof" || action === "write-eof",
        });
        const terminal = getFinishedSession(value.id);
        if (action === "write-eof") expect(stdin.end).not.toHaveBeenCalled();
        expect(input.details).toMatchObject({
          status,
          sessionId: value.id,
          exitCode: 0,
          aggregated: "final output\n",
        });
        const poll = await tool.execute("after-input", { action: "poll", sessionId: value.id });
        expect(poll.details).toMatchObject({ status, exitCode: 0 });
        expect(getFinishedSession(value.id)).toBe(terminal);
      }
    },
  );

  it.each(["write", "send-keys", "submit", "paste", "eof"] as const)(
    "TF-0203 cancellation ends a pending stdin %s callback wait",
    async (action) => {
      const value = session();
      const abort = new AbortController();
      const reason = new Error("cancel pending stdin");
      let release: (() => void) | undefined;
      const stdin = value.stdin!;
      if (action === "eof") {
        vi.mocked(stdin.end).mockImplementation((cb) => {
          release = () => cb?.();
        });
      } else {
        vi.mocked(stdin.write).mockImplementation((_data, cb) => {
          release = () => cb?.();
        });
      }
      const pending = createProcessTool().execute(
        "pending-input",
        {
          action: action === "eof" ? "write" : action,
          sessionId: value.id,
          data: "input",
          literal: "input",
          text: "input",
          eof: true,
        },
        abort.signal,
      );
      const settled = vi.fn();
      void pending.then(settled, settled);
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      abort.abort(reason);
      try {
        await vi.waitFor(() => expect(settled).toHaveBeenCalledWith(reason), { timeout: 150 });
      } finally {
        release?.();
      }
      await expect(pending).rejects.toBe(reason);
      expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
      expect(stdin.end).toHaveBeenCalledTimes(action === "eof" ? 1 : 0);
      expect(getSession(value.id)).toBe(value);
    },
  );

  it("TF-0204 polling an exited child waits for unread stdout and stderr", async () => {
    const value = session();
    const child = Object.assign(new EventEmitter(), {
      exitCode: 0,
      signalCode: null,
      pid: 4242,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    value.child = child as unknown as ProcessSession["child"];
    child.stdout.on("data", (chunk: Buffer) => appendOutput(value, "stdout", chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => appendOutput(value, "stderr", chunk.toString()));
    const tool = createProcessTool();
    try {
      const first = await tool.execute("draining-poll", { action: "poll", sessionId: value.id });
      expect(first.details).toMatchObject({ status: "running" });
      expect(child.stdout.destroyed).toBe(false);
      expect(child.stderr.destroyed).toBe(false);
      const drained = Promise.all([once(child.stdout, "end"), once(child.stderr, "end")]);
      child.stdout.end("last stdout\n");
      child.stderr.end("last stderr\n");
      await drained;
      const final = await tool.execute("drained-poll", { action: "poll", sessionId: value.id });
      expect(final.details).toMatchObject({
        status: "completed",
        exitCode: 0,
        aggregated: "last stdout\nlast stderr\n",
      });
    } finally {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    }
  });

  it("TF-0205 the first exiting poll preserves the owner's failed status and terminal record", async () => {
    vi.useFakeTimers();
    const value = session();
    const tool = createProcessTool();
    const pending = tool.execute("timeout-poll", {
      action: "poll",
      sessionId: value.id,
      timeout: 1000,
    });
    // A timed-out command may handle its termination signal and still exit with code zero.
    markExited(value, 0, null, "failed", "overall-timeout");
    const terminal = getFinishedSession(value.id);
    await vi.advanceTimersByTimeAsync(250);
    expect((await pending).details).toMatchObject({ status: "failed", exitCode: 0 });
    expect(getFinishedSession(value.id)).toBe(terminal);
    expect(terminal?.exitReason).toBe("overall-timeout");
    expect(
      (
        await tool.execute("timeout-repeat", {
          action: "poll",
          sessionId: value.id,
        })
      ).details,
    ).toMatchObject({ status: "failed", exitCode: 0 });
  });

  it("TF-0206 a removed fallback process cannot reappear after its late exit callback", async () => {
    const value = session();
    value.pid = 4242;
    supervisor.getRecord.mockReturnValue(undefined);
    await createProcessTool().execute("remove-fallback", { action: "remove", sessionId: value.id });
    expect(getSession(value.id)).toBeUndefined();
    expect(getFinishedSession(value.id)).toBeUndefined();
    appendOutput(value, "stdout", "late output");
    markExited(value, null, "SIGKILL", "failed");
    expect(getFinishedSession(value.id)).toBeUndefined();
    const listed = await createProcessTool().execute("after-remove", { action: "list" });
    expect(listed.details).toMatchObject({ sessions: [] });
  });

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

  it("TF-0219 ignores a late duplicate exit notification", () => {
    const value = session();
    markExited(value, 1, null, "failed", "overall-timeout");
    const terminal = getFinishedSession(value.id);
    markExited(value, 0, null, "completed", "exit");
    expect(getFinishedSession(value.id)).toBe(terminal);
    expect(terminal).toMatchObject({
      status: "failed",
      exitCode: 1,
      exitReason: "overall-timeout",
    });
  });

  it("TF-0220 clears poll backoff when reading a finished session log", async () => {
    const value = session();
    const tool = createProcessTool();
    await tool.execute("seed-poll-backoff", { action: "poll", sessionId: value.id });
    expect(getDiagnosticSessionState({ sessionId: value.id }).commandPollCounts?.has(value.id)).toBe(
      true,
    );
    markExited(value, 1, null, "failed", "overall-timeout");
    await tool.execute("finished-log", { action: "log", sessionId: value.id });
    expect(getDiagnosticSessionState({ sessionId: value.id }).commandPollCounts?.has(value.id)).toBe(
      false,
    );
  });

  it("TF-0193 does not remove a foreground session", async () => {
    const value = session();
    value.backgrounded = false;
    supervisor.getRecord.mockReturnValue({ state: "running" });
    supervisor.cancel.mockReturnValue(true);
    const result = await createProcessTool().execute("remove-foreground", {
      action: "remove",
      sessionId: value.id,
    });
    expect(result.details).toMatchObject({ status: "failed" });
    const message = result.content[0];
    expect(message && message.type === "text" ? message.text : "").toContain("not backgrounded");
    expect(supervisor.cancel).not.toHaveBeenCalled();
    expect(getSession(value.id)).toBe(value);
  });

  it.each(["send-keys", "submit", "paste"] as const)(
    "TF-0194 aborted %s does not return success after stdin write",
    async (action) => {
      const value = session();
      const abort = new AbortController();
      const reason = new DOMException("operator cancelled", "AbortError");
      vi.mocked(value.stdin!.write).mockImplementation((_data, cb) => {
        abort.abort(reason);
        cb?.();
      });
      await expect(
        createProcessTool().execute(
          "cancel-input",
          {
            action,
            sessionId: value.id,
            keys: ["a"],
            text: "input",
            literal: "input",
          },
          abort.signal,
        ),
      ).rejects.toBe(reason);
    },
  );

  it("TF-0196 first poll observes an already-exited child without waiting", async () => {
    const value = session();
    value.child = {
      exitCode: 0,
      signalCode: null,
      pid: 4242,
      stdin: { destroy: vi.fn() },
      stdout: { destroy: vi.fn() },
      stderr: { destroy: vi.fn() },
      removeAllListeners: vi.fn(),
    } as unknown as ProcessSession["child"];
    const result = await createProcessTool().execute("exited-child", {
      action: "poll",
      sessionId: value.id,
      timeout: 0,
    });
    expect(result.details).toMatchObject({
      status: "completed",
      exitCode: 0,
    });
    expect(getSession(value.id)).toBeUndefined();
  });
});
