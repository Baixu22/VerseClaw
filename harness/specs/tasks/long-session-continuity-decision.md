---
lifecycleStatus: completed
id: long-session-continuity-decision
title: 依据配对证据选定连续策略并保持冻结默认
program: long-session-development-20261022
taskKey: D3
phase: D
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 明确保留基线、继续实验还是提供一个显式策略，防止长期会话自动成为算法扩展工程。
contractIndex: harness/specs/tasks/long-session-development-plan.md
diffBase: 30a9eaeb0
dependsOnTasks:
  - D2
touchedAreas:
  - harness/specs/tasks/long-session-continuity-decision.md
  - harness/specs/tasks/long-session-development-plan.md
  - scripts/long-session-continuity-decision.mjs
  - package.json
  - harness/specs/tasks/context-lifecycle-exploration.md
  - docs/dev/default-config-matrix.md
  - docs/clawx-product-semantics.md
  - harness/specs/fixtures/long-session-development/d3/**
requiredRules:
  - runtime-lifecycle-governance-boundary
  - identity-scope-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - context-family-boundary
  - context-runtime-kit-boundary
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 明确保留基线、继续实验还是提供一个显式策略，防止长期会话自动成为算法扩展工程。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/default-config-matrix.test.ts tests/unit/context-lifecycle-boundary.test.ts --maxWorkers=1
  - pnpm long-session:d3:decision
  - pnpm long-session:d3:decision:check
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-continuity-decision.md
  - git diff --check
plannedTests:

acceptance:
  - 逐条回读 D2 manifest/paired outputs，决策为 keep-baseline、retain-experiment 或 scoped-opt-in 中之一；每条理由对应可核验证据。
  - 保留基线/NO-GO 是有效收口，不要求为了完成计划引入异步压缩、价值剔除或摘要树。
  - 任何 adopted 策略必须继续使用现有 context/native owner、明确适用 backend、rollback、故障 fallback 与单独执行 spec；本节点只作决策，不凭规划激活实现。
  - 所有被冻结 product defaults/locks 与历史 TF-0424 verdict 不变；若收益只有翻冻结值/独立 Project/新执行环境才能实现，单列重大决策材料，不让核心闭环等真人验收。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**D3 · 依据配对证据选定连续策略并保持冻结默认**

明确保留基线、继续实验还是提供一个显式策略，防止长期会话自动成为算法扩展工程。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段四：保持上下文连续性并评测策略。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- D2：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-continuity-decision.md`。

**实现和核验入口**

- harness/specs/tasks/context-lifecycle-exploration.md
- docs/dev/default-config-matrix.md
- docs/clawx-product-semantics.md

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 逐条回读 D2 manifest/paired outputs，决策为 keep-baseline、retain-experiment 或 scoped-opt-in 中之一；每条理由对应可核验证据。
2. 保留基线/NO-GO 是有效收口，不要求为了完成计划引入异步压缩、价值剔除或摘要树。
3. 任何 adopted 策略必须继续使用现有 context/native owner、明确适用 backend、rollback、故障 fallback 与单独执行 spec；本节点只作决策，不凭规划激活实现。
4. 所有被冻结 product defaults/locks 与历史 TF-0424 verdict 不变；若收益只有翻冻结值/独立 Project/新执行环境才能实现，单列重大决策材料，不让核心闭环等真人验收。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/default-config-matrix.test.ts tests/unit/context-lifecycle-boundary.test.ts --maxWorkers=1`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-continuity-decision.md`
- `git diff --check`

复用 existing checks；必要新增故障验证先写入本合同，不能静默跳过 negative acceptance。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/d3/continuity-strategy-decision.json
- harness/specs/fixtures/long-session-development/d3/promotion-or-retention-boundary.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- D3 选择基线时后续阶段可继续，用实装手动/原生 compaction 支持连续性，不把算法推广作为根节点强制出口。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

