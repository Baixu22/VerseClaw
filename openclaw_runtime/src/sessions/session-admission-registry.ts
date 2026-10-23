// Runtime Lifecycle Governance — process-level session admission gate.
//
// Phase 0 foundation. Production entry points always acquire a real permit;
// lifecycle safety must not depend on an opt-in environment flag.
//
// Issue #102 hardening: fence waits are bounded by an explicit budget (or the
// caller's abort signal) instead of an unbounded `setImmediate` poll, idle
// entries are reclaimable through a bounded capacity rather than retained
// forever, and the registry exposes entry/active/fenced/waiter counters plus
// observed wait timing. A fence that times out stays closed: it is never
// released automatically, so a deleted generation cannot re-admit itself, and
// the existing `removeFence` recovery path remains the only way out.
import { parseAgentSessionKey } from "../routing/session-key.js";

/** Side-effect entry-point kinds that must take an admission permit. */
export type SessionAdmissionKind =
  | "chat-send"
  | "sessions-send"
  | "sessions-steer"
  | "reply-turn"
  | "embedded-agent"
  | "subagent-spawn"
  | "acp-spawn"
  | "exec-spawn"
  | "verseshell-spawn"
  | "goal-wake-arm"
  | "goal-wake-ack";

/**
 * Lifecycle identity. `scopeKey` is deliberately not part of identity:
 * reset/delete fencing must distinguish session generations.
 */
export type SessionAdmissionIdentity = {
  agentId: string;
  canonicalSessionKey: string;
  expectedSessionId: string;
};

export type SessionAdmissionPermit = {
  identity: SessionAdmissionIdentity;
  kind: SessionAdmissionKind;
  release: () => void;
};

/**
 * Bounded waiting budget for `fence()`. Callers should pass the cleanup budget
 * they already own (session drain / reset / stop) and any abort signal from the
 * lifecycle chain; the default keeps a leaked permit from hanging the caller
 * forever while remaining well above a healthy drain.
 */
export type SessionAdmissionFenceOptions = {
  /** Absolute wait budget in milliseconds. Defaults to the registry default. */
  timeoutMs?: number;
  /** Caller cancellation (for example an aborted session operation). */
  signal?: AbortSignal;
  /** Diagnostic label for the lifecycle operation owning this fence. */
  operation?: string;
};

/** How a fence wait ended when it could not drain in time. */
export type SessionAdmissionFenceWaitReason = "timeout" | "aborted";

export type SessionAdmissionFenceDiagnostics = {
  /** Milliseconds spent waiting for in-flight permits to drain. */
  waitedMs: number;
  /** In-flight permits the fence had to wait for when it closed the entry. */
  activeAtFence: number;
};

export type SessionAdmissionFenceHandle = {
  identity: SessionAdmissionIdentity;
  token: object;
  release: () => void;
  diagnostics: SessionAdmissionFenceDiagnostics;
};

/** Diagnostics counters. Aggregates are bounded; no per-identity history is kept. */
export type SessionAdmissionRegistryStats = {
  /** Live map entries, including tombstones for deleted generations. */
  entries: number;
  /** Live entries holding the closed-fence rejection duty. */
  fenced: number;
  /** In-flight permits across every entry. */
  active: number;
  /** Fence waiters currently parked. */
  waiters: number;
  /** Cumulative entries reclaimed because they were idle and had no duty. */
  retiredEntries: number;
  /** Cumulative fence waits that had at least one in-flight permit. */
  fenceWaits: number;
  /** Cumulative fence waits that ended in a timeout. */
  fenceTimeouts: number;
  /** Cumulative fence waits that ended through caller abort. */
  fenceAborts: number;
  /** Cumulative wait time observed across all fence waits. */
  totalFenceWaitMs: number;
  /** Longest single observed fence wait. */
  maxFenceWaitMs: number;
  /** Capacity bound for idle entries. */
  maxEntries: number;
};

export class SessionAdmissionFencedError extends Error {
  constructor(identity: SessionAdmissionIdentity) {
    super(
      `session admission is fenced for ${identity.canonicalSessionKey} (${identity.expectedSessionId})`,
    );
    this.name = "SessionAdmissionFencedError";
  }
}

export class SessionAdmissionIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionAdmissionIdentityError";
  }
}

/**
 * Raised when a fence could not drain within its budget. The fence stays closed
 * (it is never released automatically); the caller must fail closed and use the
 * existing recovery path (`removeFence`) rather than retrying the mutation.
 */
export class SessionAdmissionFenceWaitError extends Error {
  readonly reason: SessionAdmissionFenceWaitReason;
  readonly identity: SessionAdmissionIdentity;
  readonly activeAtFailure: number;
  readonly waitedMs: number;
  readonly operation?: string;

  constructor(params: {
    reason: SessionAdmissionFenceWaitReason;
    identity: SessionAdmissionIdentity;
    activeAtFailure: number;
    waitedMs: number;
    timeoutMs: number;
    operation?: string;
  }) {
    super(
      `session admission fence for ${params.identity.canonicalSessionKey} ` +
        `(${params.identity.expectedSessionId}) did not drain within ${params.timeoutMs}ms ` +
        `(${params.reason}); ${params.activeAtFailure} permit(s) still in flight` +
        (params.operation ? ` [${params.operation}]` : ""),
    );
    this.name = "SessionAdmissionFenceWaitError";
    this.reason = params.reason;
    this.identity = params.identity;
    this.activeAtFailure = params.activeAtFailure;
    this.waitedMs = params.waitedMs;
    this.operation = params.operation;
  }
}

/** Default fence budget. Matches the session drain budget used by reset/stop. */
export const SESSION_ADMISSION_FENCE_DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Default capacity for idle entries. Live entries (in-flight permits, closed
 * fences) are never evicted by this bound; only entries with no active permit,
 * no fence and no waiter are reclaimed.
 */
export const SESSION_ADMISSION_DEFAULT_MAX_ENTRIES = 1_024;

type AdmissionEntry = {
  active: number;
  fenced: boolean;
  fenceToken: object | null;
  totalPermits: number;
  totalRejectedWhileFenced: number;
  /** Parked fence waiters, notified when the last in-flight permit releases. */
  waiters: Set<() => void>;
};

/** Public snapshot: no live waiter handles and no internal bookkeeping. */
export type SessionAdmissionSnapshot = {
  active: number;
  fenced: boolean;
  totalPermits: number;
  totalRejectedWhileFenced: number;
};

type FenceHandle = SessionAdmissionFenceHandle;

function identityKey(identity: SessionAdmissionIdentity): string {
  return JSON.stringify([
    identity.agentId,
    identity.canonicalSessionKey,
    identity.expectedSessionId,
  ]);
}

function assertIdentity(identity: SessionAdmissionIdentity): void {
  if (!identity.agentId.trim()) {
    throw new SessionAdmissionIdentityError("admission identity requires agentId");
  }
  if (!identity.canonicalSessionKey.trim()) {
    throw new SessionAdmissionIdentityError("admission identity requires canonicalSessionKey");
  }
  if (!identity.expectedSessionId.trim()) {
    throw new SessionAdmissionIdentityError("admission identity requires expectedSessionId");
  }
}

function defaultIdentity(
  identity: Omit<SessionAdmissionIdentity, "agentId"> & { agentId?: string },
): SessionAdmissionIdentity {
  const agentId =
    identity.agentId?.trim() || parseAgentSessionKey(identity.canonicalSessionKey)?.agentId?.trim();
  if (!agentId) {
    throw new SessionAdmissionIdentityError(
      `unable to resolve agentId for admission identity ${identity.canonicalSessionKey}`,
    );
  }
  return {
    agentId,
    canonicalSessionKey: identity.canonicalSessionKey.trim(),
    expectedSessionId: identity.expectedSessionId.trim(),
  };
}

function newEntry(): AdmissionEntry {
  return {
    active: 0,
    fenced: false,
    fenceToken: null,
    totalPermits: 0,
    totalRejectedWhileFenced: 0,
    waiters: new Set(),
  };
}

/**
 * A fence may only be released/drained when it is idle and carries no rejection
 * duty. A closed fence is a tombstone for a deleted generation, so it is never
 * reclaimed; that is what keeps a deleted generation from re-admitting after
 * retirement, timeout or retry.
 */
function isReclaimable(entry: AdmissionEntry): boolean {
  return entry.active === 0 && !entry.fenced && entry.waiters.size === 0;
}

/**
 * Process-level registry. JavaScript's single-threaded turn semantics make the
 * fenced check + active counter increment atomic with respect to `fence()`.
 */
export class SessionAdmissionRegistry {
  readonly #entries = new Map<string, AdmissionEntry>();
  readonly #maxEntries: number;
  #retiredEntries = 0;
  #fenceWaits = 0;
  #fenceTimeouts = 0;
  #fenceAborts = 0;
  #totalFenceWaitMs = 0;
  #maxFenceWaitMs = 0;
  #now: () => number;

  constructor(options?: { maxEntries?: number; now?: () => number }) {
    const requested = options?.maxEntries;
    this.#maxEntries =
      typeof requested === "number" && Number.isFinite(requested) && requested >= 1
        ? Math.floor(requested)
        : SESSION_ADMISSION_DEFAULT_MAX_ENTRIES;
    this.#now = options?.now ?? Date.now;
  }

  acquirePermit(
    identityInput: Omit<SessionAdmissionIdentity, "agentId"> & {
      agentId?: string;
    },
    kind: SessionAdmissionKind,
  ): () => void {
    const identity = defaultIdentity(identityInput);
    void kind;
    assertIdentity(identity);
    const key = identityKey(identity);
    const entry = this.#entry(key);
    if (entry.fenced) {
      entry.totalRejectedWhileFenced += 1;
      throw new SessionAdmissionFencedError(identity);
    }
    entry.active += 1;
    entry.totalPermits += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.active = Math.max(0, entry.active - 1);
      if (entry.active === 0 && entry.waiters.size > 0) {
        // Release-event notification: parked fences wake immediately instead of
        // polling the event loop while a critical section is still running.
        const waiters = [...entry.waiters];
        entry.waiters.clear();
        for (const waiter of waiters) {
          waiter();
        }
      }
    };
  }

  /**
   * Atomically closes the entry point, then waits for in-flight admission
   * critical sections to drain. The wait is bounded by `timeoutMs` (default
   * `SESSION_ADMISSION_FENCE_DEFAULT_TIMEOUT_MS`) and by the optional caller
   * abort signal. On failure the fence stays closed and a
   * `SessionAdmissionFenceWaitError` is thrown; `release()` (or `removeFence`)
   * reopens the identity.
   */
  async fence(
    identityInput: Omit<SessionAdmissionIdentity, "agentId"> & {
      agentId?: string;
    },
    options?: SessionAdmissionFenceOptions,
  ): Promise<FenceHandle> {
    const identity = defaultIdentity(identityInput);
    assertIdentity(identity);
    const key = identityKey(identity);
    const entry = this.#entry(key);
    if (entry.fenced) {
      throw new SessionAdmissionFencedError(identity);
    }
    const token = {};
    entry.fenced = true;
    entry.fenceToken = token;
    const timeoutMs = this.#resolveTimeout(options?.timeoutMs);
    const activeAtFence = entry.active;
    let waitedMs = 0;
    if (activeAtFence > 0 || entry.waiters.size > 0) {
      this.#fenceWaits += 1;
      waitedMs = await this.#waitForDrain(entry, {
        timeoutMs,
        signal: options?.signal,
        identity,
        operation: options?.operation,
      });
    }
    const diagnostics: SessionAdmissionFenceDiagnostics = { waitedMs, activeAtFence };
    let released = false;
    return {
      identity,
      token,
      diagnostics,
      release: () => {
        if (released) return;
        released = true;
        if (entry.fenceToken === token && entry.active === 0) {
          entry.fenced = false;
          entry.fenceToken = null;
        }
      },
    };
  }

  isFenced(identity: SessionAdmissionIdentity): boolean {
    const key = identityKey(identity);
    return this.#entries.get(key)?.fenced === true;
  }

  ownsFence(handle: SessionAdmissionFenceHandle): boolean {
    const entry = this.#entries.get(identityKey(handle.identity));
    return entry?.fenced === true && entry.fenceToken === handle.token && entry.active === 0;
  }

  removeFence(identity: SessionAdmissionIdentity): void {
    const key = identityKey(identity);
    const entry = this.#entries.get(key);
    if (!entry) return;
    entry.fenced = false;
    entry.fenceToken = null;
  }

  snapshot(identity: SessionAdmissionIdentity): SessionAdmissionSnapshot | undefined {
    const key = identityKey(identity);
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    return {
      active: entry.active,
      fenced: entry.fenced,
      totalPermits: entry.totalPermits,
      totalRejectedWhileFenced: entry.totalRejectedWhileFenced,
    };
  }

  /**
   * Reclaims every entry that is idle, unfenced and has no parked waiter.
   *
   * Entries holding the closed-fence rejection duty (deleted-generation
   * tombstones) and entries with in-flight permits or waiters are deliberately
   * retained: dropping them would either re-admit a deleted generation or lose a
   * waiter. Returns the observed counts so a caller can report them instead of
   * asserting an unmeasured growth rate.
   */
  retireInactiveEntries(): { retired: number; live: number } {
    let retired = 0;
    for (const [key, entry] of this.#entries) {
      if (!isReclaimable(entry)) continue;
      this.#entries.delete(key);
      retired += 1;
    }
    this.#retiredEntries += retired;
    return { retired, live: this.#entries.size };
  }

  stats(): SessionAdmissionRegistryStats {
    let active = 0;
    let fenced = 0;
    let waiters = 0;
    for (const entry of this.#entries.values()) {
      active += entry.active;
      if (entry.fenced) fenced += 1;
      waiters += entry.waiters.size;
    }
    return {
      entries: this.#entries.size,
      fenced,
      active,
      waiters,
      retiredEntries: this.#retiredEntries,
      fenceWaits: this.#fenceWaits,
      fenceTimeouts: this.#fenceTimeouts,
      fenceAborts: this.#fenceAborts,
      totalFenceWaitMs: this.#totalFenceWaitMs,
      maxFenceWaitMs: this.#maxFenceWaitMs,
      maxEntries: this.#maxEntries,
    };
  }

  clearForTests(): void {
    this.#entries.clear();
    this.#retiredEntries = 0;
    this.#fenceWaits = 0;
    this.#fenceTimeouts = 0;
    this.#fenceAborts = 0;
    this.#totalFenceWaitMs = 0;
    this.#maxFenceWaitMs = 0;
  }

  #resolveTimeout(value: number | undefined): number {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    return SESSION_ADMISSION_FENCE_DEFAULT_TIMEOUT_MS;
  }

  #waitForDrain(
    entry: AdmissionEntry,
    params: {
      timeoutMs: number;
      signal?: AbortSignal;
      identity: SessionAdmissionIdentity;
      operation?: string;
    },
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const startedAt = this.#now();
      let settled = false;
      const settle = (finish: () => void): void => {
        if (settled) return;
        settled = true;
        entry.waiters.delete(onDrain);
        clearTimeout(timer);
        params.signal?.removeEventListener("abort", onAbort);
        const observed = Math.max(0, this.#now() - startedAt);
        this.#totalFenceWaitMs += observed;
        this.#maxFenceWaitMs = Math.max(this.#maxFenceWaitMs, observed);
        finish();
      };
      const onDrain = (): void => settle(() => resolve(Math.max(0, this.#now() - startedAt)));
      const onAbort = (): void => {
        this.#fenceAborts += 1;
        settle(() =>
          reject(
            new SessionAdmissionFenceWaitError({
              reason: "aborted",
              identity: params.identity,
              activeAtFailure: entry.active,
              waitedMs: Math.max(0, this.#now() - startedAt),
              timeoutMs: params.timeoutMs,
              operation: params.operation,
            }),
          ),
        );
      };
      const onTimeout = (): void => {
        this.#fenceTimeouts += 1;
        settle(() =>
          reject(
            new SessionAdmissionFenceWaitError({
              reason: "timeout",
              identity: params.identity,
              activeAtFailure: entry.active,
              waitedMs: Math.max(0, this.#now() - startedAt),
              timeoutMs: params.timeoutMs,
              operation: params.operation,
            }),
          ),
        );
      };
      const timer = setTimeout(onTimeout, params.timeoutMs);
      entry.waiters.add(onDrain);
      if (params.signal?.aborted) {
        onAbort();
        return;
      }
      params.signal?.addEventListener("abort", onAbort, { once: true });
      // A concurrent release may have drained the entry before the waiter was
      // registered; re-check so the fence cannot miss the notification.
      if (entry.active === 0) {
        onDrain();
      }
    });
  }

  #entry(key: string): AdmissionEntry {
    let entry = this.#entries.get(key);
    if (!entry) {
      this.#enforceEntryBound();
      entry = newEntry();
      this.#entries.set(key, entry);
    }
    return entry;
  }

  /**
   * Capacity bound for idle entries. Evicts the oldest reclaimable entry only;
   * when every entry is live (in-flight permit, closed fence, parked waiter) the
   * map may temporarily exceed the bound rather than drop live lifecycle state.
   */
  #enforceEntryBound(): void {
    if (this.#entries.size < this.#maxEntries) return;
    for (const [key, entry] of this.#entries) {
      if (!isReclaimable(entry)) continue;
      this.#entries.delete(key);
      this.#retiredEntries += 1;
      return;
    }
  }
}

export const sessionAdmissionRegistry = new SessionAdmissionRegistry();

/** Required production entry-point hook. Never silently degrades to a no-op. */
export function acquireSessionAdmissionPermit(
  identity: Omit<SessionAdmissionIdentity, "agentId"> & { agentId?: string },
  kind: SessionAdmissionKind,
): () => void {
  return sessionAdmissionRegistry.acquirePermit(identity, kind);
}
