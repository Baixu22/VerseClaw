# P6 would-retry canary (`auto`) — 2026-08-20

## 结论

**本轮未达到放行条件。** 生产配置继续保持 `promotionStage: "shadow"`，未写入临时生产配置，也未提升 stage。

本轮已经证明 retry 注入 deterministic recovery ledger 后，30 个真实样本的 deterministic critical-fact 丢失被消除；live reasoner 两个 arm 也已补齐，但质量 gate 仍未全部通过，且 would-retry 的时延与 token 成本显著增加。因此候选修复不能放行。

## 执行范围

- 固定输入：`production-manifest-30.json`，30 个真实 transcript preparations。
- provider endpoint：`https://z30.top/v1`。
- provider model：`auto`。
- retry 策略：`deterministic-recovery-ledger+authoritative-continuation-directive`。
- 原始 A/B：`artifacts/p6-would-retry-canary-v3-auto-full/`。
- shadow deterministic：`shadow-deterministic/2026-08-20T12-05-16-902Z/`。
- would-retry deterministic：`would-retry-deterministic/2026-08-20T12-06-01-646Z/`。
- shadow live：`shadow-live-rerun/2026-08-20T12-21-16-623Z/`。
- would-retry live judge/schema-free：`would-retry-live-judge-schema-rerun/2026-08-20T13-35-31-216Z/`。
- would-retry live continuation：`would-retry-live-rerun/2026-08-20T13-10-27-173Z/`。

## Provider A/B

| 指标 | shadow | would-retry |
| --- | ---: | ---: |
| provider retry 总数 | 0 | 30 |
| retry 可复现 | 30/30 首次 wouldRetry | 30/30 恰好 1 次 |
| recovery ledger 注入 | 0 | 30 |
| mean latency | 25,177.1 ms | 78,229.0 ms |
| input tokens | 194,682 | 421,957 |
| output tokens | 92,681 | 302,417 |
| total tokens | 287,363 | 724,374 |

retry 仍然有界且可复现，但 would-retry 相比 shadow：

- mean latency 为 `3.107x`（增加 `210.7%`）；
- input tokens 为 `2.167x`；
- output tokens 为 `3.263x`；
- total tokens 为 `2.521x`，增加 `437,011` tokens。

## Deterministic 质量

| 指标 | shadow | would-retry |
| --- | ---: | ---: |
| verified claims retention | 0.1667 | 1.0000 |
| critical dropped claims | 101 | 0 |
| samples with critical dropped | 30/30 | 0/30 |
| L1 recall | 0.1671 | 1.0000 |
| L1 weighted recall | 0.2903 | 1.0000 |
| L2 deterministic score | 5.9333 | 8.9333 |
| completeness | 0.0000 | 1.0000 |
| accuracy | 1.0000 | 1.0000 |
| causal chain | 0.9667 | 0.7333 |
| actionability | 0.0000 | 0.7333 |
| L3 critical action | 1.0000 | 1.0000 |
| completion delta | 0.0000 | 0.0000 |

deterministic recovery 的核心目标已达到：critical dropped 从 `30/30` 降到 `0/30`，verified retention、L1 recall 与 completeness 均提升至 `1.0`。不过 L2 deterministic gate 仍因 causal chain 与 actionability 未达阈值而失败。

## Live reasoner 状态

在确认 key 临时恢复为可用后，两个 arm 均完成真实 live evaluator。期间发现 `auto` 偶尔返回带推理杂讯的非严格 JSON；已在共享解析点加入括号平衡提取，并让无效 JSON 触发同一请求的有界重试。修复后 would-retry 的 judge/schema-free 均 30/30 完整执行。

| 指标 | shadow | would-retry |
| --- | ---: | ---: |
| judge score mean | 7.9833 | 8.7500 |
| judge completeness | 0.4667 | 1.0000 |
| judge accuracy | 0.6333 | 0.6667 |
| judge causal chain | 0.7667 | 0.9333 |
| judge no-fabrication | 0.8333 | 0.7667 |
| judge actionability | 0.8000 | 0.9333 |
| schema-free major/critical omission | 0.2333 (7/30) | 0.1667 (5/30) |
| continuation critical action | 0.1667 | 1.0000 |
| completion delta | 0.8333 | 0.0000 |

would-retry 在 completeness、causal chain、actionability、continuation 上有收益，但 no-fabrication 从 `0.8333` 回归到 `0.7667`，schema-free omission 仍高于 `<=0.10` gate。两 arm 的 compressor/evaluator 均为 `auto`，model independence 明确为 false；这仍只能作为非独立诊断证据。

## 放行判定

| Gate | 结果 |
| --- | --- |
| retry 有界且可复现 | PASS |
| deterministic critical recovery | PASS |
| deterministic L2 全阈值 | FAIL |
| live reasoner 完整 A/B | PASS — 两 arm 均 30/30 执行 |
| evaluator 模型独立性 | FAIL — only `auto` available |
| 成本无不可接受回归 | 未建立；当前为 2.521x total tokens / 3.107x latency |

最终判定：**保持 shadow，不放行 would-retry。**

## 下一步

1. 优先修复 would-retry 的 no-fabrication 与 schema-free omission，不能只看 completeness/continuation 的收益。
2. 为正式 gate 使用与 compressor 独立的 evaluator provider/model；若仍只有 `auto`，明确保留为非独立诊断证据。
3. 在质量 gate 通过后，再判断是否需要压缩 recovery ledger 以降低当前 token 与 latency 放大。
