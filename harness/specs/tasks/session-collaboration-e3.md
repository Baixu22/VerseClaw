---
lifecycleStatus: active
id: session-collaboration-e3
title: E3 验证跨会话协作的重启和故障恢复
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: cc2302f36c3a36be1120e29235b9c48aed741598
intent: 在真实本地 Gateway 和隔离工作区验证各协作 owner 的恢复行为。
touchedAreas:
  - tests/e2e/session-collaboration-recovery.spec.ts
  - tests/e2e/fixtures/session-collaboration.ts
  - harness/specs/fixtures/session-collaboration-center/E3/**
  - harness/specs/tasks/session-collaboration-e3.md
  - harness/specs/scenarios/session-collaboration-center.md
  - src/stores/session-collaboration.ts
  - shared/session-collaboration-watch.ts
  - tests/unit/session-collaboration-watch.test.ts
  - src/components/agents/SessionCollaborationMessages.tsx
  - src/components/agents/SessionCollaborationMaterials.tsx
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/components/agents/SessionCollaborationRecovery.tsx
  - tests/unit/session-collaboration-recovery.test.ts
  - tests/unit/session-collaboration-recovery-view.test.tsx
  - tests/unit/session-collaboration-message-view.test.tsx
  - tests/unit/session-collaboration-panel.test.tsx
  - tests/unit/session-collaboration-material-view.test.tsx
  - tests/unit/session-collaboration-query.test.ts
  - shared/i18n/locales/**/agents.json
  - harness/specs/rules/session-collaboration-center-contract.md
  - harness/specs/fixtures/session-collaboration-center/E3-development-20261128/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/modules/sessions.md
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
  - 页面重载或 Gateway 重启后，界面恢复原订阅、消息回执和材料状态。
  - 在目标换代和资源来源缺失时，用户仍可查看准确的可用范围和等待状态。
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-recovery.test.ts tests/unit/session-collaboration-recovery-view.test.tsx tests/unit/session-collaboration-message-view.test.tsx tests/unit/session-collaboration-watch.test.ts tests/unit/session-collaboration-panel.test.tsx tests/unit/session-collaboration-delivery.test.ts tests/unit/session-collaboration-material-view.test.tsx tests/unit/session-collaboration-query.test.ts --maxWorkers=1 --no-file-parallelism
  - node scripts/contract-check.mjs
  - node scripts/i18n-lint.mjs
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/session-collaboration-e3.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/session-collaboration-e3.md --dry-run
acceptance:
  - 在订阅、发送、接收、回复和材料更新的实际路径注入中断，覆盖来源和目标 reset、页面重载及 Gateway 重启。
  - 恢复后使用原 owner、已确认游标及操作 ID 回读状态。核对新旧代次、通知、调用和任务副作用的计数。
  - 来源消失及资源未知时呈现对应缺口。一个项目读取失败后，另一个已授权项目仍可查询。
  - 按中断位置保存原始事件、操作状态和恢复后回读。保留首轮失败与同候选复跑。
docs:
  required: true
  files:
    - docs/modules/sessions.md
---

# E3 验证跨会话协作的重启和故障恢复

前置为 E2。测试使用既有协作 fixture，创建独立工作区、会话和原任务记录。通过原 Host 或 Gateway 入口触发中断并读回原回执。

对尚未结算的发送或操作按原 ID 核对，保留原意图与未知状态。复用原有停用和查询路径控制本次测试。

精选证据写入 `harness/specs/fixtures/session-collaboration-center/E3/`，原始跑次存放在 D 盘并标记 driven_by 为 agent。

开发优先安排：本轮开发故障注入场景并执行定向单测、契约、四语、通信、Harness与Electron用例收集。真实Gateway/桌面集成实跑、完整类型检查和构建、CI保留完整验收待办。Task Forest仅更新必要进度，不重复生成完整历史导出。
