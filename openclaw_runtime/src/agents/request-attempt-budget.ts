/**
 * One bounded physical-attempt budget for a single logical request.
 *
 * Retry layers (generic retry runner, agent auto-retry, model fallback) must
 * consume this budget instead of multiplying their own attempt counters.
 * This module is deliberately request-scoped: it is not a scheduler or a
 * cross-request rate limiter.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type RequestAttemptBudgetOptions = {
  logicalRequestId?: string;
  maxPhysicalAttempts: number;
  /** Optional lower-bound hint supplied by an upstream provider. */
  retryAfterMs?: number;
};

export type RequestAttemptRecord = {
  physicalAttempt: number;
  layer?: string;
  outcome?: "success" | "failure" | "skipped";
  retryAfterMs?: number;
};

export type RequestAttemptBudgetSnapshot = {
  logicalRequestId: string | null;
  maxPhysicalAttempts: number;
  used: number;
  remaining: number;
  retryAfterMs?: number;
  attempts: RequestAttemptRecord[];
};

function normalizeMaxAttempts(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("request attempt budget maxPhysicalAttempts must be finite");
  }
  return Math.max(1, Math.floor(value));
}

function normalizeRetryAfter(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

export class RequestAttemptBudget {
  readonly logicalRequestId: string | null;
  readonly maxPhysicalAttempts: number;
  private usedCount = 0;
  private readonly records: RequestAttemptRecord[] = [];
  private retryAfter: number | undefined;

  constructor(options: RequestAttemptBudgetOptions) {
    this.maxPhysicalAttempts = normalizeMaxAttempts(options.maxPhysicalAttempts);
    this.logicalRequestId = options.logicalRequestId ?? null;
    this.retryAfter = normalizeRetryAfter(options.retryAfterMs);
  }

  get used(): number {
    return this.usedCount;
  }

  get remaining(): number {
    return Math.max(0, this.maxPhysicalAttempts - this.usedCount);
  }

  canRetry(): boolean {
    return this.remaining > 0;
  }

  /** Records one physical attempt and returns its one-based index. */
  recordAttempt(record: Omit<RequestAttemptRecord, "physicalAttempt"> = {}): number {
    if (!this.canRetry()) {
      throw new Error("request attempt budget exhausted");
    }
    this.usedCount += 1;
    this.records.push({
      physicalAttempt: this.usedCount,
      ...record,
      ...(record.retryAfterMs !== undefined
        ? { retryAfterMs: normalizeRetryAfter(record.retryAfterMs) }
        : {}),
    });
    if (record.retryAfterMs !== undefined) {
      this.setRetryAfterMs(record.retryAfterMs);
    }
    return this.usedCount;
  }

  /** Updates an existing attempt outcome without changing the consumed count. */
  completeAttempt(
    physicalAttempt: number,
    outcome: NonNullable<RequestAttemptRecord["outcome"]>,
  ): void {
    const record = this.records.find((entry) => entry.physicalAttempt === physicalAttempt);
    if (record) {
      record.outcome = outcome;
    }
  }
  /** Returns undefined when the budget is exhausted; does not itself sleep or retry. */
  tryRecordAttempt(record: Omit<RequestAttemptRecord, "physicalAttempt"> = {}): number | undefined {
    return this.canRetry() ? this.recordAttempt(record) : undefined;
  }

  setRetryAfterMs(value: number | undefined): void {
    const normalized = normalizeRetryAfter(value);
    if (normalized !== undefined) {
      this.retryAfter = normalized;
    }
  }

  getRetryAfterMs(): number | undefined {
    return this.retryAfter;
  }

  snapshot(): RequestAttemptBudgetSnapshot {
    return {
      logicalRequestId: this.logicalRequestId,
      maxPhysicalAttempts: this.maxPhysicalAttempts,
      used: this.usedCount,
      remaining: this.remaining,
      ...(this.retryAfter !== undefined ? { retryAfterMs: this.retryAfter } : {}),
      attempts: this.records.map((record) => ({ ...record })),
    };
  }
}

const requestAttemptBudgetStorage = new AsyncLocalStorage<RequestAttemptBudget>();

/** Runs one logical request with a shared physical-attempt budget. */
export function runWithRequestAttemptBudget<T>(
  budget: RequestAttemptBudget,
  fn: () => T,
): T {
  return requestAttemptBudgetStorage.run(budget, fn);
}

/** Returns the current logical request budget, if one is active. */
export function getRequestAttemptBudget(): RequestAttemptBudget | undefined {
  return requestAttemptBudgetStorage.getStore();
}

export function createRequestAttemptBudget(
  options: RequestAttemptBudgetOptions,
): RequestAttemptBudget {
  return new RequestAttemptBudget(options);
}
