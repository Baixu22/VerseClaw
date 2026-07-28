# ClawX 多 Agent 编排长期开发计划

> 文件性质: 持久化开发指导文档。本文用于约束后续一轮或多轮较长开发,明确迁移方向、阶段边界、硬约束、验收标准和评审口径。
>
> 依赖基线: `docs/role-first-design.md` 是当前 Role-First 结构说明,本文不替代它;本文描述如何在现有 role-first runtime 上继续演进多 Agent 编排。
>
> 最新判断: ClawX 应从 "lead-mediated fan-out/fan-in" 演进为 "role-first + bounded multi-agent orchestration"。Agency Agents 应作为 catalog、runbook、handoff、测试方法论来源被吸收,不能直接作为运行时 agent 群导入。
>
> 当前状态（2026-07-28）: P0-P4 baseline 已完成,证据见 `docs/multi-agent-orchestration/2026-07-08-role-first-completion-audit.md`。后续能力补全已分配到 P3-R、P4-R 与 P5,详见 `docs/multi-agent-orchestration/runtime-v2-p3-p5-allocation.md`。P3-R/P4-R 是 residual lane,不覆盖原 P3/P4 的完成结论。

> Goal 控制包: 启动长开发前先阅读 `docs/multi-agent-orchestration/README.md`。P0-P4 的历史启动提示与阶段约束保留为完成基线;新的开发轮次从 Runtime V2 分配书中的单个 ready work item 建立独立 task spec,不得直接重跑整个旧阶段。

## 1. 架构定位

ClawX 的多 Agent 编排不应走开放群聊式 A2A,也不应把大量 prompt agent 当成权限主体。目标架构是:

- `Persistent Agent` 负责会话、工作区、模型和用户配置路由。
- `RoleContract` 是唯一合法的运行时角色通道。
- `Role/Subagent` 是一次编排中的任务执行单元,由契约、权限、工具、输出格式和交接规则约束。
- `Orchestrator` 拥有任务图、执行波次、验证闭环、trace 和状态提交权限。
- `Agency Agents` 的价值进入角色目录、团队模板、runbook、handoff 模板和评测样例,不直接获得运行权限。

一句话边界: **角色是契约,不是人格;协作是受控图执行,不是开放聊天;记忆是治理提案,不是 worker 自写长期状态。**

## 2. 当前基线

当前系统已有以下已验收基础:

- RoleContract 类型、校验、SOUL 编译和内置角色: `openclaw_runtime/src/agents/role-contract.ts`
- 角色注册表与自定义角色合并: `openclaw_runtime/src/agents/role-registry.ts`
- 权限到 denylist 的硬映射: `openclaw_runtime/src/agents/role-permissions-policy.ts`
- 角色 spawn 与权限继承点: `openclaw_runtime/src/agents/role-spawn.ts`
- role router、team template、task graph、execution waves: `openclaw_runtime/src/agents/role-router.ts`, `openclaw_runtime/src/agents/team-template.ts`, `openclaw_runtime/src/agents/orchestration-protocol.ts`
- `OrchestrationResultBundle`、schema/verifier gate、max-one repair、resource scheduler、Complexity Gate 与 RunbookTemplate。
- Typed Blackboard、trace replay、verifier evidence projection、Synthesizer 与局部动态 DAG。
- Routing Memo 的 `off -> shadow -> active` 权限模型和 Phase 5 Evidence Verifier 的 default-off/shadow 规格与实现脚手架。
- Role Memory 控制平面、Gatekeeper、Context Pack: `openclaw_runtime/src/memory/*.ts`
- 用户入口和可观测 UI: `src/components/agents/RolesOrchestrationPanel.tsx`

当前短板:

- ordinary orchestration 仍按 wave dispatch/settle 组织,缺少 completion-driven、持久、可恢复的统一 `OrchestrationRunState` 权威。
- ordinary orchestration 与 Task Loop 尚未共用同一个 Runtime Kernel、事件状态机、admission、预算和恢复协议。
- token/time/cost/effect/evidence budget、verifier backpressure 和 provider/tool/workspace lease 尚未完整接入生产调度。
- 工作包、terminal-bound handoff、artifact provenance 与 `context_fault` 协议尚未统一。
- 质量趋势、置信度校准和 Routing Memo 优化仍需基于 verified evidence 走 shadow-first 的受控毕业路径。
- Agency Agents 内容很丰富,但如果直接导入为运行时 prompt,会破坏 RoleContract 和权限边界。

## 3. 目标执行流水线

目标流水线如下:

```text
Complexity Gate
  -> Role Router / TeamTemplate / RunbookTemplate
  -> WorkPackage/v2 + Task Graph / DAG
  -> Orchestration Runtime Kernel
       -> persistent event state machine
       -> completion-driven DAG
       -> adaptive admission + multidimensional budget
       -> isolated Role Subagents / Task Loop
       -> WorkResult/v2 + terminal-bound handoff
  -> SchemaComplianceGate + Evidence Verifier
  -> bounded Replan / Repair
  -> Synthesizer
  -> UI + Trace + MemoryProposal + Routing Memo
```

P0-P4 的历史推进边界如下,均已完成并保留作为回归基线:

- P0 不引入 `Complexity Gate`,不引入 `ResourceAwareWaveScheduler`,不引入 `RunbookTemplate`,不引入 `Synthesizer`。
- P0 只硬化 `OrchestrationResultBundle -> SchemaComplianceGate -> VerifierGate -> max-one Replan/Repair`。
- P1 才进入资源感知调度和 Agency draft catalog。
- P2 才进入 runbook 和复杂度入口。
- P3 才进入 typed blackboard。
- P4 才进入 synthesizer 和局部动态 DAG。
- P3-R 补全版本化工作包、handoff/provenance 和 context fault 协议。
- P4-R 建立 ordinary orchestration 与 Task Loop 共用的 Runtime Kernel。
- P5 只在 verified evidence 上建设审计智能与受控优化,先 shadow 后 controlled activation。

## 4. 全局硬约束

这些规则跨阶段生效,任何实现、评审和测试都必须检查:

1. `RoleContract` 是唯一合法运行时角色通道;persona、prompt 模板、Agency agent 文档不能绕过契约成为运行主体。
2. 权限默认拒绝。filesystem、network、command、MCP、memory write 必须由契约和主进程/运行时策略显式授予或拒绝。
3. prompt 不能授予权限。所有权限来自结构化 contract 和 runtime policy。
4. worker 不能直接写长期记忆,只能产出 `MemoryProposal`;是否落地由 Gatekeeper 或授权 API 决定。
5. worker 不能直接修改 orchestration state,只能提交结构化结果、证据、失败和提案。
6. verifier 可以判定 pass/fail/repair-needed,但不能无限 replan;单次 orchestration 的自动 replan/repair 最多一次。
7. synthesizer 不拥有工具权限,只消费已验证 bundle、trace 和 artifact 引用。
8. blackboard 必须是 typed、append-only 或 versioned update,不允许静默覆盖冲突。
9. max active roles 必须由 runtime enforce,不能只靠 UI 或 prompt 约束。
10. trace 必须 append-only,关键事件至少包含 role、taskId、attempt、tool/permission 摘要、gate 决策和证据引用。
11. renderer 不直接调用 Gateway HTTP 或裸 IPC;前端仍通过 `src/lib/host-api.ts`、`src/lib/api-client.ts` 或既有受控 host route。
12. 任何通信路径变更必须遵守 harness 规则,必要时先建立 `harness/specs/tasks/` 任务 spec。
13. Strict policy 的审批、审计和证据义务不能因预算、队列压力、历史质量或模型建议自动降级。
14. 路由、趋势、缓存和历史质量信号只提供受控参数建议,不能授予角色、工具、memory 或状态写权限。
15. Runtime V2 必须复用现有 runtime 与 observability,不得创建并行 daemon、Agent Mesh service 或第二状态权威。

## 5. 状态权威源

状态边界必须先清楚,否则多 Agent 会退化成并发写状态。下表同时标注 P0-P4 当前权威和 Runtime V2 尚未实现的目标权威:

| 状态 | 权威源 | 允许写入者 | worker 权限 |
| --- | --- | --- | --- |
| RoleContract / RoleRegistry | runtime role registry | 注册表构建与配置加载流程 | 只读 |
| TeamTemplate | team template resolver | 配置加载、受控导入、人工确认 | 只读 |
| RunbookTemplate | runbook registry | 受控导入、人工确认、版本化配置 | 只读 |
| TaskGraph / DAG | orchestrator | orchestrator、一次性 replan 流程 | 提交建议 |
| ExecutionWave | scheduler/orchestrator | scheduler | 无直接写入 |
| WorkPackage / WorkResult（P3-R 目标） | versioned protocol + Runtime Kernel | protocol builder / Kernel collector | 消费 work package、提交 work result |
| HandoffArtifact（P3-R 目标） | terminal-bound artifact ledger | Runtime Kernel 在有效终态提交 | 提交候选 handoff,不能直接推进依赖 |
| OrchestrationRunState（P4-R 目标） | Kernel event log + deterministic reducer | Runtime Kernel | 只提交结构化事件输入 |
| OrchestrationResultBundle | orchestrator result collector | result collector | 提交 role outcome |
| VerificationReport | verifier gate | verifier gate | 无直接写入 |
| BlackboardEntry | blackboard service | authorized append/update API | append proposal 或 scoped entry |
| Role Memory | memory control plane | Gatekeeper/authorized memory API | 只能提案 |
| UI Projection | renderer projection | renderer 从受控 API 派生 | 无 |
| Trace | trace recorder | runtime recorder | 追加事件输入,不能改历史 |

## 6. 分阶段路线

### P0: 验证闭环硬化

目标: 让现有 role-first 多 Agent 运行结果变得可验证、可追踪、可失败、可最多修复一次。P0 成功后,即使调度和 UI 仍朴素,系统也能证明多 Agent 输出不是一团不可审计文本。

交付物:

- `OrchestrationResultBundle` 结构化结果包。
- `SchemaComplianceGate` 校验 worker/verifier 输出是否满足结构。
- `VerifierGate` 统一 verifier 决策,至少支持 `pass`, `fail`, `repair_required`。
- max-one `Replan/Repair` 机制,记录 attempt 和原因。
- P0 eval scenarios,覆盖通过、失败、格式错误、证据不足、权限拒绝和一次修复。
- 状态权威源声明,落在本文和对应 runtime 类型/注释中。

建议 bundle 最小字段:

```ts
type OrchestrationResultBundle = {
  orchestrationRunId: string;
  taskGraphId: string;
  attempt: number;
  leadRole: string;
  selectedRoles: string[];
  roleOutcomes: RoleOutcome[];
  artifacts: ArtifactRef[];
  evidenceRefs: EvidenceRef[];
  permissionEvents: PermissionEventSummary[];
  failures: OrchestrationFailure[];
  verifierReport?: VerificationReport;
  repair?: RepairSummary;
  memoryProposals: MemoryProposalRef[];
  traceIds: string[];
  budgetSummary?: BudgetSummary;
};
```

P0 边界:

- 不实现 `ResourceAwareWaveScheduler`。
- 不引入 Agency role importer。
- 不新增 Role Catalog UI。
- 不实现 typed blackboard。
- 不让 worker 互相直接发消息。
- 不实现 synthesizer。
- 不改动长期记忆落地策略,只允许继续通过 Gatekeeper。

验收标准:

- worker 缺少必要字段、证据引用或输出 schema 时,`SchemaComplianceGate` 必须拒绝进入 verifier 成功路径。
- verifier 失败时,系统可以触发一次 repair/replan;第二次失败必须停止并返回可解释失败结果。
- replan/repair 计数由 runtime 强制,测试中无法通过 prompt 或参数绕过。
- 每个 orchestration run 都能在 trace 中看到 worker outcome、gate 决策、verifier 决策和 repair 决策。
- 权限拒绝事件必须进入 bundle 或 trace 摘要,不能只留在 console log。
- memory proposal 只能作为提案进入 bundle,不能由 worker 直接写入长期记忆。
- P0 不要求最终答案更漂亮,只要求结果可信、可检查、可失败。

测试与 eval:

- 为 result bundle schema 增加单元测试。
- 为 schema gate 增加 malformed worker output 测试。
- 为 verifier gate 增加 pass/fail/repair-required 测试。
- 为 max-one repair 增加连续失败测试。
- 为权限拒绝和 memory proposal 增加 trace/bundle 测试。
- 运行相关 role runtime 单测,并在影响通信链路时运行 `pnpm run comms:replay` 和 `pnpm run comms:compare`。

P0 完成定义:

- P0 eval pack 稳定通过。
- 新旧 role-first 基础测试不回退。
- 文档中所有 P0 非目标仍未被实现为隐藏功能。
- 可以向评审者展示一份失败样例和一份修复一次后成功样例。

### P1: 资源感知调度与 Agency Draft Catalog

目标: 在 P0 可验证的基础上,提升并发/成本/角色选择的可控性,同时开始吸收 Agency Agents 的目录价值,但不让它直接进入运行时。

交付物:

- `ResourceAwareWaveScheduler`,基于 max active roles、role cost、tool contention、estimated effort、dependency edges 生成执行波次。
- 调度 metrics,至少记录 queued/running/completed/skipped、concurrency cap、budget estimate、role cost summary。
- `AgencyRoleImporter` draft-only 流程,把 Agency divisions/agents/tools 映射为 draft role catalog entries。
- Role Catalog 审核入口或配置输出,明确 draft、reviewed、active 三态。

P1 边界:

- scheduler 只能决定顺序、并发和跳过策略,不能改变角色权限。
- Agency draft 不能成为 `RoleContract` active entry,除非经过校验、人工确认或明确的审核 API。
- Agency 的 tool 描述只能作为候选 allowlist/denylist 输入,不能直接授权真实工具。
- 不引入 blackboard。
- 不引入 open mesh A2A。

验收标准:

- 在同一 task graph 上,调度器输出是确定性的,相同输入得到相同 waves。
- max active roles 被 runtime enforce,不是仅 UI 禁用。
- tool contention 场景下,两个需要互斥资源的 role 不会被调度到同一冲突 wave。
- Agency import 产物默认 `draft`,不能被 spawn。
- draft 转 active 必须经过 RoleContract validation。
- UI 如果新增可见交互,必须补齐 i18n 和 Electron E2E。

测试与 eval:

- scheduler deterministic unit tests。
- max active roles integration tests。
- Agency importer fixture tests,覆盖 divisions、tools、handoff 文本和非法字段。
- RoleContract validation regression tests。

### P2: RunbookTemplate 与 Complexity Gate

目标: 让系统不是每次都“临场规划”,而是能对常见复杂任务选择可复用 runbook;同时用 Complexity Gate 判断任务是否值得进入多 Agent。

交付物:

- `ComplexityGate`,根据任务长度、文件范围、风险、用户意图、工具需求和历史失败信号选择 `single-agent`, `role-routed`, `team-orchestrated`, `runbook-orchestrated`。
- `RunbookTemplate` schema,定义 intent、required roles、optional roles、task graph skeleton、verification policy、handoff rules、expected evidence。
- 5-10 个初始 runbook,优先覆盖代码评审、功能实现、安全检查、文档迁移、测试修复、研究总结等高频流程。
- runbook selection trace,让用户和开发者知道为什么选中或未选中某 runbook。

P2 边界:

- runbook 是结构化执行模板,不是长 prompt。
- Complexity Gate 不能阻止用户显式选择团队模板,但可以给出风险和成本提示。
- runbook 不能绕过 RoleContract、scheduler、schema gate 或 verifier gate。
- 不把 Agency agent 数量作为能力指标。

验收标准:

- 简单任务默认不进入多 Agent,避免额外成本和延迟。
- 高风险/多文件/跨领域任务能稳定进入 team/runbook orchestration。
- runbook 选中后生成的 task graph 可解释、可追踪、可被 verifier 检查。
- 每个内置 runbook 至少有一个 fixture eval。

测试与 eval:

- ComplexityGate classification table tests。
- RunbookTemplate validation tests。
- runbook-to-task-graph snapshot tests。
- selected/unselected reason trace tests。

### P3: Typed Blackboard 与 Bounded A2A

目标: 引入受控共享工作区,让多角色协作能共享中间事实、问题、冲突和证据,但不开放任意 agent-to-agent 群聊。

交付物:

- `OrchestrationBlackboard` typed entry model。
- entry 类型至少覆盖 `fact`, `claim`, `question`, `risk`, `decision`, `artifact`, `conflict`, `handoff`, `memory_proposal`。
- versioned append/update API,包含 authorRole、taskId、confidence、evidenceRefs、visibility、status。
- conflict detection 和 resolution policy。
- prompt injection defense,对来自 worker/外部内容的黑板条目标记 trust boundary。

P3 边界:

- blackboard 是受控数据结构,不是聊天室。
- worker 只能按授权 scope append/update 自己允许的 entry 类型。
- 不允许静默覆盖冲突;冲突必须保留双方版本和 resolver 决策。
- blackboard entry 不能自动变成长期记忆。
- blackboard 不授予新工具权限。

验收标准:

- 两个 role 对同一 claim 给出冲突结论时,系统生成 conflict entry,而不是覆盖旧值。
- verifier 能读取 blackboard evidence 并在报告中引用。
- prompt injection 文本进入 blackboard 后被标记为 untrusted content,不会进入系统级指令通道。
- blackboard 历史可由 trace 回放重建。

测试与 eval:

- typed entry validation tests。
- conflict merge tests。
- untrusted content propagation tests。
- trace replay reconstruction tests。

### P4: Synthesizer 与局部动态 DAG

目标: 在已验证的多角色结果之上,生成用户可读的统一答案,并允许在局部范围内细化 DAG,提升复杂任务完成质量。

交付物:

- `Synthesizer`,只消费 verified bundle、artifact refs、blackboard summary 和 verifier report。
- synthesis policy,规定哪些失败必须暴露给用户,哪些结果可以降级展示。
- local dynamic DAG refinement,只允许在当前 runbook/task graph 的授权边界内拆分或补充节点。
- UI dual-column result view: 左侧为最终综合结果,右侧为 evidence、role outcomes、verifier report 和 trace 摘要。

P4 边界:

- synthesizer 无工具权限。
- synthesizer 不能覆盖 verifier 的失败结论。
- dynamic DAG 不能新增未授权角色、未授权工具或绕过 max active roles。
- UI 不隐藏失败;失败可以折叠,但必须可见。

验收标准:

- 同一个 verified bundle 多次 synthesis 输出结构稳定,关键信息不丢失。
- verifier fail 时,synthesizer 输出明确失败和原因,不能包装成成功。
- dynamic DAG refinement 产生的新节点有来源、原因、scope 和 attempt 记录。
- UI 可展示每个角色贡献、证据和验证结论。

测试与 eval:

- synthesizer fixture tests。
- fail-preservation tests。
- local DAG refinement boundary tests。
- UI E2E,覆盖成功、失败、repair 后成功三种路径。

### P3-R / P4-R / P5: Runtime V2 后续分配

原 P3/P4 的阶段定义和完成审计保持不变。后续能力不以“补做旧阶段”的名义混入,而按 residual lane 和新增 P5 分配:

| 阶段 | 工作项 | 目标 | 阶段关系 |
| --- | --- | --- | --- |
| P3-R | `MA-P3-01` - `MA-P3-04` | `WorkPackage/v2` / `WorkResult/v2`、terminal-bound handoff、artifact provenance、context fault bridge、trust/replay/isolation hardening | 在原 P3 Typed Blackboard 上补协议,不开放 A2A |
| P4-R | `MA-P4-01` - `MA-P4-06` | 持久事件状态机、completion-driven DAG、adaptive admission、多维预算、cancel/recovery/idempotency、统一 policy profiles | 在原 P4 DAG 能力上建立统一 Runtime Kernel |
| P5 | `MA-P5-01` - `MA-P5-07` | Evidence Verifier 统一接线、条件质量趋势、Routing Memo v2、审计背压、可验证缓存、可选效率实验、controlled activation | 只消费已验证终态,保持 default-off/shadow-first |

完整依赖、主责生态位、交付物、验收、禁区和 CRAFT V2 取舍见:

- `docs/multi-agent-orchestration/runtime-v2-p3-p5-allocation.md`

后续关键顺序固定为:

```text
P3-R protocol contracts
  -> P4-R unified Runtime Kernel
  -> P5 evidence intelligence and controlled optimization
```

不得把三个阶段并成一个 mega PR。`MA-P5-06` 的 provider batch、Token CFS、Petri validator 不是默认关键路径,只有真实性能/公平性证据达到立项条件后才启动。

## 7. Agency Agents 吸收决策

Agency Agents 的价值很高,但进入 ClawX 的形态必须受控:

| Agency 内容 | 吸收方式 | 不能做的事 |
| --- | --- | --- |
| divisions.json | role catalog 分类、领域标签、路由 hint | 不能直接创建 active roles |
| specialized/agent prompts | draft role descriptions、capability hints、评审材料 | 不能绕过 RoleContract 成为 runtime prompt |
| tools.json | tool capability mapping 输入、权限建议 | 不能直接授予工具 |
| runbooks.json | RunbookTemplate 候选来源 | 不能作为长 prompt 直接执行 |
| handoff templates | RoleHandoffRules 和 blackboard handoff entry 模板 | 不能替代结构化 handoff |
| activation prompts | onboarding 文案、draft prompt hints | 不能写入系统提示绕过 contract |
| testing agents | verifier/eval scenario 灵感 | 不能成为唯一 verifier |

推荐迁移顺序:

1. 先导入 taxonomy 和 metadata,全部标记为 draft。
2. 对 draft 执行 RoleContract normalization 和 validation。
3. 建立人工/评审 gate,只把少量高价值角色提升为 reviewed。
4. reviewed 角色仍需显式进入 active registry 才可 spawn。
5. runbook 候选独立评审,不随角色自动启用。

## 8. 反模式清单

出现以下做法时应立即退回设计评审:

- 把 persona 当权限主体。
- 用 prompt template 替代 RoleContract。
- 把 Agency agent markdown 直接接到 runtime spawn。
- blackboard 冲突静默覆盖。
- worker 直接写长期记忆。
- synthesizer 调工具或修改 artifact。
- verifier 只靠 LLM 文本判断,没有 schema/evidence/trace 检查。
- 用 role 数量作为能力指标。
- 让多 Agent 默认处理所有任务,包括简单任务。
- renderer 绕过 host-api/api-client 直接访问 Gateway HTTP 或 IPC。
- 为了展示效果隐藏失败、权限拒绝或 repair 次数。

## 9. 长开发轮次执行规则

每个阶段开工前:

- 明确本阶段唯一目标和非目标。
- 如触及 backend communication、runtime send/receive、Gateway、host-api、api-client,先建立或更新 `harness/specs/tasks/` 下的 task spec。
- 运行 `pnpm harness context --spec <task-spec>` 获取最小阅读列表。
- 对涉及通信路径的改动,评审前运行 `pnpm run comms:replay` 和 `pnpm run comms:compare`。
- 对用户可见 UI 改动,补齐 `en` / `zh` / `ja` / `ru` i18n,并增加或更新 Electron E2E。
- 每次功能或架构行为变化后,检查 `README.md`, `README.zh-CN.md`, `README.ja-JP.md` 是否需要同步。

每个阶段评审包至少包含:

- 变更摘要。
- 修改文件列表。
- 新增或更新的类型/schema。
- 测试命令和结果。
- 至少一条成功 trace 和一条失败/拒绝 trace。
- 本阶段边界自检: 明确说明哪些非目标没有被偷偷实现。

## 10. 阶段 Review Gate

| Gate | 检查问题 | 阻塞条件 |
| --- | --- | --- |
| Architecture Gate | 是否仍以 RoleContract 为运行时中心 | 出现绕过 contract 的 runtime role |
| Security Gate | 权限是否 default deny 且 runtime enforce | prompt 或 UI 能授予真实权限 |
| State Gate | 状态写入者是否唯一且可追踪 | worker 能直接写 memory/task graph/trace |
| Evidence Gate | 输出是否能被证据、schema、trace 支撑 | verifier 只看自然语言 |
| Cost Gate | 是否控制并发、角色数和 repair 次数 | replan 无限或 max roles 可绕过 |
| UX Gate | 失败、拒绝、证据是否对用户可见 | UI 把失败包装成成功 |
| Docs Gate | 设计、README、harness spec 是否同步 | 行为变化无文档或无 spec |

## 11. 面临问题与解决方案

问题: Role Memory 体系较复杂,容易在早期拖慢主线。

解决方案: P0-P2 只坚持 worker 不能直接写长期记忆,并保留 Gatekeeper 提案路径;不扩大 memory taxonomy,先用 eval 证明提案质量。

问题: Agency Agents 数量大,容易诱导一次性导入。

解决方案: 只做 draft catalog 和 runbook 候选,默认不可 spawn;少量高价值角色通过 RoleContract validation 和人工 gate 晋级。

问题: 多 Agent 很容易变成不可解释的成本黑洞。

解决方案: Complexity Gate、ResourceAwareWaveScheduler、budget summary、max active roles、max-one repair 分阶段落地;P0 先限制 repair 次数并记录 trace。

问题: verifier 容易变成另一个“相信我”的 LLM。

解决方案: verifier 前置 schema gate 和 evidence gate;verifier 报告必须引用 evidenceRefs、roleOutcomes 和 traceIds。

问题: open A2A 会带来状态竞争和 prompt injection。

解决方案: P3 只引入 typed blackboard;entry 带 trust boundary、authorRole、evidenceRefs 和 version,冲突不覆盖。

## 12. 历史第一轮开发方案（已完成）

以下内容记录 P0 的原始切分,当前已完成,仅作为历史验收基线:

1. 定义 `OrchestrationResultBundle`、`RoleOutcome`、`VerificationReport`、`RepairSummary` 类型,补 schema/fixture 测试。
2. 实现 `SchemaComplianceGate`,在 verifier 前拒绝 malformed 或 evidence 缺失的 worker outcome。
3. 实现 `VerifierGate` 和 max-one repair/replan,确保第二次失败停止并返回解释性失败。
4. 把 gate 决策、权限拒绝、memory proposal、repair attempt 写入 trace/bundle,补 P0 eval 场景。

第一轮不做:

- Agency importer。
- 新调度器。
- 新 UI 面板。
- blackboard。
- synthesizer。
- 新长期记忆策略。

第一轮可交付判断:

- 一个正常通过的多角色运行可生成完整 bundle。
- 一个格式错误的 worker 输出被 schema gate 拒绝。
- 一个 verifier fail 的运行最多 repair 一次。
- 一个权限拒绝事件能在 trace 或 bundle 中看到。
- 一个 memory proposal 留在提案路径,没有直接落长期记忆。

当前后续开发不再从 P0 开始。应从 `docs/multi-agent-orchestration/runtime-v2-p3-p5-allocation.md` 中选择一个依赖已满足的 `MA-*` work item,先建立独立 task spec,再进入实现。默认第一个候选是 `MA-P3-01`,但 canonical Task Forest 仍须遵守 proposal -> 用户确认 -> apply,且当前产品开发 handoff 的 active node 优先级不由本文改写。

## 13. 给外部 AI 评审的问题

把本文交给其他 AI 评审时,建议重点让它检查:

- 全局硬约束是否足以防止 prompt/persona 绕过 RoleContract。
- 状态权威源是否还有多人写同一状态的漏洞。
- verifier 是否有足够非 LLM 的 schema/evidence/trace 支撑。
- Agency 吸收路径是否足够保守,是否会把 prompt zoo 变成 runtime zoo。
- P3-R 是否只补协议而没有暗中开放 A2A、memory write 或新权限。
- P4-R 是否真正统一 ordinary orchestration 与 Task Loop,而不是新增第二套状态机或 Supervisor 服务。
- P5 是否只消费 verified evidence,并保持 default-off、shadow-first、operator approval 和可回滚。
- P3-R -> P4-R -> P5 的依赖是否被 task spec 和测试强制,是否存在跨阶段抢跑。
- 预算、背压或历史质量信号是否可能静默降低 Strict 审计等级。
- 验收标准是否能被自动化测试或 eval fixture 证明。
