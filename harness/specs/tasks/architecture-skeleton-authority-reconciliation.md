---
id: architecture-skeleton-authority-reconciliation
lifecycleStatus: active
title: 语义权威矩阵逐条对齐与冲突裁定
type: task
intent: 把 shared/ 下并行的语义注册表逐条对齐到同一组件身份，输出「一处声明、多处引用」的映射与冲突清单；对同一组件出现冲突 owner / 冲突 default / 冲突 authority 的情况给出裁定或显式豁免。本轮只做只读对齐与裁定，不合并、不删除任何注册表。
requiredRules:
  - contract-first-boundary
  - capability-owner-resolution
  - repository-artifact-retention
ownedPaths:
  - docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md
  - harness/specs/tasks/architecture-skeleton-authority-reconciliation.md
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/architecture-skeleton-authority-reconciliation.md
  - pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-authority-reconciliation.md --no-diff
  - pnpm repo:evidence:check
  - git diff --check
acceptance:
  - 对齐覆盖 shared/component-authority-manifest.ts、shared/dcs/component-disposition-catalog.ts、shared/capability-claims.ts、shared/reliability-boundaries.ts、shared/sensitive-content-boundary.ts、shared/product-semantics.ts 六份注册表中的全部条目。
  - 输出同一组件的跨表映射，列出每份表中该组件的 id 与声明的 owner / default / authority 字段。
  - 逐条列出冲突项；每个冲突给出裁定（以哪份表为准）或显式豁免并写明理由与复核条件。
  - 无法从任一份表定位到 owner 的组件记为 gap，不猜测、不默认通过。
  - 不修改任何注册表、不合并表、不新增注册表、不改运行时行为与默认值。
nonGoals:
  - 不合并或删除任何语义注册表。
  - 不新增统一本体、图存储、推理或第二真源。
  - 不新增 Host API、UI、package script 或运行时组件。
  - 不改变产品锁、默认矩阵、发布状态或 GA 口径。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/CHARTER.md
---

# 语义权威矩阵逐条对齐与冲突裁定

## 背景

架构骨架收敛批次 B 的第一步。见 `docs/dev/architecture-skeleton/CHARTER.md` 第 1.2 节与第 5 节。

`shared/` 顶层已有 9 个带「主张 / 边界 / 证据」结构的注册表，另有权威矩阵与处置矩阵。它们各自有测试，但彼此之间没有统一的身份与 owner 约定。

## 本轮范围

只读对齐 + 冲突裁定。产出 `docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md`。

## 必须回答的问题

1. 六份注册表各自有多少条目，条目 id 的命名约定是什么。
2. 同一组件在哪些表中出现，各表声明的 owner / default / authority 是否一致。
3. 哪些组件在某一表中存在但在权威矩阵中缺失（或反之）。
4. 每个冲突的裁定与理由；无法裁定的记为 gap 并写清缺什么证据。

## 已知的规模基线（本轮实测，需在文档中复核）

- 权威矩阵：35 个组件，`ComponentAuthorityManifest/v1`
- 处置矩阵：54 项（internal 24 / default 13 / advanced 12 / retired 5）
- 能力主张：45 条
- 可靠性边界：7 个子系统
- 敏感面：7 个
- 产品语义：7 概念 / 6 关系

## 边界

- 只读。不得修改上述任何注册表。
- 不得新增注册表或合并表。
- 不得把「对齐」表述为「已统一」。

## 验收

见 frontmatter `acceptance`。