---
id: inline-spill-benefit-quantification
title: Inline/Spill Benefit Quantification
type: ai-coding-rule
appliesTo:
  - context-family
  - inline-spill
  - benefit-eval
---

# Inline/Spill 收益量化规则

本规则冻结“真实收益”的判定口径。任何声称 Inline/Spill 带来收益的结论，必须能按本规则从磁盘原始记录复算；不能复算的数字只能写成 `not-run` 或 `probe`。

## 两层收益必须分开

- **机制收益（mechanism benefit）**：模型可见文本里存在可验证 archive 引用；在允许回读时精确内容可达；有界保留在窗口内不被同路径再次淘汰。
- **任务收益（task benefit）**：在真实模型循环中，模型自主选择回读并因此完成了一个本来会失败的任务。

只证明机制收益时，不得写成“真实收益已验收”。只有本规则判据中 B2、B3 同时通过，才允许写 `task-benefit-verified`。

## 实验臂（缺一不可）

| 臂 | 引用可见 | retention | 聚合/剪枝压力 | 期望 |
|---|---|---|---|---|
| `baseline-no-reference` | 否（旧截断提示） | 否 | 无 | 还原精确值 -> 失败 |
| `reference-visible` | 是 | 否 | 无 | 允许自主 recall -> 成功 |
| `recall-stable` | 是 | 是 | 有 | 允许自主 recall -> 成功 |
| `retention-off` | 是 | 否 | 有 | 允许自主 recall -> 因再次淘汰而失败 |

`retention-off` 是 `recall-stable` 的负对照；两者除 retention 开关外，输入、样本、温度、压力消息必须逐字节一致。

## 语料要求

- 至少 6 个相互独立的任务，每个任务一个唯一私有 oracle 值，位置落在归档页内。
- 至少 2 个“无证据”控制任务：归档中不存在该值，正确行为是回答 `null`。
- 每个任务每臂至少重复 3 次；重复次数的理由必须在结果里写明。
- oracle 只用于评分，绝不进入模型输入；每次运行必须校验负臂输入不含 oracle。

## 指标定义（唯一口径）

| 指标 | 定义 | 来源 |
|---|---|---|
| `task_success` | 证据任务：`value` 与 oracle 逐字符相等；控制任务：`value === null` | 评分器读取最终答案 |
| `recall_attempted` | 模型在该次运行中至少发出一次 `context_archive_recall` function call | 原始请求/响应 |
| `recall_ok` | 该工具返回 `ok: true` | 工具原始结果 |
| `turns` | 该次运行的 provider 请求次数 | 运行记录 |
| `main_context_chars` | 最后一次请求里模型可见输入的字符数 | 实际发送字节 |
| `input_tokens` / `output_tokens` / `total_tokens` | provider usage 原值，按运行求和 | provider 响应 |
| `latency_ms` | 每次 provider 调用墙钟，报告 p50/p95/总计 | 运行记录 |
| `cost` | provider 返回计费单位时记录；否则 `not-run` 并写原因 | provider 响应 |
| `failure_class` | 见失败分类 | 评分器 |

禁止用“上下文字符减少”替代任务正确率，也禁止用“token 更少”单独宣称收益。

## 判据（运行前冻结，不得事后改阈值）

- **B1 机制与自主性**：`recall-stable` 的 `recall_attempted` 率 >= 0.80，`recall_ok` 率 >= 0.95。
- **B2 任务收益**：`success(recall-stable) - success(baseline-no-reference) >= 0.30` 绝对百分点，且配对任务的 McNemar 精确检验 `p < 0.05`。
- **B3 保留收益**：`success(recall-stable) > success(retention-off)`，至少 1 个“保留臂通过、负对照失败”的配对，且反向配对为 0。
- **B4 非劣**：`success(recall-stable) >= success(reference-visible) - 0.05`。
- **B5 不臆造**：无证据控制任务在 `recall-stable` 臂必须全部返回 `null`（成功率 1.0）。
- **B6 预算**：`mean(main_context_chars(recall-stable)) - mean(main_context_chars(retention-off))` <= 16000 字符；总 token 相对 `reference-visible` 增幅 <= 25%。
- **B7 证据**：所有原始产物可回读、`SHA256SUMS` 全匹配、凭证扫描 0 命中，且每个数字能由逐次运行记录复算。

## 判定输出

`decision.status` 只能取：

- `task-benefit-verified`：B1-B7 全部通过。
- `mechanism-only`：B1 通过但 B2 或 B3 未通过。
- `no-benefit`：样本量达标但 B2 明确不成立。
- `inconclusive`：样本不足、置信区间过宽或关键指标 `not-run`。

任何情况下都不允许输出 `GA`、`release-approved` 或 `real-human`。

## 失败分类（必填）

`no_archive_reference`、`recall_not_attempted`、`recall_failed_closed`、`recalled_text_evicted`、`answer_mismatch`、`fabricated_absent_evidence`、`provider_error`、`schema_invalid`、`loop_budget_exceeded`。

## 证据与复算

- 原始逐次运行记录、请求/响应、工具调用与结果、评分明细必须落盘。
- 汇总报告只能由这些原始文件推出，并附带复算命令。
- 临时目录遵守 `disk-temp-policy`，证据固化到 `harness/specs/fixtures/context-inline-spill-benefit/`。

