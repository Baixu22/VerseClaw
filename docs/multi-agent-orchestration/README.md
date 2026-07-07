# Multi-Agent Orchestration Goal Control Pack

> 文件性质: Goal 模式开发前置控制包索引。
>
> 适用范围: Role-First 多 Agent 编排 P0-P4 的长开发轮次。P0 已完成并提交;当前只允许启动 P1: 资源感知调度与 Agency Draft Catalog。

## 1. 使用方式

启动 Goal 前,先确认本目录与根约束文档存在:

- `docs/multi-agent-orchestration-development-plan.md`
- `docs/role-first-design.md`
- `docs/multi-agent-orchestration/README.md`
- `docs/multi-agent-orchestration/goal-mode-start-prompt.md`
- `docs/multi-agent-orchestration/goal-mode-development-protocol.md`
- `docs/multi-agent-orchestration/acceptance-and-test-matrix.md`
- `docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md`
- `docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md`
- `docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md`
- `docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md`
- `docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md`
- `harness/specs/tasks/role-first-p0-verification-loop.md`
- `harness/specs/tasks/role-first-p1-resource-aware-scheduler.md`

P0 Goal 启动时使用 `goal-mode-start-prompt.md`。P1 Goal 启动时使用 `goal-mode-start-prompt-p1.md`。启动提示会要求 worker 先读完整控制包,再进入实现。

## 2. 文档分工

| 文件 | 责任 |
| --- | --- |
| `docs/multi-agent-orchestration-development-plan.md` | 长期路线图、P0-P4 阶段边界、全局硬约束、Agency 吸收原则 |
| `docs/role-first-design.md` | 当前 role-first runtime 事实基线,包括 RoleContract、权限、记忆、路由、团队模板和 UI 锚点 |
| `docs/multi-agent-orchestration/goal-mode-start-prompt.md` | 可直接复制进 Goal 模式的启动提示 |
| `docs/multi-agent-orchestration/goal-mode-start-prompt-p1.md` | P1 可直接复制进 Goal 模式的启动提示 |
| `docs/multi-agent-orchestration/goal-mode-development-protocol.md` | Goal 执行纪律: 一轮一个阶段、TDD、证据、脏工作区、最终报告 |
| `docs/multi-agent-orchestration/acceptance-and-test-matrix.md` | P0/P1 验收项到测试/证据的映射 |
| `docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md` | P0 允许做什么、禁止做什么、如何判断完成 |
| `docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md` | P1 允许做什么、禁止做什么、如何判断完成 |
| `docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md` | P0 详细实施计划,分任务列出文件、接口、测试和命令 |
| `docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md` | P1 设计说明,约束 scheduler 和 Agency draft catalog 边界 |
| `docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md` | P1 详细实施计划,分任务列出文件、接口、测试和命令 |
| `harness/specs/tasks/role-first-p0-verification-loop.md` | harness 可读取的 P0 task spec |
| `harness/specs/tasks/role-first-p1-resource-aware-scheduler.md` | harness 可读取的 P1 task spec |

## 3. 当前阶段

当前阶段固定为 P1: 资源感知调度与 Agency Draft Catalog。

P0 已完成并提交,其交付物保持为 P1 的依赖:

- `OrchestrationResultBundle`
- `SchemaComplianceGate`
- `VerifierGate`
- max-one `Replan/Repair` 决策与 attempt 记录
- gate、权限拒绝、memory proposal、repair attempt 的 trace/bundle 表达

P1 只允许实现:

- `ResourceAwareWaveScheduler`
- scheduler metrics: queued/running/completed/skipped、concurrency cap、budget estimate、role cost summary
- runtime max active roles enforcement
- tool contention separation
- draft-only `AgencyRoleImporter`
- draft/reviewed/active catalog state data and validation guards

P1 明确禁止:

- `ComplexityGate`
- `RunbookTemplate`
- Role Catalog UI
- typed blackboard
- synthesizer
- 新长期记忆策略
- open mesh A2A
- 直接把 Agency markdown agent 变成 runtime role
- prompt 或 Agency text 授予真实工具/权限

## 4. 推荐启动顺序

1. 确认工作区: `C:\Users\27933\Desktop\clawx\ClawX-p0-main`
2. 复制 `goal-mode-start-prompt-p1.md` 的提示进入 Goal 模式。
3. Goal worker 先运行结构校验。当前工作区如果有 unrelated dirty files,先使用 `--no-diff` 验证 spec 本身;完整 diff 校验留到阶段结束或隔离 worktree 中运行:

```powershell
pnpm harness context --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
pnpm harness validate --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md --no-diff
```

4. Goal worker 按 `docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md` 任务顺序执行。
5. 每个任务遵守 RED -> GREEN: 先写失败测试,运行确认失败,再实现最小代码,再运行通过。
6. 阶段结束时对照 `acceptance-and-test-matrix.md` 和 `phase-constraints/p1-resource-aware-scheduler.md` 汇报。
7. 阶段结束时,在只包含 P1-owned files 的 diff 或隔离 worktree 中运行完整 `pnpm harness validate --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md`。

## 5. 成功标准

P1 可以进入人工评审的最低标准:

- scheduler 输出确定性 waves,并尊重依赖。
- max active roles 由 runtime scheduler enforce。
- tool contention 场景不会把冲突角色放入同一 wave。
- scheduler metrics 可解释 concurrency cap、budget estimate 和 role cost summary。
- Agency import 产物默认 `draft`,不能 spawn。
- draft 转 active 必须经过 RoleContract validation 和显式 review/activation 边界。
- P0 verification-loop 测试仍然通过。
- 没有引入 P2-P4 功能。
