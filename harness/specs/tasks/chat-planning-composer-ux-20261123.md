---
id: chat-planning-composer-ux-20261123
title: 简化会话规划与输入框交互
lifecycleStatus: active
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
diffBase: e3f4e0093ac7ca51254ce48ab94f19900993e1d6
intent: 以当前 Electron 截图和 Carbon 指导收敛会话规划、知识设置和运行反馈，让目标与下一步容易理解，细节按需展开。
requiredRules:
  - backend-communication-boundary
  - durable-task-system-boundary
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
  - src/pages/Chat/**
  - src/components/chat/ComposerPopover.tsx
  - src/components/task-ledger/TaskLedgerSummaryPanel.tsx
  - src/components/tool-ui/plan-view.tsx
  - src/components/assistant-render/TurnSummaryCard.tsx
  - src/styles/codex-composer-shell.css
  - src/styles/codex-composer-menu.css
  - shared/i18n/locales/*/chat.json
  - shared/i18n/locales/*/taskLedger.json
  - tests/unit/chat-input.test.tsx
  - tests/unit/session-task-dock.test.tsx
  - tests/unit/session-task-state-guidance.test.tsx
  - tests/unit/chat-render-reachability.test.tsx
  - tests/unit/fp-p1-scripted-usage.test.ts
  - tests/e2e/fixtures/fp-p1-harness.ts
  - tests/e2e/chat-planning-composer-ux.spec.ts
  - tests/e2e/chat-composer-popovers.spec.ts
  - tests/e2e/chat-long-task-control.spec.ts
  - tests/e2e/project-rag-chat-modes.spec.ts
  - tests/e2e/project-rag-research.spec.ts
  - docs/dev/durable-task-system/DESIGN.md
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
  - harness/specs/tasks/chat-planning-composer-ux-20261123.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/fixtures/chat-planning-composer-ux/20261123/**
expectedUserBehavior:
  - 知识模式、来源和检索方案从一个入口设置，额外调用档位有可见标签。
  - 输入框与任务条共享内容宽度，目标、当前步骤和状态形成稳定的一行。
  - 持久目标与本轮计划并存时，本轮步骤可查看且只保留一个实时规划入口。
  - 本轮步骤完成后，持久任务仍使用任务 owner 的验收状态。
  - 自动读取、队列和恢复继续沿现有服务运行；正常 checkpoint 与干预记录按需查看。
  - 审批、故障、失败和非零待处理队列在默认界面可见并可操作。
acceptance:
  - Carbon 实际查看当前候选对应的 Electron 图片，设计指导及调用用量有盘上回执。
  - 默认输入底栏不再并排出现独立 Off 和 Local 选择框，知识设置仍可通过键盘访问。
  - 现有权限、知识来源与模式、检索档位、发送排队和推理预算参数在显示调整后保持一致。
  - 持久目标加本轮计划、步骤完成但任务未验收、任务完成和会话切换的显示回归通过。
  - 队列、审批、知识读取降级及附件失败有明确反馈；常规诊断退入详情。
  - 同一候选在明暗主题、宽窄窗口和四语下通过 Electron 交互与截图检查，无横向溢出。
  - 定向单元回归、完整类型、契约、四语、构建与 Harness 检查有磁盘结果，精选证据可校验。
requiredTests:
  - pnpm exec vitest run tests/unit/chat-input.test.tsx tests/unit/session-task-dock.test.tsx tests/unit/session-task-state-guidance.test.tsx tests/unit/chat-render-reachability.test.tsx --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/chat-planning-composer-ux.spec.ts tests/e2e/chat-composer-popovers.spec.ts tests/e2e/chat-long-task-control.spec.ts tests/e2e/project-rag-chat-modes.spec.ts tests/e2e/project-rag-research.spec.ts --workers=1
docs:
  required: true
  files:
    - docs/dev/durable-task-system/DESIGN.md
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - harness/specs/fixtures/chat-planning-composer-ux/20261123/REPORT.md
---

当前主线已有任务体系资源。本次聚焦会话规划与输入区，沿用现有 Host、任务归属、发送和知识服务。布局与信息显隐由 renderer 负责，任务完成继续以 Task Ledger owner 为准。截图和交互由 agent 驱动。
