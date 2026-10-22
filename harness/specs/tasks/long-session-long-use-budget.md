---
lifecycleStatus: planned
id: long-session-long-use-budget
title: 测量长会话加载、常驻资源与通知预算
program: long-session-development-20261022
taskKey: F2
phase: F
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 防止长期入口越用越慢、后台消息越积越多，用新样本测量预算而非复用旧性能 PASS。
contractIndex: harness/specs/tasks/long-session-development-plan.md
dependsOnTasks:
  - F1
touchedAreas:
  - harness/specs/tasks/long-session-long-use-budget.md
  - harness/specs/tasks/long-session-development-plan.md
  - src/stores/chat.ts
  - src/stores/chat/session-label-hydration.ts
  - src/components/layout/Sidebar.tsx
  - electron/services/sessions-api.ts
  - openclaw_runtime/src/sessions/session-admission-registry.ts
  - tests/unit/chat-session-label-budget.test.ts
  - tests/unit/session-summary-bounded-read.test.ts
  - harness/specs/fixtures/tf0423-session-loading/probe.mjs
  - tests/unit/long-session-long-use-budget.test.ts
  - harness/specs/fixtures/long-session-development/f2/**
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
  - 防止长期入口越用越慢、后台消息越积越多，用新样本测量预算而非复用旧性能 PASS。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/chat-session-label-budget.test.ts tests/unit/session-summary-bounded-read.test.ts tests/unit/session-search-modal-performance.test.tsx --maxWorkers=1
  - pnpm exec vitest run tests/unit/long-session-long-use-budget.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-long-use-budget.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-long-use-budget.test.ts
acceptance:
  - 冻结并运行当前候选的至少 333 会话和长 transcript fixture，记录加载/切换/压缩/续接 P50/P95、实际字节、summary 调用/keys、long task 和原始样本。
  - 五分钟 idle RSS 曲线与至少 50 轮 lifecycle 的 owner/cache/listener counts 读盘可重算；没有持续增长与 scope 活跃残留；显式 GC 门缺失直接失败不猜测。
  - 重复 completion、无变化跟进、隐藏 UI 不制造重复通知/后台工作；每 batch 一次有意义结果，paused/expired 队列保持有界。
  - 回归预算在测量前固定；未测平台/live-provider/current packaged 仍明确 unmeasured，不能把合成 fixture 认作真人长期使用。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**F2 · 测量长会话加载、常驻资源与通知预算**

防止长期入口越用越慢、后台消息越积越多，用新样本测量预算而非复用旧性能 PASS。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段六：完成长程自动验收与声明收口。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- F1：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-long-use-budget.md`。

**实现和核验入口**

- src/stores/chat.ts
- src/stores/chat/session-label-hydration.ts
- src/components/layout/Sidebar.tsx
- electron/services/sessions-api.ts
- openclaw_runtime/src/sessions/session-admission-registry.ts
- tests/unit/chat-session-label-budget.test.ts
- tests/unit/session-summary-bounded-read.test.ts
- harness/specs/fixtures/tf0423-session-loading/probe.mjs

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 冻结并运行当前候选的至少 333 会话和长 transcript fixture，记录加载/切换/压缩/续接 P50/P95、实际字节、summary 调用/keys、long task 和原始样本。
2. 五分钟 idle RSS 曲线与至少 50 轮 lifecycle 的 owner/cache/listener counts 读盘可重算；没有持续增长与 scope 活跃残留；显式 GC 门缺失直接失败不猜测。
3. 重复 completion、无变化跟进、隐藏 UI 不制造重复通知/后台工作；每 batch 一次有意义结果，paused/expired 队列保持有界。
4. 回归预算在测量前固定；未测平台/live-provider/current packaged 仍明确 unmeasured，不能把合成 fixture 认作真人长期使用。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/chat-session-label-budget.test.ts tests/unit/session-summary-bounded-read.test.ts tests/unit/session-search-modal-performance.test.tsx --maxWorkers=1`
- `pnpm exec vitest run tests/unit/long-session-long-use-budget.test.ts --maxWorkers=1`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-long-use-budget.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/f2/long-use-before-after.json
- harness/specs/fixtures/long-session-development/f2/rss-and-owner-counts.json
- harness/specs/fixtures/long-session-development/f2/notification-budget.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 复用 TF-0423 probe 的 source，不读取其旧 before/after 作为本节点新结果。
- 超过基线预算先定向优化，不为本节点扩大 fast gate 或放宽既有性能限值。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

