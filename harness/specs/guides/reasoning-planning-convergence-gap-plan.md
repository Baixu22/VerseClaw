---
id: reasoning-planning-convergence-gap-plan
title: 高度自治项目系统的推理规划与形式化收敛缺口节点规划
type: guide
appliesTo:
  - autonomous-project-system
  - gateway-backend-communication
---

# 高度自治项目系统：推理规划质量与形式化收敛缺口节点规划

日期：2026-11-22；driven_by: agent；actor: antigravity/main。
本文件是推理规划与形式化收敛子目标的规范规划，不是实现验收结论。本轮仅落盘规范与节点规划，不修改任何运行时、主进程、前端或测试实现代码，不宣称任何节点“验收通过”，不改变既有产品锁（`releaseApproved=false`、`liveReady=false`、`productApproved=false`、`defaultOn=false`、`Agent merge OFF`）与冻结默认值。

## 0. 事实基线与编号说明

1. **权威节点表衔接**：本规划作为 `harness/specs/guides/autonomous-project-system-plan.md`（已登记 `TF-0670`–`TF-0689`，分属 A/P/R/S/M/V 六段）的增量扩展。原文件第 42 行“当前自治计划唯一 ready 叶为 TF-0670”系 2026-11-02 建图快照，不代表当前实时状态。
2. **提交史核实基线**（`git log --all --grep`）：
   - **已实现或已封存推进的既有节点**：`TF-0670`（`a7ce35fde`、`57a0d22db`）、`TF-0671`（`3259f57bd`）、`TF-0672`（`80c0fd41f`、`fd492e1e1`、`b4dbda096`、`a921d74f0`、`807cbb833`）、`TF-0673`（`f2bdf0f43`）、`TF-0674`（`5e4369660`、`84acb1acb`）、`TF-0679`（`19a10591c`、`345d17618`）；另在分支 `origin/codex/g5-test-review-20261118` 已封存 `TF-0675`（`661e1dc5d`、`a1cf565ab`）、`TF-0677`（`56130d2c6`）、`TF-0678`（`814845fae`）。**已完成的 `TF-0675` / `TF-0678` 不重开、不倒改其历史前置或结论**，新增能力一律通过增量叶子挂接。
   - **定义在案但零提交的缺口节点**：`TF-0687`、`TF-0688`、`TF-0689` 在全仓提交史中均为零提交（未实现）。
3. **外部草案编号澄清**：外部缺口分析草案曾提及的 `TF-0893`、`TF-0896`、`TF-0875`、`TF-0876` 均为**草案编号，尚未在本自治规划落图**（当前 `HEAD` `1b325ded8` 全库 `harness/`、`docs/`、`plans/` 检索 0 命中；仅未合入的 RAG 分支存在无关修复提交 `0a20e9485`，与推理规划无关）。本文档不假定上述草案编号已存在或已有实现；其与本图节点的逐号映射见下文“草案编号对照”一节。
4. **编号分配规则（全局去重与确定性定号）**：
   - **仓库级全局共享编号空间**：Task Forest 节点编号属仓库级全局唯一命名空间，由多条并行支线共享，并非单份规划文档的局部序号。例如 `harness/specs/tasks/context-folding-rlm.md` 第 116–131 行已将序号段 `0690`–`0695` 正式登记为 `context-folding-rlm` 支线的真实 Task Forest 节点（`0690` 专用 worktree 里程碑、`0691` 冻结 ContextHandle、`0692` 展开读面、`0693` 单层回传、`0694` 验收、`0695` paired eval），严禁跨支线复用已占编号，亦不允许采用“冲突时再由 CLI 动态重分配”的含糊兜底。
   - **“文档扫描 + 提交史”双取证的空号连续分配规则**：本批新增实施叶子按两步确定性定号，不允许跳号或凭印象取号。第一步（文档占用）：对基线 `1b325ded8` 下 `harness/` 全域 1294 个 Markdown 文件执行 `TF-(\d{3,4})` 正则扫描，命中 1672 处，文档登记的最大编号为 `TF-0884`。第二步（提交史占用）：`git log --all --grep=<编号>` 显示 `TF-0885` 已被 RAG 支线占用 3 个提交（最新 `748c4c9d1 test(rag): TF-0885 bind refreshed gate evidence`），`TF-0893` 已有 `0a20e9485 fix(rag): TF-0893`，二者均未合入当前 `HEAD` 但已属全局已占编号。因此跳过 `0885` 与 `0893`，取连续空段 **`TF-0886`–`TF-0892`** 作为本批 7 个叶子的确定性编号。
   - **本批落地定号与初版旧草案号映射**：本批 7 个新增实施叶子确定性落定为 **`TF-0886`–`TF-0892`**，并绑定稳定合同代号（`P0`、`P5`、`P6`、`P7`、`R5`、`V1a`、`V2a`）与任务 spec slug。与上一轮初版旧草案序号（`0690`–`0696`，已废止停用）的 1:1 映射关系如下：

     | 正式节点编号 | 合同代号 | 任务规范（Spec） | 初版旧草案序号（已废止） |
     |---|---|---|---|
     | `TF-0886` | `P0` | `harness/specs/tasks/autonomy-budgeted-research-gate.md` | `0690` |
     | `TF-0887` | `P5` | `harness/specs/tasks/autonomy-plan-mode-consensus-loop.md` | `0691` |
     | `TF-0888` | `P6` | `harness/specs/tasks/autonomy-plan-optimality-solver-adapter.md` | `0692` |
     | `TF-0889` | `P7` | `harness/specs/tasks/autonomy-independent-formal-verifier.md` | `0693` |
     | `TF-0890` | `R5` | `harness/specs/tasks/autonomy-cloud-async-delegation.md` | `0694` |
     | `TF-0891` | `V1a` | `harness/specs/tasks/autonomy-reverse-attribution-spine.md` | `0695` |
     | `TF-0892` | `V2a` | `harness/specs/tasks/autonomy-convergence-quality-metrics.md` | `0696` |

5. **自动化验证铁律**：遵循 `AGENTS.md` §Human-in-the-loop policy，所有节点（含交互式 Plan Mode 与长程故障验收）严禁将“真人点击 / 真人数据 / 真人 verdict”列为门禁前置；人机确认交互必须提供自动可执行的 agent 驱动等价路径，并在产物中如实标注 `driven_by: agent` 与具体 `actor`，严禁伪造 `real-human`。

---

## 草案编号对照

外部缺口分析草案曾出现 `TF-0688`、`TF-0689`、`TF-0893`、`TF-0896`、`TF-0875`、`TF-0876` 六个编号，与本规划节点图的权威对应关系固定如下：

| 外部草案提及编号 | 草案语义 | 本图正式承载节点 | 对照与承载说明 |
|---|---|---|---|
| `TF-0688` | 追溯链 | **既有 `TF-0688`（`V1`）**（由 **`TF-0891` / `V1a`** 打底） | 本图既有 `V1` 主节点（当前实现提交为 0），主承载跨项目成本去重与四语追溯视图；由本批新增前置子叶 **`TF-0891`（`V1a` 六级逆向归因底座）** 先行打底。 |
| `TF-0689` | 长程验证 | **既有 `TF-0689`（`V2`）**（由 **`TF-0892` / `V2a`** 打底） | 本图既有 `V2` 主节点（当前实现提交为 0），主承载单项目/跨项目长程自治真实质量与复合故障恢复边界验收；由本批新增前置子叶 **`TF-0892`（`V2a` 收敛质量度量套件）** 提供统计底座。 |
| `TF-0893` | 预算化 Research | **`TF-0886`（`P0`）** | 外部草案号，正式落图定号为 **`TF-0886`**（`autonomy-budgeted-research-gate.md`），承载任务拆解前的有界预算 Research 探针、只读证据包与边际收益早停门禁。 |
| `TF-0896` | 最优性 / 质量度量 | **`TF-0892`（`V2a`）**（最优性求解本身由 **`TF-0888` / `P6`** 承载） | 外部草案号，收敛过程质量度量（可行率 vs 最优率、收敛曲线、浪费率、步骤冗余度）正式落图定号为 **`TF-0892`**（`autonomy-convergence-quality-metrics.md`）；规划期候选方案最优性评估与 CP-SAT/ILP/PDDL 有界求解器适配本身由 **`TF-0888`（`P6`，`autonomy-plan-optimality-solver-adapter.md`）** 承载，作为 `TF-0892` 的直接前置输入。 |
| `TF-0875` / `TF-0876` | 未落图外部草案项 | **本图不落节点** | 当前 `HEAD`（`1b325ded8`）全库无对应实现、既有节点登记与业务契约（未合入 RAG 分支上的提交 `0a20e9485` 与本自治推理规划无关），遵循实证建图原则，不凭外部草案号虚设节点。 |

---

## 1. 缺口矩阵（As-Is → To-Be）

| 维度 | As-Is（附真实证据：文件/提交号） | To-Be | 核心缺口 | 承接 TF 节点 |
|---|---|---|---|---|
| **规划能力层（Capability Gap）：方案最优性与形式化求解** | `ResourceAwareWaveScheduler` 已实现确定性波次、并发上限、写集冲突隔离与静态 `EFFORT_COST` 估算（`openclaw_runtime/src/agents/orchestration-resource-scheduler.ts`；设计合同 `docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md`；模块边界 `docs/runtime-design/development-manual.md` §1.2 A2）；起步波次不可重规划。 | 在不破坏安全隔离边界的前提下，支持多候选 DAG 的工期/成本/成功率帕累托评估，并针对组合约束子问题（多资源时窗、10+ 节点依赖排程）接入有界形式化求解适配层（CP-SAT / ILP / PDDL）。 | **只有 Feasibility，没有 Optimality**：纯 LLM 在高维组合规划上易发生复杂度坍塌（NATURAL PLAN <5%，对标 COMPASS 可行率 70–90% 但最优率仅 20–60%），缺候选方案质量排序器与形式化求解器回退桥。 | `TF-0888`（`P6`） |
| **规划能力层（Capability Gap）：规划前预算化信息获取** | 角色契约与资源账本仅约束执行期派发（`openclaw_runtime/src/agents/role-contract.ts`、`electron/services/resource-fabric.ts`）；`docs/role-packs/research-pack.example.yaml` 仅为静态示例，`TF-0675`（`661e1dc5d`）直接从目标与既有台账生成任务计划。 | 复杂目标进入任务拆解前，先在显式 token/时长/只读工具次数硬预算内执行 Research 探针，产出带证据锚点的事实清单、未知项与边际收益早停回执，再冻结任务图。 | **缺预算化 Research 前置门**：规划前要么盲拆假设、要么无界检索消耗上下文，缺乏独立计费、只读受限且可归因的规划前信息获取契约。 | `TF-0886`（`P0`） |
| **收敛手段层（Convergence Gap）：独立形式化核验** | 自动完成准入依赖既有 `evaluateEvidenceVerifier` 与 `resolveVerifierCompletionVerdict`（`openclaw_runtime/src/runtime-core/evidence-verifier.ts`、`openclaw_runtime/src/runtime-core/verifier-completion-verdict.ts`、`TF-0672` 提交 `80c0fd41f`/`b4dbda096`、`TF-0678` 提交 `814845fae`），检查产物哈希、退出码与子代理评审回执。 | 在既有 `EvidenceVerifier` 管道内接入非模型自证的确定性核验 provider（形式化前后置不变量、计划轨迹约束检查器、AST/状态机属性断言），与 LLM 评审形成正交双门禁。 | **缺独立形式化 Verifier**：当前语义级核验仍由同族模型/子代理扮演 reviewer，缺少不可被自然语言说服的形式化不变量与反例生成器。 | `TF-0889`（`P7`） |
| **收敛手段层（Convergence Gap）：收敛过程质量度量** | 现有评测聚焦二元完成门禁或单步 Mission reviewer 打分（`openclaw_runtime/src/observability/decision-quality-auditor.ts` 仅离线评估 `correctness/completeness/timeliness`；`scripts/agent-engineering-acceptance.mjs` 输出通过/失败计数）。 | 量化并落盘完整收敛动力学指标：方案可行率 vs 最优率、迭代轮次→累积成功率收敛曲线、废写集/无效重试资源浪费率、步骤冗余度，并支持配对基线对比。 | **收敛指标单一**：只有终态“验收全过”，无法区分“1 轮低成本精准收敛”与“反复试错浪费 80% 预算后勉强撞过”。 | `TF-0892`（`V2a`，挂入 `TF-0689`） |
| **运行机制层（Harness Gap）：Plan Mode 人机/代理共识闭环** | `update_plan` 仅写入工具详情供气泡展示（`openclaw_runtime/src/agents/tools/update-plan-tool.ts`）；旧 `WorkModeId = 'plan'` 已标 `@deprecated` 且禁止驱动台账或策略（`shared/types/work-mode.ts`）；`TF-0675`（`661e1dc5d`、`a1cf565ab`）实现了后台协调器持久计划与修订，但缺前置交互确认闸口。 | 对齐 Ask / Plan / Autopilot 三态会话收敛协议：Plan 模式下先落盘结构化计划草案（目标拆解、写集、预算、风险、回退），在首个写副作用前达成显式确认或修订共识，绑定 plan digest 后再转入执行。 | **后台规划缺轻交互确认闭环**：缺少面向会话入口的“只读规划—审阅/修订—锁版本执行”受控状态转换与 UI 呈现（自动化测试由 agent 模拟确认动作）。 | `TF-0887`（`P5`） |
| **运行机制层（Harness Gap）：云端异步受控委托** | 远端任务服务仅支持 `message \| doctor \| settingsPatch` 三类轻量指令（`shared/types/remote-tasks.ts`、`electron/services/remote-tasks-api.ts`）；远端 Forge 仅只读观测且锁死 `Agent merge OFF`（`electron/services/remote-forge-api.ts`、`harness/specs/rules/remote-forge-expansion-boundary.md`）；`TF-0677`（`56130d2c6`）绑定本机宿主续行。 | 支持类 `/delegate` 异步受控委托：将锁定的任务包与分支推送到脱机可持续运行的受管远端执行器、创建 Draft PR 后台推进，本机离线不中断，重连后按既有 `TF-0677`/`TF-0682` 对账回读候选与证据。 | **本机强绑定、关机即停**：缺少跨本机生命周期的异步分支/Draft PR 委托执行与回执对账协议（同时必须保持 `Agent merge OFF` 不自动合入主干）。 | `TF-0890`（`R5`） |
| **证据与度量层（Evidence Gap）：端到端逆向归因追溯** | 已有任务事件流（`shared/task-system/event-store.ts`）、运行时事件日志（`openclaw_runtime/src/runtime-core/event-log.ts`）、轨迹图（`electron/services/observability-graph.ts`）及清理保留（`TF-0867` `harness/specs/tasks/unified-execution-traceability.md`）；但 **`TF-0688` 提交数为 0**。 | 一键逆向反查 `交付结果 → 验收裁决 → 固定候选 → 执行/工具回执 → 计划修订/Research/Solver 决策 → 原始目标`，并支撑跨项目去重计费与四语追溯视图。 | **碎片化回执未接成逆向归因链**：`TF-0688` 定义在案但零实现，且原前置等待跨项目 S2/S3，导致单项目规划质量归因长期无统一读面。 | `TF-0891`（`V1a`）+ `TF-0688`（`V1` 主承载） |
| **证据与度量层（Evidence Gap）：长程自治真实质量与故障边界** | 已有局部稳定性与压力脚本（`scripts/runtime-long-stability.mjs`、`harness/specs/fixtures/adaptive-resource-pressure-20261108/report.json`、`harness/specs/rules/resource-lifecycle-soak.md`）；但 **`TF-0689` 提交数为 0**。 | 在真实复杂项目与复合故障注入（Provider 429 限流、多工作树/端口争抢、宿主崩溃重启、远端委托断连、预算耗尽、错误记忆回滚）下持续运行数小时至数天，产出带分母与原始证据的可复算质量报告。 | **缺长程自治真实质量实证**：`TF-0689` 定义在案但零实现，尚无覆盖规划—收敛—恢复全链路的数小时级以上复合故障 soak 证据。 | `TF-0689`（`V2` 主承载，接入 `TF-0892`） |

---

## 2. 八项缺口承载方式与架构取舍理由

| # | 缺口项 | 最终承载方式 | 取舍与挂接理由 |
|---|---|---|---|
| 1 | 方案最优性 / Solver Adapter | **新增叶子 `TF-0888`（`P6`）**，挂 `TF-0675`、`TF-0679`、`TF-0886` 之后 | `TF-0675` 已完成协调器基础计划持久化（不重开）；最优性评分与 CP-SAT/ILP/PDDL 求解需要消费 `TF-0675` 的任务图结构、`TF-0679` 的真实资源容量快照及 `TF-0886` 的 Research 估算输入，作为 `ResourceAwareWaveScheduler` 上游的可回退插件落地最干净。 |
| 2 | 形式化验证 / 独立 Verifier | **新增叶子 `TF-0889`（`P7`）**，挂 `TF-0678`、`TF-0672` 之后 | `TF-0678` 已在分支封存基础闭环（不重开），且硬规则 `autonomy-task-completion-boundary` 严禁新建第二套 verifier 权威服务；以增量叶子向既有 `EvidenceVerifier` 注册确定性形式化 check provider，既保留单一完成权威，又消除模型自证盲区。 |
| 3 | 收敛质量度量 | **新增叶子 `TF-0892`（`V2a`）**，作为前置子叶挂入 `TF-0689` | 若直接塞入 `TF-0689` 会导致长程 soak 与指标计算器耦合过重；单独拆出 `TF-0892` 先固定最优率、浪费率、冗余度和迭代→成功率曲线的离线纯函数与基线对照契约，再由 `TF-0689` 在长程实跑中消费。 |
| 4 | 云端异步委托 | **新增叶子 `TF-0890`（`R5`）**，挂 `TF-0677`、`TF-0682`、`TF-0674` 之后 | 异步远端委托本质是“跨宿主生命周期的受控执行环境 + 分支/Draft PR 回流”，必须复用 `TF-0674` 宿主能力探测、`TF-0677` 续行去重围栏与 `TF-0682` 工作树候选整合，并受 `remote-forge-expansion-boundary`（`Agent merge OFF`）约束。 |
| 5 | Plan Mode 交互闭环 | **新增叶子 `TF-0887`（`P5`）**，挂 `TF-0675`、`TF-0886`、`TF-0662` 之后 | `TF-0675` 解决了后台计划存储但无写前交互门禁；挂在 `TF-0675`、`TF-0886`（展示 Research 依据）和 `TF-0662`（项目/会话 UI 基线）之后，可在不污染已弃用 `WorkModeId` 的前提下交付 Ask/Plan/Autopilot 显式协议。 |
| 6 | 统一追溯 | **由既有 `TF-0688`（`V1`）主承载 + 拆前置底座子叶 `TF-0891`（`V1a`）** | 若另立完整追溯大节点会与 `TF-0688` 语义重复；但原 `TF-0688` 依赖跨项目 `S2/S3`（`TF-0684`/`TF-0685`），会拖慢最高优的单项目规划归因。故拆出 `TF-0891`（仅依赖 `TF-0678`、`TF-0673`）先行打通机器可查的六级逆向归因索引，再由 `TF-0688` 汇总跨项目计费与四语 UI。 |
| 7 | 预算化 Research | **新增叶子 `TF-0886`（`P0`）**，依赖 `TF-0673`、`TF-0674`、`TF-0679` | 逻辑上位于目标拆解（`P1`）之前；因 `TF-0675` 已实现封存、不重开不倒改其历史前置，故将 `TF-0886` 设为规划增强链入口（`P5`/`P6` 的直接前置），以协调器规划前钩子向 `TaskSystemStore` 注入有界 Research 证据包。 |
| 8 | 长程自治真实质量 | **由既有 `TF-0689`（`V2`）直接承载**（不造重复节点），补齐现状注记与子项 | `TF-0689` 原定义即为“验证单项目与跨项目自治的真实质量和可恢复边界”，与缺口 8 完全同构；只需明确其零实现现状、接入 `TF-0887`/`TF-0889`/`TF-0890`/`TF-0892` 前置，并将数小时–数天故障注入矩阵细化为硬性验收子项。 |

---

## 3. 节点表（新增叶子与既有承载节点衔接）

| TF节点 | 代号 | 交付 | 直接前置 |
|---|---|---|---|
| TF-0886 | P0 | 在任务拆解前接入有界预算 Research 探针、只读证据包与边际收益早停门禁 | TF-0673、TF-0674、TF-0679 |
| TF-0887 | P5 | 交付 Ask/Plan/Autopilot 会话收敛协议与写前结构化计划确认闭环 | TF-0675、TF-0886、TF-0662 |
| TF-0888 | P6 | 为波次调度器接入候选方案最优性评估与 CP-SAT/ILP/PDDL 有界求解适配层 | TF-0675、TF-0679、TF-0886 |
| TF-0889 | P7 | 在既有完成权威内接入非模型自证的确定性形式化核验与反例诊断适配层 | TF-0678、TF-0672 |
| TF-0890 | R5 | 交付远端分支与 Draft PR 异步受控委托、脱机后台推进及重连回执对账 | TF-0677、TF-0682、TF-0674 |
| TF-0891 | V1a | 建立结果→验收→候选→执行→计划/Research→目标的逆向归因追溯底座（TF-0688 前置子叶） | TF-0678、TF-0673 |
| TF-0892 | V2a | 交付方案最优率、资源浪费率、步骤冗余度与迭代收敛曲线度量套件（TF-0689 前置子叶） | TF-0891、TF-0888、TF-0889 |
| TF-0688（既有承载·更新前置） | V1 | 让目标到工具效果、成本和验收形成统一可查询追溯（汇总 V1a + 跨项目成本去重 + 四语 UI） | TF-0678、TF-0684、TF-0685、TF-0891 |
| TF-0689（既有承载·更新前置） | V2 | 验证单项目与跨项目长程自治的真实质量、复合故障注入与可恢复边界 | TF-0688、TF-0687、TF-0662、TF-0887、TF-0889、TF-0890、TF-0892 |

---

## 4. 新增叶子实施合同（TF-0886 – TF-0892）

以下各节均处于规划阶段，未运行实现验证；每条计划证据在叶子实施前仅代表目标落盘契约，不代表当前已存在或已通过。

### TF-0886 / P0 在任务拆解前接入有界预算 Research 探针、只读证据包与边际收益早停门禁

- **目的**：解决规划前盲目假设或无界检索上下文膨胀问题。复杂目标进入任务拆解或修订前，协调器必须先通过 `ResourceFabric` 申请显式 Research 预算（最大 token、最大墙钟耗时、最大只读工具调用数），仅允许只读宿主/代码/知识探针执行信息收集，产出带来源摘要的 `PrePlanResearchPacket`（已核实事实、未决假设、推荐写集范围、边际收益早停原因），禁止在 Research 阶段触发任何写文件、写外部系统或扩权副作用；预算耗尽或连续两轮零新增有效锚点时强制早停并标注未知边界，不阻断后续保守规划。
- **骨架位置**：L1 只读探针与资源预留 + L3 规划输入契约 + L4 准入边界。直接前置：`TF-0673`、`TF-0674`、`TF-0679`（逻辑服务于协调器拆解阶段，不重开已封存的 `TF-0675`）。
- **复用与必要写集**：
  - 既有真实路径：`shared/task-system/types.ts`；`shared/task-system/store.ts`；`electron/services/task-system-service.ts`；`electron/services/resource-fabric.ts`；`electron/services/workspace-preflight.ts`；`openclaw_runtime/src/agents/role-contract.ts`；`openclaw_runtime/src/agents/tools/persistent-task-tool.ts`；`docs/role-packs/research-pack.example.yaml`；`docs/modules/multi-agent-and-tasks.md`。
  - 拟新增路径：`shared/task-system/preplan-research.ts`（拟新增）；`openclaw_runtime/src/agents/preplan-research-runner.ts`（拟新增）；`harness/specs/tasks/autonomy-budgeted-research-gate.md`（本轮新建规范）。
  - 分支待合入关联路径：`shared/task-system/project-coordinator.ts`（待从分支提交 `661e1dc5d` 合入，当前 `HEAD` 未落盘）。
- **测试入口**：既有 `tests/unit/durable-task-planning.test.ts`、`tests/unit/resource-fabric-primitives.test.ts`；拟新增 `tests/unit/autonomy-budgeted-research-gate.test.ts`（拟新增，覆盖只读工具拦截、token/耗时/调用次数三轴硬上限、边际收益早停与未知项透传负例）。
- **计划证据**：`harness/specs/fixtures/autonomous-project-system/p0/`（拟新增）下的 `research-budget-envelopes.json`（拟新增）、`readonly-violation-negatives.json`（拟新增）、`diminishing-return-stops.json`（拟新增）、`SHA256SUMS`（拟新增）；全部标 `driven_by: agent`，原始跑次输出至 `D:/tmp`，定稿证据按 `scripts/repository-artifacts.json` 登记保留。
- **回退**：关闭规划前 Research 准入开关，协调器退回 `TF-0675` 直接基于当前已知台账保守生成计划，已持久化的历史 `PrePlanResearchPacket` 保持只读可查。

### TF-0887 / P5 交付 Ask/Plan/Autopilot 会话收敛协议与写前结构化计划确认闭环

- **目的**：补齐对标 GitHub Copilot CLI 的会话级“规划—确认—执行”轻交互收敛协议，同时不复活已废弃的 `shared/types/work-mode.ts` 权限耦合。会话显式支持 `ask`（纯问答只读，禁自动建业务写任务）、`plan`（生成并落盘含目标拆解、Research 依据、写集、预算上限与回退方案的结构化计划草案，在首个写副作用前挂起等待确认/局部修订/拒绝）、`autopilot`（在既有授权与安全边界内自动确认推进，仅重大架构/资金/凭据/发布升级决策卡）三态；确认动作必须绑定具体 `planRevisionDigest`，计划修订后旧确认自动失效；UI 通过统一 `host-api` 呈现且覆盖 `en/zh/ja/ru` 四语，自动化门禁一律由 agent 模拟审阅确认与驳回修订（标 `driven_by: agent`）。
- **骨架位置**：L2 会话任务范围 + L3 计划版本权威 + L4 Host API 与 Renderer 会话交互面。直接前置：`TF-0675`、`TF-0886`、`TF-0662`。
- **复用与必要写集**：
  - 既有真实路径：`shared/task-system/types.ts`；`shared/task-system/store.ts`；`shared/host-api/contract.ts`；`src/lib/host-api.ts`；`electron/services/task-system-service.ts`；`electron/services/sessions-api.ts`；`openclaw_runtime/src/agents/tools/persistent-task-tool.ts`；`openclaw_runtime/src/agents/tools/update-plan-tool.ts`；`src/pages/Chat/index.tsx`；`src/pages/Chat/ChatInput.tsx`；`src/pages/Chat/SessionTaskDock.tsx`；`shared/i18n/locales/en/taskLedger.json`；`shared/i18n/locales/zh/taskLedger.json`；`shared/i18n/locales/ja/taskLedger.json`；`shared/i18n/locales/ru/taskLedger.json`；`docs/modules/multi-agent-and-tasks.md`。
  - 拟新增路径：`shared/task-system/session-convergence-mode.ts`（拟新增）；`src/pages/Chat/PlanConsensusCard.tsx`（拟新增）；`harness/specs/tasks/autonomy-plan-mode-consensus-loop.md`（本轮新建规范）。
- **测试入口**：既有 `tests/unit/durable-task-session-scope.test.ts`、`tests/unit/host-api-facade.test.ts`、`pnpm run contract:check`、`pnpm run i18n:lint`；拟新增 `tests/unit/autonomy-plan-mode-consensus.test.ts`（拟新增）与 `tests/e2e/autonomy-plan-mode-consensus.spec.ts`（拟新增，agent 驱动模拟 Ask 只读拦截、Plan 草案修订与旧 digest 失效、Autopilot 受控直通）。
- **计划证据**：`harness/specs/fixtures/autonomous-project-system/p5/`（拟新增）下的 `mode-transition-matrix.json`（拟新增）、`stale-plan-digest-negatives.json`（拟新增）、`e2e-agent-consensus-journey.json`（拟新增）、`SHA256SUMS`（拟新增）；全部标 `driven_by: agent`，原始跑次写 `D:/tmp`。
- **回退**：将会话收敛协议回退至既有默认讨论/自动任务绑定路径，隐藏 `PlanConsensusCard` 写前挂起入口，不删除 `TaskSystemStore` 已保存的计划版本与审阅记录。

### TF-0888 / P6 为波次调度器接入候选方案最优性评估与 CP-SAT/ILP/PDDL 有界求解适配层

- **目的**：突破纯 LLM 组合规划坍塌与 `ResourceAwareWaveScheduler` 仅有可行性（Feasibility）而无最优性（Optimality）的局限。在不改变 `ResourceAwareWaveScheduler`“已启动波次不可重规划、写集冲突强隔离、不扩角色权限”硬边界的前提下，新增两层能力：① **多候选方案评分器**：在相同资源包络下对多个合法候选任务图/波次序列评估预期关键路径工期（makespan）、模型组合估算成本、历史同型角色成功率与步骤冗余度，输出可解释帕累托排序；② **形式化求解器适配契约（Solver Adapter）**：将 10+ 节点组合依赖、互斥工具组、截止期与预算上限编译为标准化的有界 CP-SAT / ILP / PDDL 求解输入，经受控本地子进程/WASM sidecar 在硬超时（如 ≤2s）内求解最优波次；求解器未安装、超时或返回 infeasible 时确定性降级至既有启发式波次或输出明确不可行冲突集（unsat core 摘要），严禁盲目放行冲突并发。
- **骨架位置**：L1 编排波次调度 + L3 计划质量评估（只读决策，不授予权限）。直接前置：`TF-0675`、`TF-0679`、`TF-0886`。
- **复用与必要写集**：
  - 既有真实路径：`openclaw_runtime/src/agents/orchestration-resource-scheduler.ts`；`openclaw_runtime/src/agents/orchestration-protocol.ts`；`openclaw_runtime/src/agents/role-contract.ts`；`openclaw_runtime/src/agents/worktree-service.ts`；`electron/services/resource-fabric.ts`；`docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md`；`docs/runtime-design/development-manual.md`；`docs/modules/multi-agent-and-tasks.md`。
  - 拟新增路径：`openclaw_runtime/src/agents/planning-optimality-scorer.ts`（拟新增）；`openclaw_runtime/src/agents/solver-adapter.ts`（拟新增）；`shared/types/planning-solver.ts`（拟新增）；`harness/specs/tasks/autonomy-plan-optimality-solver-adapter.md`（本轮新建规范）。
- **测试入口**：既有 `tests/unit/resource-aware-wave-scheduler.test.ts`、`tests/unit/orchestration-resource-scheduler.test.ts`；拟新增 `tests/unit/autonomy-plan-optimality-solver.test.ts`（拟新增，覆盖 10–30 节点合成组合基准上启发式 vs 求解器最优率对照、超时回退、不可行约束最小冲突集诊断、已启动波次不可变负例）。
- **计划证据**：`harness/specs/fixtures/autonomous-project-system/p6/`（拟新增）下的 `combinatorial-benchmark-comparison.json`（拟新增）、`solver-fallback-negatives.json`（拟新增）、`pareto-rank-receipts.json`（拟新增）、`SHA256SUMS`（拟新增）；全部标 `driven_by: agent`，原始跑次写 `D:/tmp`。
- **回退**：禁用 `solver-adapter` 与多候选重排开关，调度路径无损退回既有 `ResourceAwareWaveScheduler` 确定性拓扑排序波次。

### TF-0889 / P7 在既有完成权威内接入非模型自证的确定性形式化核验与反例诊断适配层

- **目的**：解决“实现者与评审者同属生成式模型、靠自然语言互评放行”的自证脆弱性。严格遵守 `autonomy-task-completion-boundary`（**不新建第二套 verifier 权威服务、不新建独立 decision store**），在既有 `evaluateEvidenceVerifier` 与 `resolveVerifierCompletionVerdict` 管道中注册确定性形式化核验 provider：① 计划轨迹前后置条件与状态转移不变量校验（PDDL/状态机 trace validator）；② 写集边界、AST 结构契约与声明式后置断言（post-condition oracle）；③ 结构化最小反例（counterexample）回执生成，供 `TF-0678` 有限修复循环精准定位失败约束；任何确定性不变量违背具有一票否决权，任何 LLM reviewer 的 `approved` 文本均不可覆盖确定性失败。
- **骨架位置**：L3 任务完成权威（既有 `EvidenceVerifier` 扩展）+ L5 证据与反例回执。直接前置：`TF-0678`、`TF-0672`。
- **复用与必要写集**：
  - 既有真实路径：`openclaw_runtime/src/runtime-core/evidence-verifier.ts`；`openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts`；`openclaw_runtime/src/runtime-core/verifier-completion-verdict.ts`；`openclaw_runtime/src/runtime-core/task-completion-claim.ts`；`openclaw_runtime/src/agents/task-loop-controller.ts`；`openclaw_runtime/src/agents/persistent-task-acceptance.ts`；`electron/services/task-ledger-service.ts`；`harness/specs/rules/autonomy-task-completion-boundary.md`；`docs/modules/multi-agent-and-tasks.md`。
  - 拟新增路径：`openclaw_runtime/src/runtime-core/formal-invariant-verifier.ts`（拟新增）；`shared/types/formal-verification.ts`（拟新增）；`harness/specs/tasks/autonomy-independent-formal-verifier.md`（本轮新建规范）。
- **测试入口**：既有 `tests/unit/runtime-evidence-verifier-contracts.test.ts`、`tests/unit/durable-task-acceptance.test.ts`；拟新增 `tests/unit/autonomy-independent-formal-verifier.test.ts`（拟新增，覆盖“LLM 评审给 pass 但形式化不变量失败时必须被拒”、反例回执确定性重放、候选哈希漂移使形式化证明失效等正负例）。
- **计划证据**：`harness/specs/fixtures/autonomous-project-system/p7/`（拟新增）下的 `formal-invariant-verdicts.json`（拟新增）、`llm-self-cert-override-negatives.json`（拟新增）、`counterexample-repair-loop.json`（拟新增）、`SHA256SUMS`（拟新增）；全部标 `driven_by: agent`，原始跑次写 `D:/tmp`。
- **回退**：卸载新增形式化 check provider，恢复既有 `evaluateEvidenceVerifier` 工程测试与回执校验集合；已拒绝或待核验任务保持 `review`/原状态，不自动放行 `done`。

### TF-0890 / R5 交付远端分支与 Draft PR 异步受控委托、脱机后台推进及重连回执对账

- **目的**：解除自治执行对本机常驻开机状态的强绑定，补齐对标 `/delegate` 的云端/远端异步受控委托能力，同时严守 `remote-forge-expansion-boundary` 冻结红线（保持 `liveReady=false`、`productApproved=false`、`defaultOn=false`、`Agent merge OFF` 不变）。当任务已在本地锁定 `TaskRef`、`planRevisionDigest`、隔离分支与有界预算后，可通过主进程受控委托通道将任务契约包投递至显式配置的远端受管 runner（离线测试由本地独立守护进程 + 本地 bare Git/Forge fixture 完整模拟），在远端独立分支推进并创建/更新 Draft PR；本机 UI 关闭、休眠或重启期间远端执行不中断；本机唤醒后经既有 `TF-0677` generation fence 与 `TF-0682` 工作树整合队列拉取远端 commit/candidate digest、运行日志、成本与检查回执，交由本地既有 `EvidenceVerifier` 独立复验；远端 runner 严禁持有主分支合并权限、生产发布权限或明文长效主密钥。
- **骨架位置**：L1 Git/远端受管执行环境 + L2 generation/lease 围栏 + L4 Main 受控委托 API。直接前置：`TF-0677`、`TF-0682`、`TF-0674`。
- **复用与必要写集**：
  - 既有真实路径：`shared/types/remote-tasks.ts`；`shared/types/remote-forge.ts`；`shared/types/session-delegation.ts`；`shared/host-api/contract.ts`；`src/lib/host-api.ts`；`electron/services/remote-tasks-api.ts`；`electron/services/remote-forge-api.ts`；`electron/services/git-api.ts`；`electron/services/session-delegation-admission.ts`；`electron/services/workspace-preflight.ts`；`openclaw_runtime/src/agents/goal-wake-recovery.ts`；`openclaw_runtime/src/agents/worktree-service.ts`；`harness/specs/rules/remote-forge-expansion-boundary.md`；`docs/modules/workspace-and-coding.md`。
  - 拟新增路径：`shared/types/async-cloud-delegation.ts`（拟新增）；`electron/services/async-cloud-delegation-api.ts`（拟新增）；`harness/specs/tasks/autonomy-cloud-async-delegation.md`（本轮新建规范）。
- **测试入口**：既有 `tests/unit/remote-tasks-api.test.ts`、`tests/unit/remote-forge-expansion-decision.test.ts`、`pnpm run contract:check`、`pnpm run comms:replay`、`pnpm run comms:compare`；拟新增 `tests/unit/autonomy-cloud-async-delegation.test.ts`（拟新增，覆盖本机进程退出期间独立 worker 推进本地 bare 仓分支、重连对账、旧 generation 僵尸回执拦截、尝试远端直接 merge 被拒、凭据脱敏）。
- **计划证据**：`harness/specs/fixtures/autonomous-project-system/r5/`（拟新增）下的 `async-delegation-lifecycle.json`（拟新增）、`offline-reconnect-reconcile.json`（拟新增）、`agent-merge-off-negatives.json`（拟新增）、`credential-redaction-audit.json`（拟新增）、`SHA256SUMS`（拟新增）；全部标 `driven_by: agent`，原始跑次写 `D:/tmp`。
- **回退**：默认关闭异步远端委托入口（`defaultOn=false`），撤回在途远端租约并保留远端隔离分支与本地任务锚点供只读核查，执行退回本机受控工作树路径。

### TF-0891 / V1a 建立结果→验收→候选→执行→计划/Research→目标的逆向归因追溯底座

- **目的**：作为最高优先级先导叶（`TF-0688` 的核心底座子叶），在不等待跨项目总控 `S2/S3`（`TF-0684`/`TF-0685`）完成的前提下，率先在单项目内打通机器可查、磁盘可重算的六级逆向归因索引链：`交付产物 (Artifact/Result) → 验收裁决 (VerifierCompletionRecord / FormalVerdict) → 固定候选 (Candidate Commit/Tree Digest) → 执行与工具回执 (ScopedRun / Tool & Effect Receipt / Cost) → 计划修订与前置决策 (PlanRevision / PrePlanResearchPacket / SolverSchedule) → 原始目标 (Goal / TaskRef)`。该层只做既有 owner 事件与回执的确定性关联投影与断链诊断（`broken-link` / `stale-candidate` / `unknown-cost` / `unattributed-effect`），不复制原始状态库、不新建第二套 exporter；清空索引缓存后可 100% 从磁盘既有 owner 记录重建，直接为 `TF-0886`/`TF-0888`/`TF-0892` 提供规划质量归因事实面。
- **骨架位置**：L5 证据追溯与失效校验底座 + L4 Host 只读查询契约。直接前置：`TF-0678`、`TF-0673`。
- **复用与必要写集**：
  - 既有真实路径：`shared/task-system/event-store.ts`；`shared/task-system/artifact-retention.ts`；`shared/task-system/types.ts`；`shared/types/observability.ts`；`shared/types/evidence.ts`；`shared/types/session-activity.ts`；`shared/host-api/contract.ts`；`src/lib/host-api.ts`；`electron/services/task-system-service.ts`；`electron/services/observability-graph.ts`；`electron/services/observability-trajectory.ts`；`electron/services/host-trace-diagnostics.ts`；`openclaw_runtime/src/runtime-core/event-log.ts`；`openclaw_runtime/src/observability/correlation-ids.ts`；`scripts/check-evidence-refs.mjs`；`docs/modules/resources-and-observability.md`。
  - 拟新增路径：`shared/task-system/reverse-attribution-index.ts`（拟新增）；`electron/services/task-attribution-query.ts`（拟新增）；`harness/specs/tasks/autonomy-reverse-attribution-spine.md`（本轮新建规范）。
- **测试入口**：既有 `tests/unit/durable-task-event-store.test.ts`、`tests/unit/observability-graph.test.ts`、`tests/unit/harness-gap-trace-cost-sampling.test.ts`；拟新增 `tests/unit/autonomy-reverse-attribution-spine.test.ts`（拟新增，覆盖从最终产物一键反查六级全链、删除索引后从磁盘重建、候选篡改失敏报警、未知费用不归零、伪造回执断链拒绝）。
- **计划证据**：`harness/specs/fixtures/autonomous-project-system/v1a/`（拟新增）下的 `reverse-chain-queries.json`（拟新增）、`index-rebuild-parity.json`（拟新增）、`broken-chain-negatives.json`（拟新增）、`SHA256SUMS`（拟新增）；全部标 `driven_by: agent`，原始跑次写 `D:/tmp`。
- **回退**：禁用逆向归因查询聚合接口，保留各既有 owner 的原始 `events.jsonl`、轨迹文件与验收回执不受影响。

### TF-0892 / V2a 交付方案最优率、资源浪费率、步骤冗余度与迭代收敛曲线度量套件

- **目的**：作为 `TF-0689`（`V2`）的前置度量子叶，终结“只有终态通过率、没有收敛过程质量”的黑盒评测现状。基于 `TF-0891` 的逆向归因链、`TF-0888` 的求解器参考基线与 `TF-0889` 的确定性核验回执，在既有 `AgentFirst` 评测框架与 `decision-quality-auditor.ts` 纯函数离线边界上实现标准化的收敛质量统计器：① **可行率 vs 最优率（Feasibility vs Optimality Ratio）**：对标 COMPASS 口径，对比实际执行轨迹成本/工期与已知最优或帕累托前沿下界的比值；② **迭代→成功率收敛曲线（Iteration-to-Convergence Curve）**：记录第 $k=1 \dots K$ 轮修复后的累积核验通过率与边际成本斜率；③ **资源浪费率（Resource Waste Ratio）**：统计被推翻重规划、旧 generation 丢弃、重复工具读取或未通过核验的废写集所消耗的 token/时长占比；④ **方案步骤冗余度（Step Redundancy Ratio）**：识别对最终固定候选无因果贡献的冗余子任务或动作比例。所有指标必须附带精确样本分母、置信区间/分位数与未测说明，严禁用单一综合分掩盖高浪费率。
- **骨架位置**：L5 离线评测与统计归因（不介入在线生产热路径，不充当动态权限门禁）。直接前置：`TF-0891`、`TF-0888`、`TF-0889`。
- **复用与必要写集**：
  - 既有真实路径：`openclaw_runtime/src/observability/decision-quality-auditor.ts`；`openclaw_runtime/src/observability/scorecard.ts`；`scripts/agent-engineering-acceptance.mjs`；`scripts/runtime-effectiveness.mjs`；`harness/specs/guides/agent-first-acceptance.md`；`harness/specs/rules/paired-ablation-boundary.md`；`docs/runtime-design/development-manual.md`；`docs/modules/resources-and-observability.md`。
  - 拟新增路径：`shared/task-system/convergence-quality-metrics.ts`（拟新增）；`scripts/evaluate-convergence-quality.mjs`（拟新增）；`harness/specs/tasks/autonomy-convergence-quality-metrics.md`（本轮新建规范）。
- **测试入口**：既有 `tests/unit/decision-quality-auditor.test.ts`、`tests/unit/a4-decision-quality-dev-tool.test.ts`；拟新增 `tests/unit/autonomy-convergence-quality-metrics.test.ts`（拟新增，覆盖已知最优解基准校验、高浪费但终态通过样本的劣化识别、缺失成本单列 `unknown` 而不填 `0`、小样本禁止外推 GA 负例）。
- **计划证据**：`harness/specs/fixtures/autonomous-project-system/v2a/`（拟新增）下的 `convergence-curve-report.json`（拟新增）、`optimality-waste-redundancy.json`（拟新增）、`known-wasteful-negative-control.json`（拟新增）、`SHA256SUMS`（拟新增）；全部标 `driven_by: agent`，原始跑次写 `D:/tmp`。
- **回退**：回退新增离线评测脚本与指标导出，保留既有 `AgentFirst` 与 `decision-quality-auditor` 基础计分逻辑不变。

---

## 5. 既有未实现节点的现状注记与子项拆解（TF-0688 / TF-0689）

经 `git log --all --grep` 核实，**`TF-0688`（V1）与 `TF-0689`（V2）当前均处于“规范定义在案、代码与证据提交为零”状态**（同阶段 `TF-0687` 亦为零提交）。既有仓库中的 `events.jsonl`、`observability-graph.ts`、`TF-0867` 工作树产物保留或 `scripts/runtime-long-stability.mjs` 仅提供了底层局部零件，不能替代 `V1`/`V2` 完成声明。为消除大节点空转，本规划在不造重复节点的前提下将其拆解为以下可执行子项：

### TF-0688 / V1（既有主承载：统一可查询追溯）现状注记与子项拆解

- **现状注记**：定义在案（见 `autonomous-project-system-plan.md` §TF-0688），**实现提交数为 0**。原定义同时横跨底层跨 owner 关联、费用去重与跨项目四语 UI，且受 `TF-0684`/`TF-0685` 阻塞。现通过新增前置子叶 `TF-0891`（`V1a`）先行落地单项目六级逆向归因底座，`TF-0688` 本身聚焦跨项目汇总、计费核销与用户可见追溯面板收口。
- **可执行子项拆解**：
  1. **V1-Sub1（由子叶 `TF-0891` 先行交付）**：建立 `结果 → 验收 → 候选 → 执行/回执 → 计划/Research/Solver → 目标` 磁盘可重建逆向归因索引与断链诊断 API。
  2. **V1-Sub2（父子与重试费用去重归因）**：对接 `trace-cost-sampling-boundary`，在跨会话派发、有限修复重试与异步委托对账中按唯一请求/attempt 去重汇总真实费用，分段统计排队/Research/规划/执行/核验/恢复耗时，缺失单价或未返回 usage 一律标 `unknown`（严禁填 `0`）。
  3. **V1-Sub3（三层渐进式四语 UI 呈现）**：在 `SessionActivityPanel.tsx` 与项目/总控面板接通“人可读结果摘要 → 任务与规划决策报告 → 原始技术回执与哈希校验状态”三层展开视图，覆盖 `en/zh/ja/ru` 四语与 Electron E2E。
  4. **V1-Sub4（会话删除与回收下的追溯不灭性）**：与 `TF-0682` 及 `TF-0867`（`shared/task-system/artifact-retention.ts`）联调验证，删除普通聊天会话或回收临时工作树后，已被业务任务验收引用的关键产物与归因链仍可完整反查；产物字节篡改或候选漂移在 UI 与报告中显式标 `stale/invalid`。
- **骨架位置**：L5 证据与失效 + L4 Host API + Renderer 四语投影。更新后直接前置：`TF-0678`、`TF-0684`、`TF-0685`、`TF-0891`。
- **复用与必要写集**：既有 `shared/types/session-activity.ts`、`src/pages/Chat/SessionActivityPanel.tsx`、`src/components/task-ledger/TaskLedgerSummaryPanel.tsx`、`electron/services/session-activity-api.ts`、`electron/services/observability-api.ts`、`shared/task-system/artifact-retention.ts`、`shared/i18n/locales/en/taskLedger.json`（及 `zh/ja/ru` 同名文件）；消费 `TF-0891` 交付的 `shared/task-system/reverse-attribution-index.ts`（拟新增）；拟新增 `tests/e2e/autonomy-unified-traceability.spec.ts`（拟新增）。
- **测试入口**：既有 `tests/unit/task-artifact-retention.test.ts`、`tests/unit/observability-service.test.ts`、`pnpm run i18n:lint`；拟新增 `tests/e2e/autonomy-unified-traceability.spec.ts`（拟新增）。
- **计划证据**：`harness/specs/fixtures/autonomous-project-system/v1/`（拟新增）下的 `trace-correlation.json`、`cost-attribution.json`、`evidence-retention.json`、`ui-trace-drilldown.json`、`SHA256SUMS`（均拟新增，标 `driven_by: agent`）。
- **回退**：保留 `TF-0891` 底层只读索引与原始 owner 记录，降级或隐藏跨项目聚合 UI 视图，不抹除任何真实费用与回执记录。

### TF-0689 / V2（既有主承载：长程自治真实质量与可恢复边界）现状注记与子项拆解

- **现状注记**：定义在案（见 `autonomous-project-system-plan.md` §TF-0689），**实现提交数为 0**。在接入本规划新增能力后，`TF-0689` 不仅要验证“工程链路不崩”，还必须基于 `TF-0892` 度量套件实测数小时至数天长程运行下的规划收敛质量与复合故障恢复边界。
- **可执行子项拆解**：
  1. **V2-Sub1（固定复杂任务基准集与负控冻结）**：在既有 `AgentFirst` 框架下冻结涵盖多文件重构、10+ 子任务组合依赖、跨 VB/VS/Git 工具协同及已知陷阱负控的真实项目样本集，分离脚本回放、真实在线模型、源码构建与冻结安装包四类运行维度。
  2. **V2-Sub2（复合故障与资源争抢注入矩阵）**：注入可重放且带时间戳的真实扰动组合——① Provider HTTP 429 限流、超时与有界模型降级；② 多工作树并发写冲突、终端端口抢占与浏览器同 profile 互斥；③ Electron UI 关闭、Gateway/宿主强制重启与旧 generation 晚到消息围栏；④ `TF-0890` 异步委托断网重连；⑤ Research/执行预算耗尽早停与 `TF-0687` 错误经验撤销回滚。
  3. **V2-Sub3（数小时至数天长程 Soak 实测与收敛曲线产出）**：执行连续多小时（准入门槛 ≥6h 真实多轮自治 soak，扩展档覆盖跨日连续推进與休眠恢复）受控自治运行，调用 `TF-0892` 统计自治完成率、可行率 vs 最优率、迭代→成功率曲线、资源浪费率、步骤冗余度、重复外部副作用计数（目标为 0）及恢复延迟 `p50/p95`。
  4. **V2-Sub4（独立 Agent 盲审与残余风险封存）**：由与执行者隔离的独立 agent 读取固定候选与 `TF-0688` 追溯链复算全部指标，输出未测边界（not-run）与残余风险账本；严禁小样本外推 GA，严禁修改冻结产品锁。
- **骨架位置**：L1–L5 全链路集成与长程质量实证。更新后直接前置：`TF-0688`、`TF-0687`、`TF-0662`、`TF-0887`、`TF-0889`、`TF-0890`、`TF-0892`。
- **复用与必要写集**：既有 `scripts/agent-engineering-acceptance.mjs`、`scripts/runtime-long-stability.mjs`、`harness/specs/guides/agent-first-acceptance.md`、`harness/specs/rules/resource-lifecycle-soak.md`、`harness/specs/rules/adaptive-resource-pressure.md`、`README.md`、`README.zh-CN.md`、`README.ja-JP.md`、`README.ru-RU.md`；消费 `TF-0892` 交付的 `scripts/evaluate-convergence-quality.mjs`（拟新增）；拟新增 `scripts/run-autonomy-long-horizon-soak.mjs`（拟新增）。
- **测试入口**：本规划及 `autonomous-project-system-plan.md` 全量叶子回归入口；拟新增 `scripts/run-autonomy-long-horizon-soak.mjs`（拟新增）及 `tests/e2e/autonomy-long-horizon-recovery.spec.ts`（拟新增）。
- **计划证据**：`harness/specs/fixtures/autonomous-project-system/v2/`（拟新增）下的 `final-candidate-report.json`、`long-horizon-soak-metrics.json`、`fault-injection-ledger.json`、`independent-verification.json`、`source-package-matrix.json`、`SHA256SUMS`（均拟新增，标 `driven_by: agent`）。
- **回退**：将受控自治范围收敛回已实证通过的单项目/串行子集，完整保留失败轨迹、废写集浪费账本与未测清单，绝不降格断言换取绿灯。

---

## 6. 优先级与理由：为什么“统一追溯 > 预算化 Research > 长程验证”

本子目标严格遵循四阶推进序：**第一优先：统一逆向追溯（`TF-0891` → `TF-0688`） > 第二优先：预算化 Research（`TF-0886`） > 第三优先：规划与核验收敛增强（`TF-0887` / `TF-0888` / `TF-0889` / `TF-0890`） > 第四优先：收敛度量与长程自治验证（`TF-0892` → `TF-0689`）**。其工程与因果理由如下：

1. **为什么统一追溯（`TF-0891` / `TF-0688`）必须排第一：“没有追溯，所有关于规划质量的讨论都是盲目的”**
   - **归因前提**：当前系统失败或高成本收口时，日志散落在会话 JSONL、`events.jsonl`、工作树 diff 与独立回执中。若不先打通 `结果 → 验收 → 候选 → 执行 → 计划/假设 → 目标` 的确定性反查链，我们根本无法区分一次失败究竟源于“规划前缺信息（Research 缺口）”、“任务图排程次优（Solver 缺口）”、“模型执行跑偏”还是“核验器误判（Verifier 缺口）”。
   - **防伪基线**：任何后续新增的 Research、Solver 或 Plan Mode 若想证明“提升了规划质量而非单纯增加 token 开销”，都必须依赖同一套不可篡改的逆向归因账本进行前后配对对照（Paired Ablation）。因此拆出仅依赖 `TF-0678` 与 `TF-0673` 的 `TF-0891`（`V1a`）第一时间落地，是消除盲目优化的唯一前置锚点。
2. **为什么预算化 Research（`TF-0886`）必须排在求解器、交互与长程验证之前**
   - **垃圾进则垃圾出（GIGO）**：无论是 `TF-0887` 向用户/代理展示的结构化计划草案，还是 `TF-0888` 形式化求解器（CP-SAT/ILP/PDDL）所消费的任务依赖与写集估算，其上限完全取决于规划前输入事实的准确性。若协调器在未探测真实代码锚点与宿主约束时就凭空捏造依赖图，再精密的求解器也只是在精确求解一个错误的题目。
   - **成本可控性**：Research 本身极易失控演变为无休止的全库扫描；必须先用显式预算包络与边际收益早停规则把“获取信息的代价”关进笼子，后续 `Plan Mode` 展示的假设依据和 `Solver` 使用的代价参数才有可信输入。
3. **为什么长程自治验证（`TF-0892` → `TF-0689`）必须置于收口阶段，而不能倒置抢跑**
   - **避免用昂贵长跑测试残缺闭环**：数小时至数天的真实模型 + 复合故障注入 soak 成本高、周期长。在缺少逆向归因链（`TF-0891`/`TF-0688`）时跑长程实验，一旦在第五小时发生退化，只能看到终态失败而无法定位根因链条，实验产物沦为不可归因的废日志；在缺少预算化 Research（`TF-0886`）、独立形式化核验（`TF-0889`）与收敛质量统计器（`TF-0892`）时跑长程实验，则只能测出旧架构已知的“盲拆试错 + 模型自证”天花板，既测不出最优率与浪费率曲线，也会造成大量无效 API 与磁盘消耗。
   - **因果闭环**：先用**追溯链**装好显微镜，再用**预算化 Research**与**规划/形式化核验/异步委托叶**补齐推理收敛闭环，最后通过**收敛质量度量套件 + 长程复合故障 soak**一次性在同候选上给出可复算、有分母的终局实证——这是唯一零返工、可归因的工程推进顺序。
