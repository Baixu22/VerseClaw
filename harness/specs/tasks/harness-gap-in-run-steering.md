---
lifecycleStatus: completed
id: harness-gap-in-run-steering
title: 运行中安全接收修订与取消指令（L03）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: L03 核验运行中 steering 的接收边界：pending 完成项以 lease 注入、ack 只接受匹配 lease 且幂等（无重复注入）、失败 release 后可被再次 lease（无丢失、无重复）、取消/终止项不再被 lease（取消后不再产生效果）、陈旧 lease 可被重启后的回合重新接管。
touchedAreas:
  - openclaw_runtime/src/agents/agent-steering-queue.l03.test.ts
  - harness/specs/tasks/harness-gap-in-run-steering.md
  - docs/dev/harness-gap-closure/l03-in-run-steering.md
  - docs/dev/harness-gap-closure/l03-acceptance.json
  - docs/dev/harness-gap-closure/L03-SHA256SUMS
ownedPaths:
  - openclaw_runtime/src/agents/agent-steering-queue.l03.test.ts
  - harness/specs/tasks/harness-gap-in-run-steering.md
  - docs/dev/harness-gap-closure/l03-in-run-steering.md
  - docs/dev/harness-gap-closure/l03-acceptance.json
  - docs/dev/harness-gap-closure/L03-SHA256SUMS
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
  - openclaw_runtime/src/agents/agent-steering-queue.l03.test.ts
acceptance:
  - lease：pending/suspended 完成项被 lease 后标记 in_progress + steeringLeaseId，并给出含结果的合并 prompt。
  - ack 单调/幂等：只有匹配 lease 的 ack 生效；错误 lease 不生效（不能被劫持）；重复 ack 是 no-op（0 更新，无重复注入）。
  - release：失败回合 release 后回到 pending，可被下一次 lease 恰好接管一次；已 release 的 lease 不能再 ack。
  - 取消/终止：delivered/discarded/failed 等终态不再进入 pending 列表、不再被 lease（取消后不再产生效果）。
  - 重启安全：陈旧 in_progress lease（>5min）可被重新 lease，完成项不会被永久搁置。
  - 隔离：不同 requesterSessionKey 的完成项不会被串到当前会话。
  - 干净候选定向测试、runtime core 类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 运行中的修订/取消能被安全接收：完成结果最多注入一次，取消后不再注入，失败后可重试而不重复或丢失。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/l03-in-run-steering.md
---

# L03 冻结实施边界

L03 只核验既有 steering 队列的 lease/ack/release 协调（`runtime-core` 之外、`agents/agent-steering-queue.ts`）。不新建队列/状态；复用既有 delivery 状态机（pending/in_progress/delivered/failed/discarded/suspended）。ack 必须以 leaseId 匹配，重复 ack 与错 lease ack 都必须是 no-op；release 让完成项回到 pending 且不能被旧 lease ack；终态（delivered/discarded/failed）不再被 lease；陈旧 lease 重新入队。
