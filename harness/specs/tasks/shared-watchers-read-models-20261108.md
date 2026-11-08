---
lifecycleStatus: active
id: shared-watchers-read-models-20261108
title: 复用文件监听与只读服务并验证失效
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 7bd784bd25a5cd76629f2eec17bf55162aea9e68
intent: 完成 TF-0835 / G24-G25，按监听语义共享根和只读结果，保留引用生命周期与失效边界。
expectedUserBehavior:
  - Concurrent consumers share compatible file watchers and repository status reads.
  - Closing one consumer preserves the others; invalidation and path recreation produce fresh results.
touchedAreas:
  - shared/resources/watcher-hub.ts
  - src/lib/read-only-query-cache.ts
  - electron/services/git-api.ts
  - electron/services/knowledge-source-sync.ts
  - tests/unit/shared-watchers-read-models.test.ts
  - tests/unit/resource-timer-watcher.test.ts
  - tests/unit/shared-watchers-native.test.ts
  - tests/unit/git-api.test.ts
  - tests/unit/knowledge-source-sync.test.ts
  - tests/e2e/shared-read-models.spec.ts
  - harness/specs/tasks/shared-watchers-read-models-20261108.md
  - harness/specs/rules/shared-watchers-read-models.md
  - harness/specs/fixtures/shared-watchers-read-models-20261108/**
  - docs/modules/resources-and-observability.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - shared-watchers-read-models
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - comms-regression
  - docs-sync
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/shared-watchers-read-models.test.ts tests/unit/shared-watchers-native.test.ts tests/unit/resource-timer-watcher.test.ts tests/unit/resource-watcher-handle-pressure.test.ts tests/unit/git-api.test.ts tests/unit/knowledge-source-sync.test.ts tests/unit/resource-p1-schedulers.test.ts --maxWorkers=1
  - node node_modules/@playwright/test/cli.js test tests/e2e/shared-read-models.spec.ts --workers=1
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/shared-watchers-read-models-20261108.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/shared-watchers-read-models-20261108.md --dry-run
  - git diff --check
acceptance:
  - Independent subscription identities preserve duplicate callbacks, idempotent close and replacement generations. Compatible recursive ancestor roots share native watching while each subscriber retains its relative paths, depth and filters.
  - File polling meets the fastest current subscription interval, releases only its own native callback, and final release removes watchers and recovery monitors.
  - Knowledge source synchronization uses the existing hub and survives directory delete/recreate while retaining pattern, symlink, capture and cursor semantics.
  - Read-only invalidation and clear fence in-flight publication; repository recreation or source changes cannot return a cached status from another source. Main status sharing remains the production entry.
  - Native fixtures compare equal-work handle counts, read calls and memory; real Electron windows share Main reads and closing one window preserves the remaining consumer.
  - Freeze a clean candidate and complete tests, types, lint, four locales, comms and Harness; read artifacts, cleanup, hashes and credential scan before merge and closure.
docs:
  required: true
  readmeTranslations: required
  paths:
    - harness/specs/rules/shared-watchers-read-models.md
    - docs/modules/resources-and-observability.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

复用 WatcherHub、BoundedCache 与 Singleflight。共享范围由递归、路径、轮询节拍与订阅过滤决定，
事件仍是重新读取 owner 的提示。Git 状态通过既有 Main host route 共享，复用结果按路径来源和失效代次隔离。
同进程消费者使用同一 hub，跨进程监听仍由本地 owner 管理；不创建常驻文件服务或新索引。测量由 agent 执行并标注。
