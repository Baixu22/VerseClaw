---
lifecycleStatus: active
id: end-to-end-deadline-v1
title: End-to-end deadline and cancellation propagation
scenario: gateway-backend-communication
task_forest:
  - TF-0442
taskType: runtime-bridge
intent: Replace independent Host, Gateway and provider timeouts with one explainable logical deadline budget and propagate cancellation through every layer.
touchedAreas:
  - shared/host-api/host-action-timeouts.ts
  - src/lib/host-api-client.ts
  - electron/main/ipc/host-invoke.ts
  - electron/gateway/manager.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - openclaw_runtime/packages/gateway-client/src/client.ts
  - openclaw_runtime/src/gateway/http-common.ts
  - shared/host-api/host-deadline.ts
  - electron/utils/host-deadline-context.ts
  - electron/services/chat-api.ts
  - openclaw_runtime/src/agents/request-deadline.ts
  - openclaw_runtime/src/agents/request-deadline.test.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.test.ts
  - openclaw_runtime/src/agents/provider-endpoint-health.test.ts
  - tests/unit/chat-api-workspace-fingerprint.test.ts
  - scripts/network-reliability-fault-injection.mjs
  - artifacts/network-protocol-reliability/net-g/**
  - tests/unit/host-api-client-error-metadata.test.ts
  - tests/unit/r0-4-host-api-client-timeout.test.ts
  - tests/unit/r0-4-host-invoke-timeout.test.ts
  - tests/unit/host-deadline.test.ts
  - shared/host-api/types.ts
  - harness/specs/tasks/end-to-end-deadline-v1.md
  - docs/dev/network-protocol-reliability/deadline.md
  - docs/dev/network-protocol-reliability/STATUS.md
  - artifacts/network-protocol-reliability/net-e/**
expectedUserBehavior:
  - 用户取消或超时后请求会真正停止，并得到可解释的阶段与耗时信息。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - error-governance-boundary
  - provider-error-retry-boundaries
  - comms-regression
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/host-api-client-error-metadata.test.ts tests/unit/r0-4-host-api-client-timeout.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - Renderer, Main, Gateway and provider share one logical deadline budget instead of adding independent timeouts.
  - Cancellation reaches every layer and late success is rejected.
  - Timeout errors carry stage, deadlineMs, elapsedMs and local correlation id; provider request id remains distinct.
  - A live physical provider request keeps its outbound slot until a real end/cancel event.
  - Long-action allowlists retain their intended behavior.
docs:
  required: true
  files:
    - docs/dev/network-protocol-reliability/deadline.md
---

# Non-goals

No product-wide timeout default change.
