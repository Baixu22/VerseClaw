---
lifecycleStatus: active
id: gateway-startup-reload-revision
title: Consume only configuration reloads covered by a successful Gateway launch
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 7f61ee700255b59e020ee54db219da0a0e542718
intent: Keep startup configuration refreshes from restarting a newly ready Gateway while preserving later reloads and explicit restarts.
ownedPaths: &paths
  - electron/gateway/manager.ts
  - electron/gateway/restart-controller.ts
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/e2e/session-task-scope-completion.spec.ts
  - harness/specs/tasks/gateway-startup-reload-revision.md
  - harness/specs/tasks/unified-acceptance-fixture-refresh.md
  - harness/specs/rules/gateway-readiness-policy.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
touchedAreas: *paths
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
  - docs-sync
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - A newly ready Gateway keeps running when its launch already included queued configuration reloads.
  - Later configuration changes and explicit restart requests execute after the current startup settles.
acceptance:
  - A monotonic request revision is captured before launch configuration is read; only a successful launch can consume the unchanged reload-only queue.
  - Reloads after capture, explicit restarts, failed starts and attachment to existing processes retain unresolved refresh requests.
  - Requests queued during an explicit restart are flushed after its in-flight promise settles.
  - An explicit stop supersedes pending restart phases through the existing lifecycle epoch, including startup failure recovery, without recording a successful restart.
  - The original task-scope and coordinator Electron journeys retain their assertions, case identities and timeouts.
requiredTests:
  - pnpm exec vitest run tests/unit/gateway-manager-restart-recovery.test.ts tests/unit/gateway-restart-cooldown-fp-p1-12.test.ts tests/unit/gateway-manager-reload-policy-refresh.test.ts tests/unit/gateway-process-policy.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/session-task-scope-completion.spec.ts tests/e2e/long-session-coordination.spec.ts --workers=1 --retries=0
  - pnpm harness validate --spec harness/specs/tasks/gateway-startup-reload-revision.md
  - pnpm harness run --spec harness/specs/tasks/gateway-startup-reload-revision.md --dry-run
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

This repair continues the existing G5 acceptance on TF-0867. Historical failures
remain attached to their original candidates; the repaired candidate is verified
with fresh build and native process receipts.
