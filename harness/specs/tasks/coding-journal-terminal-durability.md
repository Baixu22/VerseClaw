---
lifecycleStatus: active
id: coding-journal-terminal-durability
title: TF-0770 文件效果与journal持久终态对齐
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 0f3211162
intent: 文件效果完成但journal终态写入失败时明确要求对账，不返回虚假的durable committed或盲目重放。
touchedAreas:
  - harness/specs/tasks/coding-journal-terminal-durability.md
  - openclaw_runtime/src/agents/apply-patch-preflight.ts
  - openclaw_runtime/src/agents/apply-patch.ts
  - openclaw_runtime/src/agents/tools/write-journal-core.ts
  - openclaw_runtime/src/agents/apply-patch-consistency.test.ts
  - openclaw_runtime/src/agents/apply-patch-effect-receipt.test.ts
  - scripts/coding-baseline/probes/journal.mts
  - scripts/coding-baseline/probes/journal-kill.mts
  - harness/specs/fixtures/coding-fixes/TF-0770/**
  - docs/modules/workspace-and-coding.md
expectedUserBehavior:
  - 文件写入完成而恢复记录持久化失败时，收到recovery_required与可读ref，并被告知不得重放。
  - 内存journal状态和重启读回一致；正常提交、回滚和重复恢复保持实际文件效果。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - disk-temp-policy
  - docs-sync
requiredTests:
  - node --import ./openclaw_runtime/node_modules/tsx/dist/loader.mjs scripts/coding-baseline/probes/journal-kill.mts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run src/agents/apply-patch-consistency.test.ts src/agents/tools/write-journal.test.ts src/agents/apply-patch-effect-receipt.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/coding-journal-terminal-durability.md
acceptance:
  - 只读sidecar、存储失败、真实写后kill与重启读回一致，不把磁盘prepared声称为durable committed。
  - 正常提交/回滚/不完整恢复有有效refs；重复恢复无重复效果。
  - Effect Receipt对不完整journal保持unknown及明确的recoveryRef，要求对账，不授权重放。
  - clean候选、命令exit/count/skip、正反原始效果、摘要及凭据扫描通过；全部agent驱动。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/workspace-and-coding.md
  note: 修复既有恢复回执；不改变默认值或发布边界。
---

TF-0758/S6，A5。沿用prepared/committed/rolled_back/recovery_required状态与现有journal/effect owner。
只增加可选的effectApplied与journalStatePersisted诊断字段；旧持久化shape与状态枚举不变，无迁移或第二存储。
