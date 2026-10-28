import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAzureOpenAIResponsesTransportStreamFn,
  createOpenAICompletionsTransportStreamFn,
  createOpenAIResponsesTransportStreamFn,
  testing,
} from "./openai-transport-stream.js";

describe("OpenAI Responses transport event compatibility", () => {
  it("prefers SDK response event type and keeps legacy event fallback", () => {
    expect(testing.resolveResponsesEventType({ type: "response.completed" })).toBe(
      "response.completed",
    );
    expect(testing.resolveResponsesEventType({ event: "response.completed" })).toBe(
      "response.completed",
    );
  });

  it("uses call_id for function outputs and marks completed tool calls as toolUse", () => {
    expect(testing.resolveResponsesFunctionCallId({ id: "fc_1", call_id: "call_1" })).toBe(
      "call_1",
    );
    expect(testing.resolveResponsesStopReason("completed", true)).toBe("toolUse");
    expect(testing.resolveResponsesStopReason("incomplete", false)).toBe("length");
    expect(testing.resolveResponsesStopReason("completed", false)).toBe("stop");
  });
});

import { attachModelProviderRequestTransport } from "./provider-request-config.js";
import type { Model } from "../llm/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Responses terminal event boundary", () => {
  for (const [api, createStream] of [
    ["openai-responses", createOpenAIResponsesTransportStreamFn],
    ["azure-openai-responses", createAzureOpenAIResponsesTransportStreamFn],
  ] as const) {
    it(`${api} finalizes a tool from output_item.done without repeating the execution`, async () => {
      vi.stubEnv("AZURE_OPENAI_ENDPOINT", "http://127.0.0.1:40125");
      const item = {
        type: "function_call",
        id: "fc_fixture",
        call_id: "call_fixture",
        name: "read",
        arguments: "",
      };
      const frames = [
        { type: "response.created", response: { id: "fixture-response", status: "in_progress" } },
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"path":' },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { ...item, arguments: '{"path":"probe.txt"}' },
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { ...item, arguments: '{"path":"probe.txt"}' },
        },
        { type: "response.completed", response: { id: "fixture-response", status: "completed" } },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), {
              headers: { "content-type": "text/event-stream" },
            }),
        ),
      );
      const model = attachModelProviderRequestTransport(
        {
          id: "fixture",
          name: "fixture",
          provider: "custom",
          api,
          baseUrl: "http://127.0.0.1:40125/v1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 128,
        } as Model,
        { allowPrivateNetwork: true },
      );
      const stream = await createStream()(
        model,
        { messages: [{ role: "user", content: "synthetic tool terminal probe", timestamp: 1 }] },
        { apiKey: "fixture-key", maxTokens: 128 },
      );
      const ended = [];
      for await (const event of stream)
        if (event.type === "toolcall_end") ended.push(event.toolCall);
      const result = await stream.result();
      expect(ended).toHaveLength(1);
      expect(result.stopReason).toBe("toolUse");
      expect(result.content).toContainEqual(
        expect.objectContaining({
          type: "toolCall",
          id: "call_fixture",
          name: "read",
          arguments: { path: "probe.txt" },
        }),
      );
    });

    it(`${api} preserves visible text after reasoning and separate content parts`, async () => {
      vi.stubEnv("AZURE_OPENAI_ENDPOINT", "http://127.0.0.1:40125");
      const frames = [
        { type: "response.created", response: { id: "fixture-response", status: "in_progress" } },
        {
          type: "response.reasoning_summary_part.added",
          output_index: 0,
          summary_index: 0,
          part: { type: "summary_text", text: "" },
        },
        {
          type: "response.reasoning_summary_text.delta",
          output_index: 0,
          summary_index: 0,
          delta: "reasoning",
        },
        {
          type: "response.reasoning_summary_text.done",
          output_index: 0,
          summary_index: 0,
          text: "final reasoning",
        },
        {
          type: "response.reasoning_summary_part.added",
          output_index: 0,
          summary_index: 1,
          part: { type: "summary_text", text: "" },
        },
        {
          type: "response.reasoning_summary_text.done",
          output_index: 0,
          summary_index: 1,
          text: "second final reasoning",
        },
        {
          type: "response.content_part.added",
          output_index: 1,
          content_index: 0,
          part: { type: "output_text", text: "" },
        },
        {
          type: "response.output_text.delta",
          output_index: 1,
          content_index: 0,
          delta: "visible-",
        },
        { type: "response.output_text.done", output_index: 1, content_index: 0, text: "visible-" },
        {
          type: "response.content_part.added",
          output_index: 1,
          content_index: 1,
          part: { type: "output_text", text: "" },
        },
        { type: "response.output_text.delta", output_index: 1, content_index: 1, delta: "answer" },
        { type: "response.output_text.done", output_index: 1, content_index: 1, text: "answer" },
        { type: "response.completed", response: { id: "fixture-response", status: "completed" } },
      ];
      const events = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () => new Response(events, { headers: { "content-type": "text/event-stream" } }),
        ),
      );
      const model = attachModelProviderRequestTransport(
        {
          id: "fixture",
          name: "fixture",
          provider: "custom",
          api,
          baseUrl: "http://127.0.0.1:40125/v1",
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 128,
        } as Model,
        { allowPrivateNetwork: true },
      );
      const stream = await createStream()(
        model,
        {
          messages: [{ role: "user", content: "synthetic indexed probe", timestamp: 1 }],
        },
        { apiKey: "fixture-key", maxTokens: 128 },
      );
      const deltas: string[] = [];
      const summaries: string[] = [];
      for await (const event of stream) {
        if (event.type === "text_delta") deltas.push(event.delta);
        if (event.type === "thinking_end") summaries.push(event.content);
      }
      const result = await stream.result();
      expect(deltas.join("")).toBe("visible-answer");
      expect(summaries).toEqual(["final reasoning", "second final reasoning"]);
      expect(
        result.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join(""),
      ).toBe("visible-answer");
      expect(result.content).toContainEqual(
        expect.objectContaining({ type: "thinking", thinking: "final reasoning" }),
      );
      expect(result.content).toContainEqual(
        expect.objectContaining({ type: "thinking", thinking: "second final reasoning" }),
      );
    });

    it.each([
      "completed",
      "eof",
      "failed",
      "incomplete",
      "incomplete-tool",
      "unfinished-tool",
      "malformed-completed-tool",
      "finalized-tool-eof",
      "finalized-tool-failed",
      "finalized-tool-incomplete",
    ] as const)(`${api} handles %s without a false completion`, async (terminal) => {
      vi.stubEnv("AZURE_OPENAI_ENDPOINT", "http://127.0.0.1:40125");
      const finalizedTool = terminal.startsWith("finalized-tool-");
      const response = {
        id: "fixture-response",
        status: finalizedTool
          ? terminal.slice("finalized-tool-".length)
          : terminal === "incomplete-tool"
            ? "incomplete"
            : terminal === "unfinished-tool" || terminal === "malformed-completed-tool"
              ? "completed"
              : terminal,
      };
      const frames = [
        { type: "response.created", response: { ...response, status: "in_progress" } },
        {
          type: "response.content_part.added",
          output_index: 0,
          part: { type: "output_text", text: "" },
        },
        { type: "response.output_text.delta", content_index: 0, delta: "partial-fixture" },
        ...(terminal === "incomplete-tool" ||
        terminal === "unfinished-tool" ||
        terminal === "malformed-completed-tool" ||
        finalizedTool
          ? [
              {
                type: "response.output_item.added",
                output_index: 1,
                item: {
                  type: "function_call",
                  id: "fc_partial",
                  call_id: "call_partial",
                  name: "read",
                  arguments: '{"path":',
                },
              },
            ]
          : []),
        ...(terminal === "malformed-completed-tool" || finalizedTool
          ? [
              {
                type: "response.function_call_arguments.done",
                output_index: 1,
                arguments: finalizedTool ? '{"path":"probe.txt"}' : '{"path":',
              },
            ]
          : []),
        ...(response.status === "eof"
          ? []
          : [
              {
                type: `response.${response.status}`,
                response: {
                  ...response,
                  ...(response.status === "failed"
                    ? { error: { code: "server_error", message: "synthetic terminal failure" } }
                    : {}),
                },
              },
            ]),
      ];
      const events = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () => new Response(events, { headers: { "content-type": "text/event-stream" } }),
        ),
      );
      const model = attachModelProviderRequestTransport(
        {
          id: "fixture",
          name: "fixture",
          provider: "custom",
          api,
          baseUrl: "http://127.0.0.1:40125/v1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 128,
        } as Model,
        { allowPrivateNetwork: true },
      );
      const stream = await createStream()(
        model,
        {
          messages: [{ role: "user", content: "synthetic terminal probe", timestamp: 1 }],
        },
        { apiKey: "fixture-key", maxTokens: 128 },
      );
      const emitted: string[] = [];
      for await (const event of stream) emitted.push(event.type);
      const result = await stream.result();
      if (terminal === "completed") {
        expect(result.stopReason).toBe("stop");
        expect(emitted).toContain("done");
      } else if (terminal === "incomplete") {
        expect(result.stopReason).toBe("length");
      } else {
        expect(result.stopReason).toBe("error");
        expect(emitted).not.toContain("done");
        expect(emitted).not.toContain("toolcall_end");
        expect(result.errorMessage).toMatch(
          response.status === "eof"
            ? /terminal|completed|ended/i
            : terminal === "incomplete-tool" || terminal === "finalized-tool-incomplete"
              ? /incomplete tool call cannot execute/
              : terminal === "unfinished-tool"
                ? /unfinished tool call/
                : terminal === "malformed-completed-tool"
                  ? /JSON|property|position/i
                  : /synthetic terminal failure/,
        );
      }
    });
  }
});

describe("Chat Completions frames containing usage and choices", () => {
  it.each(["text", "tool"] as const)(
    "keeps %s deltas and finish reason alongside usage",
    async (kind) => {
      const choices =
        kind === "text"
          ? [
              {
                index: 0,
                delta: { content: "hello ", reasoning_content: "synthetic reasoning" },
                finish_reason: null,
              },
              { index: 0, delta: { content: "world" }, finish_reason: "length" },
            ]
          : [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      type: "function",
                      function: { name: "lookup", arguments: '{"id":' },
                    },
                  ],
                },
                finish_reason: null,
              },
              {
                index: 0,
                delta: { tool_calls: [{ index: 0, function: { arguments: '"blue"}' } }] },
                finish_reason: "tool_calls",
              },
            ];
      const events =
        choices
          .map(
            (choice, index) =>
              "data: " +
              JSON.stringify({
                id: "fixture-response",
                object: "chat.completion.chunk",
                model: "fixture",
                choices: [choice],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: index + 1,
                  total_tokens: 11 + index,
                },
              }) +
              "\n\n",
          )
          .join("") + "data: [DONE]\n\n";
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () => new Response(events, { headers: { "content-type": "text/event-stream" } }),
        ),
      );
      const model = attachModelProviderRequestTransport(
        {
          id: "fixture",
          name: "fixture",
          provider: "custom",
          api: "openai-completions",
          baseUrl: "http://127.0.0.1:40123/v1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 128,
        } as Model,
        { allowPrivateNetwork: true },
      );
      const stream = await createOpenAICompletionsTransportStreamFn()(
        model,
        {
          messages: [{ role: "user", content: "synthetic probe", timestamp: 1 }],
        },
        { apiKey: "fixture-key", maxTokens: 128 },
      );
      for await (const _event of stream) {
        /* consume complete stream */
      }
      const result = await stream.result();
      expect(result.usage).toMatchObject({ input: 10, output: 2, totalTokens: 12 });
      if (kind === "text") {
        expect(result.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "text", text: "hello world" }),
            expect.objectContaining({ type: "thinking", thinking: "synthetic reasoning" }),
          ]),
        );
        expect(result.stopReason).toBe("length");
      } else {
        expect(result.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "toolCall",
              id: "call-1",
              name: "lookup",
              arguments: { id: "blue" },
            }),
          ]),
        );
        expect(result.stopReason).toBe("toolUse");
      }
    },
  );
});

describe("OpenAI transport request-body boundary", () => {
  it("never serializes AbortSignal into the request body and passes it as a request option", async () => {
    const captured: Array<{
      url: string;
      body: unknown;
      hasOptions: boolean;
      optionSignal: unknown;
    }> = [];
    const events =
      "data: " +
      JSON.stringify({
        id: "fixture",
        object: "chat.completion.chunk",
        model: "fixture",
        choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
      }) +
      "\n\ndata: [DONE]\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { body?: unknown; signal?: unknown }) => {
        const raw = typeof init?.body === "string" ? init.body : undefined;
        captured.push({
          url: String(input),
          body: raw ? JSON.parse(raw) : undefined,
          hasOptions: init?.signal !== undefined,
          optionSignal: init?.signal,
        });
        return new Response(events, { headers: { "content-type": "text/event-stream" } });
      }),
    );
    const model = attachModelProviderRequestTransport(
      {
        id: "fixture",
        name: "fixture",
        provider: "custom",
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:40124/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 128,
      } as Model,
      { allowPrivateNetwork: true },
    );
    const controller = new AbortController();
    const stream = await createOpenAICompletionsTransportStreamFn()(
      model,
      {
        messages: [{ role: "user", content: "synthetic probe", timestamp: 1 }],
      },
      { apiKey: "fixture-key", maxTokens: 128, signal: controller.signal },
    );
    for await (const _event of stream) {
      /* consume */
    }
    await stream.result();
    expect(captured.length).toBeGreaterThan(0);
    for (const request of captured) {
      expect(Object.keys(request.body as Record<string, unknown>)).not.toContain("signal");
      expect(request.hasOptions).toBe(true);
      // The transport wraps the caller signal with a timeout (AbortSignal.any),
      // so identity is not preserved; the contract is that a live AbortSignal is
      // still delivered as a request option and not as a body field.
      expect(request.optionSignal).toBeInstanceOf(AbortSignal);
      expect((request.optionSignal as AbortSignal).aborted).toBe(false);
    }
  });
});
