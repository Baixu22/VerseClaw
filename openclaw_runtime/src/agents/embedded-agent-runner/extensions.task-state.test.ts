/**
 * DCS Stage 2 task-state extension wiring tests.
 *
 * Verifies that buildEmbeddedExtensionFactories wires the task-state adapter:
 * - The factory sets the global TaskStateHandlerConfig so that
 *   runAgentHarnessTaskPhaseChangeHook can produce task_state Block writes.
 * - The factory registers a before_agent_start handler that restores child
 *   state for subagent sessions and is a no-op for main sessions.
 * - The factory is omitted when no sink/store is available.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, SessionManager } from "../sessions/index.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { BlockStoreApi, ContextBlockSink } from "../../context-engine/block.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import {
  clearTaskStateHandlerConfig,
  bindTaskStateHandlerConfigForRun,
  getTaskStateHandlerConfig,
  awaitAgentHarnessAgentEndHook,
  runAgentHarnessTaskPhaseChangeHook,
  setTaskStateHandlerConfig,
} from "../harness/lifecycle-hook-helpers.js";
import { buildEmbeddedExtensionFactories } from "./extensions.js";

type RegisteredHandler = (event: unknown, ctx: { cwd?: string }) => unknown;

beforeEach(() => {
  clearTaskStateHandlerConfig();
});

afterEach(() => {
  clearTaskStateHandlerConfig();
});

describe("DCS Stage 2 task-state extension wiring", () => {
  it("omits the task-state factory when no sink and no store are provided", () => {
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(baseFactoryParams(undefined))) {
      void factory(agent as unknown as ExtensionAPI);
    }
    // No before_agent_start handler should be registered from task-state
    // (the middleware factory registers tool_result only).
    expect(agent.handlers.before_agent_start ?? []).toHaveLength(0);
    expect(getTaskStateHandlerConfig()).toBeUndefined();
  });

  it("sets the global TaskStateHandlerConfig when a sink and store are provided", () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(
      baseFactoryParams(undefined, sink, store),
    )) {
      void factory(agent as unknown as ExtensionAPI);
    }

    const config = getTaskStateHandlerConfig();
    expect(config).toBeDefined();
    expect(config?.contextBlockSink).toBe(sink);
    expect(config?.workingMemoryStore).toBe(store);
  });

  it("registers a before_agent_start handler for subagent sessions that returns context_read instruction", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const restoreSpy = vi.fn(async () => undefined);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: restoreSpy as unknown as BlockStoreApi["query"],
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(
      baseFactoryParamsWithKey(undefined, sink, store, "agent:test-agent:subagent:abc-123"),
    )) {
      void factory(agent as unknown as ExtensionAPI);
    }

    const handlers = agent.handlers.before_agent_start ?? [];
    expect(handlers.length).toBeGreaterThanOrEqual(1);
    // Invoke the handler — should attempt restoreChildState (best-effort)
    const result = await handlers[0]?.(
      {
        type: "before_agent_start",
        prompt: "test",
        systemPrompt: "",
        systemPromptOptions: {} as never,
      },
      {},
    );
    // restoreChildState calls store.query; verify it was invoked
    expect(restoreSpy).toHaveBeenCalled();
    // The handler must return the fixed context_read instruction appended to systemPrompt
    expect(result).toMatchObject({
      systemPrompt: expect.stringContaining("context_read"),
    });
    // The instruction must NOT contain HandoffPack JSON, Block ids, or raw tool output
    const systemPrompt = (result as { systemPrompt?: string })?.systemPrompt ?? "";
    expect(systemPrompt).not.toContain('"objective"');
    expect(systemPrompt).not.toContain('"current_phase"');
    expect(systemPrompt).not.toContain('"recent_actions"');
    expect(systemPrompt).not.toContain('"parent_session_id"');
    expect(systemPrompt).not.toContain("task-state:");
  });

  it("before_agent_start is a no-op for main (non-subagent) sessions", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const restoreSpy = vi.fn(async () => []);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: restoreSpy as unknown as BlockStoreApi["query"],
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(
      baseFactoryParamsWithKey(undefined, sink, store, "agent:test-agent:main"),
    )) {
      void factory(agent as unknown as ExtensionAPI);
    }

    const handlers = agent.handlers.before_agent_start ?? [];
    // The factory may still register a handler, but it should be a no-op
    // for main sessions (no restoreChildState call).
    if (handlers.length > 0) {
      await handlers[0]?.(
        {
          type: "before_agent_start",
          prompt: "test",
          systemPrompt: "",
          systemPromptOptions: {} as never,
        },
        {},
      );
      expect(restoreSpy).not.toHaveBeenCalled();
    }
  });

  it("writes child HandoffPack before agent start when subagent + sink + parentSessionId + objective", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    const factories = buildEmbeddedExtensionFactories({
      ...baseFactoryParamsWithKey(undefined, sink, store, "agent:child:subagent:handoff-1"),
      objective: "Child task objective",
      parentSessionId: "agent:parent:main",
    });
    for (const factory of factories) {
      void factory(agent as unknown as ExtensionAPI);
    }

    // The sink should have been called to write the child HandoffPack
    // (parent writes before spawn). Wait a tick for the async write.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sink).toHaveBeenCalled();
    const sinkCall = (sink as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(sinkCall).toBeDefined();
    const writes = sinkCall?.[0] as readonly {
      block: { block_type: string; session_id: string };
    }[];
    expect(writes[0]?.block.block_type).toBe("task_state");
    expect(writes[0]?.block.session_id).toBe("agent:child:subagent:handoff-1");
  });

  it("sets trajectoryCapture in the config when provided", () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const trajectoryCapture = {
      start_trajectory: vi.fn(() => "traj-1"),
      log_step: vi.fn(),
      finish_trajectory: vi.fn(),
      extract_error_signature: vi.fn(() => "sig"),
      get_trajectory: vi.fn(),
      list_trajectories: vi.fn(() => []),
    };
    const agent = createAgentRecorder();
    const factories = buildEmbeddedExtensionFactories({
      ...baseFactoryParamsWithKey(undefined, sink, store, "agent:test:main"),
      trajectoryCapture: trajectoryCapture as never,
    });
    for (const factory of factories) {
      void factory(agent as unknown as ExtensionAPI);
    }

    const config = getTaskStateHandlerConfig();
    expect(config?.trajectoryCapture).toBe(trajectoryCapture);
  });

  it("keeps interleaved phase hooks bound to their own run scope", async () => {
    let releaseFirstHook!: () => void;
    const firstHookReady = new Promise<void>((resolve) => {
      releaseFirstHook = resolve;
    });
    const firstSink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const secondSink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const firstRunner = {
      hasHooks: () => true,
      runTaskPhaseChange: vi.fn(async () => firstHookReady),
    } as never;

    setTaskStateHandlerConfig(
      {
        runId: "run-first",
        sessionId: "session-first",
        contextBlockSink: firstSink,
        objective: "first objective",
      },
      { runId: "run-first", sessionId: "session-first" },
    );
    const firstPhase = runAgentHarnessTaskPhaseChangeHook({
      event: {
        sessionId: "session-first",
        taskId: "task-first",
        fromStatus: "running",
        toStatus: "verifying",
      },
      ctx: { runId: "run-first", sessionId: "session-first" },
      hookRunner: firstRunner,
    });

    // Register a second run while the first run is still inside its plugin
    // hook. A module-level singleton would select this second config for the
    // first phase after the await resumes.
    setTaskStateHandlerConfig(
      {
        runId: "run-second",
        sessionId: "session-second",
        contextBlockSink: secondSink,
        objective: "second objective",
      },
      { runId: "run-second", sessionId: "session-second" },
    );
    const secondPhase = runAgentHarnessTaskPhaseChangeHook({
      event: {
        sessionId: "session-second",
        taskId: "task-second",
        fromStatus: "running",
        toStatus: "verifying",
      },
      ctx: { runId: "run-second", sessionId: "session-second" },
    });
    await secondPhase;
    releaseFirstHook();
    await firstPhase;

    expect(firstSink).toHaveBeenCalledOnce();
    expect(secondSink).toHaveBeenCalledOnce();
    const firstCalls = (firstSink as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const secondCalls = (secondSink as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const firstBlock = (
      firstCalls[0]?.[0] as readonly { block: { full_content?: string } }[] | undefined
    )?.[0]?.block;
    const secondBlock = (
      secondCalls[0]?.[0] as readonly { block: { full_content?: string } }[] | undefined
    )?.[0]?.block;
    expect(JSON.parse(firstBlock?.full_content ?? "{}").objective).toBe("first objective");
    expect(JSON.parse(secondBlock?.full_content ?? "{}").objective).toBe("second objective");
  });

  it("clears only the terminal run scope and leaves a concurrent run registered", async () => {
    const firstSink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const secondSink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    setTaskStateHandlerConfig(
      { runId: "run-terminal", sessionId: "session-terminal", contextBlockSink: firstSink },
      { runId: "run-terminal", sessionId: "session-terminal" },
    );
    setTaskStateHandlerConfig(
      { runId: "run-live", sessionId: "session-live", contextBlockSink: secondSink },
      { runId: "run-live", sessionId: "session-live" },
    );

    await runAgentHarnessTaskPhaseChangeHook({
      event: {
        sessionId: "session-terminal",
        taskId: "task-terminal",
        fromStatus: "running",
        toStatus: "cancelled",
      },
      ctx: { runId: "run-terminal", sessionId: "session-terminal" },
    });

    expect(
      getTaskStateHandlerConfig({ runId: "run-terminal", sessionId: "session-terminal" }),
    ).toBeUndefined();
    expect(
      getTaskStateHandlerConfig({ runId: "run-live", sessionId: "session-live" })?.contextBlockSink,
    ).toBe(secondSink);
  });

  it("invalidates a stale scope when the next DCS initialization has no dependencies", async () => {
    const staleSink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    setTaskStateHandlerConfig(
      {
        runId: "run-reused",
        sessionId: "session-reused",
        contextBlockSink: staleSink,
        objective: "stale objective",
      },
      { runId: "run-reused", sessionId: "session-reused" },
    );

    for (const factory of buildEmbeddedExtensionFactories({
      ...baseFactoryParamsWithKey(undefined, undefined, undefined, "agent:reused:main"),
      runId: "run-reused",
      sessionKey: "session-reused",
    })) {
      void factory(createAgentRecorder() as unknown as ExtensionAPI);
    }

    await runAgentHarnessTaskPhaseChangeHook({
      event: {
        sessionId: "session-reused",
        taskId: "task-reused",
        fromStatus: "running",
        toStatus: "verifying",
      },
      ctx: { runId: "run-reused", sessionId: "session-reused" },
    });
    expect(staleSink).not.toHaveBeenCalled();
    expect(
      getTaskStateHandlerConfig({ runId: "run-reused", sessionId: "session-reused" }),
    ).toBeUndefined();
  });

  it("bridges an outer embedded run to the TaskLoop loopRunId", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    setTaskStateHandlerConfig(
      {
        runId: "embedded-attempt",
        sessionId: "agent:loop:main",
        contextBlockSink: sink,
        objective: "outer prompt",
      },
      { runId: "embedded-attempt", sessionId: "agent:loop:main" },
    );
    expect(
      bindTaskStateHandlerConfigForRun({
        runId: "loop-123",
        sessionId: "agent:loop:main",
        objective: "loop objective",
      }),
    ).toBe(true);

    await runAgentHarnessTaskPhaseChangeHook({
      event: {
        sessionId: "agent:loop:main",
        taskId: "loop-123",
        fromStatus: "running",
        toStatus: "completed",
      },
      ctx: { runId: "loop-123", sessionId: "agent:loop:main" },
    });

    expect(sink).toHaveBeenCalledOnce();
    const calls = (sink as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const block = (
      calls[0]?.[0] as readonly { block: { full_content?: string } }[] | undefined
    )?.[0]?.block;
    expect(JSON.parse(block?.full_content ?? "{}").objective).toBe("loop objective");
    expect(
      getTaskStateHandlerConfig({ runId: "loop-123", sessionId: "agent:loop:main" }),
    ).toBeUndefined();
  });

  it("fails closed when two outer runs share a session", () => {
    const sinkA: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const sinkB: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    setTaskStateHandlerConfig(
      { runId: "embedded-a", sessionId: "agent:shared:main", contextBlockSink: sinkA },
      { runId: "embedded-a", sessionId: "agent:shared:main" },
    );
    setTaskStateHandlerConfig(
      { runId: "embedded-b", sessionId: "agent:shared:main", contextBlockSink: sinkB },
      { runId: "embedded-b", sessionId: "agent:shared:main" },
    );
    expect(
      bindTaskStateHandlerConfigForRun({ runId: "loop-ambiguous", sessionId: "agent:shared:main" }),
    ).toBe(false);
  });

  it("clears the outer run and loop aliases at agent_end", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    setTaskStateHandlerConfig(
      {
        runId: "embedded-owner",
        ownerRunId: "embedded-owner",
        sessionId: "agent:end:main",
        contextBlockSink: sink,
      },
      { runId: "embedded-owner", sessionId: "agent:end:main" },
    );
    expect(
      bindTaskStateHandlerConfigForRun({ runId: "loop-owned", sessionId: "agent:end:main" }),
    ).toBe(true);
    await awaitAgentHarnessAgentEndHook({
      event: { runId: "embedded-owner", messages: [], success: true },
      ctx: { runId: "embedded-owner", sessionId: "agent:end:main" },
      hookRunner: { hasHooks: () => false } as never,
    });
    expect(
      getTaskStateHandlerConfig({ runId: "embedded-owner", sessionId: "agent:end:main" }),
    ).toBeUndefined();
    expect(
      getTaskStateHandlerConfig({ runId: "loop-owned", sessionId: "agent:end:main" }),
    ).toBeUndefined();
  });
});

function createAgentRecorder() {
  const handlers: Record<string, RegisteredHandler[]> = {};
  return {
    handlers,
    get events() {
      return Object.keys(handlers);
    },
    on(event: string, handler: RegisteredHandler) {
      handlers[event] ??= [];
      handlers[event]?.push(handler);
      return Promise.resolve();
    },
  };
}

function baseFactoryParams(
  cfg: OpenClawConfig | undefined,
  contextBlockSink?: ContextBlockSink,
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">,
): {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  workspaceDir: string;
  provider: string;
  modelId: string;
  model: ProviderRuntimeModel | undefined;
  sessionId: string;
  sessionKey: string;
  contextBlockSink?: ContextBlockSink;
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">;
} {
  return {
    cfg,
    sessionManager: {} as SessionManager,
    workspaceDir: "C:/repo",
    provider: "openai",
    modelId: "gpt-test",
    model: undefined,
    sessionId: "runtime-session-id",
    sessionKey: "agent:alpha:main",
    contextBlockSink,
    workingMemoryStore,
  };
}

function baseFactoryParamsWithKey(
  cfg: OpenClawConfig | undefined,
  contextBlockSink: ContextBlockSink | undefined,
  workingMemoryStore: Pick<BlockStoreApi, "query" | "upsert"> | undefined,
  sessionKey: string,
): {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  workspaceDir: string;
  provider: string;
  modelId: string;
  model: ProviderRuntimeModel | undefined;
  sessionId: string;
  sessionKey: string;
  contextBlockSink?: ContextBlockSink;
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">;
} {
  return {
    ...baseFactoryParams(cfg, contextBlockSink, workingMemoryStore),
    sessionKey,
  };
}
