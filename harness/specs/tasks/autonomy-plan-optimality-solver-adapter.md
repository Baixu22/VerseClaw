---
id: autonomy-plan-optimality-solver-adapter
title: TF-0888 / P6 为波次调度器接入方案最优性评估与形式化求解适配层
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 1b325ded8
intent: 在 ResourceAwareWaveScheduler 既有确定性安全边界之上新增多候选方案帕累托质量评分器与有界 CP-SAT/ILP/PDDL 求解适配契约，解决高维组合排程复杂度坍塌，超时或不可用时无损回退既有波次调度。
requiredRules:
  - autonomy-object-owner-boundary
  - autonomy-resource-owner-admission
  - identity-scope-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - comms-regression
  - paired-ablation-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - portable-spec-commands
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 多子任务存在复杂依赖、互斥工具与预算上限时，系统从候选方案中选出工期、估算成本与预期成功率更优的合法执行波次并保留排序理由。
  - 组合约束不可满足时返回最小冲突原因摘要而非静默跳步或放行冲突写集；求解器超时或缺失时自动降级为既有安全波次调度。
touchedAreas:
  - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
  - harness/specs/guides/autonomous-project-system-plan.md
  - harness/specs/tasks/autonomy-plan-optimality-solver-adapter.md
  - shared/types/planning-solver.ts
  - openclaw_runtime/src/agents/orchestration-resource-scheduler.ts
  - openclaw_runtime/src/agents/orchestration-protocol.ts
  - openclaw_runtime/src/agents/role-contract.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/planning-optimality-scorer.ts
  - openclaw_runtime/src/agents/solver-adapter.ts
  - electron/services/resource-fabric.ts
  - tests/unit/autonomy-plan-optimality-solver.test.ts
  - harness/specs/fixtures/autonomous-project-system/p6/**
  - docs/modules/multi-agent-and-tasks.md
requiredTests:
  - pnpm exec vitest run tests/unit/autonomy-plan-optimality-solver.test.ts tests/unit/resource-aware-wave-scheduler.test.ts tests/unit/orchestration-resource-scheduler.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/autonomy-plan-optimality-solver-adapter.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-plan-optimality-solver-adapter.md --dry-run
  - git diff --check
acceptance:
  - 保留 ResourceAwareWaveScheduler 已启动波次不可变、写集冲突隔离需真实 worktree owner 证明、不修改角色工具权限的全部既有不变量。
  - 候选评分器对同资源约束下的多个合法波次输出确定性的关键路径工期、估算成本、历史成功率与冗余度帕累托排序。
  - Solver Adapter 支持将 10 至 30 节点组合依赖、互斥组与预算约束编译为标准求解模型，在硬超时上限内返回更优或等优合法波次，并在合成基准集上实测最优率显著高于纯启发式/纯 LLM 排程。
  - 负例覆盖求解器超时确定性降级、不可行约束输出冲突诊断而非伪造空波次、尝试重排已启动 in-flight 波次被拒。
  - 全部评测证据标 driven_by:agent，原始跑次写 D:/tmp，支持从固定输入确定性复算。
docs:
  required: true
  files:
    - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
    - harness/specs/guides/autonomous-project-system-plan.md
    - docs/modules/multi-agent-and-tasks.md
---

# TF-0888 / P6 方案最优性评估与形式化求解适配层规范

本文件为规划阶段新建的任务规范（对应 `reasoning-planning-convergence-gap-plan.md` 中的 `TF-0888 / P6`），当前尚未执行实现或验收。

## 范围与复用边界

- **直接前置**：`TF-0675`、`TF-0679`、`TF-0886`。不重开 `TF-0675`，不新建第二调度权威，作为 `ResourceAwareWaveScheduler` 的前置候选优选与有界求解插件接入。
- **既有路径复用**：`openclaw_runtime/src/agents/orchestration-resource-scheduler.ts`、`openclaw_runtime/src/agents/orchestration-protocol.ts`、`openclaw_runtime/src/agents/role-contract.ts`、`openclaw_runtime/src/agents/worktree-service.ts`、`electron/services/resource-fabric.ts`、`docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md`、`docs/runtime-design/development-manual.md`。
- **拟新增路径**：`shared/types/planning-solver.ts`（拟新增）、`openclaw_runtime/src/agents/planning-optimality-scorer.ts`（拟新增）、`openclaw_runtime/src/agents/solver-adapter.ts`（拟新增）、`tests/unit/autonomy-plan-optimality-solver.test.ts`（拟新增）、`harness/specs/fixtures/autonomous-project-system/p6/**`（拟新增）。
- **回退策略**：关闭求解器与多候选重排开关后，100% 退回既有 `ResourceAwareWaveScheduler` 确定性拓扑排序波次。
