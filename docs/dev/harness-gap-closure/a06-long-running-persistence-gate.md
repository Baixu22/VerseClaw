# A06：复验 A6 长运行持久化受控 pilot 门

日期：2026-10-13（Asia/Shanghai）。包码：A06（TF-0298）。真实 provider 调用：无。

## 判据 → 证据映射

| 判据 | 证据 | 结果 |
|---|---|---|
| 1. volatileMislabelCount MUST 0 | `tests/unit/deprecation-counters.test.ts`（critical count/gate）；无生产 verifier caller | 模块级 PASS；生产门 NO-GO |
| 2. verifier fail rate ≤5% | deprecation counter/gate 单测 | 模块级 PASS；生产 verifier NO-GO |
| 3. A6 p99 ≤300ms（10 pause/resume cycles） | 当前无对应性能测试 | NOT-MEASURED |
| 4. rollback 后 `requiresReverification=true` | 源码无 `ResumeContractVerifier` / `requiresReverification` | NO-GO |
| 5. lease 先于 checkpoint | 源码无 `FingerprintLeaseCoordinator`；`file-fingerprint` 仅提供哈希原语 | NO-GO |
| 6. volatile 或 fail >5% → `degrade_to_full_reverification` | `deprecation-counters` 当前断言 | PASS |

## 关键边界

- A6 的计数器与故障回退 gate 可以作为模块级证据，但当前源码没有 `ResumeContractVerifier`、`FingerprintLeaseCoordinator` 或 `requiresReverification` 符号；不能把 counter 单测冒充生产 resume contract 验收。
- `performance-budgets.test.ts` 没有 A6 pause/resume 10-cycle p99 测试，因此性能 gate 单独记为 NOT-MEASURED。
- A6 pilot 仍不毕业，无 default-on/GA，无产品锁变化。

## 实跑

- A6 定向 evidence：counter、fingerprint、runtime resume shadow、checkpoint builder、long-task control 等现有测试 PASS（详见 `a06-acceptance.json`）。
- A06 coverage 守卫固定 requiredTests、counter/action、critical gate，以及 verifier/lease/requiresReverification 的 NO-GO 边界。

## 修正的 spec drift

原 `a6-long-running-persistence-pilot.md` 引用了不存在的 `tests/unit/cross-area-composition.test.ts` 与 `openclaw_runtime/src/agents/cross-area/cross-area-facades.ts`；已移除并补入现有 counter、fingerprint、resume shadow、checkpoint 与 long-task 测试，加 A06 coverage 守卫。门限文案未改。
