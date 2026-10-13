---
lifecycleStatus: completed
id: harness-gap-a06-long-running-persistence-pilot-reverify
title: 复验 A6 长运行持久化受控 pilot 门（A06）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: A06 按原 spec 门限复验 A6 Long-Running Persistence 受控 pilot 门；逐条映射现有可执行证据，不重定义门限；修正不存在 legacy 路径，保留计数器/故障回退 PASS；ResumeContractVerifier、FingerprintLeaseCoordinator 与 A6 pause/resume p99 当前缺失，如实记为 NO-GO/NOT-MEASURED。
touchedAreas:
  - harness/specs/tasks/a6-long-running-persistence-pilot.md
  - tests/unit/a06-a6-gate-coverage.test.ts
  - harness/specs/tasks/harness-gap-a06-long-running-persistence-pilot-reverify.md
  - docs/dev/harness-gap-closure/a06-long-running-persistence-gate.md
  - docs/dev/harness-gap-closure/a06-acceptance.json
  - docs/dev/harness-gap-closure/A06-SHA256SUMS
ownedPaths:
  - harness/specs/tasks/a6-long-running-persistence-pilot.md
  - tests/unit/a06-a6-gate-coverage.test.ts
  - harness/specs/tasks/harness-gap-a06-long-running-persistence-pilot-reverify.md
  - docs/dev/harness-gap-closure/a06-long-running-persistence-gate.md
  - docs/dev/harness-gap-closure/a06-acceptance.json
  - docs/dev/harness-gap-closure/A06-SHA256SUMS
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
  - tests/unit/deprecation-counters.test.ts
  - openclaw_runtime/src/observability/deprecation-counters.test.ts
  - tests/unit/performance-budgets.test.ts
  - tests/unit/file-fingerprint.test.ts
  - tests/unit/runtime-resume-shadow.test.ts
  - tests/unit/long-task-checkpoint-builder.test.ts
  - tests/unit/long-task-control.test.ts
  - tests/unit/a06-a6-gate-coverage.test.ts
acceptance:
  - 判据1 volatileMislabelCount MUST 0：deprecation-counters critical gate 与 count/reset 单测 PASS；但生产 ResumeContractVerifier 不存在，真实 resume 检测 caller 未接通，Active Pilot 生产门 NO-GO。
  - 判据2 verifier fail rate ≤5%：counter/gate 断言 PASS；生产 verifier 调用点缺失，生产门 NO-GO。
  - 判据3 A6 p99 ≤300ms（10 pause/resume cycles）：当前无 A6 pause/resume 性能测试，NOT-MEASURED。
  - 判据4 rollback 后 requiresReverification=true：ResumeContractVerifier/requiresReverification 在源码不存在，NO-GO。
  - 判据5 FingerprintLeaseCoordinator 先 commit lease 再 checkpoint：类不存在；file-fingerprint 原语存在但没有 lease/order 证明，NO-GO。
  - 判据6 volatile 或 fail rate>5% → degrade_to_full_reverification：deprecation-counters 当前断言 PASS。
  - 移除树中不存在的 cross-area legacy 路径；requiredTests 补入计数器、fingerprint、resume shadow、checkpoint 与 long-task 现有测试，并加 A06 coverage 守卫。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能复核 A6 门：counter/故障回退 PASS，但 verifier 接入、lease 顺序和 pause/resume p99 明确未满足；A6 pilot 不毕业，产品锁不变。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/a06-long-running-persistence-gate.md
---

# A06 冻结实施边界

A06 不伪造新持久化实现。原 spec 的 A6 门限（volatile=0、fail rate≤5%、p99≤300ms、rollback reverify、lease before checkpoint、degrade_to_full_reverification）保持不动；当前树只有 A6 counters 和 fingerprint/resume shadow 原语，`ResumeContractVerifier`、`FingerprintLeaseCoordinator` 与对应生产 caller/性能测试不存在，故除 counter/回退外均如实保留 NO-GO。
