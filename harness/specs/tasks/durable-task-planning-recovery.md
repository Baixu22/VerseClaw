---
id: durable-task-planning-recovery
title: 完成任务识别、分解、分页与效果恢复接口
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 7bd784bd2
intent: 补齐完整任务系统的可发现性与接续能力，保留稳定任务身份和单一 owner；相似任务只作为建议，分解保留父目标，未知效果只由已有 owner 的终态回执解除。
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - comms-regression
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 多页任务均可查询，按目标、状态和归属筛选；相似任务有解释且不自动合并。
  - 目标拆分为有依赖的实施任务，父目标继续保存原验收并等待子项完成。
  - 未知工具操作可以按回执 ID 向 effect owner 核对，错误身份与不确定结果继续拒绝重试。
touchedAreas:
  - shared/task-system/**
  - shared/host-api/contract.ts
  - electron/services/task-system-service.ts
  - electron/services/sessions-api.ts
  - electron/services/task-ledger-service.ts
  - electron/services/task-ledger-api.ts
  - src/lib/host-api.ts
  - src/pages/TaskLedger/**
  - shared/i18n/locales/*/taskLedger.json
  - openclaw_runtime/src/agents/persistent-task-acceptance.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - openclaw_runtime/src/gateway/server-methods/tasks.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.fork-lineage.test.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - tests/unit/durable-task-*.test.ts
  - tests/unit/chat-history-budget-reload.test.ts
  - tests/e2e/durable-task-*.spec.ts
  - scripts/evaluate-durable-task-continuity.mjs
  - scripts/verify-durable-task-system.mjs
  - vitest.task-system.config.ts
  - openclaw_runtime/scripts/tsdown-build.mjs
  - openclaw_runtime/scripts/tsdown-serial-build.test.mjs
  - openclaw_runtime/src/gateway/server-methods/persistent-task-acceptance.test.ts
  - harness/specs/rules/durable-task-system-boundary.md
  - harness/specs/scenarios/durable-task-system.md
  - harness/specs/fixtures/durable-task-system/**
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/dev/durable-task-system/**
  - harness/specs/tasks/durable-task-planning-recovery.md
requiredTests:
  - pnpm exec vitest run --config vitest.task-system.config.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e tests/e2e/durable-task-lifecycle.spec.ts
acceptance:
  - 游标分页不会漏掉并发新增前的已有任务；过滤与相似建议返回有界结果，不把标题当唯一身份。
  - 任务分解在单事务中写入，子任务继承父目标关键约束；父节点在子项未验收前不能通过。
  - 既有 receipt owner 读回验证 operation/run/session/tool 和当前 epoch，拒绝伪造、跨任务及 unknown 回执。
  - 回执核对与完成投影使用幂等键，重启后可从持久状态继续，不需人工补写状态。
docs:
  required: true
  files:
    - docs/dev/durable-task-system/PLAN.md
    - docs/dev/durable-task-system/STATUS.md
---

实施继续使用 `D:/ClawX-work/durable-task-system-20261107`。此规范补足已授权的完整任务系统，不改变本机任务域范围；不同机器的共享协调服务仍是独立部署能力。
