import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAllFactStores } from "../../../context-engine/factstore/store.js";
import { loadSessionStore, updateSessionStoreAtomic } from "../../../config/sessions.js";
import { closeOpenClawAgentDatabasesForTest } from "../../../state/openclaw-agent-db.js";
import { closeOpenClawStateDatabase } from "../../../state/openclaw-state-db.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetWorkspaceFactServiceRegistry } from "../../../context-engine/factstore/workspace-fact-service.js";
import {
  cleanupTempPaths,
  createContextEngineAttemptRunner,
  createContextEngineBootstrapAndAssemble,
  getHoisted,
  resetEmbeddedAttemptHarness,
  testModel,
} from "./attempt.spawn-workspace.test-support.js";
import type { AgentMessage } from "../../runtime/index.js";
import {
  repairToolUseResultPairing,
  stripToolResultDetails,
} from "../../session-transcript-repair.js";

const replay = vi.hoisted(() => vi.fn());
const historyRepair = vi.hoisted(() => vi.fn());
vi.mock("../replay-history.js", () => ({
  normalizeAssistantReplayContent: (messages: unknown[]) => messages,
  sanitizeSessionHistory: historyRepair,
  validateReplayTurns: async ({ messages }: { messages: unknown[] }) => messages,
}));
vi.mock("../../execution-phase/recovery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../execution-phase/recovery.js")>()),
  hasPersistedToolRecoveryAdmission: () => true,
  redispatchAdmittedSessionTools: replay,
}));

const tempPaths: string[] = [];
const hoisted = getHoisted();
beforeEach(() => {
  resetEmbeddedAttemptHarness();
  historyRepair
    .mockReset()
    .mockImplementation(async ({ messages }: { messages: unknown[] }) => messages);
  replay
    .mockReset()
    .mockImplementation(
      async (input: { context: { messages: unknown[] } }) => input.context.messages,
    );
  Object.assign(hoisted.sessionManager, { appendMessage: vi.fn() });
});
afterEach(async () => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabase();
  vi.unstubAllEnvs();
  __resetWorkspaceFactServiceRegistry();
  closeAllFactStores();
  await cleanupTempPaths(tempPaths);
});

const run = () =>
  createContextEngineAttemptRunner({
    contextEngine: createContextEngineBootstrapAndAssemble(),
    sessionKey: "agent:main:subagent:recovery-order",
    tempPaths,
    attemptOverrides: {
      disableTools: false,
    },
  });

describe("recovery through the actual embedded attempt", () => {
  it("keeps the admitted context projection when recovery leaves history unchanged", async () => {
    const contextEngine = createContextEngineBootstrapAndAssemble();
    const result = await createContextEngineAttemptRunner({
      contextEngine,
      sessionKey: "agent:main:subagent:unchanged-recovery",
      tempPaths,
      sessionMessages: [{ role: "user", content: "pending intent", timestamp: 1 }],
      attemptOverrides: { disableTools: false },
      sessionPrompt: async () => {},
    });
    if (result.promptError) throw result.promptError;
    expect(replay).toHaveBeenCalledTimes(1);
    expect(contextEngine.assemble).toHaveBeenCalledTimes(1);
  });
  it("runs a standalone helper transcript without requiring a Session owner row", async () => {
    const directory = await mkdtemp(join(tmpdir(), "standalone-main-helper-"));
    tempPaths.push(directory);
    vi.stubEnv("OPENCLAW_STATE_DIR", directory);
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    const prompt = vi.fn(async () => {});
    const result = await createContextEngineAttemptRunner({
      contextEngine: createContextEngineBootstrapAndAssemble(),
      sessionKey: "temp:slug-generator",
      tempPaths,
      sessionPrompt: prompt,
      attemptOverrides: { config: { session: { store: join(directory, "unused-sessions.json") } } },
    });
    expect(result.promptError).toBeNull();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(loadSessionStore(join(directory, "unused-sessions.json"), { skipCache: true })).toEqual(
      {},
    );
  });
  it("initializes main ownership for a local run before its guarded output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "local-main-output-"));
    tempPaths.push(directory);
    const storePath = join(directory, "sessions.json");
    const sessionKey = "agent:main:main";
    vi.stubEnv("OPENCLAW_STATE_DIR", directory);
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    await updateSessionStoreAtomic(storePath, (store) => {
      store[sessionKey] = { sessionId: "embedded-session", updatedAt: 1 };
    });
    const result = await createContextEngineAttemptRunner({
      contextEngine: createContextEngineBootstrapAndAssemble(),
      sessionKey,
      tempPaths,
      attemptOverrides: { config: { session: { store: storePath } }, sessionStorePath: storePath },
      sessionPrompt: async () => {
        const subscriptionParams = hoisted.subscribeEmbeddedAgentSessionMock.mock.calls[0][0];
        await subscriptionParams.onBeforeVisibleOutput?.();
        await subscriptionParams.onVisibleOutputObserved?.();
      },
    });
    expect(result.promptError).toBeNull();
    expect(loadSessionStore(storePath, { skipCache: true })[sessionKey]).toMatchObject({
      lifecycleRunId: "run-context-engine-forwarding",
      recoveryOutput: {
        runId: "run-context-engine-forwarding",
        effect: "unknown",
        visibleOutputObserved: true,
      },
    });
  });

  it("replays the original call before repairing Responses history", async () => {
    const user: AgentMessage = { role: "user", content: "original task", timestamp: 1 };
    const call: AgentMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "original-call",
          name: "read",
          arguments: { path: "original.txt" },
        },
      ],
      stopReason: "toolUse",
      api: "openai-responses",
      provider: "openai",
      model: "test",
      timestamp: 2,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const actual: AgentMessage = {
      role: "toolResult",
      toolCallId: "original-call",
      toolName: "read",
      content: [{ type: "text", text: "actual read result" }],
      isError: false,
      timestamp: 3,
    };
    historyRepair.mockImplementation(async ({ messages }: { messages: AgentMessage[] }) =>
      stripToolResultDetails(
        repairToolUseResultPairing(messages, { missingToolResultText: "aborted" }).messages,
      ),
    );
    replay.mockImplementation(async (input: { context: { messages: AgentMessage[] } }) => [
      ...input.context.messages,
      actual,
    ]);
    let submitted: unknown[] = [];
    const result = await createContextEngineAttemptRunner({
      contextEngine: createContextEngineBootstrapAndAssemble(),
      sessionKey: "agent:main:subagent:recovery-order",
      tempPaths,
      sessionMessages: [user, call],
      attemptOverrides: { disableTools: false, model: { ...testModel, api: "openai-responses" } },
      sessionPrompt: async (session) => {
        submitted = [...session.messages];
      },
    });
    expect(result.promptError).toBeNull();
    expect(replay.mock.calls[0][0].context.messages).toEqual([user, call]);
    expect(
      submitted.filter((message) => (message as AgentMessage).role === "toolResult"),
    ).toMatchObject([{ content: [{ text: "actual read result" }], isError: false }]);
  });

  it("counts the resumed answer after removing an interrupted assistant tail", async () => {
    const user: AgentMessage = { role: "user", content: "original task", timestamp: 1 };
    const partial: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "partial" }],
      stopReason: "aborted",
      api: "openai-completions",
      provider: "openai",
      model: "test",
      timestamp: 2,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const answer: AgentMessage = {
      ...partial,
      content: [{ type: "text", text: "resumed answer" }],
      stopReason: "stop",
      timestamp: 4,
      usage: { ...partial.usage, input: 10, cacheRead: 5, totalTokens: 15 },
    };
    replay.mockResolvedValue([user]);
    const afterTurn = vi.fn(async () => {});
    const result = await createContextEngineAttemptRunner({
      contextEngine: { ...createContextEngineBootstrapAndAssemble(), afterTurn },
      sessionKey: "agent:main:subagent:recovery-order",
      tempPaths,
      sessionMessages: [user, partial],
      sessionPrompt: async (session) => {
        session.messages.push(answer);
      },
    });
    expect(result.promptError).toBeNull();
    expect(afterTurn).toHaveBeenCalledWith(expect.objectContaining({ prePromptMessageCount: 1 }));
    expect(result.promptCache?.lastCallUsage).toMatchObject({ input: 10, cacheRead: 5 });
  });
  it.each(["block", "throw"])("does not replay before a run hook can %s", async (mode) => {
    const beforeRun = vi.fn(async () => {
      if (mode === "throw") throw new Error("blocked run fixture");
      return {
        decision: { outcome: "block", reason: "blocked run fixture" },
        pluginId: "recovery-test",
      };
    });
    hoisted.getGlobalHookRunnerMock.mockReturnValue({
      hasHooks: (name: string) => name === "before_agent_run",
      runBeforeAgentRun: beforeRun,
    });
    await run();
    expect(beforeRun).toHaveBeenCalledTimes(1);
    expect(replay).not.toHaveBeenCalled();
  });

  it("binds the supplied catalog executor before recovery invokes a catalog tool", async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: "text", text: "original read result" }],
      details: {},
    }));
    replay.mockImplementation(async (input: { context: { messages: unknown[] } }) => {
      const options = hoisted.createOpenClawCodingToolsMock.mock.calls[0][0] as {
        toolSearchCatalogExecutor: (params: unknown) => Promise<unknown>;
      };
      await options.toolSearchCatalogExecutor({
        toolName: "read",
        toolCallId: "nested-read",
        parentToolCallId: "outer-call",
        input: { path: "fixture.txt" },
        tool: { execute },
      });
      return input.context.messages;
    });
    await run();
    expect(replay).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
