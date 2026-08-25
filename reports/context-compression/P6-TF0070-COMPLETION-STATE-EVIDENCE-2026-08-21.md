# P6 TF-0070 完成态保护证据（2026-08-21）

## 结论

`[01/07]` 的完成态保护已在当前代码上闭合：固定 9 条样本的
`completedOutcomePreserved` 语义覆盖为 `9/9`。这只证明已完成结果不会被
compact/retry 重新说成待办，不代表 9 条整体 would-retry 或 P6 正式验收通过。

生产配置继续保持 `promotionStage: shadow`。本轮没有调用外部 provider，使用的是
`127.0.0.1` 本地 stub 和已有落盘摘要。

## 当前行为

- deterministic continuation directive 明确包含
  `Do not repeat completed work; preserve the validated outcome:` 时：
  - actionable pending 会成为一次 bounded retry 的原因；
  - retry 后仍矛盾时，只清除 Goal/Attempts/Current State 中的正向 pending 行；
  - `Open TODOs`、`Pending user asks`、`Next Actions` 归一为 `None.`；
  - 历史失败和约束区内容保留。
- directive 没有声明 completed outcome 时，不修改真实 pending 工作。
- shadow arm 不传 recovery material，行为不变。

## 固定 9 条覆盖

| 样本 | directive 状态 | 完成态结果 |
| --- | --- | --- |
| R5 | completed outcome | preserved |
| R6 | completed outcome | preserved |
| R7 | completed outcome | preserved |
| R8 | completed outcome | preserved |
| R14 | completed outcome | preserved |
| R16 | completed outcome；旧摘要虚假 pending | 本地 replay 修复后 preserved |
| R23 | evidence-backed unfinished action | real pending preserved，不触发 completed 清理 |
| R27 | evidence-backed unfinished action | real pending preserved，不触发 completed 清理 |
| R29 | completed outcome；旧摘要虚假 in-progress | 本地 replay 修复后 preserved |

## 本地 R16/R29 replay

产物：`artifacts/p6-would-retry-local-tf0070-r3/canary-metrics.json`

结果：

- sampleCount: `2`
- retryTotal: `2`（每条恰好一次）
- requestedChecksPassedSamples: `2`
- finalGatePassedSamples: `2`
- retryBudgetExhaustedSamples: `0`
- R16/R29 均为 `completedOutcomePreserved=true`、`passed=true`
- 路径继续使用 `[REDACTED_USER]`
- `Open TODOs`、`Pending user asks`、`Next Actions` 均为 `None.`

## 验证

- would-retry `--self-test`: PASS
- scoped ESLint: PASS
- root compact focused: `63/63` PASS
- runtime damage/validated/addressability/manual/preemptive: `38/38` PASS
- P6 promotion/safeguard: `14/14` PASS
- Harness structural validate (`--no-diff`): PASS
- Node/Web typecheck: exit `0`; test typecheck 1291 个既有 observation-only 错误不影响主 gate

## 边界

- 没有刷新外部 provider canary。
- 没有宣称 9 条整体 final gate 通过；该工作属于 `[04/07]`。
- 没有提升 stage、`liveReady`、`productApproved` 或 default-on。
