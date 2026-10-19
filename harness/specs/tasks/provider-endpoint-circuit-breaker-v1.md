---
lifecycleStatus: active
id: provider-endpoint-circuit-breaker-v1
title: Wire provider endpoint circuit breaking by endpoint and account
scenario: gateway-backend-communication
task_forest:
  - TF-0440
taskType: runtime-bridge
intent: Connect the existing RateCircuitBreaker to the real provider outbound boundary without duplicating auth cooldown, fallback skip or outbound concurrency budget.
touchedAreas:
  - openclaw_runtime/src/agents/rate-circuit-breaker.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - openclaw_runtime/src/agents/provider-outbound-budget.ts
  - openclaw_runtime/src/agents/provider-endpoint-health.ts
  - openclaw_runtime/src/agents/provider-endpoint-health.test.ts
  - openclaw_runtime/src/logging/diagnostic-stability.ts
  - openclaw_runtime/src/logging/diagnostic-stability.exec.test.ts
  - docs/dev/network-protocol-reliability/provider-health.md
  - artifacts/network-protocol-reliability/net-c/**
  - artifacts/network-protocol-reliability/net-root/net-root-evidence.json
  - artifacts/network-protocol-reliability/net-a/net-a-evidence.json
  - artifacts/network-protocol-reliability/net-b/net-b-evidence.json
  - docs/dev/network-protocol-reliability/STATUS.md
  - docs/dev/network-protocol-reliability/current-gaps.md
  - docs/dev/network-protocol-reliability/gateway-client.md
  - docs/dev/network-protocol-reliability/owner-matrix.md
  - docs/dev/network-protocol-reliability/retry-budget.md
  - harness/specs/tasks/end-to-end-deadline-v1.md
  - harness/specs/tasks/gateway-client-single-owner-v1.md
  - harness/specs/tasks/network-protocol-reliability-owner-matrix.md
  - harness/specs/tasks/network-reliability-fault-injection-v1.md
  - harness/specs/tasks/network-retry-budget-v1.md
  - harness/specs/tasks/provider-endpoint-circuit-breaker-v1.md
  - harness/specs/tasks/stream-failure-recovery-v1.md
  - openclaw_runtime/src/agents/model-fallback.loop-termination.test.ts
  - openclaw_runtime/src/agents/model-fallback.ts
  - openclaw_runtime/src/agents/provider-outbound-budget.test.ts
  - openclaw_runtime/src/agents/request-attempt-budget.test.ts
  - openclaw_runtime/src/agents/request-attempt-budget.ts
  - openclaw_runtime/src/agents/retry-after.test.ts
  - openclaw_runtime/src/agents/retry-after.ts
  - openclaw_runtime/src/agents/sessions/agent-session.ts
  - openclaw_runtime/src/infra/retry.test.ts
  - openclaw_runtime/src/infra/retry.ts
  - scripts/**
  - shared/network-protocol-reliability-owners.json
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/network-protocol-owner-matrix.test.ts
  - tests/unit/observability-trajectory-projection.test.ts
expectedUserBehavior:
  - 持续失败的模型端点会被短暂隔离，其他端点与合法流量不受影响。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - provider-outbound-concurrency-budget
  - provider-error-retry-boundaries
  - comms-regression
humanEvidence: not-required
requiredTests:
  - node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/provider-endpoint-health.test.ts src/agents/provider-outbound-budget.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - The real provider transport uses one breaker implementation; no second provider breaker is enabled.
  - Groups are keyed by normalized endpoint plus a non-exportable account discriminator.
  - Only transport, 429, 5xx and timeout failures count; auth cooldown, fallback skip and concurrency budget are not double-counted.
  - Open fails fast without a provider request; half-open admits one probe.
  - Breaker snapshots enter existing diagnostics without credentials or account identifiers.
docs:
  required: true
  files:
    - docs/dev/network-protocol-reliability/provider-health.md
---

# Non-goals

No default-on product change and no distributed breaker state.
