// Gateway exec approval manager.
// RC-04: when a durable ApprovalLedger is injected it is the sole approval
// truth: create/resolve commit through the ledger first and the in-process
// Map is a disposable cache (pending waiters, expiry timers, prefix lookup).
// A Gateway restart recovers pending truth from the ledger via
// recoverPendingFromLedger(). Without a ledger (legacy mode) the Map remains
// the transient owner until cutover is complete.
import { randomUUID } from "node:crypto";
import { resolveExpiresAtMsFromDurationMs } from "@openclaw/normalization-core/number-coercion";
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import type {
  ExecApprovalDecision,
  ExecApprovalRequestPayload as InfraExecApprovalRequestPayload,
} from "../infra/exec-approvals.js";
import { resolveTimerTimeoutMs } from "../shared/number-coercion.js";
import type { ApprovalLedger } from "../agents/approval-ledger.js";

// Grace period to keep resolved entries for late awaitDecision calls
const RESOLVED_ENTRY_GRACE_MS = 15_000;

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const unref = (timer as { unref?: () => void }).unref;
  if (typeof unref === "function") {
    unref.call(timer);
  }
}

function scheduleResolvedEntryCleanup(cleanup: () => void): void {
  // Resolved approvals stay visible briefly so node.invoke sanitizers can
  // consume a just-approved id after the UI decision races the command retry.
  const timer = setTimeout(cleanup, RESOLVED_ENTRY_GRACE_MS);
  unrefTimer(timer);
}

function resolveApprovalTimeoutMs(timeoutMs: number): number {
  return resolveTimerTimeoutMs(timeoutMs, 1);
}

type ExecApprovalRequestPayload = InfraExecApprovalRequestPayload;

export type ExecApprovalRecord<TPayload = ExecApprovalRequestPayload> = {
  id: string;
  request: TPayload;
  createdAtMs: number;
  expiresAtMs: number;
  // Caller metadata (best-effort). Used to prevent other clients from replaying an approval id.
  requestedByConnId?: string | null;
  requestedByDeviceId?: string | null;
  requestedByClientId?: string | null;
  requestedByDeviceTokenAuth?: boolean;
  resolvedAtMs?: number;
  decision?: ExecApprovalDecision;
  consumedDecision?: ExecApprovalDecision;
  resolvedBy?: string | null;
};

type PendingEntry<TPayload = ExecApprovalRequestPayload> = {
  record: ExecApprovalRecord<TPayload>;
  resolve: (decision: ExecApprovalDecision | null) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<ExecApprovalDecision | null>;
};

export type ExecApprovalIdLookupResult =
  | { kind: "exact" | "prefix"; id: string }
  | { kind: "ambiguous"; ids: string[] }
  | { kind: "none" };

export type ExecApprovalManagerOptions = {
  /** RC-04 durable approval owner. When present it is the sole approval truth. */
  durableLedger?: ApprovalLedger;
};

export class ExecApprovalManager<TPayload = ExecApprovalRequestPayload> {
  private pending = new Map<string, PendingEntry<TPayload>>();
  /** RC-04 durable approval owner; when present it is authoritative. */
  private readonly durableLedger?: ApprovalLedger;

  constructor(options: ExecApprovalManagerOptions = {}) {
    this.durableLedger = options.durableLedger;
  }

  /** The durable ledger when configured (authority mode). */
  get ledger(): ApprovalLedger | undefined {
    return this.durableLedger;
  }

  create(
    request: TPayload,
    timeoutMs: number,
    id?: string | null,
    requester?: {
      connId?: string | null;
      deviceId?: string | null;
      clientId?: string | null;
    },
  ): ExecApprovalRecord<TPayload> {
    const now = Date.now();
    const resolvedTimeoutMs = resolveApprovalTimeoutMs(timeoutMs);
    const expiresAtMs = resolveExpiresAtMsFromDurationMs(resolvedTimeoutMs, { nowMs: now });
    if (expiresAtMs === undefined) {
      throw new Error("approval expiry is unavailable");
    }
    const resolvedId = id && id.trim().length > 0 ? id.trim() : randomUUID();
    const record: ExecApprovalRecord<TPayload> = {
      id: resolvedId,
      request,
      createdAtMs: now,
      expiresAtMs,
      requestedByConnId: requester?.connId ?? null,
      requestedByDeviceId: requester?.deviceId ?? null,
      requestedByClientId: requester?.clientId ?? null,
    };
    // RC-04 durable authority: the intent -> approval_pending transition must
    // commit through the ledger; a ledger failure is a hard failure, never a
    // silent fallback to the process Map as a second authority. Requester
    // identity is persisted atomically with the reservation so the bind
    // survives Gateway restarts (the in-process record is only a cache).
    if (this.durableLedger) {
      const reserved = this.durableLedger.reserve({
        idempotencyKey: resolvedId,
        approvalId: resolvedId,
        request: record.request as Record<string, unknown>,
        expiresAtMs,
        createdAt: now,
        requestedByConnId: requester?.connId ?? undefined,
        requestedByDeviceId: requester?.deviceId ?? undefined,
        requestedByClientId: requester?.clientId ?? undefined,
      });
      if (!reserved.ok) {
        throw new Error(`approval ledger reserve failed for '${resolvedId}': ${reserved.reason}`);
      }
    }
    return record;
  }

  /**
   * Register an approval record and return a promise that resolves when the decision is made.
   * This separates registration (synchronous) from waiting (async), allowing callers to
   * confirm registration before the decision is made.
   */
  register(
    record: ExecApprovalRecord<TPayload>,
    timeoutMs: number,
  ): Promise<ExecApprovalDecision | null> {
    const existing = this.pending.get(record.id);
    if (existing) {
      // Idempotent: return existing promise if still pending
      if (existing.record.resolvedAtMs === undefined) {
        return existing.promise;
      }
      // Already resolved - don't allow re-registration
      throw new Error(`approval id '${record.id}' already resolved`);
    }
    let resolvePromise: (decision: ExecApprovalDecision | null) => void;
    let rejectPromise: (err: Error) => void;
    const promise = new Promise<ExecApprovalDecision | null>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    // Create entry first so we can capture it in the closure (not re-fetch from map)
    const entry: PendingEntry<TPayload> = {
      record,
      resolve: resolvePromise!,
      reject: rejectPromise!,
      timer: null as unknown as ReturnType<typeof setTimeout>,
      promise,
    };
    const timerDelayMs = resolveApprovalTimeoutMs(timeoutMs);
    entry.timer = setTimeout(() => {
      this.expire(record.id);
    }, timerDelayMs);
    this.pending.set(record.id, entry);
    return promise;
  }

  /**
   * @deprecated Use register() instead for explicit separation of registration and waiting.
   */
  async waitForDecision(
    record: ExecApprovalRecord<TPayload>,
    timeoutMs: number,
  ): Promise<ExecApprovalDecision | null> {
    return this.register(record, timeoutMs);
  }

  resolve(recordId: string, decision: ExecApprovalDecision, resolvedBy?: string | null): boolean {
    const pending = this.pending.get(recordId);
    if (!pending) {
      return false;
    }
    // Prevent double-resolve (e.g., if called after timeout already resolved)
    if (pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    // RC-04 durable authority: the approval_pending -> approved|denied
    // transition must commit through the ledger first. The ledger result is
    // final; the process Map only mirrors it. An identical decision already
    // committed in the ledger (e.g. by another process) is treated as
    // idempotent success.
    if (this.durableLedger) {
      const ledgerDecision = decision === "deny" ? "denied" : "approved";
      const resolved = this.durableLedger.resolve({
        approvalId: recordId,
        decision: ledgerDecision,
        resolvedBy: resolvedBy ?? undefined,
      });
      if (!resolved.ok) {
        if (resolved.row?.state === ledgerDecision) {
          // Already resolved identically in the durable owner: idempotent.
        } else {
          return false;
        }
      }
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = decision;
    pending.record.resolvedBy = resolvedBy ?? null;
    // Resolve the promise first, then delete after a grace period.
    // This allows in-flight awaitDecision calls to find the resolved entry.
    pending.resolve(decision);
    scheduleResolvedEntryCleanup(() => {
      // Only delete if the entry hasn't been replaced
      if (this.pending.get(recordId) === pending) {
        this.pending.delete(recordId);
      }
    });
    return true;
  }

  /**
   * RC-04 restart recovery: re-register pending approvals from the durable
   * ledger so pending truth survives a Gateway restart. Only rows that have
   * not expired are restored; the raw request payload was never persisted, so
   * restored records carry a digest-only marker (the decision/audit truth is
   * still complete). Returns the number of restored records.
   */
  recoverPendingFromLedger(): number {
    if (!this.durableLedger) {
      return 0;
    }
    const now = Date.now();
    const rows = this.durableLedger.listByState("approval_pending");
    let restored = 0;
    for (const row of rows) {
      if (this.pending.has(row.approval_id)) {
        continue;
      }
      if (row.expires_at_ms <= now) {
        continue;
      }
      const record: ExecApprovalRecord<TPayload> = {
        id: row.approval_id,
        request: {
          digestOnly: true,
          requestDigest: row.request_digest,
          command: "",
        } as unknown as TPayload,
        createdAtMs: row.created_at,
        expiresAtMs: row.expires_at_ms,
        requestedByConnId: row.requested_by_conn_id ?? null,
        requestedByDeviceId: row.requested_by_device_id ?? null,
        requestedByClientId: row.requested_by_client_id ?? null,
      };
      this.register(record, row.expires_at_ms - now);
      restored += 1;
    }
    return restored;
  }

  expire(recordId: string, resolvedBy?: string | null): boolean {
    const pending = this.pending.get(recordId);
    if (!pending) {
      return false;
    }
    if (pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = undefined;
    pending.record.resolvedBy = resolvedBy ?? null;
    pending.resolve(null);
    scheduleResolvedEntryCleanup(() => {
      if (this.pending.get(recordId) === pending) {
        this.pending.delete(recordId);
      }
    });
    return true;
  }

  getSnapshot(recordId: string): ExecApprovalRecord<TPayload> | null {
    const entry = this.pending.get(recordId);
    return entry?.record ?? null;
  }

  listPendingRecords(): ExecApprovalRecord<TPayload>[] {
    return Array.from(this.pending.values())
      .map((entry) => entry.record)
      .filter((record) => record.resolvedAtMs === undefined);
  }

  consumeAllowOnce(recordId: string): boolean {
    const entry = this.pending.get(recordId);
    if (!entry) {
      return false;
    }
    const record = entry.record;
    if (record.decision !== "allow-once") {
      return false;
    }
    // One-time approvals must be consumed atomically so the same runId
    // cannot be replayed during the resolved-entry grace window.
    record.consumedDecision = record.decision;
    record.decision = undefined;
    return true;
  }

  /**
   * Wait for decision on an already-registered approval.
   * Returns the decision promise if the ID is pending, null otherwise.
   */
  awaitDecision(recordId: string): Promise<ExecApprovalDecision | null> | null {
    const entry = this.pending.get(recordId);
    return entry?.promise ?? null;
  }

  lookupApprovalId(
    input: string,
    opts: {
      includeResolved?: boolean;
      filter?: (record: ExecApprovalRecord<TPayload>) => boolean;
    } = {},
  ): ExecApprovalIdLookupResult {
    const normalized = input.trim();
    if (!normalized) {
      return { kind: "none" };
    }

    const exact = this.pending.get(normalized);
    if (exact) {
      return (opts.includeResolved || exact.record.resolvedAtMs === undefined) &&
        (opts.filter?.(exact.record) ?? true)
        ? { kind: "exact", id: normalized }
        : { kind: "none" };
    }

    const lowerPrefix = normalizeLowercaseStringOrEmpty(normalized);
    const matches: string[] = [];
    for (const [id, entry] of this.pending.entries()) {
      if (!opts.includeResolved && entry.record.resolvedAtMs !== undefined) {
        continue;
      }
      if (opts.filter && !opts.filter(entry.record)) {
        continue;
      }
      if (normalizeLowercaseStringOrEmpty(id).startsWith(lowerPrefix)) {
        matches.push(id);
      }
    }

    if (matches.length === 1) {
      return { kind: "prefix", id: matches[0] };
    }
    if (matches.length > 1) {
      return { kind: "ambiguous", ids: matches };
    }
    return { kind: "none" };
  }

  lookupPendingId(input: string): ExecApprovalIdLookupResult {
    return this.lookupApprovalId(input);
  }
}
