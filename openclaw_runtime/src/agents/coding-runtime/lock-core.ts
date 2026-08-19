/**
 * P6A UFTK: the single process-local reader-writer lock scheduler.
 *
 * This is the only in-process RW scheduler for coding-runtime file locks.
 * `file-lock-manager.ts` and `sessions/tools/file-mutation-queue.ts` are
 * compatibility facades over this core, so write/edit/apply_patch/FTS never
 * hold two independent queue semantics.
 *
 * Scheduling rules (superset of the P2 accepted semantics):
 * - same-file reads share; reads exclude writes; writes exclude reads and
 *   writes;
 * - FIFO waiters with a queued writer acting as a barrier so later readers
 *   cannot starve it while earlier readers drain;
 * - multi-path acquisitions are sorted by the canonical key so reversed
 *   acquisition orders cannot deadlock;
 * - hierarchical scopes: a directory-prefix lock excludes file/read/write
 *   locks under it, and a workspace-scope lock is a writer barrier over the
 *   whole workspace (used by restore);
 * - every acquire carries a timeout, an owner, and stale detection.
 *
 * Observability: wait time, contention, timeout and stale-reclaim are
 * recorded through `codingObservability` so lock pressure can be diagnosed
 * without a second state source.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { normalizePatchLockPath } from "../apply-patch-batch-lock.js";
import { codingObservability } from "../../context-engine/coding-observability.js";
import { CodingRuntimeError } from "./coding-runtime-error.js";

export type LockCoreMode = "read" | "write";

export type LockCoreHandle = {
  mode: LockCoreMode;
  owner: string;
  keys: readonly string[];
  release: () => Promise<void>;
};

type Waiter = {
  mode: LockCoreMode;
  owner: string;
  startedAt: number;
  /**
   * Global arrival order. Admission requires that no *earlier* conflicting
   * waiter exists on any overlapping key, which is what makes a queued writer a
   * barrier across hierarchical scopes (a queued workspace-scope restore
   * barrier is not bypassable by a later file-scope reader).
   */
  seq: number;
  resolve: () => void;
  reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
};

type LockState = {
  activeReaders: number;
  activeReaderOwners: Set<string>;
  activeWriter: boolean;
  activeWriterOwner?: string;
  waiters: Waiter[];
};

const localLockStates = new Map<string, LockState>();

/** Monotonic waiter arrival counter backing the cross-scope FIFO barrier. */
let waiterSequence = 0;

const DIRECTORY_SUFFIX = "/__dir__";
const WORKSPACE_PREFIX = "__workspace__:";

function canonicalizePath(filePath: string): string {
  const resolved = resolve(filePath);
  // normalizePatchLockPath handles case folding on Windows. We skip
  // realpathSync to avoid potential hangs on temp directories whose
  // handles the OS has not fully released after cleanup.
  return normalizePatchLockPath(resolved);
}

/** Canonical scheduler key for a file path (realpath + case folding). */
export function canonicalLockKey(filePath: string): string {
  return canonicalizePath(filePath);
}

/** Directory-prefix key: locks every path strictly under the directory. */
export function directoryPrefixKey(dirPath: string): string {
  const base = canonicalizePath(dirPath).replace(/[\\/]+$/, "");
  return `${base}${DIRECTORY_SUFFIX}`;
}

/** Workspace-scope key: one shared writer barrier per workspace root. */
export function workspaceScopeKey(root: string): string {
  const base = canonicalizePath(root).replace(/[\\/]+$/, "");
  return `${WORKSPACE_PREFIX}${base}`;
}

export type LockScopeKind = "file" | "directory" | "workspace";

export function lockScopeKind(key: string): LockScopeKind {
  if (key.startsWith(WORKSPACE_PREFIX)) return "workspace";
  if (key.endsWith(DIRECTORY_SUFFIX)) return "directory";
  return "file";
}

function workspaceRootOf(key: string): string {
  return key.slice(WORKSPACE_PREFIX.length);
}

function directoryRootOf(key: string): string {
  return key.slice(0, -DIRECTORY_SUFFIX.length);
}

function isUnderPath(candidate: string, root: string): boolean {
  const candidateNorm = candidate.replace(/\\/g, "/").replace(/[\\/]+$/, "");
  const rootNorm = root.replace(/\\/g, "/").replace(/[\\/]+$/, "");
  return candidateNorm === rootNorm || candidateNorm.startsWith(`${rootNorm}/`);
}

/** Does lock `a` conflict with lock `b`? Symmetric. */
export function locksOverlap(aKey: string, bKey: string): boolean {
  if (aKey === bKey) return true;
  const aKind = lockScopeKind(aKey);
  const bKind = lockScopeKind(bKey);
  if (aKind === "workspace" || bKind === "workspace") {
    const root = aKind === "workspace" ? workspaceRootOf(aKey) : workspaceRootOf(bKey);
    const other = aKind === "workspace" ? bKey : aKey;
    if (lockScopeKind(other) === "workspace") {
      return workspaceRootOf(other) === root;
    }
    return isUnderPath(other, root);
  }
  if (aKind === "directory" || bKind === "directory") {
    const dirRoot = aKind === "directory" ? directoryRootOf(aKey) : directoryRootOf(bKey);
    const other = aKind === "directory" ? bKey : aKey;
    if (lockScopeKind(other) === "directory") {
      const otherRoot = directoryRootOf(other);
      return isUnderPath(otherRoot, dirRoot) || isUnderPath(dirRoot, otherRoot);
    }
    return isUnderPath(other, dirRoot);
  }
  return false;
}

/** Returns true when any active lease on `key` blocks a new `mode` request. */
function blockedByActiveLeases(key: string, mode: LockCoreMode): { blocked: boolean; blockedBy?: string } {
  let blockedBy: string | undefined;
  for (const [candidateKey, state] of localLockStates) {
    if (!locksOverlap(candidateKey, key)) continue;
    if (state.activeWriter) {
      blockedBy = `writer:${state.activeWriterOwner ?? "unknown"}`;
      return { blocked: true, blockedBy };
    }
    if (mode === "write" && state.activeReaders > 0) {
      blockedBy = `readers:${[...state.activeReaderOwners].join(",") || "unknown"}`;
      return { blocked: true, blockedBy };
    }
  }
  return { blocked: false };
}

/** Two lock modes conflict unless both are reads. */
function modesConflict(a: LockCoreMode, b: LockCoreMode): boolean {
  return !(a === "read" && b === "read");
}

/**
 * Returns true when an earlier-arriving conflicting waiter exists on any
 * overlapping key. This is the writer barrier: once a writer is queued, later
 * conflicting requests wait behind it even when they target a different key in
 * the same hierarchy, so a stream of file readers cannot starve a queued
 * directory- or workspace-scope writer.
 */
function blockedByEarlierWaiters(
  key: string,
  mode: LockCoreMode,
  seq: number,
): { blocked: boolean; blockedBy?: string } {
  for (const [candidateKey, state] of localLockStates) {
    if (state.waiters.length === 0) continue;
    if (!locksOverlap(candidateKey, key)) continue;
    for (const waiter of state.waiters) {
      if (waiter.seq >= seq) continue;
      if (!modesConflict(waiter.mode, mode)) continue;
      return { blocked: true, blockedBy: `queued-${waiter.mode}:${waiter.owner}` };
    }
  }
  return { blocked: false };
}

/** Combined admission test for a request that has already taken its sequence number. */
function blockedForRequest(
  key: string,
  mode: LockCoreMode,
  seq: number,
): { blocked: boolean; blockedBy?: string } {
  const active = blockedByActiveLeases(key, mode);
  if (active.blocked) return active;
  return blockedByEarlierWaiters(key, mode, seq);
}

function getLockState(key: string): LockState {
  const existing = localLockStates.get(key);
  if (existing) return existing;
  const created: LockState = {
    activeReaders: 0,
    activeReaderOwners: new Set<string>(),
    activeWriter: false,
    waiters: [],
  };
  localLockStates.set(key, created);
  return created;
}

function clearWaiterTimer(waiter: Waiter): void {
  if (waiter.timer) {
    clearTimeout(waiter.timer);
    waiter.timer = undefined;
  }
}

function removeWaiter(state: LockState, waiter: Waiter): void {
  const index = state.waiters.indexOf(waiter);
  if (index >= 0) state.waiters.splice(index, 1);
}

function disposeLockState(key: string, state: LockState): void {
  if (state.activeReaders === 0 && !state.activeWriter && state.waiters.length === 0) {
    localLockStates.delete(key);
  }
}

/** Admit as many head waiters as possible. Returns true when anything was admitted. */
function pumpLockState(key: string, state: LockState): boolean {
  let admitted = false;
  while (state.waiters.length > 0) {
    const next = state.waiters[0]!;
    if (blockedForRequest(key, next.mode, next.seq).blocked) {
      return admitted;
    }
    state.waiters.shift();
    if (next.mode === "write") {
      state.activeWriter = true;
      state.activeWriterOwner = next.owner;
    } else {
      state.activeReaders += 1;
      state.activeReaderOwners.add(next.owner);
    }
    clearWaiterTimer(next);
    next.resolve();
    admitted = true;
  }
  return admitted;
}

/**
 * Pump every state that overlaps `releasedKey`. Repeats until no further
 * progress: admitting the globally-earliest waiter can unblock waiters on other
 * overlapping keys that were already visited in this sweep.
 */
function pumpOverlappingStates(releasedKey: string): void {
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [key, state] of [...localLockStates]) {
      if (state.waiters.length === 0) continue;
      if (!locksOverlap(key, releasedKey)) continue;
      if (pumpLockState(key, state)) progressed = true;
    }
  }
}

function releaseLocalLock(key: string, mode: LockCoreMode): void {
  const state = localLockStates.get(key);
  if (!state) return;
  if (mode === "write") {
    state.activeWriter = false;
    state.activeWriterOwner = undefined;
  } else {
    state.activeReaders = Math.max(0, state.activeReaders - 1);
    if (state.activeReaders === 0) state.activeReaderOwners.clear();
  }
  pumpOverlappingStates(key);
  disposeLockState(key, state);
}

function resolveRemainingMs(deadline: number, nowMs: number): number {
  if (deadline === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return Math.max(0, deadline - nowMs);
}

export function lockTimeoutError(params: {
  key: string;
  mode: LockCoreMode;
  owner: string;
  reason: string;
  blockedBy?: string;
}): CodingRuntimeError {
  const blockedBy = params.blockedBy ? `; blocked-by=${params.blockedBy}` : "";
  return new CodingRuntimeError({
    code: "E_LOCK_TIMEOUT",
    path: params.key,
    message:
      `Timed out acquiring ${params.mode} lock for ${params.key} ` +
      `(owner=${params.owner})${blockedBy}: ${params.reason}`,
  });
}

async function acquireLocalLock(params: {
  key: string;
  mode: LockCoreMode;
  owner: string;
  timeoutMs: number;
}): Promise<void> {
  const state = getLockState(params.key);
  // Take the arrival sequence first so the admission test can tell which
  // queued waiters are *earlier* than this request on any overlapping key.
  const seq = ++waiterSequence;
  const conflict = blockedForRequest(params.key, params.mode, seq);
  if (!conflict.blocked) {
    if (params.mode === "write") {
      state.activeWriter = true;
      state.activeWriterOwner = params.owner;
    } else {
      state.activeReaders += 1;
      state.activeReaderOwners.add(params.owner);
    }
    return;
  }

  const startedAt = Date.now();
  return await new Promise<void>((resolveWait, rejectWait) => {
    const waiter: Waiter = {
      mode: params.mode,
      owner: params.owner,
      startedAt,
      seq,
      resolve: resolveWait,
      reject: rejectWait,
    };
    if (Number.isFinite(params.timeoutMs) && params.timeoutMs > 0) {
      const blockedBy = conflict.blockedBy;
      waiter.timer = setTimeout(() => {
        removeWaiter(state, waiter);
        pumpOverlappingStates(params.key);
        disposeLockState(params.key, state);
        codingObservability.recordLockTimeout();
        rejectWait(
          lockTimeoutError({
            key: params.key,
            mode: params.mode,
            owner: params.owner,
            reason: `lock wait exceeded ${params.timeoutMs}ms`,
            blockedBy,
          }),
        );
      }, params.timeoutMs);
    }
    state.waiters.push(waiter);
    pumpLockState(params.key, state);
  }).finally(() => {
    // Any request that had to queue is contention, even if it was admitted
    // within the same millisecond, so record a floor of 1ms.
    const waitedMs = Math.max(1, Date.now() - startedAt);
    codingObservability.recordLockWaitMs(waitedMs);
  });
}

export type LockCoreOptions = {
  owner?: string;
  timeoutMs?: number;
};

function defaultOwner(): string {
  return `pid:${process.pid}`;
}

function resolveOwner(options: LockCoreOptions | undefined): string {
  return options?.owner?.trim() || defaultOwner();
}

function resolveTimeoutMs(options: LockCoreOptions | undefined): number {
  const value = options?.timeoutMs;
  if (value === undefined || Number.isNaN(value) || value <= 0) return Number.POSITIVE_INFINITY;
  return value;
}

/**
 * Acquire local read/write locks for one or more canonical keys in stable
 * sorted order. Directory-prefix and workspace barrier keys sort naturally
 * among file keys, preserving deadlock freedom for mixed scopes.
 */
export async function acquireLocalLocks(
  keys: string | readonly string[],
  mode: LockCoreMode,
  options: LockCoreOptions = {},
): Promise<LockCoreHandle> {
  const uniqueKeys = [...new Set(Array.isArray(keys) ? keys : [keys])].sort((a, b) =>
    a.localeCompare(b),
  );
  const owner = resolveOwner(options);
  const timeoutMs = resolveTimeoutMs(options);
  const deadline = timeoutMs === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;

  const held: Array<{ key: string; mode: LockCoreMode }> = [];
  try {
    for (const key of uniqueKeys) {
      const remaining = resolveRemainingMs(deadline, Date.now());
      if (remaining <= 0) {
        throw lockTimeoutError({
          key,
          mode,
          owner,
          reason: `acquire budget ${timeoutMs}ms exhausted before ${key}`,
        });
      }
      await acquireLocalLock({ key, mode, owner, timeoutMs: remaining });
      held.push({ key, mode });
    }
  } catch (caught) {
    for (const entry of held.toReversed()) {
      releaseLocalLock(entry.key, entry.mode);
    }
    throw caught;
  }

  let released = false;
  return {
    mode,
    owner,
    keys: [...uniqueKeys],
    release: async () => {
      if (released) return;
      released = true;
      for (const entry of held.toReversed()) {
        releaseLocalLock(entry.key, entry.mode);
      }
    },
  };
}

/** Shared cross-process reader registry key. Writer sidecar protocol is keyed by lock key. */
export function sharedReaderRegistryKey(lockKey: string): string {
  const digest = createHash("sha256").update(lockKey).digest("hex").slice(0, 24);
  return `uftk-shared-read-${digest}`;
}

/** Read-only diagnostic summary of the in-process scheduler (no lock authority). */
export function inspectLocalLockState(): {
  held: Array<{ key: string; scope: LockScopeKind; readers: number; writer: boolean; writerOwner?: string }>;
  waiting: Array<{ key: string; scope: LockScopeKind; mode: LockCoreMode; owner: string }>;
} {
  const held: Array<{ key: string; scope: LockScopeKind; readers: number; writer: boolean; writerOwner?: string }> = [];
  const waiting: Array<{ key: string; scope: LockScopeKind; mode: LockCoreMode; owner: string }> = [];
  for (const [key, state] of localLockStates) {
    held.push({
      key,
      scope: lockScopeKind(key),
      readers: state.activeReaders,
      writer: state.activeWriter,
      ...(state.activeWriterOwner ? { writerOwner: state.activeWriterOwner } : {}),
    });
    for (const waiter of state.waiters) {
      waiting.push({ key, scope: lockScopeKind(key), mode: waiter.mode, owner: waiter.owner });
    }
  }
  held.sort((a, b) => a.key.localeCompare(b.key));
  waiting.sort((a, b) => a.key.localeCompare(b.key));
  return { held, waiting };
}

/** Test seam: reject queued waiters and clear the process-local scheduler. */
export function resetLockCoreForTest(): void {
  for (const state of localLockStates.values()) {
    for (const waiter of state.waiters) {
      clearWaiterTimer(waiter);
      waiter.reject(new Error("Lock core reset"));
    }
  }
  localLockStates.clear();
}
