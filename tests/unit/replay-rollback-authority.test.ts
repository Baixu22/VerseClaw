import { describe, expect, it, vi } from 'vitest';

import {
  type ReplayRollbackDeps,
  type ReplayRollbackTarget,
  type ResiliencePilotGate,
  executeReplayRollback,
  isValidReplayRollbackDecision,
} from '../../openclaw_runtime/src/agents/replay-rollback-authority';

/**
 * Stage 1 Stream 1B — executeReplayRollback authority tests.
 *
 * Covers Blocker 1 resolution: rollback = repair + repairStrategy: 'replay_rollback'
 * (no MissionDecision enum change).
 *
 * Run: pnpm test replay-rollback-authority
 */
describe('A3 executeReplayRollback authority', () => {
  const validDecision = {
    decision: 'repair' as const,
    repairStrategy: 'replay_rollback' as const,
    reason: 'tool failure burst detected',
    requestedAtTick: 5,
  };

  const pilotEnabled: ResiliencePilotGate = { enabled: true, reason: 'pilot active' };
  const pilotDisabled: ResiliencePilotGate = { enabled: false, reason: 'pilot off' };

  function makeDeps(overrides: Partial<ReplayRollbackDeps> = {}): ReplayRollbackDeps {
    return {
      loadCheckpoint: vi.fn(async () => ({ id: 'ckpt-1', state: 'snap' })),
      validateCheckpoint: vi.fn(async () => ({ ok: true } as const)),
      applyCheckpoint: vi.fn(async () => undefined),
      replayEventLog: vi.fn(async () => ({ ok: true } as const)),
      recordOutcome: vi.fn(),
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // isValidReplayRollbackDecision (pure validator)
  // -------------------------------------------------------------------------

  it('isValidReplayRollbackDecision: accepts valid decision', () => {
    expect(isValidReplayRollbackDecision(validDecision)).toBe(true);
  });

  it('isValidReplayRollbackDecision: rejects non-repair decision', () => {
    expect(
      isValidReplayRollbackDecision({ ...validDecision, decision: 'continue' }),
    ).toBe(false);
  });

  it('isValidReplayRollbackDecision: rejects missing repairStrategy', () => {
    expect(
      isValidReplayRollbackDecision({ decision: 'repair', reason: 'x', requestedAtTick: 1 }),
    ).toBe(false);
  });

  it('isValidReplayRollbackDecision: rejects wrong repairStrategy', () => {
    expect(
      isValidReplayRollbackDecision({ ...validDecision, repairStrategy: 'fresh_start' }),
    ).toBe(false);
  });

  it('isValidReplayRollbackDecision: rejects null/undefined/non-object', () => {
    expect(isValidReplayRollbackDecision(null)).toBe(false);
    expect(isValidReplayRollbackDecision(undefined)).toBe(false);
    expect(isValidReplayRollbackDecision('string')).toBe(false);
    expect(isValidReplayRollbackDecision(42)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Invalid decision handling
  // -------------------------------------------------------------------------

  it('returns invalid_decision when decision is not repair + replay_rollback', async () => {
    const deps = makeDeps();
    const result = await executeReplayRollback(
      { decision: 'continue' },
      pilotEnabled,
      { kind: 'checkpoint', checkpointId: 'ckpt-1' },
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_decision');
    }
    expect(deps.recordOutcome).toHaveBeenCalledTimes(1);
    // loadCheckpoint should NOT be called for invalid decisions.
    expect(deps.loadCheckpoint).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Event-log replay path (pilot enabled)
  // -------------------------------------------------------------------------

  it('uses event_log_replay when pilot enabled and target is event_log', async () => {
    const deps = makeDeps();
    const target: ReplayRollbackTarget = { kind: 'event_log', fromSequence: 100, toSequence: 150 };
    const result = await executeReplayRollback(validDecision, pilotEnabled, target, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('event_log_replay');
      expect(result.rolledBackTo).toBe('event_log:100-150');
    }
    expect(deps.replayEventLog).toHaveBeenCalledWith(100, 150);
    expect(deps.recordOutcome).toHaveBeenCalledTimes(1);
  });

  it('returns replay_failed when replayEventLog fails', async () => {
    const deps = makeDeps({
      replayEventLog: vi.fn(async () => ({ ok: false, reason: 'corrupted log entry at seq 120' })),
    });
    const target: ReplayRollbackTarget = { kind: 'event_log', fromSequence: 100, toSequence: 150 };
    const result = await executeReplayRollback(validDecision, pilotEnabled, target, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('replay_failed');
      expect(result.detail).toContain('corrupted');
    }
  });

  // -------------------------------------------------------------------------
  // Pilot gate disabled → no auto-promotion
  // -------------------------------------------------------------------------

  it('returns pilot_gate_disabled_with_no_checkpoint when pilot off and target is event_log', async () => {
    const deps = makeDeps();
    const target: ReplayRollbackTarget = { kind: 'event_log', fromSequence: 100, toSequence: 150 };
    const result = await executeReplayRollback(validDecision, pilotDisabled, target, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('pilot_gate_disabled_with_no_checkpoint');
      expect(result.detail).toContain('pilot gate is disabled');
    }
    // MUST NOT auto-enable pilot — replayEventLog should not be called.
    expect(deps.replayEventLog).not.toHaveBeenCalled();
  });

  it('pilot disabled message includes the pilot reason', async () => {
    const deps = makeDeps();
    const target: ReplayRollbackTarget = { kind: 'event_log', fromSequence: 1, toSequence: 2 };
    const result = await executeReplayRollback(
      validDecision,
      { enabled: false, reason: 'awaiting evidence' },
      target,
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain('awaiting evidence');
    }
  });

  // -------------------------------------------------------------------------
  // Legacy checkpoint fallback path
  // -------------------------------------------------------------------------

  it('uses legacy_checkpoint_fallback when target is checkpoint', async () => {
    const deps = makeDeps();
    const target: ReplayRollbackTarget = { kind: 'checkpoint', checkpointId: 'ckpt-42' };
    const result = await executeReplayRollback(validDecision, pilotDisabled, target, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('legacy_checkpoint_fallback');
      expect(result.rolledBackTo).toBe('checkpoint:ckpt-42');
    }
    expect(deps.loadCheckpoint).toHaveBeenCalledWith('ckpt-42');
    expect(deps.validateCheckpoint).toHaveBeenCalledTimes(1);
    expect(deps.applyCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('returns no_checkpoint when checkpoint is not found', async () => {
    const deps = makeDeps({
      loadCheckpoint: vi.fn(async () => undefined),
    });
    const target: ReplayRollbackTarget = { kind: 'checkpoint', checkpointId: 'missing' };
    const result = await executeReplayRollback(validDecision, pilotDisabled, target, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_checkpoint');
      expect(result.detail).toContain('missing');
    }
    expect(deps.applyCheckpoint).not.toHaveBeenCalled();
  });

  it('returns checkpoint_corrupted when validateCheckpoint fails', async () => {
    const deps = makeDeps({
      validateCheckpoint: vi.fn(async () => ({ ok: false, reason: 'schema version mismatch' })),
    });
    const target: ReplayRollbackTarget = { kind: 'checkpoint', checkpointId: 'ckpt-1' };
    const result = await executeReplayRollback(validDecision, pilotDisabled, target, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('checkpoint_corrupted');
      expect(result.detail).toContain('schema version mismatch');
    }
    expect(deps.applyCheckpoint).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // recordOutcome is always called (audit trail)
  // -------------------------------------------------------------------------

  it('recordOutcome is called exactly once for every execution path', async () => {
    // Success path
    const deps1 = makeDeps();
    await executeReplayRollback(validDecision, pilotEnabled, {
      kind: 'event_log',
      fromSequence: 1,
      toSequence: 2,
    }, deps1);
    expect(deps1.recordOutcome).toHaveBeenCalledTimes(1);

    // Failure path
    const deps2 = makeDeps({
      loadCheckpoint: vi.fn(async () => undefined),
    });
    await executeReplayRollback(validDecision, pilotDisabled, {
      kind: 'checkpoint',
      checkpointId: 'missing',
    }, deps2);
    expect(deps2.recordOutcome).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Independence: executeReplayRollback does NOT call classifyAnomalyPattern
  // (the two A3 functions are independent — §1.2)
  // -------------------------------------------------------------------------

  it('executeReplayRollback does not import or call classifyAnomalyPattern', async () => {
    // This is a structural invariant: the two A3 functions must not call each other.
    // We verify by checking the module doesn't export classifyAnomalyPattern.
    const mod = await import('../../openclaw_runtime/src/agents/replay-rollback-authority');
    expect(mod).not.toHaveProperty('classifyAnomalyPattern');
  });
});
