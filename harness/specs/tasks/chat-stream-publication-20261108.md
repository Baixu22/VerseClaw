---
lifecycleStatus: active
id: chat-stream-publication-20261108
title: 按帧发布聊天流并保留即时控制状态
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: a846bbda312ca9502d9d09f3d00f559214dc05df
intent: 完成 TF-0833 / G19-G20，减少普通文本流的重复订阅发布与历史消息派生，保留事件顺序和即时控制。
expectedUserBehavior:
  - Streaming replies grow with frame publications while input and scrolling remain responsive.
  - Approval, cancellation, errors and terminal state appear immediately and stale deltas cannot reopen a finished run.
touchedAreas:
  - src/stores/chat.ts
  - src/stores/chat/frame-publication.ts
  - src/stores/chat/runtime-graph.ts
  - shared/chat/types.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/execution-projection.ts
  - tests/unit/chat-stream-publication.test.ts
  - tests/unit/chat-runtime-sequence.test.ts
  - tests/unit/chat-completed-projection.test.ts
  - tests/e2e/chat-stream-publication.spec.ts
  - harness/specs/tasks/chat-stream-publication-20261108.md
  - harness/specs/rules/chat-stream-publication.md
  - harness/specs/fixtures/chat-stream-publication-20261108/**
  - docs/modules/resources-and-observability.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - chat-stream-publication
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - comms-regression
  - docs-sync
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/chat-stream-publication.test.ts tests/unit/chat-runtime-sequence.test.ts tests/unit/chat-completed-projection.test.ts --maxWorkers=1
  - node node_modules/@playwright/test/cli.js test tests/e2e/chat-stream-publication.spec.ts --workers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/chat-stream-publication-20261108.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/chat-stream-publication-20261108.md --dry-run
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - git diff --check
acceptance:
  - Ordinary assistant/thinking deltas publish at most once per frame while imperative reads retain the latest state; hidden or absent frames retain bounded publication latency and observer cleanup cancels pending work.
  - Duplicate and stale sequence events cannot append text twice or reopen a terminal run; unsequenced incremental text preserves repeated legitimate chunks.
  - Approval, error, abort and terminal updates publish immediately, including when a delta publication is pending; session changes preserve correct run ownership.
  - Completed message references and history projections remain stable during unrelated streaming, and relevant history/context changes invalidate cached results.
  - Agent-driven native Electron before/after pairs use the same event load and record input/scroll behavior, React commits, long tasks and final text; retain negative controls and all measured samples.
  - Freeze a clean candidate, verify relevant tests, Node/Web types, lint, four locales, communication and Harness; read back artifacts, hashes and credential scan before merging and closure.
docs:
  required: true
  readmeTranslations: required
  paths:
    - harness/specs/rules/chat-stream-publication.md
    - docs/modules/resources-and-observability.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

使用现有 Zustand chat owner、runtime graph 和消息投影。当前生产入口是
`src/stores/chat.ts`；旧拆分 action 文件不作为实现入口。普通增量只合并订阅发布，
事件状态仍按接收顺序更新；控制事件立即发布当前完整状态。

主检出的模型选择、任务作用域和聊天布局存在并行修改，按文件与改动块保留。
性能比较采用相同事件与历史数据，分别记录 React 提交次数和长任务；收益结论由配对结果决定。
