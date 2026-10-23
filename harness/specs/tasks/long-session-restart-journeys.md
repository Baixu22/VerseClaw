---
lifecycleStatus: completed
id: long-session-restart-journeys
title: 用自动化跨重启旅程验证长期协作闭环
program: long-session-development-20261022
taskKey: F1
phase: F
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 证明使用者回到长期入口能继续同一件工作，实际 backend、任务和结果在重启后仍对应正确。
contractIndex: harness/specs/tasks/long-session-development-plan.md
diffBase: 98be3a393
dependsOnTasks:
  - E2
touchedAreas:
  - harness/specs/tasks/long-session-restart-journeys.md
  - harness/specs/tasks/long-session-development-plan.md
  - tests/e2e/long-session-restart-journeys.spec.ts
  - scripts/long-session-restart-evidence.mjs
  - electron/services/sessions-api.ts
  - electron/services/session-delete-gate.ts
  - shared/host-api/contract.ts
  - tests/unit/r0-2-sessions-delete-fail.test.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/fixtures/electron-process-cleanup.ts
  - tests/e2e/chat-session-handoff.spec.ts
  - tests/e2e/chat-session-fork.spec.ts
  - tests/e2e/chat-session-compact-range.spec.ts
  - tests/e2e/runtime-lifecycle-governance.spec.ts
  - tests/e2e/long-session-restart-journeys.spec.ts
  - harness/specs/fixtures/long-session-development/f1/**
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
  - 证明使用者回到长期入口能继续同一件工作，实际 backend、任务和结果在重启后仍对应正确。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/workspace-session.test.ts tests/unit/chat-session-continuity.test.ts --maxWorkers=1
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/chat-session-handoff.spec.ts tests/e2e/chat-session-fork.spec.ts tests/e2e/chat-session-compact-range.spec.ts tests/e2e/runtime-lifecycle-governance.spec.ts tests/e2e/long-session-restart-journeys.spec.ts
  - pnpm long-session:f1:evidence -- --observation <journey observation> --gates <gate receipt>
  - pnpm long-session:f1:evidence:check
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-restart-journeys.md
  - git diff --check
plannedTests:
  - tests/e2e/long-session-restart-journeys.spec.ts
acceptance:
  - 至少六条 agent 驱动真实 Electron/Host/Gateway 旅程覆盖双 worker batch、后台/关 UI、应用/Gateway 重启、fork/handoff/compact、revoke、archive/restore/delete 与迟到事件。
  - 至少两个 Workspace 和一个既有普通会话参与隔离对照；跨 scope 泄漏、重复副作用、错误 completed/delivered 声明均为 0。
  - 每旅程回读 Task Ledger、transcript、owner receipts 和资源状态；只在安装了 IPC mocks 的界面测试通过不能证明 runtime 接线。
  - OpenClaw 与可用 native backend 分别标证据等级；没有真实 provider 证据的路线明确 fixture-only/unverified，不扩大最终能力宣称。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**F1 · 用自动化跨重启旅程验证长期协作闭环**

证明使用者回到长期入口能继续同一件工作，实际 backend、任务和结果在重启后仍对应正确。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段六：完成长程自动验收与声明收口。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- E2：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-restart-journeys.md`。

**实现和核验入口**

- tests/e2e/fixtures/electron.ts
- tests/e2e/fixtures/electron-process-cleanup.ts
- tests/e2e/chat-session-handoff.spec.ts
- tests/e2e/chat-session-fork.spec.ts
- tests/e2e/chat-session-compact-range.spec.ts
- tests/e2e/runtime-lifecycle-governance.spec.ts

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 至少六条 agent 驱动真实 Electron/Host/Gateway 旅程覆盖双 worker batch、后台/关 UI、应用/Gateway 重启、fork/handoff/compact、revoke、archive/restore/delete 与迟到事件。
2. 至少两个 Workspace 和一个既有普通会话参与隔离对照；跨 scope 泄漏、重复副作用、错误 completed/delivered 声明均为 0。
3. 每旅程回读 Task Ledger、transcript、owner receipts 和资源状态；只在安装了 IPC mocks 的界面测试通过不能证明 runtime 接线。
4. OpenClaw 与可用 native backend 分别标证据等级；没有真实 provider 证据的路线明确 fixture-only/unverified，不扩大最终能力宣称。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/workspace-session.test.ts tests/unit/chat-session-continuity.test.ts --maxWorkers=1`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/chat-session-handoff.spec.ts tests/e2e/chat-session-fork.spec.ts tests/e2e/chat-session-compact-range.spec.ts tests/e2e/runtime-lifecycle-governance.spec.ts tests/e2e/long-session-restart-journeys.spec.ts`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-restart-journeys.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/f1/restart-journey-results.json
- harness/specs/fixtures/long-session-development/f1/host-runtime-receipts.json
- harness/specs/fixtures/long-session-development/f1/ui-evidence-index.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 每次 E2E 使用独立 userData/run root 与已刷新构建；必要 agent 自动点击与判定如实标记 driven_by=agent。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

