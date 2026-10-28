// R4: Responses 请求体协议校正 — 官方 image_url 形状、function_call 配对回放、payload 消毒接线。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context, Model } from "../llm/types.js";
import { createOpenAIResponsesTransportStreamFn } from "./openai-transport-stream.js";
import { attachModelProviderRequestTransport } from "./provider-request-config.js";

const modelBase = {
  name: "R4 responses fixture",
  reasoning: false,
  input: ["text"] as Array<"text">,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 128,
};

function makeModel(id: string): Model {
  return attachModelProviderRequestTransport(
    {
      ...modelBase,
      api: "openai-responses",
      provider: "openai",
      id,
      baseUrl: "http://127.0.0.1:40123/v1",
    } as never,
    { allowPrivateNetwork: true },
  );
}

const RESPONSES_SSE =
  'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
  'data: {"type":"response.completed","response":{"id":"r1","status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n';

async function captureSentRequestBody(context: Context): Promise<Record<string, unknown>> {
  const originalFetch = globalThis.fetch;
  let captured: Record<string, unknown> = {};
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    captured = JSON.parse(await request.clone().text()) as Record<string, unknown>;
    return new Response(RESPONSES_SSE, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
  try {
    const stream = await createOpenAIResponsesTransportStreamFn()(
      makeModel("gpt-r4") as Model,
      context,
      { apiKey: "fixture-key", sessionId: "sess-r4" },
    );
    for await (const _event of stream) {
      // Consume the stream to completion.
    }
    const result = await stream.result();
    expect(result.stopReason).not.toBe("error");
  } finally {
    globalThis.fetch = originalFetch;
  }
  return captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI Responses request body — official schema conformance", () => {
  it("sends image content as input_image.image_url data URL (not gateway source shape)", async () => {
    const body = await captureSentRequestBody({
      systemPrompt: "You are a tester.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            {
              type: "image",
              mimeType: "image/png",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            },
          ],
          timestamp: 1,
        },
      ],
    });

    expect(body.model).toBe("gpt-r4");
    expect(body.stream).toBe(true);
    expect(body.input).toEqual([
      {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: "You are a tester." }],
      },
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "What is in this image?" },
          {
            type: "input_image",
            image_url: expect.stringMatching(/^data:image\/png;base64,/),
            detail: "auto",
          },
        ],
      },
    ]);

    const userItem = (body.input as Array<Record<string, unknown>>)[1] as Record<string, unknown>;
    const imagePart = (userItem.content as Array<Record<string, unknown>>)[1];
    expect(imagePart).not.toHaveProperty("source");
    expect(imagePart).not.toHaveProperty("media_type");
  });

  it("replays two-round tool history as paired function_call + function_call_output", async () => {
    const body = await captureSentRequestBody({
      systemPrompt: "sys",
      messages: [
        { role: "user", content: "read /x", timestamp: 1 },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will read it." },
            { type: "toolCall", id: "call_1", name: "read", arguments: { path: "/x" } },
          ],
          api: "openai-responses",
          provider: "openai",
          model: "gpt-r4",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse",
          timestamp: 2,
        },
        {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "read",
          content: [{ type: "text", text: "file contents" }],
          isError: false,
          timestamp: 3,
        },
        { role: "user", content: "thanks", timestamp: 4 },
      ],
    });

    expect(body.input).toEqual([
      {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: "sys" }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "read /x" }],
      },
      {
        type: "message",
        role: "assistant",
        content: "I will read it.",
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "read",
        arguments: '{"path":"/x"}',
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "file contents",
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "thanks" }],
      },
    ]);
  });

  it("replaces invalid inline image bytes with a visible text placeholder before send", async () => {
    const body = await captureSentRequestBody({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              mimeType: "image/png",
              // Valid base64 but not an image byte signature: must fail sanitization.
              data: "aGVsbG8gd29ybGQ=",
            },
          ],
          timestamp: 1,
        },
      ],
    });

    expect(body.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "[omitted image payload: invalid inline image data]",
          },
        ],
      },
    ]);
  });
});
