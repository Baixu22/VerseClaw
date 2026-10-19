---
lifecycleStatus: active
id: gateway-client-single-owner-v1
title: Gateway client single-owner semantics with gap recovery
scenario: gateway-backend-communication
task_forest:
  - TF-0439
taskType: runtime-bridge
intent: Remove the independently evolving Electron Gateway client semantics by adopting negotiated protocol, retryable metadata, event sequence gap detection and reconnect subscription recovery from the shared gateway client.
touchedAreas:
  - tests/unit/observability-trajectory-projection.test.ts
  - electron/gateway/ws-client.ts
  - electron/gateway/manager.ts
  - electron/gateway/event-dispatch.ts
  - electron/services/observability-api.ts
  - openclaw_runtime/packages/gateway-client/src/client.ts
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/gateway-events.test.ts
  - harness/specs/tasks/gateway-client-single-owner-v1.md
  - harness/specs/tasks/network-protocol-reliability-owner-matrix.md
  - harness/specs/tasks/end-to-end-deadline-v1.md
  - harness/specs/tasks/network-reliability-fault-injection-v1.md
  - harness/specs/tasks/network-retry-budget-v1.md
  - harness/specs/tasks/provider-endpoint-circuit-breaker-v1.md
  - harness/specs/tasks/stream-failure-recovery-v1.md
  - docs/dev/network-protocol-reliability/gateway-client.md
  - docs/dev/network-protocol-reliability/retry-budget.md
  - docs/dev/network-protocol-reliability/owner-matrix.md
  - docs/dev/network-protocol-reliability/current-gaps.md
  - docs/dev/network-protocol-reliability/STATUS.md
  - shared/network-protocol-reliability-owners.json
  - tests/unit/network-protocol-owner-matrix.test.ts
  - openclaw_runtime/src/agents/request-attempt-budget.ts
  - openclaw_runtime/src/agents/request-attempt-budget.test.ts
  - openclaw_runtime/src/agents/model-fallback.ts
  - openclaw_runtime/src/agents/model-fallback.loop-termination.test.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - openclaw_runtime/src/agents/provider-outbound-budget.test.ts
  - openclaw_runtime/src/agents/retry-after.ts
  - openclaw_runtime/src/agents/retry-after.test.ts
  - openclaw_runtime/src/agents/sessions/agent-session.ts
  - openclaw_runtime/src/infra/retry.ts
  - openclaw_runtime/src/infra/retry.test.ts
  - scripts/**
  - artifacts/network-protocol-reliability/**
expectedUserBehavior:
  - 连接短暂中断后 UI 会明确刷新/重连，而不是静默丢失事件。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - api-client-transport-policy
  - gateway-readiness-policy
  - comms-regression
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/gateway-ws-client.test.ts tests/unit/gateway-events.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - Connect uses a protocol range and validates the negotiated hello protocol.
  - A sequence gap produces a typed event and triggers refresh/reconnect rather than silent continuation.
  - Reconnect re-establishes required subscriptions and fails pending RPCs explicitly.
  - Only one component owns Gateway protocol evolution; any retained adapter has a one-way dependency.
  - Renderer never opens a Gateway WebSocket directly.
docs:
  required: true
  files:
    - docs/dev/network-protocol-reliability/gateway-client.md
---

# Non-goals

No Renderer transport switch and no second protocol implementation.
