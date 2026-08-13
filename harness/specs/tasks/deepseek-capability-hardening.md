---
id: deepseek-capability-hardening
title: DeepSeek model-level capability hardening
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Harden DeepSeek model-level capabilities to match the DeepSeek-Reasonix reference: per-model effort vocabulary, tool-call pairing and truncated-JSON repair, and bounded prefix-continuation on finish_reason=length.
touchedAreas:
  - harness/specs/tasks/deepseek-capability-hardening.md
  - openclaw_runtime/extensions/deepseek/thinking.ts
  - openclaw_runtime/extensions/deepseek/stream.ts
  - openclaw_runtime/src/plugin-sdk/provider-stream-shared.ts
  - openclaw_runtime/src/plugins/provider-thinking.ts
  - openclaw_runtime/src/auto-reply/thinking.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/deepseek-prefix-continuation.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extra-params.ts
  - openclaw_runtime/src/agents/openai-transport-stream.ts
  - openclaw_runtime/src/agents/provider-tools.ts
  - tests/unit/deepseek-prompt-cache-runtime.test.ts
  - tests/unit/deepseek-effort-vocabulary.test.ts
  - tests/unit/deepseek-prefix-continuation.test.ts
expectedUserBehavior:
  - deepseek-v4-flash exposes disabled|low|high|max and deepseek-v4-pro exposes disabled|high|max, both defaulting to high.
  - DeepSeek tool-call turns round-trip reasoning_content and repair truncated tool-call JSON before it reaches the provider as a 400.
  - A finish_reason=length completion continues through the beta prefix-continuation endpoint at most once, folding usage and cache accounting.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm test
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Per-model effort vocabulary is resolved per model id, not a single shared list.
  - reasoning_content is preserved on tool_calls turns and stripped on non-tool turns.
  - Truncated tool-call JSON is repaired without masking the original parse error.
  - A `finish_reason=length` DeepSeek V4 completion continues through the beta
    prefix-continuation endpoint at most once and folds usage/cache, host-gated
    to `api.deepseek.com` so custom gateways are never bypassed.
docs:
  required: false
  note: Review README.md, README.zh-CN.md, and README.ja-JP.md; update only if user-facing model capabilities change materially.
---

This task hardens model-level capability only. It must not introduce planner/executor, guardian/recovery, or fleet sub-agent orchestration.
