/**
 * A3 Runtime Resilience — `classifyAnomalyPattern` pure function.
 *
 * Context: Round 2 design (A3 simplified to 2 pure functions). The previous
 * design had ActiveResilienceSupervisor / SignalNormalizer / RecoveryStrategyRouter
 * modules; Round 2 collapses these into a single pure function that classifies
 * recent signals + session metrics into an `AnomalyPattern | null`.
 *
 * Invariants (Stage 1 Stream 1B acceptance 1.6):
 * - PURE: same input → same output. No external calls, no I/O, no mutation.
 * - Does NOT produce Mission decisions.
 * - Does NOT assert Mission consumed its output.
 * - Does NOT call `executeReplayRollback`.
 * - Does NOT maintain internal state.
 *
 * Output is injected into `MissionReviewerInput.anomalyPattern?` (additive,
 * optional). When undefined, Mission reviewer behaves exactly as before
 * (flag-off parity).
 *
 * Wiring (Stage 1 Stream 1B acceptance 1.8):
 * - `resolveAnomalyPatternForReviewer` is the flag-gated seam called by
 *   `mission-control/controller.ts` before invoking `runMissionReviewer`.
 * - When `runtime.resilience.anomalyClassifierPilot !== 'shadow'`, returns
 *   `undefined` (flag-off parity).
 * - When 'shadow', calls `classifyAnomalyPattern` and returns the result
 *   (which may be `null` if no anomaly is detected).
 *
 * See: net use/designs/development-manual.md §1.2 (A3), Stage 1 Stream 1B
 *      net use/designs/area-3-runtime-resilience.md §9.1 (observe-only honesty)
 */

import type { RuntimeFeatureConfig } from "../config/types.openclaw.js";

/** Category of anomaly detected. Closed enum — no freeform strings. */
export type AnomalyPatternKind =
  | 'tool_failure_burst' // consecutive tool failures in recent ticks
  | 'no_progress' // multiple ticks with no measurable progress
  | 'token_blowup' // token usage spiked beyond expected budget
  | 'repair_storm' // repair ticks consumed a high fraction of the budget
  | 'stuck_loop'; // same no-progress hash across consecutive ticks

/** Severity of the detected anomaly. Guides reviewer attention, not action. */
export type AnomalySeverity = 'low' | 'medium' | 'high';

/**
 * Classified anomaly pattern. Injected into MissionReviewerInput as an OPTIONAL
 * advisory field — the Mission reviewer may ignore it entirely (observe-only
 * honesty, §9.1).
 */
export type AnomalyPattern = {
  kind: AnomalyPatternKind;
  severity: AnomalySeverity;
  /** Human-readable summary of the signals that triggered this classification. */
  evidenceSummary: string;
  /** Suggested reviewer attention area. NOT an action directive. */
  suggestedAttention?: string;
  /** Tick at which the anomaly was detected. */
  detectedAtTick: number;
};

/**
 * Input to `classifyAnomalyPattern`. Drawn from fields available in
 * `MissionReviewerInput` + lightweight session metrics. No external lookups.
 */
export type AnomalyClassifierInput = {
  tick: number;
  repairTicksUsed: number;
  maxRepairTicks: number;
  maxTicks: number;
  /** Recent failure descriptions (e.g., from `MissionReviewerInput.failures`). */
  failures?: readonly string[];
  /** Count of consecutive tool failures in the recent window. */
  recentToolFailureCount?: number;
  /** Token usage for the current tick (or recent window). */
  tokenUsage?: { input: number; output: number; total: number };
  /** Token budget for reference (e.g., from A5 ContextBudgetPlan). */
  tokenBudget?: number;
  /** No-progress hash from the current tick (from MissionRunRecord). */
  noProgressHash?: string;
  /** No-progress hash from the previous tick — equal hash ⇒ stuck. */
  previousNoProgressHash?: string;
};

// Thresholds — tuned conservatively to avoid false positives. These are
// pure-function constants; no runtime configuration (that would be a side channel).
const TOOL_FAILURE_BURST_THRESHOLD = 3;
const NO_PROGRESS_TICK_THRESHOLD = 2; // 2+ ticks with same hash
const NO_PROGRESS_MAX_TICKS_RATIO = 0.25; // P2 fix: detect no_progress at 25% of maxTicks (was 50%)
const TOKEN_BLOWUP_RATIO = 1.5; // actual > 1.5 × budget
const REPAIR_STORM_RATIO = 0.6; // repairTicksUsed > 0.6 × maxRepairTicks

/**
 * Classify recent signals + session metrics into an `AnomalyPattern | null`.
 *
 * Pure: deterministic, no side effects. Returns `null` when no anomaly is
 * detected. The caller (Mission reviewer wiring) is responsible for injecting
 * the result into `MissionReviewerInput.anomalyPattern?`.
 *
 * Detection order: highest-severity patterns checked first. The first match
 * wins — we do NOT return multiple patterns (keeps reviewer input simple).
 *
 * Flag-off parity: when this function is not called (A3 flag off), or when it
 * returns `null`, `MissionReviewerInput.anomalyPattern` is `undefined` and the
 * reviewer behaves exactly as before.
 */
export function classifyAnomalyPattern(
  input: AnomalyClassifierInput,
): AnomalyPattern | null {
  const {
    tick,
    repairTicksUsed,
    maxRepairTicks,
    maxTicks,
    failures,
    recentToolFailureCount,
    tokenUsage,
    tokenBudget,
    noProgressHash,
    previousNoProgressHash,
  } = input;

  // 1. Tool failure burst — highest priority (signals immediate breakage).
  const failureCount = recentToolFailureCount ?? failures?.length ?? 0;
  if (failureCount >= TOOL_FAILURE_BURST_THRESHOLD) {
    return {
      kind: 'tool_failure_burst',
      severity: failureCount >= TOOL_FAILURE_BURST_THRESHOLD * 2 ? 'high' : 'medium',
      evidenceSummary: `${failureCount} consecutive tool failures detected at tick ${tick}`,
      suggestedAttention: 'Reviewer should consider whether tool failures indicate a systemic issue',
      detectedAtTick: tick,
    };
  }

  // 2. Stuck loop — same no-progress hash across consecutive ticks.
  if (
    noProgressHash !== undefined &&
    previousNoProgressHash !== undefined &&
    noProgressHash === previousNoProgressHash &&
    noProgressHash !== ''
  ) {
    return {
      kind: 'stuck_loop',
      severity: 'medium',
      evidenceSummary: `No-progress hash "${noProgressHash}" unchanged from previous tick`,
      suggestedAttention: 'Reviewer should consider whether the task is stuck in a loop',
      detectedAtTick: tick,
    };
  }

  // 3. Repair storm — repair ticks consuming too much of the budget.
  if (maxRepairTicks > 0 && repairTicksUsed / maxRepairTicks >= REPAIR_STORM_RATIO) {
    return {
      kind: 'repair_storm',
      severity: repairTicksUsed >= maxRepairTicks ? 'high' : 'medium',
      evidenceSummary: `${repairTicksUsed}/${maxRepairTicks} repair ticks used (${Math.round(
        (repairTicksUsed / maxRepairTicks) * 100,
      )}% of budget)`,
      suggestedAttention: 'Reviewer should consider whether repeated repairs indicate a deeper issue',
      detectedAtTick: tick,
    };
  }

  // 4. Token blowup — actual usage far exceeds budget.
  if (
    tokenUsage !== undefined &&
    tokenBudget !== undefined &&
    tokenBudget > 0 &&
    tokenUsage.total / tokenBudget >= TOKEN_BLOWUP_RATIO
  ) {
    return {
      kind: 'token_blowup',
      severity: tokenUsage.total >= tokenBudget * 2 ? 'high' : 'medium',
      evidenceSummary: `Token usage ${tokenUsage.total} exceeds budget ${tokenBudget} by ${Math.round(
        (tokenUsage.total / tokenBudget) * 100,
      )}%`,
      suggestedAttention: 'Reviewer should consider whether token usage is justified or out of control',
      detectedAtTick: tick,
    };
  }

  // 5. No progress — multiple ticks with no measurable progress.
  // (Detected via tick count relative to maxTicks with no progress hash change;
  //  more conservative than stuck_loop because it does not require hash equality.)
  // P2 fix: lowered threshold from maxTicks * 0.5 to maxTicks * 0.25 to detect
  // early stuck states instead of waiting until the halfway mark.
  if (tick >= NO_PROGRESS_TICK_THRESHOLD && tick >= maxTicks * NO_PROGRESS_MAX_TICKS_RATIO && failures && failures.length === 0) {
    // Only flag if we're past the halfway mark and there are no failures to
    // explain the lack of progress.
    return {
      kind: 'no_progress',
      severity: 'low',
      evidenceSummary: `Tick ${tick}/${maxTicks} with no failures and no measurable progress`,
      suggestedAttention: 'Reviewer should consider whether the task needs re-scoping',
      detectedAtTick: tick,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Stage 1 Stream 1B wiring: flag-gated seam for Mission reviewer injection.
//
// `resolveAnomalyPatternForReviewer` is called by mission-control/controller.ts
// before invoking `runMissionReviewer`. It is the ONLY sanctioned call site for
// `classifyAnomalyPattern` in production code.
//
// Flag-off parity (acceptance 1.8): when
// `runtime.resilience.anomalyClassifierPilot !== 'shadow'`, returns
// `undefined` — `MissionReviewerInput.anomalyPattern` stays undefined and the
// reviewer behaves exactly as before.
// ---------------------------------------------------------------------------

/**
 * Flag-gated seam: resolve the `anomalyPattern` field for
 * `MissionReviewerInput`. Returns `undefined` when the pilot is off (flag-off
 * parity), or the result of `classifyAnomalyPattern` (which may be `null`)
 * when the pilot is in 'shadow' mode.
 *
 * @param featureFlags  The `runtime` feature flags from OpenClawConfig.
 * @param input  The classifier input (drawn from controller state).
 * @returns `undefined` (pilot off) or `AnomalyPattern | null` (pilot shadow).
 */
export function resolveAnomalyPatternForReviewer(
  featureFlags: RuntimeFeatureConfig | undefined,
  input: AnomalyClassifierInput,
): AnomalyPattern | null | undefined {
  const mode = featureFlags?.resilience?.anomalyClassifierPilot;
  if (mode !== 'shadow') {
    // Default-off: pilot not active. anomalyPattern stays undefined.
    return undefined;
  }
  // Shadow mode: classify and return (may be null when no anomaly detected).
  return classifyAnomalyPattern(input);
}
