---
id: rc10-development-loop
title: RC-10 scoped development checks and honest driver evidence
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: d6d896f62afdf4928a6a057532ef1854fc1e7554
intent: Keep the channel regression loop small, reject unsupported driver scenarios, and distinguish development evidence from frozen-candidate release acceptance.
ownedPaths:
  - electron/services/sessions-api.ts
  - tests/unit/host-services.test.ts
  - openclaw_runtime/src/gateway/server-cron-notifications.ts
  - tests/unit/cron-operator-notifications.test.ts
  - openclaw_runtime/src/context-engine/rc03-seal-hook.ts
  - openclaw_runtime/src/agents/receipt-store.ts
  - openclaw_runtime/src/agents/receipt-store.test.ts
  - tests/unit/rc10-context-seal.test.ts
  - electron/gateway/ws-client.ts
  - electron/gateway/ws-trace.ts
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/gateway-ws-trace.test.ts
  - tests/e2e/rc10-operator-live.spec.ts
  - openclaw_runtime/src/cron/operator-delivery.ts
  - openclaw_runtime/src/cron/operator-delivery.test.ts
  - openclaw_runtime/src/cron/delivery.ts
  - openclaw_runtime/src/cron/isolated-agent/delivery-dispatch.ts
  - package.json
  - tests/integration/channel-startup.integration.test.ts
  - tests/unit/config-sync-source-runtime.test.ts
  - tests/unit/rc10-driver-entrypoint.test.ts
  - scripts/rc10/**
  - artifacts/runtime-authority-convergence/rc-10/**
  - harness/specs/tasks/rc10-development-loop.md
  - harness/specs/tasks/rc10-source-runtime-channel-startup.md
  - harness/specs/tasks/rc10-human-acceptance-runbook.md
  - harness/specs/guides/scoped-development-validation.md
  - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
  - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .agent-workbench/task-forest/**
touchedAreas:
  - electron/services/sessions-api.ts
  - tests/unit/host-services.test.ts
  - openclaw_runtime/src/gateway/server-cron-notifications.ts
  - tests/unit/cron-operator-notifications.test.ts
  - openclaw_runtime/src/context-engine/rc03-seal-hook.ts
  - openclaw_runtime/src/agents/receipt-store.ts
  - openclaw_runtime/src/agents/receipt-store.test.ts
  - tests/unit/rc10-context-seal.test.ts
  - electron/gateway/ws-client.ts
  - electron/gateway/ws-trace.ts
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/gateway-ws-trace.test.ts
  - tests/e2e/rc10-operator-live.spec.ts
  - openclaw_runtime/src/cron/operator-delivery.ts
  - openclaw_runtime/src/cron/operator-delivery.test.ts
  - openclaw_runtime/src/cron/delivery.ts
  - openclaw_runtime/src/cron/isolated-agent/delivery-dispatch.ts
  - package.json
  - tests/integration/channel-startup.integration.test.ts
  - tests/unit/config-sync-source-runtime.test.ts
  - tests/unit/rc10-driver-entrypoint.test.ts
  - scripts/rc10/**
  - artifacts/runtime-authority-convergence/rc-10/**
  - harness/specs/tasks/rc10-development-loop.md
  - harness/specs/tasks/rc10-source-runtime-channel-startup.md
  - harness/specs/tasks/rc10-human-acceptance-runbook.md
  - harness/specs/guides/scoped-development-validation.md
  - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
  - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .agent-workbench/task-forest/**
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - runtime-authority-convergence-boundary
expectedUserBehavior:
  - Development uses targeted tests and lint plus uncached typecheck; full RC acceptance runs after candidate freeze.
  - The channel check executes real config synchronization, sidecar startup and IRC transport without Electron or a provider.
  - Unsupported scenarios fail before credentials, workspace writes or Electron startup.
  - Desktop Inbox uses paired device-token authentication.
  - Command and agentTurn Cron delivery share durable Operator approval when explicitly enabled.
  - Development evidence never changes release verdicts or product locks.
forbiddenPatterns:
  - Executing H-01 under another scenario label
  - Reusing an old candidate verdict for changed product code
  - Requiring human actions or human-authored verdicts
requiredTests:
  - pnpm run check:rc10:dev
  - pnpm run test:e2e:run tests/e2e/rc10-operator-live.spec.ts --workers=1
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/rc10-development-loop.md
acceptance:
  - Channel integration is reachable from test:channel-startup and test:integration.
  - Initial launch, later sync, disabled channel and explicit skip policies are covered.
  - Unsupported and malformed driver requests exit nonzero without writing scenario evidence.
  - IRC peer CLI starts through a directory junction and terminates its sockets on shutdown.
  - Plain Node imports scripts/rc10/operator-driver.mjs and its IRC and TypeScript fixture dependencies from a minimal layout without artifacts or installed Electron.
  - Current status records remaining scenario implementation and frozen-candidate verification accurately.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - docs/dev/Sustained-Development-Playbook.md
---

This repairs the RC-09/RC-10 development loop. It does not execute or replace the
release acceptance protocol. H-02..H-06 use dedicated real-product drivers; their development results remain
separate from the frozen-candidate release acceptance.
