---
lifecycleStatus: active
id: unified-active-workspace-config
title: Preserve the active project directory during concurrent runtime configuration updates
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 4fd6335bc5467912436fcb08b3461294711a99df
intent: Serialize workspace directory and permission updates with the existing OpenClaw configuration owner before a scheduled task starts.
ownedPaths: &paths
  - electron/services/workspace-runtime-sync.ts
  - tests/unit/workspace-runtime-sync.test.ts
  - tests/e2e/session-task-scope-completion.spec.ts
  - harness/specs/tasks/unified-active-workspace-config.md
  - harness/specs/rules/autonomy-session-task-scope-boundary.md
  - harness/specs/scenarios/autonomy-session-task-scope.md
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
touchedAreas: *paths
requiredRules:
  - backend-communication-boundary
  - autonomy-session-task-scope-boundary
  - local-data-fail-closed-config
  - active-config-guards
  - docs-sync
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - The active project's directory and permission policy remain in the runtime configuration after model settings are saved.
  - Scheduled execution uses that project's directory while preserving its coordinator session.
acceptance:
  - Directory and permission synchronization hold the existing configuration mutex while reading the current workspace and performing their read-modify-write cycle.
  - A competing model update preserves the latest workspace directory, permission policy and selected model in the final configuration.
  - The scheduled Electron journey reads back the effective runtime directory before triggering its original tool effect and retains the original timeout, task identity and coordinator assertions.
  - Missing or stale task scopes continue to reject effects through their existing owners.
requiredTests:
  - pnpm exec vitest run tests/unit/workspace-runtime-sync.test.ts tests/unit/atomic-config-write-p5-001.test.ts tests/unit/r0-2-models-json-lock.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/session-task-scope-completion.test.ts tests/unit/host-services.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec playwright test tests/e2e/session-task-scope-completion.spec.ts --workers=1 --retries=0
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/unified-active-workspace-config.md
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

This change completes the current G5 task-scope acceptance. The original 73-case
plan retains its identities, failure records and native cleanup receipts.
