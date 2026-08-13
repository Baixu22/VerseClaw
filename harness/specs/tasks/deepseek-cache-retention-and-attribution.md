---
id: deepseek-cache-retention-and-attribution
title: DeepSeek cache retention and miss attribution
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Align DeepSeek prompt-cache retention policy and cache-miss attribution with the DeepSeek-Reasonix reference so warm-session cache hits are maximized and every cache break is attributable to a concrete cause.
touchedAreas:
  - harness/specs/tasks/deepseek-cache-retention-and-attribution.md
  - harness/specs/rules/cache-impact-declaration.md
  - openclaw_runtime/src/agents/embedded-agent-runner/vendor-cache-policy.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-retention.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-observability.ts
  - openclaw_runtime/src/agents/provider-payload-cache-shape.ts
  - openclaw_runtime/src/agents/usage.ts
  - tests/unit/vendor-cache-policy.test.ts
  - tests/unit/deepseek-prompt-cache-runtime.test.ts
  - tests/e2e/chat-cache-deepseek-cache-first.spec.ts
expectedUserBehavior:
  - DeepSeek keeps the 24h prefix-cache TTL default; DashScope and Anthropic override with 5m.
  - Warm-session cache reads stay stable across turns and cache breaks are attributed to system, tools, model, or transport drift.
  - Cache-impact declarations are required on PRs that touch provider/agent/compaction paths.
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
  - detectCacheVendor classifies api.deepseek.com as deepseek, api.anthropic.com as anthropic, dashscope.aliyuncs.com as dashscope, and unrelated hosts as unknown.
  - defaultCacheTtlMs returns 24h for deepseek/unknown and 5m for anthropic/dashscope; effectiveCacheTtlMs honors an explicit cacheTtlMinutes override.
  - Warm-session cache-miss attribution reuses provider-payload-cache-shape prefix hashes and prompt-cache-observability snapshot diffs without duplicating their logic.
docs:
  required: false
  note: Review README.md, README.zh-CN.md, and README.ja-JP.md; update only if user-facing cache status or config surface changes materially.
---

This task adds vendor cache-TTL policy and cache-impact gating. It must not add keepalive traffic or change the DeepSeek automatic prefix-cache wire format.
