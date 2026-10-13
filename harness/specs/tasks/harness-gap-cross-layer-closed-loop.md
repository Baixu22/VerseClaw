---
lifecycleStatus: completed
id: harness-gap-cross-layer-closed-loop
title: 跨层闭环与多组件受控消融（V01）
scenario: agent-dev-composable-scenarios
taskType: evaluation-harness
intent: V01 把已交付的各层组件串成一个确定性跨层闭环（失败风暴 → L05 断路器 open → E01 可靠性聚合 pass^k<1 → G01 有界恢复动作 → G03 脱敏轨迹转可复跑样例 → S07 verifier 拒绝完成 → L06 单一写归属 → 冷却后 half-open 恢复），并重跑 E02 受控配对消融确认判决未回归；不放松任何安全边界。
touchedAreas:
  - tests/unit/cross-layer-closed-loop.v01.test.ts
  - harness/specs/tasks/harness-gap-cross-layer-closed-loop.md
  - docs/dev/harness-gap-closure/v01-cross-layer-closed-loop.md
  - docs/dev/harness-gap-closure/v01-acceptance.json
  - docs/dev/harness-gap-closure/V01-SHA256SUMS
ownedPaths:
  - tests/unit/cross-layer-closed-loop.v01.test.ts
  - harness/specs/tasks/harness-gap-cross-layer-closed-loop.md
  - docs/dev/harness-gap-closure/v01-cross-layer-closed-loop.md
  - docs/dev/harness-gap-closure/v01-acceptance.json
  - docs/dev/harness-gap-closure/V01-SHA256SUMS
requiredProfiles:
  - fast
requiredRules:
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/cross-layer-closed-loop.v01.test.ts
  - openclaw_runtime/src/runtime-core/context-pressure-recovery.test.ts
acceptance:
  - 失败风暴 → L05 断路器 open 且 cooldown 内拒绝（不再产生效果）；E01 同批 trial 聚合出 pass^k<1。
  - G01 暴露的 TIMEOUT 错误携带有界恢复动作（retry）；G03 把同一脱敏失败轨迹转成可复跑样例（before-fix fail / after-fix pass）。
  - S07 verifier 在证据缺失时给出 insufficient-evidence 且无完成转换（不伪装 done）。
  - L06 闭环写入在单一可验证 owner 下完成并释放；冷却后 L05 half-open 单探测成功 → closed（可恢复）。
  - 重跑 E02 受控配对消融，判决保持 component-helps、effect 与安全计数未回归；安全必测 0 误拦 / 0 违规。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能用一条集成测试看到各层组件在真实调用链上协同（熔断→聚合→恢复动作→可复跑样例→拒绝完成→单写归属→恢复），且消融判决未回归。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/v01-cross-layer-closed-loop.md
---

# V01 冻结实施边界

V01 只新增一个跨层集成测试，复用各层已交付模块（L05 断路器、E01 聚合、G01 恢复动作、G03 轨迹转样例、S07 裁决、L06 写归属、E02 配对消融），不新增产品代码路径、不放松 SSRF/loop guard/approval、不改默认值/锁。它是集成证据，不是发布或 GA 声明。
