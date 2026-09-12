import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDiagnosticSessionState,
  resetDiagnosticSessionStateForTest,
} from "../logging/diagnostic-session-state.js";
import {
  detectToolCallLoop,
  recordToolCall,
  recordToolCallOutcome,
} from "./tool-loop-detection.js";
import {
  wrapToolWithBeforeToolCallHook,
  type HookContext,
} from "./agent-tools.before-tool-call.js";
import type { AnyAgentTool } from "./tools/common.js";

const callbacks = vi.hoisted(() => ({ hook: vi.fn(), loop: vi.fn() }));
vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({ hasHooks: () => true, runBeforeToolCall: callbacks.hook }),
}));
vi.mock("./agent-tools.before-tool-call.runtime.js", () => ({
  beforeToolCallRuntime: {
    getDiagnosticSessionState,
    detectToolCallLoop,
    recordToolCall,
    recordToolCallOutcome,
    logToolLoopAction: callbacks.loop,
  },
}));

const result = { content: [{ type: "text" as const, text: "unchanged" }], details: {} };
function definition(execute: AnyAgentTool["execute"]): AnyAgentTool {
  return { name: "read", label: "read", description: "read", parameters: Type.Object({}), execute };
}
function context(): HookContext {
  return {
    sessionKey: "reliability",
    runId: "run-1",
    loopDetection: { warningThreshold: 2, criticalThreshold: 4, globalCircuitBreakerThreshold: 5 },
  };
}
afterEach(() => {
  callbacks.hook.mockReset();
  callbacks.loop.mockReset();
  resetDiagnosticSessionStateForTest();
});

describe("tool wrapper lifecycle", () => {
  it.each(["success", "failure"] as const)(
    "TF-0184 drops callbacks after terminal %s",
    async (outcome) => {
      let update: Parameters<AnyAgentTool["execute"]>[3];
      const error = new Error("tool failed");
      const tool = wrapToolWithBeforeToolCallHook(
        definition(async (_id, _args, _signal, onUpdate) => {
          update = onUpdate;
          onUpdate?.(result);
          if (outcome === "failure") throw error;
          return result;
        }),
      );
      const observer = vi.fn();
      const execution = tool.execute("terminal", {}, undefined, observer);
      if (outcome === "failure") await expect(execution).rejects.toBe(error);
      else await expect(execution).resolves.toBe(result);
      update?.(result);
      expect(observer).toHaveBeenCalledOnce();
    },
  );

  it.each(["veto", "failure"] as const)(
    "TF-0185 preserves abort when an awaited policy returns %s",
    async (outcome) => {
      const abort = new AbortController();
      const reason = new DOMException("operator cancelled", "AbortError");
      const execute = vi.fn(async () => result);
      callbacks.hook.mockImplementationOnce(async () => {
        abort.abort(reason);
        if (outcome === "failure") throw new Error("hook disconnected");
        return { block: true, blockReason: "policy veto" };
      });
      const tool = wrapToolWithBeforeToolCallHook(definition(execute), context());
      await expect(tool.execute("cancel-policy", {}, abort.signal)).rejects.toBe(reason);
      expect(execute).not.toHaveBeenCalled();
      expect(
        getDiagnosticSessionState({ sessionKey: "reliability" }).toolCallHistory?.some(
          (call) => call.resultHash,
        ),
      ).toBeFalsy();
    },
  );

  it("TF-0185 respects the post-compaction observer's termination before delivering success", async () => {
    const abort = new AbortController();
    const reason = new Error("post-compaction loop terminated");
    const tool = wrapToolWithBeforeToolCallHook(
      definition(async () => result),
      { ...context(), onToolOutcome: () => abort.abort(reason) },
    );
    await expect(tool.execute("outcome-abort", {}, abort.signal)).rejects.toBe(reason);
  });

  it("TF-0186 emits the first warning below ten calls and still throttles repeats", async () => {
    const tool = wrapToolWithBeforeToolCallHook(
      definition(async () => result),
      context(),
    );
    for (let i = 0; i < 5; i++) await tool.execute(`warning-${i}`, {});
    expect(
      callbacks.loop.mock.calls.map(([event]) => ({ level: event.level, count: event.count })),
    ).toEqual([
      { level: "warning", count: 2 },
      { level: "critical", count: 4 },
    ]);
  });

  it.each(["returned", "mutated"] as const)(
    "TF-0187 associates %s policy arguments with the original call",
    async (mode) => {
      callbacks.hook.mockImplementation(async (event: { params: Record<string, unknown> }) => {
        if (mode === "mutated") {
          event.params.path = "/workspace/file.txt";
          return undefined;
        }
        return { params: { path: "/workspace/file.txt" } };
      });
      const execute = vi.fn(async (_id: string, _args: unknown) => result);
      const tool = wrapToolWithBeforeToolCallHook(definition(execute), context());
      for (let i = 0; i < 4; i++) await tool.execute(`adjusted-${i}`, { path: "file.txt" });
      const blocked = await tool.execute("adjusted-stop", { path: "file.txt" });
      expect(blocked.details).toMatchObject({ status: "blocked", deniedReason: "tool-loop" });
      expect(execute).toHaveBeenCalledTimes(4);
      expect(execute.mock.calls[0]?.[1]).toEqual({ path: "/workspace/file.txt" });
      expect(getDiagnosticSessionState({ sessionKey: "reliability" }).toolCallHistory).toHaveLength(
        4,
      );
    },
  );
});
