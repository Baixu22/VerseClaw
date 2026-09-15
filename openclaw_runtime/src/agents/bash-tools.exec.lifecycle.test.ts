import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bash-tools.exec-host-gateway.js", () => ({
  processGatewayAllowlist: vi.fn(async () => ({})),
}));

import { createExecTool } from "./bash-tools.exec.js";
import { processGatewayAllowlist } from "./bash-tools.exec-host-gateway.js";
import * as runtime from "./bash-tools.exec-runtime.js";

const completed: runtime.ExecProcessOutcome = {
  status: "completed",
  exitCode: 0,
  exitSignal: null,
  durationMs: 100,
  aggregated: "done",
  timedOut: false,
};

function pendingProcess() {
  let finish!: (outcome: runtime.ExecProcessOutcome) => void;
  const promise = new Promise<runtime.ExecProcessOutcome>((resolve) => {
    finish = resolve;
  });
  const handle: runtime.ExecProcessHandle = {
    session: {
      id: "foreground-lifecycle",
      command: "echo done",
      startedAt: Date.now(),
      cwd: process.cwd(),
      maxOutputChars: 1000,
      pendingMaxOutputChars: 1000,
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
    },
    startedAt: Date.now(),
    promise,
    kill: vi.fn(),
    disableUpdates: vi.fn(),
  };
  return { handle, finish: () => finish(completed) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENCLAW_EXEC_FOREGROUND_HEARTBEAT_MS", "1000");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(processGatewayAllowlist).mockReset().mockResolvedValue({});
});

describe("foreground exec lifecycle", () => {
  it.each([true, false])("only backgrounds an active process (cancelled=%s)", async (cancelled) => {
    const processRun = pendingProcess();
    const spawn = vi.spyOn(runtime, "runExecProcess").mockResolvedValue(processRun.handle);
    const abort = new AbortController();
    const tool = createExecTool({
      host: "gateway",
      security: "full",
      ask: "off",
      allowBackground: true,
      backgroundMs: 1000,
    });
    const result = tool.execute("yield-lifecycle", { command: "echo done" }, abort.signal);
    try {
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
      if (cancelled) abort.abort();
      await vi.advanceTimersByTimeAsync(1500);
      expect(processRun.handle.session.backgrounded).toBe(!cancelled);
      expect(processRun.handle.kill).toHaveBeenCalledTimes(cancelled ? 1 : 0);
    } finally {
      processRun.finish();
      await result;
    }
  });

  it.each(["before-call", "during-preflight"] as const)(
    "does not spawn when cancelled %s",
    async (phase) => {
      const processRun = pendingProcess();
      processRun.finish();
      const spawn = vi.spyOn(runtime, "runExecProcess").mockResolvedValue(processRun.handle);
      const abort = new AbortController();
      const reason = new DOMException("operator cancelled", "AbortError");
      if (phase === "before-call") {
        abort.abort(reason);
      } else {
        vi.mocked(processGatewayAllowlist).mockImplementationOnce(async () => {
          abort.abort(reason);
          return {};
        });
      }
      const tool = createExecTool({
        host: "gateway",
        security: "full",
        ask: "off",
        allowBackground: false,
      });
      await expect(tool.execute("cancelled", { command: "echo done" }, abort.signal)).rejects.toBe(
        reason,
      );
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each(["abort", "exit"] as const)(
    "stops heartbeats immediately on %s before cleanup settles",
    async (event) => {
      const processRun = pendingProcess();
      const spawn = vi.spyOn(runtime, "runExecProcess").mockResolvedValue(processRun.handle);
      const abort = new AbortController();
      const update = vi.fn();
      const tool = createExecTool({
        host: "gateway",
        security: "full",
        ask: "off",
        allowBackground: false,
      });
      const result = tool.execute("lifecycle", { command: "echo done" }, abort.signal, update);
      try {
        await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(1000);
        expect(update).toHaveBeenCalled();
        update.mockClear();
        if (event === "abort") {
          abort.abort();
          expect(processRun.handle.disableUpdates).toHaveBeenCalledOnce();
          expect(processRun.handle.kill).toHaveBeenCalledOnce();
        } else {
          processRun.handle.session.exited = true;
        }
        await vi.advanceTimersByTimeAsync(2000);
        expect(update).not.toHaveBeenCalled();
      } finally {
        processRun.finish();
        await result;
      }
      await vi.advanceTimersByTimeAsync(2000);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("keeps waiting when a heartbeat consumer throws", async () => {
    const processRun = pendingProcess();
    const spawn = vi.spyOn(runtime, "runExecProcess").mockResolvedValue(processRun.handle);
    const update = vi.fn(() => {
      throw new Error("consumer closed");
    });
    const tool = createExecTool({
      host: "gateway",
      security: "full",
      ask: "off",
      allowBackground: false,
    });
    const result = tool.execute("heartbeat-throw", { command: "echo done" }, undefined, update);
    try {
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(1000);
      expect(update).toHaveBeenCalled();
      processRun.finish();
      await expect(result).resolves.toMatchObject({
        details: { status: "completed" },
      });
    } finally {
      processRun.finish();
      await result.catch(() => undefined);
    }
  });

  it.each([-10, 0, Number.NaN, Number.POSITIVE_INFINITY])(
    "TF-0222 falls back to the default timeout for invalid explicit timeout %s",
    async (timeout) => {
      const processRun = pendingProcess();
      const spawn = vi.spyOn(runtime, "runExecProcess").mockResolvedValue(processRun.handle);
      const tool = createExecTool({
        host: "gateway",
        security: "full",
        ask: "off",
        allowBackground: false,
      });
      const result = tool.execute("invalid-timeout", { command: "echo done", timeout }, undefined);
      try {
        await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
        expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ timeoutSec: 1800 }));
        processRun.finish();
        await expect(result).resolves.toMatchObject({ details: { status: "completed" } });
      } finally {
        processRun.finish();
        await result.catch(() => undefined);
      }
    },
  );
});
