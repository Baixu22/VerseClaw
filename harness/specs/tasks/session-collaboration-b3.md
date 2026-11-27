---
lifecycleStatus: active
id: session-collaboration-b3
title: B3 明确协作消息与原会话控制语义
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c5faf509526d1aa04138dec48cb1e28525e95152
intent: 共用具体动作目录，绑定原 scope/run 并使用已有消息、引导、停止与上下文 owner。
touchedAreas:
  - shared/types/session-collaboration-control.ts
  - src/lib/session-collaboration-control.ts
  - src/lib/host-api.ts
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/stores/session-intent.ts
  - src/stores/chat.ts
  - src/components/file-preview/WorkspaceSubagentPanel.tsx
  - shared/host-api/contract.ts
  - electron/services/sessions-api.ts
  - electron/services/chat-api.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/src/gateway/chat-abort.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.shared.ts
  - openclaw_runtime/src/gateway/server-methods/shared-types.ts
  - openclaw_runtime/src/agents/long-task-control/store.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - src/pages/Chat/ExecutionMigrationControl.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatMessage.tsx
  - tests/unit/session-collaboration-control-semantics.test.ts
  - tests/unit/session-collaboration-panel.test.tsx
  - tests/unit/chat-store-history-retry.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-message.test.tsx
  - tests/unit/chat-send-input-mode.test.ts
  - tests/unit/chat-api-workspace-fingerprint.test.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.send-permit-lifetime.test.ts
  - tests/e2e/session-collaboration-controls.spec.ts
  - tests/e2e/session-collaboration-delivery-recovery.spec.ts
  - harness/specs/tasks/session-collaboration-b3.md
  - docs/dev/session-lifecycle-control-matrix.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 协作详情打开目标会话的原引导、编辑重发、分支、接力和迁移控件。
  - 工作会话从原 worker 输入入口执行中断后发送，提交仍由对应 owner 核验。
  - 引导和中断后发送锁定选中运行与代次，原运行变化时返回拒绝结果，未确认的引导保留原草稿。
  - 已提交的引导按原请求 ID 读取持久回执，运行结束后仍可对账并保留后来编辑的草稿。
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-control-semantics.test.ts tests/unit/session-collaboration-panel.test.tsx tests/unit/chat-store-history-retry.test.ts tests/unit/chat-input.test.tsx tests/unit/chat-send-input-mode.test.ts tests/unit/chat-api-workspace-fingerprint.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-controls.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-b3.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-b3.md --dry-run
acceptance:
  - 消息、同 run 引导、中断后发送、stop、truncate、compact、fork、接力和迁移分别引用原 owner。
  - 同 run 输入只消费原 guide，sessions.steer 的中断后发送语义保持；缺少 capability 时返回具体禁用原因。
  - 实际调用前重新读取目标 scope/run，旧代和旧运行不覆盖新选择；消息不会完成任务或移动 writer。
  - 引导成功或回执查询只清理提交时的草稿版本；编辑后恢复为相同文字的草稿及其它会话草稿仍保留。
docs:
  required: true
  files:
    - docs/dev/session-lifecycle-control-matrix.md
---
# B3 动作路由

协作目录显示动作的 owner、效果和必要条件。stop/compact 消费原带 generation 的接口；guide 先核验目标 run，再打开原 /loop 输入 owner，由它核对 capability 和实际入队。范围、分支、接力及环境迁移打开对应原 owner 的操作入口，继续由该入口选择边界、保存 operationId 并提交。

本轮完成源码与回归定义，执行验收仍延期。
