---
id: a5-adaptive-context-budget-pilot
title: A5 Adaptive Context Budget — Active Pilot Gate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Promote the A5 context budget planner from shadow to active pilot, gated by plan adoption rate and budget compliance.
touchedAreas:
  - openclaw_runtime/src/agents/cross-area/cross-area-facades.ts
  - openclaw_runtime/src/agents/resource-aware-wave-scheduler.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/observability/deprecation-counters.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
requiredTests:
  - tests/unit/cross-area-composition.test.ts
  - tests/unit/resource-aware-wave-scheduler.test.ts
  - tests/unit/performance-budgets.test.ts
acceptance:
  - A5 deprecation counter `planIgnoredCount` rate ≤ 20% over 100-turn session
  - A5 p99 ≤ 30ms (criterion 4.8)
  - `ContextBudgetPlanner.replanOnResume` re-executes on resume, not stale (criterion 3.6)
  - Wave immutability: started waves not re-planned (criterion 3.9)
  - Budget violation response `degrade_to_default_budget` triggers when ignored rate > 20%
docs:
  required: true
---

## Graduation gate

A5 graduates from shadow to active pilot when ALL of the following hold:

1. **Plan adoption rate** ≥ 80%: `planAdoptedCount / (adopted + ignored) ≥ 0.80`.
2. **Performance**: p99 ≤ 30ms for 100-turn session (criterion 4.8).
3. **Resume re-execution**: planner re-executes on resume, not stale (criterion 3.6).
4. **Wave immutability**: started waves not re-planned (criterion 3.9).
5. **Budget violation response**: `degrade_to_default_budget` triggers when ignored > 20% (criterion 4.14).
6. **Per-turn cumulative budget**: p99 ≤ 300ms with A1+A5+A3 active (criterion 4.10).

## Out of scope

- Dynamic degradation order shifting (OQ-012, Stage 5).
- Per-area memory budget allocation (OQ-011, Stage 5).
