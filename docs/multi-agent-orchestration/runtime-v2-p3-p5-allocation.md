# Role-First Multi-Agent Runtime V2: P3-R / P4-R / P5 开发分配

> 文件性质: 后续开发分配与阶段毕业约束。
>
> 状态: 已分配,未实现。本文不会改变任何当前 runtime 行为,也不代表相关能力已经通过验收。
>
> 基线: 原 P0-P4 已完成并通过 `2026-07-08-role-first-completion-audit.md` 审计。本文使用 `P3-R`、`P4-R` 表示既有阶段之后的 residual lane,不重开或覆盖原 P3/P4。

## 1. 结论与架构取舍

能力补全是必要的,但 ClawX 不应照搬 CRAFT Runtime V2 的五平面和分布式 Agent Mesh。ClawX 的目标生态位仍然是:

> 本地优先、单用户负责、角色驱动、具有真实工具副作用的受控多智能体工作台。

因此后续建设围绕一个统一的 `Orchestration Runtime Kernel` 展开,复用现有 Orchestrator、Task Loop、Subagent Registry、Context Orchestrator、Evidence Verifier 与 Observability。Kernel 是状态和调度权威,不是新的常驻 Agent,也不是第二套 runtime service。

后续能力按三条责任线分配:

| 阶段 | 主责生态位 | 要解决的问题 | 不负责的事情 |
| --- | --- | --- | --- |
| P3-R | Runtime Protocol / Data Contract | 统一工作包、结果、handoff、上下文请求和 provenance | 不调度执行,不授予权限,不开放 worker chat |
| P4-R | Orchestration Kernel / Runtime Control | 建立持久、可恢复、completion-driven 的单一运行状态机 | 不做质量学习,不建立第二个调度服务 |
| P5 | Evidence Intelligence / Controlled Optimization | 以验证证据驱动审计、路由和有限效率优化 | 不自动改角色、模板、拓扑或审计硬约束 |

Independent Verifier / Security Reviewer 是跨阶段 review gate,不拥有运行状态。Operator UX 只在对应 runtime contract 稳定后接入,并遵守 i18n 与 Electron E2E 约束。

## 2. 阶段依赖

```text
P0-P4 completed baseline
  |
  v
P3-R: protocol and context completion
  MA-P3-01 -> MA-P3-02 ----+
       |          |         |
       +------> MA-P3-03    |
                  |         |
                  +----> MA-P3-04
                              |
                              v
P4-R: unified runtime kernel
  MA-P4-01 -> MA-P4-02 -> MA-P4-03 -> MA-P4-04
       |           |           |           |
       +-----------+-----------+------> MA-P4-05 -> MA-P4-06
                                                      |
                                                      v
P5: evidence intelligence and controlled optimization
  MA-P5-01 -> MA-P5-02 -> MA-P5-03
       |           |
       +------> MA-P5-04 -> MA-P5-07
       |
       +------> MA-P5-05 -> MA-P5-07
  MA-P5-06 starts only when measured evidence justifies an experiment
```

执行纪律是一次只推进一个 ready work item。不得把三个阶段合成一张 mega task,也不得为追求并行度让多个开发 Agent 同时改写同一 Kernel authority surface。

## 3. P3-R: 共享数据与上下文协议补强

P3-R 在已完成的 Typed Blackboard 之上补全工作包、handoff 和按需上下文协议。它不改变原 P3 的 blackboard 权限边界。

| ID | 依赖 | 开发分配 | 交付物 | 最低验收 |
| --- | --- | --- | --- | --- |
| `MA-P3-01` | P0-P4 baseline | 定义版本化 `WorkPackage/v2` 与 `WorkResult/v2` | 类型、validator、兼容适配、fixture、contract tests | 必须覆盖 run/graph/node/attempt、role/model/contractVersion、dependencies、scope、write-set、allowed tools、budget、evidence obligations、output schema 和 idempotency key;未知版本 fail closed |
| `MA-P3-02` | `MA-P3-01` | 建立 terminal-bound handoff 与 artifact provenance | `HandoffArtifact/v2`、digest/provenance、terminal-state binding、replay tests | 只有 terminal worker outcome 才能产生有效 handoff;artifact 必须可追到 producer、attempt、tool/evidence refs 和内容 digest;过期 attempt 的 handoff 不可推进下游 |
| `MA-P3-03` | `MA-P3-01`, `MA-P3-02` | 把 `context_fault` 接到现有 Context Orchestrator | 受控 request/response contract、权限和预算校验、trace events、failure taxonomy | worker 只能请求声明 scope 内的上下文;Runtime 决定是否服务;响应带 freshness、trust、redaction 和 provenance;拒绝/超预算可解释且不扩大工具权限 |
| `MA-P3-04` | `MA-P3-01` - `MA-P3-03` | 强化 replay、隔离与信任边界 | cross-run isolation、redaction、TTL/freshness、schema migration 与 replay fixtures | 不同 run/workspace 的数据不可串读;untrusted 内容不能进入系统指令通道;事件回放能重建等价 protocol state;敏感原始 payload 不进入持久证据 |

P3-R 明确禁止:

- 直接 worker-to-worker chat 或开放 mesh A2A。
- worker 直接写 Task Graph、长期记忆或运行状态。
- context request 隐式获得新工具、文件、网络或 memory 权限。
- 把完整 prompt、CoT、原始工具输出或未脱敏上下文作为 handoff 持久化。
- 新建与 Context Orchestrator 并行的上下文服务。

P3-R 毕业条件:

- 四个 work item 各有独立 task spec、contract tests 和拒绝路径 fixture。
- ordinary orchestration 与 Task Loop 可以消费同一版本化工作包,但本阶段不要求迁移它们的状态机。
- handoff、context response 和 artifact 均有 digest、provenance、trust、freshness 与 redaction 语义。
- P0-P4 的权限、blackboard、verifier 和 synthesizer 回归保持通过。

## 4. P4-R: 统一 Orchestration Runtime Kernel

P4-R 是能力补全的核心。目标不是再加一层 Supervisor,而是让 ordinary orchestration 与 Task Loop 逐步共用同一个持久状态权威、调度入口和恢复协议。

| ID | 依赖 | 开发分配 | 交付物 | 最低验收 |
| --- | --- | --- | --- | --- |
| `MA-P4-01` | P3-R graduated | 建立版本化 `OrchestrationRunState/v2` 和 append-only event state machine | state schema、event taxonomy、reducer、snapshot/replay、migration tests | run/graph/node/attempt/verifier/handoff/budget/cancel 状态只有 Kernel 可提交;同一事件流重放得到同一状态;未知/乱序/重复事件 fail closed 或幂等处理 |
| `MA-P4-02` | `MA-P4-01`, `MA-P3-02` | 把 DAG 改为 completion-driven | terminal transition、dependency release、verifier/handoff gate、pending-node projection | 下游只在依赖达到允许终态且有效 handoff/证据义务满足后进入 ready;ordinary orchestration 不再把 `pendingVerifier` 的运行包装成完成;失败、blocked、cancelled 可传播 |
| `MA-P4-03` | `MA-P4-02` | 建立 adaptive admission 与 backpressure scheduler | admission decision、lease model、queue metrics、reason codes | dependency、write-set/workspace lease、exclusive tools、provider limits、max active roles 与 verifier queue 都参与 admission;拒绝/排队原因可追踪;无饥饿的最小公平性 fixture |
| `MA-P4-04` | `MA-P4-01`, `MA-P4-03` | 将多维预算接入生产执行 | token/time/cost/effect/evidence budget ledger、reservation/settlement、budget events | 预算在 admission、执行、tool effect、verifier 与 repair 处真实扣账;估算和实际值分离;超预算只能暂停、缩范围、返回部分结果或请求追加预算 |
| `MA-P4-05` | `MA-P4-01` - `MA-P4-04` | 实现 cancel、recovery、idempotency 与 reconcile | restart recovery、orphan reconcile、lease expiry、duplicate suppression、crash fixtures | 进程重启后可从持久事件恢复;重复 completion/tool result 不产生重复副作用;取消传播到未开始节点;悬空 attempt 有确定 reconcile 规则 |
| `MA-P4-06` | `MA-P4-02` - `MA-P4-05` | 让 Quick / Governed / Strict 共用 Kernel | policy profile contract、default matrix、operator override audit、parity tests | 三种模式只改变 policy 参数,不分叉状态机;Strict 的证据/审批/审计要求不能因预算或背压自动降级;flag-off 和旧入口有明确兼容/回滚路径 |

P4-R 明确禁止:

- 新建四类常驻 Supervisor 或第二套 orchestration daemon/service。
- renderer、worker、verifier 或 synthesizer 直接写 Kernel state。
- 预算不足时静默降低 Strict 的审计、审批或证据等级。
- 为“自动恢复”重复执行不可幂等的真实工具副作用。
- 在 Kernel 内保存 CoT、完整 prompt 或无边界的工具原始输出。
- 在迁移完成前删除 ordinary orchestration 或 Task Loop 的旧权威路径;迁移必须有 shadow/parity/cutover/rollback 证据。

P4-R 毕业条件:

- ordinary orchestration 至少一个真实场景和 Task Loop 至少一个真实场景通过同一 Kernel state machine。
- completion-driven DAG 的 success/failure/blocked/cancelled/recovery 全路径可回放。
- admission、预算、backpressure、cancel 和 repair 都产生结构化 reason code 与 trace。
- crash-after-effect、duplicate-event、stale-handoff、lease-conflict 和 verifier-overload fixture 全部通过。
- Quick / Governed / Strict 的差异可以由 policy snapshot 解释,不存在隐藏分叉。

## 5. P5: 证据智能与受控优化

P5 接续已有 `harness/specs/tasks/phase-5-evidence-verifier*.md` 和 `runtime-core/evidence-verifier*` 工作。现有 default-off / shadow 约束保持有效;在 P4-R Kernel 接线完成前,它不能成为 ordinary orchestration 的 active completion gate。

| ID | 依赖 | 开发分配 | 交付物 | 最低验收 |
| --- | --- | --- | --- | --- |
| `MA-P5-01` | P4-R graduated, P3-R contracts | 把 Evidence Verifier 纳入统一 orchestration evidence contract | evidence obligation/ref/decision adapter、shadow producer、parity report | completed/failed/blocked/cancelled/insufficient_evidence 语义与 Kernel 一致;flag off 零行为变化;shadow 不影响 completion |
| `MA-P5-02` | `MA-P5-01` + 稳定样本 | 建立质量趋势与置信度校准 | cohort metrics、calibration report、drift/trend alerts | 只按 `role + model + contractVersion + domain + toolset` 等条件 cohort 评估;声明置信度与验证结果分离;低样本不做自动决策 |
| `MA-P5-03` | `MA-P5-02` | 扩展 `Routing Memo v2` | evidence-qualified memo、shadow comparison、expiry/rollback、activation gate | 不新建信息素库;只消费已验证终态;保持 `off -> shadow -> active`;memo 不能授予角色、工具或模板权限 |
| `MA-P5-04` | `MA-P4-03`, `MA-P5-01` | 建立审计队列、背压与 SLO | queue depth/age、service class、sampling policy、overload decision | 审计过载能反向影响 admission;Strict 不被抽样或降级;队列年龄、丢弃、超时和人工升级可观测 |
| `MA-P5-05` | `MA-P3-02`, `MA-P5-01` | 建立可验证结果缓存 | tool-result/artifact cache contract、digest、TTL、invalidation、cache evidence | 只缓存可验证的幂等工具结果和带 digest 的 artifact;命中仍保留来源与 freshness;不缓存 CoT、完整 LLM 交付物或授权决策 |
| `MA-P5-06` | `MA-P4-04`, `MA-P5-04` + 瓶颈证据 | 运行可选效率实验 | provider batch、Token CFS、Petri validator 的独立 experiment specs | 只有 deep-test/trace 证明真实瓶颈后才立项;每个实验独立 flag、基线、退出标准和 rollback;不得先建基础设施再找问题 |
| `MA-P5-07` | `MA-P5-02`, `MA-P5-03`, `MA-P5-04`, `MA-P5-05` | controlled activation 与 operator governance | graduation scorecard、approval、kill switch、rollback drill、audit trail | 每项优化独立毕业;shadow 样本和质量/成本/延迟指标达标;operator 明确批准后才能 active;可在不迁移数据的情况下关闭 |

P5 明确禁止:

- 单一 reputation 总分驱动路由、权限、预算或审计等级。
- 自动拓扑演化、自动模板生成、自动角色定义修改或自动权限扩张。
- 用 Routing Memo、趋势分数或缓存结果绕过 evidence/verifier gate。
- 把 LLM judge 的自然语言意见当作唯一完成判据。
- 因队列压力、成本或历史声誉自动降低 Strict。
- 在没有真实瓶颈证据时默认启用 batch、Token CFS 或 Petri runtime validator。

P5 毕业条件:

- Evidence Verifier 先经过 default-off parity、shadow quality review 和有限 controlled pilot,每一步都有 rollback。
- 趋势/校准结果包含样本量、置信区间或等价不确定性表达,且能区分模型、契约和工具集漂移。
- Routing Memo v2 active 前证明相对 baseline 的成功率不下降,权限/成本/延迟不突破预算。
- 审计队列过载、缓存陈旧、错误 memo 和 kill-switch 演练均有失败 fixture。
- 任何自动参数调整都可解释、有限界、可关闭;结构性修改仍需人工决策。

## 6. 对 CRAFT Runtime V2 的吸收与调整

| CRAFT V2 能力 | ClawX 决策 | 调整后的落点 |
| --- | --- | --- |
| 工作包、结果包、上下文请求 | 吸收 | P3-R 版本化 protocol,由 Runtime 校验 scope、权限、budget 与 provenance |
| 不可变事件日志、可恢复状态 | 吸收 | P4-R Kernel 的 append-only events + deterministic reducer,不另建底层平面 |
| Supervisor 层 | 调整 | 规则能力进入 Kernel scheduler/admission;不创建常驻 LLM Supervisor 或新的状态权威 |
| Agent Mesh | 调整 | 复用本地 Subagent Registry、Task Loop 和 Orchestrator;不建设分布式 peer mesh |
| 审计背压、分级交付 | 吸收并收紧 | P4-R admission + P5 audit queue;Strict 永不因预算或拥塞自动降级 |
| 三维预算 | 扩展 | P4-R 使用 token/time/cost/effect/evidence 多维 ledger,统一 reservation/settlement |
| 置信度校准、趋势监控 | 吸收 | P5 以条件 cohort 和验证终态计算,低样本只报警不自动干预 |
| 声誉注册表 | 不单独建设 | 用条件质量指标和现有 evidence/trace;禁止单一全局 reputation score |
| 路径信息素库 | 替换 | 扩展现有 Routing Memo,保持 `off -> shadow -> active` 和 operator gate |
| 语义缓存 | 收窄 | 只缓存可验证工具结果和 digest artifact,不缓存 CoT 或完整生成式交付物 |
| Batch / Token CFS | 延后实验 | 只有 provider 和公平性瓶颈被真实指标证明后进入 `MA-P5-06` |
| Petri 网验证器 | 延后实验 | 优先作为离线 graph/runbook validator,不先进入 runtime hot path |
| 直接 A2A、自动结构演化 | 拒绝 | 保持 `none` / `lead_mediated`、typed blackboard 与人工结构变更 |

## 7. 开工顺序与交付纪律

推荐顺序:

1. `MA-P3-01` -> `MA-P3-02` -> `MA-P3-03` -> `MA-P3-04`。
2. `MA-P4-01` -> `MA-P4-02` -> `MA-P4-03` -> `MA-P4-04` -> `MA-P4-05` -> `MA-P4-06`。
3. `MA-P5-01` -> `MA-P5-02` 与 `MA-P5-04` -> `MA-P5-03` 与 `MA-P5-05` -> `MA-P5-07`。
4. `MA-P5-06` 不在默认关键路径上,只由测量结果触发。

每个 work item 开工前必须:

- 新建或更新独立 `harness/specs/tasks/` task spec,列出 owned paths、required rules、required tests、flags 和 rollback。
- 运行 `pnpm harness context --spec <task-spec>` 获取最小阅读集。
- 对 backend communication 变更引用 `gateway-backend-communication`,并在评审前运行 comms replay/compare。
- 为状态迁移、runtime 接线或 active 决策提供 `off -> shadow -> controlled active` 证据;不能直接 default-on。
- 功能/架构变化后检查三语 README;用户可见变化必须补四语 i18n 与 Electron E2E。
- 在 Task Forest 中一次只激活一个 ready 节点。本文只是 work breakdown;canonical graph 仍按 proposal -> 用户确认 -> apply 流程更新。

## 8. 总体验收

Runtime V2 能力补全只有同时满足以下条件才可称为完成:

- ordinary orchestration 和 Task Loop 共用一个持久、可恢复的 Kernel state authority。
- DAG 由真实 completion、verifier、handoff 和 evidence 事件推进,而不是一次 wave dispatch 完成即返回成功。
- 资源、provider、工具、workspace lease、预算和审计背压都进入同一 admission 决策。
- context fault、cancel、restart、duplicate event、stale artifact 和 budget exhaustion 都有确定、可回放的终态。
- 质量学习只消费已验证证据,先 shadow,可回滚,不授予权限,不改变结构。
- UI 能向 operator 解释状态、证据、预算、排队、降级/暂停原因和 rollback 状态。

在这些条件未满足前,对外只能表述为“Runtime V2 后续能力正在分阶段建设”,不能宣称 joint-system GA。
