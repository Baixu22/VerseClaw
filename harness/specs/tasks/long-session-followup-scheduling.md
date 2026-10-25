---
lifecycleStatus: completed
id: long-session-followup-scheduling
title: 把定时跟进绑定到长期会话并统一取消规则
program: long-session-development-20261022
taskKey: E1
phase: E
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 让已授权的跟进任务在合适条件继续，而不是依赖使用者重复提示或新增一套常驻调度器。
contractIndex: harness/specs/tasks/long-session-development-plan.md
diffBase: 2a86ab761
dependsOnTasks:
  - D3
touchedAreas:
  - harness/specs/tasks/long-session-followup-scheduling.md
  - harness/specs/tasks/long-session-development-plan.md
  - shared/long-session-followup-scope.ts
  - scripts/long-session-followup-evidence.mjs
  - package.json
  - openclaw_runtime/src/cron/coordinator-scope.ts
  - openclaw_runtime/src/cron/types-shared.ts
  - openclaw_runtime/src/cron/service/state.ts
  - openclaw_runtime/src/cron/service/timer.ts
  - openclaw_runtime/src/cron/service/jobs.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/cron.ts
  - electron/services/cron-api.ts
  - electron/services/cron-maintenance.ts
  - openclaw_runtime/src/gateway/server-cron.ts
  - openclaw_runtime/src/gateway/server-methods/cron.ts
  - openclaw_runtime/src/tasks/cron-task-cancel.ts
  - openclaw_runtime/src/agents/goal-wake-config.ts
  - src/stores/cron.ts
  - shared/types/cron.ts
  - shared/types/workspace.ts
  - tests/unit/long-session-followup-scheduling.test.ts
  - tests/e2e/long-session-followup-scheduling.spec.ts
  - harness/specs/fixtures/long-session-development/e1/**
requiredRules:
  - runtime-lifecycle-governance-boundary
  - identity-scope-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - 让已授权的跟进任务在合适条件继续，而不是依赖使用者重复提示或新增一套常驻调度器。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/cron-delivery-targets.test.ts tests/unit/cron-api-run-log-replay.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/long-session-followup-scheduling.test.ts --maxWorkers=1
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/long-session-followup-scheduling.spec.ts
  - pnpm run long-session:e1:evidence -- --observation <e2e observation>
  - pnpm run long-session:e1:evidence:check
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-followup-scheduling.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-followup-scheduling.test.ts
  - tests/e2e/long-session-followup-scheduling.spec.ts
acceptance:
  - 复用 existing Cron/Workboard owner 保存显式 schedule 与 coordinator scope/intent，明确时区、期限、重试、错过执行处理和通知条件，不建新 daemon/scheduler。
  - 暂停协调、取消 schedule、停止当前 turn 分别定义；归档/reset/delete/revoke 后旧 schedule 不能投递到新 generation 或触发未授权 worker。
  - 重启/重复 tick/离线恢复只执行被当前授权且未过期的跟进，禁止 replay 已完成副作用；无新结果默认静默，错误与重大决策明确反馈。
  - 保留 goal-wake/durable-helper 的冻结 default-off 和 mission 作用域；普通 session goal 不冒充 durable mission。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**E1 · 把定时跟进绑定到长期会话并统一取消规则**

让已授权的跟进任务在合适条件继续，而不是依赖使用者重复提示或新增一套常驻调度器。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段五：接通跟进调度与资源退出。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- D3：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-followup-scheduling.md`。

**实现和核验入口**

- electron/services/cron-api.ts
- electron/services/cron-maintenance.ts
- openclaw_runtime/src/gateway/server-cron.ts
- openclaw_runtime/src/gateway/server-methods/cron.ts
- openclaw_runtime/src/tasks/cron-task-cancel.ts
- openclaw_runtime/src/agents/goal-wake-config.ts
- src/stores/cron.ts
- shared/types/cron.ts
- shared/types/workspace.ts

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 复用 existing Cron/Workboard owner 保存显式 schedule 与 coordinator scope/intent，明确时区、期限、重试、错过执行处理和通知条件，不建新 daemon/scheduler。
2. 暂停协调、取消 schedule、停止当前 turn 分别定义；归档/reset/delete/revoke 后旧 schedule 不能投递到新 generation 或触发未授权 worker。
3. 重启/重复 tick/离线恢复只执行被当前授权且未过期的跟进，禁止 replay 已完成副作用；无新结果默认静默，错误与重大决策明确反馈。
4. 保留 goal-wake/durable-helper 的冻结 default-off 和 mission 作用域；普通 session goal 不冒充 durable mission。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/cron-delivery-targets.test.ts tests/unit/cron-api-run-log-replay.test.ts --maxWorkers=1`
- `pnpm exec vitest run tests/unit/long-session-followup-scheduling.test.ts --maxWorkers=1`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/long-session-followup-scheduling.spec.ts`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-followup-scheduling.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/e1/followup-schedule-receipts.json
- harness/specs/fixtures/long-session-development/e1/pause-cancel-expiry-matrix.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 使用已有 Scheduled 页面与 session action；若底层不支持某 event trigger，标 unsupported，不额外搭建云服务。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

