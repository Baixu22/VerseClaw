# A03：复验 A3 运行时韧性受控 pilot 门

日期：2026-10-13（Asia/Shanghai）。包码：A03（TF-0295）。真实 provider 调用：无。

## 判据 → 证据映射（原门限，不改）

| 判据 | 证据 | 结果 |
|---|---|---|
| 1. anomalyNonNullCount rate ≤ 20%（100 tick） | `tests/unit/deprecation-counters.test.ts`（A3: anomaly rate > 20% → violated） | PASS |
| 2. p99 ≤ 15ms | `tests/unit/performance-budgets.test.ts` | PASS |
| 3. flag-off parity：`resolveAnomalyPatternForReviewer` 未定义旗标时返回 undefined | `tests/unit/anomaly-classifier.test.ts`（acceptance 1.8） | PASS |
| 4. >20% → `degrade_to_default_decision` | `tests/unit/deprecation-counters.test.ts` | PASS |
| A3 只增强 reviewer context，不改终态决策 | spec「Active pilot limits」+ 实现 | PASS |

## 实跑

- A3 evidence：`anomaly-classifier.test.ts` + `a3-deep.test.ts` + `deprecation-counters.test.ts` + `performance-budgets.test.ts` = 4 files / **72 passed**。
- 覆盖守卫 `tests/unit/a03-a3-gate-coverage.test.ts` **3 passed**。

## 修正的 spec drift（HG25）

原 `a3-runtime-resilience-pilot.md` 的 `requiredTests` **只列了** `performance-budgets.test.ts`，漏了覆盖判据 1/3/4 的 `anomaly-classifier.test.ts` 与 `deprecation-counters` 测试 —— 即部分判据曾是"标题而非可复核状态"。已补入并加 coverage 守卫（断言 requiredTests 均存在、判据1-4 有断言、A3 仅增强）。

## 结论

- A3 pilot 门：**判据1-4 PASS**。A3 维持"仅增强 reviewer context"，不单独改变 Mission 终态决策；不 default-on/GA，产品锁不变。

## 残余（residual）

- 复验为确定性本地证据（非真实 provider/真人）；门限未改。
- 假阳性人工确认样本（review packet）仍属运行期采样，未在本门内伪造。
