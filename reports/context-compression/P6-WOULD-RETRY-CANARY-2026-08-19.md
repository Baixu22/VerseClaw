# P6 Phase 3 would-retry canary（shadow vs would-retry A/B）

> 日期：2026-08-19
> 前置：P6-A v14 live 8/8 全绿；fixed manifest 30；modelIndependence.ok=true。
> 结论：**would-retry canary 未通过放行条件。** 回滚 = 保持
> `promotionStage: "shadow"`，不提升 stage。

## 1. 实验输入

- 固定 manifest：`reports/context-compression/production-manifest-30.json`
- 30 个真实 transcript preparations，来自 agent-core `prepareCompaction()`。
- provider：真实 DeepSeek-backed compaction provider（deepseek-chat，
  temperature 0，max_tokens 8192；无 deterministic recovery ledger）。
- 两个 arm：
  - `shadow`：不 retry。
  - `would-retry`：`resolveCompactionPromotionEnforcement` 允许最多 1 次
    有界 provider retry。
- 输出：
  - `artifacts/p6-would-retry-canary-v2/canary-metrics.json`
  - `artifacts/p6-would-retry-canary-v2/shadow-summaries.jsonl`
  - `artifacts/p6-would-retry-canary-v2/would-retry-summaries.jsonl`

## 2. Retry / latency / token

| 指标 | shadow | would-retry |
|---|---:|---:|
| provider retry 总数 | 0 | 30 |
| retry 上界 | 1 | 1 |
| retry 可复现 | 30/30 首次 wouldRetry=true | 30/30 恰好 1 次 retry |
| mean latency（provider） | 6632.8 ms | 14185.6 ms |
| input tokens total | 192312 | 388252 |
| output tokens total | 25647 | 56540 |

retry 有界且可复现；would-retry 的成本增加符合预期。

## 3. 质量对比（30 固定样本）

### 3.1 deterministic paired replay

| 指标 | shadow | would-retry | 变化 |
|---|---:|---:|---|
| external recall mean | 0.1552 | 0.1279 | 下降 0.0273 |
| critical dropped verified claims | 103 | 103 | 持平 |
| samples with critical dropped | 30 | 30 | 持平 |
| stale leakage | 0 | 0 | 持平 |
| L3 deterministic critical action | 1.0 | 1.0 | 持平 |

### 3.2 live DeepSeek reasoner

| 指标 | shadow | would-retry | 变化 |
|---|---:|---:|---|
| schema-free major omission | 0.2000 | 0.1667 | 改善 |
| judge no-fabrication | 0.8667 | 0.7667 | 回归 |
| judge completeness | 0.3333 | 0.2667 | 回归 |
| judge accuracy | 0.8333 | 0.7000 | 回归 |
| judge causal chain | 0.8667 | 0.7667 | 回归 |
| continuation critical action | 0.1333 | 0.1333 | 持平 |
| completion delta | 0.8667 | 0.8667 | 持平 |

live run 路径：

- shadow：
  `artifacts/p6-would-retry-canary-v2/shadow-live/2026-08-19T04-31-45-338Z`
- would-retry：
  `artifacts/p6-would-retry-canary-v2/would-retry-live/2026-08-19T05-22-21-493Z`

## 4. 放行判定

would-retry 放行条件：

- would-retry 不造成任何 gate 指标回归：**FAIL**。
  - no-fabrication、completeness、accuracy、causal chain、deterministic
    external recall 均出现回归。
  - critical dropped 虽未继续恶化，但也没有修复（30/30）。
- retry 有界且可复现：**PASS**（30/30 恰好 1 次）。
- 回滚 = 恢复 shadow：**已保持 shadow，未写任何临时生产配置。**

## 5. 根因

当前 canary provider 只做一次自由文本摘要，重试反馈只包含
`validatedPipeline.reasons`；首次摘要已经丢失 critical ledger，重试仍无法
恢复 deterministic critical facts。would-retry 本身是安全有界的，但需要
把 P6-A v14 的 deterministic recovery ledger / continuation directive
纳入 provider 重试策略，才能让 retry 产生质量收益。

## 6. 下一步

- 保持 `promotionStage: "shadow"`。
- provider retry 候选修复已实现：重试 prompt 注入 deterministic recovery
  ledger + authoritative continuation directive，返回后再原样追加两段；metrics
  schema 升为 `p6-would-retry-canary/v2` 并记录注入样本数。
- 离线检查固定 30 个 transcript：30/30 ledger/directive 非空，最少 3 条
  deterministic facts，30 个 authoritative candidate id 唯一。
- 当前进程无 `DEEPSEEK_API_KEY`，尚未生成新的 provider/live A/B 证据；本报告
  上述失败指标仍是修复前 v2 canary 的历史事实。
- 重跑 shadow vs would-retry canary；确认所有质量指标无回归后再考虑
  Phase 4。
