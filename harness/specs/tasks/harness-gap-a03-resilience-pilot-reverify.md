---
lifecycleStatus: completed
id: harness-gap-a03-resilience-pilot-reverify
title: 复验 A3 运行时韧性受控 pilot 门（A03）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: A03 按原 spec 门限复验 A3 Runtime Resilience 受控 pilot 门；逐条映射 4 个判据到当前可执行证据，不重定义门限；修正 spec 的 requiredTests 缺口（原只列 performance-budgets，漏了覆盖判据1/3/4 的 classifier 与计数器测试）。
touchedAreas:
  - harness/specs/tasks/a3-runtime-resilience-pilot.md
  - tests/unit/a03-a3-gate-coverage.test.ts
  - harness/specs/tasks/harness-gap-a03-resilience-pilot-reverify.md
  - docs/dev/harness-gap-closure/a03-a3-resilience-gate.md
  - docs/dev/harness-gap-closure/a03-acceptance.json
  - docs/dev/harness-gap-closure/A03-SHA256SUMS
ownedPaths:
  - harness/specs/tasks/a3-runtime-resilience-pilot.md
  - tests/unit/a03-a3-gate-coverage.test.ts
  - harness/specs/tasks/harness-gap-a03-resilience-pilot-reverify.md
  - docs/dev/harness-gap-closure/a03-a3-resilience-gate.md
  - docs/dev/harness-gap-closure/a03-acceptance.json
  - docs/dev/harness-gap-closure/A03-SHA256SUMS
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
  - tests/unit/performance-budgets.test.ts
  - tests/unit/anomaly-classifier.test.ts
  - tests/unit/deprecation-counters.test.ts
  - openclaw_runtime/src/observability/deprecation-counters.test.ts
  - tests/unit/a03-a3-gate-coverage.test.ts
acceptance:
  - 判据1 anomalyNonNullCount rate ≤ 20%（100 tick）+ >20% → degrade_to_default_decision：deprecation-counters 单测断言（数值门限未改）。
  - 判据2 p99 ≤ 15ms：performance-budgets 断言。
  - 判据3 flag-off parity：resolveAnomalyPatternForReviewer 在 featureFlags 未定义时返回 undefined（acceptance 1.8）。
  - 判据4 超预算响应：degrade_to_default_decision 生效。
  - A3 只增强 reviewer context，绝不单独改变 Mission 终态决策。
  - 修正 spec drift：requiredTests 补入 classifier 与计数器测试；加 coverage 守卫。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能复核 A3 门：判据1-4 PASS，门限未改，spec requiredTests 与证据同步，A3 仍只做增强。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/a03-a3-resilience-gate.md
---

# A03 冻结实施边界

A03 不实现新功能，只复验既有 A3 pilot 门并修正 spec drift。门限取自原 `a3-runtime-resilience-pilot.md`（anomaly rate ≤20%、p99 ≤15ms、flag-off parity、degrade_to_default_decision），**不重定义**。修正点：原 spec 的 `requiredTests` 只列 `performance-budgets.test.ts`，漏了覆盖判据1/3/4 的 `anomaly-classifier.test.ts` 与计数器测试；已补入并加 coverage 守卫。
