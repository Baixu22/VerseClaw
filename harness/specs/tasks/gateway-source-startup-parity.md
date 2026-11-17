---
lifecycleStatus: active
id: gateway-source-startup-parity
title: Initialize source Gateway session methods in the normal startup path
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c03f11571
intent: Remove the source-only ten-minute initialization delay that leaves session RPCs unavailable in the production window lifecycle.
ownedPaths: &paths
  - electron/gateway/config-sync.ts
  - tests/unit/config-sync-source-runtime.test.ts
  - harness/specs/tasks/gateway-source-startup-parity.md
  - harness/specs/rules/gateway-readiness-policy.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
touchedAreas: *paths
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
  - active-config-guards
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - Source Gateway startup initializes the session runtime before serving session operations in both ordinary and test windows.
acceptance:
  - Source isolation does not force delayed startup sidecars or a ten-minute delay in ordinary desktop mode.
  - E2E and ordinary source launches receive the same isolation environment and retain separate config, home and state directories.
  - The production close-to-tray, continuation and restart journey passes with real Main and Gateway owners.
requiredTests:
  - pnpm exec vitest run tests/unit/config-sync-source-runtime.test.ts tests/unit/gateway-manager-restart-recovery.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/autonomy-host-readiness.spec.ts --workers=1 --retries=0
  - pnpm harness validate --spec harness/specs/tasks/gateway-source-startup-parity.md
  - pnpm harness run --spec harness/specs/tasks/gateway-source-startup-parity.md --dry-run
docs:
  required: true
  readmeTranslations: required
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

The normal runtime startup owner controls initialization. Source isolation only
selects the source profile and disables migration/update work for that profile.
