---
id: runtime-intensity-harness-parity
title: Runtime Intensity Harness Parity
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Apply runtime intensity policy consistently across built-in and CLI-backed/plugin harnesses, and report prompt-only adherence when a harness cannot enforce tool-result/context guard behavior.
touchedAreas:
  - harness/specs/tasks/runtime-intensity-harness-parity.md
  - openclaw_runtime/src/agents/embedded-agent-runner/run/types.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/cli-runner/types.ts
  - openclaw_runtime/src/agents/cli-runner/prepare.ts
  - openclaw_runtime/src/agents/cli-runner/helpers.ts
  - openclaw_runtime/src/auto-reply/reply/agent-runner-execution.ts
  - tests/unit/cli-runner-intensity-policy.test.ts
  - tests/unit/runtime-intensity-policy.test.ts
expectedUserBehavior:
  - Built-in embedded attempts keep full policy enforcement.
  - CLI-backed runs apply prompt mode, skills top-k/compact, and Runtime Intensity prompt lines, and report policyAdherence prompt-only.
  - Plugin harnesses receive runtimeIntensityPolicy in AgentHarnessAttemptParams and must not silently claim full adherence.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - chat-loop-boundary
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/cli-runner-intensity-policy.test.ts tests/unit/runtime-intensity-policy.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - RunCliAgentParams carries runtimeIntensityPolicy.
  - CLI system prompt honors minimal/full prompt mode and includes Runtime Intensity lines.
  - CLI report uses prompt-only adherence unless tool-result/context guard enforcement exists.
  - Embedded built-in attempt retains full adherence.
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

Plugin harness prompt-only/full capability declaration is observational; no plugin is forced to advertise full enforcement.
