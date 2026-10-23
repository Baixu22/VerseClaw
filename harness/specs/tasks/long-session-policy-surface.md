---
lifecycleStatus: active
id: long-session-policy-surface
title: 在现有会话入口展示配置来源和运行限制
program: long-session-development-20261022
taskKey: B2
phase: B
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 让用户能看到当前会话为什么采用这些配置、哪些动作可用以及如何恢复，不增加一套复杂管理页面。
contractIndex: harness/specs/tasks/long-session-development-plan.md
dependsOnTasks:
  - B1
touchedAreas:
  - harness/specs/tasks/long-session-policy-surface.md
  - harness/specs/tasks/long-session-development-plan.md
  - src/pages/Chat/index.tsx
  - src/pages/Chat/SessionActivityPanel.tsx
  - src/pages/Settings/sections/RecoverySettingsSection.tsx
  - src/pages/Chat/session-continuity.ts
  - src/lib/host-api.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - src/styles/globals.css
  - tests/e2e/long-session-policy-surface.spec.ts
  - tests/e2e/chat-session-derived.spec.ts
  - tests/e2e/session-activity-background-read.spec.ts
  - harness/specs/fixtures/long-session-development/b2/**
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
  - 让用户能看到当前会话为什么采用这些配置、哪些动作可用以及如何恢复，不增加一套复杂管理页面。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/session-activity-panel.test.tsx tests/unit/chat-session-continuity.test.ts --maxWorkers=1
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/chat-session-derived.spec.ts tests/e2e/session-activity-background-read.spec.ts tests/e2e/long-session-policy-surface.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-policy-surface.md
  - git diff --check
plannedTests:
  - tests/e2e/long-session-policy-surface.spec.ts
acceptance:
  - 复用 Composer/活动/Recovery 的同一入口展示 backend、生效值、配置来源和覆盖/忽略原因，unknown 以真实状态呈现。
  - 清楚区分 abort 与 session stop、UI 活动保留窗口与 transcript/资源 TTL、会话分叉与工作树隔离。
  - 切换 session/backend、Gateway 重启和授权变化后不显示上个 scope 的快照；旧请求不会覆盖新选择。
  - 四语言文本、设计 token、键盘/窄屏与真实 Electron E2E 覆盖在同一变更集，不能只以类型通过验收 UI。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**B2 · 在现有会话入口展示配置来源和运行限制**

让用户能看到当前会话为什么采用这些配置、哪些动作可用以及如何恢复，不增加一套复杂管理页面。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段二：让会话配置与实际运行状态可见。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- B1：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-policy-surface.md`。

**实现和核验入口**

- src/pages/Chat/index.tsx
- src/pages/Chat/SessionActivityPanel.tsx
- src/pages/Settings/sections/RecoverySettingsSection.tsx
- src/pages/Chat/session-continuity.ts
- src/lib/host-api.ts
- shared/i18n/locales/en/chat.json
- shared/i18n/locales/zh/chat.json
- shared/i18n/locales/ja/chat.json
- shared/i18n/locales/ru/chat.json
- src/styles/globals.css

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 复用 Composer/活动/Recovery 的同一入口展示 backend、生效值、配置来源和覆盖/忽略原因，unknown 以真实状态呈现。
2. 清楚区分 abort 与 session stop、UI 活动保留窗口与 transcript/资源 TTL、会话分叉与工作树隔离。
3. 切换 session/backend、Gateway 重启和授权变化后不显示上个 scope 的快照；旧请求不会覆盖新选择。
4. 四语言文本、设计 token、键盘/窄屏与真实 Electron E2E 覆盖在同一变更集，不能只以类型通过验收 UI。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/session-activity-panel.test.tsx tests/unit/chat-session-continuity.test.ts --maxWorkers=1`
- `pnpm run i18n:lint`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/chat-session-derived.spec.ts tests/e2e/session-activity-background-read.spec.ts tests/e2e/long-session-policy-surface.spec.ts`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-policy-surface.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/b2/policy-ui-results.json
- harness/specs/fixtures/long-session-development/b2/policy-ui-screenshots.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 优先一个现有 disclosure/设置区，不造平行 Session Settings 页面。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。
