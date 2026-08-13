/**
 * DeepSeek prefix-continuation wrapper.
 *
 * Mirrors the DeepSeek-Reasonix `streamWithPrefixContinuation` behavior: when a
 * DeepSeek V4 completion ends with `finish_reason=length` and produced no tool
 * calls, one bounded follow-up request is issued against the official
 * `/beta/chat/completions` endpoint carrying the truncated assistant text as a
 * `prefix: true` assistant message. Usage and cache accounting are folded across
 * both requests. If the continuation fails before producing a completed turn,
 * the original truncated response is kept and its length finish reason reaches
 * the agent's existing truncation warning.
 *
 * Bounded to a single continuation (matching the reference maxPrefixContinuations
 * = 1), and host-gated so custom gateways that merely opt into the DeepSeek
 * reasoning wire shape are never bypassed by an automatic request to the
 * vendor's direct API.
 */
import type { AssistantMessage, Usage } from "../../llm/types.js";
import type { StreamFn } from "../runtime/index.js";

type StreamLike = Awaited<ReturnType<StreamFn>>;

/** Rewrite a DeepSeek base URL to the official Beta prefix-completion endpoint. */
export function toDeepSeekBetaPrefixUrl(baseUrl: string | undefined): string | undefined {
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "api.deepseek.com" && !host.endsWith(".deepseek.com")) {
    return undefined;
  }
  url.pathname = "/beta/chat/completions";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function hasToolCall(message: AssistantMessage): boolean {
  return message.content.some((block) => block.type === "toolCall");
}

function extractTurnText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function extractTurnReasoning(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking)
    .join("");
}

function foldUsage(first: Usage, second: Usage): Usage {
  return {
    input: first.input + second.input,
    output: first.output + second.output,
    cacheRead: first.cacheRead + second.cacheRead,
    cacheWrite: first.cacheWrite + second.cacheWrite,
    totalTokens: first.totalTokens + second.totalTokens,
    cost: {
      input: first.cost.input + second.cost.input,
      output: first.cost.output + second.cost.output,
      cacheRead: first.cost.cacheRead + second.cost.cacheRead,
      cacheWrite: first.cost.cacheWrite + second.cost.cacheWrite,
      total: first.cost.total + second.cost.total,
    },
  };
}

/** Build the `prefix: true` assistant message carrying the truncated turn text. */
function buildPrefixAssistantMessage(first: AssistantMessage, text: string): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: first.api,
    provider: first.provider,
    model: first.model,
    usage: first.usage,
    stopReason: "length",
    timestamp: first.timestamp,
  };
}

/**
 * Compose a continuation `onPayload` hook that marks the trailing assistant
 * message as `prefix: true` and carries forward the accumulated reasoning via
 * DeepSeek's `reasoning_content` wire field.
 */
function buildContinuationOnPayload(
  originalOnPayload: NonNullable<Parameters<StreamFn>[2]>["onPayload"],
  reasoning: string,
): NonNullable<Parameters<StreamFn>[2]>["onPayload"] {
  return (payload, model) => {
    if (payload && typeof payload === "object") {
      const record = payload as { messages?: unknown };
      if (Array.isArray(record.messages)) {
        const last = record.messages[record.messages.length - 1];
        if (last && typeof last === "object") {
          const lastMessage = last as Record<string, unknown>;
          lastMessage.prefix = true;
          if (reasoning) {
            lastMessage.reasoning_content = reasoning;
          }
        }
      }
    }
    return originalOnPayload ? originalOnPayload(payload, model) : undefined;
  };
}

function mergeAssistantMessages(first: AssistantMessage, second: AssistantMessage): AssistantMessage {
  return {
    ...second,
    content: [...first.content, ...second.content],
    usage: foldUsage(first.usage, second.usage),
    responseId: second.responseId ?? first.responseId,
  };
}

function wrapResultWithContinuation(params: {
  stream: StreamLike;
  baseStreamFn: StreamFn;
  model: Parameters<StreamFn>[0];
  context: Parameters<StreamFn>[1];
  options: Parameters<StreamFn>[2];
  betaUrl: string;
}): StreamLike {
  const { stream, baseStreamFn, model, context, options, betaUrl } = params;
  const originalResult = stream.result.bind(stream);

  stream.result = async () => {
    const first = await originalResult();
    if (first.stopReason !== "length" || hasToolCall(first)) {
      return first;
    }
    const text = extractTurnText(first);
    const reasoning = extractTurnReasoning(first);
    if (!text && !reasoning) {
      return first;
    }

    const prefixMessage = buildPrefixAssistantMessage(first, text);
    const betaModel = { ...model, baseUrl: betaUrl };
    const nextContext = {
      ...context,
      messages: [...context.messages, prefixMessage],
    };
    const nextOptions = {
      ...options,
      onPayload: buildContinuationOnPayload(options?.onPayload, reasoning),
    };

    let nextStream: StreamLike;
    try {
      nextStream = await baseStreamFn(betaModel, nextContext, nextOptions);
    } catch {
      // A continuation request that fails to start is a safe fallback.
      return first;
    }
    const second = await nextStream.result();
    if (second.stopReason === "error" || second.stopReason === "aborted") {
      // Beta failure before a completed turn: keep the truncated first response
      // so its length finish reason reaches the agent's truncation warning.
      return first;
    }
    return mergeAssistantMessages(first, second);
  };

  return stream;
}

export function createDeepSeekPrefixContinuationWrapper(params: {
  baseStreamFn: StreamFn | undefined;
  shouldPatchModel: (model: Parameters<StreamFn>[0]) => boolean;
}): StreamFn | undefined {
  const { baseStreamFn, shouldPatchModel } = params;
  if (!baseStreamFn) {
    return undefined;
  }
  return (model, context, options) => {
    if (!shouldPatchModel(model)) {
      return baseStreamFn(model, context, options);
    }
    const betaUrl = toDeepSeekBetaPrefixUrl(model.baseUrl);
    if (!betaUrl) {
      return baseStreamFn(model, context, options);
    }
    const maybeStream = baseStreamFn(model, context, options);
    const wrap = (stream: StreamLike): StreamLike =>
      wrapResultWithContinuation({
        stream,
        baseStreamFn,
        model,
        context,
        options,
        betaUrl,
      });
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then(wrap);
    }
    return wrap(maybeStream);
  };
}
