---
lifecycleStatus: active
id: session-collaboration-d2
title: D2 按原 owner 观察会话资源
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 4f8e3d48f33fff9c61ebfb05f41c1921803bb781
intent: 选中会话后读取当前代次的进程、终端、端口预留、工作树和准入状态。
touchedAreas:
  - shared/long-session-resource-reclamation.ts
  - shared/types/session-collaboration-resources.ts
  - openclaw_runtime/src/gateway/session-resource-inventory.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-resources.ts
  - openclaw_runtime/src/agents/worktree-registry.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/provider-spend-budget.ts
  - electron/services/long-session-resource-reclamation.ts
  - electron/services/terminal-session-manager.ts
  - electron/services/session-activity-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/components/agents/SessionCollaborationResources.tsx
  - shared/i18n/locales/**/agents.json
  - tests/unit/session-collaboration-resource-owner.test.ts
  - tests/e2e/session-collaboration-resources.spec.ts
  - docs/modules/sessions.md
  - docs/modules/resources-and-observability.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/session-collaboration-d2.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-resource-owner.test.ts tests/unit/resource-metrics-owner.test.ts tests/unit/long-session-runtime-resource-inventory.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-resources.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-d2.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-d2.md --dry-run
acceptance:
  - 核对可见会话、原代次、运行进程身份、终端 owner、工作树和准入，读回样本时间及部分来源。
  - 进程树按 PID 和创建标记去重。共享 Gateway 和缺原归属的观测保持共享或未知。
  - 相同 key 的旧代终端、端口、迟到样本和进程更换保持隔离，读取不触发既有回收与派发。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - docs/modules/resources-and-observability.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---
# D2 会话资源

按需读取原资源 owner 并在返回前再次校对会话和工作区。进程指标使用现有 OS 进程树样本，终端和端口预留使用原终端句柄。共享 Gateway 保留共享范围，会话级视图显示经过绑定的已知资源和缺少绑定的来源状态。
