# T2 — P2.2 读取效率基准报告

> **方法学声明**：token 消耗 + 准确率均为 40 题完整机械计算（无 LLM 参与）。
> 准确率口径 = resolve 输出是否包含 ground-truth 期望节点 ID（二元判定）。
> 全文模式必然 100% 包含（它就是整 .vt 文档），故为 baseline。

> tokenizer = `cl100k_base`；resolve = `depth=2 + max_nodes + max_facets (D27)`；全文 = 整 .vt 文档原文。
> 红线（HANDOFF §3 T2）：token 消耗 ≤ 全文 35%；准确率损失 ≤ 2%。

## 1. Token 消耗对比（40 题完整数据）

| 问题 ID | 类型 | resolve token | 全文 token | 比例 |
|---|---|---:|---:|---:|
| api_auth_q1_def | def | 119 | 687 | **17.3%** |
| api_auth_q2_rule | rule | 180 | 687 | **26.2%** |
| api_auth_q3_deps | deps | 360 | 687 | **52.4%** |
| api_auth_q4_trace | trace | 163 | 687 | **23.7%** |
| arch_split_q1_def | def | 180 | 707 | **25.5%** |
| arch_split_q2_rule | rule | 157 | 707 | **22.2%** |
| arch_split_q3_deps | deps | 270 | 707 | **38.2%** |
| arch_split_q4_trace | trace | 170 | 707 | **24.0%** |
| db_users_q1_def | def | 150 | 539 | **27.8%** |
| db_users_q2_rule | rule | 132 | 539 | **24.5%** |
| db_users_q3_deps | deps | 202 | 539 | **37.5%** |
| db_users_q4_trace | trace | 123 | 539 | **22.8%** |
| dep_runbook_q1_def | def | 168 | 643 | **26.1%** |
| dep_runbook_q2_rule | rule | 149 | 643 | **23.2%** |
| dep_runbook_q3_deps | deps | 317 | 643 | **49.3%** |
| dep_runbook_q4_trace | trace | 171 | 643 | **26.6%** |
| sec_rules_q1_def | def | 145 | 586 | **24.7%** |
| sec_rules_q2_rule | rule | 242 | 586 | **41.3%** |
| sec_rules_q3_deps | deps | 370 | 586 | **63.1%** |
| sec_rules_q4_trace | trace | 154 | 586 | **26.3%** |
| task_sprint_q1_def | def | 183 | 619 | **29.6%** |
| task_sprint_q2_rule | rule | 120 | 619 | **19.4%** |
| task_sprint_q3_deps | deps | 292 | 619 | **47.2%** |
| task_sprint_q4_trace | trace | 187 | 619 | **30.2%** |
| res_queue_q1_def | def | 207 | 633 | **32.7%** |
| res_queue_q2_rule | rule | 112 | 633 | **17.7%** |
| res_queue_q3_deps | deps | 293 | 633 | **46.3%** |
| res_queue_q4_trace | trace | 189 | 633 | **29.9%** |
| pref_dev_q1_def | def | 134 | 508 | **26.4%** |
| pref_dev_q2_rule | rule | 149 | 508 | **29.3%** |
| pref_dev_q3_deps | deps | 265 | 508 | **52.2%** |
| pref_dev_q4_trace | trace | 139 | 508 | **27.4%** |
| err_codes_q1_def | def | 135 | 577 | **23.4%** |
| err_codes_q2_rule | rule | 134 | 577 | **23.2%** |
| err_codes_q3_deps | deps | 313 | 577 | **54.2%** |
| err_codes_q4_trace | trace | 131 | 577 | **22.7%** |
| log_v031_q1_def | def | 173 | 630 | **27.5%** |
| log_v031_q2_rule | rule | 80 | 630 | **12.7%** |
| log_v031_q3_deps | deps | 340 | 630 | **54.0%** |
| log_v031_q4_trace | trace | 180 | 630 | **28.6%** |

## 2. 汇总

- 题数: **40**（10 文档 × 4 题/文档）
- resolve 平均 token: **191.9**
- 全文平均 token: **612.9**
- resolve / 全文 平均比例: **31.4%**
- 最差比例: **63.1%** （sec_rules_q3_deps）

### 按问题类型细分（比例）

| 类型 | 平均比例 | 题数 |
|---|---:|---:|
| def | 26.1% | 10 |
| deps | 49.4% | 10 |
| rule | 24.0% | 10 |
| trace | 26.2% | 10 |

## 3. 准确率评测（机械判定，40 题完整）

| 问题 ID | 类型 | 期望节点数 | resolve 缺失 | resolve 答对? |
|---|---|---:|---:|---|
| api_auth_q1_def | def | 6 | — | ✓ |
| api_auth_q2_rule | rule | 6 | — | ✓ |
| api_auth_q3_deps | deps | 8 | — | ✓ |
| api_auth_q4_trace | trace | 2 | — | ✓ |
| arch_split_q1_def | def | 5 | — | ✓ |
| arch_split_q2_rule | rule | 4 | — | ✓ |
| arch_split_q3_deps | deps | 5 | — | ✓ |
| arch_split_q4_trace | trace | 2 | — | ✓ |
| db_users_q1_def | def | 5 | — | ✓ |
| db_users_q2_rule | rule | 4 | — | ✓ |
| db_users_q3_deps | deps | 5 | — | ✓ |
| db_users_q4_trace | trace | 2 | — | ✓ |
| dep_runbook_q1_def | def | 5 | — | ✓ |
| dep_runbook_q2_rule | rule | 4 | — | ✓ |
| dep_runbook_q3_deps | deps | 6 | — | ✓ |
| dep_runbook_q4_trace | trace | 2 | — | ✓ |
| sec_rules_q1_def | def | 4 | — | ✓ |
| sec_rules_q2_rule | rule | 8 | — | ✓ |
| sec_rules_q3_deps | deps | 9 | — | ✓ |
| sec_rules_q4_trace | trace | 2 | — | ✓ |
| task_sprint_q1_def | def | 4 | — | ✓ |
| task_sprint_q2_rule | rule | 3 | — | ✓ |
| task_sprint_q3_deps | deps | 5 | — | ✓ |
| task_sprint_q4_trace | trace | 2 | — | ✓ |
| res_queue_q1_def | def | 5 | — | ✓ |
| res_queue_q2_rule | rule | 3 | — | ✓ |
| res_queue_q3_deps | deps | 7 | — | ✓ |
| res_queue_q4_trace | trace | 2 | — | ✓ |
| pref_dev_q1_def | def | 4 | — | ✓ |
| pref_dev_q2_rule | rule | 6 | — | ✓ |
| pref_dev_q3_deps | deps | 7 | — | ✓ |
| pref_dev_q4_trace | trace | 2 | — | ✓ |
| err_codes_q1_def | def | 4 | — | ✓ |
| err_codes_q2_rule | rule | 4 | — | ✓ |
| err_codes_q3_deps | deps | 10 | — | ✓ |
| err_codes_q4_trace | trace | 2 | — | ✓ |
| log_v031_q1_def | def | 4 | — | ✓ |
| log_v031_q2_rule | rule | 2 | — | ✓ |
| log_v031_q3_deps | deps | 9 | — | ✓ |
| log_v031_q4_trace | trace | 2 | — | ✓ |

- resolve 模式准确率: **40/40 = 100.0%**
- 全文模式准确率: **40/40 = 100.0%** (baseline)
- 准确率损失: **0.0%**（红线 ≤ 2%）

**准确率红线达标**：损失 ≤ 2%。

## 4. Token 红线判定

**红线达标**：resolve/全文 平均比例 = 31.4% ≤ 35%。

## 5. 方法学附录

- 10 文档来自 T1 的 10 场景扩展版（每场景补 12–14 节点让全文到 500–1500 tok）。
- 按 [docs/authoring-guide.md](../docs/authoring-guide.md) R1 自动补 `--DEPENDS-->` 边。
- 4 题/文档 = 4 类问题：DEF 查询 / RULE 过滤 / 依赖边 / 反向溯源。
- 全文模式 = `to_vt_full(sc)` 的完整 .vt 文本（含 %vt 头与 REF 行）。
- resolve 模式 = `resolve_tir([graph], q.target, **q.kwargs)` 实际输出。
- 预算取值：
  - def:   max_nodes=3,                     max_facets=2 (DEF + 1 注解)
  - rule:  max_nodes=自适应 (#RULEs + 8),   max_facets=1 (仅 RULE facet)
  - deps:  max_nodes=自适应 (#端点 + 3),    max_facets=1 (仅 DEF + 边行)
  - trace: max_nodes=自适应 (out_deg + 2),  max_facets=1 (仅 DEF facet)
- 准确率判定：resolve_output 是否包含所有 expected_ids（机械字符串匹配）。
