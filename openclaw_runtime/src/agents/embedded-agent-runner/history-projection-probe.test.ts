/**
 * Upstream protocol adaptation probe — cross-protocol history projection evidence.
 *
 * Characterization probes for what actually survives a model / protocol switch:
 * transcript-level projection on the next attempt (S1/S2), tool-id rewriting across
 * protocols, and compaction replay. Companion to
 * `src/agents/upstream-protocol-cache-probe.test.ts` (transport-level payload evidence).
 *
 * The follow-up work these probes feed (projection criteria by source attribution, and a
 * per-switch discard report) has no task spec yet; `PROBE B` is its measuring stick
 * until then, the same role `PROBE A` played for
 * `harness/specs/tasks/openai-prompt-cache-write-point.md`.
 *
 * These probes call the real `sanitizeSessionHistory` pipeline with provider plugin
 * participation disabled, which is what a plugin-less runtime does. Image sanitization
 * is reduced to identity so the probe stays about reasoning state, not media.
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "../runtime/index.js";
import type { SessionManager } from "../sessions/index.js";

vi.mock("../embedded-agent-helpers.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../embedded-agent-helpers.js");
  return {
    ...actual,
    sanitizeSessionMessagesImages: vi.fn(async (messages: unknown) => messages),
  };
});

vi.mock("../../plugins/provider-hook-runtime.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "../../plugins/provider-hook-runtime.js",
  );
  return {
    ...actual,
    // transcript-policy.ts resolves the replay policy through this module.
    resolveProviderRuntimePlugin: vi.fn(() => undefined),
    resolveProviderHookPlugin: vi.fn(() => undefined),
    resolveProviderPluginsForHooks: vi.fn(() => []),
  };
});

vi.mock("../../plugins/provider-runtime.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../plugins/provider-runtime.js");
  return {
    ...actual,
    // No provider plugin participates: ownership boundaries stay explicit.
    resolveProviderRuntimePlugin: vi.fn(() => undefined),
    sanitizeProviderReplayHistoryWithPlugin: vi.fn(() => undefined),
    validateProviderReplayTurnsWithPlugin: vi.fn(() => undefined),
  };
});

const { sanitizeSessionHistory } = await import("./replay-history.js");

const TEST_SESSION_ID = "probe-session";
const SIGNED_THINKING = "signed-thinking-blob-aaaa";
const NEXT_SIGNED_THINKING = "signed-thinking-blob-bbbb";

type CustomEntry = { type: string; customType: string; data: unknown };

function makeSessionManager(entries: CustomEntry[] = []): SessionManager {
  return {
    getEntries: () => entries,
    appendCustomEntry: (customType: string, data: unknown) => {
      entries.push({ type: "custom", customType, data });
    },
  } as unknown as SessionManager;
}

function makeModelSnapshot(provider: string, modelApi: string, modelId: string): CustomEntry {
  return {
    type: "custom",
    customType: "model-snapshot",
    data: { timestamp: Date.now(), provider, modelApi, modelId },
  };
}

/** Anthropic-shaped assistant turn: signed thinking + a tool call, then its result. */
function makeAnthropicHistory(): AgentMessage[] {
  return [
    { role: "user", content: "summarise the log", timestamp: 1 },
    {
      role: "assistant",
      timestamp: 2,
      content: [
        { type: "thinking", thinking: "internal reasoning", thinkingSignature: SIGNED_THINKING },
        { type: "text", text: "reading the log" },
        { type: "toolCall", id: "toolu_probe_1", name: "read_log", arguments: { path: "/tmp/log" } },
      ],
    },
    {
      role: "toolResult",
      timestamp: 3,
      toolCallId: "toolu_probe_1",
      toolName: "read_log",
      content: [{ type: "text", text: "log line" }],
      isError: false,
    },
    { role: "user", content: "and the cause?", timestamp: 4 },
  ] as unknown as AgentMessage[];
}

function findAssistant(messages: AgentMessage[]): Record<string, unknown> | undefined {
  return messages.find(
    (message) => (message as { role?: unknown }).role === "assistant",
  ) as Record<string, unknown> | undefined;
}

function thinkingSignatureOf(messages: AgentMessage[]): unknown {
  const assistant = findAssistant(messages);
  const content = assistant?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const thinking = content.find(
    (block) => (block as { type?: unknown })?.type === "thinking",
  ) as Record<string, unknown> | undefined;
  return thinking?.thinkingSignature;
}

function thinkingBlockCount(messages: AgentMessage[]): number {
  const assistant = findAssistant(messages);
  const content = assistant?.content;
  if (!Array.isArray(content)) {
    return 0;
  }
  return content.filter((block) => (block as { type?: unknown })?.type === "thinking").length;
}

async function project(params: {
  messages: AgentMessage[];
  modelApi: string;
  provider: string;
  modelId: string;
  sessionManager: SessionManager;
}): Promise<AgentMessage[]> {
  return await sanitizeSessionHistory({
    messages: params.messages,
    modelApi: params.modelApi,
    provider: params.provider,
    modelId: params.modelId,
    sessionManager: params.sessionManager,
    sessionId: TEST_SESSION_ID,
  });
}

describe("PROBE B: cross-protocol history projection", () => {
  it("same family, same model: signed thinking survives the replay pipeline", async () => {
    const messages = makeAnthropicHistory();
    const sessionManager = makeSessionManager([
      makeModelSnapshot("anthropic", "anthropic-messages", "claude-sonnet-4-6"),
    ]);

    const projected = await project({
      messages,
      modelApi: "anthropic-messages",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      sessionManager,
    });

    // Same-family replay keeps the signed block: no cross-family downgrade applies.
    expect(thinkingBlockCount(projected)).toBe(1);
    expect(thinkingSignatureOf(projected)).toBe(SIGNED_THINKING);
  });

  it("S1: switching to OpenAI Responses keeps the foreign reasoning block in the transcript", async () => {
    const sessionManager = makeSessionManager([
      makeModelSnapshot("anthropic", "anthropic-messages", "claude-sonnet-4-6"),
    ]);

    const projected = await project({
      messages: makeAnthropicHistory(),
      modelApi: "openai-responses",
      provider: "openai",
      modelId: "gpt-5.5",
      sessionManager,
    });

    // Measured, and it contradicts the intuitive reading of "downgrade reasoning on
    // model change": the block and its Anthropic signature are still present after the
    // projection. `downgradeOpenAIReasoningBlocks` only rewrites signatures that parse
    // as *OpenAI* reasoning metadata, so a foreign-family signature is passed through.
    expect(thinkingBlockCount(projected)).toBe(1);
    expect(thinkingSignatureOf(projected)).toBe(SIGNED_THINKING);

    // The removal happens one layer down: the OpenAI transports' block mapper drops the
    // foreign thinking block, and the payload never carries it. Asserted in
    // `../upstream-protocol-cache-probe.test.ts` ("foreign reasoning blocks are dropped
    // by the OpenAI transport block mapping").
    //
    // Consequence: the safety property is owned by each transport's mapping, and the
    // projection layer produces no record that reasoning state was dropped.
    const assistant = findAssistant(projected);
    const content = assistant?.content as Array<Record<string, unknown>>;
    expect(content.some((block) => block.type === "text")).toBe(true);
    expect(content.some((block) => block.type === "toolCall")).toBe(true);
  });

  it("S1b: the OpenAI target rewrites tool-call ids into its own id shape", async () => {
    const sessionManager = makeSessionManager([
      makeModelSnapshot("anthropic", "anthropic-messages", "claude-sonnet-4-6"),
    ]);

    const projected = await project({
      messages: makeAnthropicHistory(),
      modelApi: "openai-responses",
      provider: "openai",
      modelId: "gpt-5.5",
      sessionManager,
    });

    const serialized = JSON.stringify(projected);
    // Anthropic's `toolu_*` id is not replayed to OpenAI; the pair is rewritten so the
    // call and its result keep matching after sanitization.
    expect(serialized).not.toContain("toolu_probe_1");
    const assistant = findAssistant(projected);
    const content = assistant?.content as Array<Record<string, unknown>>;
    const toolCall = content.find((block) => block.type === "toolCall");
    expect(String(toolCall?.id).startsWith("call")).toBe(true);
  });

  it("S2: the change detector has no account dimension", async () => {
    const entries: CustomEntry[] = [
      makeModelSnapshot("anthropic", "anthropic-messages", "claude-sonnet-4-6"),
    ];
    const sessionManager = makeSessionManager(entries);

    await project({
      messages: makeAnthropicHistory(),
      modelApi: "anthropic-messages",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      sessionManager,
    });

    // Measured: the persisted snapshot carries provider/modelApi/modelId only. An auth
    // profile rotation (a different account on the same provider+model) leaves
    // `modelChanged` false, so account-bound reasoning state is replayed unchanged.
    const snapshots = entries.filter((entry) => entry.customType === "model-snapshot");
    expect(snapshots.length).toBeGreaterThan(0);
    expect(Object.keys(snapshots[0]!.data as Record<string, unknown>).sort()).toEqual([
      "modelApi",
      "modelId",
      "provider",
      "timestamp",
    ]);
  });

  it("S5: compaction staleness strips signatures that predate the summary", async () => {
    const messages = [
      { role: "user", content: "first ask", timestamp: 1 },
      {
        role: "assistant",
        timestamp: 2,
        content: [
          { type: "thinking", thinking: "pre-compaction reasoning", thinkingSignature: SIGNED_THINKING },
          { type: "text", text: "pre-compaction answer" },
        ],
      },
      {
        role: "compactionSummary",
        timestamp: 3,
        content: [{ type: "text", text: "summary" }],
      },
      {
        role: "assistant",
        timestamp: 4,
        content: [
          { type: "thinking", thinking: "post-compaction reasoning", thinkingSignature: NEXT_SIGNED_THINKING },
          { type: "text", text: "post-compaction answer" },
        ],
      },
      { role: "user", content: "next ask", timestamp: 5 },
    ] as unknown as AgentMessage[];
    const sessionManager = makeSessionManager([
      makeModelSnapshot("anthropic", "anthropic-messages", "claude-sonnet-4-6"),
    ]);

    const projected = await project({
      messages,
      modelApi: "anthropic-messages",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      sessionManager,
    });

    const serialized = JSON.stringify(projected);
    // The pre-compaction signature is prefix-bound and is stripped; the post-summary
    // turn may keep its signature because it was produced in the current context.
    expect(serialized).not.toContain(SIGNED_THINKING);
    expect(serialized).toContain(NEXT_SIGNED_THINKING);
  });

  it("tool-call/result pairing is repaired for the OpenAI Responses target", async () => {
    const sessionManager = makeSessionManager([
      makeModelSnapshot("anthropic", "anthropic-messages", "claude-sonnet-4-6"),
    ]);

    const projected = await project({
      messages: makeAnthropicHistory(),
      modelApi: "openai-responses",
      provider: "openai",
      modelId: "gpt-5.5",
      sessionManager,
    });

    // Both halves of the pair remain, so the provider will not reject an orphan.
    const serialized = JSON.stringify(projected);
    expect(serialized).toContain("read_log");
    const roles = projected.map((message) => (message as { role?: unknown }).role);
    expect(roles).toContain("toolResult");
  });
});
