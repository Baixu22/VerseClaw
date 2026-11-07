/**
 * Bounded concurrency gate with an explicit queue contract.
 *
 * One gate owns `maxConcurrent` slots for a single resource family. Callers
 * acquire a lease, do the expensive work, and release the lease when the work
 * has actually finished. Admission is refused with a typed reason instead of
 * queueing without limit, and a refused caller must not start the work.
 *
 * Contract (issue #154):
 * - `overloaded` is returned before any wait when the wait queue is already full.
 * - `queue-timeout` is returned when a queued waiter passes its wait deadline.
 * - `aborted` is returned when the caller's signal fires while queued.
 * - `release()` is idempotent per lease; a second release never frees a second
 *   slot and is counted as `doubleRelease` so a leak or a double free is visible.
 * - A closed gate refuses new waiters and rejects the queue with `aborted`.
 *
 * The clock is injectable so queue deadlines can be exercised deterministically.
 */

/** Reason a caller was not admitted. */
export type BoundedConcurrencyRejection = "overloaded" | "queue-timeout" | "aborted";

/** Counters describing one gate's observed behaviour since process start. */
export type BoundedConcurrencyStats = {
  /** Slots currently held. */
  active: number;
  /** Callers currently waiting for a slot. */
  queued: number;
  maxConcurrent: number;
  maxQueue: number;
  queueTimeoutMs: number;
  peakActive: number;
  peakQueued: number;
  admitted: number;
  rejectedOverloaded: number;
  rejectedQueueTimeout: number;
  rejectedAborted: number;
  completed: number;
  doubleRelease: number;
  queuedWaitTotalMs: number;
  queuedWaitMaxMs: number;
  /** True after `close()`; a closed gate admits nobody. */
  closed: boolean;
};

/** Lease returned to an admitted caller. */
export type BoundedConcurrencyLease = {
  /** Frees the slot once. Returns false when the lease was already released. */
  release(): boolean;
  /** Milliseconds spent waiting for a slot (0 when admitted immediately). */
  readonly waitedMs: number;
  readonly released: boolean;
};

/** Outcome of one admission attempt. */
export type BoundedConcurrencyAdmission =
  | { ok: true; lease: BoundedConcurrencyLease; waitedMs: number }
  | {
      ok: false;
      reason: BoundedConcurrencyRejection;
      waitedMs: number;
      snapshot: Pick<
        BoundedConcurrencyStats,
        "active" | "queued" | "maxConcurrent" | "maxQueue" | "queueTimeoutMs"
      >;
    };

/** Options accepted by `acquire`. */
export type BoundedConcurrencyAcquireOptions = {
  /** Caller-owned cancellation. An already-aborted signal is refused immediately. */
  signal?: AbortSignal;
  /** Overrides the gate's default queued-wait deadline for this caller. */
  timeoutMs?: number;
  /** Diagnostic label reported through `onEvent`; never contains secrets. */
  label?: string;
};

/** Diagnostic event emitted on admission, rejection and release. */
export type BoundedConcurrencyEvent = {
  type: "admitted" | "queued" | "rejected";
  reason?: BoundedConcurrencyRejection;
  waitedMs: number;
  label?: string;
  snapshot: Pick<
    BoundedConcurrencyStats,
    "active" | "queued" | "maxConcurrent" | "maxQueue" | "queueTimeoutMs"
  >;
};

/** Public gate surface. */
export type BoundedConcurrencyGate = {
  acquire(options?: BoundedConcurrencyAcquireOptions): Promise<BoundedConcurrencyAdmission>;
  stats(): BoundedConcurrencyStats;
  /** Replaces limits for future admissions; already-held slots are unaffected. */
  setLimits(params: { maxConcurrent?: number; maxQueue?: number; queueTimeoutMs?: number }): void;
  /** Rejects every queued waiter and refuses new admissions. */
  close(reason?: BoundedConcurrencyRejection): void;
};

/** Resolves a positive finite integer, falling back when the input is unusable. */
function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const floored = Math.floor(value);
  return floored > 0 ? floored : fallback;
}

/** Resolves a non-negative finite integer (0 allowed), falling back when unusable. */
function resolveNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const floored = Math.floor(value);
  return floored >= 0 ? floored : fallback;
}

type Waiter = {
  settled: boolean;
  queuedAtMs: number;
  deadlineMs: number;
  timer?: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  signal?: AbortSignal;
  label?: string;
  resolve: (admission: BoundedConcurrencyAdmission) => void;
};

/**
 * Creates a bounded concurrency gate.
 *
 * `maxQueue: 0` means "no waiting at all": a caller that cannot be admitted
 * immediately is rejected as `overloaded`.
 */
export function createBoundedConcurrencyGate(params: {
  maxConcurrent: number;
  /** Maximum queued waiters. Defaults to `maxConcurrent`, i.e. bounded by derivation. */
  maxQueue?: number;
  /** Default queued-wait deadline in milliseconds. */
  queueTimeoutMs?: number;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
  /** Optional diagnostics sink; must not throw. */
  onEvent?: (event: BoundedConcurrencyEvent) => void;
}): BoundedConcurrencyGate {
  const now = params.now ?? Date.now;
  let maxConcurrent = resolvePositiveInteger(params.maxConcurrent, 1);
  let maxQueue = resolveNonNegativeInteger(params.maxQueue, maxConcurrent);
  let queueTimeoutMs = resolveNonNegativeInteger(params.queueTimeoutMs, 30_000);

  let active = 0;
  let closed = false;
  const waiters: Waiter[] = [];
  const counters = {
    peakActive: 0,
    peakQueued: 0,
    admitted: 0,
    rejectedOverloaded: 0,
    rejectedQueueTimeout: 0,
    rejectedAborted: 0,
    completed: 0,
    doubleRelease: 0,
    queuedWaitTotalMs: 0,
    queuedWaitMaxMs: 0,
  };

  const snapshot = () => ({ active, queued: waiters.length, maxConcurrent, maxQueue, queueTimeoutMs });

  const emit = (event: BoundedConcurrencyEvent): void => {
    try {
      params.onEvent?.(event);
    } catch {
      // Diagnostics must never break admission.
    }
  };

  const buildLease = (waitedMs: number): BoundedConcurrencyLease => {
    let released = false;
    return {
      waitedMs,
      get released() {
        return released;
      },
      release(): boolean {
        if (released) {
          counters.doubleRelease += 1;
          return false;
        }
        released = true;
        counters.completed += 1;
        active = Math.max(0, active - 1);
        dispatchAvailable();
        return true;
      },
    };
  };

  const settleWaiter = (waiter: Waiter, admission: BoundedConcurrencyAdmission): void => {
    if (waiter.settled) {
      return;
    }
    waiter.settled = true;
    if (waiter.timer) {
      clearTimeout(waiter.timer);
      waiter.timer = undefined;
    }
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    waiter.resolve(admission);
  };

  /** Reconcile owned slots with current limits before admitting queued work. */
  const dispatchAvailable = (): void => {
    if (closed) return;
    for (const waiter of [...waiters]) {
      if (waiter.settled) continue;
      const reason = waiter.signal?.aborted ? "aborted" : now() >= waiter.deadlineMs ? "queue-timeout" : undefined;
      if (!reason) continue;
      const index = waiters.indexOf(waiter);
      if (index < 0) continue;
      waiters.splice(index, 1);
      const waitedMs = Math.max(0, now() - waiter.queuedAtMs);
      reject(waiter, reason, waitedMs);
      settleWaiter(waiter, { ok: false, reason, waitedMs, snapshot: snapshot() });
    }
    while (!closed && active < maxConcurrent && waiters.length > 0) {
      const waiter = waiters.shift();
      if (!waiter || waiter.settled) {
        continue;
      }
      const waitedMs = Math.max(0, now() - waiter.queuedAtMs);
      active += 1;
      counters.admitted += 1;
      counters.peakActive = Math.max(counters.peakActive, active);
      counters.queuedWaitTotalMs += waitedMs;
      if (waitedMs > counters.queuedWaitMaxMs) {
        counters.queuedWaitMaxMs = waitedMs;
      }
      settleWaiter(waiter, { ok: true, lease: buildLease(waitedMs), waitedMs });
      emit({ type: "admitted", waitedMs, label: waiter.label, snapshot: snapshot() });
    }
  };

  const reject = (
    waiter: Waiter,
    reason: BoundedConcurrencyRejection,
    waitedMs: number,
  ): void => {
    if (reason === "overloaded") {
      counters.rejectedOverloaded += 1;
    } else if (reason === "queue-timeout") {
      counters.rejectedQueueTimeout += 1;
    } else {
      counters.rejectedAborted += 1;
    }
    emit({ type: "rejected", reason, waitedMs, label: waiter.label, snapshot: snapshot() });
  };

  const acquire = async (
    options?: BoundedConcurrencyAcquireOptions,
  ): Promise<BoundedConcurrencyAdmission> => {
    const label = options?.label;
    if (closed) {
      const waiter: Waiter = { settled: false, queuedAtMs: now(), deadlineMs: now(), resolve: () => {} };
      reject(waiter, "aborted", 0);
      return { ok: false, reason: "aborted", waitedMs: 0, snapshot: snapshot() };
    }
    if (options?.signal?.aborted) {
      const waiter: Waiter = { settled: false, queuedAtMs: now(), deadlineMs: now(), resolve: () => {} };
      reject(waiter, "aborted", 0);
      return { ok: false, reason: "aborted", waitedMs: 0, snapshot: snapshot() };
    }
    dispatchAvailable();
    if (active < maxConcurrent) {
      active += 1;
      counters.admitted += 1;
      if (active > counters.peakActive) {
        counters.peakActive = active;
      }
      emit({ type: "admitted", waitedMs: 0, label, snapshot: snapshot() });
      return { ok: true, lease: buildLease(0), waitedMs: 0 };
    }
    if (waiters.length >= maxQueue) {
      const waiter: Waiter = { settled: false, queuedAtMs: now(), deadlineMs: now(), resolve: () => {} };
      reject(waiter, "overloaded", 0);
      return { ok: false, reason: "overloaded", waitedMs: 0, snapshot: snapshot() };
    }

    const queuedAtMs = now();
    const effectiveTimeoutMs =
      options?.timeoutMs === undefined
        ? queueTimeoutMs
        : resolveNonNegativeInteger(options.timeoutMs, queueTimeoutMs);
    return await new Promise<BoundedConcurrencyAdmission>((resolve) => {
      const waiter: Waiter = {
        settled: false,
        queuedAtMs,
        deadlineMs: effectiveTimeoutMs > 0 ? queuedAtMs + effectiveTimeoutMs : Number.POSITIVE_INFINITY,
        signal: options?.signal,
        label,
        resolve,
      };
      if (effectiveTimeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          if (waiter.settled) {
            return;
          }
          const index = waiters.indexOf(waiter);
          if (index >= 0) {
            waiters.splice(index, 1);
          }
          const waitedMs = Math.max(0, now() - queuedAtMs);
          reject(waiter, "queue-timeout", waitedMs);
          settleWaiter(waiter, {
            ok: false,
            reason: "queue-timeout",
            waitedMs,
            snapshot: snapshot(),
          });
        }, effectiveTimeoutMs);
      }
      if (options?.signal) {
        const signal = options.signal;
        waiter.onAbort = () => {
          if (waiter.settled) {
            return;
          }
          const index = waiters.indexOf(waiter);
          if (index >= 0) {
            waiters.splice(index, 1);
          }
          const waitedMs = Math.max(0, now() - queuedAtMs);
          reject(waiter, "aborted", waitedMs);
          settleWaiter(waiter, { ok: false, reason: "aborted", waitedMs, snapshot: snapshot() });
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      waiters.push(waiter);
      if (waiters.length > counters.peakQueued) {
        counters.peakQueued = waiters.length;
      }
      emit({ type: "queued", waitedMs: 0, label, snapshot: snapshot() });
    });
  };

  return {
    acquire,
    stats(): BoundedConcurrencyStats {
      return { ...counters, ...snapshot(), closed };
    },
    setLimits(next): void {
      if (next.maxConcurrent !== undefined) {
        maxConcurrent = resolvePositiveInteger(next.maxConcurrent, maxConcurrent);
      }
      if (next.maxQueue !== undefined) {
        maxQueue = resolveNonNegativeInteger(next.maxQueue, maxQueue);
      }
      if (next.queueTimeoutMs !== undefined) {
        queueTimeoutMs = resolveNonNegativeInteger(next.queueTimeoutMs, queueTimeoutMs);
      }
      dispatchAvailable();
    },
    close(reason: BoundedConcurrencyRejection = "aborted"): void {
      closed = true;
      for (const waiter of waiters.splice(0)) {
        const waitedMs = Math.max(0, now() - waiter.queuedAtMs);
        reject(waiter, reason, waitedMs);
        settleWaiter(waiter, { ok: false, reason, waitedMs, snapshot: snapshot() });
      }
    },
  };
}
