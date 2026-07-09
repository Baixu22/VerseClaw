# Multi-Agent Orchestration Goal Control Pack

> 文件性质: Goal 模式开发前置控制包索引。
>
> 适用范围: Role-First 多 Agent 编排 P0-P4 的长开发轮次。当前只允许启动 P0: 验证闭环硬化。
> 适用范围: Role-First 多 Agent 编排 P0-P4 的长开发轮次。P0/P1/P2/P3 已完成并提交;当前准备启动 P4: Synthesizer 与局部动态 DAG。

## 1. 使用方式

启动 Goal 前,先确认本目录与根约束文档存在:

- `docs/multi-agent-orchestration-development-plan.md`
- `docs/role-first-design.md`
- `docs/multi-agent-orchestration/README.md`
- `docs/multi-agent-orchestration/goal-mode-start-prompt.md`
- `docs/multi-agent-orchestration/goal-mode-development-protocol.md`
- `docs/multi-agent-orchestration/acceptance-and-test-matrix.md`
- `docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md`
- `docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md`
- `harness/specs/tasks/role-first-p0-verification-loop.md`

Goal 启动时使用 `goal-mode-start-prompt.md` 里的完整提示。该提示会要求 worker 先读完整控制包,再进入实现。
- `docs/multi-agent-orchestration/goal-mode-start-prompt-p1.md`
- `docs/multi-agent-orchestration/goal-mode-start-prompt-p2.md`
- `docs/multi-agent-orchestration/goal-mode-start-prompt-p3.md`
- `docs/multi-agent-orchestration/goal-mode-start-prompt-p4.md`
- `docs/multi-agent-orchestration/goal-mode-development-protocol.md`
- `docs/multi-agent-orchestration/acceptance-and-test-matrix.md`
- `docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md`
- `docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md`
- `docs/multi-agent-orchestration/phase-constraints/p2-runbook-complexity-gate.md`
- `docs/multi-agent-orchestration/phase-constraints/p3-typed-blackboard.md`
- `docs/multi-agent-orchestration/phase-constraints/p4-synthesizer-dynamic-dag.md`
- `docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md`
- `docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md`
- `docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md`
- `docs/superpowers/specs/2026-07-07-role-first-p2-runbook-complexity-gate-design.md`
- `docs/superpowers/plans/2026-07-07-role-first-p2-runbook-complexity-gate.md`
- `docs/superpowers/specs/2026-07-07-role-first-p3-typed-blackboard-design.md`
- `docs/superpowers/plans/2026-07-07-role-first-p3-typed-blackboard.md`
- `docs/superpowers/specs/2026-07-08-role-first-p4-synthesizer-dynamic-dag-design.md`
- `docs/superpowers/plans/2026-07-08-role-first-p4-synthesizer-dynamic-dag.md`
- `harness/specs/tasks/role-first-p0-verification-loop.md`
- `harness/specs/tasks/role-first-p1-resource-aware-scheduler.md`
- `harness/specs/tasks/role-first-p2-runbook-complexity-gate.md`
- `harness/specs/tasks/role-first-p3-typed-blackboard.md`
- `harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md`

P0 Goal 启动时使用 `goal-mode-start-prompt.md`。P1/P2/P3/P4 Goal 启动时分别使用 `goal-mode-start-prompt-p1.md`、`goal-mode-start-prompt-p2.md`、`goal-mode-start-prompt-p3.md`、`goal-mode-start-prompt-p4.md`。启动提示会要求 worker 先读完整控制包,再进入实现。

## 2. 文档分工

| 文件 | 责任 |
| --- | --- |
| `docs/multi-agent-orchestration-development-plan.md` | 长期路线图、P0-P4 阶段边界、全局硬约束、Agency 吸收原则 |
| `docs/role-first-design.md` | 当前 role-first runtime 事实基线,包括 RoleContract、权限、记忆、路由、团队模板和 UI 锚点 |
| `docs/multi-agent-orchestration/goal-mode-start-prompt.md` | 可直接复制进 Goal 模式的启动提示 |
| `docs/multi-agent-orchestration/goal-mode-development-protocol.md` | Goal 执行纪律: 一轮一个阶段、TDD、证据、脏工作区、最终报告 |
| `docs/multi-agent-orchestration/acceptance-and-test-matrix.md` | P0 验收项到测试/证据的映射 |
| `docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md` | P0 允许做什么、禁止做什么、如何判断完成 |
| `docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md` | P0 详细实施计划,分任务列出文件、接口、测试和命令 |
| `harness/specs/tasks/role-first-p0-verification-loop.md` | harness 可读取的 P0 task spec |

## 3. 当前阶段

当前阶段固定为 P0: 验证闭环硬化。

P0 只允许实现:
| `docs/multi-agent-orchestration/goal-mode-start-prompt-p1.md` | P1 可直接复制进 Goal 模式的启动提示 |
| `docs/multi-agent-orchestration/goal-mode-start-prompt-p2.md` | P2 可直接复制进 Goal 模式的启动提示 |
| `docs/multi-agent-orchestration/goal-mode-start-prompt-p3.md` | P3 可直接复制进 Goal 模式的启动提示 |
| `docs/multi-agent-orchestration/goal-mode-start-prompt-p4.md` | P4 可直接复制进 Goal 模式的启动提示 |
| `docs/multi-agent-orchestration/goal-mode-development-protocol.md` | Goal 执行纪律: 一轮一个阶段、TDD、证据、脏工作区、最终报告 |
| `docs/multi-agent-orchestration/acceptance-and-test-matrix.md` | P0-P3 验收项到测试/证据的映射 |
| `docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md` | P0 允许做什么、禁止做什么、如何判断完成 |
| `docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md` | P1 允许做什么、禁止做什么、如何判断完成 |
| `docs/multi-agent-orchestration/phase-constraints/p2-runbook-complexity-gate.md` | P2 允许做什么、禁止做什么、如何判断完成 |
| `docs/multi-agent-orchestration/phase-constraints/p3-typed-blackboard.md` | P3 允许做什么、禁止做什么、如何判断完成 |
| `docs/multi-agent-orchestration/phase-constraints/p4-synthesizer-dynamic-dag.md` | P4 允许做什么、禁止做什么、如何判断完成 |
| `docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md` | P0 详细实施计划,分任务列出文件、接口、测试和命令 |
| `docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md` | P1 设计说明,约束 scheduler 和 Agency draft catalog 边界 |
| `docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md` | P1 详细实施计划,分任务列出文件、接口、测试和命令 |
| `docs/superpowers/specs/2026-07-07-role-first-p2-runbook-complexity-gate-design.md` | P2 设计说明,约束 ComplexityGate 和 RunbookTemplate 边界 |
| `docs/superpowers/plans/2026-07-07-role-first-p2-runbook-complexity-gate.md` | P2 详细实施计划,分任务列出文件、接口、测试和命令 |
| `docs/superpowers/specs/2026-07-07-role-first-p3-typed-blackboard-design.md` | P3 设计说明,约束 typed blackboard 和 bounded A2A 边界 |
| `docs/superpowers/plans/2026-07-07-role-first-p3-typed-blackboard.md` | P3 详细实施计划,分任务列出文件、接口、测试和命令 |
| `docs/superpowers/specs/2026-07-08-role-first-p4-synthesizer-dynamic-dag-design.md` | P4 设计说明,约束 synthesizer 和 local dynamic DAG 边界 |
| `docs/superpowers/plans/2026-07-08-role-first-p4-synthesizer-dynamic-dag.md` | P4 详细实施计划,分任务列出文件、接口、测试和命令 |
| `harness/specs/tasks/role-first-p0-verification-loop.md` | harness 可读取的 P0 task spec |
| `harness/specs/tasks/role-first-p1-resource-aware-scheduler.md` | harness 可读取的 P1 task spec |
| `harness/specs/tasks/role-first-p2-runbook-complexity-gate.md` | harness 可读取的 P2 task spec |
| `harness/specs/tasks/role-first-p3-typed-blackboard.md` | harness 可读取的 P3 task spec |
| `harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md` | harness 可读取的 P4 task spec |

## 3. 当前阶段

当前阶段准备进入 P4: Synthesizer 与局部动态 DAG。

P0 已完成并提交,其交付物保持为后续阶段依赖:

- `OrchestrationResultBundle`
- `SchemaComplianceGate`
- `VerifierGate`
- max-one `Replan/Repair` 决策与 attempt 记录
- P0 eval/test scenarios
- trace/bundle 中记录 gate、权限拒绝、memory proposal、repair attempt

P0 明确禁止:

- `ResourceAwareWaveScheduler`
- `AgencyRoleImporter`
- Role Catalog UI
- typed blackboard
- synthesizer
- 新长期记忆策略
- open mesh A2A
- 直接把 Agency markdown agent 变成 runtime role

## 4. 推荐启动顺序

1. 确认工作区: `C:\Users\27933\Desktop\clawx\ClawX`
2. 复制 `goal-mode-start-prompt.md` 的提示进入 Goal 模式。
3. Goal worker 先运行结构校验。当前工作区如果有 unrelated dirty files,先使用 `--no-diff` 验证 spec 本身;完整 diff 校验留到阶段结束或隔离 worktree 中运行:

```powershell
pnpm harness context --spec harness/specs/tasks/role-first-p0-verification-loop.md
pnpm harness validate --spec harness/specs/tasks/role-first-p0-verification-loop.md --no-diff
```

4. Goal worker 按 `docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md` 任务顺序执行。
5. 每个任务遵守 RED -> GREEN: 先写失败测试,运行确认失败,再实现最小代码,再运行通过。
6. 阶段结束时对照 `acceptance-and-test-matrix.md` 和 `phase-constraints/p0-verification-loop.md` 汇报。
7. 阶段结束时,在只包含 P0-owned files 的 diff 或隔离 worktree 中运行完整 `pnpm harness validate --spec harness/specs/tasks/role-first-p0-verification-loop.md`。

## 5. 成功标准

P0 可以进入人工评审的最低标准:

- structured bundle 存在,并覆盖 spawn-phase 与 completion-phase 的核心证据。
- schema gate 能拒绝 malformed 或 evidence 缺失的 role outcome。
- verifier gate 能产生 `pass`, `fail`, `repair_required` 中的明确决策。
- repair/replan 自动决策最多一次,第二次失败停止并返回解释性失败。
- trace 或 bundle 中能看到 gate 决策、权限拒绝、memory proposal、repair attempt。
- 没有引入 P1-P4 功能。
- gate、权限拒绝、memory proposal、repair attempt 的 trace/bundle 表达

P1 已完成并提交,其交付物保持为 P2/P3 的依赖:

- `ResourceAwareWaveScheduler`
- scheduler metrics: queued/running/completed/skipped、concurrency cap、budget estimate、role cost summary
- runtime max active roles enforcement
- tool contention separation
- draft-only `AgencyRoleImporter`
- draft/reviewed/active catalog state data and validation guards

P2 已完成并提交,其交付物保持为 P3 的依赖:

- `ComplexityGate`
- `RunbookTemplate`
- built-in runbook registry
- runbook-to-task-graph conversion
- structured runbook selection metadata

P3 只允许实现:

- `OrchestrationBlackboard`
- typed entries: `fact`, `claim`, `question`, `risk`, `decision`, `artifact`, `conflict`, `handoff`, `memory_proposal`
- append/versioned update API
- conflict detection and resolution metadata
- untrusted content propagation and prompt-injection defense metadata
- verifier blackboard evidence read helpers
- trace replay reconstruction helpers

P4 只允许实现:

- `OrchestrationSynthesizer`
- local dynamic DAG refinement helper
- synthesis policy and visible failure preservation
- existing gateway/tool synthesis projection
- dual-column UI result view with evidence/verifier/trace detail

P4 明确禁止:

- synthesizer tool access
- synthesizer overriding verifier failure
- unauthorized dynamic DAG roles or tools
- scheduler bypass
- 新长期记忆策略
- open mesh A2A
- direct worker-to-worker chat
- worker direct long-term memory writes
- blackboard entries automatically becoming memory
- 直接把 Agency markdown agent 变成 runtime role
- prompt、Agency text、handoff prose 或 blackboard prose 授予真实工具/权限

## 4. 推荐启动顺序

1. 确认工作区: `C:\Users\27933\Desktop\clawx\ClawX-p0-main`
2. 复制 `goal-mode-start-prompt-p4.md` 的提示进入 Goal 模式。
3. Goal worker 先运行结构校验。当前工作区如果有 unrelated dirty files,先使用 `--no-diff` 验证 spec 本身;完整 diff 校验留到阶段结束或隔离 worktree 中运行:

```powershell
corepack pnpm harness context --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md
corepack pnpm harness validate --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md --no-diff
```

4. Goal worker 按 `docs/superpowers/plans/2026-07-08-role-first-p4-synthesizer-dynamic-dag.md` 任务顺序执行。
5. 每个任务遵守 RED -> GREEN: 先写失败测试,运行确认失败,再实现最小代码,再运行通过。
6. 阶段结束时对照 `acceptance-and-test-matrix.md` 和 `phase-constraints/p4-synthesizer-dynamic-dag.md` 汇报。
7. 阶段结束时,在只包含 P4-owned files 的 diff 或隔离 worktree 中运行完整 `corepack pnpm harness validate --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md`。

## 5. 成功标准

P4 可以进入人工评审的最低标准:

- synthesis 输出稳定,并保留 role outcomes、evidence、artifact、verifier、trace 和 blackboard summary。
- verifier fail/repair_required 不会被包装为成功。
- synthesizer 明确没有 tool access。
- local dynamic DAG refinement 记录 source/reason/scope/attempt,并拒绝未授权 role/tool/capability。
- dynamic DAG refinement 通过 P1 scheduler 计算,不会绕过 max active roles。
- UI 显示 synthesis 与 evidence/verifier/trace detail,失败保持可见。
- P0/P1/P2/P3 回归测试仍然通过。
- 没有引入 open chat、新长期记忆策略或 Agency runtime activation。
