---
id: task-forest-autoclose-policy
title: Task Forest 自动收口门与角色固定（agent 主线开发 / 用户发布者）
diffBase: 600928a2c6f305e9db8518102d8b18423757c4a4
intent: 把「证据链完整即自动收口、不再等待人工确认」与「agent 是主线开发者、用户是发布者」固化为可校验策略：新增 harness 规则与任务规格，改写 AGENTS.md、方向文档与接力文档，任务图新增 D8 决策并把依赖用户回答的验收口径改为可从仓库记录重建。
touchedAreas:
  - AGENTS.md
  - harness/specs/rules/task-forest-autoclose-and-roles.md
  - harness/specs/tasks/task-forest-autoclose-policy.md
  - docs/dev/qa-synthesis-roadmap-20260922.md
  - docs/dev/showcase-overview-20260922.md
  - docs/dev/handoffs/LATEST.md
  - .agent-workbench/task-forest/**
ownedPaths:
  - AGENTS.md
  - harness/specs/rules/task-forest-autoclose-and-roles.md
  - harness/specs/tasks/task-forest-autoclose-policy.md
  - docs/dev/qa-synthesis-roadmap-20260922.md
  - docs/dev/showcase-overview-20260922.md
  - docs/dev/handoffs/LATEST.md
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - 接力 agent 在证据链完整、验收条目逐条可核对时自行保存并应用收口提案，不再向用户索要 apply 确认。
  - 节点验收口径不含「向用户提问」；贡献归属等事实从提交、diff、任务图历史与偏差账本重建。
  - 只有对外发布、凭证轮换、不可逆操作、产品锁或默认值变更、真人证据声明、范围变更才停下询问用户。
  - 自动收口不降低证据要求：缺证据、证据过期或互相矛盾的节点保持未完成并写明缺口。
requiredProfiles:
  - fast
requiredRules:
  - task-forest-autoclose-and-roles
  - docs-sync
humanEvidence: not-required
requiredTests:
  - git diff --check
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/task-forest-autoclose-policy.md
acceptance:
  - harness/specs/rules/task-forest-autoclose-and-roles.md 存在，R1–R6 覆盖角色固定、验收可核对性、自动收口门、证据链定义、必须停下询问的清单、禁止自宣完成。
  - AGENTS.md 的 COMPASS 段落写明该覆盖在本仓库生效并指向规则 spec，不修改其他既有政策。
  - docs/dev/qa-synthesis-roadmap-20260922.md §7 不再要求用户确认 apply；更新记录登记本次改口与依据。
  - Task Forest 新增 D8 决策节点并由收尾里程碑 derived_from 引用；TF-0236 验收不再依赖用户回答；validate 与 export 通过。
  - pnpm harness validate --spec harness/specs/tasks/task-forest-autoclose-policy.md 在不带 --no-diff 时 exit 0。
docs:
  required: true
  files:
    - harness/specs/rules/task-forest-autoclose-and-roles.md
    - docs/architecture-overview.md
---

用户 2026-09-22 裁定：接力角色固定为「agent 是主线开发者，用户是发布者」。用户不参与
逐节点的设计问答，只审查已完成、有证据的结果；因此任何要求用户回答内容问题的验收口径
都必须改写为可从仓库记录重建，或降级为限制。

同时取消收口前的人工确认门：证据链完整、验收条目逐项核对通过、提案基线未漂移、结论
自洽时，agent 直接保存并应用提案，再 validate/export 并把状态与证据入库。等待用户重复
agent 自己已完成的核验不属于本工作流。

本任务不改变证据标准、产品锁、默认值或任何既有验收条件；它只改变谁来做核验与何时收口。
