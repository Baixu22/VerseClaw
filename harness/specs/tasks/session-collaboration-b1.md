---
lifecycleStatus: active
id: session-collaboration-b1
title: B1 绑定来源和稳定身份的协作消息
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: fea9a6d34748c0c28b1b7e46a9c5f272f7e67153
intent: 沿原 sessions.send 与 provenance 边界传递稳定消息意图、源目标代次、用途、任务和证据引用。
touchedAreas:
  - shared/types/session-collaboration-message.ts
  - shared/session-collaboration-message.ts
  - shared/host-api/contract.ts
  - openclaw_runtime/src/sessions/input-provenance.ts
  - openclaw_runtime/src/agents/tools/sessions-send-tool.ts
  - openclaw_runtime/src/agents/tools/session-collaboration-send.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-message.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/primitives.ts
  - electron/services/sessions-api.ts
  - src/lib/host-api.ts
  - tests/unit/session-collaboration-message-envelope.test.ts
  - harness/specs/tasks/session-collaboration-b1.md
  - harness/specs/rules/session-collaboration-center-contract.md
  - harness/specs/scenarios/session-collaboration-center.md
  - docs/modules/sessions.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - autonomy-object-owner-boundary
  - durable-task-system-boundary
  - contract-first-boundary
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
  - pnpm exec vitest run tests/unit/session-collaboration-message-envelope.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-b1.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-b1.md --dry-run
acceptance:
  - 稳定 messageId、内容摘要、replyTo、用途、源目标 scope/generation 和原任务引用沿既有发送 owner 传递。
  - 模型只提交意图内容，来源从原运行或 Main Workspace/Session owner 绑定，保持 inter_session 信任分类。
  - 异内容同 ID、旧代、伪造来源、任务修订不符、不可见目标和过期意图明确拒绝。
  - 原消息、worker 回交和等待回复入口继续使用原合同。
docs:
  required: true
  files:
    - docs/modules/sessions.md
---
# B1 消息来源

输入仅包含目标、用途和内容等意图；源 scope、原 run、actor 和实际内容摘要由原 owner 产生。稳定意图摘要覆盖源目标代次、内容及任务/证据引用，首次来源 run 与创建时间保留为来源观测。重试读取原意图，不改签原来源。

Runtime 工具使用当前运行绑定来源；Main 使用活动 Workspace/Session owner。Gateway 在实际发送入口验证代次、visibility/A2A 与原任务引用，来源 sidecar 保持 inter_session，消息文本不能替代授权或确认任务。

依用户指令继续开发，执行验收与状态收口仍延期。
