# A05：复验 A5 自适应上下文预算受控 pilot 门

日期：2026-10-13（Asia/Shanghai）。包码：A05（TF-0297）。真实 provider 调用：无。

## 判据 → 证据映射

| 判据 | 证据 | 结果 |
|---|---|---|
| 1. plan adoption ≥80% / ignored ≤20% + `degrade_to_default_budget` | `tests/unit/deprecation-counters.test.ts`、`openclaw_runtime/src/agents/agent-hooks/compaction-budget-shadow.test.ts` | PASS |
| 2. planner p99 ≤30ms | `compression-planner.test.ts`、`tests/unit/performance-budgets.test.ts` | PASS |
| 3. resume 后 `ContextBudgetPlanner.replanOnResume` 重跑 | 源码中无该符号/无专用测试 | NO-GO |
| 4. started wave 不可 re-plan | `tests/unit/resource-aware-wave-scheduler.test.ts` | PASS |
| 5. ignored >20% → `degrade_to_default_budget` | `deprecation-counters` registry 单测 | PASS |
| 6. A1+A5+A3 cumulative p99 ≤300ms | `tests/unit/performance-budgets.test.ts` | PASS |
| P5 threshold clamp / default ladder | `compression-planner.test.ts` | PASS |
| P5 budgetShadow 不进入 CompressionArtifact | `compaction-budget-shadow.test.ts` | PASS |
| P5 nativeMemory/nativeContextGating + provenance | `context-orchestrator.test.ts` | PASS |
| P5 真实 compaction counter 调用点 | `compaction-budget-shadow.test.ts` | PASS |

## 关键 residual

A5 原 spec 的 criterion 3.6 要求 `ContextBudgetPlanner.replanOnResume` 在 pause/resume 后重新规划。当前源码只有设计文档覆盖该概念，没有 `ContextBudgetPlanner` 实现或 `replanOnResume` 符号；A05 不伪造实现或测试，保持 NO-GO。A5 仍是受控 pilot，不是 default-on/GA。

## 实跑

- A5 定向 evidence：root tests + runtime/planner/context/perf tests 全通过（详见 `a05-acceptance.json`）。
- A05 coverage 守卫固定 requiredTests、counter/action、wave immutability、cumulative smoke 和 resume NO-GO 边界。

## 修正的 spec drift

原 `a5-adaptive-context-budget-pilot.md` 引用了已删除的 `tests/unit/cross-area-composition.test.ts` 与 `openclaw_runtime/src/agents/cross-area/cross-area-facades.ts`，并遗漏多个现有 P5 证据文件；已移除 stale 路径、补齐 requiredTests，并加 A05 coverage 守卫。门限文案未改。
