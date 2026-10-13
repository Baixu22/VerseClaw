---
lifecycleStatus: completed
id: harness-gap-a04-decision-quality-pilot-reverify
title: 复验 A4 决策质量受控 pilot 门（A04）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: A04 按原 spec 门限复验 A4 Decision Quality 受控 pilot 门；逐条映射现有可执行证据，不重定义门限；确认 A4 是文档规定的 offline/dev-tool-only 模块，补齐 spec 的 requiredTests 漂移，并把生产审计 caller 缺失与 A4 累计延迟未测如实记为 NO-GO residual。
touchedAreas:
  - harness/specs/tasks/a4-decision-quality-pilot.md
  - tests/unit/a04-a4-gate-coverage.test.ts
  - harness/specs/tasks/harness-gap-a04-decision-quality-pilot-reverify.md
  - docs/dev/harness-gap-closure/a04-decision-quality-gate.md
  - docs/dev/harness-gap-closure/a04-acceptance.json
  - docs/dev/harness-gap-closure/A04-SHA256SUMS
ownedPaths:
  - harness/specs/tasks/a4-decision-quality-pilot.md
  - tests/unit/a04-a4-gate-coverage.test.ts
  - harness/specs/tasks/harness-gap-a04-decision-quality-pilot-reverify.md
  - docs/dev/harness-gap-closure/a04-decision-quality-gate.md
  - docs/dev/harness-gap-closure/a04-acceptance.json
  - docs/dev/harness-gap-closure/A04-SHA256SUMS
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
  - tests/unit/decision-quality-auditor.test.ts
  - tests/unit/deprecation-counters.test.ts
  - tests/unit/performance-budgets.test.ts
  - tests/unit/deep/a4-deep.test.ts
  - tests/unit/trace-truncation.test.ts
  - tests/unit/a04-a4-gate-coverage.test.ts
acceptance:
  - 判据1 lowQualityDecisions rate ≤ 10% + >10% → degrade_to_audit_only：decision-quality-auditor、deprecation-counters 与 a4-deep 有当前断言；PASS（原门限未改）。
  - 判据2 audit coverage（shadow sampling rate = 1.0）：模块内 auditBatch 按记录数 1:1 记 audited；但生产审计 caller 按开发手册明确禁止，当前不存在生产 coverage，原 Active Pilot 生产门保持 NO-GO。
  - 判据3 budget violation response：degrade_to_audit_only 在 >10% 时触发；PASS。
  - 判据4 degradation order：trace-truncation 断言 a4→a3→a5 先于 a1 被丢弃；A4 不在生产 turn path，per-turn cumulative latency smoke 未覆盖 A4，数值延迟门保持 NOT-MEASURED/NO-GO。
  - 修正 spec drift：requiredTests 补入 auditor、a4-deep 与 degradation-order 测试，并加 A04 coverage 守卫。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能复核 A4 门：模块级计数/action/顺序 PASS；生产审计 caller 与 A4 cumulative latency 明确未满足，A4 pilot 不毕业，产品锁不变。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/a04-decision-quality-gate.md
---

# A04 冻结实施边界

A04 不新增生产功能。开发手册 `§1.4 A4 — Decision Quality (offline pure functions only)` 明确要求 A4 只能由显式 dev-tool invocation 调用，不能运行在任何 production turn path。因此本包只复验模块级计数、故障回退与顺序证据，修正 archived A4 pilot spec 的 `requiredTests` 漂移；生产 caller 和 A4 cumulative latency 缺失保持 NO-GO，不用新 spec 文本覆盖既有边界。
