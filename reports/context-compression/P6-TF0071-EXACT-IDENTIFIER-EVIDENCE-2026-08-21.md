# P6 TF-0071 exact identifier 保留证据（2026-08-21）

## 结论

`[02/07]` 的 exact identifier 保留已在当前代码上闭合。R14、R16、R27 的
本地 would-retry replay 均恰好执行一次 retry，evidence-backed identifier
最终缺失数为 `0`，用户路径扫描未发现裸用户名。

这只证明 identifier 保留与 redaction 行为，不代表 handoff 结构或 9 条统一
would-retry 验收通过。生产继续保持 `promotionStage: shadow`；本轮未调用外部
provider，使用 `127.0.0.1` 本地 fixture。

## 实现边界

- custom identifier 集只来自 recovery ledger 中 evidence-backed facts 与
  continuation action id，不复用 broad strict transcript scan。
- canary 调用方执行 custom identifier gate；shared validated pipeline 的
  `strict` / `custom` / `off` 既有语义不变。
- identifier 缺失最多触发一次 provider retry。
- retry 后仍缺失时，只在 narrative 的单个 `## Exact identifiers` 区块补入
  已脱敏 identifier；不重复 recovery ledger 或 handoff 区块。
- self-test 直接覆盖 `C:\Users\[REDACTED_USER]\workspace\README.md`，并拒绝
  `C:\Users\27933` 回流。

## 本地 R14/R16/R27 replay

产物：`artifacts/p6-would-retry-local-tf0071-r1/canary-metrics.json`

- schema: `p6-would-retry-canary/v3`
- provider: `http://127.0.0.1:59155/v1` / `local-fixture`
- sampleCount: `3`
- retryTotal: `3`，每条恰好一次
- requestedChecksPassedSamples: `3`
- exactIdentifiersPreservedSamples: `3`
- R14/R16/R27 的 `missingExactIdentifiers` 均为 `[]`
- R14/R16/R27 的 `userPathRedacted` 均为 `true`
- 每条 narrative 的 `## Exact identifiers` 均恰好一次

三条的 `finalGatePassed=false` 与 `retryBudgetExhausted=true` 仍由缺失
`Decisions`、`Open TODOs`、`Constraints/Rules`、`Pending user asks` 导致；没有
`missing_exact_identifier` 原因。该结构缺口属于 `[03/07]`，未在本节点内越界修复。

## 验证

- would-retry `--self-test`: PASS
- scoped ESLint: PASS
- root compact focused: `5 files / 63 tests` PASS
- runtime damage/validated/addressability/manual/preemptive: `5 files / 39 tests` PASS
- P6 promotion/safeguard: `2 files / 14 tests` PASS
- planner/orchestrator/deprecation counters: `3 files / 26 tests` PASS
- Node/Web typecheck: exit `0`
- test typecheck: `1291` 个既有 observation-only 错误，未计为主 gate 通过
- Harness structural validate (`--no-diff`): PASS
- comms replay/compare: PASS
- scoped `git diff --check`: PASS

## 诚实边界

- diff-aware Harness validate/dry-run 仍被 Task Forest 文件和 compact ownership
  外的既有 dirty 路径阻断；未扩大 `touchedAreas` 制造假绿。
- 没有刷新外部 provider canary。
- 没有执行 9 条统一验收、30 条正式 gate 或独立 evaluator。
- 没有提升 `liveReady`、`productApproved`、default-on 或 production stage。
