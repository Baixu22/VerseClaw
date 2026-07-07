export type CircuitBreakerState = "closed" | "open" | "half-open";

export type CircuitBreakerSnapshot = {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  consecutiveFailures: number;
  openedAt?: number;
  halfOpenCalls: number;
};

export type CircuitBreakerOptions = {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxCalls: number;
  now?: () => number;
};

const DEFAULT_NOW = () => Date.now();

export class CircuitBreakerOpenError extends Error {
  readonly snapshot: CircuitBreakerSnapshot;

  constructor(snapshot: CircuitBreakerSnapshot) {
    super(`CircuitBreaker is ${snapshot.state}; calls rejected until reset timeout elapses.`);
    this.name = "CircuitBreakerOpenError";
    this.snapshot = snapshot;
  }
}

export class CircuitBreaker {
  #failureThreshold: number;
  #resetTimeoutMs: number;
  #halfOpenMaxCalls: number;
  #now: () => number;
  #state: CircuitBreakerState = "closed";
  #consecutiveFailures = 0;
  #totalFailures = 0;
  #totalSuccesses = 0;
  #openedAt: number | undefined;
  #halfOpenInProgress = 0;

  constructor(options: CircuitBreakerOptions) {
    if (!Number.isInteger(options.failureThreshold) || options.failureThreshold <= 0) {
      throw new Error(
        `CircuitBreaker failureThreshold must be a positive integer, got: ${options.failureThreshold}`,
      );
    }
    if (!Number.isFinite(options.resetTimeoutMs) || options.resetTimeoutMs <= 0) {
      throw new Error(
        `CircuitBreaker resetTimeoutMs must be a positive number, got: ${options.resetTimeoutMs}`,
      );
    }
    if (!Number.isInteger(options.halfOpenMaxCalls) || options.halfOpenMaxCalls <= 0) {
      throw new Error(
        `CircuitBreaker halfOpenMaxCalls must be a positive integer, got: ${options.halfOpenMaxCalls}`,
      );
    }
    this.#failureThreshold = options.failureThreshold;
    this.#resetTimeoutMs = options.resetTimeoutMs;
    this.#halfOpenMaxCalls = options.halfOpenMaxCalls;
    this.#now = options.now ?? DEFAULT_NOW;
  }

  execute<T>(fn: () => T): T {
    if (this.#state === "open") {
      if (this.#shouldTransitionToHalfOpen()) {
        this.#transitionToHalfOpen();
      } else {
        throw new CircuitBreakerOpenError(this.getSnapshot());
      }
    }
    if (this.#state === "half-open" && this.#halfOpenInProgress >= this.#halfOpenMaxCalls) {
      throw new CircuitBreakerOpenError(this.getSnapshot());
    }
    this.#halfOpenInProgress += 1;
    try {
      const result = fn();
      this.#onSuccess();
      return result;
    } catch (error) {
      this.#onFailure();
      throw error;
    } finally {
      this.#halfOpenInProgress -= 1;
    }
  }

  getState(): CircuitBreakerState {
    if (this.#state === "open" && this.#shouldTransitionToHalfOpen()) {
      return "half-open";
    }
    return this.#state;
  }

  getSnapshot(): CircuitBreakerSnapshot {
    return {
      state: this.getState(),
      failureCount: this.#totalFailures,
      successCount: this.#totalSuccesses,
      consecutiveFailures: this.#consecutiveFailures,
      ...(this.#openedAt !== undefined ? { openedAt: this.#openedAt } : {}),
      halfOpenCalls: this.#halfOpenInProgress,
    };
  }

  reset(): void {
    this.#state = "closed";
    this.#consecutiveFailures = 0;
    this.#halfOpenInProgress = 0;
    this.#openedAt = undefined;
  }

  #onSuccess(): void {
    this.#totalSuccesses += 1;
    if (this.#state === "half-open") {
      this.#transitionToClosed();
    }
    this.#consecutiveFailures = 0;
  }

  #onFailure(): void {
    this.#totalFailures += 1;
    this.#consecutiveFailures += 1;
    if (this.#state === "half-open") {
      this.#transitionToOpen();
      return;
    }
    if (this.#consecutiveFailures >= this.#failureThreshold) {
      this.#transitionToOpen();
    }
  }

  #shouldTransitionToHalfOpen(): boolean {
    if (this.#state !== "open" || this.#openedAt === undefined) {
      return false;
    }
    return this.#now() - this.#openedAt >= this.#resetTimeoutMs;
  }

  #transitionToOpen(): void {
    this.#state = "open";
    this.#openedAt = this.#now();
    this.#halfOpenInProgress = 0;
  }

  #transitionToHalfOpen(): void {
    this.#state = "half-open";
    this.#halfOpenInProgress = 0;
  }

  #transitionToClosed(): void {
    this.#state = "closed";
    this.#consecutiveFailures = 0;
    this.#halfOpenInProgress = 0;
    this.#openedAt = undefined;
  }
}
