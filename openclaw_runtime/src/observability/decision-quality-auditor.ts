// ---------------------------------------------------------------------------
// S5 fix (P2): A4 Decision Quality Auditor
//
// Context: Round 2 design. A4 (Decision Quality) previously had only placeholder
// counters (`auditedDecisions` / `lowQualityDecisions`) with no actual audit
// logic. This module implements the audit, scoring Mission reviewer decisions on
// three dimensions (correctness / completeness / timeliness) and feeding the
// results into `deprecationCounters`.
//
// Design:
// - PURE scoring function (`scoreDecision`) — deterministic for the same input,
//   no side effects. Used for prediction/analysis without mutating state.
// - `audit()` / `auditBatch()` are NOT pure — they record the audit by
//   incrementing `deprecationCounters` (the existing budget violation gate).
//   This is intentional: the audit's purpose is to track decisions.
// - Flag-gated seam (default-off) matching A4 pilot convention.
// - Does NOT modify production state — read-only audit + counter side effects.
//
// See: net use/designs/development-manual.md §1.4 (A4), Stage 4
//      net use/designs/area-4-decision-quality.md
// ---------------------------------------------------------------------------

import { deprecationCounters } from "./deprecation-counters.js";

/**
 * A single reviewer decision to be audited.
 *
 * Drawn from the Mission reviewer flow — the fields represent the information
 * available at decision time, plus the outcome observed afterward.
 */
export type DecisionRecord = {
  /** Unique ID for this decision. */
  decisionId: string;
  /** The reviewer's chosen action (e.g., 'continue', 'repair', 'sleep', 'ask_user', 'complete', 'blocked'). */
  reviewerAction: string;
  /** The action that was actually taken (or would have been optimal) — used to score correctness. */
  expectedAction?: string;
  /**
   * Whether the reviewer's action matched the expected action.
   * - `true` when reviewerAction === expectedAction (or expectedAction omitted).
   * - `false` when they differ.
   */
  actionMatched?: boolean;
  /** Number of context items available to the reviewer at decision time. */
  contextItemsAvailable: number;
  /** Number of context items the reviewer actually considered (non-zero utilization). */
  contextItemsConsidered: number;
  /** Mission tick when the decision was made. */
  decisionTick: number;
  /** Max ticks allowed before the decision is considered late. */
  maxTicksForDecision: number;
  /** Whether the decision was deferred (re-planned to a later wave). */
  wasDeferred?: boolean;
};

/**
 * Quality score for a single decision — three dimensions, each 0..1.
 */
export type DecisionQualityScore = {
  /** The decision being scored. */
  decisionId: string;
  /** Correctness: 1.0 when action matched, 0.0 otherwise. */
  correctness: number;
  /** Completeness: ratio of context items considered (considered / available), clamped to [0, 1]. */
  completeness: number;
  /**
   * Timeliness: 1.0 when decided early, decaying linearly to 0.0 at maxTicksForDecision.
   * Deferred decisions are penalized by a fixed factor.
   */
  timeliness: number;
  /** Weighted overall score (correctness * 0.5 + completeness * 0.3 + timeliness * 0.2). */
  overall: number;
  /** Whether this decision is classified as low-quality (overall < LOW_QUALITY_THRESHOLD). */
  isLowQuality: boolean;
};

/** Weight applied to each dimension in the overall score. */
const WEIGHTS = {
  correctness: 0.5,
  completeness: 0.3,
  timeliness: 0.2,
} as const;

/** A decision is "low-quality" when its overall score falls below this threshold. */
const LOW_QUALITY_THRESHOLD = 0.6;

/** Deferred decisions receive a 0.5 timeliness penalty (max 0.5 for timeliness). */
const DEFER_TIMELINESS_PENALTY = 0.5;

/**
 * Result of auditing a batch of decisions.
 */
export type DecisionQualityBatchResult = {
  /** Individual scores, in the same order as the input records. */
  scores: DecisionQualityScore[];
  /** Number of decisions audited. */
  totalAudited: number;
  /** Number classified as low-quality. */
  lowQualityCount: number;
  /** Mean overall score across all audited decisions. */
  meanOverall: number;
};

/**
 * A4 Decision Quality Auditor.
 *
 * Scores reviewer decisions on three dimensions and feeds the results into
 * `deprecationCounters`. The audit is flag-gated (default-off) — when the
 * pilot is disabled, `audit()` / `auditBatch()` are no-ops returning `null`.
 */
export class DecisionQualityAuditor {
  private readonly enabled: boolean;

  /**
   * @param featureFlags  The `runtime` feature flags from OpenClawConfig.
   *   When `runtime.decisionQualityPilot === 'shadow'`, the auditor is enabled.
   *   Otherwise (undefined / 'off' / any other value), it is disabled (no-op).
   */
  constructor(featureFlags?: { decisionQualityPilot?: string }) {
    this.enabled = featureFlags?.decisionQualityPilot === 'shadow';
  }

  /**
   * Audit a single reviewer decision.
   *
   * @returns The quality score, or `null` when the pilot is disabled (flag-off parity).
   */
  audit(record: DecisionRecord): DecisionQualityScore | null {
    if (!this.enabled) {
      return null;
    }

    const score = scoreDecision(record);

    // Feed into deprecation counters (the existing budget violation gate).
    deprecationCounters.incrementA4AuditedDecisions(1);
    if (score.isLowQuality) {
      deprecationCounters.incrementA4LowQualityDecisions(1);
    }

    return score;
  }

  /**
   * Audit a batch of reviewer decisions.
   *
   * @returns The batch result, or `null` when the pilot is disabled.
   */
  auditBatch(records: readonly DecisionRecord[]): DecisionQualityBatchResult | null {
    if (!this.enabled) {
      return null;
    }

    const scores: DecisionQualityScore[] = [];
    let lowQualityCount = 0;
    let sumOverall = 0;

    for (const record of records) {
      const score = scoreDecision(record);
      scores.push(score);
      if (score.isLowQuality) {
        lowQualityCount++;
      }
      sumOverall += score.overall;
    }

    // Feed aggregated counts into deprecation counters.
    deprecationCounters.incrementA4AuditedDecisions(records.length);
    if (lowQualityCount > 0) {
      deprecationCounters.incrementA4LowQualityDecisions(lowQualityCount);
    }

    return {
      scores,
      totalAudited: records.length,
      lowQualityCount,
      meanOverall: records.length > 0 ? sumOverall / records.length : 0,
    };
  }
}

/**
 * Pure scoring function — deterministic for the same input. Has NO side effects.
 *
 * Scoring model:
 * - **correctness** (weight 0.5): 1.0 when `actionMatched` is true or
 *   `expectedAction` is omitted (assume correct). 0.0 when explicitly false.
 * - **completeness** (weight 0.3): ratio of `contextItemsConsidered` /
 *   `contextItemsAvailable`, clamped to [0, 1].
 * - **timeliness** (weight 0.2): 1.0 at tick 0, decaying linearly to 0.0 at
 *   `maxTicksForDecision`. Deferred decisions are capped at 0.5.
 *
 * A decision is "low-quality" when `overall < 0.6`.
 */
export function scoreDecision(record: DecisionRecord): DecisionQualityScore {
  // Correctness: 1.0 when matched (or expected unknown), 0.0 when mismatched.
  const correctness =
    record.actionMatched === false
      ? 0.0
      : record.expectedAction === undefined
        ? 1.0 // No expected action to compare — assume correct.
        : record.actionMatched === true
          ? 1.0
          : record.reviewerAction === record.expectedAction
            ? 1.0
            : 0.0;

  // Completeness: ratio of considered / available, clamped.
  const completeness =
    record.contextItemsAvailable > 0
      ? Math.min(1, Math.max(0, record.contextItemsConsidered / record.contextItemsAvailable))
      : 1.0; // No context available — treat as complete.

  // Timeliness: linear decay from 1.0 (tick 0) to 0.0 (maxTicksForDecision).
  let timeliness: number;
  if (record.maxTicksForDecision > 0) {
    timeliness = Math.min(1, Math.max(0, 1 - record.decisionTick / record.maxTicksForDecision));
  } else {
    timeliness = 1.0; // No max — treat as timely.
  }
  // Deferred decisions are penalized (capped at 0.5).
  if (record.wasDeferred) {
    timeliness = Math.min(timeliness, DEFER_TIMELINESS_PENALTY);
  }

  const rawOverall =
    correctness * WEIGHTS.correctness +
    completeness * WEIGHTS.completeness +
    timeliness * WEIGHTS.timeliness;

  // P2 fix: round to 10 decimal places to avoid floating-point precision drift
  // (e.g., 0.5 + 0.18 + 0.12 = 0.7999999999999999 without rounding).
  const overall = Math.round(rawOverall * 1e10) / 1e10;

  return {
    decisionId: record.decisionId,
    correctness,
    completeness,
    timeliness,
    overall,
    // P1 fix: NaN input (e.g., contextItemsConsidered=NaN) propagates to overall
    // as NaN, and `NaN < threshold` is false — so NaN would NOT be flagged as
    // low-quality. Treat non-finite overall as low-quality to surface data issues.
    isLowQuality: !Number.isFinite(overall) || overall < LOW_QUALITY_THRESHOLD,
  };
}

/**
 * Flag-gated seam: resolve whether the A4 decision quality audit pilot is active.
 *
 * Returns `true` when `runtime.decisionQualityPilot === 'shadow'`.
 * Matches the flag-off parity convention used by other A4 components.
 */
export function isDecisionQualityAuditEnabled(featureFlags?: {
  decisionQualityPilot?: string;
}): boolean {
  return featureFlags?.decisionQualityPilot === 'shadow';
}
