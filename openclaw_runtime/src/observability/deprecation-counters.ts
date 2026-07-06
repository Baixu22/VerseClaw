// ---------------------------------------------------------------------------
// Stage 4 (criteria 4.1-4.4): Per-Area Deprecation Telemetry
//
// Each of the 6 areas (A1-A6) has graduation criteria that, when consistently
// met, allow the area's shadow path to be promoted and the legacy fallback to
// be deprecated. This module exposes telemetry counters that record the
// signals used to make that graduation decision.
//
// All counters are in-memory only (shadow instrumentation) — they do NOT
// touch production state. They are read via `snapshot()` for the Workbench
// and audit reports.
//
// See: net use/designs/development-manual.md §1.1, Stage 4
// ---------------------------------------------------------------------------

/** Lowercase area identifier used by deprecation counters. Includes A3/A4
 * which are not shadow areas but still have graduation telemetry. */
export type DeprecationArea = "a1" | "a2" | "a3" | "a4" | "a5" | "a6";

// ---------------------------------------------------------------------------
// Counter types
// ---------------------------------------------------------------------------

/** A1 deprecation: legacy fallback invocation count. */
export type A1DeprecationCounters = {
  /** Number of times the legacy `IsolationFailureRecovery` fallback ran. */
  legacyFallbackCount: number;
  /** Number of turns where the shadow isolation path succeeded (no fallback). */
  shadowSuccessCount: number;
  /** Number of times a declared-path violation was detected. */
  declaredPathViolationCount: number;
};

/** A2 deprecation: wave deferral consistency. */
export type A2DeprecationCounters = {
  /** Number of times the live scheduler agreed with the shadow prediction. */
  deferralAgreementCount: number;
  /** Number of times they disagreed (shadow predicted X, scheduler did Y). */
  deferralDisagreementCount: number;
  /** Number of waves that were deferred (re-planned to a later wave). */
  deferredWaveCount: number;
};

/** A3 deprecation: anomaly classifier + Mission outcome. */
export type A3DeprecationCounters = {
  /** Number of Mission ticks where `anomalyPattern` was non-null. */
  anomalyNonNullCount: number;
  /** Total Mission ticks observed. */
  totalMissionTicks: number;
  /** Number of Mission outcomes (continue/repair/sleep/ask_user/complete/blocked). */
  missionOutcomeCount: number;
};

/** A4 deprecation: decision quality (placeholder — A4 is decision-quality audits). */
export type A4DeprecationCounters = {
  /** Number of decisions audited. */
  auditedDecisions: number;
  /** Number of decisions flagged as low-quality. */
  lowQualityDecisions: number;
};

/** A5 deprecation: budget plan adoption. */
export type A5DeprecationCounters = {
  /** Number of turns where the compression planner adopted the A5 plan. */
  planAdoptedCount: number;
  /** Number of turns where the compression planner ignored the A5 plan. */
  planIgnoredCount: number;
  /** Number of turns where the budget was exceeded. */
  budgetExceededCount: number;
};

/** A6 deprecation: ResumeContractVerifier pass rate + volatile mislabel. */
export type A6DeprecationCounters = {
  /** Number of resume contract verifications that passed. */
  verifierPassCount: number;
  /** Number of resume contract verifications that failed. */
  verifierFailCount: number;
  /**
   * CRITICAL: Number of times a volatile checkpoint was mislabeled as
   * guaranteed. This is a critical counter — any non-zero value blocks
   * A6 graduation.
   */
  volatileMislabelCount: number;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type DeprecationCounters = {
  a1: A1DeprecationCounters;
  a2: A2DeprecationCounters;
  a3: A3DeprecationCounters;
  a4: A4DeprecationCounters;
  a5: A5DeprecationCounters;
  a6: A6DeprecationCounters;
};

const ZERO: DeprecationCounters = {
  a1: { legacyFallbackCount: 0, shadowSuccessCount: 0, declaredPathViolationCount: 0 },
  a2: { deferralAgreementCount: 0, deferralDisagreementCount: 0, deferredWaveCount: 0 },
  a3: { anomalyNonNullCount: 0, totalMissionTicks: 0, missionOutcomeCount: 0 },
  a4: { auditedDecisions: 0, lowQualityDecisions: 0 },
  a5: { planAdoptedCount: 0, planIgnoredCount: 0, budgetExceededCount: 0 },
  a6: { verifierPassCount: 0, verifierFailCount: 0, volatileMislabelCount: 0 },
};

/**
 * In-memory deprecation counter registry. One instance per process.
 * Counters are monotonically increasing (only `increment` mutates).
 *
 * Usage:
 *   import { deprecationCounters } from "./deprecation-counters.js";
 *   deprecationCounters.a1.incrementLegacyFallback();
 *   const snap = deprecationCounters.snapshot();
 */
class DeprecationCounterRegistry {
  private counters: DeprecationCounters = JSON.parse(JSON.stringify(ZERO));

  // --- A1 ---
  incrementA1LegacyFallback(delta = 1): void {
    this.counters.a1.legacyFallbackCount += delta;
  }
  incrementA1ShadowSuccess(delta = 1): void {
    this.counters.a1.shadowSuccessCount += delta;
  }
  incrementA1DeclaredPathViolation(delta = 1): void {
    this.counters.a1.declaredPathViolationCount += delta;
  }

  // --- A2 ---
  incrementA2DeferralAgreement(delta = 1): void {
    this.counters.a2.deferralAgreementCount += delta;
  }
  incrementA2DeferralDisagreement(delta = 1): void {
    this.counters.a2.deferralDisagreementCount += delta;
  }
  incrementA2DeferredWave(delta = 1): void {
    this.counters.a2.deferredWaveCount += delta;
  }

  // --- A3 ---
  incrementA3AnomalyNonNull(delta = 1): void {
    this.counters.a3.anomalyNonNullCount += delta;
  }
  incrementA3MissionTicks(delta = 1): void {
    this.counters.a3.totalMissionTicks += delta;
  }
  incrementA3MissionOutcome(delta = 1): void {
    this.counters.a3.missionOutcomeCount += delta;
  }

  // --- A4 ---
  incrementA4AuditedDecisions(delta = 1): void {
    this.counters.a4.auditedDecisions += delta;
  }
  incrementA4LowQualityDecisions(delta = 1): void {
    this.counters.a4.lowQualityDecisions += delta;
  }

  // --- A5 ---
  incrementA5PlanAdopted(delta = 1): void {
    this.counters.a5.planAdoptedCount += delta;
  }
  incrementA5PlanIgnored(delta = 1): void {
    this.counters.a5.planIgnoredCount += delta;
  }
  incrementA5BudgetExceeded(delta = 1): void {
    this.counters.a5.budgetExceededCount += delta;
  }

  // --- A6 ---
  incrementA6VerifierPass(delta = 1): void {
    this.counters.a6.verifierPassCount += delta;
  }
  incrementA6VerifierFail(delta = 1): void {
    this.counters.a6.verifierFailCount += delta;
  }
  /**
   * Record a volatile-as-guaranteed mislabel. This is the critical A6
   * graduation gate — any non-zero value blocks graduation.
   */
  incrementA6VolatileMislabel(delta = 1): void {
    this.counters.a6.volatileMislabelCount += delta;
  }

  // --- Read access ---

  /** Get a deep-copy snapshot of all counters. */
  snapshot(): DeprecationCounters {
    return JSON.parse(JSON.stringify(this.counters));
  }

  /** Get a specific area's counters (deep copy). */
  getArea(area: DeprecationArea): A1DeprecationCounters | A2DeprecationCounters | A3DeprecationCounters | A4DeprecationCounters | A5DeprecationCounters | A6DeprecationCounters {
    const snap = this.snapshot();
    switch (area) {
      case "a1": return snap.a1;
      case "a2": return snap.a2;
      case "a3": return snap.a3;
      case "a4": return snap.a4;
      case "a5": return snap.a5;
      case "a6": return snap.a6;
      default: {
        const _exhaustive: never = area;
        return _exhaustive;
      }
    }
  }

  /** Reset all counters to zero (for tests). */
  reset(): void {
    this.counters = JSON.parse(JSON.stringify(ZERO));
  }

  /**
   * Stage 4 (criterion 4.14): check whether an area has exceeded its budget.
   * Returns a degradation recommendation when exceeded.
   */
  checkBudgetViolation(area: DeprecationArea): BudgetViolationResult {
    const c = this.getArea(area);
    switch (area) {
      case "a1": {
        const a1 = c as A1DeprecationCounters;
        // A1 budget: legacy fallback rate must not exceed 5% of total turns.
        // Boundary convention (consistent with A2-A6): rate == 5.000% is
        // ALLOWED (uses strict `>`); rate > 5% triggers violation. This
        // avoids false-positive degradation at the exact boundary.
        // P2-5 note: when `total === 0` (no telemetry collected yet), we
        // intentionally return `violated: false` — degrading without data
        // would be unsafe. "No data" is NOT "good data", but it is also
        // not evidence of a problem; operators should check `total` via
        // `snapshot()` separately when diagnosing.
        const total = a1.legacyFallbackCount + a1.shadowSuccessCount;
        if (total > 0 && a1.legacyFallbackCount / total > 0.05) {
          return { area, violated: true, degrade: "a1_legacy_fallback_rate", action: "degrade_to_legacy" };
        }
        return { area, violated: false };
      }
      case "a2": {
        const a2 = c as A2DeprecationCounters;
        const total = a2.deferralAgreementCount + a2.deferralDisagreementCount;
        if (total > 0 && a2.deferralDisagreementCount / total > 0.10) {
          return { area, violated: true, degrade: "a2_deferral_disagreement_rate", action: "degrade_to_live_only" };
        }
        return { area, violated: false };
      }
      case "a3": {
        const a3 = c as A3DeprecationCounters;
        if (a3.totalMissionTicks > 0 && a3.anomalyNonNullCount / a3.totalMissionTicks > 0.20) {
          return { area, violated: true, degrade: "a3_anomaly_rate", action: "degrade_to_default_decision" };
        }
        return { area, violated: false };
      }
      case "a4": {
        const a4 = c as A4DeprecationCounters;
        if (a4.auditedDecisions > 0 && a4.lowQualityDecisions / a4.auditedDecisions > 0.10) {
          return { area, violated: true, degrade: "a4_low_quality_rate", action: "degrade_to_audit_only" };
        }
        return { area, violated: false };
      }
      case "a5": {
        const a5 = c as A5DeprecationCounters;
        const total = a5.planAdoptedCount + a5.planIgnoredCount;
        if (total > 0 && a5.planIgnoredCount / total > 0.20) {
          return { area, violated: true, degrade: "a5_plan_adoption_rate", action: "degrade_to_default_budget" };
        }
        return { area, violated: false };
      }
      case "a6": {
        const a6 = c as A6DeprecationCounters;
        // A6 has a hard gate: any volatile mislabel is a critical violation.
        if (a6.volatileMislabelCount > 0) {
          return { area, violated: true, degrade: "a6_volatile_mislabel", action: "degrade_to_full_reverification" };
        }
        const total = a6.verifierPassCount + a6.verifierFailCount;
        if (total > 0 && a6.verifierFailCount / total > 0.05) {
          return { area, violated: true, degrade: "a6_verifier_fail_rate", action: "degrade_to_full_reverification" };
        }
        return { area, violated: false };
      }
      default: {
        const _exhaustive: never = area;
        return { area: _exhaustive, violated: false };
      }
    }
  }
}

export type BudgetViolationResult =
  | { area: DeprecationArea; violated: false }
  | {
      area: DeprecationArea;
      violated: true;
      degrade: string;
      action: "degrade_to_legacy" | "degrade_to_live_only" | "degrade_to_default_decision" | "degrade_to_audit_only" | "degrade_to_default_budget" | "degrade_to_full_reverification";
    };

/** Singleton instance. */
export const deprecationCounters = new DeprecationCounterRegistry();
