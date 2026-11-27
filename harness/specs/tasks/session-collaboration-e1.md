---
lifecycleStatus: active
id: session-collaboration-e1
title: E1 按任务依赖与资源事实提供协作提示
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: de8db24c8299239c83fc74ec34df3e74b0e6eb99
intent: 在选定会话的作用域内解释任务依赖、写入资格和资源等待，并提供原操作入口。
touchedAreas:
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - docs/modules/multi-agent-and-tasks.md
  - docs/modules/sessions.md
  - electron/services/sessions-api.ts
  - electron/services/workspaces-api.ts
  - harness/specs/fixtures/session-collaboration-center/E1-development-20261127/**
  - harness/specs/rules/session-collaboration-center-contract.md
  - harness/specs/scenarios/session-collaboration-center.md
  - harness/specs/tasks/session-collaboration-e1.md
  - openclaw_runtime/src/agents/tool-description-presets.ts
  - openclaw_runtime/src/agents/tools/session-collaboration-query.ts
  - openclaw_runtime/src/agents/tools/sessions-list-tool.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-hints.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/agents.json
  - shared/i18n/locales/ja/agents.json
  - shared/i18n/locales/ru/agents.json
  - shared/i18n/locales/zh/agents.json
  - shared/task-system/store.ts
  - shared/types/session-collaboration-hints.ts
  - src/components/agents/SessionCollaborationHints.tsx
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/lib/host-api.ts
  - tests/e2e/session-collaboration-coordination-hints.spec.ts
  - tests/unit/session-collaboration-context-host.test.ts
  - tests/unit/session-collaboration-coordination-hints.test.ts
  - tests/unit/session-collaboration-hints-view.test.tsx
  - tests/unit/session-collaboration-query.test.ts
  - tests/unit/workspaces-api.test.ts
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
  - 展开会话详情可查看基于原任务、写入资格与资源准入回执的协作提示，并跳转到对应证据。
  - 同一任务以 TaskSystem 的节点、修订和摘要确认。同文件观察按观察者引用呈现，写入资格按原 writer 和 lease 回执呈现。
  - 通过已有任务领取、派发或停止入口处理建议。原入口执行前验证当前代次、绑定和资格。
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-coordination-hints.test.ts tests/unit/session-collaboration-hints-view.test.tsx tests/unit/session-collaboration-context-host.test.ts tests/unit/session-collaboration-query.test.ts tests/unit/session-collaboration-panel.test.tsx tests/unit/durable-task-system.test.ts tests/unit/workspaces-api.test.ts --maxWorkers=1 --no-file-parallelism
  - node scripts/contract-check.mjs
  - node scripts/i18n-lint.mjs
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/session-collaboration-e1.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/session-collaboration-e1.md --dry-run
acceptance:
  - 在当前可读工作区和目标会话代次内，提示的依赖、writer、lease 与等待事实可通过原任务或资源回执复核。
  - 对相同任务和同文件观察给出独立提示。同文件观察者的实际写入资格按原 owner 回执判定。
  - 缺失、陈旧、跨代或越界来源返回明确的不可用状态。仅从摘要得出的相似性保留为待确认。
  - 从提示打开原操作入口。对展示后代次、claim 或 lease 变动的场景，复核原入口的重新校验与拒绝结果。
  - 被动刷新保持任务、claim、lease、预算和调度事实一致，模型调用增量为零。
  - Electron 覆盖四语、键盘和宽窄布局。保留同候选输入、原事件、命令、退出码、计数、哈希及负例，自动证据标记 driven_by 为 agent。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - docs/modules/multi-agent-and-tasks.md
---

# E1 协作提示

本叶前置为 `TF-0938` 的 D5 裁定与已完成的 `TF-0865`。开工时回读 D5 的决定、当前主线和原 owner 合同，固定候选及输入。

- 读取原 TaskSystem 合同与依赖状态，重复任务提示绑定节点、修订和摘要。用原 Task Ledger 路由查看对应记录。
- 在已校验的执行树中核对 writer、claim 和 lease。观察者引用单独展示，写入提示引用真实领取与执行回执。
- 复用会话资源详情的已知准入观测。等待理由引用原 owner 的结果与采样时间。
- 动作经现有领取、派发或停止入口提交，校验由原入口负责。回退时移除提示入口和投影，原 owner 继续处理已有任务和资源。

精选证据写入 `harness/specs/fixtures/session-collaboration-center/E1/`，原始跑次存放在 D 盘。

2026-11-27 所有者明确授权先完成 E1 开发：使用现有有界查询，D5 索引裁定和完整验收延期。开发验收覆盖定向回归、契约、四语、通信、Harness 与 Electron 用例收集；完整类型、构建、Electron 实跑及 CI 待后续执行。
