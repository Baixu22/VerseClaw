# A04：复验 A4 决策质量受控 pilot 门

日期：2026-10-13（Asia/Shanghai）。包码：A04（TF-0296）。真实 provider 调用：无。

## 判据 → 证据映射

| 判据 | 证据 | 结果 |
|---|---|---|
| 1. lowQualityDecisions rate ≤ 10% | `tests/unit/decision-quality-auditor.test.ts`、`tests/unit/deprecation-counters.test.ts`、`tests/unit/deep/a4-deep.test.ts` | PASS |
| 2. audit coverage（shadow sampling = 1.0） | 模块级 `auditBatch()` 以 records.length 1:1 计 audited；生产 caller 不存在 | 模块级 PASS；生产 Active Pilot 门 NO-GO |
| 3. >10% → `degrade_to_audit_only` | `tests/unit/deprecation-counters.test.ts`、`tests/unit/deep/a4-deep.test.ts` | PASS |
| 4. degradation order A4→A3→A5→A1 | `tests/unit/trace-truncation.test.ts`（a4/a3/a5 先被 drop，a1 保留） | 顺序 PASS；A4 生产累计延迟 NOT-MEASURED/NO-GO |

## 关键边界

- `docs/runtime-design/development-manual.md` 的 A4 条款是 **offline pure functions only**：模块不得运行于 production turn path，只能由显式 dev-tool invocation（CLI、测试 fixture、debug panel）调用。
- 因此“A4 生产 caller 缺失”不是本包可顺手补的接线，而是当前冻结设计选择；不把 counter 单测冒充生产审计。
- A4 pilot 仍是受控验证/离线诊断，不是 default-on/GA；product locks 不变。

## 实跑

- A4 evidence：`decision-quality-auditor` + `deprecation-counters` + `performance-budgets` + `deep/a4-deep` + `trace-truncation` = 5 files / **64 passed**。
- 覆盖守卫 `tests/unit/a04-a4-gate-coverage.test.ts` 固定 requiredTests、counter action、A4-first 顺序和 offline-only 边界。

## 修正的 spec drift

原 archived `a4-decision-quality-pilot.md` 的 `requiredTests` 只列 `deprecation-counters.test.ts` 与 `performance-budgets.test.ts`，遗漏了真正的 auditor 单测、A4 deep 与 degradation-order 证据；已补齐并加 A04 coverage 守卫。门限文案没有改动。
