---
lifecycleStatus: active
id: autonomy-task-actions
title: TF-0671 可信自动任务动作与幂等版本提交
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 84acb1acb2f21f236c391f440866c53549c3ff7a
intent: 在既有 Main Task Ledger 日志中串行提交可信自动动作，保留手工事件语义，拒绝模型自报身份、同 key 异参及陈旧 revision。
expectedUserBehavior:
  - 自动 create/update/link 通过已有 typed Host API 进入 Main，并回读现有 runtime owner 的 session generation 和 agent 身份。
  - 同 operation 重试回读一次逻辑效果；相同参数的新 operation 是新意图。
  - Task Forest 进度和自动业务验收不从一般 Ledger 写入或 action receipt 推断。
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - electron/services/task-ledger-service.ts
  - electron/services/task-ledger-api.ts
  - electron/services/task-ledger-actions.ts
  - shared/task-ledger-journal.ts
  - shared/task-ledger-journal-lock.ts
  - shared/task-ledger-process.ts
  - shared/types/session-activity.ts
  - openclaw_runtime/src/config/sessions/store-writer.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/agents/long-task-control/task-ledger.ts
  - openclaw_runtime/src/agents/long-task-control/stage3-working-context.test.ts
  - electron/main/ipc-handlers.ts
  - electron/gateway/config-sync.ts
  - shared/types/task-ledger.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - tests/unit/task-ledger-service.test.ts
  - tests/unit/config-sync-source-runtime.test.ts
  - tests/unit/autonomy-task-actions.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/fixtures/autonomy-task-action-worker.mts
  - tests/e2e/autonomy-task-actions.spec.ts
  - harness/specs/tasks/autonomy-task-actions.md
  - harness/specs/rules/autonomy-task-action-boundary.md
  - harness/specs/scenarios/autonomy-task-actions.md
  - harness/specs/fixtures/autonomous-project-system/a2/**
  - docs/modules/multi-agent-and-tasks.md
requiredRules:
  - identity-scope-boundary
  - autonomy-object-owner-boundary
  - autonomy-task-action-boundary
  - contract-first-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/task-ledger-service.test.ts tests/unit/autonomy-task-actions.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/host-api-facade.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs src/agents/long-task-control/stage3-working-context.test.ts
  - pnpm typecheck
  - pnpm contract:check
  - pnpm comms:replay
  - pnpm comms:compare
  - pnpm build:runtime
  - pnpm build:vite
  - pnpm test:e2e:run tests/e2e/autonomy-task-actions.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/autonomy-task-actions.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-task-actions.md --dry-run
  - git diff --check
acceptance:
  - 自动 create/link/update 的 actor 及 scope 来自 Main/runtime owner，伪造 actor、跨 scope、旧 session/gateway generation 在日志写入前拒绝；现有手工编辑保留真实语义。
  - 两个同 revision 并发写恰一个成功；同 operation 重复、同 key 异参、合法同参新 operation、追加后崩溃、损坏 projection、未完成日志帧均有磁盘重放证据且无重复逻辑效果。
  - 多事件提交完整保留；批次内共享 key 不互相删除，不从部分帧错误接纳整批。
  - typed contract/facade/service 一致，不新增扁平 IPC、renderer 直连、任务数据库或完成权威。
  - 同干净候选证据包含 actor、输入/候选、命令/退出码/计数、负例、哈希、凭据扫描和未测边界；只完成该叶子，不宣称 TF-0664 全目标完成。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - harness/specs/rules/autonomy-task-action-boundary.md
    - harness/specs/scenarios/autonomy-task-actions.md
    - docs/modules/multi-agent-and-tasks.md
---

复用现有 events.jsonl 与可重建 snapshot.json；不迁移历史 actor，不新增 store。
operationId 在第一次提交前由调用方持久保留，重试携带同一 ID。版本来自现有日志投影。
Main 和 runtime 长任务路径共享日志 codec 与同一锁名；runtime 同步调用链保持同步，
其重放去重和 DCS revision 读取同时支持旧独立事件与新提交帧，不绕过 workspace 串行边界。
一般动作 receipt 不证明自动任务验收；completion claim 留给 TF-0672。
README 三语按现有诊断/任务行为复核，不提前宣传完整项目自治。
