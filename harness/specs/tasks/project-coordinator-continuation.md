---
id: project-coordinator-continuation
title: TF-0677 Project completion continuation and coordinator fencing
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: ecaffd3da
intent: Resume the current coordinator from durable child completion while fencing stale generations and retired handoff sources before delivery or agent dispatch.
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
  - openclaw_runtime/src/gateway/server-methods/agent*.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/agent.ts
  - shared/task-system/project-coordinator.ts
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
requiredTests:
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e tests/e2e/project-agent-loop.spec.ts tests/e2e/long-session-completion-continuation.spec.ts
acceptance:
  - Persist and pass the original requester generation; never derive an old completion pin from a newer child run.
  - Reject generation changes at delivery and again inside the atomic session update before agent ingress.
  - Terminal stale completions persist a failed delivery and stop retries; late completion cannot write a replacement generation.
  - Check the Workspace owner's handoff state at completion delivery and before Gateway ingress. Preserve the source transcript and transfer the task checkpoint under a new writer epoch.
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
