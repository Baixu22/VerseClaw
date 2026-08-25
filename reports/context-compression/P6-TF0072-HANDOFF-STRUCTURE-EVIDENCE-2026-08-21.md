# P6 TF-0072 handoff 结构保留证据（2026-08-21）

## 结论

`[03/07]` 的 retry 后 handoff 结构修复已在当前 canary 入口闭合。固定九条
本地 fixture replay（R5、R6、R7、R8、R14、R16、R23、R27、R29）全部完成
一次 bounded retry 后通过最终 gate：11 个规定区块各出现一次，缺失区块为 0，
重复区块为 0。

这仍是本地 fixture/离线结构证据，不是外部 provider/live acceptance；生产继续
保持 `promotionStage: shadow`。

## 修复边界

- retry 后只在 `would-retry` 且确实发生一次 retry 时执行确定性结构收敛；shadow
  arm 的摘要正文保持原样，shadow 不 retry、不补区块。
- 已存在的规范区块内容保留；缺失区块只补证据受限的短占位。
- `## Next Actions` 缺失时优先写入 authoritative continuation directive 中的
  candidate action id，不合成新的报告或交付动作。
- 兼容 provider 常见别名并映射为规范区块：
  `Key Decisions and Constraints` -> `Decisions` + `Constraints/Rules`，
  `Files Touched / Relevant Files` -> `Files Touched`，
  `Tests and Results` -> `Tests`，`Failed Attempts` -> `Attempts and Failures`。
- 别名内容在规范输出中只保留一次对应 heading；不会追加第二套 handoff。

## 九条本地 replay

有效产物：`artifacts/p6-would-retry-local-tf0072-r5/canary-metrics.json`

- schema: `p6-would-retry-canary/v3`
- fixture provider: `http://127.0.0.1:53139/v1` / `local-fixture`
- sampleCount: `9`
- retryTotal: `9`，每条恰好一次
- requestedChecksPassedSamples: `9`
- finalGatePassedSamples: `9`
- handoffSectionsCompleteSamples: `9`
- exactIdentifiersPreservedSamples: `9`
- retryBudgetExhaustedSamples: `0`
- unredacted user paths: `0`
- completedOutcomePreserved: `9/9`
- 每条 `missingHandoffSections=[]`、`duplicateHandoffSections=[]`、
  `missingExactIdentifiers=[]`、`passed=true`

样本顺序：`R5,R6,R7,R8,R14,R16,R23,R27,R29`。

`tf0072-r3` 的 `sampleCount=0` 是一次 PowerShell `--only` 参数解析错误，
不纳入证据；`tf0072-r4` 是别名保留前的结构 replay，`tf0072-r5` 才是当前
最终源码和别名保留 self-test 下的有效批次。

## 验证

- would-retry `--self-test`: PASS
- scoped ESLint: PASS
- root compact focused: `5 files / 63 tests` PASS
- runtime damage/validated/addressability/manual/preemptive: `5 files / 39 tests` PASS
- P6/promotion/planner/orchestrator/deprecation counters: `5 files / 40 tests` PASS
- Node/Web typecheck: exit `0`
- test typecheck: `1291` 个既有 observation-only 错误，不计为主 gate 失败
- Harness structural validate (`--no-diff`): PASS
- comms replay/compare: PASS
- scoped `git diff --check`: PASS

## 诚实边界

- diff-aware Harness validate/dry-run 仍会被 Task Forest 文件和 compact ownership
  外的既有 dirty 路径阻断；没有扩大 `touchedAreas`。
- 没有调用外部 provider，没有执行 30 条正式 P6 acceptance、独立 evaluator 或
  live continuation。
- 没有提升 `liveReady`、`productApproved`、default-on 或 promotion stage。
