---
lifecycleStatus: completed
id: harness-gap-a02-orchestration-pilot-reverify
title: 复验 A2 多 agent 编排受控 pilot 门（A02）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: A02 按原 spec 门限复验 A2 Multi-Agent Orchestration 受控 pilot 门；逐条映射 4 个判据到当前可执行证据，不重定义门限；修正 spec 里两个不存在的路径引用并补入覆盖判据1/预算的计数器测试；判据4（多 worker resume 新会话）无专用测试，如实记为 NO-GO residual。
touchedAreas:
  - harness/specs/tasks/a2-multi-agent-orchestration-pilot.md
  - tests/unit/a02-a2-gate-coverage.test.ts
  - harness/specs/tasks/harness-gap-a02-orchestration-pilot-reverify.md
  - docs/dev/harness-gap-closure/a02-a2-orchestration-gate.md
  - docs/dev/harness-gap-closure/a02-acceptance.json
  - docs/dev/harness-gap-closure/A02-SHA256SUMS
ownedPaths:
  - harness/specs/tasks/a2-multi-agent-orchestration-pilot.md
  - tests/unit/a02-a2-gate-coverage.test.ts
  - harness/specs/tasks/harness-gap-a02-orchestration-pilot-reverify.md
  - docs/dev/harness-gap-closure/a02-a2-orchestration-gate.md
  - docs/dev/harness-gap-closure/a02-acceptance.json
  - docs/dev/harness-gap-closure/A02-SHA256SUMS
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
  - tests/unit/deprecation-counters.test.ts
  - openclaw_runtime/src/observability/deprecation-counters.test.ts
  - tests/unit/performance-budgets.test.ts
  - tests/unit/a02-a2-gate-coverage.test.ts
acceptance:
  - 判据1 deferral agreement ≥ 90% + disagreement>10% → degrade_to_live_only：deprecation-counters 单测断言（数值门限未改）。
  - 判据2 started wave 不可 re-plan：resource-aware-wave-scheduler 单测（"ignores rePlan when appliesToWave is already started" 等）。
  - 判据3 p99 ≤ 80ms：performance-budgets 断言。
  - 判据4 多 worker resume 创建新会话：当前树无专用测试 → 如实记 NO-GO residual，不伪装通过。
  - 修正 spec drift：移除树中不存在的 cross-area-composition.test.ts 与 cross-area/cross-area-facades.ts 引用，补入计数器测试，并加 coverage 守卫。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能复核 A2 门：判据1-3 PASS、判据4 未验证（NO-GO），spec 引用不再指向不存在的文件。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/a02-a2-orchestration-gate.md
---

# A02 冻结实施边界

A02 不实现新功能，只复验既有 A2 pilot 门并修正 spec drift。门限取自原 `a2-multi-agent-orchestration-pilot.md`（agreement ≥90%、started wave 不可 re-plan、p99 ≤80ms、resume 新会话），**不重定义**。判据4 在当前树没有专用测试，保持 NO-GO（不新增测试伪造覆盖，也不放行毕业）。
