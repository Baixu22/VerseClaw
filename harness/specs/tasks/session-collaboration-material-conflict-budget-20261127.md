---
lifecycleStatus: active
id: session-collaboration-material-conflict-budget-20261127
title: 限制共享材料冲突历史的单次读取
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 23ebd9b6c9f936545ddc073097a14dfec1ed5018
intent: 为 D 候选修复独立复审发现的冲突历史无界载入，预算耗尽时保留未知状态。
touchedAreas:
  - shared/task-system/store.ts
  - tests/unit/session-collaboration-material-lifecycle.test.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-resources.ts
  - tests/unit/session-collaboration-query.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/modules/sessions.md
  - harness/specs/tasks/session-collaboration-material-conflict-budget-20261127.md
  - harness/specs/tasks/session-collaboration-resource-read-revalidation-20261127.md
  - harness/specs/fixtures/session-collaboration-center/D-development-20261127/**
requiredRules:
  - session-collaboration-center-contract
  - durable-task-system-boundary
  - identity-scope-boundary
  - backend-communication-boundary
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 预算内的有效冲突继续显示，已撤销或失效的记录不占用八条结果名额。
  - 冲突历史超界且预算内没有有效冲突时，材料显示未知并停止复用。
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-material-lifecycle.test.ts tests/unit/session-collaboration-material-adoption.test.ts --maxWorkers=1 --no-file-parallelism
  - node scripts/contract-check.mjs
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/session-collaboration-material-conflict-budget-20261127.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/session-collaboration-material-conflict-budget-20261127.md --dry-run
acceptance:
  - 沿用 MATERIAL_SCAN_LIMIT，单次最多载入预算加一条匹配记录，仅处理预算内记录。
  - 有效冲突在过滤失效记录后最多返回八条；超界且没有有效冲突时返回 unknown。
  - 原较旧冲突与预算耗尽回归、实际 prompt 采用回归、契约、通信和所选 Harness 通过。
  - 原无界实现的失败、独立复审发现和最终星驰审查均可回读。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

该修订接续 D 候选的独立审查发现，复用 C 工作树已有的读取预算与未知状态合同。C 的在途源码由原聊天继续维护。完整类型、构建、Electron 实跑和 CI 按既有交接延期。
