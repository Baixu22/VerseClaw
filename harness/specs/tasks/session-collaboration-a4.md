---
lifecycleStatus: active
id: session-collaboration-a4
title: A4 系统与项目共用会话协作总览
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 30429fb6b53a0d1cd70a16136d9c4a7cb6fe336b
intent: 将有界查询和事件等待挂接到共用面板，保留原会话、任务与 worker 阅读入口和用户选择。
touchedAreas:
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/components/agents/SystemPortfolioPanel.tsx
  - src/components/file-preview/WorkspaceAgentsPanel.tsx
  - src/stores/session-collaboration.ts
  - shared/i18n/locales/**/agents.json
  - tests/unit/session-collaboration-panel.test.tsx
  - tests/e2e/session-collaboration-overview.spec.ts
  - tests/e2e/session-collaboration-watch.spec.ts
  - tests/e2e/fixtures/session-collaboration.ts
  - harness/specs/tasks/session-collaboration-a4.md
  - harness/specs/scenarios/session-collaboration-center.md
  - docs/modules/sessions.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - contract-first-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-panel.test.tsx --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-overview.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-a4.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-a4.md --dry-run
acceptance:
  - 系统和项目入口使用同一面板，读取独立会话和子代理的真实身份、目标、动作、状态及来源。
  - 只在选中后加载详情，后台变化保留筛选、选择、草稿、滚动和键盘焦点，不隐式切换工作区。
  - 四語、Light/Dark、390/960/1440 宽度、键盘和 reduced-motion 旅程完整，使用现有设计 token。
docs:
  required: true
  files:
    - docs/modules/sessions.md
---
# A4 交互

从 Workspace/Session owner 已返回的 scope 发起读取；请求者缺失、来源未读取、空结果和不可用分别显示。列表使用 A2 Query，选中详情使用 A1，事件更新使用 A3。原入口分别打开会话、worker 历史及 Task Ledger 回执。

异步结果绑定完整 scope 和请求序号。筛选和选择属于 UI 状态，当前行的原始来源与任务引用保留；它们不改变工作区、任务或执行资格。普通更新使用一个有上下文的状态消息，保持现有焦点。

继续本阶段源码开发，测试与验收按用户指令延期。
