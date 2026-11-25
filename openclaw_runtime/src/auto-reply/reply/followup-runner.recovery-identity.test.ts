import { afterEach, expect, it, vi } from "vitest";
import { enqueueFollowupRun, clearFollowupQueue } from "./queue.js";
import { getExistingFollowupQueue } from "./queue/state.js";
import { createReplyOperation } from "./reply-run-registry.js";
import type { FollowupRun } from "./queue.js";

const mocks = vi.hoisted(() => ({ embedded: vi.fn() }));
vi.mock("../../agents/embedded-agent.js", () => ({ runEmbeddedAgent: mocks.embedded }));
vi.mock("../../agents/harness/runtime-plugin.js", () => ({
  ensureSelectedAgentHarnessPlugin: async () => {},
}));
vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: async (params: {
    provider: string;
    model: string;
    run: (provider: string, model: string) => Promise<unknown>;
  }) => ({
    result: await params.run(params.provider, params.model),
    provider: params.provider,
    model: params.model,
    attempts: [],
  }),
}));
vi.mock("../../agents/model-selection-cli.js", () => ({ isCliProvider: () => false }));
vi.mock("./reply-turn-admission.js", () => ({
  admitReplyTurn: async (params: { sessionKey: string; sessionId: string }) => ({
    status: "owned",
    operation: createReplyOperation({ ...params, resetTriggered: false }),
  }),
}));
vi.mock("./session-run-accounting.js", () => ({
  persistRunSessionUsage: async () => {},
  incrementRunCompactionCount: async () => 1,
}));

import { createFollowupRunner } from "./followup-runner.js";

const key = "agent:main:queued-compaction";
afterEach(() => {
  mocks.embedded.mockReset();
  clearFollowupQueue(key);
});

it("refreshes waiting follow-ups and reply ownership before adopting the compaction successor", async () => {
  const current: FollowupRun = {
    prompt: "request",
    enqueuedAt: Date.now(),
    run: {
      sessionKey: key,
      sessionId: "predecessor",
      sessionFile: "D:/tmp/predecessor.jsonl",
      messageProvider: "webchat",
      agentId: "main",
      agentDir: "D:/tmp/agent",
      workspaceDir: "D:/tmp",
      config: {},
      provider: "fixture",
      model: "fixture-model",
      timeoutMs: 1000,
      blockReplyBreak: "message_end",
    },
  };
  const waiting: FollowupRun = { ...current, run: { ...current.run } };
  waiting.prompt = "waiting request";
  enqueueFollowupRun(key, waiting, { mode: "followup", debounceMs: 0 }, "none");
  const owner = { sessionId: "successor", sessionFile: "D:/tmp/successor.jsonl", updatedAt: 1 };
  mocks.embedded.mockImplementationOnce(async (params) => {
    await params.onSessionIdentityChanged({
      sessionId: "successor",
      sessionFile: owner.sessionFile,
    });
    expect(getExistingFollowupQueue(key)?.items[0].run).toMatchObject({
      sessionId: "successor",
      sessionFile: owner.sessionFile,
    });
    expect(params.replyOperation.sessionId).toBe("successor");
    return {
      payloads: [],
      meta: {
        agentMeta: { sessionId: "successor", sessionFile: owner.sessionFile },
        durationMs: 1,
      },
    };
  });
  const runner = createFollowupRunner({
    typing: { cleanup: () => {}, markRunComplete: () => {}, markDispatchIdle: () => {} } as never,
    typingMode: "never",
    sessionKey: key,
    sessionStore: { [key]: owner },
    defaultModel: "fixture",
  });
  await runner(current);
  expect(mocks.embedded).toHaveBeenCalledOnce();
  expect(getExistingFollowupQueue(key)?.items[0].run.sessionId).toBe("successor");
});
