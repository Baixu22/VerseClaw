import { getEventListeners } from "node:events";
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
import { toClientToolDefinitions, toToolDefinitions } from "./agent-tool-definition-adapter.js";
import {
  requestDeferredPluginToolApproval,
  runBeforeToolCallHook,
  wrapToolWithBeforeToolCallHook,
  type HookContext,
} from "./agent-tools.before-tool-call.js";
import type { AnyAgentTool } from "./tools/common.js";

const callbacks = vi.hoisted(() => ({
  hook: vi.fn(),
  loop: vi.fn(),
  gateway: vi.fn(),
  trusted: vi.fn(),
  trustedEnabled: false,
}));
vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({ hasHooks: () => true, runBeforeToolCall: callbacks.hook }),
}));
vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: (...args: unknown[]) => callbacks.gateway(...args),
}));
vi.mock("../plugins/trusted-tool-policy.js", () => ({
  hasTrustedToolPolicies: () => callbacks.trustedEnabled,
  getTrustedToolPolicyDiagnosticEntries: () => [],
  runTrustedToolPolicies: (...args: unknown[]) => callbacks.trusted(...args),
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
  callbacks.gateway.mockReset();
  callbacks.trusted.mockReset();
  callbacks.trustedEnabled = false;
  resetDiagnosticSessionStateForTest();
});

describe("tool wrapper lifecycle", () => {
  it.each(["trusted", "hook"] as const)(
    "TF-0209 cancels a pending %s policy without waiting for its late rejection",
    async (phase) => {
      const abort = new AbortController();
      const reason = new Error("cancel pending policy");
      let rejectPolicy!: (error: Error) => void;
      const policy = new Promise<never>((_resolve, reject) => {
        rejectPolicy = reject;
      });
      const callback = phase === "trusted" ? callbacks.trusted : callbacks.hook;
      callbacks.trustedEnabled = phase === "trusted";
      callback.mockReturnValueOnce(policy);
      const execute = vi.fn(async () => result);
      const tool = wrapToolWithBeforeToolCallHook(definition(execute), context());
      const pending = tool.execute("pending-policy", {}, abort.signal);
      const settled = vi.fn();
      void pending.then(settled, settled);
      await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
      abort.abort(reason);
      try {
        await vi.waitFor(() => expect(settled).toHaveBeenCalledWith(reason), { timeout: 200 });
      } finally {
        rejectPolicy(new Error("late policy failure"));
      }
      await expect(pending).rejects.toBe(reason);
      expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
      expect(execute).not.toHaveBeenCalled();
      expect(callbacks.gateway).not.toHaveBeenCalled();
      if (phase === "trusted") expect(callbacks.hook).not.toHaveBeenCalled();
    },
  );

  it.each(["wrapper", "adapter"] as const)(
    "TF-0210 cancels a pending %s preparation before it resolves",
    async (entry) => {
      const abort = new AbortController();
      const reason = new Error("cancel pending preparation");
      let release!: () => void;
      const prepare = vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            release = () => resolve({ path: "prepared.txt" });
          }),
      );
      const execute = vi.fn(async () => result);
      const tool = { ...definition(execute), prepareBeforeToolCallParams: prepare };
      const wrapped =
        entry === "wrapper"
          ? wrapToolWithBeforeToolCallHook(tool, context())
          : toToolDefinitions([tool], context())[0];
      const pending = (wrapped.execute as AnyAgentTool["execute"])(
        "pending-prepare",
        {},
        abort.signal,
      );
      const settled = vi.fn();
      void pending.then(settled, settled);
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
      abort.abort(reason);
      try {
        await vi.waitFor(() => expect(settled).toHaveBeenCalledWith(reason), { timeout: 200 });
      } finally {
        release();
      }
      await expect(pending).rejects.toBe(reason);
      expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
      expect(callbacks.hook).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );

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

  it("TF-0189 rethrows abort instead of converting a hook throw into a block", async () => {
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    callbacks.hook.mockImplementationOnce(async () => {
      abort.abort(reason);
      throw reason;
    });
    await expect(
      runBeforeToolCallHook({
        toolName: "read",
        params: {},
        ctx: context(),
        signal: abort.signal,
      }),
    ).rejects.toBe(reason);
  });

  it("TF-0190 rethrows abort while waiting for plugin approval", async () => {
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    callbacks.hook.mockImplementationOnce(async () => ({
      requireApproval: {
        pluginId: "test-plugin",
        title: "Approve read",
        description: "Approval required",
      },
    }));
    callbacks.gateway.mockImplementation((method: string) => {
      if (method === "plugin.approval.request") {
        return Promise.resolve({ id: "approval-1" });
      }
      return new Promise(() => {});
    });
    const pending = runBeforeToolCallHook({
      toolName: "read",
      params: { path: "file.txt" },
      ctx: context(),
      signal: abort.signal,
    });
    await vi.waitFor(() =>
      expect(
        callbacks.gateway.mock.calls.some(([method]) => method === "plugin.approval.waitDecision"),
      ).toBe(true),
    );
    abort.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(callbacks.gateway).toHaveBeenCalledWith(
      "plugin.approval.request",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("TF-0191 adapter forwards abort into before_tool_call and does not execute", async () => {
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    const execute = vi.fn(async () => result);
    callbacks.hook.mockImplementationOnce(async () => {
      abort.abort(reason);
      return undefined;
    });
    const [adapted] = toToolDefinitions([definition(execute)], context());
    const adaptedTool = adapted as typeof adapted & {
      execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<unknown>;
    };
    await expect(adaptedTool.execute("adapter-abort", {}, abort.signal)).rejects.toBe(reason);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TF-0198 observer errors do not convert a successful tool result into failure", async () => {
    const tool = wrapToolWithBeforeToolCallHook(
      definition(async () => result),
      {
        ...context(),
        onToolOutcome: () => {
          throw new Error("observer closed");
        },
      },
    );
    await expect(tool.execute("observer-throw", {})).resolves.toBe(result);
  });

  it("TF-0199 cancelled adapters never prepare or execute an unwrapped tool", async () => {
    const abort = new AbortController();
    abort.abort(new Error("cancel before preparation"));
    const prepare = vi.fn(async (args: unknown) => args);
    const execute = vi.fn(async () => result);
    const [adapted] = toToolDefinitions([
      { ...definition(execute), prepareBeforeToolCallParams: prepare } as AnyAgentTool,
    ]);
    await expect(
      (adapted.execute as AnyAgentTool["execute"])("adapter-pre-abort", {}, abort.signal),
    ).rejects.toBe(abort.signal.reason);
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"] as const)(
    "TF-0199 adapter cancellation owns a late %s and closes progress",
    async (outcome) => {
      const abort = new AbortController();
      const reason = new Error("cancel during execution");
      const observer = vi.fn();
      let update: Parameters<AnyAgentTool["execute"]>[3];
      const [adapted] = toToolDefinitions([
        definition(async (_id, _args, _signal, onUpdate) => {
          update = onUpdate;
          onUpdate?.(result);
          abort.abort(reason);
          onUpdate?.(result);
          if (outcome === "failure") throw new Error("late transport error");
          return result;
        }),
      ]);
      await expect(
        (adapted.execute as AnyAgentTool["execute"])("adapter-late", {}, abort.signal, observer),
      ).rejects.toBe(reason);
      update?.(result);
      expect(observer).toHaveBeenCalledOnce();
    },
  );

  it.each(["success", "failure"] as const)(
    "TF-0199 adapter closes progress after uncancelled %s",
    async (outcome) => {
      let update: Parameters<AnyAgentTool["execute"]>[3];
      const observer = vi.fn();
      const [adapted] = toToolDefinitions([
        definition(async (_id, _args, _signal, onUpdate) => {
          update = onUpdate;
          onUpdate?.(result);
          if (outcome === "failure") throw new Error("ordinary failure");
          return result;
        }),
      ]);
      const value = await (adapted.execute as AnyAgentTool["execute"])(
        "adapter-terminal",
        {},
        undefined,
        observer,
      );
      expect(value.details).toEqual(
        outcome === "success" ? {} : expect.objectContaining({ status: "error" }),
      );
      update?.(result);
      expect(observer).toHaveBeenCalledOnce();
    },
  );

  it.each(["before", "reserve", "complete"] as const)(
    "TF-0200 client delegation cancellation at %s leaves no pending handoff",
    async (phase) => {
      const abort = new AbortController();
      const reason = new Error("client delegation cancelled");
      const recorder = {
        reserve: vi.fn(() => {
          if (phase === "reserve") abort.abort(reason);
        }),
        complete: vi.fn(() => {
          if (phase === "complete") abort.abort(reason);
        }),
        discard: vi.fn(),
      };
      if (phase === "before") abort.abort(reason);
      const [adapted] = toClientToolDefinitions(
        [
          {
            type: "function",
            function: { name: "client_read", description: "read", parameters: { type: "object" } },
          },
        ],
        recorder,
      );
      await expect(
        (adapted.execute as AnyAgentTool["execute"])("client-cancel", {}, abort.signal),
      ).rejects.toBe(reason);
      expect(recorder.reserve).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
      expect(recorder.complete).toHaveBeenCalledTimes(phase === "complete" ? 1 : 0);
      expect(recorder.discard).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
    },
  );

  it("TF-0201 cancels plugin registration without waiting for a gateway response", async () => {
    const abort = new AbortController();
    const reason = new Error("cancel while registering");
    let resolveRequest!: (value: { id: string; decision: string }) => void;
    const request = new Promise<{ id: string; decision: string }>((resolve) => {
      resolveRequest = resolve;
    });
    callbacks.gateway.mockReturnValue(request);
    const onResolution = vi.fn();
    const pending = requestDeferredPluginToolApproval({
      signal: abort.signal,
      deferredApproval: {
        toolName: "read",
        baseParams: {},
        approval: {
          pluginId: "test-plugin",
          title: "Read",
          description: "Approve reading",
          onResolution,
        },
      },
    });
    const settled = vi.fn();
    void pending.then(settled, settled);
    abort.abort(reason);
    try {
      await vi.waitFor(() => expect(settled).toHaveBeenCalledWith(reason), { timeout: 150 });
    } finally {
      resolveRequest({ id: "late-approval", decision: "allow-once" });
    }
    await expect(pending).rejects.toBe(reason);
    expect(onResolution).toHaveBeenCalledExactlyOnceWith("cancelled");
    expect(callbacks.gateway).toHaveBeenCalledOnce();
  });

  it("TF-0201 pre-cancelled deferred approval never registers", async () => {
    const abort = new AbortController();
    abort.abort(new Error("already cancelled"));
    callbacks.gateway.mockResolvedValue({ id: "approval", decision: "allow-once" });
    const onResolution = vi.fn();
    await expect(
      requestDeferredPluginToolApproval({
        signal: abort.signal,
        deferredApproval: {
          toolName: "read",
          baseParams: {},
          approval: {
            pluginId: "test-plugin",
            title: "Read",
            description: "Approve reading",
            onResolution,
          },
        },
      }),
    ).rejects.toBe(abort.signal.reason);
    expect(callbacks.gateway).not.toHaveBeenCalled();
    expect(onResolution).toHaveBeenCalledExactlyOnceWith("cancelled");
  });

  it("TF-0201 cancellation wins over an immediate late approval", async () => {
    const abort = new AbortController();
    const reason = new Error("cancel registration");
    const onResolution = vi.fn();
    callbacks.gateway.mockImplementationOnce(async () => {
      abort.abort(reason);
      return { id: "approval", decision: "allow-once" };
    });
    await expect(
      requestDeferredPluginToolApproval({
        signal: abort.signal,
        deferredApproval: {
          toolName: "read",
          baseParams: {},
          approval: {
            pluginId: "test-plugin",
            title: "Read",
            description: "Approve reading",
            onResolution,
          },
        },
      }),
    ).rejects.toBe(reason);
    expect(onResolution).toHaveBeenCalledExactlyOnceWith("cancelled");
  });

  it.each(["allow", "veto"] as const)(
    "TF-0202 cancellation after trusted policy %s stops the hook chain",
    async (decision) => {
      callbacks.trustedEnabled = true;
      const abort = new AbortController();
      const reason = new Error("cancel during trusted policy");
      callbacks.trusted.mockImplementationOnce(async () => {
        abort.abort(reason);
        return decision === "veto" ? { block: true } : undefined;
      });
      await expect(
        runBeforeToolCallHook({
          toolName: "read",
          params: {},
          signal: abort.signal,
        }),
      ).rejects.toBe(reason);
      expect(callbacks.hook).not.toHaveBeenCalled();
      expect(callbacks.gateway).not.toHaveBeenCalled();
    },
  );

  it("TF-0202 a successful hook cannot return allowed after cancelling its run", async () => {
    const abort = new AbortController();
    const reason = new Error("cancel during hook");
    callbacks.hook.mockImplementationOnce(async () => {
      abort.abort(reason);
      return undefined;
    });
    await expect(
      runBeforeToolCallHook({
        toolName: "read",
        params: {},
        signal: abort.signal,
      }),
    ).rejects.toBe(reason);
  });
});
