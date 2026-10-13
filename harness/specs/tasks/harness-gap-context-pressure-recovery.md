---
lifecycleStatus: completed
id: harness-gap-context-pressure-recovery
title: 上下文压力下的目标/未完成/依赖/证据可恢复（L02）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: L02 补齐上下文压力恢复半：从 Working Context 快照投影一个受限、确定的恢复摘要（目标/未完成工作/依赖/近期证据），显式计数每个被丢弃项（无静默丢弃）、对深度超限显式拒绝（无静默递归）、且结果永不宣称任务完成（无伪装完成）。交接链深度半已由 #179 落地。
touchedAreas:
  - openclaw_runtime/src/runtime-core/context-pressure-recovery.ts
  - openclaw_runtime/src/runtime-core/context-pressure-recovery.test.ts
  - harness/specs/tasks/harness-gap-context-pressure-recovery.md
  - docs/dev/harness-gap-closure/l02-context-pressure-recovery.md
  - docs/dev/harness-gap-closure/l02-acceptance.json
  - docs/dev/harness-gap-closure/L02-SHA256SUMS
ownedPaths:
  - openclaw_runtime/src/runtime-core/context-pressure-recovery.ts
  - openclaw_runtime/src/runtime-core/context-pressure-recovery.test.ts
  - harness/specs/tasks/harness-gap-context-pressure-recovery.md
  - docs/dev/harness-gap-closure/l02-context-pressure-recovery.md
  - docs/dev/harness-gap-closure/l02-acceptance.json
  - docs/dev/harness-gap-closure/L02-SHA256SUMS
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - sensitive-sink-ledger-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - openclaw_runtime/src/runtime-core/context-pressure-recovery.test.ts
acceptance:
  - 目标/未完成工作/依赖/近期证据四段可从 Working Context 快照确定性恢复（同一输入→同一 digest）。
  - 无静默丢弃：留给预算的每一项都保留，超预算项进 dropped 计数且 truncated=true（kept+dropped=总数）。
  - 无静默递归：depth 超过 maxDepth 时显式返回 depth-exceeded，不产出任何 section。
  - 无伪装完成：结果 complete 恒为 false；空/缺失快照返回 unknown 而非 recovered。
  - 复用既有 Working Context 快照与字段；交接链深度半沿用 #179（runtime.handoff opt-in、环路 fail-closed、subagent maxSpawnDepth 不变）；不改产品默认值/锁/approval。
  - 干净候选定向测试、runtime core 类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 压缩/长任务后维护者能拿回目标、未完成工作、依赖与近期证据，且知道哪些被丢弃。
  - 深度越限被显式拒绝；恢复摘要从不宣称任务已完成。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/l02-context-pressure-recovery.md
---

# L02 冻结实施边界

L02 的交接链深度半由 #179 落地（runtime.handoff opt-in、环路/未知线系 fail-closed、subagent maxSpawnDepth 不变），本包只补上下文压力恢复半：`runtime-core/context-pressure-recovery.ts` 从既有 Working Context 快照投影四段有限摘要，逐项计丢弃、对深度超限显式拒绝、complete 恒 false。不新建 ledger/store，不改默认值/锁/approval。
