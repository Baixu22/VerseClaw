import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  DecisionQualityAuditor,
  scoreDecision,
  isDecisionQualityAuditEnabled,
  type DecisionRecord,
} from '../../openclaw_runtime/src/observability/decision-quality-auditor.js';
import { deprecationCounters } from '../../openclaw_runtime/src/observability/deprecation-counters.js';

/**
 * S5 fix (P2): A4 Decision Quality Auditor unit tests.
 *
 * Covers:
 * - Pure scoring function (`scoreDecision`) — three dimensions + threshold
 * - Flag-gated seam (`DecisionQualityAuditor` — default-off, shadow mode)
 * - Integration with `deprecationCounters` (auditedDecisions / lowQualityDecisions)
 * - Batch auditing
 *
 * Run: pnpm test decision-quality-auditor
 */

const PERFECT_RECORD: DecisionRecord = {
  decisionId: 'd1',
  reviewerAction: 'continue',
  expectedAction: 'continue',
  actionMatched: true,
  contextItemsAvailable: 10,
  contextItemsConsidered: 10,
  decisionTick: 0,
  maxTicksForDecision: 10,
  wasDeferred: false,
};

describe('DecisionQualityAuditor (A4 — S5 fix)', () => {
  beforeEach(() => {
    deprecationCounters.reset();
  });

  afterEach(() => {
    deprecationCounters.reset();
  });

  // -------------------------------------------------------------------------
  // 1. Pure scoring function — scoreDecision
  // -------------------------------------------------------------------------
  describe('scoreDecision — pure scoring', () => {
    it('returns overall = 1.0 for a perfect decision (correct, complete, timely)', () => {
      const score = scoreDecision(PERFECT_RECORD);
      expect(score.correctness).toBe(1.0);
      expect(score.completeness).toBe(1.0);
      expect(score.timeliness).toBe(1.0);
      expect(score.overall).toBeCloseTo(1.0, 5);
      expect(score.isLowQuality).toBe(false);
    });

    it('returns correctness = 0.0 when actionMatched is false', () => {
      const score = scoreDecision({ ...PERFECT_RECORD, actionMatched: false });
      expect(score.correctness).toBe(0.0);
      expect(score.overall).toBeCloseTo(0.5, 5); // 0*0.5 + 1*0.3 + 1*0.2 = 0.5
    });

    it('returns correctness = 0.0 when reviewerAction !== expectedAction (implicit mismatch)', () => {
      const score = scoreDecision({
        ...PERFECT_RECORD,
        actionMatched: undefined, // implicit comparison
        reviewerAction: 'repair',
        expectedAction: 'continue',
      });
      expect(score.correctness).toBe(0.0);
    });

    it('returns correctness = 1.0 when expectedAction is omitted (assume correct)', () => {
      const score = scoreDecision({ ...PERFECT_RECORD, expectedAction: undefined, actionMatched: undefined });
      expect(score.correctness).toBe(1.0);
    });

    it('computes completeness as considered/available ratio, clamped to [0, 1]', () => {
      expect(scoreDecision({ ...PERFECT_RECORD, contextItemsConsidered: 5, contextItemsAvailable: 10 }).completeness).toBeCloseTo(0.5, 5);
      expect(scoreDecision({ ...PERFECT_RECORD, contextItemsConsidered: 0, contextItemsAvailable: 10 }).completeness).toBe(0);
      expect(scoreDecision({ ...PERFECT_RECORD, contextItemsConsidered: 15, contextItemsAvailable: 10 }).completeness).toBe(1); // clamped
      expect(scoreDecision({ ...PERFECT_RECORD, contextItemsAvailable: 0 }).completeness).toBe(1); // no context → complete
    });

    it('computes timeliness with linear decay from tick 0 to maxTicksForDecision', () => {
      expect(scoreDecision({ ...PERFECT_RECORD, decisionTick: 0, maxTicksForDecision: 10 }).timeliness).toBe(1.0);
      expect(scoreDecision({ ...PERFECT_RECORD, decisionTick: 5, maxTicksForDecision: 10 }).timeliness).toBeCloseTo(0.5, 5);
      expect(scoreDecision({ ...PERFECT_RECORD, decisionTick: 10, maxTicksForDecision: 10 }).timeliness).toBe(0);
      expect(scoreDecision({ ...PERFECT_RECORD, maxTicksForDecision: 0 }).timeliness).toBe(1.0); // no max → timely
    });

    it('caps timeliness at 0.5 when wasDeferred is true', () => {
      const score = scoreDecision({ ...PERFECT_RECORD, decisionTick: 0, maxTicksForDecision: 10, wasDeferred: true });
      expect(score.timeliness).toBe(0.5); // would be 1.0, capped to 0.5
    });

    it('classifies as low-quality when overall < 0.6', () => {
      // correctness=0, completeness=0, timeliness=1 → 0*0.5+0*0.3+1*0.2 = 0.2 < 0.6
      const low = scoreDecision({
        ...PERFECT_RECORD,
        actionMatched: false,
        contextItemsConsidered: 0,
        contextItemsAvailable: 10,
      });
      expect(low.overall).toBeCloseTo(0.2, 5);
      expect(low.isLowQuality).toBe(true);
    });

    it('classifies as NOT low-quality when overall = 0.6 (boundary, strict <)', () => {
      // correctness=1, completeness=0, timeliness=0.5 → 0.5+0+0.1 = 0.6 (not < 0.6)
      const boundary = scoreDecision({
        ...PERFECT_RECORD,
        contextItemsConsidered: 0,
        contextItemsAvailable: 10,
        decisionTick: 5,
        maxTicksForDecision: 10,
      });
      expect(boundary.overall).toBeCloseTo(0.6, 5);
      expect(boundary.isLowQuality).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Flag-off parity (default-off)
  // -------------------------------------------------------------------------
  describe('flag-off parity', () => {
    it('audit() returns null when pilot is disabled (no flags)', () => {
      const auditor = new DecisionQualityAuditor(undefined);
      expect(auditor.audit(PERFECT_RECORD)).toBeNull();
    });

    it('audit() returns null when pilot is "off"', () => {
      const auditor = new DecisionQualityAuditor({ decisionQualityPilot: 'off' });
      expect(auditor.audit(PERFECT_RECORD)).toBeNull();
    });

    it('auditBatch() returns null when pilot is disabled', () => {
      const auditor = new DecisionQualityAuditor(undefined);
      expect(auditor.auditBatch([PERFECT_RECORD])).toBeNull();
    });

    it('does NOT increment counters when pilot is disabled', () => {
      const auditor = new DecisionQualityAuditor(undefined);
      auditor.audit(PERFECT_RECORD);
      auditor.auditBatch([PERFECT_RECORD, PERFECT_RECORD]);
      const a4 = deprecationCounters.getArea('a4') as { auditedDecisions: number; lowQualityDecisions: number };
      expect(a4.auditedDecisions).toBe(0);
      expect(a4.lowQualityDecisions).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Shadow mode — audit + counter integration
  // -------------------------------------------------------------------------
  describe('shadow mode — audit + counter integration', () => {
    it('audit() returns a score and increments auditedDecisions when pilot is "shadow"', () => {
      const auditor = new DecisionQualityAuditor({ decisionQualityPilot: 'shadow' });
      const score = auditor.audit(PERFECT_RECORD);
      expect(score).not.toBeNull();
      expect(score!.overall).toBeCloseTo(1.0, 5);
      const a4 = deprecationCounters.getArea('a4') as { auditedDecisions: number; lowQualityDecisions: number };
      expect(a4.auditedDecisions).toBe(1);
      expect(a4.lowQualityDecisions).toBe(0); // perfect → not low quality
    });

    it('audit() increments lowQualityDecisions when decision is low-quality', () => {
      const auditor = new DecisionQualityAuditor({ decisionQualityPilot: 'shadow' });
      const score = auditor.audit({
        ...PERFECT_RECORD,
        actionMatched: false,
        contextItemsConsidered: 0,
        contextItemsAvailable: 10,
      });
      expect(score!.isLowQuality).toBe(true);
      const a4 = deprecationCounters.getArea('a4') as { auditedDecisions: number; lowQualityDecisions: number };
      expect(a4.auditedDecisions).toBe(1);
      expect(a4.lowQualityDecisions).toBe(1);
    });

    it('auditBatch() returns aggregated result and increments counters by batch size', () => {
      const auditor = new DecisionQualityAuditor({ decisionQualityPilot: 'shadow' });
      const records: DecisionRecord[] = [
        PERFECT_RECORD,
        { ...PERFECT_RECORD, decisionId: 'd2', actionMatched: false, contextItemsConsidered: 0 },
        { ...PERFECT_RECORD, decisionId: 'd3' },
      ];
      const result = auditor.auditBatch(records);
      expect(result).not.toBeNull();
      expect(result!.totalAudited).toBe(3);
      expect(result!.lowQualityCount).toBe(1);
      expect(result!.scores).toHaveLength(3);
      expect(result!.meanOverall).toBeCloseTo(
        (1.0 + 0.2 + 1.0) / 3,
        4,
      );
      const a4 = deprecationCounters.getArea('a4') as { auditedDecisions: number; lowQualityDecisions: number };
      expect(a4.auditedDecisions).toBe(3);
      expect(a4.lowQualityDecisions).toBe(1);
    });

    it('auditBatch() with empty records returns totalAudited=0, lowQualityCount=0, meanOverall=0', () => {
      const auditor = new DecisionQualityAuditor({ decisionQualityPilot: 'shadow' });
      const result = auditor.auditBatch([]);
      expect(result!.totalAudited).toBe(0);
      expect(result!.lowQualityCount).toBe(0);
      expect(result!.meanOverall).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Budget violation integration (A4 gate)
  // -------------------------------------------------------------------------
  describe('budget violation integration', () => {
    it('auditing 100 decisions with 11 low-quality triggers A4 budget violation', () => {
      const auditor = new DecisionQualityAuditor({ decisionQualityPilot: 'shadow' });
      for (let i = 0; i < 100; i++) {
        if (i < 11) {
          // 11 low-quality decisions
          auditor.audit({
            ...PERFECT_RECORD,
            decisionId: `low-${i}`,
            actionMatched: false,
            contextItemsConsidered: 0,
          });
        } else {
          auditor.audit({ ...PERFECT_RECORD, decisionId: `ok-${i}` });
        }
      }
      const result = deprecationCounters.checkBudgetViolation('a4');
      expect(result.violated).toBe(true);
    });

    it('auditing 100 decisions with 10 low-quality does NOT trigger violation (boundary)', () => {
      const auditor = new DecisionQualityAuditor({ decisionQualityPilot: 'shadow' });
      for (let i = 0; i < 100; i++) {
        if (i < 10) {
          auditor.audit({
            ...PERFECT_RECORD,
            decisionId: `low-${i}`,
            actionMatched: false,
            contextItemsConsidered: 0,
          });
        } else {
          auditor.audit({ ...PERFECT_RECORD, decisionId: `ok-${i}` });
        }
      }
      const result = deprecationCounters.checkBudgetViolation('a4');
      // 10/100 = 0.10 — NOT > 0.10, so not violated.
      expect(result.violated).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 5. isDecisionQualityAuditEnabled seam
  // -------------------------------------------------------------------------
  describe('isDecisionQualityAuditEnabled', () => {
    it('returns false for undefined flags', () => {
      expect(isDecisionQualityAuditEnabled(undefined)).toBe(false);
    });
    it('returns false for "off"', () => {
      expect(isDecisionQualityAuditEnabled({ decisionQualityPilot: 'off' })).toBe(false);
    });
    it('returns true for "shadow"', () => {
      expect(isDecisionQualityAuditEnabled({ decisionQualityPilot: 'shadow' })).toBe(true);
    });
  });
});
