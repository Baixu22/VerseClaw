# 多智能体、任务与工作流

任务快照读取持久事件与任务 owner 的记录。派生 JSON 缓存发生写锁争用时跳过该次刷新，读取与执行准入继续使用当前 owner 数据；显式缓存写入保留串行文件锁。

后台队列派发读取聊天 owner 的接收回执。明确被拒绝的消息保留在原持久队列中并记录拒绝原因，可沿原会话继续核实和恢复。

会话切换按同一工作区、逻辑会话与代次恢复阅读消息及相对位置，同时保留各自草稿。会话家族在指针或键盘交互期间保持已有行位置；状态和后代计数即时更新，离开后发布新增成员和排序。规范的 Gateway 聊天终态同步到运行状态，会话详情和列表共用活动运行投影；为幂等保留的终态记录和旧活动快照不会将已结束运行重新显示为进行中。

未绑定负责人的项目保留导航入口并说明原因。任务读取失败区分权限拒绝与其它 owner 不可用，刷新沿原接口回读。依赖等待展示前置任务标题和状态；点击可定位并操作原任务，未加载依赖按需分页读取，缺失或不可读时保持等待。执行计划保留派发时的容量与写集安排原因，当前队列来自有效的会话资源快照；资源按钮进入已有存储总览。

连接状态沿 Gateway owner 的完整快照回读；就绪状态、端口、进程与连接时间按当前快照更新。快照请求期间收到状态事件后，迟到响应保留该事件。

Gateway 启动读取配置前记录排队 reload 的请求序号。成功启动只消耗已覆盖的 reload；后来的配置更新和显式 restart 在当前启动或重启完成后执行。重连本身不消耗尚未确认加载的配置更新。

显式停止推进已有生命周期代次，取消尚未完成的重启；旧重启流程在异步边界核对代次，不会在停止后再次启动或恢复自动重连。

消息分支在 owner 转录边界缺失时保留禁用入口和刷新提示，忙态仍沿用会话可用性约束；首条问题没有 assistant 祖先时拒绝分支。普通模型文字仅作为建议，用户通过既有 Handoff 入口审阅、编辑并确认。取消预览保留源草稿。相同操作 ID 的重试复用原子会话，不同合法操作 ID 即使草稿相同也各自保留独立创建意图。

Handoff 在激活前固定运行时确认的子会话代次。激活失败保留原操作与草稿；重试核对代次并复用原来的子会话，工作区确认激活后才开放首轮发送。

协调器绑定通过 Main 的准入检查后，将规范工作目录写入当前 Runtime 会话。Runtime 在会话写锁内校验代次；运行中的目录切换和陈旧请求被拒绝，原会话目录保持可回读。顶部任务入口在空范围时仍可打开，家族数量在展开和折叠时均可见。

目录绑定先在既有 coordinator binding 中保存暂停的待生效意图，再更新 Runtime 和任务引用，确认后激活。响应丢失或激活写盘失败保留该意图；重读和同参重试复用原修订，代次变化会拒绝恢复。

活动项目的目录与权限同步在既有 OpenClaw 配置锁内重新读取 Workspace owner，并与模型配置更新串行提交。Gateway 启动后的配置回读确认项目目录，定时任务据此取得该项目的执行范围。

打开资源弹窗会刷新当前会话的协调器状态与 worker 回执；重新加载页面后，可在这里读取已完成子会话的结果并返回其会话。

检查点对话框读取当前会话代次，恢复请求携带同一代次供 Host 核对；身份尚未加载时保留列表并禁用恢复。

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
`sessions.delegate` 在调用 Gateway 前通过 Main 默认解析器读取 Task Ledger，按 session、taskRef 和 generation 匹配链接；同会话的其他任务链接不会遮挡当前请求。
Fork 只获得只读 task 引用，不继承父会话写 claim；Handoff 需要重新绑定当前 generation。
Main 在 fork/handoff 时把同 workspace、同源会话的显式业务 task 链接写入派生会话；重复链接只保留一份，turn check、缺失任务和旧 generation 链接不继承，任务完成状态保持原值。
Fork 链接记录 Gateway 返回的新 generation，协调器仍需单独准入；Handoff 尚未创建运行时会话时 generation 为空，由协调器 owner 在会话建立后解析。

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

## 会话与任务链路

项目名称打开 Workspace 持久关联的负责人会话，旁边的折叠控件只整理侧栏。会话家族沿 runtime 的 fork、spawn、parent 字段展示；工作组保持原有归属。关系详情逐跳显示实际父会话，来源未加载、缺失、冲突、循环和深度截断分别显示。Task Ledger 的 sessionLinks 只关联任务。

会话列表按 runtime 提供的游标读取分页，只有首页读取 transcript 摘要；后续分页读取元数据。侧栏保留原有渐进渲染预算，较老的父会话也能成为家族入口。相同的草稿和面板状态不会重复提交保存。

在任务清单点击“使用任务”可为当前会话选择已有业务任务，记录状态保持不变。运行或资源仍被原 writer 占用时，Main 拒绝切换任务；选择完成后按新 generation 重新读取任务范围。

每个会话都有任务容器。普通讨论与已知纯读操作不创建业务任务；明确执行时，agent 通过 `task_control.start` 整理目标、约束和验收条件，原子建立或选择任务并领取执行凭据。首次工具效果先只读解析合同，核对运行代次、环境和旧 writer；通过最终运行校验后才领取所选任务。任务引用与执行回执写入同一账本。派发的 worker 根据 runtime 保存的 requester generation 取得对应执行任务；显式空写集 `[]` 保留只读职责，父任务 writer 不转移。Fork 只带只读引用，Handoff 在原 writer 静止后通过任务 owner 提升 epoch。权限由现有权限 owner 决定。

任务账本的历史页可以打开关联会话，打开前核对记录的会话 generation；任务检查点中的产物沿用文件预览入口。执行结束和检查点保持为各自的记录，任务验收仍消费绑定合同版本与候选的验证回执。

“在新会话中提问”保留所选问题之前的上下文，把编辑后的问题放入子会话草稿。Handoff 的按钮为“创建并发送”：Workspace 保存 source generation、操作标识、child 和首发 key；runtime 确认来源后完成创建。重启或响应丢失后先核对同一个 child。网关接收与 transcript 中的首轮记录是两个状态；结果未知时保留草稿并提供核实入口。恢复已创建的续接沿用已保存的草稿，新的问题可以在子会话中另行提交。

会话身份加载完成后可准备 Handoff；加载期间入口显示原因。侧栏已发起的接力意图会等待同一目标就绪，预览只接收当前会话和代次的结果。

Agents 面板将派发准入、实际执行、报告回传、验证回执、任务验收和父会话续行分列。单个 worker 的准入取自身回执；验证记录按任务版本、执行 epoch 和候选归组，任务验收由 Task owner 单独决定。活动快照保存 worker 的实际 child key；选择 worker 后读取其 transcript 和实际模型，并在实际发送边界核验 parent 与 child generation。任务清单展示账本记录状态；完成 owner 尚未提供可核对的验收回执时，自动验收显示不可用。

领取事务同时核对首次读取的合同 revision 与 digest；准入期间修订合同会拒绝此次领取。受管进程把 session、generation 和 run 身份保存到既有资源 reservation，未设置数量限额时也保留归属记录。任务切换、环境切换和 Handoff 查询同会话的全部未结清进程，包括旧 generation；旧记录身份不全时保持占用，等待进程 owner 核实。普通执行检查仍按具体 run 核对持久资源。

任务摘要从事件记录和任务合同重建。派生 JSON 缓存按文件锁串行写入；缓存写失败只记录诊断，已成功读取的任务仍可展示。权威事件或合同读取失败会显示 owner 不可用。

资源清单逐项保留 owner 的已知与未知状态。工作树目录缺失或注册读取失败时，该项标为 unknown，会话代次、进程和准入占用仍按各自 owner 的结果显示；unknown 不作为资源空闲或可回收的依据。

受管工具入口联合核对任务合同、会话代次、执行绑定和 checkout writer。writer 在工具之间保持占用，后台进程和未知效果须由原 owner 结清；规范任务委派通过持久父子凭据原子转移 checkout epoch。显式注册的 clone 通过原 TaskSystemStore 访问指定 authority，产物检查仍以实际检出目录为准；已有独立任务库不会被注册操作静默隐藏。受管 Mission 保存同一任务的合同版本、epoch、代次与 authority 引用，每次推进重新核验，业务完成依赖 Task owner 的验收回执。

“在另一个检出中继续”使用 Workspace 保存迁移阶段，并复用 Session mutation journal 记录物理代次和 transcript 转移。原任务的目标、检查点和产物引用保持；源 claim 暂停后交接到新代次，目标完成合同及资源回读后开放。回复丢失、窗口重开或进程重启都沿同一 operationId 恢复；同 ID 的不同目标请求会拒绝。

操作范围及恢复入口见[会话、任务与资源操作矩阵](../dev/session-lifecycle-control-matrix.md)。

子代理 transcript 与任务 owner 的读取使用 Gateway 的常规请求预算，并共享调用方的逻辑截止时间；读取前后均核对 generation。

子代理详情和名单面板按当前 child 会话代次读取任务 owner 的验证回执和验收状态，分别显示等待验收、已验收和已取消；刷新可回读核验后的状态。账本中的 worker 会话链接打开原有 transcript 面板，并保持正确负责人范围。验收读取失败时保留已读取的 transcript，任务验收显示不可用。

费用读取当前 transcript 中的结构化 usage 记录；完整费用记录可汇总，缺失费用显示“未知”。

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

会话优先的任务交互：普通讨论保持无任务；agent 通过 task_control.start 原子定位与领取，目标和验证条件由工具从请求及项目事实整理。当前会话状态经 taskLedger.sessionTask 读取，版本身份由 Main 向 session owner 核对。会话顶部显示可展开、隐藏和重开的轻量任务面板，默认收起执行步骤；显示偏好独立于执行状态。任务账本的创建表单需要主动打开。计划到达不再自动展开会话侧栏，用户仍可主动查看环境、子代理与进程状态。

在项目负责人会话中明确提出规划请求，负责人先读取项目事实与 `task_control.planStatus`，再用 `task_control.savePlan` 把目标、可检查的验收和带依赖的子任务一次保存到任务账本。项目会话的任务面板可展开查看当前计划、下一步、暂定假设、待决事项及版本记录。相同请求 ID 可重试；显式修订需提供任务 ID、期望版本与理由，旧任务与验收保留，新子任务使用独立 ID。活跃子任务必须先结清。保存计划不领取执行权。

明确执行计划下一步时，负责人将刚读到的父任务 ID、版本和稳定请求 ID 传给 `task_control.startNextPlanTask`。账本检查整个项目的计划子任务是否已有执行者，再按计划顺序认领首个依赖均已验收的子任务。重试只能读回原认领，计划已变更或执行权已移交时拒绝。认领成功后仍按原会话准入派发 worker。托管任务有 SQLite 派发预留而 Main 回执已丢失时，返回 `outcome-unknown`，须核对已有运行，重试不会再次启动 worker。
计划菜单通过 `sessions.dispatchPlanTask` 提交当前计划版本和所见子任务 ID。Main 核验活动项目、会话代次与项目预算，从角色注册表选择执行者，再通过 `sessions.delegate` 启动。工作会话沿用单写者准入，前置任务变化会使旧选择失效。模型限流按有效配置降级，备用模型调用独立预留预算。

Gateway 重启接回中断的项目负责人运行时，Task Ledger 核对原进程已退出、当前写入权仍有效、任务仍在执行且没有未结清效果，才按原任务、原会话代次与原 writer epoch 读取检查点并继续。`interrupted_run_replaced` 记录新旧运行及进程；未知效果须由对应 owner 核对后才能接回运行。

手动暂停负责人阻止新的项目派发，保留在途运行；停止运行也保留任务和检查点。暂停期间仍可取消任务或核对已有工具回执。取消后不再启动新效果，账本等待已开始的操作结清，再释放写入权。

侧栏与 `/new` 创建会话前，先通过原工作区保存队列落盘当前草稿；创建被拒绝时保留来源会话与草稿。

视觉层级更新：顶部任务头是唯一目标状态面，会话导航只保留项目入口和会话选项，侧栏不再重复计划。步骤来自持久子任务、检查点或运行计划；只有完整计划才能计算比例，核验完成由任务 owner 决定。消息历史原文保持完整。画布去掉网格与装饰，输入框减轻阴影；底部仅在有真实文件变更时显示按路径去重的文件数，详情继续显示实际分支和工作树。初始会话不显示任务头或 Git 状态。

归档设置中的“待确认操作”读取原 Main 生命周期记录；即使原会话行已经消失，也可按保存的操作继续。旧操作已经结束或被替换时会拒绝重放。Stop 在收到匹配运行的终止回执或同代次的空闲状态后才清理界面运行状态；迟到回包保持新代次和当前 agent 的列表。

压缩、范围整理和检查点恢复携带出发时的物理 sessionId，通过原准入屏障和会话存储写入校验。缺少原写入日志身份的旧检查点显示无法核验来源。任务或会话拥有的检出由原生命周期流程回收；存储/Git 的普通删除入口保留这些对象。未推送提交通过仍存在的共享 Git ref 保留，孤立提交尚未获得持久引用时拒绝清理。

视觉层级再次更新（2026-11-10，task-dock-composer-restraint）：运行中的任务停靠在输入框上方而非顶部，直到完成后收为一行回执；托盘显示短任务 ID（点击复制）、当前步骤、子任务 ID 与账本链接，菜单提供复制 ID、在任务账本中打开、展开/收起步骤、刷新与隐藏。会话任务范围由顶部横条改为页眉中的安静小标签，空/不可用/陈旧状态仍可区分。运行计划完成且本轮结束后托盘自动离开，记录保留在对话的回合摘要中。会话状态面板改为键值行：上下文用量（与输入框读数同源，未测量不显示）、在用连接器、变更与审阅入口、后台任务分组。

工作树回收读取原 Task 的全部 checkpoint、验收证据和委派候选历史。已完成任务的历史产物先按原 SHA256 在共享 Git 引用可达的提交中核验，再写入 `artifact_retained` 回执；旧版本快照和当前 HEAD 分别保留。回执先提交，删除前再次读取 Git 字节，删除完成后追加 `worktree_cleanup_completed`。进程中断后按登记的原任务库身份续接。

Git 工作树存在未提交内容时拒绝回收，声明的写集也不能豁免这项检查。实际删除使用 Git 自身的内容检查；Git 拒绝后保留目录，不转为递归强制删除。

`task_control.history` 和宿主任务命令可按任务与事件序号反查目标、领取、运行、候选、检查和保留回执。`readRetainedArtifact` 按任务与回执身份返回经过完整 SHA256 校验的 base64 分页，默认每页 16 KiB，最多 64 KiB；目录已删除仍可读取。领取、首次建库、跨 clone 登记与删除共享执行域锁；活跃委派、未完成任务和未知效果继续阻止回收。Git 报告根与物理 `.git` 归属不符时，任务准入、Git 写入和清理拒绝继续。

完成通知使用注册表中派发时保存的负责人会话代号。空闲负责人可自动接收 worker 结果，通知重试和宿主重启沿原身份继续；换代或删除会话后，Gateway 在投递入口和会话更新事务中拒绝旧通知。终态失败持久保存并停止重试。

交接前，Task Ledger 等待在途工具操作结清。新负责人用新的 writer epoch 接续同一任务和 checkpoint；源会话保留历史，完成通知根据 Workspace 已提交的交接状态拒绝唤醒源负责人。
