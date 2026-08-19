// Determines whether persisted lock-file owners are stale.
import { isPidDefinitelyDead as defaultIsPidDefinitelyDead } from "../shared/pid-alive.js";
import { getCachedProcessStartTime as defaultGetProcessStartTime } from "../shared/process-start-time.js";

export type LockFileOwnerPayload = {
  pid?: number;
  createdAt?: string;
  /**
   * Opaque platform-local process-identity token. Compared for equality only,
   * against a value read on the same machine and platform — never subtracted and
   * never treated as a portable timestamp.
   */
  starttime?: number;
};

export function readLockFileOwnerPayload(
  payload: Record<string, unknown> | null,
): LockFileOwnerPayload | null {
  if (!payload) {
    return null;
  }
  return {
    pid: typeof payload.pid === "number" ? payload.pid : undefined,
    createdAt: typeof payload.createdAt === "string" ? payload.createdAt : undefined,
    starttime: typeof payload.starttime === "number" ? payload.starttime : undefined,
  };
}

export function shouldRemoveDeadOwnerOrExpiredLock(params: {
  payload: Record<string, unknown> | null;
  staleMs: number;
  nowMs?: number;
  isPidDefinitelyDead?: (pid: number) => boolean;
  getProcessStartTime?: (pid: number) => number | null;
}): boolean {
  const payload = readLockFileOwnerPayload(params.payload);
  if (payload?.pid) {
    // Liveness first, and not only for ordering taste: the start-time provider's
    // contract is that callers short-circuit on a dead pid, because off Linux a
    // probe is a subprocess. Probing before this check would put a PowerShell
    // spawn on every dead-owner lock cleanup for a value that cannot change the
    // outcome -- a dead owner is stale either way.
    if ((params.isPidDefinitelyDead ?? defaultIsPidDefinitelyDead)(payload.pid)) {
      return true;
    }
    // Timestamp age alone cannot prove the owner stopped writing. Only a
    // mismatched process start time proves PID reuse while the PID is alive.
    //
    // The default provider is the cross-platform cached one, not the Linux-only
    // `/proc` reader: with the latter this branch silently no-op'd on Windows and
    // macOS, so a recycled PID held the lock until its age bound expired. On Linux
    // the provider delegates to that same reader, so stored values keep their
    // meaning; on Windows/macOS the old reader always returned null, so no lock
    // file there ever recorded a `starttime` that could now be misread.
    if (payload.starttime !== undefined) {
      const currentStarttime = (params.getProcessStartTime ?? defaultGetProcessStartTime)(
        payload.pid,
      );
      if (currentStarttime !== null && currentStarttime !== payload.starttime) {
        return true;
      }
    }
    return false;
  }
  if (payload?.createdAt) {
    const createdAt = Date.parse(payload.createdAt);
    if (!Number.isFinite(createdAt) || (params.nowMs ?? Date.now()) - createdAt > params.staleMs) {
      return true;
    }
  }
  return false;
}
