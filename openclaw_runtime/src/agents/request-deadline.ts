/**
 * NET-E (TF-0442): one logical deadline shared inside the gateway process.
 *
 * The renderer creates the deadline; Main clamps its own work to it and forwards
 * the absolute value with the RPC (for chat turns: `chat.send.deadlineAtMs`).
 * The gateway handler enters this ambient context for the whole dispatch, so
 * nested provider work can clamp its request timeout to what remains instead of
 * starting a fresh provider window.
 *
 * Boundaries:
 * - The deadline is absolute epoch ms; every consumer recomputes the remaining
 *   budget. Layers never add their budgets together.
 * - The context is request-scoped (AsyncLocalStorage), never a process global.
 * - No product-wide timeout default changes; the provider keeps its configured
 *   timeout when it is smaller than the remaining budget.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestDeadlineStage = "gateway" | "provider";

export type RequestDeadline = {
  /** Absolute epoch ms when the logical request must stop. */
  deadlineAtMs: number;
  /** Layer that established the ambient deadline. */
  stage: RequestDeadlineStage;
  /** Local correlation id (never a provider request id). */
  requestId?: string;
};

export type RequestDeadlineOptions = {
  stage?: RequestDeadlineStage;
  requestId?: string;
};

/** Structured timeout details shared by the gateway and the provider leg. */
export type RequestTimeoutDetails = {
  stage: RequestDeadlineStage;
  /** Budget this stage could still enforce, in ms (0 once the deadline passed). */
  deadlineMs: number;
  /** How long the stage ran (or how late it started) in ms. */
  elapsedMs: number;
  /** Local correlation id; the provider request id stays a separate field. */
  requestId?: string;
  /** Absolute logical deadline that was propagated. */
  deadlineAtMs: number;
};

/** Typed fail-closed error used when the logical deadline is already spent. */
export class RequestDeadlineExceededError extends Error {
  readonly code = "E_REQUEST_DEADLINE_EXCEEDED";
  readonly deadlineAtMs: number;
  readonly stage: RequestDeadlineStage;
  readonly requestId: string | undefined;
  readonly details: RequestTimeoutDetails;

  constructor(params: {
    deadlineAtMs: number;
    stage: RequestDeadlineStage;
    requestId?: string;
    now?: () => number;
  }) {
    super(
      `request deadline exceeded: the ${params.stage} stage timed out because the logical deadline ` +
        `(deadlineAtMs=${params.deadlineAtMs}) had already passed`,
    );
    this.name = "RequestDeadlineExceededError";
    this.deadlineAtMs = params.deadlineAtMs;
    this.stage = params.stage;
    this.requestId = params.requestId;
    this.details = {
      stage: params.stage,
      deadlineMs: 0,
      elapsedMs: Math.max(0, (params.now ?? Date.now)() - params.deadlineAtMs),
      ...(params.requestId ? { requestId: params.requestId } : {}),
      deadlineAtMs: params.deadlineAtMs,
    };
  }
}

export type RequestDeadlineGate =
  | { ok: true; deadlineAtMs?: number }
  | {
      ok: false;
      deadlineAtMs: number;
      details: {
        stage: RequestDeadlineStage;
        /** No budget was left to enforce once the deadline had passed. */
        deadlineMs: number;
        /** How long ago the logical deadline passed, in ms. */
        elapsedMs: number;
        requestId?: string;
        deadlineAtMs: number;
      };
    };

/**
 * Validates a deadline that arrived from another process and decides whether the
 * request may still start. Invalid or absent values stay permissive (no deadline
 * propagated); a spent deadline fails closed with structured details.
 */
export function resolveRequestDeadlineGate(params: {
  deadlineAtMs: unknown;
  requestId?: string;
  stage?: RequestDeadlineStage;
  now?: () => number;
}): RequestDeadlineGate {
  const raw = params.deadlineAtMs;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return { ok: true };
  }
  const deadlineAtMs = Math.floor(raw);
  const now = (params.now ?? Date.now)();
  if (deadlineAtMs > now) {
    return { ok: true, deadlineAtMs };
  }
  return {
    ok: false,
    deadlineAtMs,
    details: {
      stage: params.stage ?? "gateway",
      deadlineMs: 0,
      elapsedMs: Math.max(0, now - deadlineAtMs),
      ...(params.requestId ? { requestId: params.requestId } : {}),
      deadlineAtMs,
    },
  };
}

const requestDeadlineStorage = new AsyncLocalStorage<RequestDeadline>();

function normalizeDeadlineAtMs(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

/** Runs `run` with the ambient logical deadline (no-op when undefined). */
export function runWithRequestDeadline<T>(
  deadlineAtMs: number | undefined,
  run: () => T,
  options: RequestDeadlineOptions = {},
): T {
  const normalized = normalizeDeadlineAtMs(deadlineAtMs);
  if (normalized === undefined) {
    return run();
  }
  return requestDeadlineStorage.run(
    {
      deadlineAtMs: normalized,
      stage: options.stage ?? "gateway",
      ...(options.requestId ? { requestId: options.requestId } : {}),
    },
    run,
  );
}

export function getRequestDeadline(): RequestDeadline | undefined {
  return requestDeadlineStorage.getStore();
}

export function getRequestDeadlineAtMs(): number | undefined {
  return requestDeadlineStorage.getStore()?.deadlineAtMs;
}

/** Milliseconds left in the ambient logical budget; `undefined` when none. */
export function remainingRequestBudgetMs(now: () => number = Date.now): number | undefined {
  const deadline = requestDeadlineStorage.getStore();
  if (!deadline) {
    return undefined;
  }
  return Math.max(0, deadline.deadlineAtMs - now());
}

export function isRequestDeadlineExpired(now: () => number = Date.now): boolean {
  const remaining = remainingRequestBudgetMs(now);
  return remaining !== undefined && remaining <= 0;
}

/**
 * Clamps a provider/local timeout to the remaining logical budget.
 *
 * With no ambient deadline the input is returned unchanged. With a deadline the
 * result is `min(timeoutMs, remaining)`; when no timeout is configured the
 * remaining budget becomes the timeout so the provider still cannot outlive the
 * logical request.
 */
export function clampRequestTimeoutToDeadline(
  timeoutMs: number | undefined,
  now: () => number = Date.now,
): number | undefined {
  const remaining = remainingRequestBudgetMs(now);
  if (remaining === undefined) {
    return timeoutMs;
  }
  if (timeoutMs === undefined) {
    return remaining;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return timeoutMs;
  }
  return Math.max(0, Math.min(Math.floor(timeoutMs), remaining));
}
