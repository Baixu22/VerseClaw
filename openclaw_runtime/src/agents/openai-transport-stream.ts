/**
 * OpenAI/Azure OpenAI streaming transport.
 * Converts OpenClaw contexts/tools into OpenAI payloads, streams SSE events
 * back into runtime output blocks, and applies provider request policy.
 */
import { AzureOpenAI, OpenAI } from "openai";
import { getEnvApiKey } from "../llm/env-api-keys.js";
import { calculateCost } from "../llm/model-utils.js";
import type { Context, Message, Model, SimpleStreamOptions } from "../llm/types.js";
import { parseStreamingJson } from "../llm/utils/json-parse.js";
import { recordProviderPayloadTrace } from "./provider-payload-trace.js";
import { buildGuardedModelFetch } from "./provider-transport-fetch.js";
import { beginShadowModelCall } from "./shadow-census.js";
import {
  canonicalizeProviderToolSchema,
  canonicalizeProviderTools,
} from "./provider-payload-cache-shape.js";
import type { StreamFn } from "./runtime/index.js";
import {
  coerceTransportToolCallArguments,
  createEmptyTransportUsage,
  createWritableTransportEventStream,
  failTransportStream,
  finalizeTransportStream,
  sanitizeTransportPayloadText,
} from "./transport-stream-shared.js";
import { normalizeUsage, type UsageLike } from "./usage.js";

// ── internal types ───────────────────────────────────────────────────────────

type TransportContentBlock =
  | { type: "text"; text: string; index?: number }
  | {
      type: "thinking";
      thinking: string;
      thinkingSignature: string;
      redacted?: boolean;
      index?: number;
    }
  | {
      type: "toolCall";
      id: string;
      name: string;
      arguments: unknown;
      partialJson?: string;
      index?: number;
    };

type MutableAssistantOutput = {
  role: "assistant";
  content: Array<TransportContentBlock>;
  api: string;
  provider: string;
  model: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
  stopReason: string;
  timestamp: number;
  responseId?: string;
  errorMessage?: string;
};

// ── helpers ──────────────────────────────────────────────────────────────────

function mapStopReason(reason: string | undefined): string {
  switch (reason) {
    case "stop":
    case "end_turn":
      return "stop";
    case "tool_calls":
      return "toolUse";
    case "length":
    case "max_tokens":
      return "length";
    default:
      return "stop";
  }
}

function parseToolCallArguments(inputJson: string): unknown {
  return parseStreamingJson(inputJson);
}

function resolveResponsesEventType(event: Record<string, unknown>): string {
  return typeof event.type === "string"
    ? event.type
    : typeof event.event === "string"
      ? event.event
      : "";
}

function resolveResponsesFunctionCallId(item: Record<string, unknown> | undefined): string {
  return typeof item?.call_id === "string"
    ? item.call_id
    : typeof item?.id === "string"
      ? item.id
      : "";
}

function resolveResponsesStopReason(
  status: string | undefined,
  hasToolCall: boolean,
): string {
  if (hasToolCall) return "toolUse";
  return status === "incomplete" ? "length" : "stop";
}

function applyProviderUsage(
  output: MutableAssistantOutput,
  model: Model,
  usage: Record<string, unknown> | undefined,
): void {
  const normalized = normalizeUsage(usage as UsageLike | undefined);
  if (!normalized) {
    return;
  }
  output.usage.input = normalized.input ?? 0;
  output.usage.output = normalized.output ?? 0;
  output.usage.cacheRead = normalized.cacheRead ?? 0;
  output.usage.cacheWrite = normalized.cacheWrite ?? 0;
  const componentTotal =
    output.usage.input +
    output.usage.output +
    output.usage.cacheRead +
    output.usage.cacheWrite;
  output.usage.totalTokens =
    typeof normalized.total === "number" && Number.isFinite(normalized.total)
      ? Math.max(componentTotal, normalized.total)
      : componentTotal;
  calculateCost(model, output.usage);
}

function finalizeOpenAIProviderParams(params: Record<string, unknown>): void {
  if (params.tools !== undefined) {
    params.tools = canonicalizeProviderTools(params.tools);
  }
}

function recordFinalOpenAIProviderPayload(
  options: SimpleStreamOptions | undefined,
  params: Record<string, unknown>,
  source: string,
): void {
  recordProviderPayloadTrace(options as Record<PropertyKey, unknown> | undefined, params, source);
}

// ── message conversion: Chat Completions ─────────────────────────────────────

type ChatCompletionSystemMessage = {
  role: "system";
  content: string;
};

type ChatCompletionUserMessage = {
  role: "user";
  content: string | Array<Record<string, unknown>>;
};

type ChatCompletionAssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type ChatCompletionToolMessage = {
  role: "tool";
  tool_call_id: string;
  content: string;
};

type ChatCompletionMessage =
  | ChatCompletionSystemMessage
  | ChatCompletionUserMessage
  | ChatCompletionAssistantMessage
  | ChatCompletionToolMessage;

function toChatCompletionsMessages(context: Context): ChatCompletionMessage[] {
  const messages: ChatCompletionMessage[] = [];

  if (context.systemPrompt) {
    messages.push({ role: "system", content: context.systemPrompt });
  }

  for (const msg of context.messages) {
    if (msg.role === "user") {
      const content = convertUserContent(msg);
      messages.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const assistantMsg: ChatCompletionAssistantMessage = {
        role: "assistant",
        content: null,
      };

      const textParts: string[] = [];
      const toolCalls: ChatCompletionAssistantMessage["tool_calls"] = [];

      for (const block of msg.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "thinking") {
          // thinking blocks are not native to chat completions;
          // skip them in the request body
        } else if (block.type === "toolCall") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.arguments),
            },
          });
        }
      }

      assistantMsg.content = textParts.length > 0 ? textParts.join("") : null;
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      messages.push(assistantMsg);
    } else if (msg.role === "toolResult") {
      const textContent = msg.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      messages.push({
        role: "tool",
        tool_call_id: msg.toolCallId,
        content: textContent || "(no output)",
      });
    }
  }

  return messages;
}

function convertUserContent(
  msg: Extract<Message, { role: "user" }>,
): string | Array<Record<string, unknown>> {
  const content = msg.content;
  if (typeof content === "string") {
    return content;
  }

  const textParts: string[] = [];
  const imageParts: Array<Record<string, unknown>> = [];

  for (const block of content) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "image") {
      const dataUrl = `data:${block.mimeType};base64,${block.data}`;
      imageParts.push({
        type: "image_url",
        image_url: { url: dataUrl },
      });
    }
  }

  if (imageParts.length === 0) {
    return textParts.join("");
  }

  const parts: Array<Record<string, unknown>> = [];
  if (textParts.length > 0) {
    parts.push({ type: "text", text: textParts.join("") });
  }
  parts.push(...imageParts);
  return parts;
}

// ── message conversion: Responses API ────────────────────────────────────────

type ResponsesInputItem =
  | { type: "message"; role: "system" | "developer" | "user" | "assistant"; content: unknown[] }
  | { type: "function_call_output"; call_id: string; output: string };

function toResponsesInput(context: Context): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];

  if (context.systemPrompt) {
    items.push({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: context.systemPrompt }],
    });
  }

  for (const msg of context.messages) {
    if (msg.role === "user") {
      const content: unknown[] = [];
      const userContent = msg.content;
      if (typeof userContent === "string") {
        content.push({ type: "input_text", text: userContent });
      } else {
        for (const block of userContent) {
          if (block.type === "text") {
            content.push({ type: "input_text", text: block.text });
          } else if (block.type === "image") {
            content.push({
              type: "input_image",
              source: {
                type: "base64",
                media_type: block.mimeType,
                data: block.data,
              },
            });
          }
        }
      }
      items.push({
        type: "message",
        role: "user",
        content: content.length > 0 ? content : [{ type: "input_text", text: "" }],
      });
    } else if (msg.role === "assistant") {
      const content: unknown[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          content.push({ type: "output_text", text: block.text });
        } else if (block.type === "thinking") {
          // thinking is not replayed in input; skip
        } else if (block.type === "toolCall") {
          // In responses API, tool calls appear as function_call items
          // but for replay we typically just include the assistant message
          // with text content and let the API handle it
        }
      }
      if (content.length > 0) {
        items.push({ type: "message", role: "assistant", content });
      }
    } else if (msg.role === "toolResult") {
      const textContent = msg.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      items.push({
        type: "function_call_output",
        call_id: msg.toolCallId,
        output: textContent || "(no output)",
      });
    }
  }

  return items;
}

function toResponsesTools(context: Context): Array<Record<string, unknown>> | undefined {
  if (!context.tools || context.tools.length === 0) {
    return undefined;
  }
  return canonicalizeProviderTools(
    context.tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: canonicalizeProviderToolSchema(tool.parameters),
    })),
  ) as Array<Record<string, unknown>>;
}

// ── Chat Completions tools ───────────────────────────────────────────────────

function toChatCompletionsTools(context: Context): Array<Record<string, unknown>> | undefined {
  if (!context.tools || context.tools.length === 0) {
    return undefined;
  }
  return canonicalizeProviderTools(
    context.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: canonicalizeProviderToolSchema(tool.parameters),
      },
    })),
  ) as Array<Record<string, unknown>>;
}

// ── Responses API transport stream ───────────────────────────────────────────

export function createOpenAIResponsesTransportStreamFn(): StreamFn {
  return (rawModel, context, rawOptions) => {
    const model = rawModel as Model;
    const options = rawOptions as SimpleStreamOptions | undefined;
    const { eventStream, stream } = createWritableTransportEventStream();
    void (async () => {
      const output: MutableAssistantOutput = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: createEmptyTransportUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      };
      try {
        const apiKey = options?.apiKey ?? getEnvApiKey(model.provider) ?? "";
        if (!apiKey) {
          throw new Error(`No API key for provider: ${model.provider}`);
        }
        const shadowCall = beginShadowModelCall(
          context,
          {
            providerId: model.provider,
            adapterId: model.api,
            modelId: model.id,
            sessionKey: options?.sessionId,
          },
          options,
        );
        const fetch = buildGuardedModelFetch(
          model,
          undefined,
          undefined,
          shadowCall.active ? shadowCall.options : undefined,
        );

        const client = new OpenAI({
          baseURL: model.baseUrl,
          apiKey,
          fetch,
        });

        const input = toResponsesInput(context);
        const tools = toResponsesTools(context);

        const params: Record<string, unknown> = {
          model: model.id,
          input,
          stream: true,
        };

        if (options?.temperature !== undefined) {
          params.temperature = options.temperature;
        }
        if (options?.maxTokens !== undefined) {
          params.max_output_tokens = options.maxTokens;
        }
        if (tools) {
          params.tools = tools;
        }
        if (options?.signal) {
          params.signal = options.signal;
        }

        const nextParams = await options?.onPayload?.(params, model);
        if (nextParams !== undefined) {
          Object.assign(params, nextParams);
        }
        finalizeOpenAIProviderParams(params);
        recordFinalOpenAIProviderPayload(options, params, "openai-responses-transport");

        const responseStream = await client.responses.create(
          params as unknown as Record<string, unknown>,
        );

        // Cast to get the async iterable shape
        const blocks = output.content;

        for await (const event of responseStream as unknown as AsyncIterable<Record<string, unknown>>) {
          const eventType = resolveResponsesEventType(event);

          if (eventType === "response.created") {
            const response = event.response as Record<string, unknown> | undefined;
            output.responseId =
              typeof response?.id === "string" ? response.id : undefined;
            continue;
          }

          if (eventType === "response.in_progress") {
            stream.push({ type: "start", partial: output as never });
            continue;
          }

          if (eventType === "response.content_part.added") {
            const part = event.part as Record<string, unknown> | undefined;
            const outputIndex =
              typeof event.output_index === "number"
                ? event.output_index
                : blocks.length;
            if (part?.type === "output_text") {
              const block: TransportContentBlock = {
                type: "text",
                text: "",
                index: outputIndex,
              };
              output.content.push(block);
              stream.push({
                type: "text_start",
                contentIndex: output.content.length - 1,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.output_text.delta") {
            const delta = typeof event.delta === "string" ? event.delta : "";
            if (delta.length === 0) continue;
            const text = sanitizeTransportPayloadText(delta);
            if (text.length === 0) continue;

            // Find the text block by content_index or use the last text block
            const contentIndex =
              typeof event.content_index === "number"
                ? event.content_index
                : blocks.length - 1;
            const block = blocks[contentIndex];
            if (block?.type === "text") {
              block.text += text;
              stream.push({
                type: "text_delta",
                contentIndex,
                delta: text,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.output_text.done") {
            const contentIndex =
              typeof event.content_index === "number"
                ? event.content_index
                : blocks.length - 1;
            const block = blocks[contentIndex];
            if (block?.type === "text") {
              const doneText =
                typeof event.text === "string" ? event.text : undefined;
              if (doneText !== undefined) {
                block.text = doneText;
              }
              stream.push({
                type: "text_end",
                contentIndex,
                content: block.text,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.reasoning_summary_part.added") {
            const outputIndex =
              typeof event.output_index === "number"
                ? event.output_index
                : blocks.length;
            const summary = event.summary as
              | { text?: string; id?: string }
              | undefined;
            const block: TransportContentBlock = {
              type: "thinking",
              thinking: typeof summary?.text === "string" ? summary.text : "",
              thinkingSignature:
                typeof summary?.id === "string" ? summary.id : "reasoning_summary",
              index: outputIndex,
            };
            output.content.push(block);
            const contentIndex = output.content.length - 1;
            stream.push({
              type: "thinking_start",
              contentIndex,
              partial: output as never,
            });
            if (block.thinking.length > 0) {
              stream.push({
                type: "thinking_delta",
                contentIndex,
                delta: block.thinking,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.reasoning_summary_text.delta") {
            const delta = typeof event.delta === "string" ? event.delta : "";
            if (delta.length === 0) continue;
            const text = sanitizeTransportPayloadText(delta);
            if (text.length === 0) continue;

            const contentIndex =
              typeof event.content_index === "number"
                ? event.content_index
                : blocks.length - 1;
            const block = blocks[contentIndex];
            if (block?.type === "thinking") {
              block.thinking += text;
              stream.push({
                type: "thinking_delta",
                contentIndex,
                delta: text,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.reasoning_summary_text.done") {
            const contentIndex =
              typeof event.content_index === "number"
                ? event.content_index
                : blocks.length - 1;
            const block = blocks[contentIndex];
            if (block?.type === "thinking") {
              stream.push({
                type: "thinking_end",
                contentIndex,
                content: block.thinking,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.output_item.added") {
            const item = event.item as Record<string, unknown> | undefined;
            if (item?.type === "function_call") {
              const block: TransportContentBlock = {
                type: "toolCall",
                id: resolveResponsesFunctionCallId(item),
                name: typeof item.name === "string" ? item.name : "",
                arguments: {},
                partialJson: "",
                index:
                  typeof event.output_index === "number"
                    ? event.output_index
                    : blocks.length,
              };
              output.content.push(block);
              stream.push({
                type: "toolcall_start",
                contentIndex: output.content.length - 1,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.function_call_arguments.delta") {
            const delta = typeof event.delta === "string" ? event.delta : "";
            if (delta.length === 0) continue;
            const outputIndex =
              typeof event.output_index === "number" ? event.output_index : -1;
            const idx = blocks.findIndex(
              (b) => b.type === "toolCall" && b.index === outputIndex,
            );
            const block = idx !== -1 ? blocks[idx] : undefined;
            if (block?.type === "toolCall") {
              const partialJson = `${block.partialJson ?? ""}${delta}`;
              block.partialJson = partialJson;
              block.arguments = parseToolCallArguments(partialJson);
              stream.push({
                type: "toolcall_delta",
                contentIndex: idx,
                delta,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.function_call_arguments.done") {
            const outputIndex =
              typeof event.output_index === "number" ? event.output_index : -1;
            const idx = blocks.findIndex(
              (b) => b.type === "toolCall" && b.index === outputIndex,
            );
            const block = idx !== -1 ? blocks[idx] : undefined;
            if (block?.type === "toolCall") {
              const doneArgs =
                typeof event.arguments === "string" ? event.arguments : undefined;
              if (doneArgs !== undefined) {
                block.partialJson = doneArgs;
                block.arguments = coerceTransportToolCallArguments(
                  parseToolCallArguments(doneArgs),
                );
              } else if (typeof block.partialJson === "string" && block.partialJson.length > 0) {
                block.arguments = coerceTransportToolCallArguments(
                  parseToolCallArguments(block.partialJson),
                );
              }
              delete block.partialJson;
              delete block.index;
              stream.push({
                type: "toolcall_end",
                contentIndex: idx,
                toolCall: block as never,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.output_item.done") {
            const item = event.item as Record<string, unknown> | undefined;
            if (item?.type === "function_call") {
              const outputIndex =
                typeof event.output_index === "number" ? event.output_index : -1;
              const idx = blocks.findIndex(
                (b) =>
                  b.type === "toolCall" &&
                  (b.index === outputIndex || b.id === resolveResponsesFunctionCallId(item)),
              );
              if (idx !== -1) {
                const b = blocks[idx];
                if (b.type === "toolCall") {
                  const doneArgs = typeof item.arguments === "string" ? item.arguments : undefined;
                  if (doneArgs !== undefined) {
                    b.arguments = coerceTransportToolCallArguments(
                      parseToolCallArguments(doneArgs),
                    );
                  } else if (typeof b.partialJson === "string" && b.partialJson.length > 0) {
                    b.arguments = coerceTransportToolCallArguments(
                      parseToolCallArguments(b.partialJson),
                    );
                  }
                  const wasPending = b.partialJson !== undefined || b.index !== undefined;
                  delete b.partialJson;
                  delete b.index;
                  if (wasPending) {
                    stream.push({
                      type: "toolcall_end",
                      contentIndex: idx,
                      toolCall: b as never,
                      partial: output as never,
                    });
                  }
                }
              }
            }
            // For message items, we rely on content_part done events
            continue;
          }

          if (eventType === "response.completed") {
            const response = event.response as Record<string, unknown> | undefined;
            const usage = response?.usage as Record<string, unknown> | undefined;
            const stopReason =
              typeof response?.status === "string" ? response.status : undefined;

            output.stopReason = resolveResponsesStopReason(
              stopReason,
              output.content.some((block) => block.type === "toolCall"),
            );

            applyProviderUsage(output, model, usage);
          }
        }

        // Clean up any remaining index properties
        for (const block of output.content) {
          delete block.index;
        }
        finalizeTransportStream({
          stream,
          output,
          signal: options?.signal,
        });
      } catch (error) {
        failTransportStream({
          stream,
          output,
          signal: options?.signal,
          error,
          cleanup: () => {
            for (const block of output.content) {
              delete block.index;
            }
          },
        });
      }
    })();
    return eventStream as ReturnType<StreamFn>;
  };
}

// ── Chat Completions transport stream ────────────────────────────────────────

export function createOpenAICompletionsTransportStreamFn(): StreamFn {
  return (rawModel, context, rawOptions) => {
    const model = rawModel as Model;
    const options = rawOptions as SimpleStreamOptions | undefined;
    const { eventStream, stream } = createWritableTransportEventStream();
    void (async () => {
      const output: MutableAssistantOutput = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: createEmptyTransportUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      };
      try {
        const apiKey = options?.apiKey ?? getEnvApiKey(model.provider) ?? "";
        if (!apiKey) {
          throw new Error(`No API key for provider: ${model.provider}`);
        }
        const shadowCall = beginShadowModelCall(
          context,
          {
            providerId: model.provider,
            adapterId: model.api,
            modelId: model.id,
            sessionKey: options?.sessionId,
          },
          options,
        );
        const fetch = buildGuardedModelFetch(
          model,
          undefined,
          undefined,
          shadowCall.active ? shadowCall.options : undefined,
        );

        const client = new OpenAI({
          baseURL: model.baseUrl,
          apiKey,
          fetch,
        });

        const messages = toChatCompletionsMessages(context);
        const tools = toChatCompletionsTools(context);

        const params: Record<string, unknown> = {
          model: model.id,
          messages,
          stream: true,
          stream_options: { include_usage: true },
        };

        if (options?.temperature !== undefined) {
          params.temperature = options.temperature;
        }
        if (options?.maxTokens !== undefined) {
          // Use max_completion_tokens for o1/o3 models, max_tokens for others
          params.max_tokens = options.maxTokens;
        }
        if (tools) {
          params.tools = tools;
        }
        if (options?.signal) {
          params.signal = options.signal;
        }

        const nextParams = await options?.onPayload?.(params, model);
        if (nextParams !== undefined) {
          Object.assign(params, nextParams);
        }
        finalizeOpenAIProviderParams(params);
        recordFinalOpenAIProviderPayload(options, params, "openai-completions-transport");

        const chatStream = await client.chat.completions.create(params as any);

        const blocks = output.content;
        // Track tool call deltas by index
        const toolCallIndexes = new Map<number, number>(); // choice index -> content index

        for await (const chunk of chatStream as unknown as AsyncIterable<Record<string, unknown>>) {
          const choices =
            (chunk.choices as Array<Record<string, unknown>> | undefined) ?? [];

          // Handle usage chunk (sent when stream_options.include_usage is true)
          const usage = chunk.usage as Record<string, unknown> | undefined;
          if (usage) {
            applyProviderUsage(output, model, usage);
            continue;
          }

          for (const choice of choices) {
            const finishReason =
              typeof choice.finish_reason === "string"
                ? choice.finish_reason
                : undefined;
            const delta = choice.delta as Record<string, unknown> | undefined;
            const choiceIndex =
              typeof choice.index === "number" ? choice.index : 0;

            if (finishReason) {
              output.stopReason = mapStopReason(finishReason);
            }

            if (!delta) continue;

            // Handle reasoning_content (thinking) deltas (DeepSeek, etc.)
            const reasoningContent =
              typeof delta.reasoning_content === "string"
                ? delta.reasoning_content
                : undefined;
            if (reasoningContent !== undefined && reasoningContent.length > 0) {
              const text = sanitizeTransportPayloadText(reasoningContent);
              if (text.length > 0) {
                const key = `reasoning_${choiceIndex}`;
                void key;
                let contentIndex = toolCallIndexes.get(
                  // Use negative key range for reasoning to avoid collision with tool calls
                  -(choiceIndex + 1),
                );
                // Find existing thinking block or create one
                let block: TransportContentBlock | undefined;
                if (contentIndex !== undefined) {
                  block = blocks[contentIndex];
                } else {
                  // Look for the last thinking block without an index
                  for (let i = blocks.length - 1; i >= 0; i--) {
                    if (blocks[i]?.type === "thinking") {
                      contentIndex = i;
                      break;
                    }
                  }
                  if (contentIndex === undefined) {
                    block = {
                      type: "thinking",
                      thinking: "",
                      thinkingSignature: "reasoning_content",
                    };
                    blocks.push(block);
                    contentIndex = blocks.length - 1;
                    stream.push({
                      type: "thinking_start",
                      contentIndex,
                      partial: output as never,
                    });
                  }
                  // Store for next delta
                  if (contentIndex !== undefined) {
                    toolCallIndexes.set(-(choiceIndex + 1), contentIndex);
                  }
                }
                if (contentIndex !== undefined) {
                  block = blocks[contentIndex];
                  if (block?.type === "thinking") {
                    block.thinking += text;
                    stream.push({
                      type: "thinking_delta",
                      contentIndex,
                      delta: text,
                      partial: output as never,
                    });
                  }
                }
              }
            }

            // Handle text deltas
            const textContent =
              typeof delta.content === "string" ? delta.content : undefined;
            if (
              textContent !== undefined &&
              textContent.length > 0 &&
              textContent !== null
            ) {
              const text = sanitizeTransportPayloadText(textContent);
              if (text.length > 0) {
                let contentIndex: number | undefined;
                // Find last text block with matching index
                for (let i = blocks.length - 1; i >= 0; i--) {
                  if (
                    blocks[i]?.type === "text" &&
                    blocks[i]?.index === choiceIndex
                  ) {
                    contentIndex = i;
                    break;
                  }
                }
                if (contentIndex === undefined) {
                  const block: TransportContentBlock = {
                    type: "text",
                    text: "",
                    index: choiceIndex,
                  };
                  blocks.push(block);
                  contentIndex = blocks.length - 1;
                  stream.push({
                    type: "text_start",
                    contentIndex,
                    partial: output as never,
                  });
                }
                const block = blocks[contentIndex];
                if (block?.type === "text") {
                  block.text += text;
                  stream.push({
                    type: "text_delta",
                    contentIndex,
                    delta: text,
                    partial: output as never,
                  });
                }
              }
            }

            // Handle tool call deltas
            const toolCalls = delta.tool_calls as
              | Array<Record<string, unknown>>
              | undefined;
            if (toolCalls) {
              for (const toolCallDelta of toolCalls) {
                const toolIndex =
                  typeof toolCallDelta.index === "number"
                    ? toolCallDelta.index
                    : 0;
                const toolId =
                  typeof toolCallDelta.id === "string"
                    ? toolCallDelta.id
                    : undefined;
                const toolFunction = toolCallDelta.function as
                  | Record<string, unknown>
                  | undefined;
                const toolName =
                  typeof toolFunction?.name === "string"
                    ? toolFunction.name
                    : undefined;
                const toolArgs =
                  typeof toolFunction?.arguments === "string"
                    ? toolFunction.arguments
                    : undefined;

                // Accumulate streamed argument fragments into a single block per
                // tool index. Lookup and store MUST use the same key — previously
                // the get() used a string key while set() used the numeric index,
                // so every delta created a new block and arguments never assembled
                // (tools received {} and failed schema validation).
                let contentIndex = toolCallIndexes.get(toolIndex);
                if (contentIndex === undefined) {
                  // Create new tool call block
                  const block: TransportContentBlock = {
                    type: "toolCall",
                    id: toolId ?? "",
                    name: toolName ?? "",
                    arguments: {},
                    partialJson: "",
                    index: toolIndex,
                  };
                  blocks.push(block);
                  contentIndex = blocks.length - 1;
                  toolCallIndexes.set(toolIndex, contentIndex);
                  stream.push({
                    type: "toolcall_start",
                    contentIndex,
                    partial: output as never,
                  });
                }

                const block = blocks[contentIndex];
                if (block?.type === "toolCall") {
                  if (toolId) block.id = toolId;
                  if (toolName) block.name = toolName;
                  if (toolArgs) {
                    const partialJson = `${block.partialJson ?? ""}${toolArgs}`;
                    block.partialJson = partialJson;
                    block.arguments = parseToolCallArguments(partialJson);
                    stream.push({
                      type: "toolcall_delta",
                      contentIndex,
                      delta: toolArgs,
                      partial: output as never,
                    });
                  }
                }
              }
            }
          }

          // Handle finish_reason for text/tool blocks
          for (const choice of choices) {
            const finishReason =
              typeof choice.finish_reason === "string"
                ? choice.finish_reason
                : undefined;

            if (finishReason) {
              const choiceIndex =
                typeof choice.index === "number" ? choice.index : 0;

              // End any open text block
              for (let i = blocks.length - 1; i >= 0; i--) {
                const block = blocks[i];
                if (block?.type === "text" && block.index === choiceIndex) {
                  delete block.index;
                  stream.push({
                    type: "text_end",
                    contentIndex: i,
                    content: block.text,
                    partial: output as never,
                  });
                  break;
                }
              }

              // End any open thinking block (reasoning content)
              for (let i = blocks.length - 1; i >= 0; i--) {
                const block = blocks[i];
                if (block?.type === "thinking" && block.thinkingSignature === "reasoning_content") {
                  stream.push({
                    type: "thinking_end",
                    contentIndex: i,
                    content: block.thinking,
                    partial: output as never,
                  });
                  break;
                }
              }

              // End any open tool call blocks
              for (let i = blocks.length - 1; i >= 0; i--) {
                const block = blocks[i];
                if (
                  block?.type === "toolCall" &&
                  typeof block.partialJson === "string" &&
                  block.partialJson.length > 0
                ) {
                  block.arguments = coerceTransportToolCallArguments(
                    parseToolCallArguments(block.partialJson),
                  );
                }
                if (block?.type === "toolCall") {
                  delete block.partialJson;
                  delete block.index;
                  stream.push({
                    type: "toolcall_end",
                    contentIndex: i,
                    toolCall: block as never,
                    partial: output as never,
                  });
                }
              }
            }
          }
        }

        // Clean up remaining index properties
        for (const block of output.content) {
          delete block.index;
        }
        finalizeTransportStream({
          stream,
          output,
          signal: options?.signal,
        });
      } catch (error) {
        failTransportStream({
          stream,
          output,
          signal: options?.signal,
          error,
          cleanup: () => {
            for (const block of output.content) {
              delete block.index;
            }
          },
        });
      }
    })();
    return eventStream as ReturnType<StreamFn>;
  };
}

// ── Azure OpenAI Responses transport stream ──────────────────────────────────

/** Keep existing implementation: resolve API version from env. */
export function resolveAzureOpenAIApiVersion(env = process.env): string {
  return env.AZURE_OPENAI_API_VERSION || "preview";
}

export function createAzureOpenAIResponsesTransportStreamFn(): StreamFn {
  return (rawModel, context, rawOptions) => {
    const model = rawModel as Model;
    const options = rawOptions as SimpleStreamOptions | undefined;
    const { eventStream, stream } = createWritableTransportEventStream();
    void (async () => {
      const output: MutableAssistantOutput = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: createEmptyTransportUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      };
      try {
        const apiKey = options?.apiKey ?? getEnvApiKey(model.provider) ?? "";
        if (!apiKey) {
          throw new Error(`No API key for provider: ${model.provider}`);
        }
        const apiVersion = resolveAzureOpenAIApiVersion();
        const shadowCall = beginShadowModelCall(
          context,
          {
            providerId: model.provider,
            adapterId: model.api,
            modelId: model.id,
            sessionKey: options?.sessionId,
          },
          options,
        );
        const fetch = buildGuardedModelFetch(
          model,
          undefined,
          undefined,
          shadowCall.active ? shadowCall.options : undefined,
        );

        // Resolve deployment name: use model.id or the deployment from model params
        const deployment =
          (model as { deployment?: string }).deployment ?? model.id;

        const client = new AzureOpenAI({
          apiKey,
          apiVersion,
          deployment,
          fetch,
        });

        const input = toResponsesInput(context);
        const tools = toResponsesTools(context);

        const params: Record<string, unknown> = {
          model: deployment,
          input,
          stream: true,
        };

        if (options?.temperature !== undefined) {
          params.temperature = options.temperature;
        }
        if (options?.maxTokens !== undefined) {
          params.max_output_tokens = options.maxTokens;
        }
        if (tools) {
          params.tools = tools;
        }
        if (options?.signal) {
          params.signal = options.signal;
        }

        const nextParams = await options?.onPayload?.(params, model);
        if (nextParams !== undefined) {
          Object.assign(params, nextParams);
        }
        finalizeOpenAIProviderParams(params);
        recordFinalOpenAIProviderPayload(options, params, "azure-openai-responses-transport");

        const responseStream = await client.responses.create(
          params as unknown as Record<string, unknown>,
        );

        const blocks = output.content;

        for await (const event of responseStream as unknown as AsyncIterable<Record<string, unknown>>) {
          const eventType = resolveResponsesEventType(event);

          if (eventType === "response.created") {
            const response = event.response as Record<string, unknown> | undefined;
            output.responseId =
              typeof response?.id === "string" ? response.id : undefined;
            continue;
          }

          if (eventType === "response.in_progress") {
            stream.push({ type: "start", partial: output as never });
            continue;
          }

          if (eventType === "response.content_part.added") {
            const part = event.part as Record<string, unknown> | undefined;
            if (part?.type === "output_text") {
              const outputIndex =
                typeof event.output_index === "number"
                  ? event.output_index
                  : blocks.length;
              const block: TransportContentBlock = {
                type: "text",
                text: "",
                index: outputIndex,
              };
              output.content.push(block);
              stream.push({
                type: "text_start",
                contentIndex: output.content.length - 1,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.output_text.delta") {
            const delta = typeof event.delta === "string" ? event.delta : "";
            if (delta.length === 0) continue;
            const text = sanitizeTransportPayloadText(delta);
            if (text.length === 0) continue;

            const contentIndex =
              typeof event.content_index === "number"
                ? event.content_index
                : blocks.length - 1;
            const block = blocks[contentIndex];
            if (block?.type === "text") {
              block.text += text;
              stream.push({
                type: "text_delta",
                contentIndex,
                delta: text,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.output_text.done") {
            const contentIndex =
              typeof event.content_index === "number"
                ? event.content_index
                : blocks.length - 1;
            const block = blocks[contentIndex];
            if (block?.type === "text") {
              const doneText =
                typeof event.text === "string" ? event.text : undefined;
              if (doneText !== undefined) {
                block.text = doneText;
              }
              stream.push({
                type: "text_end",
                contentIndex,
                content: block.text,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.reasoning_summary_part.added") {
            const outputIndex =
              typeof event.output_index === "number"
                ? event.output_index
                : blocks.length;
            const summary = event.summary as
              | { text?: string; id?: string }
              | undefined;
            const block: TransportContentBlock = {
              type: "thinking",
              thinking: typeof summary?.text === "string" ? summary.text : "",
              thinkingSignature:
                typeof summary?.id === "string" ? summary.id : "reasoning_summary",
              index: outputIndex,
            };
            output.content.push(block);
            const contentIndex = output.content.length - 1;
            stream.push({
              type: "thinking_start",
              contentIndex,
              partial: output as never,
            });
            if (block.thinking.length > 0) {
              stream.push({
                type: "thinking_delta",
                contentIndex,
                delta: block.thinking,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.reasoning_summary_text.delta") {
            const delta = typeof event.delta === "string" ? event.delta : "";
            if (delta.length === 0) continue;
            const text = sanitizeTransportPayloadText(delta);
            if (text.length === 0) continue;

            const contentIndex =
              typeof event.content_index === "number"
                ? event.content_index
                : blocks.length - 1;
            const block = blocks[contentIndex];
            if (block?.type === "thinking") {
              block.thinking += text;
              stream.push({
                type: "thinking_delta",
                contentIndex,
                delta: text,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.reasoning_summary_text.done") {
            const contentIndex =
              typeof event.content_index === "number"
                ? event.content_index
                : blocks.length - 1;
            const block = blocks[contentIndex];
            if (block?.type === "thinking") {
              stream.push({
                type: "thinking_end",
                contentIndex,
                content: block.thinking,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.output_item.added") {
            const item = event.item as Record<string, unknown> | undefined;
            if (item?.type === "function_call") {
              const block: TransportContentBlock = {
                type: "toolCall",
                id: resolveResponsesFunctionCallId(item),
                name: typeof item.name === "string" ? item.name : "",
                arguments: {},
                partialJson: "",
                index:
                  typeof event.output_index === "number"
                    ? event.output_index
                    : blocks.length,
              };
              output.content.push(block);
              stream.push({
                type: "toolcall_start",
                contentIndex: output.content.length - 1,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.function_call_arguments.delta") {
            const delta = typeof event.delta === "string" ? event.delta : "";
            if (delta.length === 0) continue;
            const outputIndex =
              typeof event.output_index === "number" ? event.output_index : -1;
            const idx = blocks.findIndex(
              (b) => b.type === "toolCall" && b.index === outputIndex,
            );
            const block = idx !== -1 ? blocks[idx] : undefined;
            if (block?.type === "toolCall") {
              const partialJson = `${block.partialJson ?? ""}${delta}`;
              block.partialJson = partialJson;
              block.arguments = parseToolCallArguments(partialJson);
              stream.push({
                type: "toolcall_delta",
                contentIndex: idx,
                delta,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.function_call_arguments.done") {
            const outputIndex =
              typeof event.output_index === "number" ? event.output_index : -1;
            const idx = blocks.findIndex(
              (b) => b.type === "toolCall" && b.index === outputIndex,
            );
            const block = idx !== -1 ? blocks[idx] : undefined;
            if (block?.type === "toolCall") {
              const doneArgs =
                typeof event.arguments === "string" ? event.arguments : undefined;
              if (doneArgs !== undefined) {
                block.partialJson = doneArgs;
                block.arguments = coerceTransportToolCallArguments(
                  parseToolCallArguments(doneArgs),
                );
              } else if (
                typeof block.partialJson === "string" &&
                block.partialJson.length > 0
              ) {
                block.arguments = coerceTransportToolCallArguments(
                  parseToolCallArguments(block.partialJson),
                );
              }
              delete block.partialJson;
              delete block.index;
              stream.push({
                type: "toolcall_end",
                contentIndex: idx,
                toolCall: block as never,
                partial: output as never,
              });
            }
            continue;
          }

          if (eventType === "response.completed") {
            const response = event.response as Record<string, unknown> | undefined;
            const usage = response?.usage as Record<string, unknown> | undefined;
            const stopReason =
              typeof response?.status === "string" ? response.status : undefined;

            output.stopReason = resolveResponsesStopReason(
              stopReason,
              output.content.some((block) => block.type === "toolCall"),
            );

            applyProviderUsage(output, model, usage);
          }
        }

        for (const block of output.content) {
          delete block.index;
        }
        finalizeTransportStream({
          stream,
          output,
          signal: options?.signal,
        });
      } catch (error) {
        failTransportStream({
          stream,
          output,
          signal: options?.signal,
          error,
          cleanup: () => {
            for (const block of output.content) {
              delete block.index;
            }
          },
        });
      }
    })();
    return eventStream as ReturnType<StreamFn>;
  };
}

// ── buildOpenAICompletionsParams ─────────────────────────────────────────────

export function buildOpenAICompletionsParams(
  model: Model,
  context: Context,
  options?: SimpleStreamOptions,
): Record<string, unknown> {
  const messages = toChatCompletionsMessages(context);
  const tools = toChatCompletionsTools(context);

  const params: Record<string, unknown> = {
    model: model.id,
    messages,
    stream: true,
  };

  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }
  if (options?.maxTokens !== undefined) {
    params.max_tokens = options.maxTokens;
  }

  const extraOpts = options as Record<string, unknown> | undefined;
  if (extraOpts?.top_p !== undefined) {
    params.top_p = extraOpts.top_p;
  }
  if (tools) {
    params.tools = tools;
  }
  if (extraOpts?.toolChoice !== undefined) {
    params.tool_choice = extraOpts.toolChoice;
  }
  if (options?.stop) {
    params.stop = options.stop;
  }

  // Include usage in stream by default for token tracking
  params.stream_options = { include_usage: true };
  finalizeOpenAIProviderParams(params);

  return params;
}

export const testing = {
  resolveResponsesEventType,
  resolveResponsesFunctionCallId,
  resolveResponsesStopReason,
};
