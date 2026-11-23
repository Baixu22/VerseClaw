---
id: chat-execution-context-20261123
title: 统一输入框执行托盘与工作树操作
lifecycleStatus: active
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
diffBase: 725991f9b
intent: 按用户参考图及Carbon看图决策，把项目、执行目录、分支和任务放进输入框上沿托盘，默认两次点击创建或切换工作树。
requiredRules:
  - backend-communication-boundary
  - durable-task-system-boundary
  - identity-scope-boundary
  - i18n-locale-coverage
  - ui-motion-material-system
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - src/components/chat/SessionWorkspacePicker.tsx
  - src/components/chat/WorktreeCreationProgress.tsx
  - src/components/chat/WelcomeProjectPicker.tsx
  - src/components/settings/primitives/usePopover.ts
  - src/pages/Chat/ComposerGitStrip.tsx
  - src/pages/Chat/index.tsx
  - src/styles/codex-composer-shell.css
  - src/styles/codex-tokens.css
  - shared/i18n/locales/*/settings.json
  - shared/i18n/locales/*/chat.json
  - tests/unit/session-workspace-picker.test.tsx
  - tests/unit/welcome-project-picker.test.tsx
  - tests/unit/composer-git-strip.test.tsx
  - tests/e2e/chat-execution-context.spec.ts
  - tests/e2e/chat-worktree-session-navigation.spec.ts
  - tests/e2e/session-worktree-storage.spec.ts
  - tests/e2e/chat-workspace-header.spec.ts
  - tests/e2e/chat-welcome-hero-fakecoding.spec.ts
  - tests/e2e/chat-composer-popovers.spec.ts
  - tests/e2e/chat-planning-composer-ux.spec.ts
  - tests/e2e/chat-layout-cdp.spec.ts
  - tests/e2e/beam-composer-verify.spec.ts
  - docs/dev/chat-execution-context.md
  - docs/dev/durable-task-system/DESIGN.md
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
  - harness/specs/tasks/chat-execution-context-20261123.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/fixtures/chat-execution-context/20261123/**
expectedUserBehavior:
  - 默认本地执行不显示重复的本地按钮；工作树创建和切换从更多进入，仅链接工作树显示工作树入口。
  - 项目、目录、分支和执行设置位于输入框上方，任务行并入同一个托盘；空会话底部及页眉不再嵌套工作树入口。
  - 打开执行设置后可直接创建并打开工作树，默认分支唯一生成，改名和起点按需展开。
  - 已有目录和分支从同一浮层切换，当前草稿先保存，进入新目录时输入为空，切回时恢复原会话与草稿。
  - 创建中禁用重复请求与发送，运行中禁止目录和分支切换，晚到结果不跳转其他会话。
  - 已创建但打开失败时可以重试打开同一目录，失败原因原位显示。
  - 新建时输入框原位展示真实保存、创建与打开阶段；可选择创建后留在当前会话，失败时重试或恢复原草稿。
  - 输入区22px圆角，托盘16px圆角，实色灰阶和轻描边，窄窗保持单行入口。
acceptance:
  - Carbon真实查看参考图和候选截图并给出设计与复核，用量可回读。
  - 真实Git仓库上两次点击创建工作树，工作目录、分支与新会话身份正确。
  - 切回旧目录恢复原草稿，分支切换更新托盘，运行禁切及创建失败保留输入有回归。
  - 明暗、窄窗、键盘、四语与任务并存布局通过Electron检查。
requiredTests:
  - pnpm exec vitest run tests/unit/session-workspace-picker.test.tsx tests/unit/composer-git-strip.test.tsx tests/unit/chat-workspace-session-target.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-execution-context.spec.ts tests/e2e/chat-composer-popovers.spec.ts tests/e2e/chat-planning-composer-ux.spec.ts --workers=1 --retries=0
docs:
  required: true
  files:
    - docs/dev/chat-execution-context.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Git与Workspace继续拥有实际操作、权限、工作树路径和会话状态。本规格改变显示与显式操作入口，不改变自动隔离、工具预算或权限默认值。所有测试与视觉证据由agent驱动。
