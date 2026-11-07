---
id: durable-task-system
title: 持久目标与并发任务执行闭环
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 5ad905b44c2822caf6037df9278a8a260a27d3f9
intent: 扩展产品 Task Ledger 的目标、身份、领取、恢复和验收能力，使同任务跨会话与工作树保持唯一有效实现资格，并从持久目标恢复模型上下文。
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - durable-task-system-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 任务目标在会话压缩、重启与工作树切换后保持可恢复。
  - 领取冲突返回当前归属，用户可看到工作树、恢复状态和验收缺口。
touchedAreas:
  - shared/**
  - electron/services/**
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/lib/task-ledger-plan-projection.ts
  - src/pages/TaskLedger/**
  - openclaw_runtime/src/agents/**
  - tests/unit/**
  - tests/e2e/**
  - vitest.task-system.config.ts
  - scripts/verify-durable-task-system.mjs
  - scripts/repository-artifacts.json
  - .gitignore
  - docs/dev/durable-task-system/**
  - docs/modules/multi-agent-and-tasks.md
  - harness/specs/tasks/durable-task-system.md
  - harness/specs/rules/durable-task-system-boundary.md
  - harness/specs/scenarios/durable-task-system.md
  - harness/specs/fixtures/durable-task-system/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
requiredTests:
  - pnpm exec vitest run --config vitest.task-system.config.ts
  - node scripts/verify-durable-task-system.mjs
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run typecheck
  - pnpm run test:e2e tests/e2e/durable-task-system.spec.ts
acceptance:
  - 产品任务模型独立于 Task Forest skill，保留现有 Task Ledger owner 与运行 owner 的职责。
  - 相同任务在同树与不同树并发领取时只有一个有效 writer；幂等重试不新增执行。
  - 目标与验收按版本持久保存，压缩和重启后从 owner 重新装配，状态询问不覆盖目标。
  - 身份识别区分显式任务、业务键、同意图重试、相似任务和新发生实例；标题不作为唯一键。
  - 旧 epoch 的工具调用和完成拒绝；未知在途操作阻止盲目换人和重试。
  - 真实验证结果绑定任务版本、候选和产物后才能完成，缺失证据保持 review。
  - 迁移、降级、取消、交接、UI和性能具有同候选可回读证据。
docs:
  required: true
  files:
    - docs/dev/durable-task-system/PLAN.md
    - docs/modules/multi-agent-and-tasks.md
---

实施以 `docs/dev/durable-task-system/PLAN.md` 的状态机、身份与故障窗口为合同。开发节点的实施目录为 `D:/ClawX-work/durable-task-system-20261107`；Task Forest 只用于记录研发推进。
