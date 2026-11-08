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
- 否则串行/推迟。

规划阶段按写集判断冲突，实际派发再由 worktree owner 验证 checkout 和 generation。

`ResourceAwareWaveScheduler` 另有 wave immutability：已 started/completed 的 wave 不能被 re-plan；只能修改后续 planned wave。

未显式配置 worker cap 时，wave scheduler 采用串行1并注明容量尚未测量。派发结果
保持 pending；scheduled 记录规划数量，queued/running/completed/failed/unknown
由实际 subagent registry 投影，completed 只计成功终态。
开启handoff后，提交仍先返回queued。原registry在派发前读取并验证前序冻结输出，
把带hash的有界内容附加到请求；缺失或错配输出会阻止后续派发。

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
- appendEvents；
- createNode；
- updateNode；
- addEdge；
- linkSession；
- requestReview；
- clearReview；
- submitCompletion（同 task/candidate/generation 的 approved verifier 与 applied effect receipt 准入后，才写既有 `status_changed`）；
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

`submitCompletion` 是完成事件准入，不是第二完成权威：它拒绝 bare run/text/exit0/accepted、错 task、旧 candidate/generation、缺失或篡改证据，以及非 applied effect；成功时仍由 Task Ledger 的 `status_changed` 事件投影为 `done`。


## 11.1 Session task scope

会话的任务作用域来自同一 workspace 的 coordinator binding 与显式的 Task Ledger `sessionLink`。普通讨论可以为空；
没有显式 task link、link 属于旧 generation、task 跨 workspace 或 task 缺失时，执行准入 fail closed。
Fork 只获得只读 task 引用，不继承父会话写 claim；Handoff 需要重新绑定当前 generation。

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
### 持久任务与执行资格

产品 Task Ledger 的执行契约保存 objective、constraints、acceptance、revision 和来源；仓库共用 SQLite 保存领取、epoch、attempt、检查点和工具回执。模型调用边界重新读取目标，受管工具检查捕获的 epoch。旧 Task Ledger 事件迁入事务存储，旧 JSONL 原件保留；已有节点可通过 adopt 保留 ID。任务完成支持约定文件哈希和实际 exec 检查回执，业务 owner-receipt 在对应 owner 尚未接入时返回明确拒绝。研发 Task Forest 不参与产品运行。详见 [完整规划](../dev/durable-task-system/PLAN.md)。

`task_control` 提供领取、检查点、任务分解、相似候选、游标查询和效果回执恢复。父目标等待子项验收，深层任务恢复完整祖先目标；取消计划等待后代在途操作结清。子代理在实际派发前接收 writer，队列调度时重新核对原 owner，registry 终态后归还。`tasks.contract.accept`、`tasks.contract.receipt`、`tasks.contract.reconcile` 连接既有 verifier/effect owner，检查候选、会话代次和工具效果身份。任务事件支持按持久序号读取和确认，投影缓存可以重建。
