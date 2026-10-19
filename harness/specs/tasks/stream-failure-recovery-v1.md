---
lifecycleStatus: active
id: stream-failure-recovery-v1
title: Stream failure isolation and typed recovery semantics
scenario: gateway-backend-communication
task_forest:
  - TF-0441
taskType: runtime-bridge
intent: Make post-header stream failures explicit and non-duplicating, while defining the interface needed for safe stream retry without replaying tool effects.
touchedAreas:
  - openclaw_runtime/src/gateway/openai-http.ts
  - openclaw_runtime/src/gateway/openresponses-http.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/thinking.ts
  - openclaw_runtime/src/agents/sessions/agent-session.ts
  - openclaw_runtime/src/agents/failover-error.ts
  - openclaw_runtime/src/agents/stream-failure.ts
  - openclaw_runtime/src/agents/stream-failure.test.ts
  - tests/unit/provider-error-http-boundaries.test.ts
  - harness/specs/tasks/stream-failure-recovery-v1.md
  - docs/dev/network-protocol-reliability/stream-failure.md
  - docs/dev/network-protocol-reliability/STATUS.md
  - artifacts/network-protocol-reliability/net-d/**
expectedUserBehavior:
  - 流式回答中断时会明确显示不完整，且不会重复执行工具副作用。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - provider-error-retry-boundaries
  - comms-regression
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/provider-error-http-boundaries.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - Post-header failure never becomes a normal stop or fabricated zero usage.
  - Failed-attempt tool calls, approvals and client tool execution do not execute or enter the formal transcript.
  - Partial output is explicitly incomplete in the user-visible stream.
  - A typed stream error exposes code/status/isRetryable and maps to existing failover semantics.
  - Synthetic mid-stream error tests cover text, tool-call and disconnect cases.
docs:
  required: true
  files:
    - docs/dev/network-protocol-reliability/stream-failure.md
---

# Non-goals

No unconditional replay of tool calls and no claim of arbitrary stream resume.
