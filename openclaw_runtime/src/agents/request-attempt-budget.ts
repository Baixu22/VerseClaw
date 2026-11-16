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

export type RequestAttemptDecision = {
  layer: string;
  reason: string;
};

export type RequestAttemptRecord = {
  /** Monotonic one-based identity. Never reused, never derived from the budget balance. */
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
  decisions: RequestAttemptDecision[];
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
  /** Failed attempts still holding budget. Successful attempts release their slot. */
  private usedCount = 0;
  /** Monotonic identity source. Decoupled from usedCount so a released slot never reuses an id. */
  private nextPhysicalAttempt = 1;
  /** Identity to record index, so completion targets an exact attempt even if the balance changed. */
  private readonly recordIndexByAttempt = new Map<number, number>();
  /** Attempt ids whose outcome has been committed. Default provisional failure does not count. */
  private readonly completedAttempts = new Set<number>();
  private readonly records: RequestAttemptRecord[] = [];
  private readonly decisions: RequestAttemptDecision[] = [];
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

  /**
   * Records one physical attempt and returns its one-based identity.
   *
   * Identity and budget are separate on purpose: a successful attempt releases
   * its budget slot, but its identity must never be handed to a later attempt.
   * TF-0729; the collision was reproduced by
   * tests/unit/semantic-convergence-retry-identity.test.ts before this change.
   */
  recordAttempt(record: Omit<RequestAttemptRecord, "physicalAttempt"> = {}): number {
    if (!this.canRetry()) {
      throw new Error("request attempt budget exhausted");
    }
    const physicalAttempt = this.nextPhysicalAttempt;
    this.nextPhysicalAttempt += 1;
    this.usedCount += 1;
    this.recordIndexByAttempt.set(physicalAttempt, this.records.length);
    this.records.push({
      physicalAttempt,
      ...record,
      ...(record.retryAfterMs !== undefined
        ? { retryAfterMs: normalizeRetryAfter(record.retryAfterMs) }
        : {}),
    });
    if (record.retryAfterMs !== undefined) {
      this.setRetryAfterMs(record.retryAfterMs);
    }
    return physicalAttempt;
  }

  /**
   * Records the outcome of a physical attempt.
   *
   * Only FAILED attempts consume the retry budget. A single user turn issues
   * one provider request per tool round, so charging the successful ones made a
   * 4-tool loop exhaust maxRetries+1 and the final answer was refused with
   * ProviderRequestAttemptBudgetExhaustedError. Retry layers still share one
   * budget because each retry after a failure keeps its slot taken.
   * See TF-0438 (shared budget) and TF-0577 (tool-loop rounds).
   */
  completeAttempt(
    physicalAttempt: number,
    outcome: NonNullable<RequestAttemptRecord["outcome"]>,
  ): void {
    const index = this.recordIndexByAttempt.get(physicalAttempt);
    if (index === undefined) {
      return;
    }
    const record = this.records[index];
    if (!record) {
      return;
    }
    // Idempotent: a repeated completion must not release the same slot twice.
    // Callers record a provisional "failure" at start, so outcome alone cannot
    // distinguish a committed completion from the default.
    if (this.completedAttempts.has(physicalAttempt)) {
      return;
    }
    this.completedAttempts.add(physicalAttempt);
    record.outcome = outcome;
    if (outcome === "success") {
      this.usedCount = Math.max(0, this.usedCount - 1);
    }
  }

  /** Records a non-charging layer decision for observability. */
  noteAttemptDecision(decision: RequestAttemptDecision): void {
    this.decisions.push({ ...decision });
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
      decisions: this.decisions.map((decision) => ({ ...decision })),
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
