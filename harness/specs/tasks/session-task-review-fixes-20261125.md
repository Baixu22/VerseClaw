---
id: session-task-review-fixes-20261125
title: 修复已合并会话与持久任务机制的七项缺陷
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c68893a89350b8053bb5ab8a8618b42c1a46b8bc
intent: 完成任务取消和会话恢复闭环，统一只读工具与运行凭证，隔离迟到的界面更新，并使副作用准入按任务点查。
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - shared/task-system/**
  - electron/services/task-system-service.ts
  - electron/services/task-ledger-service.ts
  - electron/services/workspaces-api.ts
  - electron/services/sessions-api.ts
  - openclaw_runtime/src/agents/tool-mutation.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - src/stores/chat.ts
  - src/pages/Chat/index.tsx
  - src/pages/TaskLedger/ManagedTasks.tsx
  - tests/unit/**
  - tests/e2e/session-task-review-fixes.spec.ts
  - harness/specs/tasks/session-task-review-fixes-20261125.md
  - harness/specs/rules/durable-task-system-boundary.md
  - harness/specs/scenarios/durable-task-system.md
  - harness/specs/fixtures/session-task-review-fixes/**
  - docs/dev/durable-task-system/**
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - 任务取消等待模型运行和工具效果结清，界面终态对应实际停止。
  - 恢复会话后可读取原任务并继续发送，旧身份仍被拒绝。
  - 切换会话或工作区后，迟到响应只更新原作用域。
  - 只读引用可以查询记忆和会话历史；未知或写入工具仍需要有效领取。
  - agent 恢复暂停任务后可继续使用该运行的有效凭证。
  - 受管副作用的准入按当前任务读取，避免扫描全部任务历史。
requiredTests:
  - pnpm exec vitest run tests/unit/session-task-review-fixes.test.ts tests/unit/chat-pending-message-queue.test.ts tests/unit/session-task-state-guidance.test.tsx --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e tests/e2e/session-task-review-fixes.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/session-task-review-fixes-20261125.md
  - pnpm harness run --spec harness/specs/tasks/session-task-review-fixes-20261125.md --dry-run
acceptance:
  - 活动模型、进行中的文件操作和委派取消均等待原运行及效果回执，失败停止保留 cancelling。
  - 会话恢复按原代次迁移 writer 和只读引用，重试幂等；旧代次、旧 epoch 和未决效果继续拒绝。
  - 暂停恢复不复活暂停前运行，新的恢复运行可以调用模型和受管工具。
  - 只读查询在前后工具边界使用同一判定，带副作用的 shell、未知工具和写入仍受控。
  - 原会话历史等待、资源拒绝和工作区任务操作的迟到响应不会污染新视图或草稿。
  - 副作用准入不读取全量 Task Ledger；一千和一万任务的同机样本分别保存。
  - 单测、类型、契约、通信、Electron、规范及指定 WorkBuddy 审查绑定同一候选，并核对主线整合结果。
docs:
  required: true
  files:
    - docs/dev/durable-task-system/DESIGN.md
---

复现基线为本地 main 的 526645345，远端整合基线为 c68893a89。原始观察和失败记录保存在 D:/tmp/clawx-session-task-review-20261125；修复证据使用独立目录并标注 agent 驱动。
