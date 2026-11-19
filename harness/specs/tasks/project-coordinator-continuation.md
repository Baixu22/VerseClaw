---
id: project-coordinator-continuation
title: TF-0677 Project continuation, restart recovery and coordinator fencing
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: ecaffd3da
intent: Recover projects from durable worker completion or an interrupted run, with writer fencing, effect reconciliation and independent stop controls.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - comms-regression
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - openclaw_runtime/src/agents/subagent-announce*.ts
  - openclaw_runtime/src/agents/subagent-registry-lifecycle.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/subagent-registry-owners.recovery.test.ts
  - openclaw_runtime/src/agents/goal-wake-triggers.test.ts
  - openclaw_runtime/src/gateway/server-methods/agent*.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/agent.ts
  - shared/task-system/project-coordinator.ts
  - shared/task-system/store.ts
  - electron/services/task-system-service.ts
  - tests/unit/durable-task-system.test.ts
  - tests/e2e/project-agent-loop.spec.ts
  - tests/e2e/long-session-completion-continuation.spec.ts
  - harness/specs/tasks/project-coordinator-continuation.md
  - harness/specs/scenarios/autonomous-project-system.md
  - harness/specs/rules/durable-task-system-boundary.md
  - harness/specs/fixtures/autonomous-project-system/p3/**
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
expectedUserBehavior:
  - A settled worker wakes its original project coordinator without another user message.
  - A completion retains its spawn generation through retries and restart. A replacement coordinator never consumes it.
  - Handoff waits for pending task effects; the successor resumes from the retained checkpoint. A late completion cannot wake the retired source.
  - Gateway restart recovery reuses the current task and checkpoint when the prior process has exited and no task effects remain unsettled.
  - A user-paused coordinator can stop its current run, cancel its task and reconcile existing effects while new project dispatch is paused.
requiredTests:
  - pnpm exec vitest run tests/unit/durable-task-system.test.ts
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents-core.config.ts src/agents/goal-wake-triggers.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e tests/e2e/project-agent-loop.spec.ts tests/e2e/long-session-completion-continuation.spec.ts
acceptance:
  - Persist and pass the original requester generation; never derive an old completion pin from a newer child run.
  - Reject generation changes at delivery and again inside the atomic session update before agent ingress.
  - Terminal stale completions persist a failed delivery and stop retries; late completion cannot write a replacement generation.
  - Check the Workspace owner's handoff state at completion delivery and before Gateway ingress. Preserve the source transcript and transfer the task checkpoint under a new writer epoch.
  - Atomically replace an interrupted run under the current writer epoch only after verifying process exit, an executing task, and zero started or unknown effects. Retain the process and run identities in the Task Ledger event.
  - Reject unknown-effect replay before calling the model. Resume the original task only after a matching effect owner receipt settles the operation exactly once.
  - Pause rejects new dispatch without stopping an active run. Stopping it retains the task checkpoint. Cancellation waits for its pending effects, refuses old generations and never makes the cancelled child eligible again.
  - A burst of duplicate goal-wake timer fires records one mission tick. Reopening its ledger does not re-fire it.
  - Verify durable deduplication, idle continuation, cancellation, restart and unknown-effect reconciliation on the same candidate before closing TF-0677.
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

The subagent registry owns completion persistence and retry limits. Gateway owns session generation checks, Workspace owns coordinator handoff state, and Task Ledger owns task acceptance and writer claims. A completion notification grants neither a new task claim nor task acceptance.
