---
id: durable-task-conversation-ui
title: 在普通会话中静默管理任务并提供轻量进度入口
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 4e2cd7f64
intent: 将持久任务定位和领取交给 agent 工具，用户正常聊天；识别任务后在输入框上方展示可收起、隐藏和重开的轻量进度。
requiredRules:
  - durable-task-system-boundary
  - backend-communication-boundary
  - identity-scope-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 空会话不出现目标表单，讨论不自动生成任务。
  - agent 用任务工具原子定位和领取执行任务，界面在得到 owner 事实后显示简洁状态。
  - 输入框上方的任务入口支持展开、收起、隐藏及重新打开，隐藏不停止执行或解除领取。
  - 会话和工作区切换时不串任务；刷新后恢复任务及用户显示偏好。
touchedAreas:
  - shared/task-system/**
  - shared/host-api/contract.ts
  - shared/i18n/locales/*/taskLedger.json
  - electron/services/task-system-service.ts
  - electron/services/task-ledger-api.ts
  - electron/services/chat-api.ts
  - tests/unit/chat-api-workspace-fingerprint.test.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - src/lib/host-api.ts
  - src/pages/Chat/**
  - src/pages/TaskLedger/**
  - src/components/tool-ui/plan-view.tsx
  - tests/unit/*task*.test.*
  - tests/unit/session-task-dock.test.tsx
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/unit/chat-session-status-rail.test.tsx
  - tests/e2e/durable-task-*.spec.ts
  - docs/dev/durable-task-system/**
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
  - harness/specs/tasks/durable-task-conversation-ui.md
  - harness/specs/fixtures/durable-task-conversation-ui/**
requiredTests:
  - pnpm exec vitest run --config vitest.task-system.config.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e:run tests/e2e/durable-task-conversation.spec.ts
acceptance:
  - 普通聊天无需填写目标或手动领取，start 操作保持事务互斥、幂等和原验收约束。
  - 任务入口以持久 owner 返回为事实，不能从相似文本或模型成功文案推断完成。
  - 复用现有计划组件；不重复自动展开侧栏，隐藏后保留恢复入口且没有后端取消副作用。
  - 更新按会话事件触发并合并重复请求，旧请求不会覆盖新会话，不扫描全仓库任务。
  - 四语、键盘、窄屏及真实 Electron 交互有验证记录。
docs:
  required: true
  files:
    - docs/dev/durable-task-system/DESIGN.md
    - docs/modules/multi-agent-and-tasks.md
---

沿用实施工作树 D:/ClawX-work/durable-task-system-20261107。任务账本保留为主动打开的管理入口，默认会话只显示执行所需的少量信息。显示偏好与任务执行状态分开。
