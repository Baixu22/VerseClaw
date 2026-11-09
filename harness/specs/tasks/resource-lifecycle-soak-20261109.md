---
lifecycleStatus: active
id: resource-lifecycle-soak-20261109
title: 完成长期回收与整合候选验收
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 5ffcdfe89f6bed36dd6ebc2f366990c1a05d3976
intent: 完成TF-0839/G34，在当前整合候选验证50生命周期、空闲和持续观察的资源恢复并收口全局合同。
expectedUserBehavior:
  - Repeated terminal and window lifecycles release owned processes and observation references.
  - Idle resource state and longer observation retain measured memory, handles and unknown counters with source-bound evidence.
touchedAreas:
  - tests/e2e/resource-lifecycle-soak.spec.ts
  - tests/e2e/resource-window-lifecycle.spec.ts
  - tests/unit/resource-lifecycle-report.test.ts
  - tests/unit/resource-repeated-observers.test.ts
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/unit/chat-question-directory.test.tsx
  - tests/unit/chat-stream-publication.test.ts
  - tests/unit/r0-3-chat-abort-checkstuck.test.ts
  - tests/unit/resource-metrics-owner.test.ts
  - shared/dcs/component-disposition-catalog.ts
  - scripts/verify-resource-lifecycle-soak.mjs
  - scripts/lib/resource-lifecycle-report.mjs
  - playwright.resource-lifecycle.config.ts
  - playwright.config.ts
  - harness/specs/tasks/resource-lifecycle-soak-20261109.md
  - harness/specs/rules/resource-lifecycle-soak.md
  - harness/specs/fixtures/resource-lifecycle-soak-20261109/**
  - docs/modules/resources-and-observability.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - resource-lifecycle-soak
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - comms-regression
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/resource-lifecycle-report.test.ts --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/resource-lifecycle-soak-20261109.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/resource-lifecycle-soak-20261109.md --dry-run
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - git diff --check
acceptance:
  - Freeze one integrated source/build identity and run at least50 real terminal-process-tree and observer-window lifecycles, preserving generation ownership and actual child exit receipts.
  - Record five minutes idle before the cycles, five minutes recovery afterwards, and a separately labeled30-minute observation segment with periodic live lifecycle probes.
  - Capture owned PID/creation identity, Windows handles, RSS/private/system commit, admission accounts, watcher references and renderer heap; preserve missing counters as unknown and all first failures.
  - Confirm cancelled process trees disappear, no terminal/window/watcher/active/queued accumulation, and cold Fabric accounts recover after the real idle interval; memory/handle trends determine an explicit accept or reject within this measured duration.
  - Rerun related resource/native/Electron/comms/type/Harness checks and mixed-work scenarios on the final integrated candidate, then independently recompute receipts, hashes and credential scan.
  - Audit all G01-G34/A-L contracts against on-disk evidence, close each eligible parent and root only after final evidence is consistent, commit and merge durable outputs while retaining private Task Forest history.
docs:
  required: true
  readmeTranslations: not-needed
  paths:
    - docs/modules/resources-and-observability.md
---

所有交互driven_by: agent，临时profile/日志/trace写D:/tmp/tf0839。
不修改产品默认、自动回收开关或既有超时。终端通过真实Host API，观察窗口由既有Main工厂创建。
进程消失以PID/creation identity与退出回执核对，清理请求发送本身不是退出证明。
