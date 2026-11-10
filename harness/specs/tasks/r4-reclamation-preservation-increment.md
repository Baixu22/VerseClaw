---
lifecycleStatus: active
id: r4-reclamation-preservation-increment
title: R4 回收前保留未整合内容与权限
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: bfd8e37b7d61aa11dcd2c6d9535977d0fece95c2
intent: 沿原工作树和执行域回收屏障检查实际内容与权限，已知无效果拒绝结算not-applied。
expectedUserBehavior:
  - 忽略文件、未声明文件、未保留的进程内内容和权限变更继续保留。
  - 准入后的内容或路径变化在删除前拒绝，工作树恢复原生命周期。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/worktree-writer.ts
  - openclaw_runtime/src/agents/worktree-merge-files.ts
  - tests/unit/worktree-reclamation-preservation.test.ts
  - tests/unit/checkout-writer-ownership.test.ts
  - tests/unit/task-worktree-retention.test.ts
  - harness/specs/tasks/r4-reclamation-preservation-increment.md
  - docs/modules/workspace-and-coding.md
  - harness/specs/fixtures/autonomous-project-system/r4/reclamation-increment/**
requiredTests:
  - pnpm exec vitest run tests/unit/worktree-reclamation-preservation.test.ts tests/unit/task-worktree-retention.test.ts tests/unit/task-artifact-retention.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/r4-reclamation-preservation-increment.md
acceptance:
  - 保留U6完整执行域屏障、taskCleanup绑定和重启finish receipt；Git dirty拒绝且无force或递归fallback。
  - 原持久registry保存初始worker字节与权限，清理使用真实快照，目标保留副本可回读。
  - 删除前在原writer排他内复验实例、内容、权限与引用；预检拒绝结算not-applied并恢复原状态。
docs:
  required: true
  files:
    - docs/modules/workspace-and-coding.md
---

本增量供原U6/TF0867主线独立消费，R4候选pipeline继续由原R4会话完成。
