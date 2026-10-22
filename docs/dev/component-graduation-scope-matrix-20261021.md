# D9 现行约束替代矩阵（TF-0488）

> 日期：2026-10-21
> 适用任务：`TF-0488`
> 状态：`accepted scope matrix`；只解释现行适用关系，不改写历史或以证据替代产品批准
> 配套决策：[ADR-2026-10-21（D9）](adr/2026-10-21-d9-component-graduation-scope.md)

本矩阵使用四个动作：

- **适用**：约束继续限制当前实现和声明。
- **收窄**：保留原目标，但去掉已被 owner policy 取代的真人前置或历史时间盒。
- **历史保留**：原记录继续作为历史事实，不回溯改写；不得用它否决本计划未涉及的边界之外的工作。
- **明确排除**：D9 不执行该范围；需要另起或另激活节点。

`clarifies` 不表示 `supersedes history`。D7 的原始文本、节点状态和提交记录保持不变。

## 1. D7 / TF-0225

| ID | 原始约束或事实 | 现行处理 | D9 后的含义与责任 | 依据 |
|---|---|---|---|---|
| D7-01 | 项目是人与 agent 协作的实习展示，不是商业产品、不是 GA、不承诺长期运营 | **历史保留；发布边界适用** | 内部组件毕业不能转写成商业发布、GA 或长期运营承诺 | TF-0225；提交 `b2a406987`、`9355d7763` |
| D7-02 | 3 个工作日收尾、不新增功能、不返工架构、不为涂绿投入 | **历史保留；时间盒对当前计划收窄** | 后续激活的组件节点可做有边界的产品化、证据和默认毕业决策；仍不得用假绿或越界实现换取状态 | 同上；TF-0482/0483 的计划节点 |
| D7-03 | 冻结 RC-03～RC-10、M6、Docker、渠道扩展；下一周期从 TF-0030 重启 | **适用为范围隔离** | D9 不自动重开这些链路；需要时由单独节点重新授权 | 同上；当前 scoped Task Forest 节点图 |
| D7-04 | 不改三锁、演示 flag 只在驱动进程开启、不翻默认值 | **适用** | TF-0488 不翻转任何值；默认毕业只建立后续决策路径，实际变更须单独激活节点并通过证据门 | TF-0225；`default-config-matrix.md` |
| D7-05 | `tf0009` R7 真人守卫是当时权威，TF-0007/0009 因真人前置保持 blocked | **真人前置已被现行 owner policy 取代；零真人计数历史保留** | agent-driven 等价路径可以收口；禁止把 agent 写成真人；不得删除历史零计数事实 | `tf0009-policy-decision-20260930.md`；提交 `ed5b82951`、`3cd0b09d9` |
| D7-06 | D7 的节点状态与冻结注记不因后续计划回溯改写 | **历史保留** | `TF-0225` 不重开、不改状态；D9 只新增范围解释 | TF-0225；D7 提交 `b2a406987` |

## 2. TF-0007 / TF-0009

| ID | 原始约束或事实 | 现行处理 | D9 后的含义与责任 | 依据 |
|---|---|---|---|---|
| T7-01 | 默认策略保持 fail-closed / opt-in，不降低 sender、workspace、approval 边界 | **适用** | 任何后续组件仍须保留现有安全边界；默认毕业不能绕过授权、资源或副作用 owner | TF-0007 requirements；`docs/dev/component-controlled-rollout-p0-closeout.md` |
| T7-02 | 不解除 TF-0006、不宣称联合系统 GA | **适用** | TF-0007 完成不是 TF-0006 解阻，也不是系统发布批准 | TF-0007 non-goals / summary |
| T7-03 | 关键组件 canary、kill/rollback 和审批负向证据 | **适用为证据方法** | 后续组件报告可以复用同类自动验收结构，但必须绑定当前候选和真实生产入口 | TF-0007 acceptance/evidence；TF-0009 v2 evidence |
| T9-01 | 三 profile 各 10/10、零未授权写入、SEKB 零确认写入、Browser 无审批绕过、kill/rollback 通过 | **历史证据有效** | 作为 agent-driven 受控内测基线；不能替代其他组件的新生产、收益、有效状态和回滚证据 | TF-0009；`docs/dev/tf0009-policy-decision-20260930.md` |
| T9-02 | 真人 0/10 是事实局限 | **适用为事实；不再作为 open/blocked 前置** | 不得把零真人升级成真人证据，也不得因缺真人阻止 agent-driven 验收 | 同上；AGENTS.md owner policy |
| T9-03 | 产品锁、C1 keep-off、Runtime Memory diagnostics-only、SEKB 自动写回禁用不变 | **适用于当前基线** | TF-0488 不改这些状态；后续节点若要改变，必须另行记录产品决策和回滚 | TF-0009 evidence；`docs/clawx-product-semantics.md` |
| T9-04 | TF-0009 的 done 是受控内测节点完成 | **适用为状态解释** | 不能外推为 GA、live/product 批准或任意组件默认毕业 | TF-0009 summary；`tf0009-policy-decision-20260930.md` |

## 3. `default-config-matrix.md`

| ID | 原始约束或事实 | 现行处理 | D9 后的含义与责任 | 依据 |
|---|---|---|---|---|
| DCM-01 | 矩阵是产品默认值单一来源；VToken、memory、SEKB、Browser 私网等当前值保持 | **适用** | 后续节点不得只改文档来“完成”翻转；实现、测试、矩阵与决策必须同一变更集一致 | `docs/dev/default-config-matrix.md` |
| DCM-02 | VToken、VToken bridge、working-memory、Runtime Memory 注入、SEKB、私网允许等通过显式 opt-in 开启 | **适用** | 组件默认毕业可以被评估；在这些组件的显式节点和证据完成前，当前值不变 | 同上；TF-0491/0493/0494/0497/0499/0503/0504 的后续范围 |
| DCM-03 | kill switch、fail-closed 读取、私网未确认值迁移到 deny | **适用** | 任何新默认能力都必须带可执行 kill/rollback，且不得绕过现有 fail-closed 迁移 | 同上；现有单元测试 |
| DCM-04 | “必须等 human-canary、soak 和联合系统 release gates 完整” | **收窄** | human-canary 真人前置已由 owner policy 取代；release/产品决策和 production/canary/rollback/effective-state 证据仍适用 | owner policy；`tf0009-policy-decision-20260930.md`；DCM tests |
| DCM-05 | 不得为了让测试变绿而翻转默认 | **适用** | 只允许因组件证据和显式决策翻转；TF-0488 本身只修订解释，不修改表格值 | TF-0488 non-goals；DCM tests |
| DCM-06 | synthetic / scripted-only 证据不足 | **适用** | agent-driven 证据可以进入验收；纯 synthetic 证据不能单独构成默认毕业结论 | context authority ADR；owner policy |
| DCM-07 | 默认毕业在 D9 范围内 | **新增现行解释** | 指可盘点、验证、裁决和后续实现；不是 TF-0488 自动翻值或 `defaultOn` 产品锁变更 | ADR §2；TF-0482/0490 后续计划 |

## 4. 既有 context authority ADR

| ID | 原始约束或事实 | 现行处理 | D9 后的含义与责任 | 依据 |
|---|---|---|---|---|
| CA-01 | DCS 是唯一上下文 admission/resolve/pack/compile authority | **适用** | Context 毕业必须通过 DCS，不新增第二 context 投影 authority | `docs/dev/adr/2026-08-16-context-authority-boundaries.md` §2 D2 |
| CA-02 | Mem 拥有持久语义记忆与检索；不拥有通用 ContextUnit 或全局 freshness | **适用** | Memory 产品化只能收敛存储、审阅、检索和注入职权，不能把 Mem 扩成第二 DCS | 同 ADR §2 D3 |
| CA-03 | Working Context 是版本化 Task Context Ledger，不是第二个记忆库 | **适用** | working-memory 毕业必须保留 task scope、版本和晋升边界 | 同 ADR §2 D4 |
| CA-04 | V3 只拥有能力 descriptor 发现元数据；Provider Guard 拥有最终 RequestEnvelope；Receipt 不承诺无条件重放 | **适用** | Capability、Browser、VerseShell 的后续节点不得新增第二执行/目录 authority | 同 ADR §2 D1/D5/D6 与 §3 |
| CA-05 | `accepted-in-principle`、实施仍未授权、现有 Receipt/approval 资产不是已闭合控制平面 | **状态保留** | D9 不声称这些阶段已实施或已毕业；后续节点激活后另有自己的实现与验收责任 | ADR 状态与 §2 D8 |
| CA-06 | 不新增第四个能力目录、第二上下文投影 authority、第三 durable memory writer；全局未登记旁路须可审计 | **适用为红线** | 任何 default/advanced 毕业都必须证明唯一 owner、生产消费者和 effect/audit 边界 | ADR §6；TF-0489/0490 后续计划 |
| CA-07 | 不用 synthetic/agent-surrogate 证据推进 default-on | **收窄** | owner policy 删除了“必须等真人”的要求；agent-driven 证据可使用且必须标 attribution。纯 synthetic-only 仍不足；实际 default 变更仍需显式决策和真实生产路径证据 | ADR redline；AGENTS.md；TF-0009 policy |
| CA-08 | Context authority 的“不翻默认、不宣称 GA” | **适用（当前基线）** | 当前默认值与发布状态保持不变；D9 不把内部组件毕业解释成 GA | 同 ADR §6 |

## 5. TF-0454 与组件接线

| ID | 原始约束或事实 | 现行处理 | D9 后的含义与责任 | 依据 |
|---|---|---|---|---|
| LU-01 | 22/22 目录条目有真实生产调用点，0 pending、0 missing、0 真未接线 | **适用为当前接线事实** | 后续毕业报告仍须绑定当前 commit/tree 和生产位点；不能把旧 audit 当成当前源码的永久证明 | `harness/specs/fixtures/landed-unwired-closeout/audit.json`；提交 `f930ee592` |
| LU-02 | `catalogs:check` 验证 executor 位点；接线不等于产品毕业 | **适用** | 接线是前置；默认/advanced 还需 canary、rollback、effective state、收益/必要性和显式处置 | TF-0454；TF-0490 后续计划 |
| LU-03 | 功能可通过 env/config 显式开启，不能未经裁决变成普通用户默认能力 | **适用** | 用户可见能力必须从隐藏 opt-in 走向唯一产品入口或明确 internal/experiment/retired；TF-0488 不重分类 | TF-0482 desired outcomes；D9 ADR |

## 6. 统一解释规则

1. **历史不重写**：矩阵中的“历史保留”只阻止未来误用，不删除原始裁决。
2. **默认毕业不是默认翻值**：TF-0488 只把默认模式的产品化决策路径纳入范围。实际运行时值、产品锁和默认配置在后续节点明确变更前保持原样。
3. **自动验收不是发布授权**：agent-driven canary、E2E、测量和磁盘回读可以替代等待真人；public release、GA、`liveReady`、`productApproved` 仍需单独授权。
4. **唯一 owner 优先**：任何后续实现都必须沿用现有 DCS/Mem/V3/Working Context/Provider Guard、权限和 effect owner；不得用本矩阵创建并行控制面。
5. **证据绑定当前候选**：旧 audit、旧 campaign 和旧测试通过只能作为历史输入；毕业报告必须绑定当前 commit/tree、构建、runtime generation、provider/model 和输入集。
6. **无主范围陈述为零**：新增实现、默认变更、发布声明或责任转移必须指向已激活 Task Forest 节点、精确路径、actor 和 evidence；不能归到本 ADR 自动执行。

## 7. Scope result

- D7、TF-0007、TF-0009、default-config-matrix、context-authority ADR 与 TF-0454 的现行关系均已逐条记录。
- TF-0488 的写入面仅限 `docs/dev/`、`docs/clawx-product-semantics.md` 和 `docs/dev/default-config-matrix.md`（含既有 ADR 路径）；Task Forest 的 proposal/status/export 是为收口执行的必要控制面变更。
- VerseGit 全部排除；没有修改 VerseGit 节点、worktree 或产品文件。
- 没有产品默认值或产品锁变更；没有执行 TF-0489 及之后的节点。