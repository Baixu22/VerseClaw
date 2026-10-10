---
lifecycleStatus: archived
id: chat-prompt-cache-guard-v1
title: Chat prompt cache guard v1
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make prompt-cache break risk visible in Chat before high-risk session actions execute, without adding keepalive traffic or changing provider runtime policy.
touchedAreas:
  - harness/specs/tasks/chat-prompt-cache-guard-v1.md
  - shared/types/workspace.ts
  - shared/host-api/contract.ts
  - electron/services/usage-api.ts
  - electron/utils/prompt-cache-status.ts
  - electron/utils/store.ts
  - src/lib/host-api.ts
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - src/pages/Chat/index.tsx
  - shared/i18n/locales/**/chat.json
  - tests/unit/prompt-cache-status.test.ts
  - tests/e2e/chat-cache-guard.spec.ts
  - tests/e2e/chat-cache-live-model.spec.ts
  - package.json
expectedUserBehavior:
  - Chat toolbar shows a subtle prompt-cache health chip only when there is cache usage, a known cache-capable prompt, or a recent risk event.
  - Model switching, manual compaction, and skill/MCP actions that can alter the cached prefix show a localized confirmation toast before executing.
  - Continue executes the requested action; cancel, close, or auto-close leaves the action unapplied.
  - Unknown providers are not presented as optimized; they warn only for large prompt contexts.
  - No keepalive requests, TTL refreshes, or automatic tool schema rewrites are introduced in v1.
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
  - pnpm run test:e2e -- tests/e2e/chat-cache-guard.spec.ts
  - pnpm run test:e2e:chat-cache-live
acceptance:
  - Prompt cache status and risk payloads are typed through shared host-api contracts.
  - Renderer calls only `hostApi.usage.promptCacheStatus` and `hostApi.usage.recordPromptCacheRiskEvent`; it does not invoke IPC or Gateway routes directly.
  - Hit rate is computed as `cacheReadTokens / (inputTokens + cacheReadTokens + cacheWriteTokens)`.
  - Cost estimates are omitted unless reliable cache read/write price data exists.
  - The risk ledger stores only compact session-level decisions and is capped at 200 entries.
  - All user-facing text has en, zh, ja, and ru locale coverage.
  - The real-provider cache probe is opt-in only, skips by default, stores no API key in artifacts, and writes live usage/cache metrics under artifacts/prompt-cache-live-e2e when explicitly enabled.
docs:
  required: false
  note: Review README.md, README.zh-CN.md, and README.ja-JP.md; update only if cache guard behavior becomes part of user-facing docs.
---

Prompt cache guard v1 is an observability and confirmation layer. It must not promise a fixed hit-rate increase; it reduces avoidable cache breaks and records local evidence for later tuning.
