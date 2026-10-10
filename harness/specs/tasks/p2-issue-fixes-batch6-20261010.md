---
id: p2-issue-fixes-batch6-20261010
title: P2 issue batch 6 - admission fence bounds and reclamation, CVK rollback honesty
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close two open [P2] issues (#102, #150) with bounded lifecycle waits and an honest rollback declaration, and carry a stale judge-rule comment fix; #144 is deferred with a verified verification recipe.
touchedAreas:
  - openclaw_runtime/src/sessions/**
  - openclaw_runtime/src/gateway/session-reset-service.ts
  - openclaw_runtime/src/context-engine/cvk/**
  - tests/unit/**
  - harness/specs/tasks/**
  - docs/dev/p2-issue-fixes-batch6-20261010.md
  - scripts/repository-artifacts.json
expectedUserBehavior:
  - A session lifecycle fence that cannot drain fails within its budget and stays closed instead of hanging or silently reopening the session.
  - Idle admission entries are reclaimed under a capacity bound while deleted-generation tombstones keep rejecting.
  - The CVK recovery result no longer claims an available legacy transcript replay rollback that no consumer can execute.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-lifecycle-governance.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --maxWorkers=1
  - node node_modules/vitest/vitest.mjs run --config openclaw_runtime/vitest.config.ts src/sessions/session-admission-registry.test.ts src/sessions/session-admission-registry-reclamation.test.ts src/gateway/session-reset-service.stop.test.ts src/gateway/session-reset-service.subagent-stop.test.ts src/gateway/session-drain-service.test.ts src/gateway/server-methods/sessions.send-permit-lifetime.test.ts src/agents/goal-wake-durable-cleanup.test.ts src/agents/agent-hooks/compaction-addressability.test.ts
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p2-issue-fixes-batch6-20261010.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - Issue #102 - `fence()` waits on release events with an explicit budget (defaulting to the session drain budget) and an optional caller abort signal; a fence that cannot drain throws an identifiable wait error, stays closed, and cannot be reopened by a stale release, so a deleted generation still rejects; idle entries are reclaimable through a capacity bound and an explicit sweep while closed fences, in-flight permits and parked waiters are never dropped; the registry exposes entry/active/fenced/waiter counters plus observed wait timing.
  - Issue #150 - the CVK recovery rollback declaration is a discriminated state whose `available: true` member requires naming the wired executor; every current producer returns `available: false` with an `unimplemented` strategy and a reason code, and no consumer-visible `ok`/projection/diagnostics behaviour changes.
  - Issue #144 is NOT closed by this change set: its evaluation suite cannot execute without a DeepSeek credential, and this batch makes no paid provider call. The verified cost-free verification recipe is recorded in the durable record and on the issue.
  - No product default, frozen lock or permission default changes; no paid provider call, real-model evaluation or human action is part of the verification.
docs:
  required: false
---

# P2 issue batch 6

Sixth batch of open `[P2]` issues on the private remote:

- **#102** `SessionAdmissionRegistry` never reclaimed idle entries and its
  `fence()` waited for in-flight permits with an unbounded `setImmediate` poll;
- **#150** the CVK recovery result declared
  `{ available: true, strategy: 'legacy_transcript_replay' }` although no
  consumer anywhere executes that strategy;
- **#144** (deferred, not closed here) the LoCoMo full-500 evaluation implements
  its cached and fresh retrieval paths as two ~1300-line mirrors. Its suite is
  gated behind `describe.skipIf(!hasDeepSeekKey() ...)`, so neither mode executes
  in this environment without a paid credential; the cost-free verification
  recipe is recorded for the next batch.

#102 changes the session lifecycle fence used by reset/delete/stop, so this spec
carries the `gateway-backend-communication` scenario. The host-api contract, the
IPC-only renderer transport, every permission default and every product lock are
unchanged. #150 is a declaration-honesty change plus its typed consumers' tests.

Verification is agent-driven (`driven_by: agent`); no paid provider call,
real-model evaluation or human action is claimed.
