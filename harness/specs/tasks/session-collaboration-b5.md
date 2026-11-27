---
lifecycleStatus: active
id: session-collaboration-b5
title: B5 合并重复状态通知并归因协调调用
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 8769e4ae3472883bbca71ac5df706dae1b82030f
intent: 在原消息 owner 合并同 scope 的状态突发，保留 provider/queue 决定并标记真实 coordination 调用。
touchedAreas:
  - openclaw_runtime/src/sessions/session-collaboration-message-store.ts
  - shared/types/session-collaboration-message.ts
  - shared/task-system/trace.ts
  - shared/task-system/store.ts
  - shared/task-system/runtime.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - tests/unit/session-collaboration-message-budget.test.ts
  - tests/e2e/session-collaboration-message-budget.spec.ts
  - harness/specs/tasks/session-collaboration-b5.md
  - docs/modules/sessions.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - durable-task-system-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-message-budget.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-message-budget.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-b5.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-b5.md --dry-run
acceptance:
  - 同源目标代次、任务和内容的状态突发按原 ID 关联合并，重复通知不启动第二个目标 turn。
  - 请求/结果不自动合并为状态，原 A2A、provider、资源 budget 和队列决定保持；普通刷新不调用模型。
  - 实际协作模型调用在原 Task Trace 带 coordination 分类，token/费用未知值保留。
docs:
  required: true
  files:
    - docs/modules/sessions.md
---
# B5 通知与消耗

合并只作用于短窗口内同 scope/任务的完全相同 finding/status，回执保留 coalescedTo 原意图引用。request/handoff/result 的新意图继续独立，原意图未知时也不建立替代执行。

协调分类消费原 inputProvenance，不改变模型 stream、计费或 actorRole；测试运行与验收继续延期。
