---
id: chat-continuity-controls-20261123
title: 简化运行引导、上下文整理与会话接力控制
lifecycleStatus: active
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
diffBase: eac8b36c2
intent: 先实现可运行版本，再由Carbon查看实际截图决定交互和视觉收敛；降低运行干预、上下文整理、fork与接力的操作负担。
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - session-derivation-ui-contract
  - i18n-locale-coverage
  - ui-motion-material-system
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - src/pages/Chat/index.tsx
  - src/components/chat/ChatContextPressure.tsx
  - src/styles/codex-composer-shell.css
  - shared/i18n/locales/*/chat.json
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-toolbar.test.tsx
  - tests/e2e/chat-long-task-control.spec.ts
  - tests/e2e/chat-manual-compaction.spec.ts
  - tests/e2e/chat-session-handoff.spec.ts
  - tests/e2e/chat-session-fork.spec.ts
  - docs/dev/chat-continuity-controls.md
  - README*.md
  - harness/specs/tasks/chat-continuity-controls-20261123.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/fixtures/chat-continuity-controls/20261123/**
expectedUserBehavior:
  - 运行中的消息发送方式可见，排队、引导和停止后发送分别说明后果；Enter和修饰键语义保持。
  - 会话分支复制当前上下文并打开新会话，接力先预览可编辑摘要再创建并发送。
  - 禁用原因、准备过程与可恢复失败直接可见，常规来源和技术统计按需展开。
  - 整理上下文只显示一份用量，截断消息提示和可选保留要求清楚，运行中禁用整理。
  - 浮层和对话框复用现有哑光实底与圆角，窄窗和键盘可操作。
acceptance:
  - 四语文案、可见禁用原因、快捷键及草稿恢复有定向回归。
  - fork不自动发送；接力保留持久operation与首轮发送身份，未知结果走核对。
  - Carbon实际读取候选截图并给出决策，必要修改完成后保留最终Electron截图。
requiredTests:
  - pnpm exec vitest run tests/unit/chat-input.test.tsx tests/unit/chat-session-continuity.test.ts tests/unit/session-handoff-recovery.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-long-task-control.spec.ts tests/e2e/chat-manual-compaction.spec.ts tests/e2e/chat-session-handoff.spec.ts tests/e2e/chat-session-fork.spec.ts --workers=1 --retries=0
docs:
  required: true
  files:
    - docs/dev/chat-continuity-controls.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

本轮沿用Runtime与Workspace持有的会话、代次及首轮发送身份。UI根据现有状态呈现操作，Carbon负责真实截图上的审美决策。所有视觉与交互证据标记为agent驱动。
