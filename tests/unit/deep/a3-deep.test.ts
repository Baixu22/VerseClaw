import { describe, expect, it } from 'vitest';

import {
  type AnomalyClassifierInput,
  type AnomalyPatternKind,
  classifyAnomalyPattern,
  resolveAnomalyPatternForReviewer,
} from '../../../openclaw_runtime/src/agents/anomaly-classifier.js';

/**
 * A3 deep tests — Runtime Resilience anomaly classifier.
 *
 * Covers:
 * - agents/anomaly-classifier.ts (classifyAnomalyPattern, resolveAnomalyPatternForReviewer,
 *   AnomalyPatternKind, AnomalyPattern, AnomalyClassifierInput)
 *
 * Note on import depth: tests live in tests/unit/deep/, so the relative path to
 * the runtime tree is ../../../openclaw_runtime/src/... (three levels up to root).
 *
 * Note on thresholds: the threshold constants (TOOL_FAILURE_BURST_THRESHOLD, etc.)
 * are module-private in anomaly-classifier.ts (not exported). The local constants
 * below mirror the documented design values and are used only to make boundary
 * assertions self-documenting.
 */

// Mirrors anomaly-classifier.ts thresholds (not exported; values per design spec).
const TOOL_FAILURE_BURST_THRESHOLD = 3;
const NO_PROGRESS_TICK_THRESHOLD = 2;
const TOKEN_BLOWUP_RATIO = 1.5;
const REPAIR_STORM_RATIO = 0.6;

/**
 * Build a feature-flags object for resolveAnomalyPatternForReviewer without
 * importing the full RuntimeFeatureConfig type (only the resilience.anomalyClassifierPilot
 * field is read). Cast to any to avoid coupling the test to the wide config shape.
 */
function featureFlags(mode: 'shadow' | 'off'): unknown {
  return { resilience: { anomalyClassifierPilot: mode } };
}

describe('A3 deep — anomaly-classifier', () => {
  // -------------------------------------------------------------------------
  // 1. 功能完整性 (8 tests)
  // -------------------------------------------------------------------------
  describe('功能完整性', () => {
    it('tool_failure_burst triggers when recentToolFailureCount >= threshold', () => {
      const result = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        recentToolFailureCount: TOOL_FAILURE_BURST_THRESHOLD,
      });
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('tool_failure_burst');
    });

    it('no_progress triggers when tick past halfway with no failures and no progress', () => {
      const result = classifyAnomalyPattern({
        tick: 5,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        failures: [],
      });
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('no_progress');
    });

    it('token_blowup triggers when tokenUsage / tokenBudget >= blowup ratio', () => {
      const result = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        tokenUsage: { input: 0, output: 0, total: 2000 },
        tokenBudget: 1000,
      });
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('token_blowup');
    });

    it('repair_storm triggers when repairTicksUsed / maxRepairTicks >= storm ratio', () => {
      const result = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 7,
        maxRepairTicks: 10,
        maxTicks: 10,
      });
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('repair_storm');
    });

    it('stuck_loop triggers when noProgressHash is unchanged from the previous tick', () => {
      const result = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        noProgressHash: 'abc',
        previousNoProgressHash: 'abc',
      });
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('stuck_loop');
    });

    it('classifyAnomalyPattern returns null when no anomaly is detected', () => {
      const result = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        failures: [],
        recentToolFailureCount: 0,
      });
      expect(result).toBeNull();
    });

    it("resolveAnomalyPatternForReviewer with flag='shadow' returns the classified pattern", () => {
      const input: AnomalyClassifierInput = {
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        recentToolFailureCount: 5,
      };
      const result = resolveAnomalyPatternForReviewer(
        featureFlags('shadow') as never,
        input,
      );
      expect(result).not.toBeUndefined();
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('tool_failure_burst');
    });

    it("resolveAnomalyPatternForReviewer with flag='off' returns undefined (flag-off parity)", () => {
      const input: AnomalyClassifierInput = {
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        recentToolFailureCount: 5,
      };
      const result = resolveAnomalyPatternForReviewer(
        featureFlags('off') as never,
        input,
      );
      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. 边界条件 (6 tests)
  // -------------------------------------------------------------------------
  describe('边界条件', () => {
    it('tick=0 produces no anomaly (no_progress requires tick >= NO_PROGRESS_TICK_THRESHOLD)', () => {
      // 0 is strictly below NO_PROGRESS_TICK_THRESHOLD, so no_progress cannot fire.
      expect(0).toBeLessThan(NO_PROGRESS_TICK_THRESHOLD);
      const result = classifyAnomalyPattern({
        tick: 0,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
      });
      expect(result).toBeNull();
    });

    it('maxTicks=0 is safe from division-by-zero (no crash, no false positive)', () => {
      const result = classifyAnomalyPattern({
        tick: 0,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 0,
      });
      expect(result).toBeNull();
    });

    it('maxRepairTicks=0 disables repair_storm (guard prevents division by zero)', () => {
      // repairTicksUsed is high but maxRepairTicks=0 -> the guard skips the check.
      const result = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 5,
        maxRepairTicks: 0,
        maxTicks: 10,
      });
      expect(result).toBeNull();
    });

    it('tokenBudget=0 disables token_blowup (guard prevents division by zero)', () => {
      const result = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        tokenUsage: { input: 0, output: 0, total: 9999 },
        tokenBudget: 0,
      });
      expect(result).toBeNull();
    });

    it('failures=undefined and recentToolFailureCount=undefined yields no tool_failure_burst (defaults to 0)', () => {
      const result = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
      });
      expect(result).toBeNull();
    });

    it('exactly-at-threshold values trigger (boundaries are inclusive >=)', () => {
      // tool_failure_burst at exactly 3 failures.
      const t1 = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        recentToolFailureCount: TOOL_FAILURE_BURST_THRESHOLD,
      });
      expect(t1!.kind).toBe('tool_failure_burst');

      // repair_storm at exactly the storm ratio (10 * REPAIR_STORM_RATIO = 6).
      const t2 = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 10 * REPAIR_STORM_RATIO,
        maxRepairTicks: 10,
        maxTicks: 10,
      });
      expect(t2!.kind).toBe('repair_storm');

      // token_blowup at exactly the blowup ratio (1000 * TOKEN_BLOWUP_RATIO = 1500).
      const t3 = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        tokenUsage: { input: 0, output: 0, total: 1000 * TOKEN_BLOWUP_RATIO },
        tokenBudget: 1000,
      });
      expect(t3!.kind).toBe('token_blowup');
    });
  });

  // -------------------------------------------------------------------------
  // 3. 错误路径 (3 tests)
  // -------------------------------------------------------------------------
  describe('错误路径', () => {
    it('resolveAnomalyPatternForReviewer degrades to undefined when featureFlags is undefined', () => {
      const input: AnomalyClassifierInput = {
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        recentToolFailureCount: 5,
      };
      const result = resolveAnomalyPatternForReviewer(undefined, input);
      expect(result).toBeUndefined();
    });

    it('resolveAnomalyPatternForReviewer degrades to undefined when featureFlags is null', () => {
      const input: AnomalyClassifierInput = {
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        recentToolFailureCount: 5,
      };
      const result = resolveAnomalyPatternForReviewer(null as never, input);
      expect(result).toBeUndefined();
    });

    it('input with only required fields present uses sensible defaults (no crash, no false positive)', () => {
      // All optional anomaly-signal fields omitted; only tick/repair/maxRepair/maxTicks given.
      const result = classifyAnomalyPattern({
        tick: 0,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 0,
      });
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 4. 属性测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('属性测试', () => {
    it('classifyAnomalyPattern is deterministic (same input -> same output across 10 runs)', () => {
      const input: AnomalyClassifierInput = {
        tick: 3,
        repairTicksUsed: 8,
        maxRepairTicks: 10,
        maxTicks: 10,
        recentToolFailureCount: 4,
      };
      const first = classifyAnomalyPattern(input);
      expect(first).not.toBeNull();
      for (let i = 0; i < 10; i++) {
        expect(classifyAnomalyPattern(input)).toEqual(first);
      }
    });

    it('non-anomalous inputs always return null (across multiple variations)', () => {
      const noAnomalyInputs: AnomalyClassifierInput[] = [
        { tick: 0, repairTicksUsed: 0, maxRepairTicks: 0, maxTicks: 10 },
        { tick: 1, repairTicksUsed: 0, maxRepairTicks: 0, maxTicks: 10, failures: [] },
        { tick: 1, repairTicksUsed: 1, maxRepairTicks: 10, maxTicks: 10 }, // 0.1 < 0.6
        {
          tick: 1,
          repairTicksUsed: 0,
          maxRepairTicks: 10,
          maxTicks: 10,
          tokenUsage: { input: 0, output: 0, total: 100 },
          tokenBudget: 1000,
        }, // 0.1 < 1.5
      ];
      for (const input of noAnomalyInputs) {
        expect(classifyAnomalyPattern(input)).toBeNull();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. 压力测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('压力测试', () => {
    it('100 consecutive calls (simulating 100 Mission ticks) complete quickly', () => {
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        classifyAnomalyPattern({
          tick: i,
          repairTicksUsed: 0,
          maxRepairTicks: 0,
          maxTicks: 100,
        });
      }
      const elapsed = Date.now() - start;
      // Pure function with no I/O -> should be well under 200ms for 100 calls.
      expect(elapsed).toBeLessThan(200);
    });

    it('a failures array with 1000 elements does not crash (and still classifies)', () => {
      const failures = Array.from({ length: 1000 }, (_, i) => `failure-${i}`);
      const result = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        failures,
      });
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('tool_failure_burst');
    });
  });

  // -------------------------------------------------------------------------
  // 6. 集成测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('集成测试', () => {
    it('every detected pattern.kind is a member of the AnomalyPatternKind union', () => {
      const validKinds: AnomalyPatternKind[] = [
        'tool_failure_burst',
        'no_progress',
        'token_blowup',
        'repair_storm',
        'stuck_loop',
      ];
      const inputs: AnomalyClassifierInput[] = [
        {
          tick: 1,
          repairTicksUsed: 0,
          maxRepairTicks: 0,
          maxTicks: 10,
          recentToolFailureCount: 3,
        }, // tool_failure_burst
        { tick: 5, repairTicksUsed: 0, maxRepairTicks: 0, maxTicks: 10, failures: [] }, // no_progress
        {
          tick: 1,
          repairTicksUsed: 0,
          maxRepairTicks: 0,
          maxTicks: 10,
          tokenUsage: { input: 0, output: 0, total: 2000 },
          tokenBudget: 1000,
        }, // token_blowup
        { tick: 1, repairTicksUsed: 7, maxRepairTicks: 10, maxTicks: 10 }, // repair_storm
        {
          tick: 1,
          repairTicksUsed: 0,
          maxRepairTicks: 0,
          maxTicks: 10,
          noProgressHash: 'x',
          previousNoProgressHash: 'x',
        }, // stuck_loop
      ];
      for (const input of inputs) {
        const r = classifyAnomalyPattern(input);
        expect(r).not.toBeNull();
        expect(validKinds).toContain(r!.kind);
      }
    });

    it('every detected pattern has a valid severity value (low | medium | high)', () => {
      const result = classifyAnomalyPattern({
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 0,
        maxTicks: 10,
        recentToolFailureCount: 5,
      });
      expect(result).not.toBeNull();
      expect(['low', 'medium', 'high']).toContain(result!.severity);
    });
  });
});