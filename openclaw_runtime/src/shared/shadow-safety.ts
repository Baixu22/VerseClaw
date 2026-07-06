/**
 * ShadowSafetyBoundary types — runtime-local.
 *
 * Context: Round 2 design (Gap 5). Shadow code is still code and carries its
 * own failure modes. This module defines the type contract for a boundary
 * that wraps every shadow path with timeout, memory ceiling, exception
 * swallowing, and copy-on-read semantics.
 *
 * Ownership: runtime shared infrastructure. All shadow paths (A1, A2, A5, A6)
 * MUST route through `runShadow` from the runtime implementation. A3 and A4
 * have no shadow paths (A3 simplified to pure functions, A4 is offline-only).
 *
 * Kill switch: `SHADOW_BOUNDARY_DISABLED=true` env var disables all shadow
 * paths at startup. A runtime kill switch (`setShadowBoundaryEnabled`) allows
 * live toggling without restart for emergency production triage.
 *
 * See: net use/designs/development-manual.md §1.1, Stage 0
 */

/** Which area a shadow path belongs to. A3/A4 excluded (no shadow). */
export type ShadowArea = 'A1' | 'A2' | 'A5' | 'A6';

/** I/O profile of a shadow path, used to select the timeout budget. */
export type ShadowIOProfile = 'non_io' | 'snapshot_io' | 'network_io';

/** Configuration for the shadow safety boundary. */
export type ShadowSafetyConfig = {
  maxWallClockMs: {
    nonIO: number;
    snapshotIO: number;
    networkIO: number;
  };
  maxBufferBytes: number;
  overflowStrategy: 'drop_oldest';
  exceptionPolicy: 'swallow_and_record';
  concurrencyPolicy: 'copy_on_read';
  mutationPolicy: 'forbidden';
  killSwitchEnvVar: string;
};

/** The canonical config values, matching the Round 2 decision document. */
export const SHADOW_SAFETY_CONFIG: ShadowSafetyConfig = {
  maxWallClockMs: {
    nonIO: 50,
    snapshotIO: 500,
    networkIO: 2000,
  },
  maxBufferBytes: 4 * 1024 * 1024,
  overflowStrategy: 'drop_oldest',
  exceptionPolicy: 'swallow_and_record',
  concurrencyPolicy: 'copy_on_read',
  mutationPolicy: 'forbidden',
  killSwitchEnvVar: 'SHADOW_BOUNDARY_DISABLED',
};

/** Diagnostic record emitted when a shadow path fails or is killed. */
export type ShadowDiagnosticRecord = {
  shadowId: string;
  area: ShadowArea;
  errorType: string;
  stackTrace: string;
  timestamp: number;
  recoveryAction: 'aborted_timeout' | 'aborted_overflow' | 'swallowed_exception' | 'killed_by_switch';
};

/** Result of a shadow execution. */
export type ShadowResult<T> =
  | { ok: true; value: T; durationMs: number }
  | { ok: false; diagnostic: ShadowDiagnosticRecord; durationMs: number };
