/**
 * A3 Runtime Resilience — `executeReplayRollback` authority.
 *
 * Context: Round 2 design (A3 simplified to 2 pure functions). Merges the
 * deleted `ReplayRollbackPlanner` + `ResiliencePilotGate` modules into a
 * single authority function.
 *
 * Blocker 1 resolution (area-composition-spec.md):
 * - `MissionDecision` enum is NOT extended with `rollback`.
 * - Rollback is expressed as `decision: "repair"` + `repairStrategy: "replay_rollback"`.
 * - Mission Control explicitly invokes this function only when those fields are set.
 *
 * Invariants (Stage 1 Stream 1B):
 * - MUST NOT self-trigger. Only Mission Control calls this.
 * - MUST NOT be called by `classifyAnomalyPattern` (the two functions are independent).
 * - MUST check the pilot gate before using event-log replay.
 * - MUST fall back to legacy checkpoint when pilot gate is disabled.
 * - MUST NOT promote event-log replay without pilot.
 *
 * See: docs/runtime-design/development-manual.md §1.2 (A3), Stage 1 Stream 1B
 *      docs/runtime-design/area-3-runtime-resilience.md §9.2 (serial chain dissolution)
 */

/** A Mission decision that requests replay-rollback. Must be `repair` + `replay_rollback`. */
export type ReplayRollbackDecision = {
  decision: 'repair';
  repairStrategy: 'replay_rollback';
  reason: string;
  /** Tick at which the rollback was requested. */
  requestedAtTick: number;
};

/**
 * Pilot gate state for event-log replay. When `enabled` is false, the authority
 * MUST fall back to legacy checkpoint replay (deletion, not parallelization —
 * §9.2 serial chain dissolution).
 */
export type ResiliencePilotGate = {
  /** Whether event-log replay is allowed. When false, legacy checkpoint is used. */
  enabled: boolean;
  /** Human-readable reason for the current state (for diagnostics). */
  reason?: string;
};

/**
 * The rollback target — either a checkpoint ID (legacy) or an event-log
 * sequence range (pilot).
 */
export type ReplayRollbackTarget =
  | { kind: 'checkpoint'; checkpointId: string }
  /**
   * @unimplemented (#177) — no production producer satisfies this variant yet:
   * `checkpoint-rollback-executor.ts` returns `event_log_replay_not_implemented`
   * and `sessions.restoreCheckpoint` gates the replay pilot off. It exists so
   * the authority type can be widened in one place when event-level replay is
   * actually built; treat any `available`-style claim built on it as false.
   */
  | { kind: 'event_log'; fromSequence: number; toSequence: number };

/** Result of a rollback attempt. */
export type ReplayRollbackResult =
  | {
      ok: true;
      rolledBackTo: string;
      mode: 'event_log_replay' | 'legacy_checkpoint_fallback';
      evidenceSummary: string;
      durationMs: number;
    }
  | {
      ok: false;
      reason:
        | 'pilot_gate_disabled_with_no_checkpoint' // pilot off and no legacy checkpoint available
        | 'invalid_decision' // decision is not repair + replay_rollback
        | 'no_checkpoint' // checkpoint not found
        | 'replay_failed' // replay threw an error
        | 'checkpoint_corrupted' // checkpoint failed validation
        | 'rollback_apply_failed'; // applyCheckpoint threw (restore could not complete)
      detail: string;
      durationMs: number;
    };

/** Dependencies injected by the caller (test-friendly). */
export type ReplayRollbackDeps = {
  /** Load a checkpoint by ID (legacy fallback path). */
  loadCheckpoint: (checkpointId: string) => Promise<unknown | undefined>;
  /** Validate a loaded checkpoint is usable for rollback. */
  validateCheckpoint: (checkpoint: unknown) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Apply a checkpoint (restore state). Called only on legacy fallback path. */
  applyCheckpoint: (checkpoint: unknown) => Promise<void>;
  /** Replay event-log entries between two sequence numbers (pilot path). */
  replayEventLog: (fromSeq: number, toSeq: number) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Record the rollback outcome for telemetry/audit (must not throw). */
  recordOutcome: (result: ReplayRollbackResult) => void;
};

/**
 * Validate that a decision is a valid replay-rollback request.
 * Pure: no side effects, deterministic.
 */
export function isValidReplayRollbackDecision(decision: unknown): decision is ReplayRollbackDecision {
  if (typeof decision !== 'object' || decision === null) return false;
  const d = decision as Record<string, unknown>;
  return (
    d.decision === 'repair' &&
    d.repairStrategy === 'replay_rollback' &&
    typeof d.reason === 'string' &&
    typeof d.requestedAtTick === 'number'
  );
}

/**
 * Execute a replay-rollback when Mission Control explicitly invokes it.
 *
 * Flow:
 * 1. Validate the decision is `repair` + `replay_rollback`.
 * 2. If pilot gate enabled → use event-log replay.
 * 3. If pilot gate disabled → fall back to legacy checkpoint.
 * 4. If neither succeeds → return failure (do NOT auto-promote pilot).
 *
 * This function is async because it performs I/O via deps. It is NOT called by
 * `classifyAnomalyPattern`; the two A3 functions are independent.
 */
export async function executeReplayRollback(
  decision: unknown,
  pilotGate: ResiliencePilotGate,
  target: ReplayRollbackTarget,
  deps: ReplayRollbackDeps,
): Promise<ReplayRollbackResult> {
  const start = Date.now();

  // 1. Validate decision.
  if (!isValidReplayRollbackDecision(decision)) {
    const result: ReplayRollbackResult = {
      ok: false,
      reason: 'invalid_decision',
      detail: 'Decision must be { decision: "repair", repairStrategy: "replay_rollback", reason: string, requestedAtTick: number }',
      durationMs: Date.now() - start,
    };
    deps.recordOutcome(result);
    return result;
  }

  // 2. Route based on pilot gate + target kind.
  if (target.kind === 'event_log') {
    // Pilot path: event-log replay.
    if (!pilotGate.enabled) {
      // Pilot disabled — cannot use event-log replay. Fall back to checkpoint
      // if available, else fail. We do NOT auto-enable the pilot.
      const result: ReplayRollbackResult = {
        ok: false,
        reason: 'pilot_gate_disabled_with_no_checkpoint',
        detail: `Event-log replay requested but pilot gate is disabled (${pilotGate.reason ?? 'no reason given'}). ` +
          `Caller must provide a checkpoint target for legacy fallback.`,
        durationMs: Date.now() - start,
      };
      deps.recordOutcome(result);
      return result;
    }

    const replayResult = await deps.replayEventLog(target.fromSequence, target.toSequence);
    if (!replayResult.ok) {
      const result: ReplayRollbackResult = {
        ok: false,
        reason: 'replay_failed',
        detail: replayResult.reason,
        durationMs: Date.now() - start,
      };
      deps.recordOutcome(result);
      return result;
    }

    const result: ReplayRollbackResult = {
      ok: true,
      rolledBackTo: `event_log:${target.fromSequence}-${target.toSequence}`,
      mode: 'event_log_replay',
      evidenceSummary: `Replayed event-log entries ${target.fromSequence}..${target.toSequence} at tick ${decision.requestedAtTick}`,
      durationMs: Date.now() - start,
    };
    deps.recordOutcome(result);
    return result;
  }

  // 3. Legacy checkpoint fallback path.
  const checkpoint = await deps.loadCheckpoint(target.checkpointId);
  if (checkpoint === undefined) {
    const result: ReplayRollbackResult = {
      ok: false,
      reason: 'no_checkpoint',
      detail: `Checkpoint "${target.checkpointId}" not found`,
      durationMs: Date.now() - start,
    };
    deps.recordOutcome(result);
    return result;
  }

  const validation = await deps.validateCheckpoint(checkpoint);
  if (!validation.ok) {
    const result: ReplayRollbackResult = {
      ok: false,
      reason: 'checkpoint_corrupted',
      detail: validation.reason,
      durationMs: Date.now() - start,
    };
    deps.recordOutcome(result);
    return result;
  }

  try {
    await deps.applyCheckpoint(checkpoint);
  } catch (error) {
    // Restore itself failed (e.g. journal snapshot missing). This must be a
    // recorded outcome, never an unhandled rejection: callers (mission
    // control) map ok:false to a blocked state with the failure detail.
    const result: ReplayRollbackResult = {
      ok: false,
      reason: 'rollback_apply_failed',
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    };
    deps.recordOutcome(result);
    return result;
  }

  const result: ReplayRollbackResult = {
    ok: true,
    rolledBackTo: `checkpoint:${target.checkpointId}`,
    mode: 'legacy_checkpoint_fallback',
    evidenceSummary:
      `Restored from checkpoint "${target.checkpointId}" at tick ${decision.requestedAtTick}; ` +
      'file writes were rolled back via the write-journal, but runtime state and external side effects are not restored (event-log replay not implemented)',
    durationMs: Date.now() - start,
  };
  deps.recordOutcome(result);
  return result;
}
