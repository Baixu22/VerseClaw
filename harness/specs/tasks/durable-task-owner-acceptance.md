---
id: durable-task-owner-acceptance
title: 将任务验收接入既有 verifier 与 effect 回执 owner
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
previousValidationDiffBase: 2522aced4
diffBase: 177ee7ed214979b82c4615fca6ddfda3b400a6b3
intent: 从真实文件、命令和独立 verifier 的持久回执构造逐项验收输入，复用现有 EvidenceVerifier 与 EffectReceiptStore；完成操作按当前任务版本、执行代数和候选摘要提交并可幂等回读。
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - comms-regression
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 验收返回每项要求的真实证据和缺口，任务只在当前候选全部满足时完成。
  - 完成回应丢失后能用既有回执重试，模型自报通过与旧候选不能关闭任务。
  - 独立 verifier 的声明只适用于其派发时冻结的任务版本和文件集合。
touchedAreas:
  - shared/task-system/**
  - shared/host-api/contract.ts
  - electron/services/task-ledger-api.ts
  - electron/services/task-ledger-service.ts
  - electron/services/task-system-service.ts
  - openclaw_runtime/src/agents/persistent-task-acceptance.ts
  - openclaw_runtime/src/agents/persistent-task-delegation.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - openclaw_runtime/src/gateway/server-methods/tasks.ts
  - openclaw_runtime/src/gateway/server-methods/persistent-task-acceptance.test.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - tests/unit/durable-task-*.test.ts
  - src/pages/TaskLedger/ManagedTasks.tsx
  - shared/i18n/locales/*/taskLedger.json
  - openclaw_runtime/src/agents/persistent-task-*.test.ts
  - docs/dev/durable-task-system/**
  - tests/e2e/durable-task-system.spec.ts
  - harness/specs/tasks/durable-task-owner-acceptance.md
residualPaths:
  - harness/specs/tasks/autonomy-object-owner-contract.md
  - harness/specs/tasks/autonomy-task-completion.md
  - harness/specs/tasks/autonomy-session-task-scope.md
  - harness/specs/tasks/autonomy-host-readiness.md
  - harness/specs/tasks/g5-foundation-current-acceptance.md
  - tests/e2e/u6-interaction-metrics.final.spec.ts
requiredTests:
  - pnpm exec vitest run --config vitest.task-system.config.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - 文件与命令证据从 owner 回读，输入与候选变化使已有验证失效。
  - verifier 必须是受管的独立观察者，终态、结构化判定、任务版本和候选内容均匹配。
  - 完成决定调用既有 verifier 和 claim admission，EffectReceiptStore 保存关联回执；不相信调用方自报 verdict。
  - 完成提交与回执可重试，崩溃窗口不得把未知结果写成未执行或再次执行。
  - 取消请求先持久化，在途操作得到终态后才释放 writer；初次写入也必须领取任务。
docs:
  required: true
  files:
    - docs/dev/durable-task-system/STATUS.md
---

TF-0848 使用同一实施工作树，研发 Task Forest 不参与运行验收。现有默认 evidence-verifier shadow/pilot 开关保持原值；本入口消费显式任务契约的验收请求，使用已有纯 verifier 与 effect receipt owner。
