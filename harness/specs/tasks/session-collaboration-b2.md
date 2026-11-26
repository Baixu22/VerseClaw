---
lifecycleStatus: active
id: session-collaboration-b2
title: B2 持久确认消息意图并保留未知结果
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: a30adb30f0636779f9f624aab6a23c196df1eebb
intent: 在原共享 SQLite owner 中保留消息意图、首次来源和派发回执，重启与重试复用同一 ID。
touchedAreas:
  - openclaw_runtime/src/sessions/session-collaboration-message-store.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-message.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - shared/types/session-collaboration-message.ts
  - shared/session-collaboration-message.ts
  - shared/host-api/contract.ts
  - electron/services/sessions-api.ts
  - src/lib/host-api.ts
  - tests/unit/session-collaboration-delivery.test.ts
  - tests/e2e/session-collaboration-delivery-recovery.spec.ts
  - harness/specs/tasks/session-collaboration-b2.md
  - harness/specs/scenarios/session-collaboration-center.md
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
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-delivery.test.ts tests/unit/session-collaboration-message-envelope.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-delivery-recovery.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-b2.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-b2.md --dry-run
acceptance:
  - 持久意图接受、排队、交给 agent、回复、拒绝、过期与未知从原 owner 回读，首次来源不改签。
  - 接受与启动窗口分别注入中断，重启后按原 ID 回读；同 ID 异内容拒绝，未知派发不盲重试。
  - 目标 reset/删除拒绝迟到旧代意图，发送者和接收者的任务、运行状态保持独立。
docs:
  required: true
  files:
    - docs/modules/sessions.md
---
# B2 意图与效果

消息意图记录属于原 sessions.send 扩展，存放于原 shared state SQLite。原 agent/queue/run/transcript 继续拥有实际接受、执行与回复；意图记录保留它们的回执引用，不另建任务或运行状态。

accepted→dispatching 使用事务领取；只有 accepted 可开始首次派发，dispatching 无回执保持 unknown。稳定派发 correlation 与 messageId 分开，原 source/run/actor/时间保留。查询用只读连接和有界摘要，不创建库或表。

开发继续，真实故障和恢复旅程按用户指令暂不执行。
