---
lifecycleStatus: active
id: session-collaboration-b-mainline
title: 整合会话协作消息回执与草稿恢复
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c92ed890056068ca07769c0a410cd0cd90101085
intent: 在当前主线保留协作查询前置，完成消息控制的开发修复与星驰独立验收。
touchedAreas:
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - docs/dev/session-lifecycle-control-matrix.md
  - docs/modules/multi-agent-and-tasks.md
  - docs/modules/sessions.md
  - electron/services/chat-api.ts
  - electron/services/session-activity-api.ts
  - electron/services/sessions-api.ts
  - harness/specs/fixtures/session-collaboration-center/A1/REPORT.md
  - harness/specs/fixtures/session-collaboration-center/A1/SHA256SUMS
  - harness/specs/fixtures/session-collaboration-center/A1/checks.json
  - harness/specs/fixtures/session-collaboration-center/A1/owner-readbacks.json
  - harness/specs/fixtures/session-collaboration-center/A1/raw-index.json
  - harness/specs/fixtures/session-collaboration-center/A1/report.json
  - harness/specs/fixtures/session-collaboration-center/A1/unit-tests.json
  - harness/specs/fixtures/session-collaboration-center/A1/verify.py
  - harness/specs/fixtures/session-collaboration-center/B-development-20261127/**
  - harness/specs/guides/session-collaboration-center-plan.md
  - harness/specs/rules/session-collaboration-center-contract.md
  - harness/specs/scenarios/session-collaboration-center.md
  - harness/specs/tasks/session-collaboration-a-mainline.md
  - harness/specs/tasks/session-collaboration-a2.md
  - harness/specs/tasks/session-collaboration-a3.md
  - harness/specs/tasks/session-collaboration-a4.md
  - harness/specs/tasks/session-collaboration-a5.md
  - harness/specs/tasks/session-collaboration-b-mainline.md
  - harness/specs/tasks/session-collaboration-b1.md
  - harness/specs/tasks/session-collaboration-b2.md
  - harness/specs/tasks/session-collaboration-b3.md
  - harness/specs/tasks/session-collaboration-b4.md
  - harness/specs/tasks/session-collaboration-b5.md
  - harness/specs/tasks/session-collaboration-identity-read-model.md
  - openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/primitives.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/src/agents/agent-tools.policy.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt-tool-construction-plan.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/execution-domain.ts
  - openclaw_runtime/src/agents/execution-task-authority.ts
  - openclaw_runtime/src/agents/long-task-control/store.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/session-task-scope.ts
  - openclaw_runtime/src/agents/tool-catalog.ts
  - openclaw_runtime/src/agents/tool-description-presets.ts
  - openclaw_runtime/src/agents/tool-mutation.ts
  - openclaw_runtime/src/agents/tools/session-collaboration-query.ts
  - openclaw_runtime/src/agents/tools/session-collaboration-send.ts
  - openclaw_runtime/src/agents/tools/session-status-tool.ts
  - openclaw_runtime/src/agents/tools/sessions-list-tool.ts
  - openclaw_runtime/src/agents/tools/sessions-send-tool.ts
  - openclaw_runtime/src/agents/tools/sessions-watch-tool.ts
  - openclaw_runtime/src/config/sessions/combined-store-gateway.ts
  - openclaw_runtime/src/gateway/chat-abort.ts
  - openclaw_runtime/src/gateway/server-methods/agent-job.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity-read-model.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-message.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-query.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-watch.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.send-permit-lifetime.test.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.shared.ts
  - openclaw_runtime/src/gateway/server-methods/shared-types.ts
  - openclaw_runtime/src/gateway/session-utils.ts
  - openclaw_runtime/src/sessions/input-provenance.ts
  - openclaw_runtime/src/sessions/session-collaboration-message-store.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/agents.json
  - shared/i18n/locales/ja/agents.json
  - shared/i18n/locales/ru/agents.json
  - shared/i18n/locales/zh/agents.json
  - shared/session-collaboration-message.ts
  - shared/session-collaboration-watch.ts
  - shared/task-system/runtime.ts
  - shared/task-system/store.ts
  - shared/task-system/tool-policy.ts
  - shared/task-system/trace.ts
  - shared/types/session-activity.ts
  - shared/types/session-collaboration-control.ts
  - shared/types/session-collaboration-message.ts
  - shared/types/session-collaboration-watch.ts
  - shared/types/session-collaboration.ts
  - src/components/agents/SessionCollaborationMessages.tsx
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/components/agents/SystemPortfolioPanel.tsx
  - src/components/file-preview/WorkspaceAgentsPanel.tsx
  - src/components/file-preview/WorkspaceSubagentPanel.tsx
  - src/lib/host-api.ts
  - src/lib/session-collaboration-control.ts
  - src/lib/session-read-model.ts
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatMessage.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - src/pages/Chat/ExecutionMigrationControl.tsx
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/stores/session-collaboration.ts
  - src/stores/session-intent.ts
  - tests/e2e/fixtures/fp-p1-harness.ts
  - tests/e2e/fixtures/session-collaboration.ts
  - tests/e2e/session-collaboration-controls.spec.ts
  - tests/e2e/session-collaboration-delivery-recovery.spec.ts
  - tests/e2e/session-collaboration-message-budget.spec.ts
  - tests/e2e/session-collaboration-message-view.spec.ts
  - tests/e2e/session-collaboration-overview.spec.ts
  - tests/e2e/session-collaboration-scale.spec.ts
  - tests/e2e/session-collaboration-watch.spec.ts
  - tests/unit/chat-api-workspace-fingerprint.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-message.test.tsx
  - tests/unit/chat-send-input-mode.test.ts
  - tests/unit/chat-store-history-retry.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/session-collaboration-control-semantics.test.ts
  - tests/unit/session-collaboration-delivery.test.ts
  - tests/unit/session-collaboration-identity.test.ts
  - tests/unit/session-collaboration-message-budget.test.ts
  - tests/unit/session-collaboration-message-envelope.test.ts
  - tests/unit/session-collaboration-message-view.test.tsx
  - tests/unit/session-collaboration-panel.test.tsx
  - tests/unit/session-collaboration-query.test.ts
  - tests/unit/session-collaboration-watch.test.ts
  - tests/unit/session-summary-bounded-read.test.ts
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 引导绑定原会话代次与运行，回复丢失后可以查询持久回执。
  - 发送或回执查询期间编辑的草稿保持原样，迟到回执不覆盖其它会话。
  - 中断后发送发现任何后继运行便拒绝，已经结束的后继同样使旧请求失效。
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/chat-input.test.tsx tests/unit/chat-message.test.tsx tests/unit/chat-send-input-mode.test.ts tests/unit/chat-api-workspace-fingerprint.test.ts --maxWorkers=1 --no-file-parallelism
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-control-semantics.test.ts tests/unit/session-collaboration-delivery.test.ts tests/unit/session-collaboration-message-budget.test.ts tests/unit/session-collaboration-message-envelope.test.ts tests/unit/session-collaboration-message-view.test.tsx tests/unit/session-collaboration-panel.test.tsx tests/unit/session-collaboration-watch.test.ts tests/unit/chat-store-history-retry.test.ts --maxWorkers=1 --no-file-parallelism
  - node scripts/contract-check.mjs
  - node scripts/i18n-lint.mjs
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/session-collaboration-b-mainline.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/session-collaboration-b-mainline.md --dry-run
acceptance:
  - 原运行结束后回读原ID，不再次派发；同ID不同正文、旧代次和后继运行拒绝。
  - 草稿编辑版本受保护，包括修改后恢复为相同文字；其它会话不接受迟到清理。
  - 精确运行的中断观察覆盖等待和实际派发，结束与拒绝释放观察状态。
  - 定向测试、契约、四语、通信与任务规范绑定干净整合候选，星驰独立开发验收通过。
  - 保留原始失败、A查询前置与B消息实现的来源；完整类型、构建、Electron及CI记录延期。
docs:
  required: true
  files:
    - docs/dev/session-lifecycle-control-matrix.md
---

本规格记录用户选择的会话协作消息回执与草稿恢复开发交付。A 的查询与等待实现为 B 的既有依赖，整合时保留其原始审查和测试身份；C、D、E 阶段不纳入本次开发。

用户已要求优先完成代码开发，CI与重型集成验收暂缓。开发记录保留每个命令的候选、源哈希、退出码和原始结果；Electron 用例发现只记录发现数。后续正式A/B验收仍按原阶段规格运行。
