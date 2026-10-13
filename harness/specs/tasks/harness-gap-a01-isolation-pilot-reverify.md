---
lifecycleStatus: completed
id: harness-gap-a01-isolation-pilot-reverify
title: 复验 A1 隔离执行受控 pilot 门（A01）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: A01 按原 spec 门限复验 A1 Layered Execution Isolation 的受控 pilot 门：逐条把 4 个毕业判据映射到当前候选的可执行证据；不重定义门限；记录 spec requiredTests 缺口修正（计数器测试原缺）与残余。
touchedAreas:
  - harness/specs/tasks/a1-layered-isolation-pilot.md
  - tests/unit/a01-a1-gate-coverage.test.ts
  - harness/specs/tasks/harness-gap-a01-isolation-pilot-reverify.md
  - docs/dev/harness-gap-closure/a01-a1-isolation-gate.md
  - docs/dev/harness-gap-closure/a01-acceptance.json
  - docs/dev/harness-gap-closure/A01-SHA256SUMS
ownedPaths:
  - harness/specs/tasks/a1-layered-isolation-pilot.md
  - tests/unit/a01-a1-gate-coverage.test.ts
  - harness/specs/tasks/harness-gap-a01-isolation-pilot-reverify.md
  - docs/dev/harness-gap-closure/a01-a1-isolation-gate.md
  - docs/dev/harness-gap-closure/a01-acceptance.json
  - docs/dev/harness-gap-closure/A01-SHA256SUMS
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
  - tests/unit/tool-registration.test.ts
  - tests/unit/policy-light-snapshotter.test.ts
  - tests/unit/shadow-write-event-recorder.test.ts
  - tests/unit/trace-namespace-enforcement.test.ts
  - tests/unit/performance-budgets.test.ts
  - tests/unit/deprecation-counters.test.ts
  - tests/unit/a01-a1-gate-coverage.test.ts
acceptance:
  - 判据1 legacy fallback rate < 5%：deprecation-counters 单测断言 >5% → violated、<=5% → not violated（数值门限未改）。
  - 判据2 p99 ≤ 200ms：performance-budgets 断言 p99 预算。
  - 判据3 declaredPathViolationCount 单独计数并被跟踪。
  - 判据4 checkBudgetViolation('a1') 在 rate>5% 时返回 action=degrade_to_legacy。
  - 工具 writeRiskProfile 声明与命名空间拒绝（claw.a4.tool.choice on a1）由 tool-registration / trace-namespace-enforcement 覆盖。
  - 发现并修正 spec drift：a1 spec 的 requiredTests 原缺计数器测试；已补入并加 coverage 守卫，原门限字节不变。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能从当前候选复核 A1 毕业门，逐条看到判据与证据；门限未被重定义；spec requiredTests 与证据同步。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/a01-a1-isolation-gate.md
---

# A01 冻结实施边界

A01 不实现新功能，只复验既有 A1 pilot 门并修正 spec drift。门限取自原 `a1-layered-isolation-pilot.md`（fallback <5%、p99 ≤200ms、declaredPathViolationCount 趋势、degrade_to_legacy），**不重定义**。修正点：原 spec 的 `requiredTests` 漏了覆盖判据1/3/4 的计数器测试；补入 `tests/unit/deprecation-counters.test.ts` 与 `openclaw_runtime/src/observability/deprecation-counters.test.ts`，并加 `tests/unit/a01-a1-gate-coverage.test.ts` 守卫。
