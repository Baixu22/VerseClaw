---
lifecycleStatus: completed
id: long-session-lifecycle-barrier
title: 让归档、还原与删除共享安全生命周期屏障
program: long-session-development-20261022
taskKey: A2
phase: A
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 补齐归档直接改文件与 runtime 删除保护链不对称的问题，使运行中、崩溃或迟到事件不会假装成功。
contractIndex: harness/specs/tasks/long-session-development-plan.md
dependsOnTasks:
  - A1
diffBase: 3b6a54598
touchedAreas:
  - harness/specs/tasks/long-session-lifecycle-barrier.md
  - harness/specs/tasks/long-session-development-plan.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - docs/clawx-product-semantics.md
  - openclaw_runtime/packages/gateway-protocol/src/index.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/protocol-schemas.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/types.ts
  - electron/gateway/manager.ts
  - electron/services/sessions-api.ts
  - electron/services/session-delete-gate.ts
  - electron/services/session-cascade-delete.ts
  - electron/utils/session-files.ts
  - src/stores/chat.ts
  - openclaw_runtime/src/gateway/session-archive-service.ts
  - openclaw_runtime/src/gateway/session-archive-service.test.ts
  - openclaw_runtime/src/gateway/session-mutation-operation-journal.ts
  - openclaw_runtime/src/gateway/session-mutation-operation-journal.test.ts
  - openclaw_runtime/src/gateway/session-delete-operation-journal.ts
  - openclaw_runtime/src/gateway/session-reset-service.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.read.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - openclaw_runtime/src/sessions/session-admission-registry.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - tests/unit/long-session-lifecycle-barrier.test.ts
  - tests/unit/r0-2-sessions-delete-fail.test.ts
  - tests/unit/session-delete-gate.test.ts
  - openclaw_runtime/src/gateway/session-ecosystem-lifecycle-reachability.test.ts
  - openclaw_runtime/src/gateway/session-reset-service.stop.test.ts
  - tests/e2e/long-session-lifecycle-faults.spec.ts
  - tests/e2e/long-session-lifecycle-faults.spec.ts
  - tests/e2e/sidebar-session-folders-archive.spec.ts
  - tests/e2e/chat-slash-session-lifecycle.spec.ts
  - harness/specs/fixtures/long-session-development/a2/**
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
  - 补齐归档直接改文件与 runtime 删除保护链不对称的问题，使运行中、崩溃或迟到事件不会假装成功。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/long-session-lifecycle-barrier.test.ts tests/unit/session-delete-gate.test.ts tests/unit/session-files.test.ts tests/unit/session-cascade-delete.test.ts tests/unit/terminal-session-manager.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-core.config.ts src/gateway/session-ecosystem-lifecycle-reachability.test.ts src/gateway/session-archive-service.test.ts src/gateway/session-mutation-operation-journal.test.ts src/gateway/session-delete-operation-journal.test.ts src/gateway/session-reset-service.stop.test.ts src/gateway/session-reset-service.subagent-stop.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/long-session-lifecycle-barrier.test.ts --maxWorkers=1
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/sidebar-session-folders-archive.spec.ts tests/e2e/chat-slash-session-lifecycle.spec.ts tests/e2e/long-session-lifecycle-faults.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-lifecycle-barrier.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-lifecycle-barrier.test.ts
  - openclaw_runtime/src/gateway/session-archive-service.test.ts
  - openclaw_runtime/src/gateway/session-mutation-operation-journal.test.ts
  - tests/e2e/long-session-lifecycle-faults.spec.ts
acceptance:
  - 归档/还原使用既有生命周期准入与 finalizer 的明确扩展；任一 drain、owner 或 commit 结果 unknown 时不改 transcript、不隐藏成功、不解锁。
  - 相同 operation identity 重试幂等；归档中途崩溃、还原冲突和旧 generation 迟到事件有可恢复状态，源文件与索引可读盘对账。
  - delete、reset 与既有 keep_on_leave 终端语义不回归，不放大为 agent-wide kill；派生物删除只处理其 owner 声明范围。
  - 真实 Electron 归档/还原操作与运行时故障用例同一变更集覆盖；只改契约或通过 mock 不构成功能验收。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**A2 · 让归档、还原与删除共享安全生命周期屏障**

补齐归档直接改文件与 runtime 删除保护链不对称的问题，使运行中、崩溃或迟到事件不会假装成功。

本规格已执行：runtime archive/restore 现在占用既有 admission fence，使用同一 session mutation journal 的 operationId 重试，并在 Main gate 保留 unknown 结果。A2 的正式结论仍必须由 clean-candidate 回执、真实 built Electron/Host/Gateway 旅程和 A2 盘上 artifacts 支撑。

所属阶段一：统一会话动作并建立故障基线。统一边界见[规划合同索引](./long-session-development-plan.md)。
**A2 交付**

- `sessions.archive` / `sessions.restore` 进入 Gateway registry，transcript、archive index 与 store row 由 runtime 生命周期 owner 在 admission fence 后变更。
- 现有 operation journal table 新增 archive/restore operation kind；Main 在首个 RPC 前持久化 operationId，失败/unknown 时保持同一身份重试。
- archive 先写 archive index、再移动 transcript、最后事务移除 store row 并标记 tombstone；restore 插入新的物理 sessionId，再把 archived transcript 移回并清理索引。
- Gateway sessions.list 过滤仍由 archive index 标记的 key，覆盖 crash 后 store/file 尚未完全收口的窗口。
- 真实 Electron/Host/Gateway E2E 证明 archive 从 live list 消失、archive index 可读、restore 使用新 generation；runtime fault/retry 由 gateway-core 单测覆盖。
- Clean candidate `5daef609dccffc96c62af8c27854934ba4381bb3` / tree `b5f7699569f21599b8071240095102735956ce8d`：13 commands、81/81 tests、build runtime/vite、typecheck、contract、comms、harness 与 diff-check 全部 exit 0；回执见 `harness/specs/fixtures/long-session-development/a2/`。

**前置与读入**

- A1：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-lifecycle-barrier.md`。

**实现和核验入口**

- electron/services/sessions-api.ts
- electron/services/session-delete-gate.ts
- electron/services/session-cascade-delete.ts
- electron/utils/session-files.ts
- src/stores/chat.ts
- openclaw_runtime/src/gateway/session-reset-service.ts
- openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
- openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
- openclaw_runtime/src/sessions/session-admission-registry.ts
- shared/host-api/contract.ts
- src/lib/host-api.ts

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 归档/还原使用既有生命周期准入与 finalizer 的明确扩展；任一 drain、owner 或 commit 结果 unknown 时不改 transcript、不隐藏成功、不解锁。
2. 相同 operation identity 重试幂等；归档中途崩溃、还原冲突和旧 generation 迟到事件有可恢复状态，源文件与索引可读盘对账。
3. delete、reset 与既有 keep_on_leave 终端语义不回归，不放大为 agent-wide kill；派生物删除只处理其 owner 声明范围。
4. 真实 Electron 归档/还原操作与运行时故障用例同一变更集覆盖；只改契约或通过 mock 不构成功能验收。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/session-delete-gate.test.ts tests/unit/session-files.test.ts tests/unit/session-cascade-delete.test.ts tests/unit/terminal-session-manager.test.ts --maxWorkers=1`
- `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-core.config.ts src/gateway/session-delete-operation-journal.test.ts src/gateway/session-reset-service.stop.test.ts src/gateway/session-reset-service.subagent-stop.test.ts --maxWorkers=1`
- `pnpm exec vitest run tests/unit/long-session-lifecycle-barrier.test.ts --maxWorkers=1`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/sidebar-session-folders-archive.spec.ts tests/e2e/chat-slash-session-lifecycle.spec.ts tests/e2e/long-session-lifecycle-faults.spec.ts`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-lifecycle-barrier.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/a2/lifecycle-fault-matrix.json
- harness/specs/fixtures/long-session-development/a2/mutation-recovery-receipts.json
- harness/specs/fixtures/long-session-development/a2/cleanup-readback.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 先以 A1 negative matrix 复现，再修 actual Host/Main/runtime 调用链；主 store 与旧拆分模块的差异要明确归属。
- 不复制 delete journal 成第二生命周期真源，所需 archive intent 属于现有 session mutation owner。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

