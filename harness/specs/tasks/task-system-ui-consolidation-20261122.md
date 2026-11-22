---
id: task-system-ui-consolidation-20261122
title: 合并已有任务界面资源并统一任务工作台
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 910206880
intent: 将各开发线已有的前端和必要接口整合到主线，以实际运行截图统一会话任务托盘、任务账本和执行追踪的视觉层级。
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
  - .gitignore
  - AGENTS.md
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-quality/report.json
  - artifacts/agent-dev-workbench/evidence.json
  - src/**
  - shared/**
  - electron/**
  - openclaw_runtime/src/**
  - openclaw_runtime/packages/**
  - openclaw_runtime/extensions/memory-core/**
  - openclaw_runtime/extensions/memory-wiki/**
  - openclaw_runtime/tsconfig.json
  - openclaw_runtime/pnpm-lock.yaml
  - tests/**
  - tsconfig.*.json
  - scripts/knowledge-*
  - scripts/lib/project-rag-*
  - scripts/contract-check.mjs
  - scripts/check-semantic-authority-adjudication.json
  - scripts/copy-runtime-package.mjs
  - scripts/g5/node-gateway-process-evidence.cjs
  - scripts/repository-artifacts.json
  - harness/specs/**
  - docs/**
  - README*.md
expectedUserBehavior:
  - 会话任务托盘保持停靠输入框上方，完成后显示简洁回执。
  - 任务账本以清楚的任务列表和可展开详情呈现目标、状态、下一步和执行追踪。
  - 相同状态、任务标识、文字层级和操作样式在任务入口间保持一致。
  - 项目、会话和任务切换继续使用既有 owner 与接口；只读详情不改变任务执行。
acceptance:
  - 记录各来源工作树、固定提交、合入文件和接缝处理，当前会话能运行已整合界面。
  - 使用合并代码的实际运行截图进行 Carbon 图片审美分析，保留截图、建议和实际修改记录。
  - 任务列表、详情、托盘和追踪在宽窄窗口及明暗主题下层级清晰，无横向溢出。
  - 键盘可操作任务详情与菜单，四语文案完整，状态和成本来自既有任务 owner。
  - 类型检查、定向任务与聊天单测、通信回放、构建和对应 Electron 交互检查有退出码与盘上产物。
requiredTests:
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec vitest run tests/unit/session-task-dock.test.tsx tests/unit/task-trace-panel.test.tsx tests/unit/session-chain-panels.test.tsx --maxWorkers=1
  - pnpm exec vitest run tests/unit/chat-input.test.tsx tests/unit/task-ui-async-recovery.test.tsx tests/unit/project-rag-plan-owner.test.ts --maxWorkers=1
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/task-system-ui-consolidation.spec.ts
docs:
  required: true
  files:
    - docs/dev/durable-task-system/DESIGN.md
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - harness/specs/fixtures/task-system-ui-consolidation/20261122/REPORT.md
---

本次承接现有任务托盘、项目任务计划和执行追踪设计。任务定义、领取、运行和验收继续使用现有 Task Ledger owner；视觉修改集中在布局、信息层级和交互入口。验证和截图由 agent 执行并记录 `driven_by: agent`。
