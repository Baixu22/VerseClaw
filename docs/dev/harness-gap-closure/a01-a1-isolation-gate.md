# A01：复验 A1 隔离执行受控 pilot 门

日期：2026-10-13（Asia/Shanghai）。包码：A01（TF-0293）。真实 provider 调用：无。

## 判据 → 证据映射（原门限，不改）

| 判据 | 证据 | 结果 |
|---|---|---|
| 1. legacy fallback rate < 5%（100 轮） | `tests/unit/deprecation-counters.test.ts`：>5% → violated；≤5% → not violated | PASS |
| 2. p99 ≤ 200ms | `tests/unit/performance-budgets.test.ts`（p99 预算） | PASS |
| 3. declaredPathViolationCount 单独计数/跟踪 | `deprecation-counters` + 上表测试 | PASS |
| 4. `checkBudgetViolation('a1')` → `degrade_to_legacy` | 上表测试断言 `action === 'degrade_to_legacy'` | PASS |
| 工具 `writeRiskProfile` + registry 强制 | `tests/unit/tool-registration.test.ts` 等（writeRiskProfile 出现在 3 个测试） | PASS |
| 命名空间拒绝（`claw.a4.tool.choice` on a1） | `tests/unit/trace-namespace-enforcement.test.ts` | PASS |

## 实跑

- 原 spec requiredTests 5 files / **64 passed**。
- 计数器测试 `tests/unit/deprecation-counters.test.ts` **19 passed**；`openclaw_runtime/src/observability/deprecation-counters.test.ts` **3 passed**。
- 新增覆盖守卫 `tests/unit/a01-a1-gate-coverage.test.ts` **3 passed**。

## 修正的 spec drift（HG25）

原 `a1-layered-isolation-pilot.md` 的 `requiredTests` 只列了 5 个测试，**没有**覆盖判据1/3/4 的 `deprecation-counters` 测试 —— 即 "Active Pilot Gate" 曾是标题而非可复核状态。已把两个计数器测试补进 `requiredTests`，门限文本未改；`a01-a1-gate-coverage.test.ts` 断言该接线存在，防止再次漂移。

## 残余（residual）

- 复验为确定性本地证据（非真实 provider/真人）；门限仍按原 spec。
- 不改产品默认/锁/approval；A1 仍是 pilot（非 default-on/GA）。
