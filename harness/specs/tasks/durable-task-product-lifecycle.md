---
id: durable-task-product-lifecycle
title: 在真实产品中完成跨工作树任务领取、交接与验收
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 27c164fe7
intent: 验证 Renderer/Main/Gateway/任务 owner 的实际交互，跨应用工作区交接仍受同一仓库任务域约束，暂停、恢复、验收和取消都能回读。
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 不同工作树的真实会话能查看同一任务；第二个领取者得到明确拒绝。
  - 目标工作区显式参与交接校验；旧会话无法续租，新的会话可暂停、恢复和提交验收。
  - 完成与取消状态在界面和持久 owner 中一致。
touchedAreas:
  - shared/task-system/types.ts
  - electron/services/task-system-service.ts
  - openclaw_runtime/src/agents/tool-display-config.ts
  - openclaw_runtime/apps/shared/OpenClawKit/Sources/OpenClawKit/Resources/tool-display.json
  - tests/e2e/durable-task-lifecycle.spec.ts
  - harness/specs/tasks/durable-task-product-lifecycle.md
  - docs/dev/durable-task-system/**
requiredTests:
  - pnpm run test:e2e tests/e2e/durable-task-lifecycle.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - 真实 Gateway session generation 与 coordinator binding 用于领取和交接，无伪造 session owner。
  - 两棵真实 Git 工作树同任务互斥，跨工作区交接后旧 epoch 拒绝。
  - 暂停恢复、真实 owner 验收、任务取消及截图都完成并回读磁盘产物。
docs:
  required: true
  files:
    - docs/dev/durable-task-system/STATUS.md
---

本叶验证现有任务系统产品接口，所有 fixture 与操作均由 agent 驱动。
