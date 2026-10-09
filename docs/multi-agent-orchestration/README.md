# Multi-Agent Orchestration Goal Control Pack

> 文件性质: Role-First Multi-Agent 长开发的控制包索引。
>
> 当前状态（2026-07-28）: P0-P4 baseline 已完成并有审计证据。当前后续规划入口是 `runtime-v2-p3-p5-allocation.md`,开发工作已分配到 P3-R、P4-R、P5,但这些新增能力尚未实现。
>
> 边界: P3-R/P4-R 是 residual lane,不重开原 P3/P4。任何新一轮只启动一个依赖已满足的 `MA-*` work item,不得一次启动整条 Runtime V2 路线。

## Agency Role Promotion Control Pack

The controlled Agency draft review and config-role materialization project uses:

- `docs/superpowers/specs/2026-07-12-agency-role-promotion-control-plane-design.md`
- `docs/multi-agent-orchestration/phase-constraints/agency-role-promotion-control-plane.md`
- `harness/specs/tasks/agency-role-promotion-control-plane.md`
- `harness/specs/rules/agency-role-promotion-boundary.md`

The reviewed design, task spec and rule above are the durable entries. The
project start prompt and its long-form plan are process artifacts that the
retention policy keeps local (`docs/dev/repository-artifact-retention.md`), so a
clean checkout must not require them. The project still runs R0-R5 in order and
requires a ClawX/Agency Agents/Letta reference ledger in every round report.

The delivered control plane lets an operator select an Agency Agents checkout, review an immutable candidate, explicitly map or waive every tool hint, attach evidence, and approve a separate config-backed `RoleContract`. The source draft never becomes runnable. Retry reconciles exact contract identity, while retirement removes only that exact config role and preserves the review audit history.

The package-localization extension uses:

- `docs/superpowers/specs/2026-07-12-agency-role-package-localization-design.md`
- `docs/multi-agent-orchestration/phase-constraints/agency-role-package-localization.md`
- `harness/specs/tasks/agency-role-package-localization.md`
- `harness/specs/rules/agency-role-package-boundary.md`

It imports one selected draft into an immutable app-owned package. Review, approval, retry, and retirement then operate without the external checkout. Changed upstream content creates a linked package version and a new review; the package itself remains independent of Role Memory.

The separately gated memory-import extension uses:

- `docs/superpowers/specs/2026-07-13-agency-role-memory-import-design.md`
- `harness/specs/tasks/agency-role-memory-import.md`
- `harness/specs/rules/agency-role-memory-import-boundary.md`

It parses only complete active package snapshots with a Markdown AST and offers recognized governance sections as confidence `0.6` proposals. Selected items use the existing Memory preview, duplicate/conflict, proposal, and human review path; no Agency source text can directly create an active card or grant runtime authority.

## 1. 使用方式

开始 Multi-Agent 长开发前,按以下顺序读取:

1. `docs/role-first-design.md`: 当前 Role-First runtime 事实基线。
2. `docs/runtime-design/area-2-multi-agent-orchestration.md`: 多 agent 编排的当前实现事实、非目标与约束。
3. `docs/multi-agent-orchestration/acceptance-and-test-matrix.md`: P0-P4 历史阶段、验收与回归映射。
4. `docs/multi-agent-orchestration/runtime-v2-p3-p5-allocation.md`: P3-R/P4-R/P5 的当前工作分配、依赖和毕业条件。
5. 当前 `MA-*` work item 对应的 task spec、required rules 和最小 harness context。

早期的 goal-mode start prompt、plans 与长路线开发计划已按 retention 政策留在本地过程目录,不在干净检出中,也不再作为“当前阶段”入口;跟踪的 phase constraints、task specs 与 `docs/multi-agent-orchestration/acceptance-and-test-matrix.md` 继续承担历史与运行回归入口。

本控制包不会覆盖 Sustained Development Playbook、本地的 `docs/dev/handoffs/LATEST.md`(会话交接,按 retention 政策不进 Git)或 canonical Task Forest 的 active node。把分配项写入 Task Forest 仍须走 proposal -> apply;按 `AGENTS.md` 的 auto-close 覆盖,证据已齐备的节点不再等待额外确认。

## 2. 文档分工

| 文件 | 责任 |
| --- | --- |
| `docs/runtime-design/area-2-multi-agent-orchestration.md` | 多 agent 编排的当前架构事实、非目标与全局硬边界 |
| `docs/multi-agent-orchestration/runtime-v2-p3-p5-allocation.md` | P3-R/P4-R/P5 工作 ID、依赖、主责生态位、交付物、验收、禁区和 CRAFT 取舍 |
| `docs/multi-agent-orchestration/acceptance-and-test-matrix.md` | P0-P4 baseline 的验收/回归映射与完成证据索引 |
| `docs/role-first-design.md` | 当前 runtime 的 RoleContract、权限、记忆、路由、团队模板和 UI 锚点 |
| `docs/multi-agent-orchestration/goal-mode-development-protocol.md` | 长开发纪律: 一轮一个 ready item、TDD、证据、脏工作区和最终报告 |
| `docs/multi-agent-orchestration/acceptance-and-test-matrix.md` | P0-P4 历史验收与回归映射 |
| `docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md` | P0 历史边界 |
| `docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md` | P1 历史边界 |
| `docs/multi-agent-orchestration/phase-constraints/p2-runbook-complexity-gate.md` | P2 历史边界 |
| `docs/multi-agent-orchestration/phase-constraints/p3-typed-blackboard.md` | P3 Typed Blackboard 历史边界 |
| `docs/multi-agent-orchestration/phase-constraints/p4-synthesizer-dynamic-dag.md` | P4 Synthesizer / local DAG 历史边界 |
| `harness/specs/tasks/phase-5-evidence-verifier*.md` | 已存在的 P5 Evidence Verifier default-off / shadow 工作及证据 |

## 3. 当前开发分配

| 阶段 | 分配 ID | 当前含义 | 启动条件 |
| --- | --- | --- | --- |
| P3-R | `MA-P3-01` - `MA-P3-04` | WorkPackage/WorkResult、terminal handoff、artifact provenance、context fault、隔离与 replay | 从 `MA-P3-01` 顺序推进;不得开放直接 A2A 或新权限 |
| P4-R | `MA-P4-01` - `MA-P4-06` | 持久 Runtime Kernel、completion-driven DAG、admission/backpressure、多维预算、恢复和 policy profiles | P3-R 毕业后启动;ordinary orchestration 与 Task Loop 迁移必须 shadow/parity/cutover/rollback |
| P5 | `MA-P5-01` - `MA-P5-07` | Evidence Verifier 统一接线、条件趋势/校准、Routing Memo v2、审计队列、可验证缓存与受控激活 | P4-R 的相关 Kernel contract 稳定;始终 default-off / shadow-first |

关键路径:

```text
P3-R protocol contracts
  -> P4-R unified Orchestration Runtime Kernel
  -> P5 evidence intelligence and controlled optimization
```

`MA-P5-06` 的 batch、Token CFS、Petri validator 是证据触发的可选实验,不属于默认关键路径。

## 4. 单项启动协议

每次只启动一个 ready work item:

1. 确认该项在 `runtime-v2-p3-p5-allocation.md` 中的依赖全部满足。
2. 建立独立 `harness/specs/tasks/` task spec,声明 owned paths、required rules、tests、feature flags 和 rollback。
3. 运行 `pnpm harness context --spec <task-spec>`;涉及 backend communication 时引用 `gateway-backend-communication`。
4. 先写 contract/fixture 失败测试,再实现最小行为,然后执行 targeted tests 和相关回归。
5. runtime 接线或决策权变化必须按 `off -> shadow -> controlled active` 推进,提供 flag-off parity 与 rollback 证据。
6. 通信路径变化运行 comms replay/compare;用户可见变化补四语 i18n 和 Electron E2E。
7. 功能或架构变化后检查 `README.md`、`README.zh-CN.md`、`README.ja-JP.md`。
8. 阶段报告必须列出成功和失败 trace、预算/权限/证据决策、未实现的非目标及剩余 full gates。

## 5. 跨阶段硬边界

- `RoleContract` 仍是唯一合法 runtime role 通道;prompt、handoff、blackboard、memo 或历史质量不能授予权限。
- worker 不能直接写 Task Graph、Kernel state、长期记忆或 trace 历史。
- 不建设开放 Agent Mesh、直接 worker chat、四类常驻 Supervisor 或第二 runtime service。
- Strict 的审批、审计和 evidence obligation 不能因预算、背压、缓存或历史表现自动降低。
- Evidence Verifier、Routing Memo、趋势校准和缓存必须先 shadow、可解释、可关闭、可回滚。
- 不自动修改角色定义、协议结构、模板拓扑或工具权限。
- 规划分配不等于 runtime 能力完成;只有代码、测试、evidence 和人工 gate 都满足后才能更新状态。

## 6. 下一入口

在不改变当前产品开发 active node 的前提下,Runtime V2 的第一个候选实现项是 `MA-P3-01: WorkPackage/v2 + WorkResult/v2`。正式开工前应先把该单项转换为 task spec 和 Task Forest proposal,而不是直接启动整个 P3-R。
