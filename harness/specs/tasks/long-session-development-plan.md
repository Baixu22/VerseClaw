---
lifecycleStatus: active
id: long-session-development-plan
title: 长期会话连续工作开发合同与节点索引
taskType: planning
program: long-session-development-20261022
intent: 把已证据化的会话生命周期能力组合为单工作区长期协作闭环，保存六阶段、十六执行节点的依赖与可自动验收合同，不将规划创建作为功能完成或默认推广。
requiredRules:
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - identity-scope-boundary
requiredProfiles:

touchedAreas:
  - harness/specs/tasks/long-session-development-plan.md
  - harness/specs/tasks/long-session-baseline-contract.md
  - harness/specs/tasks/long-session-lifecycle-barrier.md
  - harness/specs/tasks/long-session-effective-policy.md
  - harness/specs/tasks/long-session-policy-surface.md
  - harness/specs/tasks/long-session-coordinator-binding.md
  - harness/specs/tasks/long-session-delegation-admission.md
  - harness/specs/tasks/long-session-completion-continuation.md
  - harness/specs/tasks/long-session-coordination-surface.md
  - harness/specs/tasks/long-session-continuity-context.md
  - harness/specs/tasks/long-session-paired-evaluation.md
  - harness/specs/tasks/long-session-continuity-decision.md
  - harness/specs/tasks/long-session-followup-scheduling.md
  - harness/specs/tasks/long-session-resource-reclamation.md
  - harness/specs/tasks/long-session-restart-journeys.md
  - harness/specs/tasks/long-session-long-use-budget.md
  - harness/specs/tasks/long-session-final-acceptance.md
expectedUserBehavior:
  - 后续 agent 从当前 Task Forest 选一个 ready leaf，经对应合同的 context、实现与盘上验收持续推进。
  - 长期会话复用现有 Assistant、Task Ledger、session lifecycle、权限与调度 owner，普通 Chat 和产品冻结默认值不自动改变。
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/long-session-development-plan.md
  - git diff --check
executionSpecs:
  - harness/specs/tasks/long-session-baseline-contract.md
  - harness/specs/tasks/long-session-lifecycle-barrier.md
  - harness/specs/tasks/long-session-effective-policy.md
  - harness/specs/tasks/long-session-policy-surface.md
  - harness/specs/tasks/long-session-coordinator-binding.md
  - harness/specs/tasks/long-session-delegation-admission.md
  - harness/specs/tasks/long-session-completion-continuation.md
  - harness/specs/tasks/long-session-coordination-surface.md
  - harness/specs/tasks/long-session-continuity-context.md
  - harness/specs/tasks/long-session-paired-evaluation.md
  - harness/specs/tasks/long-session-continuity-decision.md
  - harness/specs/tasks/long-session-followup-scheduling.md
  - harness/specs/tasks/long-session-resource-reclamation.md
  - harness/specs/tasks/long-session-restart-journeys.md
  - harness/specs/tasks/long-session-long-use-budget.md
  - harness/specs/tasks/long-session-final-acceptance.md
acceptance:
  - 本地现有任务图增加一个长期会话目标、六个阶段、十六个执行节点和一个规划记录；新节点均有唯一主父、完整 sibling order 和无环依赖。
  - 十六份执行合同各有目的、当前 source anchor、负向验收、待交付测试、可回读 artifact 与独立收口要求；只有 A1 是本 lane 的初始 ready 执行 leaf。
  - 已有 TF-0482、TF-0493、TF-0497、TF-0498、TF-0510、TF-0512 和历史 TF-0077/TF-0370/TF-0424 不被本提案改状态、进度或证据；已有依赖由其工作流完成。
  - proposal 保存与应用遵守 base_graph_hash，随后 validate/export 和按 ID 回读确认；所有开发节点保持未完成，不用历史 PASS 代替新产品验收。
  - 本次只交付规划与合同；所有后续验收可由 agent 自动执行，重大产品锁/默认/独立 Project/公开发布决定有明确边界。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**长期会话连续工作开发规划**

目标是让一个明确 Workspace/Assistant 的稳定主会话持续承接工作，安全委派、汇总结果，在压缩、交接、UI 关闭及重启后恢复，并按资源 owner 的既有合同暂停、取消与回收。最小范围是 Windows 本地、单工作区、明确选择长期协作的闭环。Project 继续使用 Workspace 的兼容投影，不新建独立 Project store、任务数据库、云执行平台或常驻 daemon。

本文件保存可维护的合同；Task Forest 是本地节点状态和执行依赖真源，不复制进度。创建合同、保存提案、静态验证或 dry-run 只证明规划成立，不能宣称功能已实现。规划记录与十六个开发节点分开；即使规划记录 done，目标开发进度仍为零。

**六个阶段**

- **阶段一：统一会话动作并建立故障基线**：先固定逻辑会话、原生后端和资源的关系，让归档与恢复有可拒绝、可回读的生命周期保障。
- **阶段二：让会话配置与实际运行状态可见**：在现有入口说明当前后端、配置来源、授权、预算和不可用原因，复用已有模型生效能力事实。
- **阶段三：交付单工作区长期协调入口**：复用稳定 Assistant 和 Task Ledger，完成任务委派、接收回执、结果汇总与主会话续接。
- **阶段四：保持上下文连续性并评测策略**：消费唯一记忆与上下文控制面，测量跨压缩、交接和重启的关键事实保真度，再决定是否采用新策略。
- **阶段五：接通跟进调度与资源退出**：复用 Cron、Workboard 和各资源 owner，使暂停、取消、过期和重启不会产生重复执行或失控资源。
- **阶段六：完成长程自动验收与声明收口**：用跨重启旅程、长期加载和资源测量证明闭环，并将代码、配置、模型自述和验收范围对齐。

**执行顺序与既有依赖**

| 任务 | 交付 | 前置 | 执行合同 |
| --- | --- | --- | --- |
| A1 | 固定长期会话身份、动作合同与故障基线 | 当前基线与本计划记录 | [合同](./long-session-baseline-contract.md) |
| A2 | 让归档、还原与删除共享安全生命周期屏障 | A1 | [合同](./long-session-lifecycle-barrier.md) |
| B1 | 生成会话生效配置快照并区分原生后端 | A2, TF-0512 | [合同](./long-session-effective-policy.md) |
| B2 | 在现有会话入口展示配置来源和运行限制 | B1 | [合同](./long-session-policy-surface.md) |
| C1 | 绑定稳定主会话、任务引用与长期工作范围 | B2 | [合同](./long-session-coordinator-binding.md) |
| C2 | 按授权和隔离规则委派独立会话并记录接收回执 | C1, TF-0510 | [合同](./long-session-delegation-admission.md) |
| C3 | 汇总子会话完成事件并在主会话空闲时幂等续接 | C2 | [合同](./long-session-completion-continuation.md) |
| C4 | 把长期协作入口接到现有会话、任务与活动界面 | C3 | [合同](./long-session-coordination-surface.md) |
| D1 | 从唯一记忆控制面读取已接受事实与会话交接依据 | C4, TF-0493, TF-0497, TF-0498 | [合同](./long-session-continuity-context.md) |
| D2 | 配对评测长期连续性的保真度、时延与费用 | D1 | [合同](./long-session-paired-evaluation.md) |
| D3 | 依据配对证据选定连续策略并保持冻结默认 | D2 | [合同](./long-session-continuity-decision.md) |
| E1 | 把定时跟进绑定到长期会话并统一取消规则 | D3 | [合同](./long-session-followup-scheduling.md) |
| E2 | 治理长期会话的工作树、终端、浏览器与后台资源 | E1, TF-0510 | [合同](./long-session-resource-reclamation.md) |
| F1 | 用自动化跨重启旅程验证长期协作闭环 | E2 | [合同](./long-session-restart-journeys.md) |
| F2 | 测量长会话加载、常驻资源与通知预算 | F1 | [合同](./long-session-long-use-budget.md) |
| F3 | 聚合独立验收、能力声明与后续推广边界 | F2 | [合同](./long-session-final-acceptance.md) |

每个后续 leaf 依赖前一个 leaf；阶段首次任务另依赖上一阶段验收。一次只执行当前 lane 的一个 ready leaf，阶段标准全满足并读盘后才收口其 milestone，不以局部绿灯自动开始下一阶段。

B1 消费 TF-0512 的 current runtime capability facts。B2 在 Chat 活动栏与 Settings > Recovery 复用同一 `SessionActivity.policy` projection；policy-only quiet session 仍可从现有入口进入，读取会随 workspace、session、permission mode、模型/agent backend 和 Gateway 世代变化而失效重读，不能把旧 scope 快照冒充当前事实。C2/E2 以真实 Git checkout/写集隔离或明确安全串行完成自有边界，也可复用 TF-0510 若其后续工作流提供；D1 消费 TF-0493/TF-0497/TF-0498 的唯一 context/memory 控制面。已有节点的内部化、退役或 explicit unavailable 也是有效结果，后续应做真实 fallback，不复活被退休模块，不再造同一 owner。

新目标服务现有 TF-0001 全局目的，与 TF-0482 是分开的交付 lane；不重开 deprecated TF-0010，不改历史 TF-0077/TF-0370/TF-0424 的验收或默认值。只用非阻塞 related_to 记录横向关系；不能通过本规划给其它在途工作加新义务。

C1 把协调绑定保存在现有 Workspace store 的 `WorkspaceProfile.coordinatorBinding`：只记录已选 Assistant、逻辑 SessionKey、物理 sessionId、Task Ledger node refs、revision 与失效原因。它不自动从普通 Chat 建立，也不拥有任务状态；删除/archive 直接失效，reset 在读取时通过 physical generation 差异失效。C2 在同一 Workspace store 的子项中保存 bounded `DelegationAdmissionReceipt/v1` journal，按 idempotency key/request digest 复用既有 `orchestrator.run`、role spawn、scheduler 与 worktree/inprocess isolation；accepted 仅是 admission，child run 完成和 Task Ledger 状态仍由各自 owner 维护。C4 才提供用户可见的长期协作入口。

**已有实现与需要补的路径**

- 会话、run、provider thread 与 resource 分属已有 owner，当前 identity-scope/product semantics 是起点。
- actual Chat 行为由 src/stores/chat.ts 主 store 实现；旧拆分模块同名函数不是自动可信 caller。
- 归档当前直接改 transcript/index，delete 等待 runtime receipt；A1 先建立 negative matrix，A2 再复用 admission/finalizer 保证安全 mutation。
- Codex thread binding、Claude ownsNativeCompaction 与 OpenClaw compaction 参数分别校验，configured 与 effective 不能混同。
- 稳定协调 binding 是 existing Workspace/Assistant 的最小 metadata；工作事实仍引用 Task Ledger，worker accepted/delivered 不等于 task completed。
- completion batch 复用 subagent result/announce/send-intent owner，传输允许 at-least-once，但重复事件不能产生重复副作用。
- context 只消费已接受、有效且同 scope 的事实和有界 artifact；不复制历史、候选与已验证知识为第二 memory。
- 调度复用 Cron/Workboard，保持 current turn stop、未来 schedule cancel、协调 admission pause 的区别；不把 session goal 当 durable mission。

**连续策略先评测后选择**

D2 在评测前冻结不少于 30 对 agent 驱动场景、相同模型/输入和指标预算。目标为关键事实保真 100%、下一步正确率至少 95%、误报完成 0；推广门为费用或输入 token 净少至少 15%、P95 不超过 baseline 1.10 倍、安全零回归。记录 first-token、wall-clock、token/cache/cost 的真实样本，不用字符估算或 token 曲线代替实际收益。

D3 可完成为 keep-baseline/NO-GO，核心闭环继续使用已实现的手动或原生 compaction。TF-0424 的 shadow/no-go 保留历史身份；最多选择一个初筛候选，若采用必须另写明确的实现范围、适用 backend、回滚和错误 fallback。规划与决策文本不激活新路径或翻冻结默认。

**后续执行与验收**

每个节点实现前运行其 `pnpm harness context --spec <合同>`；source 改动按 actual owner seam 缩小 touchedAreas，所有 runtime/Main/renderer 接线继续 gateway-backend-communication 的 fast/comms 与 contract gate；可见改动有同一变更集 Electron E2E、四语与 design token。spec 的 plannedTests 和 artifact 路径是未来交付，不表示当前已经存在或通过。

每节点报告必须绑定 clean scoped candidate、真实 source/tree、inputs、actor、命令/exit/counts/raw receipts、负向场景、cleanup 和未测范围。原始运行写 D 盘或 ignored artifact；curated evidence 逐文件登记保留清单、SHA256SUMS、secret scan。所有 acceptance 读盘核对后按合法 proposal/hash check 自动收口并 validate/export；Task Forest 与会话 handoff 留本地。

所有人机步骤由 agent/脚本自动执行，标 driven_by: agent 与具体 actor，禁止 real-human 声称。若确需外部模型或项目，只请求一次资源并自动化；资源不足可以形成 evidenceInsufficient/NO-GO，不升级模拟质量为默认推广。

**边界和阶段出口**

- C4 才能宣称长期协调 MVP 已落地；仅 binding 或子 agent 单测不能替代可使用流程。
- E1 不开启冻结的 goal-wake/durable-helper，不复制云端 VM 或无限后台责任。
- F1 至少六个真实 Electron/Host/Gateway 旅程，两个工作区对照；IPC mock UI 只计 UI 证据。
- F2 新候选至少 333 会话、50 lifecycle cycles、五分钟 RSS 与有界通知测量；不重用旧 TF-0423 性能数字作本轮结果。
- F3 交付声明范围内本地可恢复闭环。GA、公开发布、全量默认、独立多执行根 Project 与不可逆操作是另行重大决定。
- 不改变其它工作流节点或 dirty 内容，不 reset/stash/clean，不代其 commit。

**调研依据**

本计划源于 2026-10-22 的仓库与厂商 session 生命周期调研。该轮 27 个一手页面、22 个文件/124 tests 是历史研究证据，A1 必须用当前 HEAD 重采。可重复代码入口、Task Forest 历史和 product semantics 优先于产品宣传。原始调研与本轮图/提案回执为本地过程归档，默认 clone 无需它们即可读取本合同。

维护入口为本文件与各任务合同；实施时将经验证的规则/场景和精选证据落入同一变更集，不把私人 Task Forest 作为第二 runtime authority。

