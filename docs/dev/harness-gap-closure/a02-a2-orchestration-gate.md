# A02：复验 A2 多 agent 编排受控 pilot 门

日期：2026-10-13（Asia/Shanghai）。包码：A02（TF-0294）。真实 provider 调用：无。

## 判据 → 证据映射（原门限，不改）

| 判据 | 证据 | 结果 |
|---|---|---|
| 1. deferral agreement ≥ 90%（10 波） | `tests/unit/deprecation-counters.test.ts`（agreement/disagreement 计数 + >10% → `degrade_to_live_only`） | PASS |
| 2. started wave 不可 re-plan | `tests/unit/resource-aware-wave-scheduler.test.ts`（已 start 的 wave 忽略 rePlan；保留 taskNodeIds） | PASS |
| 3. p99 ≤ 80ms | `tests/unit/performance-budgets.test.ts` | PASS |
| 4. 多 worker resume 创建新会话（不 reconnect） | **无专用测试** | **NO-GO（residual）** |

## 实跑

- A2 required（scheduler + performance）：2 files / **14 passed**。
- 计数器测试：`tests/unit/deprecation-counters.test.ts` **19 passed**；runtime 计数器 **3 passed**。
- a2-deep：`tests/unit/deep/a2-deep.test.ts` **26 passed**。
- 覆盖守卫 `tests/unit/a02-a2-gate-coverage.test.ts` **3 passed**。

## 修正的 spec drift（HG25）

原 `a2-multi-agent-orchestration-pilot.md`：
- `touchedAreas` 引用了 **不存在** 的 `openclaw_runtime/src/agents/cross-area/cross-area-facades.ts`；
- `requiredTests` 引用了 **不存在** 的 `tests/unit/cross-area-composition.test.ts`，且漏了覆盖判据1/预算的计数器测试。

已移除两个不存在引用，补入计数器测试，并加 `a02-a2-gate-coverage.test.ts` 守卫（断言 requiredTests 均在树中存在、判据1-3 有断言、判据4 记为 residual）。

## 结论

- A2 pilot 门：**判据1-3 PASS**，**判据4 NO-GO** → 整体 **未完全毕业**；A2 维持 pilot，不 default-on/GA，产品锁不变。

## 残余（residual）

- 判据4（多 worker resume 新会话）缺专用测试——需要单独的 resume 测试才能收口。
- 确定性本地证据（非真实 provider/真人）；门限未改。
