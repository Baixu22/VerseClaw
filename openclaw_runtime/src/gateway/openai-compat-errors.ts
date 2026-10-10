// OpenAI-compatible error helpers.
// Converts OpenClaw failover/sampling errors to OpenAI-style HTTP responses.
import type { FailoverReason } from "../agents/embedded-agent-helpers/types.js";
import { describeFailoverError } from "../agents/failover-error.js";
import { redactProviderErrorBody } from "../agents/provider-http-errors.js";

export type OpenAiCompatError = {
  status: number;
  error: {
    message: string;
    type: string;
    code?: string;
  };
};

type OpenAiCompatReasonMapping = {
  status: number;
  type: string;
  message?: string;
};

// Exhaustive by construction: adding a FailoverReason without a public
// compatibility decision fails type checking instead of becoming HTTP 500.
const ERROR_MAPPING_BY_REASON: Record<FailoverReason, OpenAiCompatReasonMapping> = {
  auth: { status: 401, type: "authentication_error" },
  auth_permanent: { status: 403, type: "permission_error" },
  format: { status: 400, type: "invalid_request_error" },
  rate_limit: { status: 429, type: "rate_limit_error" },
  overloaded: { status: 503, type: "api_error", message: "upstream provider overloaded" },
  billing: { status: 402, type: "insufficient_quota" },
  server_error: { status: 502, type: "api_error", message: "upstream provider error" },
  timeout: { status: 504, type: "api_error", message: "upstream provider timeout" },
  model_not_found: { status: 404, type: "invalid_request_error" },
  session_expired: { status: 410, type: "invalid_request_error" },
  refusal: {
    status: 422,
    type: "refusal_error",
    message: "The model refused to complete the request.",
  },
  empty_response: {
    status: 502,
    type: "empty_response_error",
    message: "The provider returned an empty response.",
  },
  no_error_details: {
    status: 500,
    type: "api_error",
    message: "The provider failed without error details.",
  },
  unclassified: { status: 500, type: "api_error", message: "The request failed." },
  unknown: { status: 500, type: "api_error", message: "The request failed." },
};

function statusForReason(reason: FailoverReason, status: number | undefined): number {
  const fallback = ERROR_MAPPING_BY_REASON[reason].status;
  if (reason === "server_error") {
    return status && status >= 400 && status < 500 ? status : fallback;
  }
  if (reason === "timeout") {
    return status && status >= 400 && status < 500 ? status : fallback;
  }
  return status ?? fallback;
}

function messageForReason(params: {
  reason: FailoverReason;
  message: string;
  rawError?: string;
}): string {
  return ERROR_MAPPING_BY_REASON[params.reason].message
    || params.rawError?.trim()
    || params.message.trim()
    || "request failed";
}

/** Converts a provider failover error into an OpenAI-compatible error envelope. */
export function resolveOpenAiCompatError(err: unknown): OpenAiCompatError | undefined {
  const described = describeFailoverError(err);
  const reason = described.reason;
  if (!reason) {
    return undefined;
  }
  const mapping = ERROR_MAPPING_BY_REASON[reason];
  const status = statusForReason(reason, described.status);
  const message = messageForReason({
    reason,
    message: described.message,
    rawError: described.rawError,
  });
  return {
    status,
    error: {
      message: redactProviderErrorBody(message),
      type: mapping.type,
      ...(described.code ? { code: redactProviderErrorBody(described.code) } : {}),
    },
  };
}

/** Validates OpenAI-compatible sampling parameters before provider dispatch. */
export function validateOpenAiSamplingParams(params: {
  temperature?: unknown;
  topP?: unknown;
  frequencyPenalty?: unknown;
  presencePenalty?: unknown;
  seed?: unknown;
}): string | undefined {
  if (params.temperature != null) {
    if (typeof params.temperature !== "number" || !Number.isFinite(params.temperature)) {
      return "`temperature` must be a finite number.";
    }
    if (params.temperature < 0 || params.temperature > 2) {
      return "`temperature` must be between 0 and 2.";
    }
  }
  if (params.topP != null) {
    if (typeof params.topP !== "number" || !Number.isFinite(params.topP)) {
      return "`top_p` must be a finite number.";
    }
    if (params.topP < 0 || params.topP > 1) {
      return "`top_p` must be between 0 and 1.";
    }
  }
  if (params.frequencyPenalty != null) {
    if (typeof params.frequencyPenalty !== "number" || !Number.isFinite(params.frequencyPenalty)) {
      return "`frequency_penalty` must be a finite number.";
    }
    if (params.frequencyPenalty < -2 || params.frequencyPenalty > 2) {
      return "`frequency_penalty` must be between -2.0 and 2.0.";
    }
  }
  if (params.presencePenalty != null) {
    if (typeof params.presencePenalty !== "number" || !Number.isFinite(params.presencePenalty)) {
      return "`presence_penalty` must be a finite number.";
    }
    if (params.presencePenalty < -2 || params.presencePenalty > 2) {
      return "`presence_penalty` must be between -2.0 and 2.0.";
    }
  }
  if (params.seed != null) {
    if (typeof params.seed !== "number" || !Number.isFinite(params.seed)) {
      return "`seed` must be a finite number.";
    }
    if (!Number.isInteger(params.seed)) {
      return "`seed` must be an integer.";
    }
  }
  return undefined;
}
