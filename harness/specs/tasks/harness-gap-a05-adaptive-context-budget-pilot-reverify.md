---
lifecycleStatus: completed
id: harness-gap-a05-adaptive-context-budget-pilot-reverify
title: 复验 A5 自适应上下文预算受控 pilot 门（A05）
scenario: backend-communication
taskType: runtime-bridge
intent: A05 按原 spec 门限复验 A5 Adaptive Context Budget 受控 pilot 门；逐条映射可执行证据，不重定义门限；恢复 `area-composition-spec.md` 指定的 `ContextBudgetPlanner`（含 `replanOnResume`）组合 facade，补齐 resume re-plan 与 P5 现有测试、coverage 守卫。
touchedAreas:
  - harness/specs/tasks/a5-adaptive-context-budget-pilot.md
  - tests/unit/a05-a5-gate-coverage.test.ts
  - tests/unit/cross-area-composition.test.ts
  - tests/unit/deep/a5-deep.test.ts
  - harness/specs/tasks/harness-gap-a05-adaptive-context-budget-pilot-reverify.md
  - docs/dev/harness-gap-closure/a05-adaptive-context-budget-gate.md
  - docs/dev/harness-gap-closure/a05-acceptance.json
  - docs/dev/harness-gap-closure/A05-SHA256SUMS
ownedPaths:
  - harness/specs/tasks/a5-adaptive-context-budget-pilot.md
  - tests/unit/a05-a5-gate-coverage.test.ts
  - harness/specs/tasks/harness-gap-a05-adaptive-context-budget-pilot-reverify.md
  - docs/dev/harness-gap-closure/a05-adaptive-context-budget-gate.md
  - docs/dev/harness-gap-closure/a05-acceptance.json
  - docs/dev/harness-gap-closure/A05-SHA256SUMS
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/resource-aware-wave-scheduler.test.ts
  - tests/unit/performance-budgets.test.ts
  - tests/unit/deprecation-counters.test.ts
  - openclaw_runtime/src/observability/deprecation-counters.test.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-budget-shadow.test.ts
  - openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.test.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.test.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-promotion.test.ts
  - tests/unit/a05-a5-gate-coverage.test.ts
acceptance:
  - 判据1 plan adoption rate ≥80%（即 ignored ≤20%）+ `degrade_to_default_budget`：deprecation-counters 与 compaction-budget-shadow 当前断言 PASS。
  - 判据2 planner p99 ≤30ms：compression-planner 与 performance-budgets 当前断言 PASS。
  - 判据3 `ContextBudgetPlanner.replanOnResume` resume 后重跑：`openclaw_runtime/src/agents/cross-area/cross-area-facades.ts` 实现 + `tests/unit/cross-area-composition.test.ts`（3.6）+ `tests/unit/deep/a5-deep.test.ts`，PASS。
  - 判据4 started wave 不可 re-plan：resource-aware-wave-scheduler 单测 PASS。
  - 判据5 ignored >20% → `degrade_to_default_budget`：现有 registry 单测 PASS。
  - 判据6 A1+A5+A3 cumulative per-turn smoke p99 ≤300ms：performance-budgets 断言 PASS。
  - P5 threshold clamp/default ladder、budgetShadow diagnostics-only、nativeMemory/nativeContextGating provenance、真实 compaction counter 调用点均由现有测试覆盖，PASS。
  - 移除树中不存在的 `tests/unit/cross-area-composition.test.ts` 与 `cross-area/cross-area-facades.ts` 引用；requiredTests 与 coverage 守卫同步。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能复核 A5 门：除 resume 后 replan 的明确 NO-GO 外，现有计数、p99、wave immutability、degrade 与 P5 diagnostics 证据均可追溯；A5 pilot 不毕业，产品锁不变。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/a05-adaptive-context-budget-gate.md
---

# A05 冻结实施边界

A05 按原门限复验 A5 pilot 门，不重定义阈值（adoption ≥80%、p99 ≤30ms、resume replan、wave immutability、degrade_to_default_budget、A1+A5+A3 cumulative p99 ≤300ms）。`ContextBudgetPlanner.replanOnResume` 由 `area-composition-spec.md` 指定的组合 facade 提供，恢复该 facade 并补齐 resume re-plan 测试；组合 facade 是 shadow/pilot 阶段的可测试层，不等同生产 wiring。
