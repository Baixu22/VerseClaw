# 多智能体、任务与工作流

> 面向问题：Agent、Persona、Role、Team、Subagent 分别是什么？普通 Chat 何时进入多智能体？Task Ledger、Task Loop、ClawGraph 和 Mission Control 各自拥有哪一层状态？

## 1. 身份模型

### Agent / Assistant

持久身份，跨 session 存在，拥有：

- 名称与头像；
- workspace；
- 默认模型与推理强度；
- channel bindings；
- 一串 session；
- 一个 Persona。

### Persona

Agent 的 1:1 属性，编译到 Agent workspace 的 `SOUL.md`，并可由 `role-profile.json` 做结构化镜像。Persona 影响表达、专长、语言和限制，不是工具权限本身。

`SOUL.md` 可手工编辑；结构化 sidecar 通过 `soulHash` 检测漂移。上下文冲突时，手写 `SOUL.md` 仍是 model-facing 内容的事实来源。

### RoleContract

RoleContract 是可复用编排库，不是 Persona。一个 Agent 可在不同 orchestration 中复用多个 RoleContract，一个 RoleContract 也可用于多个 Agent。

核心字段：

- `name`
- `displayName`
- `rolePrompt`
- `tools[]`
- `capabilities[]`
- `toolRequirements[]`
- `riskProfile`
- `canModifyScope`
- `permissions`
- `model`
- `effort`
- `outputSchema`
- `handoff`
- `routingKeywords`
- `tags`
- optional Persona fragment

`tools[]` 是真白名单；`handoff` 是合法交接图；`outputSchema` 是输出形状契约。

## 2. 当前九个内置角色

源码：`openclaw_runtime/src/agents/role-contract.ts`。

| 角色 | effort | 文件 | 网络 | 主要工具 | 典型去向 |
|---|---|---|---|---|---|
| Planner | high | read | none | read/glob/grep | Architect、Implementer |
| Architect | high | read | none | read/glob/grep | Implementer、Reviewer |
| Implementer | medium | write | none | read/write/edit/bash | Tester、Reviewer |
| Tester | medium | read | none | read/bash | Reviewer、Skeptic |
| Reviewer | high | read | none | read/glob/grep | Implementer、Skeptic |
| Security Reviewer | xhigh | read | none | read/glob/grep | Skeptic、Implementer；交接需 review |
| Docs Writer | medium | write | none | read/write/edit | Reviewer |
| Knowledge Librarian | medium | read | none | read/glob/grep、knowledge.search/get | Researcher/Reviewer |
| Skeptic | high | read | none | read/glob/grep/bash | Implementer、Reviewer；交接需 review |

自定义角色可以从配置或 Agency package 导入，但导入后只有经过显式 promotion/review 的 config-backed RoleContract 才能运行。外部 source draft 不会直接变成 runnable role。

## 3. Agent、Role 与 Handoff 的边界

- Agent 持久，Role 为一次编排可复用。
- Role 不能凭 prompt 自我扩权。
- Handoff 不能直接改变 Task Ledger 状态。
- Handoff 对象必须符合声明的 `from/to` 与 `requiresReview`。
- Role model/effort 是契约内的候选，运行时 effective state 仍需 owner 确认。
- 角色 memory 与 RoleContract 分开；角色 memory review 不会自动修改 RoleContract。
- Role promotion/retirement 有独立审计历史。

## 4. 编排模式

`openclaw_runtime/src/agents/role-router.ts` 当前支持：

| 模式 | 触发画像 | 行为 |
|---|---|---|
| `router` | 简单任务、少文件提示 | 选择一个角色，单 worker |
| `lead-workers` | 多文件、重构、跨模块、明确复杂任务 | lead 分解成 task graph，多 worker，lead 综合 |
| `adversarial-review` | security、auth、credential、release、审计等重要任务 | security/reviewer、skeptic/verifier 强对抗 |

`preferredLeadRole` 可显式覆盖路由选择。

普通 Chat 不会无条件自动进入多角色分解。`capability-02` 的安全表述是：多角色分解存在于 orchestrator、team_orchestrate 或显式 Task Loop 路径；不是每条消息都拆成多角色。

## 5. 三种团队模板

`openclaw_runtime/src/agents/team-template.ts` 当前内置：

| 模板 | 模式 | Lead | Verifier | 角色 |
|---|---|---|---|---|
| Quick Development Team | lead-workers | planner | reviewer | planner / implementer / tester / reviewer |
| Security Audit Team | adversarial-review | security-reviewer | skeptic | security-reviewer / reviewer / tester / skeptic |
| Refactor Team | lead-workers | architect | skeptic | architect / implementer / tester / reviewer / skeptic |

模板是拓扑起点，不是无上限并行许可。Task graph、write-set、工具争用和并发 cap 仍由 scheduler 决定。

## 6. Resource-aware wave scheduling

入口：`openclaw_runtime/src/agents/orchestration-resource-scheduler.ts`。

调度器考虑：

- dependencies；
- `maxActiveRoles`；
- write-set conflict；
- write-set proof 是否存在；
- exclusive tool contention；
- effort-based cost estimate；
- verified worktree isolation。

dependence 已满足的节点才进入 ready set。以下情况会 defer：

- `write-set-conflict`
- `insufficient-writeSet-proof`
- `tool-contention`
- `concurrency-cap`

默认互斥工具组：

- `bash` / `exec` → shell lane；
- `write` / `edit` / `apply_patch` → write lane。

两个 writer 即使不冲突，也必须满足：

- 都有 write-set；
- 写集不冲突；
- 或两个都是 verified worktree 隔离；
- 否则串行/推迟。

`ResourceAwareWaveScheduler` 另有 wave immutability：已 started/completed 的 wave 不能被 re-plan；只能修改后续 planned wave。

如果未显式给 worker cap，wave scheduler 的保守硬默认是 64，避免无限并发；真实产品路径通常由 session/resource policy 提供更低的有效上限。

## 7. Subagent 生命周期

相关实现：

- `subagent-registry*`
- `subagent-control*`
- `subagent-announce*`
- `subagent-run-liveness.ts`
- `subagent-run-timeout.ts`
- `shared/subagent-lifecycle.ts`
- `shared/types/session-delegation.ts`

生命周期状态包括：

- started；
- yielded；
- completed；
- error；
- aborted；
- verified；
- missing/unknown（在批量投影中）。

Subagent：

- 有自己的 child session/run；
- 继承经过裁剪的工具授权；
- 可能使用 worktree 或 in-process shared 后端；
- 完成后通过 delivery/announce 机制回交给 requester；
- 不是直接和另一个 worker 自由聊天；
- 不拥有 Task Ledger 写权限。

Worker 的 `accepted` admission 不是 completion；最终文字也不是 delivery evidence。

## 8. Delegation admission

`sessions.delegate` 是 typed Host admission path。

Receipt 绑定：

- coordinator workspace/agent/session/generation；
- binding revision；
- Task Ledger node；
- role 与 task；
- child session/run；
- backend/provider/model evidence；
- tool allow/deny list；
- isolation mode/backend/worktree/write set；
- resource budget；
- idempotency key；
- admission state。

Admission 在现有 coordinator、permission、Gateway 与 runtime owner 中发生。以下 fail closed：

- stale binding revision；
- stale session generation；
- invalid/revoked approval；
- unsupported backend；
- unresolved tool authorization；
- parallel writer without proof；
- request hash 与既有 idempotency key 冲突。

receipt 明确带 `acceptedIsNotCompletion=true`，防止 UI 把 admitted 误投影为 running/completed。

## 9. Completion batches 与回交

同一 orchestration run 的 worker 组成 bounded completion batch：

- 按 orchestrationRunId + requester session 分组；
- 记录 expected/completed/failed/cancelled/pending/unknown；
- requester physical generation 必须一致；
- delivery 是 at-least-once；
- deterministic key + per-run state + generation pin 使重放幂等；
- generation mismatch 被 fenced；
- Task completion authority 仍为 Task Ledger，不是 model text。

Completion batch 可以驱动 requester Chat 的最终收口，但不能自行改 Task Ledger node 为 done。

## 10. 质量、Routing Memo 与报告

普通 orchestration 可以输出：

- plan；
- node status；
- handoff；
- audit；
- evidence；
- quality scorecard；
- diagnostics / recommended next step。

`OrchestrationQualityState`：

- `null`：未评测；
- `shadow`：有观测，但不影响路由；
- `active`：只有同 session Task Loop scorecard-backed quality 才能影响路由。

Routing Memo 默认/internal：

- shadow observation 无路由权；
- active quality 的 authority 受限；
- 不会自动淘汰角色；
- 不是产品级自动学习系统。

## 11. Task Ledger

用户入口：`/task-ledger`。Host API：

- snapshot；
- applyAgentAction（Main 回读当前 workspace/session owner 的自动 create/update/link）；
- appendEvents；
- createNode；
- updateNode；
- addEdge；
- linkSession；
- requestReview；
- clearReview；
- exportHtml。

节点类型：

- goal
- milestone
- task
- check
- decision
- risk
- deviation
- review

状态：

- todo
- doing
- blocked
- review
- done
- dropped

边类型：

- depends_on
- blocks
- relates_to
- derived_from
- supersedes
- needs_review

Task Ledger 拥有用户可见任务事实、review flags、history 和 Task Loop 相关根节点。Workboard/ClawGraph 的调度状态可以单向引用 Task Ledger node，但不应双向镜像成第二任务账本。

自动动作携带调用方在首次提交前保留的 `operationId`、`expectedRevision` 及完整
project/workspace/session/generation。Main 核对现有 Gateway owner 后固定记录
`assistant` 与实际 agent；payload 不能声明 actor、principal 或 identity。
owner 的 `childPid` 与连接时间也随请求核对，防止应用重启后复用的 generation 计数接纳旧请求。
同一 ID 的相同请求返回原回执，同 ID 异参或陈旧 revision 拒绝；同参数新 ID 是新意图。
各入口共用现有 `events.jsonl` 的 workspace 写锁，批次按校验和帧追加并同步；
`snapshot.json` 仅为可重建投影。自动动作回执和普通 `done` 状态不等于独立任务验收，
也不授予工具权限或改变 Task Forest 完成状态。

新增自动业务任务（goal/milestone/task）保留 `automaticCompletion` 的 pending 标记；
一般自动 update 不得直接提交 `done`。手工状态编辑以及 turn check、decision 等事实
保留各自语义。Task Loop 的运行结束在 Ledger 业务任务上先投影为 `review`，完成请求
只能引用原任务 owner 的 checkpoint 和独立验证回执。taskLedger.submitCompletion
接收持久 operation/revision、scoped taskRef、checkpointId 与 verificationRunIds；
Main 回读 TaskLoop 检查点、真实 generation 和现有 host receipt/artifact，不接收
调用者自报的 passed、verifier 或 digest-only verdict。当前候选、任务输入、验收清单或
owner revision 改变时，读模型退回 review 并显示失效/不可用；历史接纳事件仍可回读。
操作返回的 operationDecision 与 decisionScope=operation-history 表示本次操作的历史事实；
当前有效状态由 snapshot 的 completionReadback 表示，Chat、会话摘要和导出沿用同一读模型。
completionReadback 不接受普通事件自报。切换前台会话或项目不撤销原 taskRef 的有效证据，
新完成写入仍要求当前活动 owner 匹配。
普通自动生命周期事件不能覆盖、删除或重开已 done/dropped 的业务事实；手工终态
需要显式手工重开，新的完成声明也不能覆盖手工 done/dropped。会话活动面板使用同一
Gateway owner 回读验收，保留有效接纳并显示真实失效。
runtime 配置和完成 checkpoint 变更在原日志锁内先追加 revision，使并发接纳由 A2 CAS 拒绝。
相同有效配置的重复激活不追加失效事件。普通候选回读使用异步Git/文件I/O，
同一snapshot共享候选读取，下一次仍从源文件重新读取；最终接纳边界再次核对候选。
冻结检查程序保持前台执行到实际退出，工具工厂不会擅自把前台要求改成后台yield。
Mission Control/ClawGraph 的运行终态沿用各自 recorder 的投影，仍不表示独立业务验收。
`runtimeLifecycle` 来源标记只由内部 recorder 写入，公开创建、patch 和 append 入口拒绝调用方提供它。
混合 payload 的 node/patch 均校验来源标记。Mission 内层 TaskLoop 回读原 Mission owner 后复用共享 root，
原 source/run 归属保持不变；子 run 等待沿用既有 timeout owner，0/未配置不被缩成新的短时限。
TF-0672 仍在开发与验收中，真实 TaskLoop→检查进程→effect/archive→Electron 接纳正例已有开发证据，
尚未完成同干净候选与独立复核验收；单元 fixture 通过不能宣称完整自治验收完成。
冻结检查沿用 controller 当前 model/provider 和 exec policy。工具 hook 后的命令、实际 cwd 与
process owner 回执均须匹配；spawned 会话使用既有 workspace/cwd，cwd 变更使旧检查点不可用。
缺少可绑定候选和 process outcome owner 的远端 node 检查在启动前拒绝；验证记录不改变当前任务 root。
task cwd 使用另一 worktree 时，验收 source 来自实际执行树；输入摘要同时绑定 bootstrap workspace
和该执行树，任一来源变化都会使旧证据失效。独立 reviewer 与 Main 回读使用相同算法。

## 12. Task Ledger Working Context

Task Ledger 还拥有 task-scoped Working Context 的 proposal/accept/reject 事件。

八个字段：

- Objective
- Constraints
- ConfirmedFacts
- Decisions
- OpenRisks
- ActiveFiles
- Evidence
- NextAction

它是有版本、TTL、evidence、sensitivity 和 trust 的工作集。Accepted working context 可以成为长期 Memory 的 `MemPromotionCandidate/v1`，但不会自动写 Memory。

## 13. Task Loop

Task Loop 是显式启动的高约束执行循环，不是普通 Chat 的默认状态机。

它拥有：

- Task Ledger root；
- checkpoint；
- repair；
- blocked；
- evidence gate；
- loop run state。

Chat 可以显示升级建议；创建 root/启动 run 需要显式确认。普通 orchestration 不应借用 Task Loop 的 repair/checkpoint 语义。

## 14. ClawGraph

用户入口：`/clawgraph`，advanced。

核心类型：`shared/types/clawgraph.ts`。

Workflow YAML 包含：

- workflow id/title/objective；
- models；
- roles（runtimeRole/model/sandbox/tools）；
- nodes（task/dependsOn/checks/required）；
- control（maxParallel/policies）；
- termination conditions。

Host API：

- listWorkflows
- compile
- run
- status
- events
- abort
- review

ClawGraph 会编译成 IR，并把 node/role/model/candidate/handoff/audit/review 事实投影给页面。

边界：

- runtime Workboard 拥有调度，Task Ledger 拥有用户任务事实；
- graph node done 不等于 acceptance done；
- audit failure/handoff invalid 可以进入 review；
- `maxParallel`/policy 受运行时资源与权限边界；
- ClawGraph 不是第二 orchestrator、第二 task ledger 或第二 approval plane。

## 15. Mission Control / goal wake / background processes

Runtime 还包含：

- Mission Control；
- goal wake；
- flow_runs / mission_runs / task_runs；
- durable helper；
- background process registry；
- session activity goal/process/lineage 只读投影。

这些大部分是内部/controlled feature。Session activity 会明确区分：

- main run 完成；
- goal 仍 running；
- background process 仍 alive；
- lineage read 失败；
- goal/process unknown。

未知不等于“没有后台工作”。UI 应显示 unknown/stale，而不是空数组代表安全。

当前默认/默认关闭事实以 `docs/dev/default-config-matrix.md` 与对应 task spec 为准；不要因类型或页面存在就宣称全部启用。

## 16. 当前边界

- 已有 9 个内置 RoleContract，不是无限角色市场。
- 普通 Chat 不自动多智能体。
- 不开放 Agent Mesh/worker 直连聊天。
- `bounded_a2a` 仍不是默认产品能力。
- Runtime V2 unified orchestration kernel 仍是规划/后续工程，不因现有调度器存在而完成。
- Role evolution/routing learning 不默认开启。
- Worktree isolation 是 advanced；并行 writer 必须有 proof 或串行。
- Subagent accepted ≠ completed；text answer ≠ delivery/completion evidence。
- ClawGraph/Task Loop 不能替代 Task Ledger 验收。
- 多 agent 高并发 workspace 自动修改仍属于 NO-GO/受控边界。

## 17. 源码索引

- `openclaw_runtime/src/agents/role-contract.ts`
- `openclaw_runtime/src/agents/role-registry.ts`
- `openclaw_runtime/src/agents/role-router.ts`
- `openclaw_runtime/src/agents/role-spawn.ts`
- `openclaw_runtime/src/agents/team-template.ts`
- `openclaw_runtime/src/agents/orchestrator.ts`
- `openclaw_runtime/src/agents/orchestration-resource-scheduler.ts`
- `openclaw_runtime/src/agents/resource-aware-wave-scheduler.ts`
- `openclaw_runtime/src/agents/orchestration-protocol.ts`
- `openclaw_runtime/src/agents/orchestration-blackboard.ts`
- `openclaw_runtime/src/agents/subagent-*.ts`
- `electron/services/session-delegation-admission.ts`
- `electron/services/task-ledger-api.ts`
- `electron/services/task-ledger-service.ts`
- `electron/services/task-ledger-working-context.ts`
- `shared/task-ledger-working-context.ts`
- `shared/types/task-ledger.ts`
- `shared/types/team.ts`
- `shared/types/clawgraph.ts`
- `src/pages/Agents/`
- `src/components/agents/`
- `src/pages/TaskLedger/`
- `src/pages/ClawGraph/`
- `docs/role-first-design.md`
- `docs/multi-agent-orchestration/README.md`
- `docs/runtime-design/area-2-multi-agent-orchestration.md`

延伸阅读：[产品概念边界](../clawx-product-semantics.md)、[Session 与 delegation](sessions.md)、[资源与可观测性](resources-and-observability.md)。
