---
lifecycleStatus: archived
id: deepseek-prompt-cache-hit-hardening
title: DeepSeek prompt cache hit hardening
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Stabilize OpenAI-compatible provider payloads and normalize DeepSeek prompt-cache usage so warm-session cache hit metrics are accurate and verifiable.
touchedAreas:
  - harness/specs/tasks/deepseek-prompt-cache-hit-hardening.md
  - openclaw_runtime/src/agents/usage.ts
  - openclaw_runtime/src/agents/openai-transport-stream.ts
  - openclaw_runtime/src/agents/cache-trace.ts
  - electron/utils/token-usage-core.ts
  - electron/utils/prompt-cache-status.ts
  - shared/types/workspace.ts
  - shared/host-api/contract.ts
  - src/pages/Chat/ChatToolbar.tsx
  - shared/i18n/locales/**/chat.json
  - tests/unit/prompt-cache-status.test.ts
  - tests/unit/token-usage-scan.test.ts
  - tests/e2e/chat-cache-live-model.spec.ts
  - tests/e2e/chat-cache-deepseek-cache-first.spec.ts
expectedUserBehavior:
  - Stable-prefix DeepSeek sessions report aggregate, last-turn, and warm-turn cache hit rates separately.
  - DeepSeek usage with `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` is counted as cache-capable evidence.
  - OpenAI-compatible tool payloads are stable across semantically equivalent tool/schema orderings.
  - Cache trace diagnostics can explain whether a cache miss came from system, tools, messages, or final payload shape drift without writing secrets.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - pnpm contract:check
  - pnpm i18n:lint
  - pnpm run typecheck
  - pnpm test
  - pnpm run test:e2e:run -- tests/e2e/chat-cache-guard.spec.ts
  - CLAWX_LIVE_MODEL_E2E=1 CLAWX_LIVE_MODEL_REF=deepseek/deepseek-v4-flash pnpm run test:e2e:run -- tests/e2e/chat-cache-deepseek-cache-first.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - DeepSeek top-level prompt-cache hit/miss fields are normalized without double-counting cached prompt tokens.
  - OpenAI-compatible final tool payloads are sorted and schema-canonicalized at the provider boundary.
  - Warm-turn DeepSeek cache-first live E2E has a hard pass threshold of at least 95% and records the 98% target line.
  - Final provider payload diagnostics record only hashes, counts, names, and usage counters; no API keys or raw secrets are persisted.
  - UI cache status never presents unknown providers as guaranteed optimized, but observed DeepSeek cache evidence raises confidence.
docs:
  required: false
  note: Review README.md, README.zh-CN.md, and README.ja-JP.md; update only if the user-facing cache status behavior changes materially.
---

This task hardens cache hit observability and final payload stability only. It must not add keepalive traffic, TTL automation, or tool freezing.
