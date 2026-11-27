---
lifecycleStatus: active
id: session-collaboration-c1
title: C1 只读当前任务上下文和原证据
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c50664674b3ca639ffea972499b6d0942112463d
intent: 从原 TaskSystem 读取当前 scope 的合同、checkpoint、证据和有界上下文，并保留 observer 身份。
touchedAreas:
  - shared/task-system/store.ts
  - tests/unit/session-collaboration-context-host.test.ts
  - tests/unit/session-collaboration-context-read.test.ts
  - shared/types/session-collaboration-context.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-context.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - shared/host-api/contract.ts
  - electron/services/sessions-api.ts
  - src/lib/host-api.ts
  - tests/unit/session-collaboration-task-context.test.ts
  - harness/specs/tasks/session-collaboration-c1.md
  - docs/modules/sessions.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - durable-task-system-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-context-host.test.ts tests/unit/session-collaboration-context-read.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/session-collaboration-task-context.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-c1.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-c1.md --dry-run
acceptance:
  - Main 绑定实际读取者，合同、上下文和证据来自同一数据库读取快照，读取期间换代拒绝返回旧结果。
  - 以原 task owner/revision 和 generation 读取目标、已完成工作、未决项、下一步及证据，不取得 writer。
  - 只读 observer 与执行者区分，空讨论、换代、修订和 owner 不可用返回准确来源。
  - 旧 WorkingContext 只接受具名关联验证；未验证桥接保持 unavailable，不隐式迁移。
docs:
  required: true
  files:
    - docs/modules/sessions.md
---
# C1 来源

使用 A2 的可见 scope 与原 execution-domain 的只读 TaskSystem 连接。context/checkpoint/history 来自当前 TaskSystem owner，旧 Ledger WorkingContext 关联不自动推断。
