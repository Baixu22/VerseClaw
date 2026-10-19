/**
 * NET-D (TF-0441): typed stream failure and failed-attempt isolation.
 *
 * A provider stream can fail before the first byte (classified before headers)
 * or after deltas were already delivered (post-header). The post-header case is
 * the dangerous one: partial text may already be visible, and any tool calls or
 * approvals the failed attempt produced must never execute or enter the formal
 * transcript.
 *
 * This module gives that situation a typed error (`code`, `status`,
 * `isRetryable`, `phase`, `partialOutput`) that maps onto the existing
 * `FailoverReason` vocabulary, plus a small plan type that expresses the only
 * safe recovery shape: discard the failed attempt and, when nothing observable
 * happened, retry the same logical step.
 *
 * Boundaries:
 * - No unconditional replay: a retry is allowed only when the attempt produced
 *   no delivered output and no tool effect, mirroring the side-effect gate the
 *   runner already applies before resubmission.
 * - Abort/disconnect errors keep their original identity so `isAbortError()`
 *   and the client-disconnect handling keep working; callers use
 *   `toStreamFailure()` which returns those errors unchanged.
 * - The wire-level error envelope is unchanged; this type is an internal
 *   classification, not a new protocol surface.
 */
import { readErrorName } from "../infra/errors.js";
import type { AgentMessage } from "./runtime/index.js";
import type { FailoverReason } from "./embedded-agent-helpers/types.js";

/** Normalized failure classes for a provider stream. */
export type StreamFailureCode =
  | "aborted"
  | "client_disconnect"
  | "timeout"
  | "rate_limit"
  | "overloaded"
  | "server_error"
  | "auth"
  | "billing"
  | "format"
  | "transport"
  | "unknown";

/**
 * Where the failure happened relative to the provider stream itself:
 * `before_headers` - no stream event was delivered yet;
 * `after_headers` - the stream had already started (and may have delivered
 * output), so the failure can no longer be reported as a pre-stream error.
 */
export type StreamFailurePhase = "before_headers" | "after_headers";

export type StreamFailureInit = {
  code: StreamFailureCode;
  reason: FailoverReason;
  /** Whether a retry of the logical step could succeed without replaying effects. */
  retryable: boolean;
  phase: StreamFailurePhase;
  /** True when user-visible output was already delivered to the consumer. */
  partialOutput: boolean;
  status?: number;
  rawError?: string;
  cause?: unknown;
};

/** Typed stream failure carrying retryability and mapping onto failover reasons. */
export class StreamFailureError extends Error {
  readonly code: StreamFailureCode;
  readonly reason: FailoverReason;
  readonly isRetryable: boolean;
  readonly phase: StreamFailurePhase;
  readonly partialOutput: boolean;
  readonly status: number | undefined;
  readonly rawError: string | undefined;

  constructor(message: string, init: StreamFailureInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "StreamFailureError";
    this.code = init.code;
    this.reason = init.reason;
    this.isRetryable = init.retryable;
    this.phase = init.phase;
    this.partialOutput = init.partialOutput;
    this.status = init.status;
    this.rawError = init.rawError;
  }
}

export function isStreamFailureError(value: unknown): value is StreamFailureError {
  return value instanceof StreamFailureError;
}

const TRANSPORT_CODE_RE =
  /\b(?:econnreset|econnrefused|econnaborted|enetreset|enetunreach|ehostunreach|ehostdown|epipe|eai_again|etimedout|esockettimedout|und_err_socket|und_err_connect_timeout|socket hang up|connection reset|connection refused|connection aborted|network is unreachable|network request failed|fetch failed|terminated)\b/i;
const TIMEOUT_MESSAGE_RE = /\b(?:timed?\s*out|timeout|deadline exceeded)\b/i;
const OVERLOAD_RE = /\b(?:overloaded|529)\b/i;

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const record = error as { status?: unknown; statusCode?: unknown };
  const value = record.status ?? record.statusCode;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown };
    return [record.message, record.code].filter((v) => typeof v === "string").join(" ");
  }
  return "";
}

/** Abort/disconnect errors must keep their original identity for abort handling. */
export function isAbortLikeStreamError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = readErrorName(error);
  if (name === "AbortError" || name === "TimeoutError") {
    return true;
  }
  return /\b(?:request was aborted|request aborted|aborted)\b/i.test(readErrorText(error));
}

function classifyCode(error: unknown, status: number | undefined): StreamFailureCode {
  const text = readErrorText(error);
  if (isAbortLikeStreamError(error)) {
    return "aborted";
  }
  if (status === 429) {
    return "rate_limit";
  }
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 402) {
    return "billing";
  }
  if (status === 400 || status === 422) {
    return "format";
  }
  if (status === 529) {
    return "overloaded";
  }
  if (status !== undefined && status >= 500) {
    return "server_error";
  }
  if (OVERLOAD_RE.test(text)) {
    return "overloaded";
  }
  if (TRANSPORT_CODE_RE.test(text)) {
    return "transport";
  }
  if (TIMEOUT_MESSAGE_RE.test(text)) {
    return "timeout";
  }
  return "unknown";
}

/** Maps a stream failure code onto the existing failover reason vocabulary. */
export function toFailoverReason(code: StreamFailureCode): FailoverReason {
  switch (code) {
    case "rate_limit":
      return "rate_limit";
    case "overloaded":
      return "overloaded";
    case "timeout":
    case "transport":
      // The shared classifier maps transport error codes (ECONNRESET, EPIPE,
      // socket hang up...) onto the timeout reason; keep that mapping stable.
      return "timeout";
    case "server_error":
      return "server_error";
    case "auth":
      return "auth";
    case "billing":
      return "billing";
    case "format":
      return "format";
    case "aborted":
    case "client_disconnect":
    case "unknown":
      return "unknown";
  }
}

const RETRYABLE_CODES = new Set<StreamFailureCode>([
  "transport",
  "timeout",
  "rate_limit",
  "overloaded",
  "server_error",
]);

/** True when the failure class is transient and could be retried. */
export function isRetryableStreamFailureCode(code: StreamFailureCode): boolean {
  return RETRYABLE_CODES.has(code);
}

/** Classifies any thrown stream error into the typed stream-failure shape. */
export function classifyStreamFailure(
  error: unknown,
  params: { phase: StreamFailurePhase; partialOutput: boolean },
): StreamFailureError {
  if (isStreamFailureError(error)) {
    return error;
  }
  const status = readStatus(error);
  const code = classifyCode(error, status);
  const message = readErrorText(error) || "stream failed";
  return new StreamFailureError(message, {
    code,
    reason: toFailoverReason(code),
    retryable: isRetryableStreamFailureCode(code),
    phase: params.phase,
    partialOutput: params.partialOutput,
    ...(status === undefined ? {} : { status }),
    ...(message ? { rawError: message } : {}),
    cause: error,
  });
}

/**
 * Wraps a non-abort stream error into the typed shape; abort/disconnect errors
 * are returned unchanged so abort detection keeps working.
 */
export function toStreamFailure(
  error: unknown,
  params: { phase: StreamFailurePhase; partialOutput: boolean },
): unknown {
  if (isAbortLikeStreamError(error) || isStreamFailureError(error)) {
    return error;
  }
  return classifyStreamFailure(error, params);
}

/** Observable effects a failed attempt may have produced. */
export type FailedAttemptEffects = {
  /** Visible output already delivered to the consumer. */
  deliveredOutput: boolean;
  /** Tool calls the attempt produced (executed or not). */
  toolCalls: number;
  /** Approvals requested by the attempt. */
  approvals: number;
  /** Client tool executions started by the attempt. */
  clientToolExecutions: number;
};

/**
 * Recovery plan for one failed attempt. `disposition` is always `discarded`:
 * the failed attempt never continues, and a retry - when allowed - restarts the
 * same logical step with no replayed tool effects.
 */
export type FailedAttemptPlan = {
  attemptId: string;
  failure: StreamFailureError;
  isolation: {
    disposition: "discarded";
    reason: StreamFailureCode;
    toolCallsDiscarded: number;
    approvalsDiscarded: number;
    clientToolExecutionsDiscarded: number;
    enteredFormalTranscript: false;
  };
  retry: {
    allowed: boolean;
    /** Retries only restart the same logical step; never a new one. */
    sameLogicalStepOnly: true;
    blockedBy?: "partial-output" | "tool-effects" | "not-retryable";
  };
};

/** Builds the discard/retry plan for one failed stream attempt. */
export function planFailedAttemptRetry(params: {
  attemptId: string;
  failure: StreamFailureError;
  effects: FailedAttemptEffects;
}): FailedAttemptPlan {
  const { failure, effects } = params;
  const hadToolEffects =
    effects.toolCalls > 0 || effects.approvals > 0 || effects.clientToolExecutions > 0;
  const blockedBy: FailedAttemptPlan["retry"]["blockedBy"] = !failure.isRetryable
    ? "not-retryable"
    : hadToolEffects
      ? "tool-effects"
      : effects.deliveredOutput
        ? "partial-output"
        : undefined;
  return {
    attemptId: params.attemptId,
    failure,
    isolation: {
      disposition: "discarded",
      reason: failure.code,
      toolCallsDiscarded: effects.toolCalls,
      approvalsDiscarded: effects.approvals,
      clientToolExecutionsDiscarded: effects.clientToolExecutions,
      enteredFormalTranscript: false,
    },
    retry: {
      allowed: blockedBy === undefined,
      sameLogicalStepOnly: true,
      ...(blockedBy === undefined ? {} : { blockedBy }),
    },
  };
}

function isToolCallBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") {
    return false;
  }
  const type = (block as { type?: unknown }).type;
  return type === "toolCall" || type === "tool_use" || type === "function_call";
}

/**
 * Transcript-safe projection of an assistant message from a failed attempt.
 *
 * A failed attempt's tool calls were never executed, so persisting them would
 * create replay hazards (orphaned tool calls, approvals that never happened).
 * Text and thinking blocks stay so the transcript still shows what failed.
 * Returns the original message when no change is needed.
 */
export function sanitizeFailedAttemptTranscriptMessage<TMessage extends AgentMessage>(
  message: TMessage,
): TMessage {
  if (!message || typeof message !== "object" || message.role !== "assistant") {
    return message;
  }
  const assistant = message as Extract<AgentMessage, { role: "assistant" }>;
  if ((assistant as { stopReason?: unknown }).stopReason !== "error") {
    return message;
  }
  const content: unknown[] = Array.isArray(assistant.content) ? assistant.content : [];
  if (!content.some((block: unknown) => isToolCallBlock(block))) {
    return message;
  }
  return {
    ...assistant,
    content: content.filter((block: unknown) => !isToolCallBlock(block)),
  } as TMessage;
}
