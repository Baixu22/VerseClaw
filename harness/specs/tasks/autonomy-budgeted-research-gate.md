---
id: autonomy-budgeted-research-gate
title: TF-0886 / P0 在任务拆解前接入有界预算 Research 探针与早停门禁
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 1b325ded8
intent: 在协调器生成或修订任务图前接入受 ResourceFabric 约束的只读预算化 Research 阶段，落盘可追溯事实锚点、未知项与边际收益早停回执，不重开已封存的 TF-0675 且不允许规划前探针产生写副作用。
requiredRules:
  - autonomy-object-owner-boundary
  - autonomy-resource-owner-admission
  - autonomy-session-task-scope-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - comms-regression
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - portable-spec-commands
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 复杂目标在进入任务拆解前先执行有明确 token、耗时与只读工具次数上限的信息探测，并输出带来源锚点的事实与未决假设摘要。
  - Research 探针严格限制为只读能力，任何写文件、进程修改或外部副作用请求均被 fail-closed 拦截并记录诊断。
  - 预算触顶或连续探测无新增有效事实锚点时自动早停，带着明确未知边界进入保守规划，不陷入无界检索。
touchedAreas:
  - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
  - harness/specs/guides/autonomous-project-system-plan.md
  - harness/specs/tasks/autonomy-budgeted-research-gate.md
  - shared/task-system/types.ts
  - shared/task-system/store.ts
  - shared/task-system/preplan-research.ts
  - electron/services/task-system-service.ts
  - electron/services/resource-fabric.ts
  - electron/services/workspace-preflight.ts
  - openclaw_runtime/src/agents/role-contract.ts
  - openclaw_runtime/src/agents/preplan-research-runner.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - tests/unit/autonomy-budgeted-research-gate.test.ts
  - harness/specs/fixtures/autonomous-project-system/p0/**
  - docs/modules/multi-agent-and-tasks.md
requiredTests:
  - pnpm exec vitest run tests/unit/autonomy-budgeted-research-gate.test.ts tests/unit/durable-task-planning.test.ts tests/unit/resource-fabric-primitives.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/autonomy-budgeted-research-gate.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-budgeted-research-gate.md --dry-run
  - git diff --check
acceptance:
  - 协调器规划前通过既有 ResourceFabric 预留 Research 预算包络（token、墙钟时长、只读工具调用上限），与执行期预算分账可查，未知单价不填 0。
  - Research 阶段调用任何写工具、非受管外部网络变更或扩权动作均被拒绝，且不产生磁盘或外部状态突变。
  - 产出的 PrePlanResearchPacket 持久化绑定目标 ID、候选基线、已核实文件/事实引用、未决假设列表及停止原因（completed / budget-exhausted / diminishing-returns）。
  - 负例覆盖超预算强行续跑、把未核实猜测标为 confirmed 事实、写操作绕过只读门禁、无来源锚点伪造探测结论。
  - 全部验收产物标 driven_by:agent 与具体 actor，不以真人操作或真人数据为门禁前置，支持从磁盘回读复算。
docs:
  required: true
  files:
    - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
    - harness/specs/guides/autonomous-project-system-plan.md
    - docs/modules/multi-agent-and-tasks.md
---

# TF-0886 / P0 规划前预算化 Research 门禁规范

本文件为规划阶段新建的任务规范（对应 `reasoning-planning-convergence-gap-plan.md` 中的 `TF-0886 / P0`），当前尚未执行实现或验收。

## 范围与复用边界

- **直接前置**：`TF-0673`、`TF-0674`、`TF-0679`。逻辑位于目标拆解前端，但**不重开已封存的 `TF-0675`**，通过增量规划前钩子向 `TaskSystemStore` 写入 `PrePlanResearchPacket` 供 `TF-0887`（Plan Mode）与 `TF-0888`（Solver Adapter）消费。
- **既有路径复用**：`shared/task-system/types.ts`、`shared/task-system/store.ts`、`electron/services/task-system-service.ts`、`electron/services/resource-fabric.ts`、`electron/services/workspace-preflight.ts`、`openclaw_runtime/src/agents/role-contract.ts`、`openclaw_runtime/src/agents/tools/persistent-task-tool.ts`（分支 `661e1dc5d` 合入后同步衔接 `shared/task-system/project-coordinator.ts`）。
- **拟新增路径**：`shared/task-system/preplan-research.ts`（拟新增）、`openclaw_runtime/src/agents/preplan-research-runner.ts`（拟新增）、`tests/unit/autonomy-budgeted-research-gate.test.ts`（拟新增）、`harness/specs/fixtures/autonomous-project-system/p0/**`（拟新增）。
- **回退策略**：关闭规划前 Research 准入开关后，协调器无损回退至 `TF-0675` 保守拆解路径，保留既有 `TaskSystemStore` 历史记录只读可查。
