---
lifecycleStatus: active
id: autonomy-task-actions
title: 回读现有任务 owner 的可信动作、版本提交与幂等恢复
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 按 TF-0671 原标准核对当前 TaskSystem、Task Ledger 与 Runtime 工具接入的可信身份、事务、幂等操作和版本提交。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - comms-regression
  - disk-temp-policy
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
ownedPaths: &paths
  - harness/specs/tasks/autonomy-task-actions.md
touchedAreas: *paths
expectedUserBehavior:
  - 自动任务动作使用 Runtime 的真实会话和代次，重复请求回读原操作结果。
  - 陈旧版本、跨作用域、同 key 异参数和未知在途操作返回明确拒绝；原有手工任务编辑保留其语义。
acceptance:
  - 自动 create、link 和 update 沿现有受控入口记录来源身份，模型参数不能声明 Runtime principal。
  - 并发陈旧 revision 提交仅一个成功；重复 operation 不新增逻辑效果，同参数新意图可使用新 key。
  - TaskSystem 现有事务、日志与回执支持追加后中断、重复恢复和投影重建；批次子项保持完整。
  - Main、Host API 与 Runtime 合同一致，任务状态继续来自原 owner。
  - 当前候选的正负例、命令、退出码、source/input/config 版本和 artifact hashes 可从磁盘复算。
requiredTests:
  - pnpm exec vitest run tests/unit/durable-task-event-store.test.ts tests/unit/durable-task-system.test.ts tests/unit/durable-task-faults.test.ts tests/unit/durable-task-authority-access.test.ts tests/unit/task-ledger-service.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/autonomy-task-actions.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-task-actions.md --dry-run
docs:
  required: false
  note: 当前 owner 接入与阶段验收索引，产品操作沿用现有入口。
---

TF-0671 的当前接入点是 `shared/task-system/store.ts` 的版本与请求事务、
`shared/task-system/event-store.ts` 的日志，以及 Runtime `task_control` 的受信
session/generation。Main 通过 Task Ledger 的既有服务和 Gateway 调用同一任务 owner。

Task Ledger 保留现有编辑与投影。计划分解、任务领取、效果回执与完成决定按各自原
owner 核对；操作重试使用原请求 key，未知效果按既有回执对账。

阶段回读绑定当前候选及原始正负例，保留 TF-0671 历史证据原签。所有模拟产物记录
`driven_by: agent`、实际 `actor` 与 `realHumanEvidence: false`。
