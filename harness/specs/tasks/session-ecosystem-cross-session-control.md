---
id: session-ecosystem-cross-session-control
title: Session ecosystem cross-session control and lineage unification
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close the TF-0082 gaps where cross-session control (send/steer/abort/stop/fork/continue) is not fully drivable over real Host API + Gateway RPC, late old-generation events can overwrite post-reset/fork session state, and lineage fields stay divergent across subagent/mission/flow/store owners.
touchedAreas:
  - harness/specs/tasks/session-ecosystem-cross-session-control.md
  - openclaw_runtime/src/agents/acp-spawn.ts
  - openclaw_runtime/src/agents/subagent-spawn.ts
  - openclaw_runtime/src/agents/mission-control/types.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-registry-run-manager.ts
  - openclaw_runtime/src/agents/subagent-announce-delivery.ts
  - openclaw_runtime/src/agents/subagent-announce-delivery.visible-reply.test.ts
  - openclaw_runtime/src/agents/subagent-announce-generation-pin.test.ts
  - openclaw_runtime/src/agents/subagent-announce.ts
  - openclaw_runtime/src/agents/subagent-control.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.queue-drain-generation.test.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.send-permit-lifetime.test.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity-projection.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity-projection.test.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.yield-state.test.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/agents/goal-wake-read.ts
  - openclaw_runtime/packages/gateway-protocol/src/index.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/types.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/protocol-schemas.ts
  - openclaw_runtime/src/process/supervisor/types.ts
  - openclaw_runtime/src/process/supervisor/supervisor.ts
  - openclaw_runtime/src/gateway/session-subagent-reactivation.ts
  - shared/host-api/contract.ts
  - shared/types/session-activity.ts
  - src/lib/host-api.ts
  - electron/gateway/manager.ts
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/runtime-lifecycle-governance.spec.ts
  - artifacts/session-ecosystem-cross-session-control/report.json
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A late completion from an old session generation never steers, wakes, or overwrites a post-reset/forked parent generation; stale generation overwrite count is 0.
  - Cross-session control actions validate requester ownership or operator scope before mutating another session.
  - Host API exposes typed stop/continue/fork surfaces backed by the same Gateway RPC handlers, not renderer-side raw passthrough only.
  - Parent-yield child completions deliver exactly once per parent generation; duplicates are idempotent no-ops.
  - UI, Host, and Runtime consume one lineage projection; session effects trace to sessionId/runId/parentSessionKey (ownerEpoch where the owner defines one).
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - runtime-lifecycle-governance-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/session-ecosystem-cross-session-control.md
  - pnpm harness validate --spec harness/specs/tasks/session-ecosystem-cross-session-control.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/subagent-announce-delivery.visible-reply.test.ts src/agents/subagent-announce-generation-pin.test.ts src/agents/bash-tools.exec-generation-guard.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.config.ts src/agents/subagent-spawn.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-methods.config.ts src/gateway/server-methods/sessions.stop.test.ts src/gateway/server-methods/sessions.queue-drain-generation.test.ts src/gateway/server-methods/sessions.send-permit-lifetime.test.ts src/gateway/server-methods/session-activity-projection.test.ts src/gateway/server-methods/sessions.yield-state.test.ts
  - pnpm exec vitest run tests/unit/host-api-facade.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e:run tests/e2e/runtime-lifecycle-governance.spec.ts
  - git diff --check
acceptance:
  - A late old-generation child completion cannot steer or wake a post-reset/forked parent generation (regression-fenced).
  - Cross-session control handlers keep requester ownership/operator-scope validation; no unauthorized cross-agent control is introduced.
  - Host API typed surfaces exist for stop/continue/fork and delegate to the same Gateway RPC handlers.
  - Parent-yield completions produce exactly one continuation per generation; replay is an idempotent no-op.
  - The session-activity lineage remains the single projection; no second session identity source is introduced.
  - No new workflow engine; no synthetic evidence upgraded to live-ready.
docs:
  required: true
  files:
    - docs/dev/handoffs/LATEST.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# Session ecosystem cross-session control and lineage unification

This is the single TF-0082 implementation slice. It makes cross-session control
safe and drivable end-to-end and unifies lineage around the existing owners.
It does not introduce a workflow engine, does not open unauthorized
cross-agent control, and does not change product approval states.

## Scope

- Existing owners stay authoritative: gateway method handlers, subagent
  registry, admission registry, session store, and the Phase 5 lineage
  projection.
- Owner path 1: generation-pin the subagent announce wake — record the parent
  sessionId at spawn and require it to match before a completion may steer the
  requester session.
- Owner path 2: typed Host API session stop surface delegating to the existing
  `sessions.stop` Gateway RPC.
- Owner path 3: `expectedSessionId` generation guard for queue drain, fail
  closed at both the RPC handler and the drain executor.
- Owner path 4: the send/steer admission permit spans the whole run-start
  window (steer interrupt, transcript seq read, chat.send preamble) and is
  released exactly once when the run is armed or the send fails.
- Owner path 5: lineage runId join — every projected goal, process, and
  lineage row carries one shared correlation ref (sessionId / runId /
  parentSessionKey / ownerEpoch / missionId) copied from the owner that
  already records it, so mission, goal-wake flow, and goal-owned process
  resolve to the same identity without a second identity source.
- Owner path 6: read-only `sessions.yieldState` RPC (`operator.read`) reporting
  the paused-parent and armed-goal-wait state, plus a `yielded` lineage/subagent
  status so a normal yield is no longer reported as an error. Arming stays
  tool-only: both `sessions_yield` and `goal_wait` bind mission/tick/turn
  identity from the live run context, so no arm/cancel mutation RPC is added.

## Failure matrix

The focused matrix must cover, at minimum:

| Case | Required result |
| --- | --- |
| child completes; parent reset to a new generation; late announce wake | no steer to the new generation |
| child completes; same parent generation active | steer/wake proceeds once |
| duplicate announce delivery for the same child run | idempotent no-op |
| cross-session send/steer/abort/stop/fork over real RPC | ownership/scope validated, distinct semantics preserved |
| queue drain after reset | only current-generation queued messages seed the new run |
| reset/delete fence racing an in-flight send/steer | the fence cannot drain until the run is armed; no run is seeded on a stale generation |
| parent paused by sessions_yield, children still running | reported as `yielded` with the pending-child count, never as an error |
| lineage lookup for a forked/parented session | parentSessionKey/forkedFromParent traceable |
| old-generation backgrounded exec exits after reset (TF-0087) | exit notification and heartbeat wake are dropped for the new generation; pass-through when the pinned or current generation is unresolved (never a silent loss on unreadable store) |

## Declared cross-generation exceptions (TF-0087)

These paths deliberately keep liveness-only delivery and are declared instead of
guarded; they are not counted against `stale generation overwrite`:

- Detached task terminal/blocked notifications (`tasks/task-registry.ts`): delivery
  follows the stable owner key by design (tasks survive session reset and process
  restart; `background-task` is a first-class heartbeat wake source). Risk boundary is
  notification content, not state overwrite.
- `emitExecSystemEvent` (currently zero callers): any future caller must bring its own
  generation pin.
- Subagent-announce requester-agent handoff after a generation-pin mismatch (documented
  TF-0082 design choice: handoff may deliver without waking the new generation).
- Restart-sentinel degraded wake on generation mismatch; the `systemEvent` continuation
  branch is a defensive dead branch today and any future systemEvent continuation writer
  must add a generation field and guard first.
- ACP parent-stream relay events (weak reachability; guard direction, if ever needed, is
  pinning the parent generation at relay registration).

## Non-goals

- No new workflow engine.
- No cross-agent control without explicit operator authorization.
- No synthetic evidence claimed as live-ready.
- No second lineage/identity source beside the session-activity projection.
