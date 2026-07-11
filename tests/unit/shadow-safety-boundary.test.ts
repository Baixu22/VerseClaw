import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearShadowDiagnosticsForTests,
  getDiagnosticBufferBytes,
  getShadowDiagnostics,
  isShadowBoundaryEnabled,
  onShadowDiagnostic,
  runShadow,
  runShadowSync,
  setShadowBoundaryEnabled,
} from '../../openclaw_runtime/src/runtime-core/shadow-safety-boundary';
import { SHADOW_SAFETY_CONFIG } from '../../openclaw_runtime/src/shared/shadow-safety';

/**
 * Stage 0 acceptance criterion 0.3 — ShadowSafetyBoundary unit tests.
 *
 * Coverage matrix:
 * - timeout (3 profiles)
 * - memory overflow (drop_oldest)
 * - exception swallowing
 * - kill switch (runtime toggle + env var)
 * - diagnostic listener (delivery + isolation)
 * - copy-on-read contract (documented)
 * - sync variant
 *
 * Run: pnpm test shadow-safety-boundary
 */
describe('ShadowSafetyBoundary', () => {
  beforeEach(() => {
    // Reset state between tests so kill-switch / buffer assertions are isolated.
    setShadowBoundaryEnabled(true);
    clearShadowDiagnosticsForTests();
  });

  afterEach(() => {
    setShadowBoundaryEnabled(true);
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------------

  it('returns the value on success and records durationMs', async () => {
    const result = await runShadow('A1', 'non_io', 'shadow-ok', async () => 42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('passes an AbortSignal to fn for cooperative cancellation', async () => {
    const seen = vi.fn<(signal: AbortSignal) => void>();
    await runShadow('A2', 'non_io', 'shadow-signal', async (signal) => {
      seen(signal);
      return 'done';
    });
    expect(seen).toHaveBeenCalledTimes(1);
    const signal = seen.mock.calls[0][0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Exception swallowing
  // -------------------------------------------------------------------------

  it('swallows exceptions and returns a swallowed_exception diagnostic', async () => {
    const result = await runShadow('A1', 'non_io', 'shadow-throw', async () => {
      throw new Error('boom');
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.recoveryAction).toBe('swallowed_exception');
      expect(result.diagnostic.errorType).toBe('Error');
      expect(result.diagnostic.area).toBe('A1');
      expect(result.diagnostic.shadowId).toBe('shadow-throw');
      expect(result.diagnostic.stackTrace).toContain('boom');
    }
  });

  it('swallows non-Error throws and records Unknown errorType', async () => {
    const result = await runShadow('A5', 'non_io', 'shadow-string-throw', async () => {
      throw 'string error';
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.errorType).toBe('Unknown');
      expect(result.diagnostic.recoveryAction).toBe('swallowed_exception');
    }
  });

  // -------------------------------------------------------------------------
  // Timeout per profile
  // -------------------------------------------------------------------------

  it('aborts on non_io timeout (50ms) when fn respects AbortSignal', async () => {
    const result = await runShadow('A1', 'non_io', 'shadow-timeout-nonio', (signal) => {
      return new Promise<string>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.recoveryAction).toBe('aborted_timeout');
      expect(result.durationMs).toBeGreaterThanOrEqual(SHADOW_SAFETY_CONFIG.maxWallClockMs.nonIO - 5);
    }
  });

  it('aborts on snapshot_io timeout (500ms) when fn respects AbortSignal', async () => {
    const start = Date.now();
    const result = await runShadow('A6', 'snapshot_io', 'shadow-timeout-snap', (signal) => {
      return new Promise<string>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.recoveryAction).toBe('aborted_timeout');
    }
    // Should be near 500ms, definitely less than networkIO (2000ms).
    expect(elapsed).toBeLessThan(SHADOW_SAFETY_CONFIG.maxWallClockMs.networkIO);
    expect(elapsed).toBeGreaterThanOrEqual(SHADOW_SAFETY_CONFIG.maxWallClockMs.snapshotIO - 50);
  });

  it('aborts on network_io timeout (2000ms) when fn respects AbortSignal', async () => {
    const start = Date.now();
    const result = await runShadow('A2', 'network_io', 'shadow-timeout-net', (signal) => {
      return new Promise<string>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.recoveryAction).toBe('aborted_timeout');
    }
    expect(elapsed).toBeGreaterThanOrEqual(SHADOW_SAFETY_CONFIG.maxWallClockMs.networkIO - 100);
  });

  // -------------------------------------------------------------------------
  // Kill switch
  // -------------------------------------------------------------------------

  it('runtime kill switch (setShadowBoundaryEnabled(false)) returns killed_by_switch without calling fn', async () => {
    setShadowBoundaryEnabled(false);
    expect(isShadowBoundaryEnabled()).toBe(false);

    const fn = vi.fn(async () => 'should-not-run');
    const result = await runShadow('A1', 'non_io', 'shadow-killed', fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.recoveryAction).toBe('killed_by_switch');
      expect(result.diagnostic.errorType).toBe('KillSwitchActive');
      expect(result.durationMs).toBe(0);
    }
  });

  it('runtime kill switch takes effect on next call after toggle (live toggle)', async () => {
    // First call succeeds.
    const r1 = await runShadow('A1', 'non_io', 'before-toggle', async () => 1);
    expect(r1.ok).toBe(true);

    // Toggle off, next call is killed.
    setShadowBoundaryEnabled(false);
    const r2 = await runShadow('A1', 'non_io', 'after-toggle', async () => 2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.diagnostic.recoveryAction).toBe('killed_by_switch');
    }

    // Toggle back on, subsequent call succeeds.
    setShadowBoundaryEnabled(true);
    const r3 = await runShadow('A1', 'non_io', 're-enabled', async () => 3);
    expect(r3.ok).toBe(true);
  });

  it('env var kill switch (SHADOW_BOUNDARY_DISABLED=true) disables boundary at module load', async () => {
    // vitest stubEnv lets us set process.env before re-importing the module.
    vi.stubEnv('SHADOW_BOUNDARY_DISABLED', 'true');
    // Re-import to trigger module-level init `isShadowBoundaryDisabledEnv()`.
    vi.resetModules();
    const mod = await import('../../openclaw_runtime/src/runtime-core/shadow-safety-boundary');

    // Boundary should be disabled because env var was set at load time.
    expect(mod.isShadowBoundaryEnabled()).toBe(false);

    const fn = vi.fn(async () => 'nope');
    const result = await mod.runShadow('A1', 'non_io', 'env-killed', fn);
    expect(fn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.recoveryAction).toBe('killed_by_switch');
    }
  });

  // -------------------------------------------------------------------------
  // Diagnostic listener
  // -------------------------------------------------------------------------

  it('delivers diagnostic records to subscribed listeners', async () => {
    const received: string[] = [];
    const unsub = onShadowDiagnostic((record) => {
      received.push(record.shadowId);
    });

    await runShadow('A1', 'non_io', 'listener-1', async () => 1);
    await runShadow('A2', 'non_io', 'listener-throw', async () => {
      throw new Error('x');
    });

    expect(received).toEqual(['listener-throw']);
    unsub();

    // After unsubscribe, no more deliveries.
    await runShadow('A1', 'non_io', 'listener-2', async () => {
      throw new Error('y');
    });
    expect(received).toEqual(['listener-throw']);
  });

  it('listener errors are isolated and never affect the boundary', async () => {
    const good = vi.fn<(record: unknown) => void>();
    onShadowDiagnostic(() => {
      throw new Error('listener broke');
    });
    onShadowDiagnostic(good);

    // Boundary should still complete and deliver to the good listener.
    const result = await runShadow('A1', 'non_io', 'listener-isolated', async () => {
      throw new Error('shadow broke');
    });
    expect(result.ok).toBe(false);
    expect(good).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Memory ceiling (buffer overflow → drop_oldest)
  // -------------------------------------------------------------------------

  it('stores diagnostic records in a bounded buffer (getShadowDiagnostics)', async () => {
    await runShadow('A1', 'non_io', 'buf-1', async () => {
      throw new Error('a');
    });
    await runShadow('A5', 'non_io', 'buf-2', async () => {
      throw new Error('b');
    });

    const snapshot = getShadowDiagnostics();
    expect(snapshot.length).toBe(2);
    expect(snapshot[0].shadowId).toBe('buf-1');
    expect(snapshot[1].shadowId).toBe('buf-2');
  });

  it('drops oldest records when the buffer exceeds the 4MB ceiling', async () => {
    // Force a tiny ceiling by directly observing buffer byte growth and then
    // overflowing. We can't change SHADOW_SAFETY_CONFIG, so we generate many
    // records with large stack traces to exceed 4MB.
    //
    // Each record: shadowId(20) + area(2) + errorType(7) + stackTrace(500) +
    // recoveryAction(20) ≈ 549 chars → ~1162 bytes (with overhead).
    // 4MB / 1162 ≈ 3582 records to overflow. We generate 5000 to be safe.
    const bigStack = 'x'.repeat(500);
    for (let i = 0; i < 5000; i++) {
      await runShadow('A1', 'non_io', `overflow-${i}`, async () => {
        const err = new Error('overflow');
        err.stack = bigStack;
        throw err;
      });
    }

    const bytes = getDiagnosticBufferBytes();
    // Must be within ceiling (allow small overshoot before drop kicks in).
    expect(bytes).toBeLessThanOrEqual(SHADOW_SAFETY_CONFIG.maxBufferBytes + 2048);

    const snapshot = getShadowDiagnostics();
    // Oldest records dropped, newest retained.
    expect(snapshot.length).toBeGreaterThan(0);
    expect(snapshot.length).toBeLessThan(5000);
    // The first retained record should be one of the later overflow-* ids.
    const firstId = snapshot[0].shadowId;
    const firstIndex = Number(firstId.replace('overflow-', ''));
    expect(firstIndex).toBeGreaterThan(0);
  });

  it('clearShadowDiagnosticsForTests resets the buffer and byte counter', async () => {
    await runShadow('A1', 'non_io', 'pre-clear', async () => {
      throw new Error('x');
    });
    expect(getShadowDiagnostics().length).toBe(1);
    expect(getDiagnosticBufferBytes()).toBeGreaterThan(0);

    clearShadowDiagnosticsForTests();
    expect(getShadowDiagnostics()).toEqual([]);
    expect(getDiagnosticBufferBytes()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Synchronous variant
  // -------------------------------------------------------------------------

  it('runShadowSync returns value on success', () => {
    const result = runShadowSync('A1', 'sync-ok', () => 'synced');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('synced');
    }
  });

  it('runShadowSync swallows exceptions', () => {
    const result = runShadowSync('A6', 'sync-throw', () => {
      throw new Error('sync boom');
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.recoveryAction).toBe('swallowed_exception');
      expect(result.diagnostic.errorType).toBe('Error');
    }
  });

  it('runShadowSync respects the runtime kill switch', () => {
    setShadowBoundaryEnabled(false);
    const result = runShadowSync('A1', 'sync-killed', () => 'never');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.recoveryAction).toBe('killed_by_switch');
    }
  });

  // -------------------------------------------------------------------------
  // Copy-on-read contract (documented invariant, not enforced by boundary)
  // -------------------------------------------------------------------------

  it('does not deep-copy fn inputs: caller owns copy-on-read (documented invariant)', async () => {
    // The boundary's contract is that the CALLER is responsible for copy-on-read.
    // This test documents that the boundary passes through references as-is.
    const shared: number[] = [1, 2, 3];
    await runShadow('A1', 'non_io', 'copy-on-read', async () => {
      shared.push(4); // mutates the caller's reference — boundary does not intercept
      return shared.length;
    });
    // The caller's array was mutated. This is by design: copy-on-read is the
    // caller's job, not the boundary's. Documented in shadow-safety-boundary.ts.
    expect(shared).toEqual([1, 2, 3, 4]);
  });
});
