// @vitest-environment node
// NET-D (TF-0441): typed stream failure and failed-attempt isolation.
import { describe, expect, it } from "vitest";

import type { AgentMessage } from "../runtime/index.js";
import { wrapAnthropicStreamWithRecovery } from "./embedded-agent-runner/thinking.js";
import { FailoverError } from "./failover-error.js";
import {
  classifyStreamFailure,
  isAbortLikeStreamError,
  isStreamFailureError,
  planFailedAttemptRetry,
  sanitizeFailedAttemptTranscriptMessage,
  toStreamFailure,
} from "./stream-failure.js";

function assistantMessage(content: unknown[], stopReason: string): AgentMessage {
  return {
    role: "assistant",
    content,
    stopReason,
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

describe("typed stream failure", () => {
  it("classifies status codes and keeps them retryable or not", () => {
    const rateLimited = classifyStreamFailure(
      Object.assign(new Error("too many requests"), { status: 429 }),
      { phase: "after_headers", partialOutput: false },
    );
    expect(rateLimited).toMatchObject({
      code: "rate_limit",
      reason: "rate_limit",
      isRetryable: true,
      phase: "after_headers",
      status: 429,
    });
    const server = classifyStreamFailure(
      Object.assign(new Error("bad gateway"), { status: 503 }),
      { phase: "after_headers", partialOutput: false },
    );
    expect(server).toMatchObject({ code: "server_error", isRetryable: true, status: 503 });
    const unauthorized = classifyStreamFailure(
      Object.assign(new Error("invalid api key"), { status: 401 }),
      { phase: "before_headers", partialOutput: false },
    );
    expect(unauthorized).toMatchObject({ code: "auth", reason: "auth", isRetryable: false });
    const billing = classifyStreamFailure(
      new FailoverError("insufficient credits", { reason: "billing", status: 402 }),
      { phase: "before_headers", partialOutput: false },
    );
    expect(billing).toMatchObject({ code: "billing", reason: "billing", isRetryable: false });
  });

  it("classifies transport and timeout errors with the shared timeout mapping", () => {
    const transport = classifyStreamFailure(new Error("socket hang up"), {
      phase: "after_headers",
      partialOutput: true,
    });
    expect(transport).toMatchObject({
      code: "transport",
      reason: "timeout",
      isRetryable: true,
      partialOutput: true,
    });
    const timeout = classifyStreamFailure(new Error("request timed out"), {
      phase: "after_headers",
      partialOutput: false,
    });
    expect(timeout).toMatchObject({ code: "timeout", reason: "timeout", isRetryable: true });
  });

  it("maps unknown failures to a non-retryable unknown classification", () => {
    const unknown = classifyStreamFailure(new Error("something odd happened"), {
      phase: "after_headers",
      partialOutput: false,
    });
    expect(unknown).toMatchObject({ code: "unknown", reason: "unknown", isRetryable: false });
    expect(isStreamFailureError(unknown)).toBe(true);
    expect(classifyStreamFailure(unknown, { phase: "after_headers", partialOutput: true })).toBe(
      unknown,
    );
  });

  it("never rewraps abort or disconnect errors", () => {
    const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    expect(isAbortLikeStreamError(abort)).toBe(true);
    expect(toStreamFailure(abort, { phase: "after_headers", partialOutput: true })).toBe(abort);
    const wrapped = toStreamFailure(new Error("socket hang up"), {
      phase: "after_headers",
      partialOutput: false,
    });
    expect(isStreamFailureError(wrapped)).toBe(true);
    expect((wrapped as Error).cause).toBeInstanceOf(Error);
  });
});

describe("failed-attempt isolation", () => {
  const failure = () =>
    classifyStreamFailure(new Error("socket hang up"), {
      phase: "after_headers",
      partialOutput: false,
    });

  it("allows only same-logical-step retries without observable effects", () => {
    const plan = planFailedAttemptRetry({
      attemptId: "attempt-1",
      failure: failure(),
      effects: { deliveredOutput: false, toolCalls: 0, approvals: 0, clientToolExecutions: 0 },
    });
    expect(plan.retry).toEqual({ allowed: true, sameLogicalStepOnly: true });
    expect(plan.isolation).toMatchObject({
      disposition: "discarded",
      reason: "transport",
      enteredFormalTranscript: false,
    });
  });

  it("blocks retries after partial output", () => {
    const plan = planFailedAttemptRetry({
      attemptId: "attempt-2",
      failure: failure(),
      effects: { deliveredOutput: true, toolCalls: 0, approvals: 0, clientToolExecutions: 0 },
    });
    expect(plan.retry).toEqual({
      allowed: false,
      sameLogicalStepOnly: true,
      blockedBy: "partial-output",
    });
  });

  it("blocks retries when the failed attempt produced tool effects", () => {
    const plan = planFailedAttemptRetry({
      attemptId: "attempt-3",
      failure: failure(),
      effects: { deliveredOutput: false, toolCalls: 2, approvals: 1, clientToolExecutions: 1 },
    });
    expect(plan.retry.blockedBy).toBe("tool-effects");
    expect(plan.isolation).toMatchObject({
      toolCallsDiscarded: 2,
      approvalsDiscarded: 1,
      clientToolExecutionsDiscarded: 1,
    });
  });

  it("blocks retries for non-retryable failures", () => {
    const plan = planFailedAttemptRetry({
      attemptId: "attempt-4",
      failure: classifyStreamFailure(
        Object.assign(new Error("invalid api key"), { status: 401 }),
        { phase: "before_headers", partialOutput: false },
      ),
      effects: { deliveredOutput: false, toolCalls: 0, approvals: 0, clientToolExecutions: 0 },
    });
    expect(plan.retry.blockedBy).toBe("not-retryable");
  });
});

describe("failed attempt transcript isolation", () => {
  it("drops tool calls from an error assistant message without mutating the original", () => {
    const original = assistantMessage(
      [
        { type: "text", text: "partial answer" },
        { type: "toolCall", id: "call-1", name: "read", arguments: {} },
      ],
      "error",
    );
    const sanitized = sanitizeFailedAttemptTranscriptMessage(original);
    expect(sanitized).not.toBe(original);
    expect((sanitized as { content: unknown[] }).content).toEqual([
      { type: "text", text: "partial answer" },
    ]);
    expect((original as { content: unknown[] }).content).toHaveLength(2);
  });

  it("drops provider-shaped tool blocks too", () => {
    const sanitized = sanitizeFailedAttemptTranscriptMessage(
      assistantMessage(
        [
          { type: "tool_use", id: "call-2", name: "read", input: {} },
          { type: "function_call", id: "call-3", name: "read", arguments: "{}" },
          { type: "thinking", thinking: "still here" },
        ],
        "error",
      ),
    );
    expect((sanitized as { content: unknown[] }).content).toEqual([
      { type: "thinking", thinking: "still here" },
    ]);
  });

  it("returns the same message when there is nothing to isolate", () => {
    const stopped = assistantMessage(
      [{ type: "toolCall", id: "call-4", name: "read", arguments: {} }],
      "toolUse",
    );
    expect(sanitizeFailedAttemptTranscriptMessage(stopped)).toBe(stopped);
    const errorWithoutTools = assistantMessage([{ type: "text", text: "boom" }], "error");
    expect(sanitizeFailedAttemptTranscriptMessage(errorWithoutTools)).toBe(errorWithoutTools);
    const userMessage = { role: "user", content: [{ type: "text", text: "hi" }] } as AgentMessage;
    expect(sanitizeFailedAttemptTranscriptMessage(userMessage)).toBe(userMessage);
  });
});

describe("stream wrapper typed failures", () => {
  function streamWithFailure(chunks: unknown[], failure: unknown) {
    const inner = (() => {
      return (async function* generate() {
        for (const chunk of chunks) {
          yield chunk;
        }
        throw failure;
      })();
    }) as never;
    return wrapAnthropicStreamWithRecovery(inner as never, { id: "session-typed-failure" });
  }

  it("reports a typed post-output failure while keeping delivered chunks", async () => {
    const wrapped = streamWithFailure(
      [{ type: "text_delta", contentIndex: 0, delta: "partial", partial: {} }],
      new Error("socket hang up"),
    );
    const stream = wrapped({} as never, {} as never, {} as never) as AsyncIterable<unknown> & {
      result: () => Promise<unknown>;
    };
    const delivered: unknown[] = [];
    const iterate = (async () => {
      for await (const chunk of stream) {
        delivered.push(chunk);
      }
    })();
    await expect(stream.result()).rejects.toMatchObject({
      name: "StreamFailureError",
      code: "transport",
      phase: "after_headers",
      partialOutput: true,
      isRetryable: true,
    });
    await iterate;
    expect(delivered).toHaveLength(1);
  });

  it("classifies a failure before any output as pre-output", async () => {
    const wrapped = streamWithFailure([], new Error("bad gateway"));
    const stream = wrapped({} as never, {} as never, {} as never) as AsyncIterable<unknown> & {
      result: () => Promise<unknown>;
    };
    const iterate = (async () => {
      for await (const _chunk of stream) {
        // drain
      }
    })();
    await expect(stream.result()).rejects.toMatchObject({
      name: "StreamFailureError",
      phase: "before_headers",
      partialOutput: false,
    });
    await iterate;
  });
});
