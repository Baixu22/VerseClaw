---
lifecycleStatus: active
id: session-collaboration-resource-read-revalidation-20261127
title: 资源收集后重新核对会话读取资格
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 23ebd9b6c9f936545ddc073097a14dfec1ed5018
intent: 读取期间可见性或读取者身份变化时，清除原资源详情。
touchedAreas:
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-resources.ts
  - tests/unit/session-collaboration-query.test.ts
  - shared/task-system/store.ts
  - tests/unit/session-collaboration-material-lifecycle.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/modules/sessions.md
  - harness/specs/tasks/session-collaboration-resource-read-revalidation-20261127.md
  - harness/specs/tasks/session-collaboration-material-conflict-budget-20261127.md
  - harness/specs/fixtures/session-collaboration-center/D-development-20261127/**
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
  - comms-regression
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 资源收集结束后仍具备读取资格时才返回原详情。
  - 读取者换代、工作区变化和权限撤销清除原资源载荷。
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-query.test.ts --maxWorkers=1 --no-file-parallelism
  - node scripts/contract-check.mjs
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/session-collaboration-resource-read-revalidation-20261127.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/session-collaboration-resource-read-revalidation-20261127.md --dry-run
acceptance:
  - 三项反例在原资源读取实现上失败，修订后通过。
  - Gateway 收集后重新核对当前读取者可见性和身份，再返回 owner 资源。
  - 非活动工作区的合法资源读取和目标执行范围检查通过。
  - 定向回归、契约、通信和所选 Harness 结果绑定记录的候选。
  - 星驰 ccs-ai/gpt-6.1-sol 对当前修订给出可回读的审查结果。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

从保留的 D 阶段候选接续 D2。原审查未知结果与首次反例保留，完整类型、构建、Electron 实跑和 CI 按既有交接继续延期。
