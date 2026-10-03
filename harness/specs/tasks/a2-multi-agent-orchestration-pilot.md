---
id: a2-multi-agent-orchestration-pilot
title: A2 Multi-Agent Orchestration — Active Pilot Gate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Promote the A2 wave scheduler from shadow to active pilot, gated by deferral consistency and budget compliance.
touchedAreas:
  - openclaw_runtime/src/agents/resource-aware-wave-scheduler.ts
  - openclaw_runtime/src/agents/cross-area/cross-area-facades.ts
  - openclaw_runtime/src/observability/deprecation-counters.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
expectedUserBehavior:
  - With the A2 pilot gate enabled, wave planning defers consistently and the deferral-disagreement counter stays under the 10% graduation budget.
  - A wave that has already started is never re-planned; the scheduler rejects the re-plan request instead of silently reordering running work.
  - Resuming a multi-worker orchestration creates new child sessions rather than reconnecting to finished ones.
  - When the disagreement rate exceeds 10%, the pilot responds with `degrade_to_live_only` instead of continuing to schedule.
  - With the pilot flag off, wave scheduling and orchestration outcomes are unchanged.
requiredTests:
  - tests/unit/resource-aware-wave-scheduler.test.ts
  - tests/unit/cross-area-composition.test.ts
  - tests/unit/performance-budgets.test.ts
acceptance:
  - A2 deprecation counter `deferralDisagreementCount` rate < 10% over 10-wave orchestration
  - A2 p99 ≤ 80ms (criterion 4.6)
  - `ResourceAwareWaveScheduler` rejects re-plan of started waves (criterion 3.9)
  - Multi-worker resume creates new sessions (criterion 3.7)
  - Budget violation response `degrade_to_live_only` triggers when disagreement > 10%
docs:
  required: true
---

## Graduation gate

A2 graduates from shadow to active pilot when ALL of the following hold:

1. **Deferral agreement rate** ≥ 90%: `deferralAgreementCount / (agreement + disagreement) ≥ 0.90` over 10 waves.
2. **Wave immutability**: started waves are never re-planned (criterion 3.9, unit-tested).
3. **Performance**: p99 ≤ 80ms for 10-wave orchestration (criterion 4.6).
4. **Multi-worker resume**: creates new child sessions, no reconnect (criterion 3.7).

## Out of scope

- Session migration / reconnect (OQ-010, Stage 5).
- Dynamic worker count per-wave (Stage 5 optimization).
