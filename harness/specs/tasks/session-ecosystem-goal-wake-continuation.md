---
id: session-ecosystem-goal-wake-continuation
title: Session ecosystem goal-wake continuation, cancel cascade and cron continuation payload
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Retroactively declare the TF-0083 workstream (created 2026-08-23 by TF-0088 after the independent health audit finding FP-12 showed the whole node shipped without a spec). TF-0083 delivered goal/loop conditional wake, cancel cascade and timed continuation - flow budget accounting over non-terminal rows only, mission.cancel cascading helper/task/flow/continuation to terminal truth, three trigger kinds (process/child/timer) converging on one typed MissionContinuation with durable dedup, cron missionContinuation payload plumbing, and wait_json.timeoutMs enforcement.
touchedAreas:
  - harness/specs/tasks/session-ecosystem-goal-wake-continuation.md
  - openclaw_runtime/src/agents/goal-wake-arm.ts
  - openclaw_runtime/src/agents/goal-wake-cancel.ts
  - openclaw_runtime/src/agents/goal-wake-cancel.test.ts
  - openclaw_runtime/src/agents/goal-wake-dispatch.ts
  - openclaw_runtime/src/agents/goal-wake-fencing.ts
  - openclaw_runtime/src/agents/goal-wake-runtime.ts
  - openclaw_runtime/src/agents/goal-wake-runtime.test.ts
  - openclaw_runtime/src/agents/goal-wake-timeout.ts
  - openclaw_runtime/src/agents/goal-wake-timeout.test.ts
  - openclaw_runtime/src/agents/goal-wake-timer.ts
  - openclaw_runtime/src/agents/goal-wake-triggers.test.ts
  - openclaw_runtime/src/agents/goal-wake-types.ts
  - openclaw_runtime/src/agents/mission-control/types.ts
  - openclaw_runtime/src/gateway/server-methods/mission-control-methods.ts
  - openclaw_runtime/src/gateway/server-cron.ts
  - openclaw_runtime/src/cron/types.ts
  - openclaw_runtime/src/cron/normalize.ts
  - openclaw_runtime/src/cron/persisted-shape.ts
  - openclaw_runtime/src/cron/service/state.ts
  - openclaw_runtime/src/cron/service/timer.ts
  - openclaw_runtime/src/cron/store/payload-codec.ts
  - openclaw_runtime/src/cron/mission-continuation-payload.test.ts
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - After consecutive flows exhaust the default budget, a new wait can still be armed because budget accounting counts active rows only, never historical terminal rows.
  - mission.cancel drives helper, task, flow, and continuation owners to durable terminal truth before OS/helper cleanup, with no further ticks afterwards; failure fails closed.
  - Process, child, and timer triggers each produce at most one deduplicated continuation; wake delivery is at-least-once with durable effect dedup, never exactly-once tick claims.
  - wait_json.timeoutMs is enforced by the overdue sweep; timeout expires waits through the normal level-check path instead of behaving like cancel.
  - Goal-wake and durable helper stay default-off until the real-process gate passes; child/timer arm surfaces are intentionally unmounted (opt-in boundary, owner decides the mount point).
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-lifecycle-governance-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/session-ecosystem-goal-wake-continuation.md
  - pnpm harness validate --spec harness/specs/tasks/session-ecosystem-goal-wake-continuation.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/goal-wake-cancel.test.ts src/agents/goal-wake-durable-cleanup.test.ts src/agents/goal-wake-helper-host.test.ts src/agents/goal-wake-helper-protocol.test.ts src/agents/goal-wake-recovery.test.ts src/agents/goal-wake-runtime.test.ts src/agents/goal-wake-timeout.test.ts src/agents/goal-wake-triggers.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.cron.config.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - Flow budget counts active rows only; historical terminal rows never block a new wait (regression-fenced by the goal-wake shard).
  - Cancel and timeout write durable terminal truth before OS/helper cleanup; failure fails closed.
  - The three trigger kinds converge on one typed MissionContinuation; duplicate wake delivery causes no duplicate side effects (durable CAS dedup on mission_runs revision).
  - The cron missionContinuation payload carries task and mission identity only and strips instruction-bearing fields on normalize.
  - No second scheduler authority; goal-wake/durable-helper defaults remain off.
docs:
  required: true
  files:
    - docs/dev/handoffs/LATEST.md
---

# Session ecosystem goal-wake continuation (TF-0083 declaration)

This spec was created retroactively by TF-0088 (audit remediation step 2) because the
TF-0083 workstream shipped without any harness spec: the independent health audit
(FP-12, major) found that `goal-wake-arm/cancel/dispatch/fencing/runtime/timeout/timer/triggers`
and the cron `missionContinuation` modules appeared in no `touchedAreas` declaration,
which made the TF-0078 chain impossible to accept independently on its declared boundary.

Declared boundary notes:

- `openclaw_runtime/src/agents/mission-control/types.ts` is co-owned with the TF-0082
  cross-session-control spec (lineage hunks there, `wakePayload?: MissionContinuation` here).
- Child/timer arm surfaces (`fireGoalWaitChild`, `armGoalWaitTimer`) are implemented and
  unit-tested but intentionally unmounted in production (opt-in boundary recorded in the
  TF-0083 deviations and `docs/dev/handoffs/LATEST.md:163-168`). `fireGoalWaitTimer` is
  mounted at `openclaw_runtime/src/gateway/server-cron.ts` behind the goal-wake flag.
- `openclaw_runtime/src/gateway/server-methods/mission-control-methods.ts` may carry
  hunks from other workstreams; only the `mission.cancel` cascade and `mission.resume`
  level-check hunks belong to TF-0083.
