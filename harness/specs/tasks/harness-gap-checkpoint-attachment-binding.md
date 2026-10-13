---
lifecycleStatus: completed
id: harness-gap-checkpoint-attachment-binding
title: 持久化挂件约束为可恢复的最小检查点（L04）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: L04 把持久化挂件界定为五类受限引用（任务附件/恢复指令/上下文/外部 artifact 引用/ledger checkpoint），并为每个绑定校验 content hash、owner 与 TTL；恢复是纯函数：缺失/非法 hash、缺 owner、过期、同 ref 冲突都被显式修复为状态，且恢复不重复产生副作用。
touchedAreas:
  - openclaw_runtime/src/runtime-core/checkpoint-attachment-binding.ts
  - openclaw_runtime/src/runtime-core/checkpoint-attachment-binding.test.ts
  - harness/specs/tasks/harness-gap-checkpoint-attachment-binding.md
  - docs/dev/harness-gap-closure/l04-checkpoint-attachment-binding.md
  - docs/dev/harness-gap-closure/l04-acceptance.json
  - docs/dev/harness-gap-closure/L04-SHA256SUMS
ownedPaths:
  - openclaw_runtime/src/runtime-core/checkpoint-attachment-binding.ts
  - openclaw_runtime/src/runtime-core/checkpoint-attachment-binding.test.ts
  - harness/specs/tasks/harness-gap-checkpoint-attachment-binding.md
  - docs/dev/harness-gap-closure/l04-checkpoint-attachment-binding.md
  - docs/dev/harness-gap-closure/l04-acceptance.json
  - docs/dev/harness-gap-closure/L04-SHA256SUMS
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
  - openclaw_runtime/src/runtime-core/checkpoint-attachment-binding.test.ts
acceptance:
  - 挂件只允许五类受限引用（task-attachment / recovery-instruction / context / external-artifact-ref / ledger-checkpoint），不含任意光标或 blob。
  - 每个绑定带 content hash（sha256 hex）、owner 与 TTL；hash 缺失/非法、owner 缺失、TTL 过期都被显式记为对应状态并从 recovered 排除。
  - 同一 attachmentRef 出现不同 hash → 显式 conflict 修复状态（保留首个）；相同 ref+hash 去重，恢复不重复。
  - 恢复是纯函数：不改输入、重复调用得到相同 digest、不重跑任何副作用。
  - 恢复结果确定性排序 + 可回读 digest；缺失/冲突不被静默接受。
  - 干净候选定向测试、runtime core 类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 恢复时能清楚知道哪些挂件仍有效、哪些缺失/过期/冲突需要修复，且不会重复产生挂件副作用。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/l04-checkpoint-attachment-binding.md
---

# L04 冻结实施边界

L04 只新增一个受限的检查点挂件绑定校验/恢复模块，复用既有 checkpoint serializer 概念；不新建持久化 store、不插台驻留、不自动写回。恢复是纯函数：校验 hash/owner/TTL、对缺失/冲突给出显式状态、去重且不重跑副作用。
