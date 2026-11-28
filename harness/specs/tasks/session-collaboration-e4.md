---
lifecycleStatus: active
id: session-collaboration-e4
title: E4 验证消息来源、读取范围与证据留存反例
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: eb1d37cdf23323753042a4da53d4da19203e6a57
intent: 绑定协作消息的实际读取者并验证消息来源、回执及材料留存边界。
touchedAreas:
  - electron/services/sessions-api.ts
  - src/components/agents/SystemPortfolioPanel.tsx
  - tests/unit/session-collaboration-system-reader.test.tsx
  - tests/unit/session-collaboration-system-notification.test.tsx
  - shared/session-collaboration-message.ts
  - shared/types/session-collaboration-message.ts
  - tests/unit/session-collaboration-boundary.test.ts
  - tests/unit/session-collaboration-boundary-owner.test.ts
  - tests/unit/session-collaboration-boundary-provenance.test.ts
  - tests/unit/session-collaboration-boundary-retention.test.ts
  - tests/unit/session-collaboration-context-host.test.ts
  - tests/e2e/session-collaboration-boundary.spec.ts
  - tests/e2e/session-collaboration-material-lifecycle.spec.ts
  - harness/specs/tasks/session-collaboration-e4.md
  - harness/specs/rules/session-collaboration-center-contract.md
  - harness/specs/scenarios/session-collaboration-center.md
  - harness/specs/fixtures/session-collaboration-center/E4-development-20261128/**
  - docs/modules/sessions.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - durable-task-system-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 当前窗口只能以真实活动会话读取授权范围内的消息，导航或换代后的旧结果被丢弃。
  - 跨会话消息保留工具级来源，消息文本不产生权限或任务验收事实。
  - 来源删除、文件篡改和材料缺失保留原始引用与明确状态。
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-boundary.test.ts tests/unit/session-collaboration-boundary-provenance.test.ts tests/unit/session-collaboration-boundary-retention.test.ts tests/unit/session-collaboration-message-envelope.test.ts tests/unit/session-collaboration-context-host.test.ts tests/unit/session-collaboration-material-query.test.ts tests/unit/session-collaboration-material-lifecycle.test.ts tests/unit/session-collaboration-delivery.test.ts --maxWorkers=1 --no-file-parallelism
  - node scripts/contract-check.mjs
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-boundary-owner.test.ts --maxWorkers=1 --no-file-parallelism
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-system-reader.test.tsx tests/unit/session-collaboration-system-notification.test.tsx --maxWorkers=1 --no-file-parallelism
  - node scripts/i18n-lint.mjs
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/session-collaboration-e4.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/session-collaboration-e4.md --dry-run
acceptance:
  - 反例覆盖冒充读取者、源目标换代、读取期间导航及切走后切回，拒绝结果不含消息或回执正文。
  - 信封拒绝调用者伪造来源与授权，回执的消息、run及回复字节绑定原意图；正文中的命令和配置保持inter_session数据。
  - 覆盖原任务证据、来源删除、产物篡改及missing/stale的留存路径，不用任务关联替代当前读取权限。
  - 同候选记录反例、源码和原始结果哈希，精选产物敏感信息扫描为零，星驰独立开发验收通过。
docs:
  required: true
  files:
    - docs/modules/sessions.md
---

# E4 消息与证据边界

前置 E3 的代码与开发验收已通过 PR #292 合并。按用户开发优先安排，本轮实现边界修复和负例、执行定向单测/contract/i18n/comms/Harness/ESLint、收集 Electron 用例；完整类型、构建、CI、真实桌面/Gateway 实跑和 D5 裁定继续延期。

Task Forest 只更新当前进度。原始跑次写 D:/tmp/session-collaboration-e4-20261128，最终证据标记 driven_by: agent，绑定干净代码提交。
