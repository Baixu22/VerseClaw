---
id: task-workbench-visual-hierarchy
title: 统一任务工作台的信息层级与显示时机
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 431144c6f
intent: 以唯一顶部任务头、清晰执行步骤和底部输入区组织会话，按真实任务和文件变更动态显示状态，减少重复标题与技术信息。
requiredRules:
  - backend-communication-boundary
  - durable-task-system-boundary
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 未定位任务时不显示任务头，定位后目标只在顶部状态面显示一次。
  - 步骤和进度来自运行或任务 owner，未知进度不编造百分比。
  - 默认没有网格、目标底栏或分支条；有文件变化时输入框下方出现小入口。
  - 项目和会话管理、真实 Git 分支及工作树操作仍可主动打开。
touchedAreas:
  - src/pages/Chat/**
  - src/components/tool-ui/plan-view.tsx
  - src/styles/codex-composer-shell.css
  - shared/i18n/locales/*/chat.json
  - shared/i18n/locales/*/taskLedger.json
  - tests/unit/*task*.test.*
  - tests/unit/*chat*.test.*
  - tests/unit/composer-git-strip.test.tsx
  - tests/e2e/durable-task-*.spec.ts
  - docs/dev/durable-task-system/**
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
  - harness/specs/tasks/task-workbench-visual-hierarchy.md
  - harness/specs/fixtures/task-workbench-visual-hierarchy/**
requiredTests:
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm exec vitest run tests/unit/session-task-dock.test.tsx tests/unit/composer-git-strip.test.tsx
  - pnpm run test:e2e:run tests/e2e/durable-task-conversation.spec.ts
acceptance:
  - 同一目标在应用状态面仅显示于顶部任务头，原始用户消息保留。
  - 任务头可收起隐藏重开，标题和步骤不重复，完成/核验/暂停状态准确。
  - Git 文件数去重，空/未开始会话保持安静，读取结果不会串工作区。
  - 无网格背景，输入框减轻阴影，窄屏可操作，四语截图和键盘路径验证通过。
docs:
  required: true
  files:
    - docs/dev/durable-task-system/DESIGN.md
    - docs/modules/multi-agent-and-tasks.md
---

本次以顶部任务头为唯一任务状态入口，替代上一版输入框上方任务条。沿用实施工作树 D:/ClawX-work/durable-task-system-20261107。不增加虚构版本号，不自动打开右侧代码预览，不将普通自然语言回复伪造成已完成步骤。

2026-11-10：任务状态面的位置已由 `task-dock-composer-restraint` 取代——运行中的任务改为停靠在输入框上方、完成后收为一行回执，会话任务范围改为页眉小标签；本规格其余约束（不编造进度、文件变更入口、纯净画布）继续有效。
