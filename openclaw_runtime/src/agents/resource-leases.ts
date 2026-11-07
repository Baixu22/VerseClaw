/**
 * In-process workspace resource leases for agent tool concurrency.
 *
 * Several subagents can run in the same workspace at once. The lane-level
 * (`subagents.maxConcurrent`) and agent-level (`maxChildrenPerAgent`) limits do
 * not bound how many of them hit the same file tree or process table
 * simultaneously, so this manager adds a workspace-keyed budget with one FIFO
 * queue per (kind, key).
 *
 * It mirrors the Main-process `electron/services/resource-fabric.ts` FIFO +
 * capacity + timeout structure that issue #162 wired into `terminal.run`, and
 * extends it to the workspace budget kinds from issue #167. Keys are opaque
 * strings: callers normalize them with `normalizeWorkspaceLeaseKey` so that
 * Windows case/slash variants and `realpath` aliases share one budget.
 *
 * The manager is ephemeral: it coordinates concurrent work inside a single
 * runtime process and does not persist queue state.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { checkResourceWait, watchResourceWait, resourceQueueFullError, type ResourceWaitOptions } from "../../../shared/resources/wait.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getResourceEnvelopeLedger, type ResourceKind } from "../resources/resource-envelope.js";
import { readProcessTreeSample } from "../process/process-tree-sampler.js";
import { resourceEnvelopeSnapshotPath, writeResourceEnvelopeSnapshot } from "../resources/resource-envelope-snapshot-store.js";

export type ResourceLeaseKind =
  | "workspaceExec"
  | "workspaceSearch"
  | "workspaceWriter"
  | "subtreeMutation"
  | "fileMutation";

export type ResourceLease = {
  leaseKind: ResourceLeaseKind;
  leaseKey: string;
  queuedMs: number;
  deadline?: number;
  release: () => void;
};

type ResourceLeaseMode = "semaphore" | "path";

export type ResourceLeaseOptions = ResourceWaitOptions & {
  /** Maximum time to wait for the lease. `<= 0` waits indefinitely. */
  timeoutMs?: number;
};

const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
let snapshotWriteTimer: ReturnType<typeof setTimeout> | null = null;
let lastResourceEnvelopeSnapshotAt = 0;

function resourceKindForLease(kind: ResourceLeaseKind): ResourceKind {
  switch (kind) {
    case "workspaceExec":
      return "runtime-bash";
    case "workspaceSearch":
      return "workspace-search";
    case "workspaceWriter":
      return "workspace-writer";
    case "subtreeMutation":
      return "subtree-mutation";
    case "fileMutation":
      return "file-mutation";
  }
}

function scheduleResourceEnvelopeSnapshotWrite(): void {
  if (process.env.OPENCLAW_RESOURCE_ENVELOPE_WRITE !== "1" || snapshotWriteTimer) return;
  const delayMs = Math.max(0, 5_000 - (Date.now() - lastResourceEnvelopeSnapshotAt));
  snapshotWriteTimer = setTimeout(() => {
    snapshotWriteTimer = null;
    lastResourceEnvelopeSnapshotAt = Date.now();
    void (async () => {
      try {
        const ledger = getResourceEnvelopeLedger();
        const sample = await readProcessTreeSample({ rootPids: [process.pid] });
        if (sample.status === "ok") {
          ledger.update({
            id: "gateway:process-tree",
            workspaceKey: process.cwd(),
            kind: "runtime-bash",
            priority: "foreground",
            owner: "gateway",
            activeSlots: 0,
            queuedCount: sample.queueDepth,
            queueWaitMs: sample.queueWaitMs,
            processCount: sample.processCount ?? 0,
            treeRssBytes: sample.treeRssBytes ?? 0,
            treeCpuPercent: sample.treeCpuPercent ?? 0,
            pids: sample.rootPids,
            reason: "gateway process tree sample",
          });
        }
        writeResourceEnvelopeSnapshot(
          ledger.snapshot(),
          resourceEnvelopeSnapshotPath("gateway"),
        );
      } catch {
        // Shadow snapshots are best-effort and never affect lease admission.
      }
    })();
  }, delayMs);
  snapshotWriteTimer.unref?.();
}

const RESOURCE_LEASE_CAPACITY: Record<ResourceLeaseKind, number> = {
  workspaceExec: 2,
  workspaceSearch: 2,
  workspaceWriter: 1,
  subtreeMutation: 1,
  fileMutation: 1,
};

// Path kinds treat their key as a filesystem path and reject overlapping
// subtrees; semaphore kinds treat their key as an opaque bucket.
const PATH_LEASE_KINDS = new Set<ResourceLeaseKind>(["subtreeMutation", "fileMutation"]);

function leaseMode(kind: ResourceLeaseKind): ResourceLeaseMode {
  return PATH_LEASE_KINDS.has(kind) ? "path" : "semaphore";
}

/**
 * Normalize a filesystem target into a stable lease key.
 *
 * Windows path comparison is case-insensitive and treats `/` and `\` as the
 * same separator, so two spellings of the same workspace must map to one key.
 * Falls back to the resolved path when the target does not exist yet.
 */
export function normalizeWorkspaceLeaseKey(target: string): string {
  let resolved = path.resolve(target);
  try {
    resolved = realpathSync.native(resolved);
  } catch {
    // Target may not exist yet; the resolved path is still a stable key.
  }
  return process.platform === "win32" ? resolved.replace(/\\/g, "/").toLowerCase() : resolved;
}

function isSameOrDescendantPath(candidate: string, ancestor: string): boolean {
  if (candidate === ancestor) {
    return true;
  }
  const base = ancestor.endsWith("/") ? ancestor : `${ancestor}/`;
  return candidate.startsWith(base);
}

function pathKeysConflict(a: string, b: string): boolean {
  return isSameOrDescendantPath(a, b) || isSameOrDescendantPath(b, a);
}

export class ResourceLeaseTimeoutError extends Error {
  readonly code = "RESOURCE_LEASE_TIMEOUT";
  readonly leaseKind: ResourceLeaseKind;
  readonly leaseKey: string;
  readonly queuedMs: number;
  readonly timeoutMs: number;

  constructor(params: {
    leaseKind: ResourceLeaseKind;
    leaseKey: string;
    queuedMs: number;
    timeoutMs: number;
  }) {
    super(
      `Timed out waiting for ${params.leaseKind} lease (${params.leaseKey}) after ${params.timeoutMs}ms`,
    );
    this.name = "ResourceLeaseTimeoutError";
    this.leaseKind = params.leaseKind;
    this.leaseKey = params.leaseKey;
    this.queuedMs = params.queuedMs;
    this.timeoutMs = params.timeoutMs;
  }
}

type PendingRequest = {
  id: number;
  kind: ResourceLeaseKind;
  key: string;
  requestedAt: number;
  timeoutMs: number;
  resolve: (lease: ResourceLease) => void;
  reject: (error: Error) => void;
  deadline?: number;
  signal?: AbortSignal;
  cleanup: () => void;
};

type ActiveLease = {
  id: number;
  kind: ResourceLeaseKind;
  key: string;
};

function sameBudget(a: PendingRequest | ActiveLease, b: PendingRequest | ActiveLease): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  return leaseMode(a.kind) === "path" ? pathKeysConflict(a.key, b.key) : a.key === b.key;
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 0;
  }
  return Math.max(1, Math.floor(timeoutMs));
}

export class ResourceLeaseManager {
  private nextId = 1;
  private readonly active = new Map<number, ActiveLease>();
  private readonly pending: PendingRequest[] = [];
  private readonly log = createSubsystemLogger("agents/resource-leases");
  private readonly queueLength: number;

  constructor(options: { queueLength?: number } = {}) {
    this.queueLength = options.queueLength ?? 64;
    if (!Number.isInteger(this.queueLength) || this.queueLength < 0) throw new RangeError("Invalid queueLength");
  }

  acquire(
    kind: ResourceLeaseKind,
    key: string,
    options: number | ResourceLeaseOptions = DEFAULT_ACQUIRE_TIMEOUT_MS,
  ): Promise<ResourceLease> {
    const opts = typeof options === "number" ? { timeoutMs: options } : options;
    const normalizedTimeout = normalizeTimeout(opts.timeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS);
    const id = this.nextId++;
    const requestedAt = Date.now();
    const waitDeadline = Math.min(normalizedTimeout > 0 ? requestedAt + normalizedTimeout : Infinity, opts.deadline ?? Infinity);
    return new Promise<ResourceLease>((resolve, reject) => {
      const request: PendingRequest = {
        id,
        kind,
        key,
        requestedAt,
        timeoutMs: normalizedTimeout,
        resolve,
        reject,
        deadline: waitDeadline === Infinity ? undefined : waitDeadline,
        signal: opts.signal,
        cleanup: () => {},
      };
      checkResourceWait(request, () => this.timeoutError(request));
      if (this.canGrant(request) && !this.hasBlockingEarlierRequest(request)) {
        this.pending.push(request);
        this.grant(request);
        return;
      }
      if (this.pending.length >= this.queueLength) {
        reject(resourceQueueFullError());
        return;
      }
      this.pending.push(request);
      request.cleanup = watchResourceWait(request, error => this.reject(request, error), () => this.timeoutError(request));
      if (!this.pending.includes(request)) request.cleanup();
      this.refreshResourceEnvelope(request.kind, request.key, 0);
      this.drain();
    });
  }

  private drain(): void {
    for (const request of this.pending.slice()) {
      if (!this.pending.includes(request)) {
        continue;
      }
      try { checkResourceWait(request, () => this.timeoutError(request)); }
      catch (error) { this.reject(request, error as Error, false); continue; }
      if (this.hasBlockingEarlierRequest(request)) {
        continue;
      }
      if (!this.canGrant(request)) {
        continue;
      }
      this.grant(request);
    }
  }

  private hasBlockingEarlierRequest(request: PendingRequest): boolean {
    for (const earlier of this.pending) {
      if (earlier === request) {
        return false;
      }
      if (sameBudget(earlier, request)) {
        return true;
      }
    }
    return false;
  }

  private canGrant(request: PendingRequest): boolean {
    if (leaseMode(request.kind) === "path") {
      return !this.hasActivePathConflict(request);
    }
    const capacity = RESOURCE_LEASE_CAPACITY[request.kind];
    let activeCount = 0;
    for (const lease of this.active.values()) {
      if (lease.kind === request.kind && lease.key === request.key) {
        activeCount += 1;
      }
    }
    return activeCount < capacity;
  }

  private hasActivePathConflict(request: PendingRequest): boolean {
    for (const lease of this.active.values()) {
      if (sameBudget(lease, request)) {
        return true;
      }
    }
    return false;
  }

  private grant(request: PendingRequest): void {
    try { checkResourceWait(request, () => this.timeoutError(request)); }
    catch (error) { this.reject(request, error as Error, false); return; }
    if (!this.removePending(request)) {
      return;
    }
    this.active.set(request.id, { id: request.id, kind: request.kind, key: request.key });
    const queuedMs = Date.now() - request.requestedAt;
    this.refreshResourceEnvelope(request.kind, request.key, queuedMs);
    this.log.info("[resource-lease] acquired", {
      id: request.id,
      leaseKind: request.kind,
      leaseKey: request.key,
      queuedMs,
    });
    let released = false;
    request.resolve({
      leaseKind: request.kind,
      leaseKey: request.key,
      queuedMs,
      deadline: request.deadline,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.release(request.id, request.kind, request.key, queuedMs);
      },
    });
  }

  private release(id: number, kind: ResourceLeaseKind, key: string, queuedMs: number): void {
    this.active.delete(id);
    this.log.info("[resource-lease] released", { id, leaseKind: kind, leaseKey: key, queuedMs });
    this.refreshResourceEnvelope(kind, key, queuedMs);
    this.drain();
  }

  private refreshResourceEnvelope(kind: ResourceLeaseKind, key: string, queueWaitMs: number): void {
    const id = `gateway:${kind}:${key}`;
    const ledger = getResourceEnvelopeLedger();
    const activeSlots = [...this.active.values()].filter((lease) => lease.kind === kind && lease.key === key).length;
    const queuedCount = this.pending.filter((request) => request.kind === kind && request.key === key).length;
    const previous = ledger.get(id);
    if (activeSlots === 0 && queuedCount === 0) {
      ledger.remove(id);
    } else {
      ledger.update({
        id,
        workspaceKey: key,
        kind: resourceKindForLease(kind),
        priority: "foreground",
        owner: "gateway",
        activeSlots,
        queuedCount,
        queueWaitMs: Math.max(previous?.queueWaitMs ?? 0, Math.max(0, Math.floor(queueWaitMs))),
        processCount: previous?.processCount ?? 0,
        treeRssBytes: previous?.treeRssBytes ?? 0,
        treeCpuPercent: previous?.treeCpuPercent ?? 0,
        ...(previous?.pids ? { pids: previous.pids } : {}),
        reason: previous?.reason ?? "runtime workspace lease",
      });
    }
    scheduleResourceEnvelopeSnapshotWrite();
  }

  private timeoutError(request: PendingRequest): ResourceLeaseTimeoutError {
    return new ResourceLeaseTimeoutError({
      leaseKind: request.kind, leaseKey: request.key,
      queuedMs: Date.now() - request.requestedAt, timeoutMs: request.timeoutMs,
    });
  }

  private reject(request: PendingRequest, error: Error, drain = true): void {
    if (!this.removePending(request)) {
      return;
    }
    const queuedMs = Date.now() - request.requestedAt;
    this.refreshResourceEnvelope(request.kind, request.key, queuedMs);
    this.log.warn("[resource-lease] rejected", {
      id: request.id,
      leaseKind: request.kind,
      leaseKey: request.key,
      queuedMs,
      timeoutMs: request.timeoutMs,
    });
    request.reject(error);
    if (drain) this.drain();
  }

  private removePending(request: PendingRequest): boolean {
    const index = this.pending.indexOf(request);
    if (index < 0) {
      return false;
    }
    this.pending.splice(index, 1);
    request.cleanup();
    return true;
  }

  /** Test-only: drop all active and pending leases. */
  resetForTest(): void {
    for (const request of this.pending.slice()) {
      this.reject(request, new DOMException("Resource owner reset", "AbortError"), false);
    }
    this.pending.length = 0;
    this.active.clear();
    const ledger = getResourceEnvelopeLedger();
    for (const entry of ledger.list()) {
      if (entry.owner === "gateway") ledger.remove(entry.id);
    }
  }

  getDiagnostics(): { active: number; queued: number } {
    return { active: this.active.size, queued: this.pending.length };
  }
}

const resourceLeases = new ResourceLeaseManager();

export function isResourceLeaseTimeoutError(error: unknown): error is ResourceLeaseTimeoutError {
  return error instanceof ResourceLeaseTimeoutError;
}

/** Test-only: clears lease state so suites do not leak capacity across cases. */
export function resetResourceLeasesForTest(): void {
  resourceLeases.resetForTest();
}

/**
 * Acquire a workspace resource lease, run `fn`, then release it.
 *
 * `key` must already be normalized with `normalizeWorkspaceLeaseKey` so all
 * spellings of one workspace share a single budget.
 */
export async function withWorkspaceResourceLease<T>(
  kind: ResourceLeaseKind,
  key: string,
  fn: (lease: ResourceLease) => Promise<T>,
  options?: ResourceLeaseOptions,
): Promise<T> {
  const lease = await resourceLeases.acquire(kind, key, options);
  const expired = () => new ResourceLeaseTimeoutError({ leaseKind: kind, leaseKey: key,
    queuedMs: lease.queuedMs, timeoutMs: options?.timeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS });
  try {
    checkResourceWait({ signal: options?.signal, deadline: lease.deadline }, expired);
    // Preserve owner-confirmed effects (including successful write readback).
    return await fn(lease);
  } finally {
    lease.release();
  }
}
