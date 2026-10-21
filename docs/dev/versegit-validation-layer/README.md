# VerseGit 作为 ClawX 并发工作区控制面

> 状态：WP9 已完成 whole-goal 工程验收，结论为 `PASS_WITH_GAPS`；非 GA、默认关闭、landed-unwired，`releaseEligible=false`。
> 日期：2026-10-22。
> 本文取代“VerseGit 只是一个可选的符号级验证插件”的单点描述；它不改变任何产品锁、默认值或发布状态。深度设计位于 `harness/specs/guides/versegit-concurrency/`，README 作为稳定入口。

## 1. 结论

VerseGit（VG）在 ClawX 中的正确定位是：

**宿主管理的、按并发条件激活的仓库事实与候选控制面。**

它负责回答：

- 哪个 Agent 会话在哪个 worktree、基于哪个 revision 做了什么；
- 多个候选是否在文本、语法、符号依赖和验证层面相互破坏；
- 某个候选的读依据、验证事实、风险和证据是否仍然新鲜；
- 若未来获准，一个精确候选能否以 CAS 和完整溯源被发布。

它不负责：

- 取代 Git、Jujutsu 或 ClawX 的 worktree；
- 决定任务图、Agent 分配、审批、shell 解释或测试执行；
- 取代 ClawX 的 write journal、Task Ledger、ClawGraph 或 harness 判定；
- 用一次“冲突为零”声明证明系统安全；
- 在宿主模式下隐式启用 `vg land` / `vg admit`。

因此，VG 是**中间件**，但不是新的基础设施底座。它是 worktree 之上的一层并发语义与证据协调面。

## 2. 为什么不能继续把它写成单一“验证层”

单场景描述只覆盖了 VG 的一个输出：符号级冲突事实。VG 当前已经具备并验证了六类工作流：

| 工作流 | VG 能力 | 在 ClawX 中的默认角色 |
| --- | --- | --- |
| workspace | 身份、物化、恢复、陈旧工作副本处理 | 附着到宿主已有 worktree |
| change edit | tree、父关系、diff、materialize | 只读分析或宿主显式调用 |
| history recover | operation、backup、restore | 证据重放与恢复来源 |
| validation admission | verify、basis、verdict | 向宿主提供事实与建议 |
| candidate landing | candidate、CAS、report | 默认关闭；未来另行决策 |
| external publish | git/gerrit/remote | 不在本模块范围 |

如果把完整独立产品直接塞进 harness，会同时产生两个任务图、两个执行器、两个审批面、两个写日志和两个落地权威。这不是“深度集成”，而是所有权冲突。

正确做法是保留 VG 的完整 standalone 工作流，同时提供一个窄的 **host module mode**：

- 复用同一套 Rust 内核、schema、账本和检测能力；
- 由 ClawX 控制生命周期、权限、任务、执行和用户可见性；
- 由 VG 输出仓库语义事实、候选身份、风险与可复查证据；
- 所有跨系统边界都有版本、身份、失败姿态和证据格式。

## 3. 核心心智模型

并发代码库不是“一个目录 + 多个分支”，而是五个相互关联的对象：

```text
Workspace -> Session -> Snapshot -> Candidate -> Verdict/Land
   |            |          |           |              |
 repo_id     agent_id    tree_id     candidate_id    evidence_id
             worktree    base_oid    parents          run_id
```

各代理目前主要解决第一层：

- worktree 隔离文件写入；
- session/chat 绑定一个 worktree；
- 会话内 checkpoint 或清理前快照；
- 最后由普通 Git/PR 合并。

VG 需要补的是第二层和第三层：

- 语义快照：读集、写集、符号变化、依据回执；
- 集成快照：多个候选组合后的 next tree / candidate tree；
- 证据快照：验证命令、输入哈希、执行者、结果、清理与新鲜度。

**worktree 不是语义快照；checkpoint 也不是完整系统快照。** 这三类“版本”必须分别命名、分别绑定、分别失效。

## 4. 权威矩阵

| 平面 | 唯一权威 | VG 可以做什么 | VG 不可以做什么 |
| --- | --- | --- | --- |
| 用户意图与审批 | ClawX UI / host approval plane | 提供风险事实 | 自行批准、修改产品锁 |
| 任务与调度 | ClawX orchestrator / Task Ledger / ClawGraph | 提供隔离建议、冲突事实 | 替换任务图或调度器 |
| 文件与进程执行 | VerseShell governed ACI | 产生结构化 command plan | 在宿主模式下私起第二个执行器 |
| 工作区变更日志 | ClawX write journal | 观察已发生的写、做候选分析 | 取代 undo/recovery 权威 |
| 仓库语义事实 | VG ledger / receipts | 追加本域事实、维护派生投影 | 写成 ClawX 任务状态 |
| harness 判定 | harness task spec / profile / evidence | 作为辅助证据和 residual | 用 `admitted` 改写 pass/fail |
| 项目开发历史 | Task Forest | 记录关联任务或来源 | 成为第二套任务真源 |
| Git 落地 | ClawX/宿主 Git；未来可选 VG broker | 生成精确候选与证据 | 默认接管 commit/ref |

这张表是模块设计的核心。VG 可以在自己的域内拥有强权威，但跨域只能通过显式契约传递事实。

## 5. 四种模块模式

| 模式 | 名称 | 效果 | 默认 |
| --- | --- | --- | --- |
| M0 | disabled | 不启动、不附着、不产生事件 | 是 |
| M1 | diagnostic | 只读 `capabilities` / `doctor` / `conflicts` / `integration_status` | 否 |
| M2 | advisory | 宿主事件接入 + next-tree / candidate 风险事实 | 否 |
| M3 | candidate | 由 VerseShell 执行固定验证计划，VG 只消费回执并给出 verdict facts | 否 |
| M4 | broker | 可选 CAS 落地权威，需单独架构与产品决定 | 不在本设计范围 |

本设计只授权实现 M1-M3 的边界；M4 必须另立任务，不能通过一个 flag 或 adapter 默认获得。

## 6. 生命周期总览

```text
discover -> eligible -> attach -> observe -> evaluate
    -> candidate -> verify_facts -> host_decision
    -> land_by_host | abandon -> report -> retain -> detach -> retire
```

关键规则：

- 没有并发证据时不启动；
- 没有二进制身份与 schema 兼容时只报告 unavailable；
- 没有明确 workspace/root/owner 时不附着；
- 没有覆盖声明时 `no conflict observed` 不能写成 `no conflict exists`；
- 没有 VerseShell 回执时验证状态是 `unmeasured`，不是 `passed`；
- 宿主决定后才可落地；
- 清理先封存证据，再移除临时对象；
- 任何失败都不得隐式降级到第二个执行器或第二个 gate owner。

完整状态机、阶段门槛和失败矩阵见
[`harness-lifecycle-and-contracts.md`](../../../harness/specs/guides/versegit-concurrency/harness-lifecycle-and-contracts.md)。

## 7. 当前事实基线

2026-10-22 的 WP6 收口只陈述盘上可回读事实：

- MC0-MC5、WP0-WP5 共 12 个必需门禁均已闭合；WP6 复算 12 份 tracked evidence manifest、78 条摘要记录（77 个唯一文件），并在本地存在时额外核对 12 份 artifact mirror manifest；干净检出不依赖 ignored artifacts；凭证模式扫描 85 个 retained files，0 hits；
- `concurrency-aux` 是显式 opt-in profile，不在 `fast`、`comms` 或隐式默认中；单 worktree/单 session 仍为 0 次 VG 调用；
- host adapter、observation bridge、VerseShell structural receipt bridge 和 behavior coverage 均已落地；host verdict 始终独立；
- WP3 没有执行 live host-authoritative VerseShell receipt，只证明了 plan/receipt 绑定与拒绝矩阵；
- WP7 已在 disposable host-shaped vertical slice 中执行真实 VerseShell candidate verification，并在错误 receipt 被拒后完成 continuation；这仍不是完整产品 M3 或真实模型会话闭环；
- 当前 CLI 没有纯 `conflicts-plan` seam，完整 conflict-plan 仍为 `unavailable`；
- WP5 的 3 轮双 worktree replay 使用真实 disposable Git worktree，但 VG process calls 为 0，不能冒充真实 agent→VG 工具闭环；
- provider source 当前 dirty，只有 debug sidecar；MC0/MC3 保留 `source_worktree_dirty`、
  `not_a_deliverable_baseline`、`release_binary_not_built`；
- shell read、direct filesystem、arbitrary MCP、network/browser 仍为 unobserved/partial；`.mjs/.jsx/.sh` 为 partial，其他语言 unverified；
- 执行证据仅覆盖 `win32-x64`；Linux/macOS 未跑；
- M4 CAS landing broker 未授权，`vg land` / `vg admit` 不在默认宿主路径。

2026-10-22 的 WP7/WP8/WP9 收口进一步确认：

- WP7 在 disposable host-shaped Windows vertical slice 中完成了 host-owned fixed-argv VG facts、真实 producer-consumer、VerseShell-only candidate verification、file-backed receipt authority、failure-before-continuation 与零 survivor 清理；
- WP8 由独立 `ccs-hub/gpt-6.1-sol` agent 给出 `PASS_WITH_GAPS`，`P0=0`、`P1=0`、`P2=3`；初版 `ccs-agentrouter/gpt-6.1-sol` FAIL 与后续 provider 403/high-demand 失败均保留；
- WP9 将 TF-0465 的七条 acceptance 逐项映射到盘上证据，并确认 18 个非 WP9 必需子节点均 `done` 或显式 `deprecated`；
- WP9 实现由独立 `ccs-hub/gpt-6.1-sol` 复核为 `PASS_WITH_GAPS`，`P0=0`、`P1=0`；主审 `ccs-agentrouter/gpt-6.1-sol` 的 403 quota 失败保留为 provider evidence，不构成 verdict；
- WP9 最终结论仍是 bounded `observed`，不是外部模型会话、完整产品 M3、GA 或 M4；P2 与平台、语言、读面、release、conflicts-plan 和 recovery 边界全部保留。

因此当前定位是：**host module 工程路径已闭合、产品未批准、默认未启用、发布不可用**。`passed` 只表示证据与边界可复现，不表示 GA。

## 8. 与 VerseShell 的关系

VerseShell 是执行面，VG 是仓库语义与证据面：

```text
ClawX orchestrator
  -> asks VG for facts / plan
  -> asks VerseShell to execute immutable argv
  -> returns host-authoritative execution receipt to VG
  -> harness consumes both receipts and host verdict
```

VG 在 standalone 模式可以保留自己的 bounded executor。进入 ClawX host mode 后，candidate verification、用户代码、测试和 build 统一由 VerseShell governed ACI 执行并产生 host-authoritative receipt；M1/M2 的 VG session/observe/check 仓库事实走 host-owned typed fixed-argv adapter，只允许写 VG provider-domain state，且不能把事实升级为 verified。该适配器不是第二个 verifier 或第二个 harness authority。

详细契约见
[`verseshell-and-behavior-observability.md`](../../../harness/specs/guides/versegit-concurrency/verseshell-and-behavior-observability.md)。

## 9. 外部对照

调研结论、来源和比较矩阵见
[`cross-agent-concurrency-research-2026-10-21.md`](../../../harness/specs/guides/versegit-concurrency/cross-agent-concurrency-research-2026-10-21.md)。

一句话概括：

- Claude Code：会话/子代理 worktree + session-local checkpoint；
- Codex：managed worktree、detached HEAD、handoff、清理前快照与恢复；
- Pi：核心是可扩展会话运行时，worktree 主要由生态扩展绑定 task/session；
- Jujutsu：operation log、自动 working-copy 快照、stale workspace；
- 它们擅长“隔离与恢复”，但没有替 VG 完成跨会话语义依赖和候选证据。

## 10. 实施路线

实施拆为 WP0-WP9；当前 WP0-WP6、WP7 bounded live slice、WP8 独立审查与 WP9 全局聚合的工程证据链已生成。Task Forest 状态只由独立 proposal 在盘上证据复核后同步。这不改变默认关闭或产品锁：

- WP0：契约与二进制身份；
- WP1：宿主事件到 VG 的观测桥；
- WP2：只读 `concurrency-aux` profile 与 evidence pack；
- WP3：VerseShell execution receipt 结构桥和拒绝矩阵；
- WP4：行为覆盖向量、缺口语义与反馈送达等级；
- WP5：双 worktree replay、soak 和故障矩阵；
- WP6：聚合 WP/MC 证据、MC7 退役职责与可选 MC6 `sidecar-only` 决策；
- WP7：真实宿主纵向切片、故障清理与 continuation；
- WP8：独立 agent 终审与偏差闭合；
- WP9：TF-0465 七条 acceptance 的最终聚合与非 GA 生命周期收口。

WP6 的最终报告、manifest 与 checksum 位于 `artifacts/versegit/wp6/`；MC6 决策位于 `artifacts/versegit/mc6/`；WP9 的全局报告、manifest 与 checksum 位于 `artifacts/versegit/wp9/`。发布、default-on、`land/admit` 或 M4 所有权变更都需要另立任务，不能由本期证据自动升级。

每阶段的入口、门槛和停止条件见
[`implementation-roadmap-and-acceptance.md`](../../../harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md)。

## 11. Go / No-Go

> 当前产品状态：M1 与 bounded M2/M3 host slice 已有证据，但完整产品 M3 未验收且 release-ineligible；M4 未授权。下面的清单是产品启用前置，不代表当前已经启用。

**允许进入 M1：**

- VG 二进制与 schema 可验证；
- 只读查询有上限、可超时、失败不改变 harness 结果；
- 报告能区分 `unavailable`、`partial`、`observed`；
- 不修改用户工作树。

**允许进入 M2：**

- ClawX 真实并发会话能产生稳定的 session/worktree/trace 绑定；
- 至少一个真实 producer-consumer 变更被 VG 命中，且有人工/agent 可回读的反向样例；
- VG 结果只进 residual/advisory 区；
- 缺观测时明确标 unknown。

**允许进入 M3：**

- candidate verification、用户代码、测试和 build 都经 VerseShell；
- M1/M2 VG 仓库事实只经 typed fixed-argv host adapter，不允许任意 argv/shell 字符串；
- VG 不再在宿主模式自行执行验证；
- selected 结果永远不能升级为 full；
- 执行回执、argv、exit、超时、清理和输入哈希可复查。

**不授权：**

- default-on；
- `vg land` / `vg admit` 默认接入；
- 用 VG 的 admitted 替换 harness pass/fail；
- 把 `declare_intent` 暴露给未授权模型；
- 以 M1/M2 的实现声明 M3/M4 完成。

## 12. 相关文档

- [跨代理并发调研](../../../harness/specs/guides/versegit-concurrency/cross-agent-concurrency-research-2026-10-21.md)
- [Harness 生命周期与权威契约](../../../harness/specs/guides/versegit-concurrency/harness-lifecycle-and-contracts.md)
- [VerseShell 与行为观测](../../../harness/specs/guides/versegit-concurrency/verseshell-and-behavior-observability.md)
- [实施路线与验收](../../../harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md)
- [WP9 生命周期收口](../../../harness/specs/guides/versegit-concurrency/wp9-lifecycle-closeout.md)
- [防重写迁移控制计划](../../../harness/specs/guides/versegit-concurrency/versegit-migration-control-plan.md)
- [规划修正矩阵](../../../harness/specs/guides/versegit-concurrency/versegit-planning-correction-matrix.md)
- [规划修正 task spec](../../../harness/specs/tasks/versegit-module-planning-correction.md)
- ClawX 规则：`harness/specs/rules/versegit-validation-layer-extension-boundary.md`
- ClawX 场景：`harness/specs/scenarios/versegit-validation-layer-extension.md`
- VG 宿主适配说明：VerseGit 仓库 `docs/integration/clawx-harness-module-lifecycle-2026-10-21.md`
