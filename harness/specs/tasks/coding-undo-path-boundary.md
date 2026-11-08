---
lifecycleStatus: active
id: coding-undo-path-boundary
title: TF-0766 撤销与检查点恢复的真实路径边界
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: e76ec8b94958d7b1ff9df2747af5c646a866155d
intent: 将journal恢复I/O接到既有fs-safe根，统一undo与checkpoint的目标和快照授权并在await后保留选定journal身份。
touchedAreas:
  - harness/specs/tasks/coding-undo-path-boundary.md
  - harness/specs/rules/coding-mutation-consistency-boundary.md
  - openclaw_runtime/src/agents/tools/write-journal-core.ts
  - openclaw_runtime/src/agents/tools/write-journal.ts
  - openclaw_runtime/src/agents/tools/write-journal.test.ts
  - openclaw_runtime/src/agents/agent-tools.workspace-boundary.test.ts
  - openclaw_runtime/src/agents/checkpoint-rollback-executor.ts
  - openclaw_runtime/src/agents/checkpoint-rollback-executor.test.ts
  - openclaw_runtime/src/agents/parity-audit/parity-audit.test.ts
  - openclaw_runtime/src/agents/apply-patch-preview-binding.test.ts
  - openclaw_runtime/src/plugin-sdk/journaled-git-apply.ts
  - tests/unit/versegit-host-apply.test.ts
  - scripts/versegit-candidate-apply-probe.mts
  - docs/modules/workspace-and-coding.md
  - harness/specs/fixtures/coding-fixes/TF-0766/**
expectedUserBehavior:
  - undo和checkpoint不跟随更换的目录联接或硬链接改写/删除工作区外文件，拒绝后保留可恢复证据。
  - 合法恢复等待实际I/O完成再报告成功；异步恢复不会误消费并发新写入的journal项。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
  - docs-sync
  - coding-mutation-consistency-boundary
  - disk-temp-policy
requiredTests:
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/coding-undo-path-boundary.md
  - node node_modules/vitest/vitest.mjs run tests/unit/versegit-host-apply.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec vitest run src/agents/tools/write-journal.test.ts src/agents/checkpoint-rollback-executor.test.ts src/agents/apply-patch-preview-binding.test.ts src/agents/parity-audit/parity-audit.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - create/modify撤销经过替换junction/hardlink的负例均无越界写删，原文件和journal保留。
  - checkpoint也使用同一workspace-bound恢复，快照链接不能把外部字节复制到工作区。
  - 正常多步undo、重启重载、缺失快照、并发tail变化、预览和VG host apply回滚保持真实语义。
  - 原C0 A2反例在新干净候选不再复现，类型与调用者迁移无遗漏，产品锁/默认值不变。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/workspace-and-coding.md
  note: README的受控恢复承诺不变，模块文档补真实路径与异步I/O语义。
---

恢复使用既有journal和fs-safe，不引入第二恢复状态库。不提供“检查一次字符串路径后直接copyFile”的旁路。checkpoint的恢复范围由其workspace/worktree owner限定。明确授权的非限域外部undo保留支持；快照始终只能来自journal所属工作区。
