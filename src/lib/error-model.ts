export type AppErrorCode =
  | 'AUTH_INVALID'
  | 'AUTH_PERMANENT'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'PERMISSION'
  | 'CHANNEL_UNAVAILABLE'
  | 'CONVERSATION_STATE'
  | 'NETWORK'
  | 'CONFIG'
  | 'GATEWAY'
  | 'BILLING'
  | 'OVERLOADED'
  | 'MODEL_NOT_FOUND'
  | 'UNKNOWN';

/**
 * Every class the unified exit can render. Kept as a runtime list so copy,
 * retry and locale coverage can be audited exhaustively instead of by memory.
 */
export const APP_ERROR_CODES = [
  'AUTH_INVALID',
  'AUTH_PERMANENT',
  'TIMEOUT',
  'RATE_LIMIT',
  'PERMISSION',
  'CHANNEL_UNAVAILABLE',
  'CONVERSATION_STATE',
  'NETWORK',
  'CONFIG',
  'GATEWAY',
  'BILLING',
  'OVERLOADED',
  'MODEL_NOT_FOUND',
  'UNKNOWN',
] as const satisfies readonly AppErrorCode[];

/**
 * A bounded, permission-scoped recovery action an agent may take after an error.
 * It is never a shell command or raw script — only one of these fixed verbs with
 * bounded string arguments. Absent = no automatic repair is possible, so the
 * caller must surface the original error to the user.
 */
export type ErrorRecoveryAction = {
  kind: "retry" | "reauthenticate" | "reconfigure" | "open-settings" | "contact-support";
  /** Bounded, display-safe argument (for example a setting key or channel id). */
  target?: string;
};

/** How the recovery action is scoped, so an agent cannot exceed its authority. */
export type ErrorRecoveryScope = "self-retry" | "user-action-required";

/**
 * Pre-registered recovery table: the only bounded recovery action each error
 * class permits, plus whether an agent may take it. Errors absent from the table
 * carry no recovery action (no automatic repair).
 */
export const ERROR_RECOVERY_TABLE: Record<AppErrorCode, { retryable: boolean; scope: ErrorRecoveryScope; action?: ErrorRecoveryAction }> = {
  AUTH_INVALID: { retryable: false, scope: "user-action-required", action: { kind: "reauthenticate" } },
  AUTH_PERMANENT: { retryable: false, scope: "user-action-required", action: { kind: "contact-support" } },
  TIMEOUT: { retryable: true, scope: "self-retry", action: { kind: "retry" } },
  RATE_LIMIT: { retryable: true, scope: "self-retry", action: { kind: "retry" } },
  PERMISSION: { retryable: false, scope: "user-action-required", action: { kind: "open-settings", target: "permissions" } },
  CHANNEL_UNAVAILABLE: { retryable: true, scope: "self-retry", action: { kind: "retry" } },
  CONVERSATION_STATE: { retryable: false, scope: "user-action-required", action: { kind: "open-settings", target: "conversation" } },
  NETWORK: { retryable: true, scope: "self-retry", action: { kind: "retry" } },
  CONFIG: { retryable: false, scope: "user-action-required", action: { kind: "reconfigure" } },
  GATEWAY: { retryable: true, scope: "self-retry", action: { kind: "retry" } },
  BILLING: { retryable: false, scope: "user-action-required", action: { kind: "open-settings", target: "billing" } },
  OVERLOADED: { retryable: true, scope: "self-retry", action: { kind: "retry" } },
  MODEL_NOT_FOUND: { retryable: false, scope: "user-action-required", action: { kind: "reconfigure", target: "model" } },
  UNKNOWN: { retryable: false, scope: "user-action-required" },
};

/** Whether the error class is safe for an agent to retry automatically. */
export function isRetryableAppErrorCode(code: AppErrorCode): boolean {
  return ERROR_RECOVERY_TABLE[code]?.retryable === true;
}

export function recoveryActionForAppErrorCode(code: AppErrorCode): ErrorRecoveryAction | undefined {
  return ERROR_RECOVERY_TABLE[code]?.action;
}

export class AppError extends Error {
  code: AppErrorCode;
  cause?: unknown;
  details?: Record<string, unknown>;
  /** Renderer-side correlation id echoed by the Main host dispatcher. */
  requestId?: string;
  /** True only for classes an agent may retry automatically. */
  retryable: boolean;
  /** Bounded, permission-scoped recovery action; absent means surface the error to the user. */
  nextAction?: ErrorRecoveryAction;

  constructor(
    code: AppErrorCode,
    message: string,
    cause?: unknown,
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
    this.details = details;
    this.requestId = requestId;
    this.retryable = isRetryableAppErrorCode(code);
    this.nextAction = recoveryActionForAppErrorCode(code);
  }
}

/**
 * Structured facts read off the thrown value and its cause/response chain.
 *
 * Classification reads these first; it only falls back to the raw technical
 * message when none of them identify a class. A user-facing string that has
 * already been translated is never a classification input (issue #120), so
 * changing the display language can never change the class.
 */
export type ErrorSignals = {
  code?: string;
  status?: number;
  reason?: string;
};

/**
 * Provider `code`/`reason`/`type` tokens (normalized to upper case) mapped to a
 * class. One table serves both structured fields so the two can never drift.
 */
const CODE_SIGNALS: Record<string, AppErrorCode> = {
  TIMEOUT: 'TIMEOUT',
  REQUEST_TIMEOUT: 'TIMEOUT',
  PERMISSION: 'PERMISSION',
  PERMISSION_ERROR: 'PERMISSION',
  FORBIDDEN: 'PERMISSION',
  PERMISSION_DENIED: 'PERMISSION',
  SANDBOX_DENIED: 'PERMISSION',
  GATEWAY: 'GATEWAY',
  VALIDATION: 'CONFIG',
  INVALID_REQUEST: 'CONFIG',
  INVALID_REQUEST_ERROR: 'CONFIG',
  UNSUPPORTED: 'CHANNEL_UNAVAILABLE',
  CHANNEL_UNAVAILABLE: 'CHANNEL_UNAVAILABLE',
  CONVERSATION_STATE: 'CONVERSATION_STATE',
  INVALID_CONVERSATION_STATE: 'CONVERSATION_STATE',
  NETWORK: 'NETWORK',
  CONNECTION_ERROR: 'NETWORK',
  AUTH_INVALID: 'AUTH_INVALID',
  UNAUTHORIZED: 'AUTH_INVALID',
  AUTH_EXPIRED: 'AUTH_INVALID',
  AUTHENTICATION_ERROR: 'AUTH_INVALID',
  AUTH_PERMANENT: 'AUTH_PERMANENT',
  INVALID_API_KEY: 'AUTH_PERMANENT',
  API_KEY_INVALID: 'AUTH_PERMANENT',
  KEY_REVOKED: 'AUTH_PERMANENT',
  RATE_LIMIT: 'RATE_LIMIT',
  RATE_LIMITED: 'RATE_LIMIT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT',
  TOO_MANY_REQUESTS: 'RATE_LIMIT',
  BILLING: 'BILLING',
  PAYMENT_REQUIRED: 'BILLING',
  INSUFFICIENT_BALANCE: 'BILLING',
  INSUFFICIENT_QUOTA: 'BILLING',
  QUOTA_EXCEEDED: 'BILLING',
  BILLING_HARD_LIMIT_REACHED: 'BILLING',
  OVERLOADED: 'OVERLOADED',
  OVERLOADED_ERROR: 'OVERLOADED',
  MODEL_OVERLOADED: 'OVERLOADED',
  SERVER_OVERLOADED: 'OVERLOADED',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  UNKNOWN_MODEL: 'MODEL_NOT_FOUND',
};

const STATUS_SIGNALS: Record<number, AppErrorCode> = {
  401: 'AUTH_INVALID',
  402: 'BILLING',
  403: 'PERMISSION',
  408: 'TIMEOUT',
  429: 'RATE_LIMIT',
  503: 'OVERLOADED',
  504: 'TIMEOUT',
  529: 'OVERLOADED',
};

export function mapBackendErrorCode(code?: string): AppErrorCode {
  if (typeof code !== 'string') return 'UNKNOWN';
  return CODE_SIGNALS[code.trim().toUpperCase()] ?? 'UNKNOWN';
}

/**
 * Last-resort classification from the untranslated technical message.
 * Only reachable when no structured signal identified a class.
 */
function classifyMessage(message: string): AppErrorCode {
  // Separator-insensitive so `invalid_api_key` / `rate_limit_exceeded` style
  // provider tokens match the same probes as prose.
  const lower = message.toLowerCase().replace(/[_-]+/g, ' ');

  if (
    lower.includes('invalid ipc channel')
    || lower.includes('no handler registered')
    || lower.includes('window is not defined')
    || lower.includes('unsupported')
  ) {
    return 'CHANNEL_UNAVAILABLE';
  }
  if (lower.includes('conversation state') || lower.includes('roles must alternate')) {
    return 'CONVERSATION_STATE';
  }
  if (
    lower.includes('insufficient balance')
    || lower.includes('insufficient_quota')
    || lower.includes('insufficient quota')
    || lower.includes('quota exceeded')
    || lower.includes('exceeded your current quota')
    || lower.includes('billing')
    || lower.includes('credit balance')
    || lower.includes('payment required')
  ) {
    return 'BILLING';
  }
  if (
    lower.includes('invalid api key')
    || lower.includes('api key is invalid')
    || lower.includes('api key was revoked')
    || lower.includes('key has been revoked')
  ) {
    return 'AUTH_PERMANENT';
  }
  if (
    lower.includes('invalid authentication')
    || lower.includes('unauthorized')
    || lower.includes('auth failed')
    || lower.includes('401')
  ) {
    return 'AUTH_INVALID';
  }
  if (lower.includes('model not found') || lower.includes('unknown model')) {
    return 'MODEL_NOT_FOUND';
  }
  if (lower.includes('overloaded')) {
    return 'OVERLOADED';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('abort')) {
    return 'TIMEOUT';
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'RATE_LIMIT';
  }
  if (
    lower.includes('permission')
    || lower.includes('forbidden')
    || lower.includes('denied')
    || lower.includes('403')
  ) {
    return 'PERMISSION';
  }
  if (
    lower.includes('network')
    || lower.includes('fetch')
    || lower.includes('econnrefused')
    || lower.includes('econnreset')
    || lower.includes('enotfound')
  ) {
    return 'NETWORK';
  }
  if (lower.includes('gateway')) {
    return 'GATEWAY';
  }
  if (lower.includes('config') || lower.includes('invalid') || lower.includes('validation') || lower.includes('400')) {
    return 'CONFIG';
  }

  return 'UNKNOWN';
}

function readStringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function readStatusField(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  const parsed = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);
  if (!Number.isFinite(parsed) || parsed < 100 || parsed > 599) return undefined;
  return parsed;
}

/** Walks the error and its nested cause/response/data chain once. */
function collectSignalSources(err: unknown): Array<Record<string, unknown>> {
  const sources: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    sources.push(record);
    visit(record.cause);
    visit(record.error);
    visit(record.response);
    visit(record.data);
  };
  visit(err);
  return sources;
}

/**
 * Reads structured signals, most explicit source first: caller-supplied
 * `details` (host-api envelopes, store context) then the throwing object and
 * its nested cause/response chain.
 */
export function readErrorSignals(err: unknown, details?: Record<string, unknown>): ErrorSignals {
  const sources = [...(details ? [details] : []), ...collectSignalSources(err)];
  const signals: ErrorSignals = {};
  for (const source of sources) {
    signals.code ??= readStringField(source, 'code')
      ?? readStringField(source, 'errorCode')
      ?? readStringField(source, 'reasonCode');
    signals.status ??= readStatusField(source, 'status')
      ?? readStatusField(source, 'statusCode')
      ?? readStatusField(source, 'httpStatus');
    signals.reason ??= readStringField(source, 'reason')
      ?? readStringField(source, 'type')
      ?? readStringField(source, 'errorType');
  }
  return signals;
}

function classifySignals(signals: ErrorSignals): AppErrorCode | undefined {
  for (const token of [signals.code, signals.reason]) {
    if (!token) continue;
    const mapped = mapBackendErrorCode(token);
    if (mapped !== 'UNKNOWN') return mapped;
  }
  return signals.status !== undefined ? STATUS_SIGNALS[signals.status] : undefined;
}

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    return readStringField(err as Record<string, unknown>, 'message') ?? '';
  }
  return err === undefined || err === null ? '' : String(err);
}

export function normalizeAppError(err: unknown, details?: Record<string, unknown>): AppError {
  if (err instanceof AppError) {
    const requestId = err.requestId
      ?? readStringField(err.details ?? {}, 'requestId');
    return new AppError(
      err.code,
      err.message,
      err.cause ?? err,
      { ...(err.details ?? {}), ...(details ?? {}) },
      requestId,
    );
  }

  const message = readErrorMessage(err);
  const signals = readErrorSignals(err, details);
  // Structured signals win. Only their absence lets the untranslated technical
  // message (or a structured `reason` string) decide the class.
  const code = classifySignals(signals)
    ?? classifyMessage([signals.reason ?? '', message].join(' ').trim());
  return new AppError(
    code,
    message,
    err,
    details,
    readStringField(details ?? {}, 'requestId'),
  );
}
