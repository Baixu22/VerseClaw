/**
 * L05: a finite-state circuit breaker for abnormal call rates.
 *
 * States: closed -> open -> half-open -> (closed | open).
 * - closed: requests allowed; failures accumulate in a time window.
 * - open: requests refused until the cooldown elapses (no further effects).
 * - half-open: exactly ONE probe is admitted; a clean probe closes the breaker,
 *   a failed probe re-opens it with a fresh cooldown.
 *
 * A purely legal rate (no failures) never trips. The breaker is deterministic
 * under an injected clock and is a boundary/limit, not a production default. It
 * does not replace or relax the SSRF guard, the loop guard or approvals.
 */
import { createHash } from "node:crypto";

export type RateBreakerState = "closed" | "open" | "half-open";

export type RateBreakerOptions = {
  /** Sliding window for counting failures. */
  windowMs: number;
  /** Failures within the window that trip the breaker. */
  maxFailuresPerWindow: number;
  /** How long the breaker stays open before admitting a single probe. */
  cooldownMs: number;
  now?: () => number;
};

export type RateBreakerSnapshot = {
  state: RateBreakerState;
  failuresInWindow: number;
  openedAt?: number;
  halfOpenProbeInFlight: boolean;
  trips: number;
};

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`RateCircuitBreaker ${label} must be a positive integer`);
  }
}

export class RateCircuitBreaker {
  readonly #windowMs: number;
  readonly #maxFailures: number;
  readonly #cooldownMs: number;
  readonly #now: () => number;
  #state: RateBreakerState = "closed";
  #failures: number[] = [];
  #openedAt: number | undefined;
  #probeInFlight = false;
  #trips = 0;

  constructor(options: RateBreakerOptions) {
    assertPositiveInteger(options.windowMs, "windowMs");
    assertPositiveInteger(options.maxFailuresPerWindow, "maxFailuresPerWindow");
    assertPositiveInteger(options.cooldownMs, "cooldownMs");
    this.#windowMs = options.windowMs;
    this.#maxFailures = options.maxFailuresPerWindow;
    this.#cooldownMs = options.cooldownMs;
    this.#now = options.now ?? Date.now;
  }

  #prune(now: number): void {
    const floor = now - this.#windowMs;
    this.#failures = this.#failures.filter((at) => at > floor);
  }

  /** Whether a request may proceed right now (adopts the single half-open probe). */
  allowsRequest(): boolean {
    const now = this.#now();
    if (this.#state === "open") {
      if (this.#openedAt !== undefined && now - this.#openedAt >= this.#cooldownMs) {
        this.#state = "half-open";
        this.#probeInFlight = true;
        return true;
      }
      return false;
    }
    if (this.#state === "half-open") {
      if (this.#probeInFlight) return false;
      this.#probeInFlight = true;
      return true;
    }
    return true;
  }

  /** Record the outcome of an admitted request. */
  record(success: boolean): RateBreakerState {
    const now = this.#now();
    if (this.#state === "half-open" && this.#probeInFlight) {
      this.#probeInFlight = false;
      if (success) {
        this.#state = "closed";
        this.#failures = [];
        this.#openedAt = undefined;
      } else {
        this.#state = "open";
        this.#openedAt = now;
        this.#trips += 1;
      }
      return this.#state;
    }

    if (success) {
      this.#prune(now);
      return this.#state;
    }

    this.#failures.push(now);
    this.#prune(now);
    if (this.#state === "closed" && this.#failures.length >= this.#maxFailures) {
      this.#state = "open";
      this.#openedAt = now;
      this.#trips += 1;
    }
    return this.#state;
  }

  getState(): RateBreakerState {
    // Adopt the open->half-open transition lazily so a getter reflects the clock.
    if (this.#state === "open" && this.#openedAt !== undefined) {
      const now = this.#now();
      if (now - this.#openedAt >= this.#cooldownMs) return "half-open";
    }
    return this.#state;
  }

  getSnapshot(): RateBreakerSnapshot {
    const now = this.#now();
    const failures = this.#state === "closed" ? this.#failures.filter((at) => at > now - this.#windowMs).length : this.#failures.length;
    return {
      state: this.getState(),
      failuresInWindow: failures,
      ...(this.#openedAt !== undefined ? { openedAt: this.#openedAt } : {}),
      halfOpenProbeInFlight: this.#probeInFlight,
      trips: this.#trips,
    };
  }

  /** Deterministic identity of the current state for evidence. */
  digest(): string {
    const snapshot = this.getSnapshot();
    return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  }
}