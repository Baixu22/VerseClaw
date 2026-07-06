import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { deprecationCounters } from '../../../openclaw_runtime/src/observability/deprecation-counters.js';

/**
 * A4 deep tests — Decision Quality deprecation counters + audit module.
 *
 * Covers:
 * - observability/deprecation-counters.ts (deprecationCounters singleton,
 *   DeprecationArea, A4DeprecationCounters, BudgetViolationResult,
 *   DeprecationCounterRegistry)
 * - observability/decision-quality-auditor.ts (S5 fix — see dedicated test
 *   file tests/unit/decision-quality-auditor.test.ts for the audit module)
 *
 * A4 now has both counters AND an audit module (S5 fix). This file focuses on
 * the A4 counter boundaries and budget violation threshold.
 *
 * Note on import depth: tests live in tests/unit/deep/, so the relative path to
 * the runtime tree is ../../../openclaw_runtime/src/... (three levels up to root).
 *
 * Threshold: A4 budget is violated when
 *   auditedDecisions > 0 && lowQualityDecisions / auditedDecisions > 0.10
 * The comparison is strict (>) — exactly 10% does NOT trigger a violation.
 */

describe('A4 deep — decision-quality deprecation counters', () => {
  beforeEach(() => {
    deprecationCounters.reset();
  });

  afterEach(() => {
    deprecationCounters.reset();
  });

  // -------------------------------------------------------------------------
  // 1. 功能完整性 (4 tests)
  // -------------------------------------------------------------------------
  describe('功能完整性', () => {
    it('checkBudgetViolation("a4") returns not violated when 0 decisions audited', () => {
      const result = deprecationCounters.checkBudgetViolation('a4');
      expect(result.violated).toBe(false);
      expect(result.area).toBe('a4');
    });

    it('checkBudgetViolation("a4") returns violated + degrade_to_audit_only at 11/100 low-quality rate', () => {
      deprecationCounters.incrementA4AuditedDecisions(100);
      deprecationCounters.incrementA4LowQualityDecisions(11);
      const result = deprecationCounters.checkBudgetViolation('a4');
      expect(result.violated).toBe(true);
      if (result.violated) {
        expect(result.degrade).toBe('a4_low_quality_rate');
        expect(result.action).toBe('degrade_to_audit_only');
      }
    });

    it('reset() clears A4 counters back to zero', () => {
      deprecationCounters.incrementA4AuditedDecisions(50);
      deprecationCounters.incrementA4LowQualityDecisions(10);
      deprecationCounters.reset();
      const area = deprecationCounters.getArea('a4');
      expect(area).toEqual({ auditedDecisions: 0, lowQualityDecisions: 0 });
    });

    it('getArea("a4") returns { auditedDecisions, lowQualityDecisions } shape', () => {
      deprecationCounters.incrementA4AuditedDecisions(3);
      deprecationCounters.incrementA4LowQualityDecisions(1);
      const area = deprecationCounters.getArea('a4');
      expect(area).toHaveProperty('auditedDecisions');
      expect(area).toHaveProperty('lowQualityDecisions');
      const a4 = area as { auditedDecisions: number; lowQualityDecisions: number };
      expect(a4.auditedDecisions).toBe(3);
      expect(a4.lowQualityDecisions).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. 边界条件 (3 tests)
  // -------------------------------------------------------------------------
  describe('边界条件', () => {
    it('auditedDecisions=0 + lowQualityDecisions=0 does not divide by zero (guard prevents)', () => {
      // The guard `auditedDecisions > 0` prevents the division; result is not violated.
      const result = deprecationCounters.checkBudgetViolation('a4');
      expect(result.violated).toBe(false);
    });

    it('lowQualityDecisions > auditedDecisions (anomalous state) still classifies by rate > 0.10', () => {
      // 5 low-quality / 3 audited = 1.67 > 0.10 → violated despite the anomalous state.
      deprecationCounters.incrementA4AuditedDecisions(3);
      deprecationCounters.incrementA4LowQualityDecisions(5);
      const result = deprecationCounters.checkBudgetViolation('a4');
      expect(result.violated).toBe(true);
    });

    it('exactly 10% (10/100) is NOT violated — boundary is strict >, not >=', () => {
      deprecationCounters.incrementA4AuditedDecisions(100);
      deprecationCounters.incrementA4LowQualityDecisions(10);
      const result = deprecationCounters.checkBudgetViolation('a4');
      // 10/100 = 0.10 — NOT > 0.10, so not violated.
      expect(result.violated).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 3. 错误路径 (2 tests)
  // -------------------------------------------------------------------------
  describe('错误路径', () => {
    it('incrementA4AuditedDecisions(0) has no effect (adds zero)', () => {
      deprecationCounters.incrementA4AuditedDecisions(0);
      const area = deprecationCounters.getArea('a4');
      const a4 = area as { auditedDecisions: number; lowQualityDecisions: number };
      expect(a4.auditedDecisions).toBe(0);
    });

    it('incrementA4LowQualityDecisions(-1) does not throw (implementation does not clamp but is safe)', () => {
      let threw = false;
      try {
        deprecationCounters.incrementA4LowQualityDecisions(-1);
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
      // After the negative increment, the budget check must still not crash
      // (auditedDecisions=0 means the guard prevents division).
      const result = deprecationCounters.checkBudgetViolation('a4');
      expect(result.violated).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 4. 属性测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('属性测试', () => {
    it('checkBudgetViolation monotonicity — violation goes false→true and never reverts as lowQuality increases 0→15', () => {
      deprecationCounters.incrementA4AuditedDecisions(100);
      let wasViolated = false;
      for (let lowQuality = 0; lowQuality <= 15; lowQuality++) {
        // Reset and re-apply to test each level independently.
        deprecationCounters.reset();
        deprecationCounters.incrementA4AuditedDecisions(100);
        deprecationCounters.incrementA4LowQualityDecisions(lowQuality);
        const result = deprecationCounters.checkBudgetViolation('a4');
        if (lowQuality <= 10) {
          // 0..10 → rate 0.00..0.10, all NOT > 0.10.
          expect(result.violated).toBe(false);
        } else {
          // 11..15 → rate 0.11..0.15, all > 0.10.
          expect(result.violated).toBe(true);
          wasViolated = true;
        }
      }
      // Once violated (at lowQuality=11), it stays violated through 15.
      expect(wasViolated).toBe(true);
    });

    it('reset() restores violation state to false', () => {
      deprecationCounters.incrementA4AuditedDecisions(100);
      deprecationCounters.incrementA4LowQualityDecisions(20);
      expect(deprecationCounters.checkBudgetViolation('a4').violated).toBe(true);
      deprecationCounters.reset();
      expect(deprecationCounters.checkBudgetViolation('a4').violated).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 5. 集成测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('集成测试', () => {
    it('A4 reviewer decision → increment chain → budget violation (simulated Mission reviewer flow)', () => {
      // Simulate: reviewer audits decisions. For each low-quality decision,
      // increment both audited and low-quality counters.
      for (let i = 0; i < 100; i++) {
        deprecationCounters.incrementA4AuditedDecisions(1);
        // 12 of the 100 decisions are low-quality.
        if (i < 12) {
          deprecationCounters.incrementA4LowQualityDecisions(1);
        }
      }
      const result = deprecationCounters.checkBudgetViolation('a4');
      // 12/100 = 0.12 > 0.10 → violated.
      expect(result.violated).toBe(true);
      if (result.violated) {
        expect(result.action).toBe('degrade_to_audit_only');
      }
    });

    it('A4 counters do not interfere with other area counters (A1/A5)', () => {
      deprecationCounters.incrementA4AuditedDecisions(50);
      deprecationCounters.incrementA4LowQualityDecisions(10);
      // Mutate A1 and A5 counters.
      deprecationCounters.incrementA1LegacyFallback(5);
      deprecationCounters.incrementA5PlanAdopted(10);
      // A4 counters are unchanged.
      const a4 = deprecationCounters.getArea('a4') as {
        auditedDecisions: number;
        lowQualityDecisions: number;
      };
      expect(a4.auditedDecisions).toBe(50);
      expect(a4.lowQualityDecisions).toBe(10);
      // A1 and A5 counters are independent.
      const a1 = deprecationCounters.getArea('a1') as {
        legacyFallbackCount: number;
      };
      expect(a1.legacyFallbackCount).toBe(5);
      const a5 = deprecationCounters.getArea('a5') as {
        planAdoptedCount: number;
      };
      expect(a5.planAdoptedCount).toBe(10);
    });
  });
});
