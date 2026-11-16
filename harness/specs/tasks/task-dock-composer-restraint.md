---
id: task-dock-composer-restraint
title: 任务托盘停靠输入框上方并收敛会话状态面板
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: ea4bff442
intent: 参照桌面端参考设计，把运行中的任务从顶部任务头改为停靠在输入框上方、完成后收为一行回执的克制托盘，并补齐短任务 ID、账本链接、子任务 ID 与菜单交互；会话任务范围由横条改为页眉小标签；会话状态面板改为上下文、连接器、变更、后台任务的键值行。
requiredRules:
  - backend-communication-boundary
  - durable-task-system-boundary
  - session-derivation-ui-contract
  - i18n-locale-coverage
  - ui-motion-material-system
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 普通对话没有持久任务或运行计划时不显示任务托盘；运行中的任务停靠在输入框上方直到完成，持久任务完成后收为一行回执，运行计划全部完成且本轮结束后离开（回合摘要保留记录）。
  - 托盘默认只显示状态图标、标题、短任务 ID、状态与步数和当前步骤；展开后显示步骤、子任务 ID、更新时间与账本链接；进度只来自已知步骤，不编造百分比。
  - 短任务 ID 点击即复制完整 ID，复制失败如实提示；菜单提供复制 ID、在任务账本中打开、展开/收起步骤、刷新与隐藏，支持方向键、Home/End 与 Esc（焦点回到菜单按钮）。
  - 隐藏只改变展示，不改变任务所有权或执行；新任务不继承旧任务的隐藏偏好；账本链接携带 workspaceId、sessionKey 与 nodeId。
  - 会话任务范围是页眉中的安静小标签：只显示计数，空/不可用/陈旧仍通过 data-state 与状态文本区分，需要处理时才显示提示与刷新；列表以锚定弹层打开（窄屏为底部抽屉）。
  - 会话状态面板以键值行呈现：上下文用量（与输入框读数同源，未测量不显示）、在用连接器与技能、单行变更与审阅入口、后台任务分组（运行中命令显示已运行时长）；原有测试 ID 保持不变。
touchedAreas:
  - src/pages/Chat/SessionTaskDock.tsx
  - src/pages/Chat/SessionActivityPanel.tsx
  - src/pages/Chat/index.tsx
  - src/components/task-ledger/TaskLedgerSummaryPanel.tsx
  - src/components/tool-ui/plan-view.tsx
  - src/styles/codex-session-activity.css
  - src/lib/mock-host-bridge.ts
  - shared/i18n/locales/*/chat.json
  - shared/i18n/locales/*/taskLedger.json
  - tests/unit/session-task-dock.test.tsx
  - tests/unit/session-activity-panel-sections.test.tsx
  - tests/unit/session-family-navigation.test.tsx
  - tests/e2e/durable-task-conversation.spec.ts
  - tests/e2e/session-activity-background-read.spec.ts
  - docs/dev/durable-task-system/**
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
  - harness/specs/tasks/task-dock-composer-restraint.md
  - harness/specs/tasks/task-workbench-visual-hierarchy.md
  - harness/specs/fixtures/task-dock-composer-restraint/**
requiredTests:
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec vitest run tests/unit/session-task-dock.test.tsx tests/unit/session-activity-panel-sections.test.tsx tests/unit/session-activity-panel.test.tsx tests/unit/session-chain-panels.test.tsx tests/unit/session-family-navigation.test.tsx tests/unit/session-task-state-guidance.test.tsx
  - pnpm run test:e2e:run tests/e2e/durable-task-conversation.spec.ts tests/e2e/session-activity-background-read.spec.ts
acceptance:
  - 托盘位于输入框正上方（data-placement=composer，与输入框间距小于 48px），会话顶部不再有任务横条，任务范围标签高度小于 40px。
  - 短任务 ID 与完整 ID 一致且可复制，菜单与账本链接打开的是同一 nodeId，并携带 workspaceId 与 sessionKey。
  - 完成态回执、计划离场、隐藏/重开与刷新后持久、键盘路径和四语文案经单元测试与 Electron E2E 验证。
  - 会话状态面板新增上下文与连接器键值行、单行变更与审阅、后台任务分组，未测量的上下文不显示，原有测试 ID 不变。
docs:
  required: true
  files:
    - docs/dev/durable-task-system/DESIGN.md
    - docs/modules/multi-agent-and-tasks.md
---

本规格取代 `task-workbench-visual-hierarchy` 中“顶部任务头是唯一任务状态面”的位置约定：任务状态面移到输入框上方，按参考桌面端“非静默、常驻到完成”的节奏显示，外观保持克制（细边框、中性图标，仅完成勾与需处理状态带颜色），交互上补足任务 ID、账本、子任务与菜单。会话任务范围仍是每个会话都存在的真实容器（满足 `session-derivation-ui-contract`），只是从压在对话上的横条改为页眉小标签。

证据由 agent 驱动（`driven_by: agent`），见 `harness/specs/fixtures/task-dock-composer-restraint/`。
