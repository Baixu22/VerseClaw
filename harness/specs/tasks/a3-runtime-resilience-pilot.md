---
lifecycleStatus: archived
id: a3-runtime-resilience-pilot
title: A3 Runtime Resilience — Active Pilot Gate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Promote the A3 anomaly classifier from shadow to active pilot, gated by anomaly detection quality and budget compliance.
touchedAreas:
  - openclaw_runtime/src/agents/anomaly-classifier.ts
  - openclaw_runtime/src/agents/mission-control/controller.ts
  - openclaw_runtime/src/observability/deprecation-counters.ts
  - openclaw_runtime/src/config/types.openclaw.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
expectedUserBehavior:
  - Mission reviewers may receive anomaly context only when the pilot gate is enabled and the anomaly signal stays within the false-positive budget.
  - When the pilot flag is off, Mission review behavior and terminal decisions are unchanged.
  - When anomaly rate or reviewed false positives exceed the budget, anomaly guidance is omitted and the reviewer follows the default decision path.
  - A3 never changes the terminal Mission decision by itself; it only augments reviewer context.
  - Documentation/runtime drift is handled by keeping the existing Mission flow runnable and recording the mismatch, not by broad code reshaping in this gate.
requiredTests:
  - tests/unit/performance-budgets.test.ts
acceptance:
  - A3 deprecation counter `anomalyNonNullCount` rate ≤ 20% over 100 Mission ticks
  - A3 p99 ≤ 15ms (criterion 4.7)
  - `resolveAnomalyPatternForReviewer` returns `undefined` when flag off (flag-off parity)
  - `resolveAnomalyPatternForReviewer` returns `AnomalyPattern | null` when flag in 'shadow' mode
  - Budget violation response `degrade_to_default_decision` triggers when anomaly rate > 20%
docs:
  required: true
---

## Graduation gate

A3 graduates from shadow to active pilot when ALL of the following hold:

1. **Anomaly detection rate** ≤ 20%: `anomalyNonNullCount / totalMissionTicks ≤ 0.20` over 100 ticks. Higher rates indicate false positives.
2. **Performance**: p99 ≤ 15ms for 100 Mission ticks (criterion 4.7).
3. **Flag-off parity**: `resolveAnomalyPatternForReviewer` returns `undefined` when `runtime.resilience.anomalyClassifierPilot !== 'shadow'`.
4. **Budget violation response**: `degrade_to_default_decision` triggers when rate > 20% (criterion 4.14).

## False-positive interpretation

The `anomalyNonNullCount` rate is a false-positive proxy, not proof by itself.
A non-null anomaly is treated as potentially false-positive until the next
review tick shows one of these confirming signals:

- the same anomaly kind persists across a later reviewer/self-check result;
- validation state worsens or remains missing without user-approved scope
  change;
- the Mission asks the user, repairs, or blocks for a matching reason;
- the operator confirms the anomaly in the sampled review packet.

False-positive review packet:

- Include every non-null anomaly when fewer than 20 exist, otherwise sample at
  least 20 across anomaly kind, source, and Mission phase.
- Mark each sample as `confirmed`, `false_positive`, or `ambiguous`.
- Count cancelled, user-paused, budget-exhausted, or no-validation sessions as
  `ambiguous`, not false positives or true positives.
- Any anomaly kind with repeated false positives is demoted to shadow-only until
  the classifier rule is tightened and the 100-tick gate is rerun.

Active pilot limits:

- A3 may only augment reviewer context; it must not change the terminal Mission
  decision by itself.
- If the non-null rate exceeds 20% or reviewed false positives exceed the gate
  budget, the system must use `degrade_to_default_decision` and omit anomaly
  guidance from the reviewer payload.
- If full-run validation reveals unrelated stitched-system failures, this gate
  records the incompatibility and stays in shadow/default behavior rather than
  expanding scope to repair broad architecture drift.

## Out of scope

- Replacing Mission Control's default decision logic (only augmentation).
- `anomalyPattern` null vs undefined semantic documentation (OQ-003, non-blocking).
