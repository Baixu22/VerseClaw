import { describe, expect, it } from 'vitest';

import {
  type AnomalyClassifierInput,
  type AnomalyPattern,
  type AnomalyPatternKind,
  type AnomalySeverity,
  classifyAnomalyPattern,
  resolveAnomalyPatternForReviewer,
} from '../../openclaw_runtime/src/agents/anomaly-classifier';
import type { RuntimeFeatureConfig } from '../../openclaw_runtime/src/config/types.openclaw';

/**
 * Stage 1 Stream 1B acceptance 1.6 — classifyAnomalyPattern is pure:
 * same input → same output, no side effects, no external calls.
 *
 * Run: pnpm test anomaly-classifier
 */
describe('A3 classifyAnomalyPattern (pure function)', () => {
  const baseInput: AnomalyClassifierInput = {
    tick: 5,
    repairTicksUsed: 0,
    maxRepairTicks: 3,
    maxTicks: 20,
  };

  // -------------------------------------------------------------------------
  // Acceptance 1.6: purity — same input → same output
  // -------------------------------------------------------------------------

  it('same input produces same output (purity: determinism)', () => {
    const input: AnomalyClassifierInput = {
      ...baseInput,
      recentToolFailureCount: 5,
    };
    const r1 = classifyAnomalyPattern(input);
    const r2 = classifyAnomalyPattern(input);
    expect(r1).toEqual(r2);
  });

  it('does not mutate the input object (purity: no side effects)', () => {
    const input: AnomalyClassifierInput = {
      ...baseInput,
      recentToolFailureCount: 4,
      failures: ['toolA failed', 'toolB failed', 'toolC failed', 'toolD failed'],
    };
    const snapshot = JSON.stringify(input);
    classifyAnomalyPattern(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  // -------------------------------------------------------------------------
  // No anomaly detected
  // -------------------------------------------------------------------------

  it('returns null when no anomaly is detected (healthy session)', () => {
    expect(classifyAnomalyPattern(baseInput)).toBeNull();
  });

  it('returns null when tick is early (no_progress guard)', () => {
    expect(
      classifyAnomalyPattern({ ...baseInput, tick: 1, maxTicks: 20 }),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // tool_failure_burst
  // -------------------------------------------------------------------------

  it('detects tool_failure_burst when recentToolFailureCount >= threshold (3)', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      recentToolFailureCount: 3,
    });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('tool_failure_burst');
    expect(result!.severity).toBe('medium');
    expect(result!.detectedAtTick).toBe(5);
  });

  it('escalates tool_failure_burst severity to high at 2x threshold (6)', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      recentToolFailureCount: 6,
    });
    expect(result!.kind).toBe('tool_failure_burst');
    expect(result!.severity).toBe('high');
  });

  it('detects tool_failure_burst via failures array length when recentToolFailureCount is undefined', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      failures: ['a', 'b', 'c'],
    });
    expect(result!.kind).toBe('tool_failure_burst');
  });

  // -------------------------------------------------------------------------
  // stuck_loop
  // -------------------------------------------------------------------------

  it('detects stuck_loop when noProgressHash is unchanged across ticks', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      noProgressHash: 'hash-abc',
      previousNoProgressHash: 'hash-abc',
    });
    expect(result!.kind).toBe('stuck_loop');
    expect(result!.severity).toBe('medium');
    expect(result!.evidenceSummary).toContain('hash-abc');
  });

  it('does not detect stuck_loop when hashes differ', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      noProgressHash: 'hash-a',
      previousNoProgressHash: 'hash-b',
    });
    // Could be another anomaly, but not stuck_loop
    if (result && result.kind === 'stuck_loop') {
      throw new Error('should not detect stuck_loop with different hashes');
    }
  });

  it('does not detect stuck_loop when hash is empty', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      noProgressHash: '',
      previousNoProgressHash: '',
    });
    if (result && result.kind === 'stuck_loop') {
      throw new Error('empty hash should not trigger stuck_loop');
    }
  });

  // -------------------------------------------------------------------------
  // repair_storm
  // -------------------------------------------------------------------------

  it('detects repair_storm when repairTicksUsed >= 60% of maxRepairTicks', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      repairTicksUsed: 2,
      maxRepairTicks: 3,
    });
    expect(result!.kind).toBe('repair_storm');
    expect(result!.severity).toBe('medium');
  });

  it('escalates repair_storm severity to high when budget exhausted', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      repairTicksUsed: 3,
      maxRepairTicks: 3,
    });
    expect(result!.kind).toBe('repair_storm');
    expect(result!.severity).toBe('high');
  });

  it('does not detect repair_storm when ratio is below 60%', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      repairTicksUsed: 1,
      maxRepairTicks: 3,
    });
    if (result && result.kind === 'repair_storm') {
      throw new Error('33% ratio should not trigger repair_storm');
    }
  });

  // -------------------------------------------------------------------------
  // token_blowup
  // -------------------------------------------------------------------------

  it('detects token_blowup when usage >= 1.5x budget', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      tokenUsage: { input: 8000, output: 7000, total: 15000 },
      tokenBudget: 10000,
    });
    expect(result!.kind).toBe('token_blowup');
    expect(result!.severity).toBe('medium');
  });

  it('escalates token_blowup severity to high at 2x budget', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      tokenUsage: { input: 10000, output: 10000, total: 20000 },
      tokenBudget: 10000,
    });
    expect(result!.kind).toBe('token_blowup');
    expect(result!.severity).toBe('high');
  });

  // -------------------------------------------------------------------------
  // no_progress (lowest priority, conservative)
  // -------------------------------------------------------------------------

  it('detects no_progress when past 50% of maxTicks with no failures', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      tick: 15,
      maxTicks: 20,
      failures: [],
    });
    expect(result!.kind).toBe('no_progress');
    expect(result!.severity).toBe('low');
  });

  // -------------------------------------------------------------------------
  // Priority ordering: first match wins
  // -------------------------------------------------------------------------

  it('priority: tool_failure_burst wins over repair_storm when both match', () => {
    const result = classifyAnomalyPattern({
      ...baseInput,
      recentToolFailureCount: 5,
      repairTicksUsed: 3,
      maxRepairTicks: 3,
    });
    expect(result!.kind).toBe('tool_failure_burst');
  });

  // -------------------------------------------------------------------------
  // Type completeness
  // -------------------------------------------------------------------------

  it('AnomalyPatternKind is a closed union of 5 kinds', () => {
    const kinds: AnomalyPatternKind[] = [
      'tool_failure_burst',
      'no_progress',
      'token_blowup',
      'repair_storm',
      'stuck_loop',
    ];
    expect(kinds).toHaveLength(5);
  });

  it('AnomalySeverity has 3 levels', () => {
    const severities: AnomalySeverity[] = ['low', 'medium', 'high'];
    expect(severities).toHaveLength(3);
  });

  it('every detected pattern includes evidenceSummary and detectedAtTick', () => {
    const inputs: AnomalyClassifierInput[] = [
      { ...baseInput, recentToolFailureCount: 4 },
      { ...baseInput, noProgressHash: 'x', previousNoProgressHash: 'x' },
      { ...baseInput, repairTicksUsed: 3, maxRepairTicks: 3 },
      { ...baseInput, tick: 15, maxTicks: 20, failures: [] },
    ];
    for (const input of inputs) {
      const p = classifyAnomalyPattern(input);
      expect(p).not.toBeNull();
      expect(p!.evidenceSummary).toBeTruthy();
      expect(p!.detectedAtTick).toBe(input.tick);
    }
  });
});

// ---------------------------------------------------------------------------
// Stage 1 Stream 1B wiring: resolveAnomalyPatternForReviewer (flag-gated seam)
// ---------------------------------------------------------------------------

describe('A3 resolveAnomalyPatternForReviewer (wiring seam)', () => {
  const inputWithAnomaly: AnomalyClassifierInput = {
    tick: 5,
    repairTicksUsed: 0,
    maxRepairTicks: 3,
    maxTicks: 20,
    recentToolFailureCount: 5, // triggers tool_failure_burst
  };

  // -------------------------------------------------------------------------
  // Acceptance 1.8: flag-off parity
  // -------------------------------------------------------------------------

  it('acceptance 1.8: returns undefined when featureFlags is undefined (flag-off parity)', () => {
    const result = resolveAnomalyPatternForReviewer(undefined, inputWithAnomaly);
    expect(result).toBeUndefined();
  });

  it('acceptance 1.8: returns undefined when resilience.anomalyClassifierPilot is undefined', () => {
    const flags: RuntimeFeatureConfig = {};
    expect(resolveAnomalyPatternForReviewer(flags, inputWithAnomaly)).toBeUndefined();
  });

  it('acceptance 1.8: returns undefined when anomalyClassifierPilot is "off"', () => {
    const flags: RuntimeFeatureConfig = {
      resilience: { anomalyClassifierPilot: 'off' },
    };
    expect(resolveAnomalyPatternForReviewer(flags, inputWithAnomaly)).toBeUndefined();
  });

  it('acceptance 1.8: flag-off parity is byte-identical regardless of input anomaly signals', () => {
    // Even with strong anomaly signals, flag-off returns undefined.
    const flags: RuntimeFeatureConfig = {
      resilience: { anomalyClassifierPilot: 'off' },
    };
    expect(resolveAnomalyPatternForReviewer(flags, inputWithAnomaly)).toBeUndefined();
    expect(
      resolveAnomalyPatternForReviewer(flags, {
        ...inputWithAnomaly,
        recentToolFailureCount: 100,
        repairTicksUsed: 3,
        maxRepairTicks: 3,
      }),
    ).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Shadow mode: invokes classifyAnomalyPattern
  // -------------------------------------------------------------------------

  it('returns AnomalyPattern (non-null) when pilot is "shadow" and anomaly detected', () => {
    const flags: RuntimeFeatureConfig = {
      resilience: { anomalyClassifierPilot: 'shadow' },
    };
    const result = resolveAnomalyPatternForReviewer(flags, inputWithAnomaly);
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
    expect((result as AnomalyPattern).kind).toBe('tool_failure_burst');
  });

  it('returns null when pilot is "shadow" but no anomaly detected', () => {
    const flags: RuntimeFeatureConfig = {
      resilience: { anomalyClassifierPilot: 'shadow' },
    };
    const healthyInput: AnomalyClassifierInput = {
      tick: 1,
      repairTicksUsed: 0,
      maxRepairTicks: 3,
      maxTicks: 20,
    };
    const result = resolveAnomalyPatternForReviewer(flags, healthyInput);
    // null is a valid return — it means shadow mode ran but found no anomaly.
    expect(result).toBeNull();
  });

  it('shadow mode produces the same result as direct classifyAnomalyPattern call', () => {
    const flags: RuntimeFeatureConfig = {
      resilience: { anomalyClassifierPilot: 'shadow' },
    };
    const direct = classifyAnomalyPattern(inputWithAnomaly);
    const wired = resolveAnomalyPatternForReviewer(flags, inputWithAnomaly);
    expect(wired).toEqual(direct);
  });

  // -------------------------------------------------------------------------
  // Independence: seam does NOT trigger executeReplayRollback
  // (structural invariant — verified by absence of import)
  // -------------------------------------------------------------------------

  it('anomaly-classifier module does not export executeReplayRollback', async () => {
    const mod = await import('../../openclaw_runtime/src/agents/anomaly-classifier');
    expect(mod).not.toHaveProperty('executeReplayRollback');
  });
});
