---
lifecycleStatus: active
id: agent-first-evaluation-framework
title: Agent-first 可插拔自评框架核心契约（被测对象 / 套件 / 评分器 + 闭环）
intent: 在不改写 TF-0589 已密封验收语义的前提下，把 Agent-first 从"单候选验收流水线"提升为可插拔、可扩展、可闭环的自我评测框架：冻结被测对象适配器、评测套件注册表、评分器注册表、组合与插入契约、证据存储契约，以及评测结果回流到改进信号与回归晋级的闭环接口。本节点只建立体系契约与骨架，不开始对当前系统打分，也不生成候选。
touchedAreas:
  - harness/specs/tasks/agent-first-evaluation-framework.md
  - harness/specs/guides/agent-first-acceptance.md
  - harness/specs/fixtures/agent-first-framework/**
  - scripts/lib/agent-first-evaluation-framework.mjs
  - scripts/lib/agent-first-evaluation-framework.d.mts
  - scripts/agent-first-framework-check.mjs
  - tests/unit/agent-first-evaluation-framework.test.ts
requiredProfiles:
  - fast
requiredRules:
  - repository-artifact-retention
  - docs-sync
  - agent-engineering-acceptance-boundary
  - reliability-aggregation-boundary
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/agent-first-evaluation-framework.test.ts --maxWorkers=1
  - node scripts/agent-first-framework-check.mjs
  - pnpm harness validate --spec harness/specs/tasks/agent-first-evaluation-framework.md
acceptance:
  - 被测对象适配器接口冻结：identity/setup/invoke/observe/teardown 缺一即 run=invalid；observe 不得从 agent 自身文本读最终状态。
  - 套件注册表冻结：每个 suite 声明 id、version、provenance、public/held-out split、task schema 版本、k、minCases、超时、重试与 token/turn/tool 预算；suite 不得由被测对象编写。
  - 评分器注册表冻结：每个 grader 声明 id、version、kind(deterministic|heuristic|rubric)、precedence、校准 fixture 引用；rubric 另需冻结 prompt digest；确定性 grader 优先于 rubric。
  - 组合与插入契约冻结：profile = subject × suite × grader set × runner config × resource envelope；新增 subject/suite/grader 只允许"注册表条目 + 校准 fixture"，禁止改核心；未注册项不隐式落默认，直接 fail closed。
  - TF-0589 的八维度 / 十四门禁被登记为**一个** acceptance profile，而不是硬编码进框架；密封矩阵、来源与 verdict 不被本节点改写。
  - 闭环接口冻结：verdict+residual → 改进信号（定位到 dimension/gate/task 并附证据链）→ 候选（由自改进层拥有）→ 对同一冻结套件与 held-out 重评 → 饱和的 capability 任务晋级为 regression；框架自身不生成候选、不改默认值/锁、不批准发布。
  - 负例全部 fail closed：缺失注册字段、未知 subject、未注册 suite、重复 grader id、subject 自写 grader、observe 自证、held-out 被候选写入。
  - 未跑任何评测时报告 not-run，绝不写 pass；不改产品默认值、锁、approval、release 状态。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run、凭据扫描与 SHA256SUMS 回读通过。
expectedUserBehavior:
  - 维护者能为一个新的被测对象或评测面新增一个注册表条目 + 校准 fixture，而无需改动框架核心。
  - 未注册或自证的评测对象会被拒绝，不能绕过框架直接给出 pass。
  - 读者能区分"体系已建好"与"已开始评测"：无当前 run 的 profile 一律 not-run。
docs:
  required: true
  files:
    - harness/specs/guides/agent-first-acceptance.md
---

# Agent-first 可插拔自评框架核心契约

## 这个节点解决什么

TF-0588/TF-0589 冻结的是**一次候选验收的语义**：八维度、十四门禁、证据包与 verdict 状态。
它是正确的底层，但只描述"对一个候选做一次完整验收"，并没有描述**框架本身**：

- 没有"被测对象"的抽象——评测硬绑在 ClawX Electron / Windows 包上；
- 没有套件与评分器的注册与发现机制——语料是一个固定集合，不是可插入的一项；
- 没有组合与插入契约——新增一个评测面要不要改核心，没有答案；
- 没有闭环——验收结论如何回流成改进信号、如何把饱和任务晋级为回归，没有接口。

本节点只补这四件事，形成 Layer 1（框架核心）与 Layer 3（闭环接口）。它**不**改写
TF-0589 的密封矩阵，**不**生成候选，**不**开始对当前系统打分。

## 分层

```text
Layer 0  验收语义      shipped (TF-0589)
Layer 1  框架核心      subject adapter | suite registry | grader registry | runner | evidence store
Layer 2  已注册 profile acceptance profile | RSI baseline profile | future memory/browser/skill profiles
Layer 3  闭环          verdict -> improvement signal -> candidate -> re-evaluation -> regression graduation
```

## 被测对象适配器

评测从不直接伸进产品内部。它只调用一个已注册的 **subject adapter**，暴露固定最小面：
`identity()` / `setup(profile)` / `invoke(task)` / `observe()` / `teardown()`。
缺方法、缺 identity 字段，或由被测对象用自身输出充当 `observe()`，一律 `invalid`。

## 套件与评分器注册表

- **suite**：`id`、`version`、provenance、public/held-out split、task schema 版本、`k`、
  `minCases`、超时、重试、token/turn/tool 预算。
- **grader**：`id`、`version`、kind、precedence、校准 fixture 引用；rubric grader 另需冻结
  prompt digest。确定性 grader 优先于 rubric。

suite 与 grader 都不得由被测对象编写；held-out split 对 grader 只读，对候选不可写。

## 组合与插入

```text
profile = subject adapter x suite x grader set x runner config x resource envelope
```

profile 才是被计划、运行、封存与独立复验的单位。新增 subject/suite/grader 只需"注册表条目 +
校准 fixture"，不得改核心；未注册项不隐式落默认，直接 fail closed。TF-0589 的八维度与十四门禁
登记为**一个** acceptance profile。

## 闭环

```text
verdict + residuals
  -> improvement signal（定位到 dimension/gate/task，附证据链）
  -> candidate change（由自改进层拥有）
  -> 对同一冻结 suite 与 held-out split 重评
  -> regression graduation（饱和的 capability 任务晋级为 regression 任务）
```

框架不生成候选、不改产品默认值或锁、不批准发布。候选生成属于自改进（RSI）层；框架只保证
候选被它无法编辑的判据度量。

## 边界

- 不改产品默认值、锁、approval、release 状态。
- 建立框架 ≠ 开始评测：没有当前 run 的 profile 一律 `not-run`，绝不写 `pass`。
- TF-0589 的密封矩阵、来源与 verdict 是历史记录，本层不改写。
- 与 RSI 层的关系：框架提供可插拔 runner、注册表与 verdict；RSI 提供候选生成与晋级策略
  （`harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json`）。两者共享同一冻结套件，
  不各建一份真源。
