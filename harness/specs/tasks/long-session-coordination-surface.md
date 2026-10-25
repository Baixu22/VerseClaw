---
lifecycleStatus: completed
id: long-session-coordination-surface
title: 把长期协作入口接到现有会话、任务与活动界面
program: long-session-development-20261022
taskKey: C4
phase: C
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 交付可使用的长期入口，减少跨 session 的手工协调，同时保持源记录和任务状态可打开审查。
contractIndex: harness/specs/tasks/long-session-development-plan.md
dependsOnTasks:
  - C3
diffBase: fccb22474
touchedAreas:
  - harness/specs/tasks/long-session-coordination-surface.md
  - harness/specs/tasks/long-session-development-plan.md
  - docs/clawx-product-semantics.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - src/pages/Chat/index.tsx
  - src/components/layout/Sidebar.tsx
  - src/pages/Chat/SessionActivityPanel.tsx
  - src/pages/Chat/long-session-coordination.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - src/pages/Chat/TeamOrchestrationCard.tsx
  - src/stores/chat.ts
  - src/stores/session-activity.ts
  - src/lib/host-api.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/long-session-coordination-surface.test.ts
  - tests/unit/session-activity-panel.test.tsx
  - tests/e2e/long-session-coordination.spec.ts
  - tests/e2e/chat-session-handoff.spec.ts
  - tests/e2e/chat-session-fork.spec.ts
  - harness/specs/fixtures/long-session-development/c4/**
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
  - 交付可使用的长期入口，减少跨 session 的手工协调，同时保持源记录和任务状态可打开审查。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/sidebar-session-context-menu.test.tsx tests/unit/session-activity-panel.test.tsx tests/unit/long-session-coordination-surface.test.ts tests/unit/role-orchestration-methods.test.ts --maxWorkers=1
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/chat-session-handoff.spec.ts tests/e2e/chat-session-fork.spec.ts tests/e2e/long-session-coordination.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-coordination-surface.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-coordination-surface.test.ts
  - tests/unit/session-activity-panel.test.tsx
  - tests/e2e/long-session-coordination.spec.ts
acceptance:
  - 通过现有 Sidebar/Chat 显式打开稳定主会话，提供任务/worker/结果引用、状态与必要的暂停/继续入口，不创建第二任务列表 authority。
  - draft、accepted、running、waiting、failed/cancelled、reported、accepted-by-task 的表示符合 actual receipts，worker transcript/Task Ledger/evidence 可定位。
  - 切换、最小化、后台工作、键盘、四语、窄屏与完成提示在真实 Electron 操作中通过；普通会话原有行为不回归。
  - 暂停/删除/后端不可用显示真实限制；无新结果保持安静；UI 只能通过 typed host-api 操作。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**C4 · 把长期协作入口接到现有会话、任务与活动界面**

交付可使用的长期入口，减少跨 session 的手工协调，同时保持源记录和任务状态可打开审查。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段三：交付单工作区长期协调入口。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- C3：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-coordination-surface.md`。

**实现和核验入口**

- src/pages/Chat/index.tsx
- src/components/layout/Sidebar.tsx
- src/pages/Chat/SessionActivityPanel.tsx
- src/components/agents/RolesOrchestrationPanel.tsx
- src/pages/Chat/TeamOrchestrationCard.tsx
- src/stores/chat.ts
- src/stores/session-activity.ts
- src/lib/host-api.ts
- shared/i18n/locales/en/chat.json
- shared/i18n/locales/zh/chat.json
- shared/i18n/locales/ja/chat.json
- shared/i18n/locales/ru/chat.json

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 通过现有 Sidebar/Chat 显式打开稳定主会话，提供任务/worker/结果引用、状态与必要的暂停/继续入口，不创建第二任务列表 authority。
2. draft、accepted、running、waiting、failed/cancelled、reported、accepted-by-task 的表示符合 actual receipts，worker transcript/Task Ledger/evidence 可定位。
3. 切换、最小化、后台工作、键盘、四语、窄屏与完成提示在真实 Electron 操作中通过；普通会话原有行为不回归。
4. 暂停/删除/后端不可用显示真实限制；无新结果保持安静；UI 只能通过 typed host-api 操作。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/sidebar-session-context-menu.test.tsx tests/unit/session-activity-panel.test.tsx tests/unit/role-orchestration-methods.test.ts --maxWorkers=1`
- `pnpm run i18n:lint`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/chat-session-handoff.spec.ts tests/e2e/chat-session-fork.spec.ts tests/e2e/long-session-coordination.spec.ts`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-coordination-surface.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/c4/coordination-ui-journeys.json
- harness/specs/fixtures/long-session-development/c4/coordination-ui-screenshots.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 本阶段完成后才宣称已有长期协调 MVP；C1-C3 的孤立单测不能提前宣称产品闭环。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

