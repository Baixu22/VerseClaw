---
lifecycleStatus: planned
id: long-session-resource-reclamation
title: 治理长期会话的工作树、终端、浏览器与后台资源
program: long-session-development-20261022
taskKey: E2
phase: E
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 让长期工作既能离开 UI 后继续，也能在取消和结束时按真实 owner 安全退出。
contractIndex: harness/specs/tasks/long-session-development-plan.md
dependsOnTasks:
  - E1
touchedAreas:
  - harness/specs/tasks/long-session-resource-reclamation.md
  - harness/specs/tasks/long-session-development-plan.md
  - electron/services/terminal-session-manager.ts
  - electron/services/session-activity-api.ts
  - electron/services/resource-tracker.ts
  - electron/services/workspaces-api.ts
  - electron/services/sessions-api.ts
  - openclaw_runtime/src/gateway/session-reset-service.ts
  - openclaw_runtime/src/gateway/session-drain-service.ts
  - openclaw_runtime/src/sessions/session-admission-registry.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/goal-wake-durable-cleanup.ts
  - tests/unit/long-session-resource-reclamation.test.ts
  - harness/specs/fixtures/long-session-development/e2/**
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
expectedUserBehavior:
  - 让长期工作既能离开 UI 后继续，也能在取消和结束时按真实 owner 安全退出。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/terminal-session-manager.test.ts tests/unit/session-cascade-delete.test.ts tests/unit/session-delete-gate.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit-fast.config.ts src/sessions/session-admission-registry.test.ts src/sessions/session-admission-registry-reclamation.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/long-session-resource-reclamation.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-resource-reclamation.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-resource-reclamation.test.ts
acceptance:
  - 资源通过 existing owner 关联 session/run/scope，不建 universal session_resources 表；UI unload、运行取消、metadata archive 与资源删除动作明确分开。
  - 至少 50 次创建/停止/归档恢复循环回读 owner handles/permit/waiters/helper refs，退出后的本 lane 活跃残留为 0；必要 keep_on_leave 用户终端单独计数不误杀。
  - cleanup failure/unknown 标 recovery_required 并保留所需证据和重试身份；不 agent-wide kill、不删其他 worktree 或用户目录。
  - 工作树/backend 可恢复性、浏览器 owner/grants、terminal closure 和晚回调不复活资源有负向产物，权限撤销和 workspace delete/switch/app quit 符合原合同。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**E2 · 治理长期会话的工作树、终端、浏览器与后台资源**

让长期工作既能离开 UI 后继续，也能在取消和结束时按真实 owner 安全退出。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段五：接通跟进调度与资源退出。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- E1：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-resource-reclamation.md`。

**实现和核验入口**

- electron/services/terminal-session-manager.ts
- electron/services/session-activity-api.ts
- electron/services/resource-tracker.ts
- electron/services/workspaces-api.ts
- electron/services/sessions-api.ts
- openclaw_runtime/src/gateway/session-reset-service.ts
- openclaw_runtime/src/gateway/session-drain-service.ts
- openclaw_runtime/src/sessions/session-admission-registry.ts
- openclaw_runtime/src/agents/worktree-service.ts
- openclaw_runtime/src/agents/goal-wake-durable-cleanup.ts

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 资源通过 existing owner 关联 session/run/scope，不建 universal session_resources 表；UI unload、运行取消、metadata archive 与资源删除动作明确分开。
2. 至少 50 次创建/停止/归档恢复循环回读 owner handles/permit/waiters/helper refs，退出后的本 lane 活跃残留为 0；必要 keep_on_leave 用户终端单独计数不误杀。
3. cleanup failure/unknown 标 recovery_required 并保留所需证据和重试身份；不 agent-wide kill、不删其他 worktree 或用户目录。
4. 工作树/backend 可恢复性、浏览器 owner/grants、terminal closure 和晚回调不复活资源有负向产物，权限撤销和 workspace delete/switch/app quit 符合原合同。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/terminal-session-manager.test.ts tests/unit/session-cascade-delete.test.ts tests/unit/session-delete-gate.test.ts --maxWorkers=1`
- `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit-fast.config.ts src/sessions/session-admission-registry.test.ts src/sessions/session-admission-registry-reclamation.test.ts --maxWorkers=1`
- `pnpm exec vitest run tests/unit/long-session-resource-reclamation.test.ts --maxWorkers=1`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-resource-reclamation.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/e2/resource-owner-inventory.json
- harness/specs/fixtures/long-session-development/e2/reclamation-cycle-results.json
- harness/specs/fixtures/long-session-development/e2/resource-recovery-required.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 资源默认 cap/idleTtl/keep_on_leave 不自动翻转；本 lane 预算由 explicit coordination policy 控制。
- 与 VG 等后续模块共享 owner 扩展点，不操作其节点或重新实现其 cleanup barrier。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。
