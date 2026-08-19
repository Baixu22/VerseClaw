/**
 * P6A UFTK: compatibility facade over the single lock-core RW scheduler.
 *
 * Local scheduling (read-shared / write-exclusive / FIFO / hierarchical
 * file-directory-workspace scopes) is delegated entirely to `lock-core.ts`.
 * This file keeps the P2 public surface (`acquireCodingRuntimeFileLocks`,
 * `withCodingRuntimeFileReadLocks` / `WriteLocks`, `CodingRuntimeFileLockManager`,
 * `codingRuntimeFileLockManager`, `resetCodingRuntimeFileLocksForTest`) and adds:
 *
 * - cross-process shared-read protocol (P6A): readers register a sidecar under
 *   the OpenClaw state dir; a writer waits for reader drain while holding the
 *   reused session-write-lock sidecar. This reuses the existing write-lock
 *   authority and does not create a second lock system.
 * - workspace restore barrier: a workspace-scoped writer lock from lock-core
 *   that blocks new UFTK write prepares and waits for existing writes to drain.
 *
 * The cross-process shared-read protocol is gated by the module-level
 * `concurrencyV2` flag (`setCodingLockConcurrencyV2Enabled`). With the flag off,
 * reads behave exactly as P2 (process-local shared reads only).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { isPidAlive } from "../../shared/pid-alive.js";
import { getCachedProcessStartTime } from "../../shared/process-start-time.js";
import { normalizePatchLockPath } from "../apply-patch-batch-lock.js";
import {
  acquireSessionWriteLock,
  DEFAULT_SESSION_WRITE_LOCK_ACQUIRE_TIMEOUT_MS,
  DEFAULT_SESSION_WRITE_LOCK_MAX_HOLD_MS,
  DEFAULT_SESSION_WRITE_LOCK_STALE_MS,
} from "../session-write-lock.js";
import {
  isSessionWriteLockStaleError,
  isSessionWriteLockTimeoutError,
} from "../session-write-lock-error.js";
import { codingObservability } from "../../context-engine/coding-observability.js";
import {
  acquireLocalLocks,
  canonicalLockKey,
  directoryPrefixKey,
  lockTimeoutError,
  resetLockCoreForTest,
  sharedReaderRegistryKey,
  workspaceScopeKey,
} from "./lock-core.js";

export type CodingRuntimeFileLockMode = "read" | "write";
export type CodingRuntimeLockScope = "file" | "directory" | "workspace";

export type CodingRuntimeFileLockOptions = {
  /** Human/agent owner used in timeout diagnostics and handle metadata. */
  owner?: string;
  /** Total acquire budget for the whole multi-path acquisition. */
  timeoutMs?: number;
  /** Cross-process lock-file stale threshold (write mode only). */
  staleMs?: number;
  /** Cross-process watchdog max hold (write mode only). */
  maxHoldMs?: number;
  /** Lock scope. "file" (default) locks the given paths; "directory" locks
   *  directory prefixes; "workspace" locks the workspace root barrier. */
  scope?: CodingRuntimeLockScope;
  /** Workspace root for the "workspace" scope. */
  workspaceRoot?: string;
};

export type CodingRuntimeFileLockHandle = {
  mode: CodingRuntimeFileLockMode;
  owner: string;
  paths: readonly string[];
  release: () => Promise<void>;
};

export const DEFAULT_CODING_RUNTIME_FILE_LOCK_TIMEOUT_MS =
  DEFAULT_SESSION_WRITE_LOCK_ACQUIRE_TIMEOUT_MS;
export const DEFAULT_CODING_RUNTIME_FILE_LOCK_STALE_MS = DEFAULT_SESSION_WRITE_LOCK_STALE_MS;
export const DEFAULT_CODING_RUNTIME_FILE_LOCK_MAX_HOLD_MS = DEFAULT_SESSION_WRITE_LOCK_MAX_HOLD_MS;

/**
 * P6A concurrencyV2 module gate. Default false: cross-process shared reads and
 * restore barriers stay off, preserving the accepted P1-P5 behavior.
 */
let concurrencyV2Enabled = false;

export function setCodingLockConcurrencyV2Enabled(enabled: boolean): void {
  concurrencyV2Enabled = enabled;
}

export function isCodingLockConcurrencyV2Enabled(): boolean {
  return concurrencyV2Enabled;
}

function resolvePositiveMs(value: number | undefined, fallback: number): number {
  if (value === undefined || Number.isNaN(value) || value <= 0) return fallback;
  return value;
}

function defaultOwner(): string {
  return `pid:${process.pid}`;
}

function resolveScope(options: CodingRuntimeFileLockOptions | undefined): CodingRuntimeLockScope {
  return options?.scope ?? "file";
}

/**
 * Resolve the scheduler keys plus the original resolved paths (preserving
 * case) used for the cross-process write sidecar. The in-process scheduler is
 * keyed by the canonical (realpath + case-folded) key; the `.lock` sidecar
 * must use the original path so it interoperates with other processes that
 * resolve the same path with the original casing (P2 legacy writers).
 */
function resolveLockEntries(
  paths: string | readonly string[],
  options: CodingRuntimeFileLockOptions | undefined,
): Array<{ key: string; sidecarPath?: string }> {
  const scope = resolveScope(options);
  const input = Array.isArray(paths) ? paths : [paths];
  if (scope === "workspace") {
    const root = options?.workspaceRoot?.trim() || input[0] || "";
    return [{ key: workspaceScopeKey(root) }];
  }
  if (scope === "directory") {
    return input.map((entry) => ({ key: directoryPrefixKey(entry) }));
  }
  return input.map((entry) => ({
    key: canonicalLockKey(entry),
    sidecarPath: path.resolve(entry),
  }));
}

async function resolveNearestExistingDir(startDir: string): Promise<string> {
  let current = path.resolve(startDir);
  while (true) {
    try {
      const stat = await fs.stat(current);
      if (stat.isDirectory()) return current;
    } catch (caught) {
      if (!isFileErrorCode(caught, "ENOENT")) throw caught;
    }
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

function isFileErrorCode(value: unknown, code: string): boolean {
  return !!value && typeof value === "object" && (value as { code?: unknown }).code === code;
}

/**
 * Resolve the sidecar lock target used by the reused session-write-lock
 * protocol. Existing targets keep the conventional `<target>.lock` path.
 * Targets whose parent directory does not exist yet use a hashed lock target
 * in the nearest existing ancestor so lock acquisition cannot create target
 * parent directories (apply_patch preflight must stay read-only).
 */
export async function resolveCodingRuntimeFileLockTarget(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  const parent = path.dirname(resolved);
  try {
    const parentStat = await fs.stat(parent);
    if (parentStat.isDirectory()) return resolved;
  } catch (caught) {
    if (!isFileErrorCode(caught, "ENOENT")) throw caught;
  }
  const existingDir = await resolveNearestExistingDir(parent);
  const digest = createHash("sha256")
    .update(normalizePatchLockPath(resolved))
    .digest("hex")
    .slice(0, 24);
  return path.join(existingDir, `.uftk-${digest}.lock-target`);
}

async function acquireRemoteWriteLock(params: {
  filePath: string;
  timeoutMs: number;
  staleMs: number;
  maxHoldMs: number;
  owner: string;
  allowReentrant?: boolean;
}): Promise<Awaited<ReturnType<typeof acquireSessionWriteLock>>> {
  try {
    return await acquireSessionWriteLock({
      sessionFile: params.filePath,
      timeoutMs: params.timeoutMs,
      staleMs: params.staleMs,
      maxHoldMs: params.maxHoldMs,
      allowReentrant: params.allowReentrant,
    });
  } catch (caught) {
    if (isSessionWriteLockTimeoutError(caught) || isSessionWriteLockStaleError(caught)) {
      const reason =
        isSessionWriteLockStaleError(caught) &&
        typeof (caught as { staleReasons?: unknown }).staleReasons === "object"
          ? `stale lock (${((caught as { staleReasons?: string[] }).staleReasons ?? ["unknown"]).join(", ")})`
          : caught instanceof Error
            ? caught.message
            : String(caught);
      codingObservability.recordLockTimeout();
      throw lockTimeoutError({
        key: params.filePath,
        mode: "write",
        owner: params.owner,
        reason,
      });
    }
    throw caught;
  }
}

type ReaderMarkerPayload = {
  pid?: number;
  starttime?: number;
  createdAt?: string;
  leaseId?: string;
};

function isValidLockNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseReaderMarkerPayload(raw: string): ReaderMarkerPayload {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const payload: ReaderMarkerPayload = {};
  if (isValidLockNumber(parsed.pid) && parsed.pid > 0) payload.pid = parsed.pid;
  if (isValidLockNumber(parsed.starttime)) payload.starttime = parsed.starttime;
  if (typeof parsed.createdAt === "string") payload.createdAt = parsed.createdAt;
  if (typeof parsed.leaseId === "string") payload.leaseId = parsed.leaseId;
  return payload;
}

/**
 * Starttime resolver seam, mirroring `session-write-lock` and
 * `infra/stale-lock-file`.
 *
 * P7 (carry-over D): the default is now the cross-platform provider, so pid
 * reuse is detectable on Windows and macOS as well as Linux. Linux still reads
 * `/proc` directly; the other two platforms probe once per pid per cache
 * interval, which is affordable because `isPidAlive` short-circuits first, so a
 * probe only happens when a live process genuinely holds the lock.
 *
 * On a platform with no provider the resolver returns null and marker staleness
 * degrades to pid liveness plus the `staleMs` age bound, exactly as before. That
 * degradation costs a bounded wait, never correctness: a reused pid makes a
 * writer wait at most `staleMs` before reclaiming the marker.
 *
 * This is the P6A cross-process marker path, which only runs when
 * `concurrencyV2` is enabled. P7 deliberately does NOT re-point the accepted
 * P1-P5 lock paths (`session-write-lock`, `infra/stale-lock-file`) at the new
 * provider: those have their own seams and changing their stale verdicts outside
 * a flag is not P7's call to make.
 */
let resolveMarkerProcessStartTime: (pid: number) => number | null =
  getCachedProcessStartTime;

/** Test seam: override the starttime resolver used by marker staleness checks. */
export function setMarkerProcessStartTimeResolverForTest(
  resolver: ((pid: number) => number | null) | null,
): void {
  resolveMarkerProcessStartTime = resolver ?? getCachedProcessStartTime;
}

function readerMarkerIsLive(payload: ReaderMarkerPayload, staleMs: number, nowMs: number): boolean {
  const pid = isValidLockNumber(payload.pid) && payload.pid > 0 ? payload.pid : null;
  if (pid === null) return true; // marker without pid: treat as live, writer waits
  if (!isPidAlive(pid)) return false;
  const storedStarttime = isValidLockNumber(payload.starttime) ? payload.starttime : null;
  if (storedStarttime !== null) {
    const currentStarttime = resolveMarkerProcessStartTime(pid);
    if (currentStarttime !== null && currentStarttime !== storedStarttime) return false;
  }
  const createdAt = typeof payload.createdAt === "string" ? payload.createdAt : null;
  const createdAtMs = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (!Number.isNaN(createdAtMs)) {
    if (nowMs - createdAtMs > staleMs) return false;
  }
  return true;
}

function sharedReadRegistryDir(lockKey: string): string {
  const stateDir = resolveStateDir(process.env);
  return path.join(stateDir, "locks", sharedReaderRegistryKey(lockKey));
}

async function writerSidecarIsLive(
  filePath: string,
  staleMs: number,
  nowMs: number,
): Promise<boolean> {
  const writerSidecar = `${filePath}.lock`;
  let raw: string;
  try {
    raw = await fs.readFile(writerSidecar, "utf8");
  } catch {
    return false;
  }
  let payload: ReaderMarkerPayload;
  try {
    payload = parseReaderMarkerPayload(raw);
  } catch {
    // Unparseable sidecar: assume a writer is present to fail closed.
    return true;
  }
  const pid = isValidLockNumber(payload.pid) && payload.pid > 0 ? payload.pid : null;
  if (pid === null) return true;
  if (!isPidAlive(pid)) return false;
  const storedStarttime = isValidLockNumber(payload.starttime) ? payload.starttime : null;
  if (storedStarttime !== null) {
    // Same resolver as the reader-marker check, so both sides of the protocol
    // agree on the provider (and on the test seam).
    const currentStarttime = resolveMarkerProcessStartTime(pid);
    if (currentStarttime !== null && currentStarttime !== storedStarttime) return false;
  }
  const createdAt = typeof payload.createdAt === "string" ? payload.createdAt : null;
  const createdAtMs = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (!Number.isNaN(createdAtMs) && nowMs - createdAtMs > staleMs) return false;
  return true;
}

/**
 * Register a cross-process shared-read marker for one canonical file key.
 * Before and after registration we check the reused write sidecar so the
 * classic reader/writer race is closed: a writer holds the sidecar for its
 * whole critical section, so a reader that sees a live sidecar either before
 * or after registering must back off and retry.
 */
async function acquireSharedReadMarker(params: {
  filePath: string;
  lockKey: string;
  staleMs: number;
  timeoutMs: number;
}): Promise<{ release: () => Promise<void> }> {
  const dir = sharedReadRegistryDir(params.lockKey);
  // Written through the same resolver readers compare against, so the value in
  // the marker is always in this platform's own units.
  const starttime = resolveMarkerProcessStartTime(process.pid);
  const leaseId = randomUUID();
  const markerPath = path.join(
    dir,
    `${process.pid}-${starttime ?? "ns"}-${leaseId}.lock`,
  );
  const startedAt = Date.now();

  const waitForWriterSidecarGone = async (): Promise<boolean> => {
    while (Date.now() - startedAt < params.timeoutMs) {
      if (!(await writerSidecarIsLive(params.filePath, params.staleMs, Date.now()))) {
        return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    return false;
  };

  while (true) {
    if (!(await waitForWriterSidecarGone())) {
      codingObservability.recordLockTimeout();
      throw lockTimeoutError({
        key: params.lockKey,
        mode: "read",
        owner: defaultOwner(),
        reason: `writer sidecar held while registering shared read (timeout ${params.timeoutMs}ms)`,
      });
    }
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      markerPath,
      `${JSON.stringify({
        pid: process.pid,
        starttime: starttime ?? undefined,
        createdAt: new Date().toISOString(),
        leaseId,
      })}\n`,
      "utf8",
    );
    if (!(await writerSidecarIsLive(params.filePath, params.staleMs, Date.now()))) {
      break;
    }
    await fs.rm(markerPath, { force: true }).catch(() => {});
  }

  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await fs.rm(markerPath, { force: true }).catch(() => {});
    },
  };
}

/** Wait for cross-process shared-read markers to drain while holding the write sidecar. */
async function waitForReaderDrain(params: {
  lockKey: string;
  timeoutMs: number;
  staleMs: number;
}): Promise<void> {
  const dir = sharedReadRegistryDir(params.lockKey);
  const startedAt = Date.now();
  while (true) {
    const remaining = params.timeoutMs === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : params.timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      codingObservability.recordLockTimeout();
      throw lockTimeoutError({
        key: params.lockKey,
        mode: "write",
        owner: defaultOwner(),
        reason: `waiting for cross-process shared readers to drain (timeout ${params.timeoutMs}ms)`,
      });
    }
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return; // no registry dir → no readers
    }
    let liveCount = 0;
    for (const name of entries) {
      if (!name.endsWith(".lock")) continue;
      const markerPath = path.join(dir, name);
      let raw: string;
      try {
        raw = await fs.readFile(markerPath, "utf8");
      } catch {
        continue;
      }
      let payload: ReaderMarkerPayload;
      try {
        payload = parseReaderMarkerPayload(raw);
      } catch {
        payload = {};
      }
      if (readerMarkerIsLive(payload, params.staleMs, Date.now())) {
        liveCount += 1;
      } else {
        await fs.rm(markerPath, { force: true }).catch(() => {});
        codingObservability.recordStaleLockReclaimed();
      }
    }
    if (liveCount === 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

function resolveRemainingMs(deadline: number, nowMs: number): number {
  if (deadline === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return Math.max(0, deadline - nowMs);
}

/**
 * Acquire read-shared / write-exclusive locks for one or more paths (or a
 * directory / workspace scope). Local scheduling goes through lock-core; the
 * write sidecar reuses session-write-lock; cross-process shared reads register
 * a state-dir marker when concurrencyV2 is enabled.
 */
export async function acquireCodingRuntimeFileLocks(
  paths: string | readonly string[],
  options: CodingRuntimeFileLockOptions & { mode?: CodingRuntimeFileLockMode } = {},
): Promise<CodingRuntimeFileLockHandle> {
  const mode = options.mode ?? "write";
  const owner = options.owner?.trim() || defaultOwner();
  const timeoutMs = resolvePositiveMs(
    options.timeoutMs,
    DEFAULT_CODING_RUNTIME_FILE_LOCK_TIMEOUT_MS,
  );
  const staleMs = resolvePositiveMs(
    options.staleMs,
    DEFAULT_CODING_RUNTIME_FILE_LOCK_STALE_MS,
  );
  const maxHoldMs = resolvePositiveMs(
    options.maxHoldMs,
    DEFAULT_CODING_RUNTIME_FILE_LOCK_MAX_HOLD_MS,
  );
  const rawEntries = resolveLockEntries(paths, options);
  const dedupMap = new Map<string, { key: string; sidecarPath?: string }>();
  for (const entry of rawEntries) {
    if (!dedupMap.has(entry.key)) {
      dedupMap.set(entry.key, entry);
    }
  }
  const entries = [...dedupMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  const keys = entries.map((entry) => entry.key);
  const scope = resolveScope(options);
  const deadline =
    timeoutMs === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Date.now() + timeoutMs;

  const local = await acquireLocalLocks(keys, mode, {
    owner,
    timeoutMs: resolveRemainingMs(deadline, Date.now()),
  });

  const heldRemote: Array<Awaited<ReturnType<typeof acquireSessionWriteLock>>> = [];
  const heldReaders: Array<{ release: () => Promise<void> }> = [];
  try {
    for (const entry of entries) {
      const remaining = resolveRemainingMs(deadline, Date.now());
      if (remaining <= 0) {
        throw lockTimeoutError({
          key: entry.key,
          mode,
          owner,
          reason: `acquire budget ${timeoutMs}ms exhausted before ${entry.key}`,
        });
      }
      if (mode === "write") {
        // Use the original resolved path for the sidecar (preserving case for
        // cross-process interop), not the lowercased canonical key.
        const sidecarTarget = entry.sidecarPath ?? entry.key;
        const filePath = await resolveCodingRuntimeFileLockTarget(sidecarTarget);
        const remote = await acquireRemoteWriteLock({
          filePath,
          timeoutMs: remaining,
          staleMs,
          maxHoldMs,
          owner,
          // Allow reentrant: multi-path acquisitions create sidecars for each
          // path; a subsequent path would otherwise deadlock on the first path's
          // sidecar since both belong to the same process.
          allowReentrant: true,
        });
        heldRemote.push(remote);
        if (concurrencyV2Enabled && scope === "file") {
          await waitForReaderDrain({
            lockKey: entry.key,
            timeoutMs: resolveRemainingMs(deadline, Date.now()),
            staleMs,
          });
        }
      } else if (concurrencyV2Enabled && scope === "file") {
        const sidecarTarget = entry.sidecarPath ?? entry.key;
        const marker = await acquireSharedReadMarker({
          filePath: sidecarTarget,
          lockKey: entry.key,
          staleMs,
          timeoutMs: resolveRemainingMs(deadline, Date.now()),
        });
        heldReaders.push(marker);
      }
    }
  } catch (caught) {
    for (const reader of heldReaders.toReversed()) {
      await reader.release().catch(() => {});
    }
    for (const remote of heldRemote.toReversed()) {
      await remote.release().catch(() => {});
    }
    await local.release();
    throw caught;
  }

  let released = false;
  return {
    mode,
    owner,
    paths: [...keys],
    release: async () => {
      if (released) return;
      released = true;
      for (const reader of heldReaders.toReversed()) {
        await reader.release().catch(() => {});
      }
      for (const remote of heldRemote.toReversed()) {
        await remote.release().catch(() => {});
      }
      await local.release();
    },
  };
}

export async function withCodingRuntimeFileLocks<T>(
  paths: string | readonly string[],
  options: CodingRuntimeFileLockOptions & { mode?: CodingRuntimeFileLockMode },
  fn: () => Promise<T>,
): Promise<T> {
  const handle = await acquireCodingRuntimeFileLocks(paths, options);
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}

export async function withCodingRuntimeFileReadLocks<T>(
  paths: string | readonly string[],
  fn: () => Promise<T>,
  options: CodingRuntimeFileLockOptions = {},
): Promise<T> {
  return withCodingRuntimeFileLocks(paths, { ...options, mode: "read" }, fn);
}

export async function withCodingRuntimeFileWriteLocks<T>(
  paths: string | readonly string[],
  fn: () => Promise<T>,
  options: CodingRuntimeFileLockOptions = {},
): Promise<T> {
  return withCodingRuntimeFileLocks(paths, { ...options, mode: "write" }, fn);
}

/**
 * Workspace restore barrier: a workspace-scoped writer lock from lock-core.
 * While held it blocks new UFTK write/read prepares inside the workspace and
 * waits for existing writes to drain (local hierarchical exclusion).
 */
export async function acquireWorkspaceRestoreBarrier(
  root: string,
  options: CodingRuntimeFileLockOptions = {},
): Promise<CodingRuntimeFileLockHandle> {
  const owner = options.owner?.trim() || defaultOwner();
  const timeoutMs = resolvePositiveMs(
    options.timeoutMs,
    DEFAULT_CODING_RUNTIME_FILE_LOCK_TIMEOUT_MS,
  );
  const handle = await acquireLocalLocks([workspaceScopeKey(root)], "write", {
    owner,
    timeoutMs,
  });
  return {
    mode: "write",
    owner,
    paths: [...handle.keys],
    release: handle.release,
  };
}

/**
 * OO facade matching the Phase 2 `acquireRead(path)` / `acquireWrite(path)`
 * shape while sharing the same lock-core scheduler and cross-process
 * session-write-lock manager.
 */
export class CodingRuntimeFileLockManager {
  acquireRead(
    paths: string | readonly string[],
    options: CodingRuntimeFileLockOptions = {},
  ): Promise<CodingRuntimeFileLockHandle> {
    return acquireCodingRuntimeFileLocks(paths, { ...options, mode: "read" });
  }

  acquireWrite(
    paths: string | readonly string[],
    options: CodingRuntimeFileLockOptions = {},
  ): Promise<CodingRuntimeFileLockHandle> {
    return acquireCodingRuntimeFileLocks(paths, { ...options, mode: "write" });
  }

  withReadLock<T>(
    paths: string | readonly string[],
    fn: () => Promise<T>,
    options: CodingRuntimeFileLockOptions = {},
  ): Promise<T> {
    return withCodingRuntimeFileReadLocks(paths, fn, options);
  }

  withWriteLock<T>(
    paths: string | readonly string[],
    fn: () => Promise<T>,
    options: CodingRuntimeFileLockOptions = {},
  ): Promise<T> {
    return withCodingRuntimeFileWriteLocks(paths, fn, options);
  }
}

/** Process-shared default instance for tool/service integration. */
export const codingRuntimeFileLockManager = new CodingRuntimeFileLockManager();

/** Test seam: reject queued local waiters and clear the in-process scheduler. */
export function resetCodingRuntimeFileLocksForTest(): void {
  // Delegate to lock-core's reset; the module concurrencyV2 flag stays as
  // configured by the calling test.
  resetLockCoreForTest();
}
