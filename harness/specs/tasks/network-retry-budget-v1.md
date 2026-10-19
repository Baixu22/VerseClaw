---
lifecycleStatus: active
id: network-retry-budget-v1
title: One bounded attempt chain per logical request
scenario: gateway-backend-communication
task_forest:
  - TF-0438
taskType: runtime-bridge
intent: Collapse SDK retries, agent auto-retry and model fallback into one per-logical-request attempt budget so retries cannot multiply across layers and failed attempts can be cost-attributed.
touchedAreas:
  - harness/specs/tasks/network-retry-budget-v1.md
  - openclaw_runtime/src/agents/request-attempt-budget.ts
  - openclaw_runtime/src/agents/request-attempt-budget.test.ts
  - openclaw_runtime/src/agents/model-fallback.ts
  - openclaw_runtime/src/agents/sessions/agent-session.ts
  - openclaw_runtime/src/agents/sessions/settings-manager.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-diagnostic-events.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - openclaw_runtime/src/agents/model-fallback.loop-termination.test.ts
  - openclaw_runtime/src/agents/provider-outbound-budget.test.ts
  - openclaw_runtime/src/agents/retry-after.ts
  - openclaw_runtime/src/agents/retry-after.test.ts
  - openclaw_runtime/src/infra/retry.ts
  - openclaw_runtime/src/infra/retry.test.ts
  - docs/dev/network-protocol-reliability/retry-budget.md
  - docs/dev/network-protocol-reliability/owner-matrix.md
  - docs/dev/network-protocol-reliability/current-gaps.md
  - docs/dev/network-protocol-reliability/STATUS.md
  - shared/network-protocol-reliability-owners.json
  - tests/unit/network-protocol-owner-matrix.test.ts
  - harness/specs/tasks/network-protocol-reliability-owner-matrix.md
  - harness/specs/tasks/end-to-end-deadline-v1.md
  - harness/specs/tasks/gateway-client-single-owner-v1.md
  - harness/specs/tasks/network-reliability-fault-injection-v1.md
  - harness/specs/tasks/provider-endpoint-circuit-breaker-v1.md
  - harness/specs/tasks/stream-failure-recovery-v1.md
  - scripts/**
  - artifacts/network-protocol-reliability/**
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/observability-trajectory-projection.test.ts
  - docs/dev/network-protocol-reliability/gateway-client.md
  - openclaw_runtime/src/agents/provider-endpoint-health.ts
  - openclaw_runtime/src/agents/provider-endpoint-health.test.ts
  - openclaw_runtime/src/logging/diagnostic-stability.ts
  - openclaw_runtime/src/logging/diagnostic-stability.exec.test.ts
expectedUserBehavior:
  - 一次用户请求不会因多层重试被悄悄放大；限流后会按上游提示等待而不是提前重试。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - provider-error-retry-boundaries
  - outbound-protocol-payload-consistency
  - comms-regression
humanEvidence: not-required
requiredTests:
  - node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/request-attempt-budget.test.ts src/agents/model-fallback.loop-termination.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/provider-error-retry-boundaries.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - One logical request cannot exceed the configured physical-attempt budget across SDK retry, agent auto-retry and fallback candidates.
  - Finite non-negative Retry-After remains a lower bound; unsatisfiable hints stop automatic retry and preserve retry metadata.
  - Auto-retry uses jitter and never schedules earlier than Retry-After.
  - Refusal, context overflow and non-provider coordination errors are not retried.
  - Failed/retried usage is correlated through existing model-call observation; missing or invalid usage is never recorded as healthy zero.
docs:
  required: true
  files:
    - docs/dev/network-protocol-reliability/retry-budget.md
---

# Non-goals

No paid provider request, no second usage store, no product default change.
