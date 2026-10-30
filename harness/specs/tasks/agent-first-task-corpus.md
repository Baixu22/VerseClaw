---
lifecycleStatus: active
id: agent-first-task-corpus
title: Agent First 任务语料、参考执行路径与 grader 校准
intent: 完成 TF-0590，复用仓内真实 QA 流程和失败回归定义建立可定位的初始任务集合，验证确定性 grader 的正例、反例和 unknown 语义，冻结 public/held-out 切分供执行器使用。
diffBase: bc6685aa9a7a256b68fd356075c72b658485ec6f
touchedAreas:
  - harness/specs/tasks/agent-first-task-corpus.md
  - harness/specs/fixtures/agent-first-system/**
  - scripts/lib/agent-first-task-corpus.mjs
  - scripts/lib/agent-first-task-corpus.d.mts
  - scripts/agent-first-corpus-check.mjs
  - scripts/agent-first-corpus-check.d.mts
  - tests/unit/agent-first-task-corpus.test.ts
requiredProfiles:
  - fast
requiredRules:
  - docs-sync
  - repository-artifact-retention
  - reliability-aggregation-boundary
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - node scripts/agent-first-corpus-check.mjs
  - pnpm exec vitest run tests/unit/agent-first-task-corpus.test.ts tests/unit/agent-first-evaluation-framework.test.ts tests/unit/agent-first-evaluation-loop.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/agent-first-task-corpus.md
acceptance:
  - 初始集合 20-50 项，每项有明确输入、参考执行路径、源码摘要、终态条件、反例、风险和适用范围；缺项或无法解析的引用判 invalid。
  - public 与 held-out 不重叠且覆盖全体任务，候选不能改写切分；冻结摘要绑定完整任务内容。
  - capability/regression/negative/adversarial/recovery 有真实分类和计数；不得把语料或校准夹具算为当前系统已完成的 trial。
  - 每个关键 grader 实际运行 known-good/known-bad/unknown 校准；错终态和自证成功不能通过，证据缺失返回 unknown。
  - 0% trial 首先产生 task/grader investigation，不能自动归因为 agent failure。
  - 插入契约只增加注册条目和校准资料，历史 TF-0589/TF-0620/TF-0621 记录不重写；新 profile 仍 not-run。
  - 定向测试、完整类型、scoped lint、Harness、凭据和哈希回读通过；绿后提交并尝试合并，发生冲突保留分支和记录。
docs:
  required: true
  files:
    - harness/specs/tasks/agent-first-task-corpus.md
readmeUpdates: not-required
---

# TF-0590 执行合同

复用 `openclaw_runtime/qa/scenarios/personal-*.md` 的真实 Gateway 流程及已维护的失败回归定义。任务输入来自源文件的 objective 或失败约束，参考解是现有 qa-flow/回归执行路径；终态条件来自冻结断言。校准使用明确标为 deterministic-fixture 的观察输入，不声称这些输入来自真实产品运行。

关键代码 grader 按冻结断言集审查观察值。缺断言、unknown 和不可信来源均不会变成 pass；补充文字、model verdict 不能覆盖确定性终态失败。复杂定性 model rubric 的实际审查属于 TF-0593，不能把本节点的规则校准外推为模型校准。

新套件的注册扩展与历史注册快照分开保存，由后续执行器组成一个有效注册表；旧密封矩阵和历史证据不改写。集合和切分冻结后仍没有有效运行结果。TF-0591 实现产品交互，TF-0592 使用实际隔离 trial，TF-0593/TF-0595 审查和复核这些产物。

产品行为未改变，三份产品 README 无须新增能力声明。所有自动化资料记录 driven_by=agent 和 actor。原始运行输出使用 D:，不包含真人数据或真实用户对话。
