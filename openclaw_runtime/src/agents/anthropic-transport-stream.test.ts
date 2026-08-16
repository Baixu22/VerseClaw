// R4: Anthropic Messages transport — payload snapshot + SSE parsing parity fixtures.
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  SimpleStreamOptions,
  Tool,
  ToolResultMessage,
} from "../llm/types.js";
import { createAnthropicMessagesTransportStreamFn } from "./anthropic-transport-stream.js";
import { attachModelProviderRequestTransport } from "./provider-request-config.js";

const IMAGE_DATA =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const MODEL_ID = "claude-3-5-sonnet-20241022";

const MODEL_BASE = {
  name: "R4 anthropic fixture",
  reasoning: false,
  input: ["text", "image"] as Array<"text" | "image">,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
};

function makeModel(overrides: {
  input?: Array<"text" | "image">;
  id?: string;
  reasoning?: boolean;
  baseUrl?: string;
} = {}): Model {
  return attachModelProviderRequestTransport(
    {
      ...MODEL_BASE,
      api: "anthropic-messages",
      provider: "anthropic",
      id: overrides.id ?? MODEL_ID,
      baseUrl: overrides.baseUrl ?? "http://127.0.0.1:40123/v1",
      ...overrides,
    } as never,
    { allowPrivateNetwork: true },
  );
}

function assistantToolCallTurn(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "call_1", name: "get_weather", arguments: { location: "SF" } }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: MODEL_ID,
    usage: { ...EMPTY_USAGE },
    stopReason: "toolUse",
    timestamp: 2,
  };
}

function toolResultTurn(): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "get_weather",
    content: [{ type: "text", text: "Sunny" }],
    isError: false,
    timestamp: 3,
  };
}

function makeTool(): Tool {
  return {
    name: "get_weather",
    description: "Get weather",
    parameters: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    } as never,
  };
}

function sseBodyFrom(events: unknown[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\n`;
}

const MINIMAL_SSE = sseBodyFrom([
  { type: "message_start", message: { id: "msg_r4", usage: { input_tokens: 10, output_tokens: 2 } } },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
]);

type CapturedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

async function runStream(params: {
  model?: Model;
  context: Context;
  options?: SimpleStreamOptions & {
    thinkingEnabled?: boolean;
    effort?: string;
    serverCompaction?: boolean;
    serverCompactionThreshold?: number;
  };
  sseBody?: string;
}): Promise<{ events: AssistantMessageEvent[]; captured: CapturedRequest }> {
  const originalFetch = globalThis.fetch;
  let captured: CapturedRequest = { url: "", headers: {}, body: {} };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    captured = {
      url: request.url,
      headers,
      body: JSON.parse(await request.text()) as Record<string, unknown>,
    };
    return new Response(params.sseBody ?? MINIMAL_SSE, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
  try {
    const stream = await createAnthropicMessagesTransportStreamFn()(
      params.model ?? makeModel(),
      params.context,
      params.options,
    );
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event as AssistantMessageEvent);
    }
    return { events, captured };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Anthropic Messages transport", () => {
  it("builds the payload snapshot: system, image+text user turn, tool_use + tool_result, tools, max_tokens, headers", async () => {
    const { captured, events } = await runStream({
      context: {
        systemPrompt: "You are a helpful assistant.",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this image?" },
              { type: "image", mimeType: "image/png", data: IMAGE_DATA },
            ],
            timestamp: 1,
          },
          assistantToolCallTurn(),
          toolResultTurn(),
        ],
        tools: [makeTool()],
      },
      options: { apiKey: "fixture-key", cacheRetention: "none" },
    });

    expect(events.some((event) => event.type === "done")).toBe(true);

    expect(captured.url).toBe("http://127.0.0.1:40123/v1/messages");
    expect(captured.headers["x-api-key"]).toBe("fixture-key");
    expect(captured.headers["anthropic-version"]).toBe("2023-06-01");
    expect(captured.headers["content-type"]).toBe("application/json");

    expect(captured.body.model).toBe(MODEL_ID);
    expect(captured.body.stream).toBe(true);
    expect(captured.body.max_tokens).toBe(4096);
    expect(captured.body.system).toEqual([{ type: "text", text: "You are a helpful assistant." }]);
    expect(captured.body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: IMAGE_DATA } },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_1", name: "get_weather", input: { location: "SF" } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_1", content: "Sunny", is_error: false }],
      },
    ]);
    expect(captured.body.tools).toEqual([
      {
        name: "get_weather",
        description: "Get weather",
        input_schema: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"],
        },
      },
    ]);
  });

  it("drops image blocks when the model input capability omits image", async () => {
    const { captured } = await runStream({
      model: makeModel({ input: ["text"] }),
      context: {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "hello" },
              { type: "image", mimeType: "image/png", data: IMAGE_DATA },
            ],
            timestamp: 1,
          },
        ],
      },
      options: { apiKey: "fixture-key", cacheRetention: "none" },
    });

    expect(captured.body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("parses text, thinking, and tool_use deltas into output blocks with a tool_use stop reason", async () => {
    const { events } = await runStream({
      context: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
      options: { apiKey: "fixture-key", cacheRetention: "none" },
      sseBody: sseBodyFrom([
        { type: "message_start", message: { id: "msg_r4", usage: { input_tokens: 10, output_tokens: 5 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "Hello" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "Let me " } },
        { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "think" } },
        { type: "content_block_delta", index: 1, delta: { type: "signature_delta", signature: "sig-1" } },
        { type: "content_block_stop", index: 1 },
        { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "get_weather", input: {} } },
        { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"location":' } },
        { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"SF"}' } },
        { type: "content_block_stop", index: 2 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
      ]),
    });

    const done = events.find(
      (event): event is Extract<AssistantMessageEvent, { type: "done" }> =>
        event.type === "done",
    );
    expect(done).toBeDefined();
    expect(done?.message.stopReason).toBe("toolUse");
    expect(done?.message.content).toEqual([
      { type: "text", text: "Hello world" },
      { type: "thinking", thinking: "Let me think", thinkingSignature: "sig-1" },
      { type: "toolCall", id: "toolu_1", name: "get_weather", arguments: { location: "SF" } },
    ]);
  });

  it("emits an error event when the SSE stream reports an error", async () => {
    const { events } = await runStream({
      context: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
      options: { apiKey: "fixture-key", cacheRetention: "none" },
      sseBody: sseBodyFrom([{ type: "error", error: { message: "boom" } }]),
    });

    const errorEvent = events.find(
      (event): event is Extract<AssistantMessageEvent, { type: "error" }> =>
        event.type === "error",
    );
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.error.stopReason).toBe("error");
    expect(errorEvent?.error.errorMessage).toBe("boom");
  });

  it("sends adaptive thinking and output_config effort for Sonnet 5", async () => {
    const { captured } = await runStream({
      model: makeModel({ id: "claude-sonnet-5", reasoning: true }),
      context: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
      options: {
        apiKey: "fixture-key",
        cacheRetention: "none",
        reasoning: "medium",
      },
    });

    expect(captured.body.thinking).toEqual({ type: "adaptive" });
    expect(captured.body.output_config).toEqual({ effort: "medium" });
  });

  it("omits the thinking field for adaptive-only Fable 5 when thinking is disabled", async () => {
    const { captured } = await runStream({
      model: makeModel({ id: "claude-fable-5", reasoning: true }),
      context: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
      options: { apiKey: "fixture-key", cacheRetention: "none", thinkingEnabled: false },
    });

    expect(captured.body).not.toHaveProperty("thinking");
  });

  it("keeps explicit thinking disabled for models that support the field", async () => {
    const { captured } = await runStream({
      model: makeModel({ id: "claude-opus-4-8", reasoning: true }),
      context: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
      options: { apiKey: "fixture-key", cacheRetention: "none", thinkingEnabled: false },
    });

    expect(captured.body.thinking).toEqual({ type: "disabled" });
  });

  it("maps a refusal stop reason to an error outcome", async () => {
    const { events } = await runStream({
      context: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
      options: { apiKey: "fixture-key", cacheRetention: "none" },
      sseBody: sseBodyFrom([
        {
          type: "message_start",
          message: { id: "msg_refusal", usage: { input_tokens: 10, output_tokens: 0 } },
        },
        { type: "message_delta", delta: { stop_reason: "refusal" }, usage: { output_tokens: 0 } },
      ]),
    });

    const errorEvent = events.find(
      (event): event is Extract<AssistantMessageEvent, { type: "error" }> =>
        event.type === "error",
    );
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.error.stopReason).toBe("error");
    expect(errorEvent?.error.errorMessage).toContain("refusal:");
    expect(errorEvent?.error.errorMessage).toContain("stop_reason: refusal");
  });

  it("maps a sensitive stop reason to the same refusal error outcome", async () => {
    const { events } = await runStream({
      context: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
      options: { apiKey: "fixture-key", cacheRetention: "none" },
      sseBody: sseBodyFrom([
        {
          type: "message_start",
          message: { id: "msg_sensitive", usage: { input_tokens: 10, output_tokens: 0 } },
        },
        { type: "message_delta", delta: { stop_reason: "sensitive" }, usage: { output_tokens: 0 } },
      ]),
    });

    const errorEvent = events.find(
      (event): event is Extract<AssistantMessageEvent, { type: "error" }> =>
        event.type === "error",
    );
    expect(errorEvent?.error.errorMessage).toContain("refusal:");
  });

  it("warns when thinking is disabled on an adaptive-only model", async () => {
    const loggerModule = await import("../logger.js");
    const spy = vi.spyOn(loggerModule, "logWarn").mockImplementation(() => {});

    try {
      await runStream({
        model: makeModel({ id: "claude-mythos-5", reasoning: true }),
        context: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
        options: { apiKey: "fixture-key", cacheRetention: "none", thinkingEnabled: false },
      });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("claude-mythos-5"));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("does not support disabling thinking"));
    } finally {
      spy.mockRestore();
    }
  });

  it("sends context_management and the compaction beta when server compaction is enabled", async () => {
    const { captured } = await runStream({
      model: makeModel({ id: "claude-sonnet-5", baseUrl: "https://api.anthropic.com" }),
      context: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
      options: {
        apiKey: "fixture-key",
        cacheRetention: "none",
        serverCompaction: true,
        serverCompactionThreshold: 175_000,
      },
    });

    expect(captured.body.context_management).toEqual([
      { type: "compaction", compact_threshold: 175_000 },
    ]);
    expect(captured.headers["anthropic-beta"]).toContain("compact-2026-01-12");
  });
});
