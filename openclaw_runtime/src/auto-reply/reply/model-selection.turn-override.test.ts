import { expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { createModelSelectionState } from "./model-selection.js";
import {
  clearFollowupQueue,
  getFollowupQueue,
  refreshQueuedFollowupSession,
} from "./queue/state.js";
import type { FollowupRun } from "./queue/types.js";

it("keeps a one-turn choice separate from the stored choice and model allowlist", async () => {
  const cfg: OpenClawConfig = {
    agents: {
      defaults: {
        model: { primary: "scope/a" },
        models: { "scope/a": {}, "scope/b": {}, "scope/c": {} },
      },
    },
    models: {
      providers: {
        scope: {
          baseUrl: "http://127.0.0.1:9/v1",
          api: "openai-completions",
          models: ["a", "b", "c"].map((id) => ({
            id,
            name: id,
            reasoning: false,
            input: ["text"],
            contextWindow: 128000,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          })),
        },
      },
    },
  };
  const entry: SessionEntry = {
    sessionId: "scope-test",
    updatedAt: 1,
    providerOverride: "scope",
    modelOverride: "b",
    modelOverrideSource: "user",
  };
  const params = {
    cfg,
    agentCfg: cfg.agents!.defaults,
    sessionEntry: entry,
    sessionStore: { "agent:main:main": entry },
    sessionKey: "agent:main:main",
    defaultProvider: "scope",
    defaultModel: "a",
    provider: "scope",
    model: "c",
    hasModelDirective: false,
  };
  const selected = await createModelSelectionState({
    ...params,
    skipStoredModelOverride: true,
    preserveStoredModelOverride: true,
  });
  expect(selected.model).toBe("c");
  expect(entry.modelOverride).toBe("b");
  const next = await createModelSelectionState({ ...params, model: "a" });
  expect(next.model).toBe("b");
  const restricted = await createModelSelectionState({
    ...params,
    model: "denied",
    skipStoredModelOverride: true,
    preserveStoredModelOverride: true,
  });
  // Retain the existing visibility policy: an unavailable choice falls back
  // to an allowed model, never to the disallowed requested model.
  expect(restricted.model).toBe("a");
  expect(entry.modelOverride).toBe("b");
});

it("keeps queued turn choices while refreshing ordinary queued session choices", () => {
  const key = "agent:main:turn-model-queue-test";
  const makeRun = (hasTurnModelOverride: boolean): FollowupRun => ({
    prompt: "continue",
    enqueuedAt: 1,
    run: {
      agentId: "main",
      agentDir: "/agent",
      sessionId: "before",
      sessionFile: "/before.jsonl",
      workspaceDir: "/workspace",
      config: {},
      provider: "scope",
      model: "c",
      hasTurnModelOverride,
      timeoutMs: 1000,
      blockReplyBreak: "text_end",
    },
  });
  const queue = getFollowupQueue(key, { mode: "followup" });
  const turn = makeRun(true),
    ordinary = makeRun(false);
  queue.items.push(turn, ordinary);
  try {
    refreshQueuedFollowupSession({
      key,
      previousSessionId: "before",
      nextSessionId: "after",
      nextModel: "b",
    });
    expect(turn.run).toMatchObject({ sessionId: "after", model: "c" });
    expect(ordinary.run).toMatchObject({ sessionId: "after", model: "b" });
  } finally {
    clearFollowupQueue(key);
  }
});
