// Classifies provider request failures into retry and user-facing categories.
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import { formatErrorMessage } from "../../infra/errors.js";
import { redactSensitiveText } from "../../logging/redact.js";

/** Provider request error classes that get a specialized user-facing reply. */
export type ProviderRequestErrorCode =
  | "provider_conversation_state_error"
  | "provider_rate_limit_or_quota_error";

/** Locale-free reason for the class; consumers own every word of user copy. */
export type ProviderRequestErrorReason = "rate_limit_or_quota" | "conversation_state";

/**
 * Structured provider error classification.
 *
 * The classifier returns no user copy of its own: `reason`, `messageKey` and
 * `params` are locale-free, and the renderer resolves the key through the shared
 * `common` catalogue with its existing i18next instance. `technicalMessage` is
 * redacted diagnostics only, never a display string. (issue #120)
 */
export type ProviderRequestErrorClassification = {
  code: ProviderRequestErrorCode;
  reason: ProviderRequestErrorReason;
  /** Shared `common:errors.*` key; the renderer owns the wording. */
  messageKey: string;
  /** Values the message key interpolates; omitted when the copy has none. */
  params?: Record<string, string | number>;
  /** Redacted diagnostic detail for logs/support. */
  technicalMessage: string;
  /**
   * Chat-channel fallback copy. Channel replies cannot reach the renderer
   * catalogue, and the only consumer today (`agent-runner-execution.ts`) is
   * outside this change's write scope, so the English constant is still
   * returned alongside the neutral fields. Renderer surfaces must use
   * `messageKey` instead. Removing this needs the structured-error retention
   * work in issue #118 plus an edit to that consumer.
   */
  userMessage: string;
};

/** Channel fallback copy for provider-side broken conversation state. */
export const PROVIDER_CONVERSATION_STATE_ERROR_USER_MESSAGE =
  "⚠️ The model provider rejected the conversation state. Please try again, or use /new to start a fresh session.";

export const PROVIDER_RATE_LIMIT_OR_QUOTA_ERROR_USER_MESSAGE =
  "⚠️ The model provider returned HTTP 429 before replying. This can mean rate limiting, exhausted quota, or an account balance/billing issue. Check the selected provider/model, API key, and provider billing/quota dashboard, then try again.";

/** Shared renderer keys for the two provider classes. */
const PROVIDER_RATE_LIMIT_OR_QUOTA_MESSAGE_KEY = "common:errors.rate_limit.what";
const PROVIDER_CONVERSATION_STATE_MESSAGE_KEY = "common:errors.conversation_state.what";

/** Classifies provider request failures that are actionable for users. */
export function classifyProviderRequestError(
  err: unknown,
): ProviderRequestErrorClassification | undefined {
  // Detection stays on the raw text; only the returned diagnostic is redacted
  // so redaction can never change the class.
  const rawMessage = formatErrorMessage(err);
  const technicalMessage = redactSensitiveText(rawMessage);
  if (
    hasHttp429Evidence(err, rawMessage) &&
    isGenericProviderRuntimeErrorMessage(rawMessage)
  ) {
    return {
      code: "provider_rate_limit_or_quota_error",
      reason: "rate_limit_or_quota",
      messageKey: PROVIDER_RATE_LIMIT_OR_QUOTA_MESSAGE_KEY,
      // A bare 429 cannot separate pacing from exhausted quota without the
      // provider's structured code (issue #118); the status is the only
      // structured fact available, so it is what the copy can show.
      params: { httpStatus: 429 },
      technicalMessage,
      userMessage: PROVIDER_RATE_LIMIT_OR_QUOTA_ERROR_USER_MESSAGE,
    };
  }
  if (isProviderConversationStateErrorMessage(rawMessage)) {
    return {
      code: "provider_conversation_state_error",
      reason: "conversation_state",
      messageKey: PROVIDER_CONVERSATION_STATE_MESSAGE_KEY,
      technicalMessage,
      userMessage: PROVIDER_CONVERSATION_STATE_ERROR_USER_MESSAGE,
    };
  }
  return undefined;
}

/** Detects provider errors that indicate invalid conversation/tool turn state. */
export function isProviderConversationStateErrorMessage(message: string): boolean {
  const lower = normalizeLowercaseStringOrEmpty(message);
  return (
    (lower.includes("custom tool call output is missing") && lower.includes("call id")) ||
    (lower.includes("toolresult") &&
      lower.includes("tooluse") &&
      lower.includes("exceeds the number") &&
      lower.includes("previous turn")) ||
    lower.includes("function call turn comes immediately after") ||
    lower.includes("incorrect role information") ||
    lower.includes("roles must alternate")
  );
}

function isGenericProviderRuntimeErrorMessage(message: string): boolean {
  const lower = normalizeLowercaseStringOrEmpty(message);
  return (
    lower.includes("an error occurred while processing your request") ||
    lower.includes("something went wrong while processing your request")
  );
}

function hasHttp429Evidence(err: unknown, message: string): boolean {
  return (
    readHttp429Status(err) ||
    /\b(?:http\s*)?429\b|["'](?:status|code)["']\s*:\s*429\b/iu.test(message)
  );
}

function readHttp429Status(err: unknown, seen = new Set<unknown>()): boolean {
  if (!err || typeof err !== "object" || seen.has(err)) {
    return false;
  }
  seen.add(err);
  const candidate =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    if (candidate === 429) {
      return true;
    }
  } else if (typeof candidate === "string" && Number(candidate.trim()) === 429) {
    return true;
  }
  const nested = err as { cause?: unknown; error?: unknown; response?: unknown };
  return (
    readHttp429Status(nested.response, seen) ||
    readHttp429Status(nested.error, seen) ||
    readHttp429Status(nested.cause, seen)
  );
}
