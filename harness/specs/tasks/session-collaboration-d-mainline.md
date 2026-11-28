---
lifecycleStatus: active
id: session-collaboration-d-mainline
title: D 接齐协作消耗、资源与测量入口
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 25118d45eb3bdedefbbe45f8250cec7a2e735b41
intent: 整合D1-D5已有实现并保留已合并的材料、恢复和读取边界。
touchedAreas:
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - docs/modules/resources-and-observability.md
  - docs/modules/sessions.md
  - electron/services/long-session-resource-reclamation.ts
  - electron/services/session-activity-api.ts
  - electron/services/terminal-session-manager.ts
  - harness/specs/fixtures/session-collaboration-center/D-development-20261127/read-boundary-and-material-budget/REPORT.md
  - harness/specs/fixtures/session-collaboration-center/D-development-20261127/read-boundary-and-material-budget/report.json
  - harness/specs/fixtures/session-collaboration-center/D-development-20261127/read-boundary-and-material-budget/review.json
  - harness/specs/fixtures/session-collaboration-center/D-development-20261128/**
  - harness/specs/fixtures/session-collaboration-center/D4/benchmark.json
  - harness/specs/fixtures/session-collaboration-center/D4/summarize.mjs
  - harness/specs/fixtures/session-collaboration-center/D5/review-evidence.mjs
  - harness/specs/fixtures/session-collaboration-center/D5/review-evidence.test.mjs
  - harness/specs/guides/session-collaboration-center-plan.md
  - harness/specs/tasks/session-collaboration-d-mainline.md
  - harness/specs/tasks/session-collaboration-d1.md
  - harness/specs/tasks/session-collaboration-d2.md
  - harness/specs/tasks/session-collaboration-d3.md
  - harness/specs/tasks/session-collaboration-d4.md
  - harness/specs/tasks/session-collaboration-d5.md
  - harness/specs/tasks/session-collaboration-material-conflict-budget-20261127.md
  - harness/specs/tasks/session-collaboration-resource-read-revalidation-20261127.md
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/provider-spend-budget.ts
  - openclaw_runtime/src/agents/session-collaboration-material-prompt.ts
  - openclaw_runtime/src/agents/worktree-registry.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-resources.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-usage.ts
  - openclaw_runtime/src/gateway/session-resource-inventory.ts
  - openclaw_runtime/src/infra/session-cost-usage.ts
  - openclaw_runtime/src/process/supervisor/supervisor.ts
  - openclaw_runtime/src/process/supervisor/types.ts
  - openclaw_runtime/src/process/supervisor/adapters/child.ts
  - openclaw_runtime/src/process/supervisor/adapters/pty.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/agents.json
  - shared/i18n/locales/ja/agents.json
  - shared/i18n/locales/ru/agents.json
  - shared/i18n/locales/zh/agents.json
  - shared/long-session-resource-reclamation.ts
  - shared/task-system/runtime.ts
  - shared/task-system/store.ts
  - shared/task-system/trace.ts
  - shared/types/session-collaboration-resources.ts
  - shared/types/session-collaboration-usage.ts
  - shared/types/usage.ts
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/components/agents/SessionCollaborationResources.tsx
  - src/components/agents/SessionCollaborationUsage.tsx
  - src/lib/host-api.ts
  - tests/e2e/session-collaboration-benefit.spec.ts
  - tests/e2e/session-collaboration-budget-view.spec.ts
  - tests/e2e/session-collaboration-cost-attribution.spec.ts
  - tests/e2e/session-collaboration-overview.spec.ts
  - tests/e2e/session-collaboration-resources.spec.ts
  - tests/unit/autonomy-provider-spend.test.ts
  - tests/unit/resource-metrics-owner.test.ts
  - tests/unit/session-collaboration-budget-view.test.tsx
  - tests/unit/session-collaboration-cost-attribution.test.ts
  - tests/unit/session-collaboration-material-adoption.test.ts
  - tests/unit/session-collaboration-material-lifecycle.test.ts
  - tests/unit/session-collaboration-panel.test.tsx
  - tests/unit/session-collaboration-query.test.ts
  - tests/unit/session-collaboration-resource-owner.test.ts
  - tests/unit/session-collaboration-process-identity.test.ts
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - durable-task-system-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 选中会话后按需展开模型用量、资源和预算，分别显示原owner范围及未知数据。
  - 测量脚本拒绝重复、不完整或输入不一致的配对，后续裁定可以回读原证据。
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-cost-attribution.test.ts tests/unit/session-collaboration-resource-owner.test.ts tests/unit/session-collaboration-budget-view.test.tsx tests/unit/session-collaboration-query.test.ts tests/unit/session-collaboration-material-adoption.test.ts tests/unit/session-collaboration-material-lifecycle.test.ts --maxWorkers=1 --no-file-parallelism
  - node --test harness/specs/fixtures/session-collaboration-center/D5/review-evidence.test.mjs
  - node scripts/contract-check.mjs
  - node scripts/i18n-lint.mjs
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/session-collaboration-d-mainline.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/session-collaboration-d-mainline.md --dry-run
acceptance:
  - 消耗分别按原会话、任务子树和运行归因，预算区分spent和held，缺失值保持未知。
  - 资源读取前后核对身份和权限，按PID创建身份确认样本，共享进程明确归属。
  - D4配对输入哈希与固定基准一致，配对ID、run和session不重复；D5拒绝指标不完整、跨候选及错误结果。
  - 同候选定向回归、源码检查、Electron用例收集与星驰独立开发验收通过。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - docs/modules/resources-and-observability.md
---

# D 阶段开发整合

从D分支032e93f6163f044e75f9829350b31a84aa7424c0整合已有D1-D5代码。保留主线材料最终载荷复核、协作提示和恢复入口；测量脚本绑定固定输入并拒绝错误质量结果。完整类型、构建、CI、Electron真实执行和A5/D4规模测量及D5裁定沿用用户延期安排。
