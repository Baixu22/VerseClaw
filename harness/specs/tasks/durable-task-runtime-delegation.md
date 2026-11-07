---
id: durable-task-runtime-delegation
title: 在子代理派发与终态之间转移并归还任务执行资格
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 739ed26d7
intent: 在实际 child session generation 已持久化且 Gateway 尚未派发时转移任务 writer，保留父会话只读引用，以既有子代理 owner 的终态及操作回执归还；未知派发与未决效果保留恢复状态。
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - comms-regression
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 子代理启动时能够读取同一目标并持有唯一 writer，父会话保留目标只读引用。
  - 子代理终态被 owner 确认且效果已结清后，父会话恢复新的执行代数；旧 writer 被拒绝。
  - 两个并发派发、失联回应、generation 变化和未知效果不会产生第二个有效 writer。
touchedAreas:
  - shared/task-system/**
  - openclaw_runtime/src/agents/subagent-spawn.ts
  - openclaw_runtime/src/agents/subagent-registry-lifecycle.ts
  - openclaw_runtime/src/agents/persistent-task-delegation.ts
  - openclaw_runtime/src/agents/persistent-task-spawn.integration.test.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - electron/services/task-system-service.ts
  - tests/unit/durable-task-*.test.ts
  - harness/specs/tasks/durable-task-runtime-delegation.md
  - docs/dev/durable-task-system/**
requiredTests:
  - pnpm exec vitest run --config vitest.task-system.config.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - 真实生产派发入口在 child 调用前提交绑定，成功、失败与丢失回应有持久状态。
  - 父会话只读引用、child epoch、操作回执和返还规则在重启及并发下可回读。
  - 错任务、错 generation、错 run、旧 epoch 和未决工具操作均有拒绝负例。
  - 每个终态由现有 registry owner 触发；模型文本或 accepted 不触发归还或任务完成。
docs:
  required: true
  files:
    - docs/dev/durable-task-system/STATUS.md
---

本叶属于完整任务系统 TF-0847，实施工作树为 `D:/ClawX-work/durable-task-system-20261107`。验收必须覆盖实际调用点及持久状态，不能只验证一个未接线 helper。
