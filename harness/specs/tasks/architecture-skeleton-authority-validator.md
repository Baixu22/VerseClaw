---
id: architecture-skeleton-authority-validator
lifecycleStatus: active
title: 唯一 owner 冲突的确定性校验与门禁接入
type: task
intent: 把上一节点裁定的「唯一 owner」规则实现为确定性校验：同一组件出现冲突 owner / 冲突 default / 冲突 authority 时 fail-closed，允许显式登记的豁免并记录理由；校验接入既有门禁，坏例不能产生有效 pass。
requiredRules:
  - contract-first-boundary
  - capability-owner-resolution
  - repository-artifact-retention
ownedPaths:
  - scripts/check-semantic-authority.mjs
  - scripts/check-semantic-authority.d.mts
  - tests/unit/semantic-authority-consistency.test.ts
  - docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md
  - harness/specs/tasks/architecture-skeleton-authority-validator.md
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/architecture-skeleton-authority-validator.md
  - pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-authority-validator.md
  - pnpm exec vitest run tests/unit/semantic-authority-consistency.test.ts
  - git diff --check
acceptance:
  - 校验器从磁盘读取六份注册表并产出结构化诊断，定位到 componentId / 表 / 字段 / 规则。
  - 正例（当前仓库的真实注册表）通过；每个已裁定冲突要么在校验器中被显式豁免，要么被修正而非放宽。
  - 独立负例证明：冲突 owner、冲突 default、冲突 authority、表缺失组件、豁免缺理由五类输入分别被拒绝且诊断可定位。
  - 校验接入既有门禁入口；不新增 package script 时，须在既有 harness 或 vitest 路径中被真实调用，且空报告/漏调用不能产生有效 pass。
  - 现有注册表条目、运行时行为、默认值与消费点保持不变；不新增第二真源。
nonGoals:
  - 不合并或删除注册表，不新增统一本体或图存储。
  - 不新增产品模块、Host API、UI 或运行时组件。
  - 不改变产品锁、默认矩阵、发布状态或 GA 口径。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/CHARTER.md
---

# 唯一 owner 冲突的确定性校验与门禁接入

## 背景

架构骨架收敛批次 B 的第二步。依赖 `architecture-skeleton-authority-reconciliation` 的映射与裁定。

## 本轮范围

把裁定变成可执行校验。这是骨架收敛里「语义唯一」的机械保证点。

## 校验规则（最小集）

1. 同一 componentId 在两份及以上注册表中的 owner 必须一致，或在豁免清单中有理由与复核条件。
2. 同一 componentId 的 default 模式不得互相矛盾（例如一处 `baseline` 一处 `retired`）。
3. authority owner 字段不得把描述性字段当成授权声明。
4. 注册表声明的组件若在权威矩阵中不存在，须显式登记为 gap。

## 负例要求

五类坏例必须各自被拒绝并给出可定位诊断：

- 冲突 owner；
- 冲突 default；
- 冲突 authority；
- 表声明了矩阵中不存在的组件；
- 豁免条目缺理由。

## 集成要求

坏例必须通过真实门禁入口执行（`pnpm harness ...` 或既有 vitest 入口），不能只单测 checker。

## 边界

- 不新增第二真源。校验器只读现有注册表。
- 不改任何运行时行为、默认值或产品锁。

## 验收

见 frontmatter `acceptance`。