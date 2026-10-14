# A06：复验 A6 长运行持久化受控 pilot 门

日期：2026-10-14（Asia/Shanghai）。包码：A06（TF-0298）。真实 provider 调用：无。

## 判据 → 证据映射

| 判据 | 证据 | 结果 |
|---|---|---|
| 1. volatileMislabelCount MUST 0 | `tests/unit/deprecation-counters.test.ts`（critical count/gate）；`ResumeContractVerifier` 提供真实 resume 检测 caller | PASS |
| 2. verifier fail rate ≤5% | deprecation counter/gate 单测；`ResumeContractVerifier.verify` | PASS |
| 3. A6 p99 ≤300ms（10 pause/resume cycles） | `tests/unit/performance-budgets.test.ts`（A6 performance budgets，10 pause/resume cycles） | PASS |
| 4. rollback 后 `requiresReverification=true` | `cross-area-facades.ts` `ResumeContractVerifier`；`cross-area-composition.test.ts`（3.3）；`deep/a6-deep.test.ts` | PASS |
| 5. lease 先于 checkpoint | `cross-area-facades.ts` `FingerprintLeaseCoordinator`；`cross-area-composition.test.ts`（3.8）；`deep/a6-deep.test.ts` | PASS |
| 6. volatile 或 fail >5% → `degrade_to_full_reverification` | `deprecation-counters` 当前断言 | PASS |

## 关键边界

- A6 的 verifier、lease 顺序与 pause/resume p99 现已落于设计文档 `area-composition-spec.md` 指定的组合 facade
  `openclaw_runtime/src/agents/cross-area/cross-area-facades.ts`；组合矩阵 `tests/unit/cross-area-composition.test.ts`
  与 `tests/unit/deep/a6-deep.test.ts` 覆盖 rollback→requiresReverification、lease-before-checkpoint 与 race guard。
- `FingerprintLeaseCoordinator` 只编排既有 file-fingerprint 原语与 checkpoint 写入顺序，不引入第二套持久化真源。
- A6 仍是受控 pilot，不是 default-on/GA，产品锁不变。

## 实跑

- A6 定向 evidence：counter、fingerprint、runtime resume shadow、checkpoint builder、long-task control、cross-area composition、deep/a6、performance-budgets A6 = 全部 PASS（详见 `a06-acceptance.json`）。
- A06 coverage 守卫固定 requiredTests、counter/action、critical gate，以及恢复的 verifier/lease/requiresReverification 证据。

## 修正的 spec drift

原 `a6-long-running-persistence-pilot.md` 引用的 `cross-area/cross-area-facades.ts` 曾被当作死代码删除；该文件是 `area-composition-spec.md` 指定的组合 facade，现已恢复并接回 requiredTests，加 A06 coverage 守卫。门限文案未改。
