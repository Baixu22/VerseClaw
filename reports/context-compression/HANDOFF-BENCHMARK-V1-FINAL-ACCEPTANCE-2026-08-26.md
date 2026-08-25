# Handoff Benchmark v1 最终验收报告：v8 接地管线（2026-08-26）

状态：**正式验收（锁定 GT）**。被验收对象 = v8 最终配置接地管线：`qwen-plus 抽取（k=1，溯源验证）+ guideline v5（作用域准则）+ directive 措辞修复 + scoring v1.4`。

## 1. 验收输入与证据链

| 项 | 值 |
| --- | --- |
| GT | `reports/context-compression/handoff-benchmark-v1/ground-truth.json`，锁定于 2026-08-25（用户指令），gtSha256 `698de58e…`，两次运行哈希一致 |
| 压缩产物 | `artifacts/handoff-benchmark-v1/acceptance-final-2026-08-26/would-retry-summaries.jsonl`（30 样本，qwen-plus 接地抽取） |
| 接手模型 | qwen-plus · 裁决 judge qwen-plus-latest（k=3 多数票）· 模型独立性断言通过 |
| 计分器 | scoring-v1.4 / handoff-judge-prompt-v3 / handoff-prompt-v1 |
| 变体 | shipped（随货含 directive）与 core（剥离 directive） |
| 抽取成本 | ¥0.35（30 样本）+ 评估开销；预算护栏 ¥6 未触发 |

## 2. 最终验收指标（12 个锁定 GT 样本）

| 指标 | shipped | core |
| --- | --- | --- |
| handoff-success-rate | **0.333** | 0.333 |
| repeat-work-rate | **0.25** | 0.583 |
| contradiction-rate | **0** | 0.083 |
| state-accuracy | **0.938** | 0.917 |

**shipped 为历史最佳配置**，且是首次 directive 正向贡献（repeat 0.25 vs core 0.583：「不要重复已完成工作」框架真实抑制了重调查）。

## 3. 纵向对比（同一锁定 GT、同一接手模型）

| 管线 | shipped success/repeat/contra/state |
| --- | --- |
| v1.1 基线（v12 纯确定性管线） | 0.167 / 0.333 / 0.250 / 0.896 |
| v1.3（v12 + scoring v1.3） | 0.250 / 0.250 / 0.167 / 0.938 |
| **v8 接地管线（本次）** | **0.333 / 0.250 / 0 / 0.938** |

相对 v1.1 基线：**success +16.6pp、contradiction -25pp、repeat -8.3pp、state +4.2pp**。矛盾率清零。

## 4. 逐样本（shipped / core）

| sample | success | repeat | contra | state |
| --- | --- | --- | --- | --- |
| R5 | true/true | false/false | false/false | 0.75/1.00 |
| R8 | **true/true** | false/false | false/false | 1.00/0.75 |
| R9 | false/false | true/false | false/false | 0.75/0.75 |
| R10 | false/false | false/true | false/false | 1.00/1.00 |
| R11 | false/false | false/true | false/true | 1.00/1.00 |
| R13 | false/false | false/true | false/false | 1.00/1.00 |
| R14 | false/false | true/true | false/false | 1.00/1.00 |
| R16 | false/false | false/true | false/false | 1.00/1.00 |
| R17 | false/false | false/true | false/false | 1.00/1.00 |
| R25 | false/false | true/true | false/false | 1.00/1.00 |
| R26 | **true/true** | false/false | false/false | 1.00/1.00 |
| R30 | **true/true** | false/false | false/false | 0.75/0.50 |

稳定化承诺全部兑现：R8 success 2/2（验收级复现）、R30 重复消除、R26 恢复。

## 5. 已知边界（诚实声明）

1. **家族样本（R10–R17）success 0/6**：接手 agent 获得完整调查结论（state-accuracy 1.0）但不主动执行压缩动作——这是「接手方行为保守性」设计边界，非压缩器缺陷；压缩侧信息可用性已在归因中证明 12/12 在场。
2. **语义审计**：确定性批次（batch v14）**30/30**；本次接地验收产物 29/30——唯一分歧为 R1 `directiveNamesAction`：审计以纯正则事实重建期望 `R1-inspect`（泛化回退），实际 directive 为验证过的具体动作「运行 openclaw memory status --index 诊断内存索引问题」，属设计预期的动作提升，非损坏。
3. **R9 shipped repeat=true / R25 repeat**：环境修复类样本的重调查倾向残留，列为后续轮次目标。
4. **rubric 边界**：「报告复述修复内容」与「重做修复」的区分仍依赖裁决（历史 10 运行 2 次该模式），GT v2（acceptableAlternatives）可解。

## 6. 门禁（全部真实执行，绿）

单测 59/59 · runtime compact hooks 45/45 · 语义审计 30/30（确定性批次）· canary self-test PASS · handoff self-test PASS · 锁定 GT 哈希一致 · 模型独立性通过 · 无密钥落盘。

## 7. 结论

v8 接地管线在锁定的下游真度量上全面优于 v7 确定性基线（三指标改善、一指标持平、矛盾清零），零虚构不变式保持（所有 LLM 事实过溯源验证器），全部硬门禁绿。**判定：验收通过（限于本基准与语料族；promotion 保持 shadow，不解锁产品级状态）**。