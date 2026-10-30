---
lifecycleStatus: active
id: agent-first-evaluation-loop
title: Agent-first 评测闭环契约（改进信号 / 同冻结套件重评 / 回归晋级）
intent: 在 TF-0620 框架核心之上冻结闭环契约：verdict 与 residual 如何变成可定位的改进信号、候选如何在同一个冻结 suite 与 held-out split 上重评、饱和的 capability 任务如何按预登记阈值晋级为 regression；同时用 fail-closed 负例证明闭环不会生成候选、不会改写默认值或锁、不会批准发布。
diffBase: c97589e791c7cdc1b25af9ae9c919fe1ae38be11
touchedAreas:
  - harness/specs/guides/agent-first-acceptance.md
  - harness/specs/tasks/agent-first-evaluation-loop.md
  - harness/specs/fixtures/agent-first-framework/loop-record.json
  - harness/specs/fixtures/agent-first-framework/loop-validation-report.json
  - harness/specs/fixtures/agent-first-framework/loop-credential-scan.json
  - harness/specs/fixtures/agent-first-framework/loop-development-evidence.json
  - harness/specs/fixtures/agent-first-framework/SHA256SUMS
  - scripts/lib/agent-first-evaluation-framework.mjs
  - scripts/lib/agent-first-evaluation-loop.mjs
  - scripts/lib/agent-first-evaluation-loop.d.mts
  - scripts/agent-first-loop-check.mjs
  - scripts/agent-first-loop-check.d.mts
  - tests/unit/agent-first-evaluation-loop.test.ts
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
  - pnpm exec vitest run tests/unit/agent-first-evaluation-loop.test.ts tests/unit/agent-first-evaluation-framework.test.ts tests/unit/agent-first-acceptance.test.ts tests/unit/rsi-evidence-loop-contract.test.ts --maxWorkers=1
  - node scripts/agent-first-loop-check.mjs
  - pnpm harness validate --spec harness/specs/tasks/agent-first-evaluation-loop.md
acceptance:
  - 改进信号必须落在 TF-0589 已密封的 8 个维度之一、解析到已封存门禁 id 或任务 id、并至少携带一条证据链；三者缺一即 fail closed，不允许"无法定位但静默通过"。
  - 重评必须在同一冻结 suite 与同一 held-out digest 上进行；suite 不一致、held-out digest 与冻结值不一致、或候选未在闭环记录中声明，均判 invalid。
  - held-out split 未冻结时必须 `digest=null`，冻结后必须 digest 锚定且 `writableByCandidate=false`；提前声称 digest 或与冻结 split 不一致判 invalid。
  - capability→regression 晋级必须绑定注册任务、候选预先绑定的策略 digest、策略数值的重算 digest 及至少两次不同且连续的完整运行；样本/k、pass^k 下置信界、flake 和安全要求均达预登记阈值。反向降级、重复计数、跳过失败或裸 promotions 记录均判 invalid。
  - 闭环不得生成候选：候选必须声明作者且作者不得是 framework 或被测对象；框架只提供度量与晋级判据。
  - 闭环不得批准发布、不得改动产品锁或冻结默认值；`publicationApproval` 非空或 `productLockChanges` 非空即 fail closed。
  - 负例全部 fail closed：42 条已声明负例均从有效基线构造并命中对应拒绝码；包括缺失证据链、虚假冻结 held-out、反向降级、未测记录充当决策、策略篡改、同 actor、发布批准与锁改动。
  - 完整正例证明合法的冻结候选、确定性完整运行、RSI 决策和任务晋级均可通过；taskGraduations 被计入 promotions 数量，不能只靠拒绝所有记录获得绿灯。
  - 未生成任何候选时报告 not-run 语义：`suiteBinding.status=not-frozen`、`candidateProducer.status=not-implemented`、`heldOutSplit.digest=null`，counts 中 candidates/reEvaluations/promotions 为 0，且不写任何通过结论。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run、凭据扫描与 SHA256SUMS 回读通过。
expectedUserBehavior:
  - 读者能区分"闭环契约已建立"与"闭环已被真实运行"：没有候选时 counts 全为 0，不是"闭环通过"。
  - 重调 held-out、反向降级或试图在闭环里批准发布都会被拒绝，而不是被写成一次成功的迭代。
docs:
  required: true
  files:
    - harness/specs/guides/agent-first-acceptance.md
---

# Agent-first 评测闭环契约

## 这个节点解决什么

TF-0620 解决了"评测面如何插入"。TF-0621 解决"评测结论之后发生什么"：

```text
verdict + residuals
  -> improvement signal（定位到 dimension + gate/task + 证据链）
  -> candidate（由自改进层拥有，框架不生成）
  -> 对同一个冻结 suite 与 held-out split 重评
  -> regression graduation（饱和的 capability 任务晋级为 regression）
```

没有这一层，评测就只是一次性报告：结论无处回流，饱和任务也不会转为回归保护。

## 冻结的规则

- **信号必须可定位且可分类**：`dimension` 必须属于 TF-0589 密封的 8 维度；必须解析到已封存门禁 id（A1–G1）或任务 id；必须至少一条 `evidenceLinks`；`kind` 必须区分 `evaluation-gap`、`observed-regression` 与 `residual`，不得把“尚未评测”写成回归。
- **重评必须可比**：未冻结 suite 只能保持 not-run；冻结后重评必须使用同一 suite content digest 与同一 held-out digest，重调即 invalid。
- **晋级必须预登记**：只有 `capability -> regression`；任务级策略在候选评测前冻结，包含切分的样本下限、k、pass^k 下置信界、flake 上限与连续运行次数。
- **框架不生成候选**：候选生成者必须注册为 `self-improvement` 层，且不得是 `framework` 或被测对象；生产者为 `not-implemented` 时，候选列表必须为空。
- **闭环不改边界**：不做发布批准、不改产品锁或冻结默认值。
- **策略真源可回读**：`promotionPolicyDigest` 是磁盘上 RSI `promotion-policy.v1.json` 的实际 SHA256；任务晋级策略的 digest 覆盖数值字段，候选与重评均绑定同一策略。假 seal 或阈值重调不能被当作预登记。
- **报告计数有权威字段**：`promotions` 计数来自 `taskGraduations`；旧的裸 `promotions` 列表只允许为空。所有数组必须显式存在，损坏的对象不能被静默当成零记录。

## 分层与后续路径

本节点只冻结 Layer 3 的契约，不生成候选、不运行评测，也不把静态校验当成真实闭环。后续体系按以下边界推进：

1. **Layer 1 框架内核（TF-0620）**：subject adapter、suite/grader registry、profile 组合与 fail-closed 校验。
2. **Layer 2 评测面接入**：每个新 subject 或评测面只需注册表条目 + 校准 fixture；运行器从注册表发现，不为每个面复制核心逻辑。
3. **Layer 3 闭环契约（TF-0621）**：本节点冻结 signal → candidate → frozen re-evaluation → regression graduation 的数据边界。
4. **Layer 4 执行与证据仓库（后续节点）**：真实 runner、run record、artifact store、resume/replay 与独立 verifier；本节点明确不做。
5. **Layer 5 语料与校准（TF-0590 起）**：真实任务、参考解、held-out split、grader known-good/known-bad 与 20-case/k=3 下限。
6. **Layer 6 真实评测与回归毕业**：只在语料冻结、执行器可复现、候选生产者已注册后开始；饱和 capability 任务才进入 regression。

外部实践只作为设计来源，不替换本仓真源：Inspect/OpenAI Evals/METR Task Standard 的核心启发是“任务、执行器、评分器、运行日志解耦”；SWE-bench 的启发是“确定性最终状态 + 独立环境 + 可回读结果”。ClawX 的具体 verdict schema、八维度、产品锁与 Task Forest 仍以仓内密封合同为准。

## 下一节点的执行规划

下一步选择既有 `TF-0590`，不继续在 TF-0621 叠加 runner 或在线 skill 自评：

1. 从仓内已记录失败、核心 journey 与维护中的测试提取 20–50 个任务；记录源文件/commit、输入、参考解或可解性证明、确定性终态、反例与适用范围。
2. 固化 `AgentFirstTask/v1` 的任务清单，并给 capability/regression/negative/adversarial/recovery 分布与计数；在 suite 注册条目中登记 `taskIds`。
3. 为每个关键 grader 配置 known-good/known-bad/unknown 校准样本；未知或 0% trial 的任务先检查 task/grader defect，不写成模型失败。
4. 校准与可解性通过后才冻结语料内容与 held-out 切分；未冻结前 `contentDigest=null`、held-out digest 为 null、profile 保持 not-run。
5. TF-0592 负责资源指纹、隔离运行和重复试验/统计记录，TF-0595 负责持久证据包、独立重算及恢复；它们完成前不声称体系已能完整实测。

## 文档同步与验收层级

已复核 `README.md`、`README.zh-CN.md` 与 `README.ja-JP.md`：本节点增加开发契约与静态检查，不改变产品交互或运行配置，所以三份产品 README 无需改文案。维护指南第 16.5 节同步实际输入、拒绝条件与未实现边界。

按 `scoped-development-validation` 的既有开发/发布划分，本节点封存干净候选的定向测试、类型、scoped lint 与结构门禁。确定性脚本可在第二个干净 checkout 重跑这些开发门禁，明确标为 agent 驱动。此处不声称 `engineeringAcceptedByAgent`、完整 RC/产品或发布验收；发布前仍运行既有完整 Executor/Verifier 流程。

## 边界

- 本节点只冻结契约与骨架，不生成候选、不运行评测。
- `suiteBinding.status=not-frozen`、`candidateProducer.status=not-implemented`、`heldOutSplit.digest=null` 与零 counts 表示“闭环已注册但未被真实运行”，不是“闭环通过”。
- TF-0589 密封矩阵与 TF-0620 注册表未被改写；复用其维度与门禁 id 作为单一真源。
- 不接入第三方 agent-eval 平台作为运行时依赖，不把外部 benchmark 结果当当前系统结论。
- 不创建 LLM judge、自动候选生成、生产默认值变更或发布批准；这些属于后续节点和作者决策。
