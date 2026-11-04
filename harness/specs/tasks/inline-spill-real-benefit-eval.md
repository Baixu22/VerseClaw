---
lifecycleStatus: active
id: inline-spill-real-benefit-eval
title: Inline/Spill 真实任务收益评测（自主 recall 循环）
scenario: context-family
taskType: runtime-bridge
diffBase: ddd66ced9f3d389bd03a476fcbdccfc2de759f33
intent: 在既有 Inline/Spill 可见性与有界保留机制之上，建立一套可复算的真实任务收益评测：第三方模型在真实 function-calling 循环中自主决定是否调用 context_archive_recall，并按冻结口径量化正确率、上下文成本、token、延迟与费用。
touchedAreas:
  - harness/specs/tasks/inline-spill-real-benefit-eval.md
  - harness/specs/rules/inline-spill-benefit-quantification.md
  - harness/specs/fixtures/context-inline-spill-benefit/**
  - scripts/context-inline-spill-benefit-loop-eval.mts
  - scripts/context-inline-spill-benefit-scoring.mts
  - tests/unit/context-inline-spill-benefit-scoring.test.ts
  - docs/modules/context-and-memory.md
expectedUserBehavior:
  - 让模型自己决定是否回读，而不是由脚本代替模型发起 recall。
  - 在引用不可见时模型不得凭空给出私有值；在引用可见且允许回读时应能取回精确值。
  - 有界保留窗口内回读内容在后续压力轮次仍可用；窗口外或关闭保留时回到旧行为。
requiredProfiles:
  - fast
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - disk-temp-policy
  - agent-engineering-acceptance-boundary
  - inline-spill-benefit-quantification
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/context-inline-spill-benefit-scoring.test.ts --maxWorkers=1
  - openclaw_runtime/node_modules/.bin/tsx scripts/context-inline-spill-benefit-loop-eval.mts --mode deterministic --out D:/tmp/context-inline-spill-benefit
  - pnpm exec vitest run tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/inline-spill-real-benefit-eval.md
acceptance:
  - 评测器通过真实 provider function-calling 协议驱动；脚本只执行模型返回的工具调用，不替模型决定是否 recall。
  - 四臂 baseline-no-reference / reference-visible / recall-stable / retention-off 在同一语料、同一 oracle、同一评分器下运行，且负对照与处理臂除 retention 开关外输入一致。
  - 逐次运行记录包含：模型请求与响应、工具调用参数与结果、最终答案、usage、延迟、主上下文字符、失败分类。
  - 汇总报告给出每臂成功率、pass^k、Wilson 95% 区间、token、延迟与费用（或 not-run），并能由逐次记录复算。
  - 无证据控制任务必须返回 null；负臂不得泄漏 oracle；凭证扫描 0 命中。
  - 判定严格按 inline-spill-benefit-quantification 的 B1-B7，输出 task-benefit-verified / mechanism-only / no-benefit / inconclusive 之一。
  - 不改变产品默认值、产品锁、compaction 阈值；不开启 observation masking、Tool Search；retention 仍为显式 opt-in。
  - 不声称 GA、release-approved 或 real-human 证据。
---

# Inline/Spill 真实任务收益评测

## 为什么需要这个任务

TF-0700 的验收证明了机制：引用可见、回读可达、窗口内有界保留成立。它的评估 fixture 由脚本构造，回读由脚本安排，质量分只是“可见上下文是否包含目标串”。这不能回答“真实任务里是否更好”。

本任务把评估升级为**模型自主决策的真实循环**：

- 模型拿到的是真实投影后的上下文（真实 truncation + archive 引用 + 真实 pruner/retention）。
- 工具是生产实现 `context_archive_recall`，参数由模型生成。
- 评测器只负责执行模型返回的 function call、把结果接回下一轮；是否回读、何时回读、分页多少都由模型决定。

## 评测臂

四臂必须同时存在：

1. `baseline-no-reference`：旧截断提示，不含 archive 引用，不能回读。
2. `reference-visible`：引用可见，允许回读，无聚合压力，retention 关闭。
3. `recall-stable`：引用可见，允许回读，有聚合/剪枝压力，retention 开启。
4. `retention-off`：与 3 同输入同压力，仅 retention 关闭（负对照）。

## 语料

- 至少 6 个独立证据任务：大工具输出被真实截断并归档，私有值落在归档页内。
- 至少 2 个无证据控制任务：归档中不存在目标值，正确行为返回 `null`。
- 每任务每臂重复 3 次。
- oracle 只进入评分器，不进入模型输入。

## 指标与判据

指标定义、四臂要求、B1-B7 判据、失败分类与判定输出，全部以
[inline-spill-benefit-quantification](../rules/inline-spill-benefit-quantification.md) 为准。
本 spec 不重复定义阈值，避免两处口径漂移。

## 边界

- 评测循环是 agent 驱动的评测器外循环，不是 Electron/Gateway 的完整产品回合；完整产品回合（含 Gateway 审批、system prompt、bootstrap）不在本任务范围。
- 单次 live 运行只代表该模型在该语料上的表现，不外推为产品质量或 GA。
- 费用只有 provider 返回计费单位时才记录，否则 `not-run`。
- 不改变任何产品默认行为；retention 仍为显式 opt-in。

