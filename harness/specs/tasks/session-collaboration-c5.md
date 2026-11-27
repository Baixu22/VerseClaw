---
lifecycleStatus: active
id: session-collaboration-c5
title: C5 记录材料呈现、引用与实际模型消费
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: b0aa086418b6c607a1a7203f4229c217da4f566d
intent: 用原 TaskSystem 追溯区分候选、呈现、引用、模型消费和响应。
touchedAreas:
  - shared/types/session-collaboration-material.ts
  - shared/task-system/store.ts
  - shared/task-system/trace.ts
  - openclaw_runtime/src/agents/tools/session-collaboration-query.ts
  - openclaw_runtime/src/agents/tools/sessions-list-tool.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/execution-task-authority.ts
  - openclaw_runtime/src/agents/tool-description-presets.ts
  - openclaw_runtime/src/agents/session-collaboration-material-prompt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-diagnostic-events.ts
  - electron/services/sessions-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/components/agents/SessionCollaborationMaterials.tsx
  - tests/unit/session-collaboration-material-adoption.test.ts
  - tests/e2e/session-collaboration-material-reuse.spec.ts
  - docs/modules/sessions.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/session-collaboration-c5.md
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
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-material-adoption.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-material-reuse.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-c5.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-c5.md --dry-run
acceptance:
  - 候选、实际界面呈现、引用、模型请求消费及回应分别保留来源版本和读取者，运行行为绑定实际 run 和调用。
  - 最终模型请求只接收当次运行显式选择且仍可见的有效材料，预算裁剪或来源失效不产生消费回执。
  - 两独立会话通过原查询和 provider 路径配对测量重复读取，保留原任务结果、请求记录和证据哈希。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---
# C5 真实消费归因

模型工具持久结果保留引用。请求准备时按原会话、任务版本和材料哈希重读，确认材料字节进入模型请求且获得回应后写入 Task Trace。界面呈现回执绑定实际读者，原经验接受与记忆写回由各自 owner 管理。
