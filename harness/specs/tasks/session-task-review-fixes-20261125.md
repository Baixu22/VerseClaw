---
id: session-task-review-fixes-20261125
title: 修复已合并会话与持久任务机制的七项缺陷
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c0450f50c0046a8c021188e9eb472b10f1203b6f
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
  - AGENTS.md
  - scripts/session_task_serial_validation.py
  - scripts/session_task_serial_validation_test.py
  - shared/task-system/**
  - electron/services/task-system-service.ts
  - electron/services/task-ledger-service.ts
  - electron/services/workspaces-api.ts
  - electron/services/sessions-api.ts
  - openclaw_runtime/src/agents/tool-mutation.ts
  - openclaw_runtime/src/agents/tool-mutation.test.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/workspace.ts
  - openclaw_runtime/src/agents/execution-task-barrier.ts
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
  - python -B scripts/session_task_serial_validation_test.py
  - pnpm exec vitest run tests/unit/session-task-review-fixes.test.ts tests/unit/session-task-workspace-bootstrap.test.ts tests/unit/session-task-scope-completion.test.ts tests/unit/chat-pending-message-queue.test.ts tests/unit/chat-store-history-retry.test.ts tests/unit/session-task-state-guidance.test.tsx --maxWorkers=1 --no-file-parallelism
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
  - 已建立任务身份的本地工作区首次初始化保持原 backend，恢复继续同一任务；无任务的新工作区保持自动 Git 初始化。
  - 暂停恢复不复活暂停前运行，新的恢复运行可以调用模型和受管工具。
  - 只读查询在前后工具边界使用同一判定，带副作用的 shell、未知工具和写入仍受控；rg 外部程序和 Git 的文本转换、外部 diff 及分页程序不能绕过任务领取。
  - 原会话历史等待、资源拒绝和工作区任务操作的迟到响应不会污染新视图或草稿。
  - 接力在后台获得接收回执后，按目标草稿记录版本清理并保存原草稿，保留目标中的新编辑和其它会话草稿。
  - 副作用准入不读取全量 Task Ledger；一千和一万任务的同机样本分别保存。
  - 单测、类型、契约、通信、Electron、规范及当前指定模型的子代理验收绑定同一候选，并核对主线整合结果。
docs:
  required: true
  files:
    - docs/dev/durable-task-system/DESIGN.md
---

复现基线为本地 main 的 526645345，远端整合基线为 c68893a89。原始观察和失败记录保存在 D:/tmp/clawx-session-task-review-20261125；修复证据使用独立目录并标注 agent 驱动。

开发期间可以逐文件、单 worker 执行上述单测，每批结束后释放测试进程，并为每个文件保留候选、原命令、退出码与用例结果。`CLAWX_SESSION_TASK_REVIEW_METRICS_DIR` 指定规模样本目录，测试自动创建缺失目录；一千和一万任务的样本与断言保持不变。契约、通信和本任务规范检查可独立执行，完整类型、构建、Electron 与 Harness CI 在最终集成验收时运行。

串行检查仅在每份结果明确成功、通过数等于总数、失败/挂起/todo 均为零时通过；缺失或无效计数拒绝。接续已有结果时重新核对原始回执、源文件哈希与进程退出，并使用相同判定；测试文件必须唯一且最终覆盖计划中的全部文件，命令、原始结果文件名与断言均须匹配该文件。使用 `scripts/session_task_serial_validation.py --report <report.json> --plan <plan.json> --output <verification.json>` 回读已有结果；计划保留原执行候选、root、files 与 expectedTests，校验回执记录原候选及输入哈希。

串行开发验收以该校验器生成的 `verification.json` 为唯一结果入口，回执 `status: passed` 后才接受测试结果。历史执行器及其 `report.status` 保留为原始运行记录。
