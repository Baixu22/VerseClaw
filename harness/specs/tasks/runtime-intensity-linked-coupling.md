---
lifecycleStatus: archived
id: runtime-intensity-linked-coupling
title: Runtime Intensity Linked Coupling
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Decouple runtime intensity policy from the post-downgrade thinking level by capturing the requested reasoning effort before model capability fallback and resolving intensity through the fixed linked-v1 mapping.
touchedAreas:
  - harness/specs/tasks/runtime-intensity-linked-coupling.md
  - harness/specs/tasks/runtime-intensity-policy.md
  - openclaw_runtime/src/agents/intensity-policy.ts
  - openclaw_runtime/src/agents/provider-effort-capability.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/auto-reply/reply/get-reply-run.ts
  - openclaw_runtime/src/auto-reply/reply/queue/types.ts
  - openclaw_runtime/src/auto-reply/reply/agent-runner-run-params.ts
  - openclaw_runtime/src/agents/system-prompt-report.ts
  - openclaw_runtime/src/config/sessions/types.ts
  - openclaw_runtime/src/auto-reply/get-reply-options.types.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - shared/types/agent.ts
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - electron/services/chat-api.ts
  - src/stores/chat.ts
  - tests/unit/runtime-intensity-policy.test.ts
  - tests/unit/provider-effort-capability.test.ts
  - tests/unit/chat-api-effort-intensity.test.ts
expectedUserBehavior:
  - The chat effort control remains one product-level control with the linked-v1 mapping.
  - A model capability downgrade may change effective reasoning but must not change effective runtime intensity.
  - auto always resolves to baseline intensity, independent of the model default thinking level.
  - Runs without the new fields keep the legacy thinkLevel-derived behavior.
  - The session system-prompt report records requested/effective reasoning and intensity plus source, coupling mode, and adherence.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - chat-loop-boundary
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/runtime-intensity-policy.test.ts tests/unit/provider-effort-capability.test.ts tests/unit/prompt-quality-budget.test.ts tests/unit/chat-api-effort-intensity.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - requestedReasoningEffort is captured before provider/model downgrade in get-reply-run.
  - resolveRuntimeIntensityPolicy prefers requestedRuntimeIntensity / requestedReasoningEffort over the post-downgrade thinkLevel.
  - Provider capability matrix matches OpenAI, Anthropic, and DeepSeek documented effort vocabularies.
  - System prompt report includes requested/effective reasoning and requested/effective intensity without storing raw prompt text.
  - Legacy inputs without linked fields behave exactly as before.
docs:
  required: true
  files:
    - docs/architecture-overview.md
    - docs/clawx-design-overview.md
---

Linked-v1 runtime core. Renderer/Main/Gateway per-send field plumbing and CLI/plugin harness parity remain separate follow-ups and must not be folded into this spec.
