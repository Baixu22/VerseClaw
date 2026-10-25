---
lifecycleStatus: completed
id: long-session-final-acceptance
title: 聚合独立验收、能力声明与后续推广边界
program: long-session-development-20261022
taskKey: F3
phase: F
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 以当前候选闭合长期会话开发，确保所有能力、后端范围、NO-GO 和未测边界与产品宣称一致。
contractIndex: harness/specs/tasks/long-session-development-plan.md
diffBase: fb2ba6f379259854093dacc248e1d8fffc044d94
dependsOnTasks:
  - F2
touchedAreas:
  - harness/specs/tasks/long-session-final-acceptance.md
  - harness/specs/tasks/long-session-development-plan.md
  - docs/clawx-product-semantics.md
  - docs/architecture-overview.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - shared/capability-claims.ts
  - scripts/long-session-final-acceptance-evidence.mjs
  - package.json
  - artifacts/**
  - docs/**
  - electron/**
  - harness/**
  - openclaw_runtime/**
  - shared/**
  - src/**
  - tests/**
  - scripts/**
  - README*.md
  - .gitattributes
  - .gitignore
  - harness/specs/fixtures/long-session-development/**
  - electron-builder.yml
  - shared/product-semantics.ts
  - scripts/repository-artifacts.json
  - harness/specs/fixtures/long-session-development/f3/**
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
  - 以当前候选闭合长期会话开发，确保所有能力、后端范围、NO-GO 和未测边界与产品宣称一致。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run repo:artifacts:check
  - pnpm run repo:evidence:check
  - pnpm harness validate --spec harness/specs/tasks/long-session-final-acceptance.md
  - git diff --check
plannedTests:

acceptance:
  - 所有六阶段 criterion 逐项读盘；16 个执行节点各有 current candidate/input/command/exit/counts/artifact/negative proof，历史证据不重签。
  - 干净 scoped candidate、uncached typecheck、contract/comms、同范围真实 Electron E2E、secret scan 与 artifact/hash verify 完整；没有用目录存在或最终回答作验收。
  - 产品语义/README/四語 UI/model capability claims 与 current backend 范围一致，retired/unavailable/shadow/NO-GO 不冒充已实现能力。
  - 核心闭环自动验收后通过合法 proposal 收口并 validate/export；公开发布、全量默认/产品锁/独立 Project 与云执行不在本 node 自动授权。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**F3 · 聚合独立验收、能力声明与后续推广边界**

以当前候选闭合长期会话开发，确保所有能力、后端范围、NO-GO 和未测边界与产品宣称一致。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段六：完成长程自动验收与声明收口。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- F2：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-final-acceptance.md`。

**实现和核验入口**

- docs/clawx-product-semantics.md
- docs/architecture-overview.md
- README.md
- README.zh-CN.md
- README.ja-JP.md
- shared/capability-claims.ts
- shared/product-semantics.ts
- scripts/repository-artifacts.json

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 所有六阶段 criterion 逐项读盘；16 个执行节点各有 current candidate/input/command/exit/counts/artifact/negative proof，历史证据不重签。
2. 干净 scoped candidate、uncached typecheck、contract/comms、同范围真实 Electron E2E、secret scan 与 artifact/hash verify 完整；没有用目录存在或最终回答作验收。
3. 产品语义/README/四語 UI/model capability claims 与 current backend 范围一致，retired/unavailable/shadow/NO-GO 不冒充已实现能力。
4. 核心闭环自动验收后通过合法 proposal 收口并 validate/export；公开发布、全量默认/产品锁/独立 Project 与云执行不在本 node 自动授权。

**门禁与待交付检查**

- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm run repo:artifacts:check`
- `pnpm run repo:evidence:check`
- `pnpm harness validate --spec harness/specs/tasks/long-session-final-acceptance.md`
- `git diff --check`

复用 existing checks；必要新增故障验证先写入本合同，不能静默跳过 negative acceptance。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/f3/acceptance.json
- harness/specs/fixtures/long-session-development/f3/acceptance.md
- harness/specs/fixtures/long-session-development/f3/SHA256SUMS

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 独立复核由另一次 agent/script 回读原件执行，不要求所有者操作或真人 verdict。
- 未达 criterion 的任务保持未完成并写技术缺口；算法 D3 keep-baseline 不视为缺失的产品功能。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

