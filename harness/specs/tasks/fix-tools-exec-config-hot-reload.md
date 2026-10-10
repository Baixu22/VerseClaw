---
lifecycleStatus: archived
id: fix-tools-exec-config-hot-reload
title: Apply tools.exec configuration through Gateway hot reload
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Refresh the active runtime config when tools settings change so new agent tool instances use the updated exec policy without a full Gateway restart.
touchedAreas:
  - harness/specs/tasks/fix-tools-exec-config-hot-reload.md
  - openclaw_runtime/src/gateway/config-reload-plan.ts
  - openclaw_runtime/src/gateway/config-reload-plan.tools.test.ts
expectedUserBehavior:
  - Changing tools.exec.security or tools.exec.ask is applied through Gateway hot reload.
  - The Gateway logs the tools path as a hot-reload reason instead of silently treating it as a no-op.
  - Tool config edits do not restart unrelated channels, cron, heartbeat, hooks, plugins, or the Gateway.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/fix-tools-exec-config-hot-reload.md
  - pnpm harness validate --spec harness/specs/tasks/fix-tools-exec-config-hot-reload.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-core.config.ts src/gateway/config-reload-plan.tools.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm --dir openclaw_runtime tsgo:core:test
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - tools.exec.security and tools.exec.ask produce hot reload reasons with restartGateway=false.
  - The reload plan does not restart or reload unrelated subsystems for tools-only changes.
  - resolveConfigReloadMetadata reports tools paths as hot for schema lookup consumers.
  - Existing gateway.reload no-op and gateway auth restart classifications remain unchanged.
docs:
  required: false
  note: This restores the runtime behavior already stated by the agent tool and config write flows. README variants do not document field-level reload classifications.
---
