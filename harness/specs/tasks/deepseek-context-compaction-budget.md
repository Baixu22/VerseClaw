---
id: deepseek-context-compaction-budget
title: DeepSeek context compaction and output budget alignment
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Align DeepSeek context-window, compaction, and output-budget behavior with the DeepSeek-Reasonix reference: correct V4 context window and max output tokens, content-driven compaction with a stable prefix, CJK-aware token estimation, and a send-time output budget ladder.
touchedAreas:
  - harness/specs/tasks/deepseek-context-compaction-budget.md
  - openclaw_runtime/extensions/deepseek/openclaw.plugin.json
  - openclaw_runtime/extensions/deepseek/provider-policy-api.ts
  - openclaw_runtime/src/plugin-sdk/provider-stream-shared.ts
  - openclaw_runtime/src/agents/compaction.ts
  - openclaw_runtime/src/agents/compaction-planning.ts
  - openclaw_runtime/src/agents/context-window-guard.ts
  - openclaw_runtime/src/agents/context.ts
  - tests/unit/deepseek-prompt-cache-runtime.test.ts
expectedUserBehavior:
  - deepseek-v4-flash and deepseek-v4-pro report a 1,000,000 context window and a 131072 max output budget, with corrected USD cache-read pricing.
  - Compaction preserves a stable system+tools prefix, emits a single summary digest plus a recent tail, and triggers near a 0.85 ratio.
  - CJK-heavy sessions calibrate token estimates from same-session usage instead of a fixed chars-per-token constant.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm test
acceptance:
  - The DeepSeek model catalog matches the reference V4 values (contextWindow 1000000, maxTokens 131072, cacheRead 0.0028 flash / 0.003625 pro).
  - The reasoning-aware max_tokens cap in the DeepSeek stream wrapper stays within the 131072 model ceiling and never overrides an explicit max_tokens.
docs:
  required: false
  note: Review README.md, README.zh-CN.md, and README.ja-JP.md; update only if user-facing model limits or context behavior change materially.
---

This task calibrates model limits and compaction budget behavior. It must not change the DeepSeek automatic prefix-cache wire format or introduce server-side compaction for OpenAI-completions.
