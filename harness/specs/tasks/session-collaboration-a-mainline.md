---
lifecycleStatus: active
id: session-collaboration-a-mainline
title: 会话协作 A 阶段主线集成验收
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c932dfb554ae318cb50c20a9d4f8d9b78d56fca5
intent: 验证会话发现、按需详情、条件等待和两个界面入口在同一主线候选上的行为，冻结规模基线。
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/modules/sessions.md
  - docs/modules/multi-agent-and-tasks.md
  - electron/services/session-activity-api.ts
  - harness/specs/fixtures/session-collaboration-center/A*/**
  - harness/specs/guides/session-collaboration-center-plan.md
  - harness/specs/rules/session-collaboration-center-contract.md
  - harness/specs/scenarios/session-collaboration-center.md
  - harness/specs/tasks/session-collaboration-a*.md
  - harness/specs/tasks/session-collaboration-identity-read-model.md
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/config/sessions/**
  - openclaw_runtime/src/gateway/**
  - shared/host-api/contract.ts
  - shared/i18n/locales/**/agents.json
  - shared/session-collaboration-watch.ts
  - shared/task-system/store.ts
  - shared/task-system/tool-policy.ts
  - shared/types/session-activity.ts
  - shared/types/session-collaboration*.ts
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/components/agents/SystemPortfolioPanel.tsx
  - src/components/file-preview/WorkspaceAgentsPanel.tsx
  - src/lib/host-api.ts
  - src/lib/session-read-model.ts
  - src/stores/session-collaboration.ts
  - tests/e2e/fixtures/session-collaboration.ts
  - tests/e2e/fixtures/fp-p1-harness.ts
  - tests/e2e/session-collaboration-*.spec.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/session-collaboration-*.test.ts*
  - tests/unit/session-summary-bounded-read.test.ts
expectedUserBehavior:
  - 系统和项目从同一会话协作面板读取原始作用域内的会话，选中后加载详情。
  - 等待、取消和重连沿 Main 持有的 Gateway 连接消费原运行与任务事件。
  - 后台刷新保持筛选、选择与键盘焦点，换代或撤销范围时停止展示旧详情。
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - durable-task-system-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-identity.test.ts tests/unit/session-collaboration-query.test.ts tests/unit/session-collaboration-watch.test.ts tests/unit/session-collaboration-panel.test.tsx tests/unit/session-summary-bounded-read.test.ts tests/unit/host-api-facade.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:runtime
  - pnpm run test:e2e tests/e2e/session-collaboration-overview.spec.ts tests/e2e/session-collaboration-watch.spec.ts tests/e2e/session-collaboration-scale.spec.ts --workers=1 --retries=0
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-a-mainline.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-a-mainline.md --dry-run
acceptance:
  - 原会话、任务和运行身份保持一致，发现分页有界，越出可见范围或跨代的详情被拒绝。
  - 原运行终态、任务回执、空闲、超时、取消与断线各自可回读，监听结束后释放。
  - 桌面旅程在两个工作区验证两独立会话和子会话，覆盖四语、明暗主题、三档宽度、键盘和减少动效。
  - 在同一干净候选测量 2、20、100、500 会话的成功查询。保留查询和详情次数、扫描计数、延迟与采样内存，记录目标与基线。
  - 被动读取与等待不改写原 owner 或调用目标模型。保留原失败及 agent 驱动回执，保存星驰 gpt-6.1-sol 对阶段差异的审查结果。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - docs/modules/multi-agent-and-tasks.md
---

# A 阶段主线验收

在主线集成候选上复核 A1 到 A5。A1 的历史验收保留原候选和回执。后续收益和索引裁定在 D 阶段候选上同步重测规模样本。
