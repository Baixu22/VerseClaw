# Multi-Agent Orchestration Goal Control Pack

> 文件性质: Goal 模式开发前置控制包索引。
>
> 适用范围: Role-First 多 Agent 编排 P0-P4 的长开发轮次。当前只允许启动 P0: 验证闭环硬化。

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
