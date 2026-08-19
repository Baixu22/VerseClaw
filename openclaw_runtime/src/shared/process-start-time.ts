/**
 * Cross-platform process start-time provider (P7 carry-over D).
 *
 * `getProcessStartTime` reads `/proc/<pid>/stat` and is Linux-only by design, so
 * on Windows and macOS the pid-reuse check in the lock protocols could not fire
 * and marker staleness degraded to pid liveness plus an age bound. This module
 * closes that gap.
 *
 * Two things make it safe to do at all:
 *
 * 1. **It is only reached under real contention.** Every caller checks
 *    `isPidAlive` first, and a dead pid short-circuits before this is consulted.
 *    So the cost is paid when a live process actually holds a lock, not on every
 *    poll of every marker.
 * 2. **Results are cached per pid.** Windows and macOS have no way to read a
 *    process creation time from Node without a subprocess, and marker validation
 *    sits on a 25ms polling loop -- 40 spawns per second per marker would be
 *    unusable. A process's start time never changes while it lives, so a short
 *    TTL cache collapses a polling burst to at most one probe per pid per
 *    interval.
 *
 * The returned number is an **opaque platform-specific identity token**, not a
 * portable timestamp: clock ticks since boot on Linux, a Windows FILETIME on
 * win32, epoch milliseconds on macOS. It is only ever compared against a value
 * this same provider produced on the same host, which is exactly what pid-reuse
 * detection needs. Never persist it as a wall-clock time or compare it across
 * platforms.
 *
 * Every failure path returns `null`, which restores the pre-existing degraded
 * behavior (pid liveness plus the caller's `staleMs` age bound). A probe that
 * cannot answer must never throw into a lock acquisition.
 */
import { execFileSync } from "node:child_process";
import { getProcessStartTime } from "./pid-alive.js";

/**
 * How long a probe result is trusted. A process's start time is immutable, so
 * the only risk this bounds is pid *reuse* inside the window: the pid would have
 * to die and be reassigned within one interval while we are actively polling it.
 * Even then the caller's age bound still reclaims the marker, so the cost is a
 * bounded wait rather than a wrong answer.
 */
const START_TIME_CACHE_TTL_MS = 1_000;

/** Bound on cached pids, so a long-lived process cannot grow this without limit. */
const START_TIME_CACHE_MAX_ENTRIES = 512;

/** Probes are on a lock path: fail fast rather than stall an acquisition. */
const PROBE_TIMEOUT_MS = 2_000;

type CacheEntry = { value: number | null; verifiedAtMs: number };

const cache = new Map<number, CacheEntry>();

let probeCount = 0;
/**
 * Test seam for the cache itself (TTL, eviction, negative caching). The real
 * platform probes are a subprocess on Windows and macOS, so exercising cache
 * behavior through them would mean hundreds of spawns; this keeps those tests
 * deterministic and fast while the platform probes stay covered by their own
 * real-OS tests.
 */
let probeOverride: ((pid: number) => number | null) | null = null;

function isValidPid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0;
}

function runProbe(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      // A user profile or locale could otherwise change the output shape.
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
  } catch {
    return null;
  }
}

/**
 * Windows: `Get-Process(...).StartTime` as a FILETIME, which is already a stable
 * 64-bit integer and needs no locale-dependent date parsing. `-NoProfile` keeps
 * a user's profile script out of the probe.
 */
function probeWindows(pid: number): number | null {
  const raw = runProbe("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.StartTime.ToFileTimeUtc() }`,
  ]);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // FILETIME exceeds 2^53, so parse the integer text directly and clamp rather
  // than losing precision silently. 100ns resolution means the low digits carry
  // no identity value anyway; milliseconds are far finer than process spacing.
  const digits = /^(\d+)$/.exec(trimmed);
  if (!digits) return null;
  const fileTime = digits[1]!;
  // Drop the last 4 digits (sub-millisecond ticks) to land inside a safe integer.
  const millisecondTicks = fileTime.length > 4 ? fileTime.slice(0, -4) : fileTime;
  const parsed = Number.parseInt(millisecondTicks, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * macOS / BSD: `ps -o lstart=` prints an absolute start time. Forced to the C
 * locale above so the format is the parseable `Mon Aug 18 19:05:12 2026`.
 */
function probeDarwin(pid: number): number | null {
  const raw = runProbe("ps", ["-p", String(pid), "-o", "lstart="]);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function probe(pid: number): number | null {
  if (probeOverride) {
    probeCount += 1;
    return probeOverride(pid);
  }
  switch (process.platform) {
    case "linux":
      // Free: a proc read, no subprocess.
      return getProcessStartTime(pid);
    case "win32":
      probeCount += 1;
      return probeWindows(pid);
    case "darwin":
      probeCount += 1;
      return probeDarwin(pid);
    default:
      return null;
  }
}

/**
 * Our own start time is immutable for the lifetime of this process, so it is
 * memoized without a TTL.
 *
 * This is not a micro-optimization. The session write-lock writes its owner
 * payload -- including `getCachedProcessStartTime(process.pid)` -- on *every*
 * acquisition. Under the shared TTL that would re-probe once per second on the
 * session-write hot path, and a cold Windows PowerShell probe measures in the
 * hundreds of milliseconds. Re-verifying a value that cannot change would buy
 * nothing and stall writes.
 *
 * Only self is safe to memoize this way: any other pid can be reused by a
 * different process, which is the whole reason this token exists.
 */
let selfStartTime: { value: number | null } | null = null;

/**
 * Resolve a process's start-time identity token, cached per pid.
 *
 * Returns `null` when the platform has no provider, the process is gone, or the
 * probe failed. Callers must treat `null` as "cannot prove reuse" and fall back
 * to their age bound, never as "not reused".
 */
export function getCachedProcessStartTime(pid: number): number | null {
  if (!isValidPid(pid)) return null;
  if (pid === process.pid) {
    selfStartTime ??= { value: probe(pid) };
    return selfStartTime.value;
  }
  const nowMs = Date.now();
  const cached = cache.get(pid);
  if (cached && nowMs - cached.verifiedAtMs < START_TIME_CACHE_TTL_MS) {
    return cached.value;
  }
  const value = probe(pid);
  if (cache.size >= START_TIME_CACHE_MAX_ENTRIES) {
    // Insertion-ordered map: drop the oldest entry.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(pid, { value, verifiedAtMs: nowMs });
  return value;
}

/** True when this platform can actually detect pid reuse. */
export function processStartTimeProviderAvailable(): boolean {
  return (
    process.platform === "linux" ||
    process.platform === "win32" ||
    process.platform === "darwin"
  );
}

/** Test/diagnostic seam: how many probes have been performed. */
export function __processStartTimeProbeCount(): number {
  return probeCount;
}

/** Test seam: current cache occupancy, for the eviction bound. */
export function __processStartTimeCacheSize(): number {
  return cache.size;
}

/** Test seam: replace the platform probe. Pass null to restore the real one. */
export function __setProcessStartTimeProbeForTest(
  override: ((pid: number) => number | null) | null,
): void {
  probeOverride = override;
  cache.clear();
  // The self memo has no TTL, so it must be dropped here or an override would
  // never be observed for process.pid.
  selfStartTime = null;
  probeCount = 0;
}

/** Test seam: drop the cache so a suite can observe probe behavior directly. */
export function __resetProcessStartTimeCacheForTest(): void {
  cache.clear();
  selfStartTime = null;
  probeCount = 0;
  probeOverride = null;
}

/** The cache interval, exposed so tests do not hard-code it. */
export const __START_TIME_CACHE_TTL_MS = START_TIME_CACHE_TTL_MS;

/** The eviction bound, exposed so tests do not hard-code it. */
export const __START_TIME_CACHE_MAX_ENTRIES = START_TIME_CACHE_MAX_ENTRIES;
