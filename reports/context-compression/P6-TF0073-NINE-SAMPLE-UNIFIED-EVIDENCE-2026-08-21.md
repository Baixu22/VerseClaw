# P6 TF-0073 当前源码九条统一 would-retry 证据（2026-08-21）

## 结论

`[04/07]` 的当前源码绑定九条统一 replay 已通过。批次由合法的九条派生
manifest 驱动，并在 canary metrics 中绑定 manifest digest、transcript identity
检查和当前源码 fingerprint；不是旧 auto 产物的重新叙述。

有效产物：

- `artifacts/p6-would-retry-local-tf0073-r3/manifest-9.json`
- `artifacts/p6-would-retry-local-tf0073-r4/canary-metrics.json`
- `artifacts/p6-would-retry-local-tf0073-r4/would-retry-summaries.jsonl`
- `artifacts/p6-would-retry-local-tf0073-r4/eval-parse/2026-08-21T14-17-53-886Z/summary.json`

生产继续 `promotionStage: shadow`；本轮使用 `127.0.0.1` local fixture，未调用
外部 provider。

## Manifest 绑定

- manifest version: `2`
- requested/sample count: `9/9`
- sample ids: `R5,R6,R7,R8,R14,R16,R23,R27,R29`
- `manifestValidation.valid=true`
- `sampleSelectionHash`: `61c2ce24821563188ce5126671e2aa71a4e06d2f1046b3a1ef046a70db5a15d7`
- derived manifest sha256: `9d7a5fd38ac54937d856a65c86b58981eb708f38fd8d979c2ad4bd4bb1f9de36`
- source frozen manifest sha256: `6677b500a08c1ec3e4c1c474096d005f940726d7ec088158c6df8456d21fc82c`
- every selected transcript matched eval runner identity semantics:
  `pathHash + basename + size + floor(mtimeMs)`
- every selected key matches frozen `sampleManifestKeyV2` semantics
- negative controls with altered selection hash or transcript identity failed closed
  before provider request

## Unified metrics

- `sampleCount=9`
- `retryTotal=9`，每条恰好一次 retry
- `retryWithinLimit=9/9`
- `requestedChecksPassedSamples=9`
- `finalGatePassedSamples=9`
- `handoffSectionsCompleteSamples=9`
- `exactIdentifiersPreservedSamples=9`
- `completedOutcomePreserved=9/9`
- `userPathRedacted=9/9`，裸用户名路径扫描为 `0`
- `missingHandoffSections=0` for every row
- `duplicateHandoffSections=0` for every row
- `missingExactIdentifiers=0` for every row
- `retryBudgetExhaustedSamples=0`
- every row has `verification.passed=true`

Independent eval-runner cross-check on the same manifest and summaries:

- manifest `valid=true`, resolved `9/9`
- L0 link, L1 fidelity and information loss: PASS; critical dropped `0`
- deterministic L2: PASS (`score=10`, causal/actionability `1.0`)
- paired external regression: `0`
- L3: `NOT EXECUTED`; deterministic proxy only, evidence insufficient for real continuation

本次 cross-check 同时修正了两个此前会制造假失败的对齐问题：

- canary recovery ledger 使用与 frozen manifest 相同的 `R<number>-1` ordinal；
- eval runner real sample 合并同一 40-entry tail recovery view，并接受规范
  `Decisions`/`Constraints/Rules` 与历史别名。

修正后 R16 的 decision/latest-outcome/next-action 不再丢失；9 条 L0/L1/L2
均通过，paired external regression 为 `0`。

## Source binding

The metrics record current source fingerprint:

- HEAD: `734ec877e75682861103660fbdea2bd55253ece0`
- canary tree hash: recorded in `artifacts/p6-would-retry-local-tf0073-r4/canary-metrics.json`
- fingerprint covers the canary, recovery-ledger, validated-pipeline and damage-rules sources
- worktree status hash is recorded for audit; the tree is intentionally dirty because unrelated user WIP is preserved

## 验证

- would-retry `--self-test`: PASS
- scoped ESLint: PASS
- root compact focused: `5 files / 63 tests` PASS
- runtime focused: `10 files / 79 tests` PASS
- Node/Web typecheck: exit `0`
- test typecheck: `1291` 个既有 observation-only 错误，未计为主 gate 失败
- Harness structural validate (`--no-diff`): PASS
- comms replay/compare: PASS
- scoped `git diff --check`: PASS

## 诚实边界

- 9 条通过不替代固定 30 条 P6-A 正式 gate。
- deterministic L2 在这 9 条上通过；这不是独立 live judge/schema-free/continuation
  证据，也不解除 05/07 的真实 LLM gate。
- 没有执行独立 judge、schema-free、real continuation 或 model-independence 验收。
- 没有刷新外部 provider/live A/B。
- 不提升 `liveReady`、`productApproved`、default-on 或 promotion stage。
- `manifest-invalid.json`、`manifest-invalid-identity.json` 和 TF-0073 r1/r2
  是负例或语义错误诊断，不是有效证据；r3/r4 才是当前有效批次。
