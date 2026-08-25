# P6 TF-0074 deterministic quality evidence（2026-08-21）

## 结论

当前源码的 model-free deterministic recovery batch 已覆盖固定 30 条真实
manifest 样本。Recovery Ledger 投影在 L0/L1/L2 全部通过，critical information
loss 为 0；但这不是 live quality acceptance，因为没有执行独立 judge、
schema-free judge 或 real continuation。

生产继续 `promotionStage: shadow`，本轮没有调用外部 provider，也没有使用
旧 v14/auto live 结果冒充当前源码证据。

## 有效产物

- batch summaries: `artifacts/p6-tf0074-deterministic-recovery-30/would-retry-summaries.jsonl`
- batch metadata: `artifacts/p6-tf0074-deterministic-recovery-30/batch-metadata.json`
- eval summary: `artifacts/p6-tf0074-deterministic-recovery-30/eval/2026-08-21T14-30-55-402Z/summary.json`

Batch metadata records:

- `model: none`
- `sampleCount: 30`
- manifest: fixed `production-manifest-30.json`
- ordinal rule: `R<number> -> ordinalIndex<number-1>`
- recovery ledger source digest

## Deterministic results

- manifest valid/resolved: `30/30`
- L0 link recall/stale exclusion: `1.0 / 1.0`
- L1 critical recall mean/min: `1.0 / 1.0`
- L1 important recall: `1.0`
- L1 weighted recall: `1.0`
- stale leakage: `0`
- verified claims retention: `1.0` (`189/189`)
- critical dropped claims: `0`
- samples with critical drop: `0`
- deterministic L2 score: `10.0` mean/min
- deterministic L2 completeness/accuracy/causal/no-fabrication/actionability:
  `1.0 / 1.0 / 1.0 / 1.0 / 1.0`
- paired external regression: `0/30`

The identical score distribution emits the existing calibration warning:
`all_scores_identical_check_judge_calibration_or_sample_difficulty`. This is kept
visible and is not upgraded to evidence of model quality.

## Missing live evidence

- independent LLM judge: not executed
- schema-free omission judge: not executed
- real continuation: not executed
- `layer3Gate`: `NOT EXECUTED`, `evidenceInsufficient=true`
- full acceptance: `FAIL` by design because `full.realContinuation.requested=false`
  (and the fixed full real minimum is not a substitute for this missing evidence)
- promotion evaluator for `critical-only`: allowed stage remains `shadow`; missing
  reasons include `modelIndependenceOk!=true` and
  `realContinuationCriticalActionRate<0.95`

## Fixes locked by regression

- Real eval samples merge the same authoritative 40-entry tail used by the runtime
  recovery ledger; this prevents split-window R16 fact drift.
- Deterministic L2 recognizes canonical `Decisions`/`Constraints/Rules` and supported
  historical aliases; old heading names no longer create a false causal/actionability
  failure.
- New unit coverage: tail authority, canonical headings, and model-free recovery batch.

## 工程验证

- root context-compression focused: `5 files / 66 tests` PASS
- runtime compact/P6 focused: `10 files / 79 tests` PASS
- deterministic recovery batch unit coverage included; context eval file now `37/37`
- would-retry self-test: PASS
- scoped ESLint: PASS
- Harness structural validate (`--no-diff`): PASS
- comms replay/compare: PASS
- Node/Web typecheck: exit `0`
- test typecheck: existing observation-only errors remain and are not acceptance evidence

## 边界

This closes only the deterministic portion of TF-0074. It does not close the node,
unlock TF-0075, raise `liveReady`, set `productApproved`, enable default-on, or change
the promotion stage.
