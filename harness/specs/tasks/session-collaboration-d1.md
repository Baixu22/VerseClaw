---
lifecycleStatus: active
id: session-collaboration-d1
title: D1 按会话、任务子树和运行读取模型消耗
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 4ed0fdd542cbaf1fd73fcae5d5648f4933b40582
intent: 通过原会话 transcript 和 Task Trace 提供范围明确的消耗投影。
touchedAreas:
  - shared/task-system/trace.ts
  - shared/task-system/store.ts
  - shared/task-system/runtime.ts
  - shared/types/usage.ts
  - shared/types/session-collaboration-usage.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/infra/session-cost-usage.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-usage.ts
  - electron/services/session-activity-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/components/agents/SessionCollaborationUsage.tsx
  - shared/i18n/locales/**/agents.json
  - tests/unit/session-collaboration-cost-attribution.test.ts
  - tests/e2e/session-collaboration-cost-attribution.spec.ts
  - docs/modules/sessions.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/session-collaboration-d1.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - durable-task-system-boundary
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
  - pnpm exec vitest run tests/unit/session-collaboration-cost-attribution.test.ts tests/unit/task-model-usage.test.ts tests/unit/usage-live-scope.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-cost-attribution.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-d1.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-d1.md --dry-run
acceptance:
  - 会话 transcript、任务子树和当前运行显示各自范围和来源，跨来源统计保持独立。
  - 按原 model call 身份去重，fork 继承区间与不匹配代次不归入当前会话。
  - 调用消耗记录原 attempt、缓存 token、价格版本与协调分类，缺用量、缺价格、迟到与冲突状态可回读。
  - 扩展选中会话的按需详情，列表刷新不额外读取 transcript、启动运行或更新 TaskSystem。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---
# D1 模型消耗

Task Trace 读取现有 G5 的原调用回执及父子任务关系。会话累计读取绑定当前代次的原 transcript，任务和运行只读取 TaskSystem。原调用观测费用使用结算时的价格版本。缺失价格和用量分别保留未知，协调消耗沿用原调用分类。
