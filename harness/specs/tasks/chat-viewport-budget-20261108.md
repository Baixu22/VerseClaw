---
lifecycleStatus: active
id: chat-viewport-budget-20261108
title: 完善聊天动态视口与缓存字节预算
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: f533277c74dea675fc7ef9b89a306c898a2e9f75
intent: 完成 TF-0834 / G21-G23，保持长会话定位与滚动锚点，并限制跨会话缓存总量。
expectedUserBehavior:
  - Older loaded messages remain reachable with bounded mounted rows and measured variable heights.
  - Cached history and previews can be evicted and read again from existing session and media owners.
touchedAreas:
  - .gitignore
  - vite.config.ts
  - shared/resources/bounded-cache.ts
  - src/stores/chat.ts
  - src/stores/chat/content-cache.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/MessageNavRail.tsx
  - src/pages/Chat/message-render-projection.ts
  - src/pages/Chat/execution-projection.ts
  - src/hooks/use-message-viewport.ts
  - tests/unit/chat-content-budget.test.ts
  - tests/unit/chat-viewport.test.tsx
  - tests/unit/chat-history-budget-reload.test.ts
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/e2e/chat-viewport-budget.spec.ts
  - harness/specs/tasks/chat-viewport-budget-20261108.md
  - harness/specs/rules/chat-viewport-budget.md
  - harness/specs/fixtures/chat-viewport-budget-20261108/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/modules/resources-and-observability.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - chat-viewport-budget
  - chat-stream-publication
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - comms-regression
  - docs-sync
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/chat-content-budget.test.ts tests/unit/chat-viewport.test.tsx tests/unit/chat-history-budget-reload.test.ts --maxWorkers=1
  - node node_modules/@playwright/test/cli.js test tests/e2e/chat-viewport-budget.spec.ts --workers=1
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/chat-viewport-budget-20261108.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/chat-viewport-budget-20261108.md --dry-run
  - git diff --check
acceptance:
  - Mounted history follows measured viewport heights and respects the existing DOM row cap; navigation reaches all loaded history, preserves the reading anchor on prepend/resize/expand and retains sticky-bottom behavior.
  - Existing BoundedCache enforces retained payload bytes across chat history, cached run content, previews and projections; replacement, expiry, explicit deletion and oversized entries preserve accounting.
  - Eviction preserves small active-run identity and cold session/media references. Reload returns the original history and preview content through existing owners without transcript mutation.
  - Native Electron covers long history, large messages, images, expansion, navigation and history reload with identical-workload before/after memory and scroll measurements; preserve all samples and negative controls.
  - Verify current candidate tests, types, lint, four locales, communication and Harness; inspect screenshots, source hashes, cleanup and credential scan before merging and Task Forest closure.
docs:
  required: true
  readmeTranslations: required
  paths:
    - harness/specs/rules/chat-viewport-budget.md
    - docs/modules/resources-and-observability.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

使用原生 ResizeObserver 和既有 scroll owner 测量窗口，复用 BoundedCache。
现有 300 条消息、200 条历史页、120 个 DOM 行等配置保持原值；缓存新增 32 MiB
保留载荷上限，按 UTF-16 字符串与对象/容器开销保守计量，作为缓存淘汰策略。
实际 renderer heap/RSS 另测。冷缓存以既有 sessionKey、filePath/gatewayUrl 回读。
大消息本身的可见正文保持完整；活动运行身份不随大块缓存淘汰丢失。
