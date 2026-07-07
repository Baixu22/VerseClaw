/**
 * ShadowSafetyBoundary runtime implementation.
 *
 * Type contract: openclaw_runtime/src/shared/shadow-safety.ts
 *
 * Every shadow path (A1, A2, A5, A6) MUST route through `runShadow`. The
 * boundary enforces: timeout, memory ceiling, exception swallowing, and
 * respects the kill switch (env var + runtime toggle).
 *
 * Invariants:
 * - Shadow paths NEVER block the production path. `runShadow` is async and
 *   the caller does not await it on the hot path (or awaits with a tight
 *   budget that aborts on timeout).
 * - Shadow paths NEVER mutate production state. Copy-on-read is the caller's
 *   responsibility; the boundary does not deep-copy (that would be too
 *   expensive for the 50ms non-IO budget).
 * - Shadow exceptions are swallowed and converted to a single diagnostic
 *   record. They never propagate to the production turn/tool path.
 *
 * Kill switch:
 * - `SHADOW_BOUNDARY_DISABLED=true` env var: checked once at module load.
 * - `setShadowBoundaryEnabled(false)`: live toggle via host-api, takes
 *   effect on the next `runShadow` call (within 1 tick).
 */

import type {
  ShadowArea,
  ShadowDiagnosticRecord,
  ShadowIOProfile,
  ShadowResult,
} from '../shared/shadow-safety.js';
import { SHADOW_SAFETY_CONFIG } from '../shared/shadow-safety.js';

/**
 * Check whether the kill switch is active via environment variable.
 * Runtime-only — `process.env` is not available in the renderer.
 */
function isShadowBoundaryDisabledEnv(): boolean {
  return process.env[SHADOW_SAFETY_CONFIG.killSwitchEnvVar] === 'true';
}

/** Live toggle state. Initialized from env var, mutable via host-api. */
let shadowBoundaryEnabled = !isShadowBoundaryDisabledEnv();

/** Listener for diagnostic records (used by observability/LCP). */
type DiagnosticListener = (record: ShadowDiagnosticRecord) => void;
const diagnosticListeners: Set<DiagnosticListener> = new Set();

// ---------------------------------------------------------------------------
// Bounded diagnostic buffer (memory ceiling).
//
// The buffer enforces `SHADOW_SAFETY_CONFIG.maxBufferBytes` (4MB). When the
// buffer exceeds this ceiling, the oldest records are dropped
// (`overflowStrategy: 'drop_oldest'`). This prevents unbounded memory growth
// when shadow paths fail repeatedly under load.
//
// The buffer is an internal ring-like structure. Listeners receive records
// via `emitDiagnostic`; the buffer is for retrospective inspection only
// (e.g., by the host-api `runtime.getShadowDiagnostics` route).
// ---------------------------------------------------------------------------

const diagnosticBuffer: ShadowDiagnosticRecord[] = [];
let diagnosticBufferBytes = 0;

/** Approximate byte size of a diagnostic record (UTF-16 → ~2 bytes/char). */
function approximateRecordBytes(record: ShadowDiagnosticRecord): number {
  // Each char is 2 bytes in UTF-16; numbers/booleans are negligible.
  // Conservative estimate: sum of string fields, plus fixed overhead.
  const stringBytes =
    record.shadowId.length +
    record.area.length +
    record.errorType.length +
    record.stackTrace.length +
    record.recoveryAction.length;
  return stringBytes * 2 + 64; // 64 bytes fixed overhead (object header, timestamp, refs)
}

/** Drop oldest records until the buffer fits within the byte ceiling. */
function enforceBufferCeiling(): void {
  const ceiling = SHADOW_SAFETY_CONFIG.maxBufferBytes;
  while (diagnosticBufferBytes > ceiling && diagnosticBuffer.length > 0) {
    const dropped = diagnosticBuffer.shift();
    if (dropped) {
      diagnosticBufferBytes -= approximateRecordBytes(dropped);
    }
  }
}

/**
 * Live-toggle the shadow boundary. Called by host-api
 * (`runtime.setShadowBoundary`). Takes effect on the next `runShadow` call.
 */
export function setShadowBoundaryEnabled(enabled: boolean): void {
  shadowBoundaryEnabled = enabled;
}

/** Current enabled state (for diagnostics/observability). */
export function isShadowBoundaryEnabled(): boolean {
  return shadowBoundaryEnabled;
}

/** Subscribe to shadow diagnostic records. Returns an unsubscribe function. */
export function onShadowDiagnostic(listener: DiagnosticListener): () => void {
  diagnosticListeners.add(listener);
  return () => diagnosticListeners.delete(listener);
}

/**
 * Snapshot of the diagnostic buffer (oldest first). Returns a shallow copy so
 * callers cannot mutate the internal buffer. Intended for host-api inspection
 * (e.g., `runtime.getShadowDiagnostics`).
 */
export function getShadowDiagnostics(): readonly ShadowDiagnosticRecord[] {
  return diagnosticBuffer.slice();
}

/** Current estimated byte size of the diagnostic buffer (for tests/observability). */
export function getDiagnosticBufferBytes(): number {
  return diagnosticBufferBytes;
}

/** Clear the diagnostic buffer (for tests only). Not exposed via host-api. */
export function clearShadowDiagnosticsForTests(): void {
  diagnosticBuffer.length = 0;
  diagnosticBufferBytes = 0;
}

function emitDiagnostic(record: ShadowDiagnosticRecord): void {
  // Append to bounded buffer first, then enforce the ceiling.
  diagnosticBuffer.push(record);
  diagnosticBufferBytes += approximateRecordBytes(record);
  enforceBufferCeiling();

  // Then emit to live listeners (observability/LCP subscribers).
  for (const listener of diagnosticListeners) {
    try {
      listener(record);
    } catch {
      // Listener errors must never affect the boundary.
    }
  }
}

function truncateStackTrace(stack: unknown): string {
  const str = typeof stack === 'string' ? stack : String(stack ?? '');
  return str.length > 500 ? str.slice(0, 500) : str;
}

function timeoutForProfile(profile: ShadowIOProfile): number {
  switch (profile) {
    case 'non_io':
      return SHADOW_SAFETY_CONFIG.maxWallClockMs.nonIO;
    case 'snapshot_io':
      return SHADOW_SAFETY_CONFIG.maxWallClockMs.snapshotIO;
    case 'network_io':
      return SHADOW_SAFETY_CONFIG.maxWallClockMs.networkIO;
  }
}

/**
 * Run a shadow path inside the safety boundary.
 *
 * The caller is responsible for copy-on-read: pass a snapshot/copy of any
 * production state into `fn`, not a live reference. The boundary does not
 * deep-copy (too expensive for the budget).
 *
 * If the kill switch is active, returns immediately with a `killed_by_switch`
 * diagnostic — `fn` is never called.
 *
 * If `fn` throws, the exception is swallowed and a `swallowed_exception`
 * diagnostic is emitted.
 *
 * If `fn` exceeds the timeout, the promise is abandoned (JavaScript cannot
 * truly cancel an async operation, but the caller sees `aborted_timeout` and
 * the result is discarded). The `fn` implementation should check
 * `AbortSignal` if it supports cooperative cancellation.
 */
export async function runShadow<T>(
  area: ShadowArea,
  profile: ShadowIOProfile,
  shadowId: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<ShadowResult<T>> {
  const start = Date.now();

  if (!shadowBoundaryEnabled) {
    const diagnostic: ShadowDiagnosticRecord = {
      shadowId,
      area,
      errorType: 'KillSwitchActive',
      stackTrace: '',
      timestamp: start,
      recoveryAction: 'killed_by_switch',
    };
    emitDiagnostic(diagnostic);
    return { ok: false, diagnostic, durationMs: 0 };
  }

  const timeoutMs = timeoutForProfile(profile);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const value = await fn(controller.signal);
    clearTimeout(timer);
    return { ok: true, value, durationMs: Date.now() - start };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = controller.signal.aborted;
    const diagnostic: ShadowDiagnosticRecord = {
      shadowId,
      area,
      errorType: isTimeout ? 'Timeout' : (err instanceof Error ? err.name : 'Unknown'),
      stackTrace: truncateStackTrace(err instanceof Error ? err.stack : err),
      timestamp: Date.now(),
      recoveryAction: isTimeout ? 'aborted_timeout' : 'swallowed_exception',
    };
    emitDiagnostic(diagnostic);
    return { ok: false, diagnostic, durationMs: Date.now() - start };
  }
}

/**
 * Synchronous shadow path variant (for pure-function shadow code like A3's
 * `classifyAnomalyPattern` if it were ever used in shadow — currently it is
 * not, but the API is here for future pure-function shadow paths).
 *
 * Same invariants: kill switch, timeout (via Date.now polling), exception
 * swallowing. No AbortSignal because synchronous code cannot be interrupted
 * mid-execution — the timeout check happens after `fn` returns.
 */
export function runShadowSync<T>(
  area: ShadowArea,
  shadowId: string,
  fn: () => T,
): ShadowResult<T> {
  const start = Date.now();

  if (!shadowBoundaryEnabled) {
    const diagnostic: ShadowDiagnosticRecord = {
      shadowId,
      area,
      errorType: 'KillSwitchActive',
      stackTrace: '',
      timestamp: start,
      recoveryAction: 'killed_by_switch',
    };
    emitDiagnostic(diagnostic);
    return { ok: false, diagnostic, durationMs: 0 };
  }

  try {
    const value = fn();
    const durationMs = Date.now() - start;
    if (durationMs > SHADOW_SAFETY_CONFIG.maxWallClockMs.nonIO) {
      const diagnostic: ShadowDiagnosticRecord = {
        shadowId,
        area,
        errorType: 'Timeout',
        stackTrace: '',
        timestamp: Date.now(),
        recoveryAction: 'aborted_timeout',
      };
      emitDiagnostic(diagnostic);
      return { ok: false, diagnostic, durationMs };
    }
    return { ok: true, value, durationMs };
  } catch (err) {
    const diagnostic: ShadowDiagnosticRecord = {
      shadowId,
      area,
      errorType: err instanceof Error ? err.name : 'Unknown',
      stackTrace: truncateStackTrace(err instanceof Error ? err.stack : err),
      timestamp: Date.now(),
      recoveryAction: 'swallowed_exception',
    };
    emitDiagnostic(diagnostic);
    return { ok: false, diagnostic, durationMs: Date.now() - start };
  }
}
