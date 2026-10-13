---
id: harness-gap-memory-effect-receipt
title: 记忆写入与 EffectReceipt 的恢复闭环（S06）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: S06 让 runtime memory 自编辑写入（memory_update / memory_forget / memory_strengthen）复用既有 RC-04 EffectReceipt 模型：每次写入可追溯 effectId/requestId/actor，重放同意图幂等（duplicate effects=0），unknown 不伪装 applied。不新建第二套 effect store。
touchedAreas:
  - openclaw_runtime/src/runtime-core/memory-effect-receipt.ts
  - openclaw_runtime/src/runtime-core/memory-effect-receipt.test.ts
  - openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts
  - harness/specs/tasks/harness-gap-memory-effect-receipt.md
  - docs/dev/harness-gap-closure/s06-memory-effect-receipt.md
  - docs/dev/harness-gap-closure/s06-acceptance.json
  - docs/dev/harness-gap-closure/S06-SHA256SUMS
ownedPaths:
  - openclaw_runtime/src/runtime-core/memory-effect-receipt.ts
  - openclaw_runtime/src/runtime-core/memory-effect-receipt.test.ts
  - openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts
  - harness/specs/tasks/harness-gap-memory-effect-receipt.md
  - docs/dev/harness-gap-closure/s06-memory-effect-receipt.md
  - docs/dev/harness-gap-closure/s06-acceptance.json
  - docs/dev/harness-gap-closure/S06-SHA256SUMS
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
  - openclaw_runtime/src/runtime-core/memory-effect-receipt.test.ts
  - openclaw_runtime/src/agents/apply-patch-effect-receipt.test.ts
  - openclaw_runtime/src/agents/stage1-effect-receipt.test.ts
acceptance:
  - 复用 RC-04 EffectReceiptStore（append-only、idempotency unique、identical-content vs content-conflict），不新建第二套 effect store / 迁移。
  - 每次 memory 自编辑写入记录 digest-only receipt：proposal 只含 domain/action/factId(/newFactId)，绝不含记忆正文；stage1Context 携带 actor（sessionKey/runId/attemptIndex/modelCallIndex）与 effect（toolCallId/toolName/resource/action）。
  - idempotency key 由意图（action+factId+sessionKey+runId+toolCallId）派生，与 outcome 无关：重放同意图 → duplicate（0 个重复 effect）。
  - outcome 映射：成功=applied；写入前失败=not_applied；已写部分后失败（如 fact 已 append 但 invalidation/relation 失败）=unknown，不得伪装 applied。
  - fail-open：receipt sink 缺失或抛错绝不阻断/失败 memory 写入。
  - 干净候选定向测试、runtime core 类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能从一个 memory 写入追溯 effectId/requestId/actor 与 outcome，并在 unknown 时据恢复声明对账。
  - 重复执行同一自编辑意图不会产生重复 effect 记录。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/s06-memory-effect-receipt.md
---

# S06 冻结实施边界

S06 只把 memory 自编辑写入接到既有 RC-04 `EffectReceiptStore`，不新建 store、不改记忆语义或默认值。新模块 `runtime-core/memory-effect-receipt.ts` 构建 digest-only 的 effect 视图并通过结构化 sink 交给 RC-04；`memory-self-edit-tools.ts` 在写入决策点记录 applied / not_applied / unknown，且始终 fail-open。idempotency key 由意图派生、与 outcome 无关，因此重放同意图是 duplicate 而不是第二个 effect。
