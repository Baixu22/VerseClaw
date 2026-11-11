---
lifecycleStatus: active
id: autonomy-worktree-integration
title: TF-0682 工作树成果整合、候选复验与安全回收
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: ce8bc53284f456c9a43d1dea5e929623278cc5ee
intent: 沿现有WorktreeService、持久registry与checkout writer接回TF-0769的受保护整合，绑定应用回执和新候选；跨工具回收继续由原owner执行。
expectedUserBehavior:
  - 不同工作树的成果可以顺序整合，删除和重命名被完整保留。
  - 目标内容、代次或写入资格改变时拒绝覆盖；未知应用效果有日志和恢复引用。
  - 合并后的验证绑定实际候选，历史产物和未推送成果由原资源owner保留。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - autonomy-worktree-integration
  - backend-communication-boundary
  - identity-scope-boundary
  - runtime-authority-convergence-boundary
  - durable-task-system-boundary
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - shared/types/versegit.ts
  - tests/unit/agent-config.test.ts
  - tests/e2e/session-worker-task-journey.spec.ts
  - tests/e2e/session-task-scope-completion.spec.ts
  - harness/specs/tasks/unified-execution-traceability.md
  - electron/utils/agent-config.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/worktree-registry.ts
  - openclaw_runtime/src/agents/worktree-writer.ts
  - openclaw_runtime/src/agents/worktree-merge-files.ts
  - openclaw_runtime/src/agents/orchestration-worktree-merge.ts
  - openclaw_runtime/src/agents/orchestration-candidate.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/subagent-spawn.ts
  - openclaw_runtime/src/plugin-sdk/journaled-git-apply.ts
  - openclaw_runtime/src/agents/worktree-service.test.ts
  - tests/unit/orchestration-worktree-merge.test.ts
  - tests/unit/worktree-registry-restart.test.ts
  - tests/unit/checkout-writer-ownership.test.ts
  - tests/unit/autonomy-worktree-integration.test.ts
  - tests/unit/autonomy-orchestration-waves.test.ts
  - tests/unit/worktree-reclamation-preservation.test.ts
  - tests/unit/task-worktree-retention.test.ts
  - tests/unit/task-artifact-retention.test.ts
  - tests/unit/versegit-host-apply.test.ts
  - tests/unit/versegit-candidate-freeze.test.ts
  - tests/fixtures/worktree-integration-process.ts
  - tests/fixtures/worktree-registry-process.ts
  - tests/unit/fixtures/task-retention-worker.mts
  - vitest.autonomy-r4.config.ts
  - vite.config.ts
  - harness/specs/tasks/autonomy-worktree-integration.md
  - harness/specs/rules/autonomy-worktree-integration.md
  - harness/specs/scenarios/autonomy-worktree-integration.md
  - harness/specs/fixtures/autonomous-project-system/r4/**
  - docs/modules/workspace-and-coding.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
requiredTests:
  - pnpm exec vitest run --config vitest.autonomy-r4.config.ts
  - pnpm exec vitest run tests/unit/long-session-runtime-resource-inventory.test.ts tests/unit/long-session-owner-reclamation-adapter.test.ts tests/unit/long-session-resource-reclamation.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm comms:replay
  - pnpm comms:compare
  - pnpm harness validate --spec harness/specs/tasks/autonomy-worktree-integration.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-worktree-integration.md --dry-run
acceptance:
  - 保留canonical TF-0682原要求和验收；两个实际Git工作树按目标owner顺序整合，旧generation与并发writer拒绝。
  - 复用TF-0769的Coding journal、二进制前后像及并发覆盖保护，完整应用删除/重命名，失败不报告merged。
  - 原registry持久保存整合基线与终态回执；重启和重复完成不创建第二写入或丢失原回执。
  - 新候选身份与验证目录绑定；应用记录、任务验收和发布批准分别表达。
  - dirty/未推送/活动任务及唯一候选证据由既有回收owner保护；消费TF-0867的历史保留实现，不另建回收authority。
  - 原生争抢、失败与恢复产物标注driven_by agent，保留source/candidate、输入、exit/count和hash。
docs:
  required: true
  files:
    - docs/modules/workspace-and-coding.md
    - harness/specs/rules/autonomy-worktree-integration.md
    - harness/specs/scenarios/autonomy-worktree-integration.md
---

TF-0680在2026-11-10经用户明确要求暂缓性能验收。R4先推进独立工作树整合实现，原依赖及最终跨工具验收保留；该顺序调整不修改R2的失败记录或验收阈值。

成果回流消费现有执行域注册、任务与checkout联合准入、session迁移和TF-0769。TF-0867原主线负责历史产物保留及清理竞争，整合时采用其已提交代码和证据。
