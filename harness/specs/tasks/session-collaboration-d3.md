---
lifecycleStatus: active
id: session-collaboration-d3
title: D3 呈现分范围预算、准入和任务阶段
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: b3d8d7956aabf5de9f404847a913f0afa35d5fc7
intent: 读取原 provider 预算、SessionAdmissionRegistry 和 Task Trace 阶段证据。
touchedAreas:
  - shared/long-session-resource-reclamation.ts
  - shared/task-system/trace.ts
  - shared/types/session-collaboration-resources.ts
  - shared/types/session-collaboration-usage.ts
  - openclaw_runtime/src/agents/provider-spend-budget.ts
  - openclaw_runtime/src/gateway/session-resource-inventory.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-usage.ts
  - src/components/agents/SessionCollaborationResources.tsx
  - src/components/agents/SessionCollaborationUsage.tsx
  - shared/i18n/locales/**/agents.json
  - tests/unit/session-collaboration-budget-view.test.tsx
  - tests/unit/autonomy-provider-spend.test.ts
  - tests/unit/session-collaboration-cost-attribution.test.ts
  - tests/e2e/session-collaboration-budget-view.spec.ts
  - docs/modules/sessions.md
  - docs/modules/resources-and-observability.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/session-collaboration-d3.md
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
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-budget-view.test.tsx tests/unit/autonomy-provider-spend.test.ts tests/unit/session-collaboration-cost-attribution.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-budget-view.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-d3.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-d3.md --dry-run
acceptance:
  - 宿主、项目和会话预算独立展示 spent、held、activeCalls 和未知计数，会话记录核对原工作区。
  - 原准入关闭、拒绝和等待与当前无负载的许可状态分别呈现。
  - 原 Task Trace 阶段和协调消耗可下钻，未知边界保持未知。
  - 四语、窄窗口与键盘入口有 Electron 回归。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - docs/modules/resources-and-observability.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---
# D3 预算与阶段

预算使用原持久预约及结算记录。会话预算遇到工作区混合时保留未知，宿主和项目仍按原范围展示。Task Trace 提供原阶段事件和挂接原报告的路径。
