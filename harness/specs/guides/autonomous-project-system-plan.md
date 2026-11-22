---
id: autonomous-project-system-plan
title: 基于现有骨架与本体合同的高度自治项目系统节点规划
type: guide
appliesTo:
  - autonomous-project-system
  - session-derivation-ui
---

# 高度自治项目系统：骨架复用、任务图与实施合同

日期：2026-11-02；driven_by: agent；actor: codex/main。
本文件是用户授权的完整规划，不是实现验收。当前产品锁与冻结默认不变。新的产品行为由各叶子在原owner中实现；本轮仅修改规范与本地Task Forest。

## 已落图的编号与前置

本地规划映射：主目标TF-0664挂在TF-0571下；基础TF-0665、UI TF-0656、执行TF-0666、资源TF-0667、总控TF-0668、验收TF-0669。编号用于定位，实时状态仍由CLI读取，不构成构建依赖。

| TF节点 | 合同代码 | 交付 | 直接前置 |
|---|---|---|---|
| TF-0670 | A1 | 固定自治对象、角色职责与既有骨架的接入合同 | TF-0371、TF-0638、TF-0639 |
| TF-0671 | A2 | 为自动任务动作绑定可信身份、幂等操作与版本提交 | TF-0670、TF-0652 |
| TF-0672 | A3 | 把自动完成声明提交为可回读的任务验收 | TF-0671 |
| TF-0673 | A4 | 把强任务范围接入会话与协调器的真实 owner | TF-0672、TF-0552、TF-0553 |
| TF-0674 | A5 | 回读自治宿主与工具的实际生效能力并验证持续运行 | TF-0670、TF-0550、TF-0561 |
| TF-0675 | P1 | 让项目负责人从目标自动形成可验收任务与计划修订 | TF-0673、TF-0662 |
| TF-0676 | P2 | 按有效模型、权限和预算派发单项目执行会话 | TF-0675、TF-0674、TF-0679、TF-0553 |
| TF-0677 | P3 | 接通事件驱动续行、负责人换代与故障恢复 | TF-0676、TF-0554、TF-0559、TF-0561 |
| TF-0678 | P4 | 把独立核验、有限修复和任务收口接成项目闭环 | TF-0677、TF-0672、TF-0682 |
| TF-0679 | R1 | 把工具占用和预算预留接入现有资源准入 | TF-0671、TF-0674、TF-0394、TF-0560 |
| TF-0680 | R2 | 让浏览器任务按会话、账号和效果范围安全并发 | TF-0679 |
| TF-0681 | R3 | 让终端执行具有实际进程上限、端口占用和终止回执 | TF-0679 |
| TF-0682 | R4 | 治理工作树整合、成果保留与跨工具资源回收 | TF-0680、TF-0681、TF-0560 |
| TF-0683 | S1 | 在现有总控入口汇总项目、任务和资源的真实状态 | TF-0673、TF-0662、TF-0679 |
| TF-0684 | S2 | 让总控按项目配额调度并只升级真正需要决策的事项 | TF-0683、TF-0678、TF-0682 |
| TF-0685 | S3 | 通过配置操作员管理模型、工具和系统开关的生效状态 | TF-0683、TF-0671、TF-0674 |
| TF-0686 | M1 | 用既有上下文控制面维持负责人和执行会话的连续性 | TF-0677、TF-0556、TF-0558、TF-0640 |
| TF-0687 | M2 | 把任务经验经验证晋升并支持撤销与退化回滚 | TF-0678、TF-0686、TF-0653、TF-0655 |
| TF-0688 | V1 | 让目标到工具效果、成本和验收形成统一可查询追溯 | TF-0678、TF-0684、TF-0685、TF-0891 |
| TF-0689 | V2 | 验证单项目与跨项目自治的真实质量和可恢复边界 | TF-0688、TF-0687、TF-0662、TF-0887、TF-0889、TF-0890、TF-0892 |
| TF-0886 | P0 | 在任务拆解前接入有界预算 Research 探针、只读证据包与边际收益早停门禁 | TF-0673、TF-0674、TF-0679 |
| TF-0887 | P5 | 交付 Ask/Plan/Autopilot 会话收敛协议与写前结构化计划确认闭环 | TF-0675、TF-0886、TF-0662 |
| TF-0888 | P6 | 为波次调度器接入候选方案最优性评估与 CP-SAT/ILP/PDDL 有界求解适配层 | TF-0675、TF-0679、TF-0886 |
| TF-0889 | P7 | 在既有完成权威内接入非模型自证的确定性形式化核验与反例诊断适配层 | TF-0678、TF-0672 |
| TF-0890 | R5 | 交付远端分支与 Draft PR 异步受控委托、脱机后台推进及重连回执对账 | TF-0677、TF-0682、TF-0674 |
| TF-0891 | V1a | 建立结果→验收→候选→执行→计划/Research→目标的逆向归因追溯底座 | TF-0678、TF-0673 |
| TF-0892 | V2a | 交付方案最优率、资源浪费率、步骤冗余度与迭代收敛曲线度量套件 | TF-0891、TF-0888、TF-0889 |

UI旧链保留0657→0658→0659→0660→0661→0662；新增0670→0657、0673→0658。当前自治计划唯一ready叶为TF-0670；其他支线的ready不受本计划影响。

> 2026-11-22 增量注记：上段“当前自治计划唯一ready叶为TF-0670”为 2026-11-02 建图快照，非实时状态（提交史中 TF-0670..0674、TF-0675、TF-0677、TF-0678、TF-0679 已有实现或分支封存推进，已完成的 TF-0675 / TF-0678 不重开、不改历史结论；TF-0687 / TF-0688 / TF-0689 提交数仍为 0）。推理规划质量与形式化收敛新增子目标见 reasoning-planning-convergence-gap-plan（`harness/specs/guides/reasoning-planning-convergence-gap-plan.md`）。

## 目标与范围

用户交付目标后，System Agent跨项目协调，Project Agent负责拆解与验收，Session Agent执行具体任务。日常规划、工具操作、验证、修复、续行和收口由agent完成；重大范围/架构、发布、资金、凭据首次暴露/轮换及冻结策略变更保留真正决策。自动化证据必须标agent，不能等真人操作或冒充真人。

操作系统级表示应用内跨项目/全机资源管理范围，不表示管理员权限。首轮为Windows受控试点；不建立RDF/OWL、图数据库、第二任务库、第二调度器、第二权限系统或自由Agent Mesh。

本计划作为 TF-0571（Windows功能闭环补缺与自动验收）的新增受控自治子目标；保留其原有其他支线。TF-0656及0657–0662整体接入新目标作为体验分支，保留六节点编号、旧要求、旧证据和原有串行关系，不重开已完成历史结论。

## 已有骨架怎样复用

| 既有成果 | 本轮核对 | 新工作必须接在哪里 |
|---|---|---|
| TF-0371 身份与完成权威 | identity-scope.ts、project.ts、task-ledger-reference.ts | 复用品牌类型、ScopedRunId和单向引用，不再造身份服务 |
| TF-0622/0623、0633–0639 本体合同硬化 | product-semantics.ts已有版本、relationKey、可拒绝validator；check-evidence-refs已有候选/来源失效 | 自治对象只增加必需字段与消费者；静态关系不变成权限、调度或prompt注入 |
| TF-0489、0631/0632/0638 唯一职权 | component-authority-manifest与semantic-authority checker | Task/Memory/Knowledge/Permission/Browser各守owner，新增能力必须能定位最终执行点 |
| TF-0629/0630 接入裁定与门禁 | contract-check覆盖typed和legacy清单 | UI只用hostApi；新增自动动作经现有模块/registry，不新增扁平通道 |
| TF-0649已完成；0650进行中，0651/0652待实施 | Task Forest CLI当前读数 | A2等修改自动写入口的工作依赖0652，避免与正在迁移的host/mock路径争用 |
| TF-0394资源、0550–0562长期协调 | effective policy、binding、delegation、completion、cron、reclamation已有 | 补消费者、scope和恢复缺口，不重建这些子系统 |
| TF-0640会话生命周期、0653/0655 RSI | 阶段/注入/谱系/归因与安全锚点已有 | 会话UI与经验评估从既有机制接线，不另做通用上下文/学习内核 |

节点状态来自本地CLI，文档快照可能滞后。完成历史只证明原范围曾收口，不替代新候选验收。原研究包的宿主故障在A5重新探测，不能照抄成当前事实。

## 五层骨架与三个产品入口

- L1：既有OpenClaw、Browser、VS、Git、TaskLoop、资源与记忆运行owner。
- L2：Project/Workspace/Session/generation/ScopedRun/TaskRef；System/Project/Session为职责scope。
- L3：任务完成、权限、记忆接受、配置生效等唯一权威；状态投影不能授予权力。
- L4：统一Host API与现有准入路径；自动动作绑定可信principal、版本、预算与幂等operation。
- L5：source/candidate/digest/actor/effect/evidence的可回读链与失效；直接消费现有校验器。

三个入口读取同一组owner：总控看项目组合，项目负责人看目标与任务，会话看当前任务、资源和执行。统一输出分结果摘要→任务报告→技术追踪，不复制原始状态。

## 关键语义

1. 每个会话都有任务容器；自由讨论允许空，首个副作用前由agent自动建任务并准入。
2. Ledger是任务事实owner，但当前一般CRUD不是自动验收gate。手工done、turn-check done、run结束、自动业务任务验收必须分开。
3. Task Forest与Ledger通过带authority的引用或不拥有完成状态的execution anchor衔接；不双向镜像done。
4. 相同逻辑操作重试复用持久operation/key；相同payload的新合法意图有新key。payload hash仅检查同key异参。
5. lease过期不表示旧进程消失；fencing由实际资源owner执行，确认效果隔离后才能分配给新writer。
6. 先用已有授权自动运行；不得为每次调用或每个低风险步骤重新打断人。重大决策呈现具体影响、推荐方案和回退。
7. candidate、静态登记、类型通过、UI成功、exit0与accepted均不能单独证明业务完成。
8. 全局静态合同、Owner运行权限、实际工具能力分别验证；已落地本体合同不因此变成动态授权服务。
9. A3的验证决定引用既有TaskLoop、任务验证与效果owner记录，绑定taskRef、verified candidate、checks、reviewer和revision；不新增CompletionDecision权威服务或独立decision store。
10. A4须验证连续10轮普通讨论不创建业务task；明确执行意图才建立一个幂等主任务及必要checks。现有turn记录不能伪装成新增业务任务。
11. R1须验证删除统一层缓存后可从实际owner重建；该层不持有权威leaseState/workflowState/effectOutcome，不能凭缓存空闲或TTL释放真实占用。
12. A1须验证只修改静态registry的owner/allow不能放行工具；实际owner缺失必须fail closed。

## 依赖与执行纪律

A1先固定合同；0657随之交付读模型。A2依赖现有0652的接入收敛；A2→A3→A4形成可信动作、验收和强任务绑定。0658在A4后提供项目入口与任务清单，0659→0660→0661→0662保留原顺序。

A5探测实际宿主；R1在A2/A5后提供最小资源准入。P1在A4/0662后规划；P2依赖P1/A5/R1启动单项目单writer；P3续行；R2/R3分别补VB/VS，R4整合/回收；P4在P3/R4后完成项目闭环。S1只读总控可在0662/R1后交付，S2在P4/R4后扩大跨项目，S3受控配置。M1/M2复用上下文与RSI；V1追溯；V2同候选最终验收。

2026-11-22 推理规划与收敛增量链（不重开已封存的 TF-0675 / TF-0678）：按“统一追溯 > 预算化 Research > 规划与形式化核验 > 长程验证”优先序，V1a（TF-0891）在 A4/P4 后先行打通单项目六级逆向归因底座并汇入 V1（TF-0688）；P0（TF-0886）在 A4/A5/R1 后提供规划前有界 Research 门禁；P5（TF-0887）与 P6（TF-0888）在 P1/P0 后分别补齐 Ask/Plan/Autopilot 写前确认协议与候选最优性/Solver Adapter；P7（TF-0889）在 A3/P4 后向既有 EvidenceVerifier 注入确定性形式化核验；R5（TF-0890）在 A5/P3/R4 后提供受控远端分支与 Draft PR 异步委托；V2a（TF-0892）在 V1a/P6/P7 后交付收敛质量度量套件并汇入 V2（TF-0689）。详细契约见 `harness/specs/guides/reasoning-planning-convergence-gap-plan.md`。

DAG表达真实前置，不为了排版把无关工作串联。一个实施会话只推进一个ready叶子；本次仅将A1设ready，0657因新增A1前置转proposed，其他新叶子proposed。TF-0650/0663等其他支线状态保持。未来满足依赖时按优先级选择下一个叶子，不能把proposed视为已授权并发写。

## 657–662的直接调整

### TF-0657 补齐会话谱系、项目范围与任务引用的单一前端读模型

保留原全部验收，新增：

- 自治规划增量：同时投影project/workspace、session/generation、taskRef和freshness；复用既有品牌类型与owner引用，不把TaskLedger sessionLinks当谱系。
- 本叶只读投影；强任务持久绑定与副作用准入由A4交付，不在Renderer补写权威。

新增验收：

- 已有任务关联、尚无任务的discussion、无法读取owner、stale/generation-mismatch分别可表达；不可把空任务或unknown默认为已完成。
- 按project/workspace/session键隔离加载和缓存，不新增逐行activity轮询，不从标题或ID字符串猜角色/归属。

必要增量写集（实施前核实）：shared/types/identity-scope.ts；shared/types/task-ledger-reference.ts；tests/unit/session-task-scope-projection.test.ts（拟新增）。

新增前置：A1。

### TF-0658 交付项目负责人入口、会话家族导航与常驻任务清单

保留原全部验收，新增：

- 自治规划增量：项目行disclosure与名称链接拆开；名称进入项目负责人页面，显式project/workspace与coordinator anchor。
- 复用现有Chat、TaskLedgerSummaryPanel、ResourceChip、角色和worker面板；通过scope props消除全局currentSession/default main污染。
- 本叶提供真实绑定、只读任务/活动与既有受控操作入口；目标自动拆解/主动派发分别由P1/P2实现，不显示虚假自治成功。

新增验收：

- 点击项目名到正确负责人；切项目/会话保留草稿和阅读位置，错误workspace结果不能覆盖当前页。
- 每个会话有任务容器；discussion为空有明确文案，执行会话显示当前任务/全部任务/验收和来源，任务状态只从owner读取。
- 已有/未绑定负责人、首屏空态、loading/failed/stale/permission不可用均可见；窄窗任务抽屉与键盘操作有Electron证据。

必要增量写集（实施前核实）：src/App.tsx；src/pages/Projects/**（新页面路径由实施确定）；src/components/task-ledger/**；src/components/chat/ResourceChip.tsx；src/components/agents/RolesOrchestrationPanel.tsx；tests/e2e/project-agent-entry.spec.ts（拟新增）。

新增前置：A4。

### TF-0659 让分支与续接携带任务范围并可恢复创建和发送

保留原全部验收，新增：

- 自治规划增量：Fork/Handoff展示将继承的TaskRef与上下文来源；不继承写claim、资源lease或跨scope授权。
- 现有交互式Fork预填不自动发送/Handoff明确创建并发送保持；后续自治使用同一typed operation并消费既有grant，不解析模型文本触发。

新增验收：

- Fork child默认仅有关联/只读职责，写前经A4重新准入；handoff关联与generation换代可对账，旧执行权不可继续用。
- 同逻辑操作重试复用持久key；同payload的新合法意图可单独创建，key不只由payload hash派生。

必要增量写集（实施前核实）：shared/types/task-ledger.ts；tests/unit/session-task-scope.test.ts（A4提供）。

### TF-0660 展示任务驱动的子代理执行、验收回交与父会话续行

保留原全部验收，新增：

- 自治规划增量：worker roster与活动面板按显式project/session作用域读取，显示负责TaskRef、模型、资源、队列原因和结果证据。
- 显示admission、运行、report、verification、Task owner接受、parent continuation各层事实，未知能力不伪造控制按钮。

新增验收：

- 同项目多个coordinator/worker不串任务，项目与会话视图来自同一owner；实际运行模型可见，未知费用不填0。
- accepted/text/exit0/turn-check done均不能提升为业务任务已验收；从任务可定位worker transcript和相关产物。
- 有scope无新grant的既有授权操作不反复要求用户确认；无授权或不可用能力明确阻止，不把状态投影变成许可。

必要增量写集（实施前核实）：src/components/agents/RolesOrchestrationPanel.tsx；src/components/task-ledger/**。

### TF-0661 统一会话与任务控制、资源退出和上下文恢复的交互边界

保留原全部验收，新增：

- 自治规划增量：区分暂停新派发、停止run、取消task、归档session、紧急停止，各自只调用owner已支持的动作。
- 展示实际scope/generation、pending/confirmed/failed/unknown/recovery-required，资源回收详情只读原owner；未实现全局kill不能伪装可用。

新增验收：

- 停止/取消不会先显示成功再等待后端；暂停与恢复竞态依实际版本和有效策略裁决。
- 归档不标任务done、不隐式级联孩子、不删除被任务引用的唯一产物；dirty/未推送资源保留或明确阻止回收。
- 上下文token、进程RAM和accepted memory分别展示；compact/checkpoint恢复不是新谱系关系。

必要增量写集（实施前核实）：src/components/chat/ResourceChip.tsx；src/pages/Chat/SessionActivityPanel.tsx；现有long-session-resource-reclamation只读接口。

### TF-0662 验收项目入口、任务清单和会话生命周期的完整体验

保留原全部验收，新增：

- 自治规划增量：本节点只验收A4与U1-U5已接通的项目/任务/会话体验；完整自主规划/跨项目/工具效果由V2验收，不以此节点代替。

新增验收：

- 同一候选覆盖项目名→负责人→任务清单→父/子会话→来源→产物往返，跨scope切换与空/错/stale状态均测试。
- 增加任务绑定/写claim不继承/自动验收与turn记录区分/归档保留证据负例；mock与真实Gateway证据分开。
- 所有新增UI在各自叶子已交付E2E，本节点聚合重跑；保留原视觉、2/20/100后代及性能预算，不降低旧验收。

必要增量写集（实施前核实）：tests/e2e/project-agent-entry.spec.ts（U2提供）。

## 新增实施叶子

以下代码仅为本合同稳定索引，实际TF编号由CLI分配并在本地任务图中关联。每个节点的evidence在实现前仅是规划来源，不是pass。

### 把自治对象接到既有身份、权限和完成权威

#### TF-0670 / A1 固定自治对象、角色职责与既有骨架的接入合同

目的：让 System/Project/Session 三种职责使用现有身份与 owner，并给后续节点一个可拒绝错误组合的合同。

骨架位置：L2 身份范围 + L3 语义权威。前置：TF-0371、TF-0638、TF-0639。

复用与必要写集：shared/types/identity-scope.ts；shared/types/project.ts；shared/types/task-ledger-reference.ts；shared/component-authority-manifest.ts；shared/product-semantics.ts；shared/host-api/contract.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 逐一映射 Project、Workspace、SessionKey/generation、ScopedRunId、TaskRef、Action、Effect、Evidence、ResourceRef 的既有 owner、真实消费者和 source anchor。
- System/Project/Session是角色与scope，复用Agent/RoleContract，不新增Actor/ID注册服务或通用本体运行时。
- 静态关系只校验语义；运行权限和effective能力始终由实际宿主/工具owner判定。

验收：

- 所有新跨边界引用有owner discriminator，拒绝裸taskId、跨workspace引用和陈旧generation。
- Project保持显式1:1兼容映射；Task Forest external ref与Ledger事实单向关联，无双向状态同步。
- 现有ontology validator、authority checker、contract check通过；正例和逆权威/伪授予负例可回读。

必须拒绝或明确诊断：静态关系伪造执行授权；Run完成冒充Task验收；任意ProjectId当WorkspaceId。

测试入口：tests/unit/identity-scope.test.ts；tests/unit/task-ledger-reference.test.ts；tests/unit/component-authority-manifest.test.ts；tests/unit/product-semantics.test.ts。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/a1/ 下的 object-owner-consumer-map.json；contract-negatives.json；source-inputs.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：撤回新增合同消费点，已有ID字节、schema和运行默认保持；来源冲突不靠豁免通过。

#### TF-0671 / A2 为自动任务动作绑定可信身份、幂等操作与版本提交

目的：让模型发出的任务动作可归因、可重试且不会覆盖另一执行代的变更。

骨架位置：L4 单一接入 + L2 请求范围。前置：A1、TF-0652。

复用与必要写集：electron/services/task-ledger-api.ts；electron/services/task-ledger-service.ts；shared/types/task-ledger.ts；shared/host-api/contract.ts；src/lib/host-api.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 身份从已有host/runtime principal派生；模型不能自报user/system完成归因。
- 首次持久化operationId；同逻辑动作重试复用key，同参数新意图允许新key；同key异payload拒绝。
- 基于已有持久日志补workspace级串行提交与expectedRevision或等效CAS；批次内多个合法事件共享batch key不被误删。

验收：

- 自动create/link/update经受控路径记录agent身份；现有手工编辑保留其真实身份和语义。
- 两个陈旧revision写入恰一个成功；并发重复operation、追加后崩溃、projection损坏均可恢复且无重复逻辑效果。
- Host API/facade/service合同一致；不新增扁平IPC/renderer直连，不新建任务数据库。

必须拒绝或明确诊断：伪造actor；同key异参；合法同参数新操作被误去重；批次部分提交后重放。

测试入口：tests/unit/task-ledger-service.test.ts（按开工实际文件复用）；拟新增tests/unit/autonomy-task-actions.test.ts；tests/unit/host-api-facade.test.ts。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/a2/ 下的 task-action-receipts.json；concurrent-replay.json；crash-recovery.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：禁用新增自动写入口，保留既有日志与人工编辑；不得重写历史actor或批次。

#### TF-0672 / A3 把自动完成声明提交为可回读的任务验收

目的：区分手工状态、turn记录、run终态与自动任务验收，防止文本或事件直接升级为完成。

骨架位置：L3 完成权威 + L5 证据失效。前置：A2。

复用与必要写集：electron/services/task-ledger-api.ts；electron/services/task-ledger-service.ts；electron/main/index.ts；shared/types/identity-scope.ts；openclaw_runtime/src/agents/task-loop-controller.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 只对自动业务任务完成路径施加completion claim；不盲目禁止turn check的done或重写旧手工状态。
- Task Loop现有gate结果仍由既有owner生成；提交侧核验可信来源、候选版本、验收清单和证据引用。
- 证据绑定source/input/config/dirty-diff、run/effect、reviewer和有效期；整合后候选变化使相关验收失效。

验收：

- complete+repair/blocked/unavailable不能产生自动验收done；单纯accepted/exit0/text也不能。
- 证据缺失、篡改、来源过期、错误任务、旧generation被拒；验收成功可从磁盘和owner事件重算。
- 保留TaskLedger任务事实与Workboard/TaskLoop调度状态分离；一般编辑不被伪装成独立验证。

必须拒绝或明确诊断：模型自证passed；旧分支证据验收新合并候选；伪造verifier；缺失artifact。

测试入口：tests/unit/identity-scope.test.ts；拟新增tests/unit/autonomy-task-completion.test.ts；既有task-loop evidence gate回归。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/a3/ 下的 completion-claims.json；candidate-binding.json；negative-verdicts.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：停止自动完成提交，任务保留review/unknown与真实产物；不把缺证据的任务直接设done。

#### TF-0673 / A4 把强任务范围接入会话与协调器的真实 owner

目的：让每个会话有任务容器、每个执行run有真实任务引用，用户不必先手工填写任务表。

骨架位置：L2 会话任务绑定 + L4 准入。前置：A3、TF-0552、TF-0553。

复用与必要写集：shared/types/task-ledger.ts；shared/types/workspace.ts；shared/types/session-delegation.ts；electron/services/workspaces-api.ts；electron/services/session-delegation-admission.ts；electron/services/sessions-api.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 复用sessionLinks/coordinator binding承载TaskScope；discussion容器可空，执行前自动建任务并准入。
- coordinator/executor/verifier/observer职责明确；一个任务一个有效写claim，子任务可独立执行。
- 外部Forest任务经CLI适配或只含externalRef的execution anchor，完成权威不镜像到两个账本。

验收：

- 新会话、讨论转执行、已有任务进入、派发、handoff、fork均有可追溯任务绑定。
- Fork不会继承有效写claim/lease；Handoff换代后旧执行者不能继续写；工作组移动不改任务归属。
- 任务引用缺失/跨项目/已失效时副作用被拒；UI可读取空/不可用/陈旧状态。

必须拒绝或明确诊断：无任务副作用；同任务双执行者；externalRef冒充Ledger完成；标题推断任务身份。

测试入口：既有long-session-coordinator-binding与delegation单测；拟新增tests/unit/session-task-scope.test.ts。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/a4/ 下的 session-task-binding.json；task-authority-adapter.json；admission-negatives.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：关闭自动执行准入，讨论和既有会话仍可读取；保留任务和externalRef，不删除成果。

#### TF-0674 / A5 回读自治宿主与工具的实际生效能力并验证持续运行

目的：在模型执行前知道runtime、工具、预算和后台能力是否真实可用，而不是从静态清单推断。

骨架位置：L1 实际运行 + L5 当前证据。前置：A1、TF-0550、TF-0561。

复用与必要写集：electron/services/workspace-preflight.ts；electron/services/sessions-api.ts；electron/gateway；openclaw_runtime/src/config；shared/types/session-effective-policy.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 复用preflight/effective policy/capability描述，明确supported/unsupported/unknown及probe来源和时间。
- 重测当前embedded runtime/CLI来源、配置schema、Gateway/cron/service；原研究包配置故障仅作待核对线索。
- 有缺口时做保留语义的备份/迁移/readback；使用已具备权限，不擅自安装管理员服务或改变冻结default。

验收：

- 一次isolated run与受控continuation有实际回执；UI关闭后的持续执行、重启恢复分别测量。
- 工具声明与实际adapter不符/未测budget/缺失service不能被投影为可用；失效状态回到现有诊断。
- 配置修复失败可回滚，UFTK等既有字段不盲删；无需用户亲自点UI验证。

必须拒绝或明确诊断：descriptor当runtime授权；旧探针当当前健康；保存配置成功当reload成功。

测试入口：既有workspace-preflight/effective-policy/restart journeys；精确host readiness smoke（开工固定命令）。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/a5/ 下的 effective-capability-snapshot.json；host-readiness.json；restart-smoke.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：恢复配置备份，禁止新自治run但保留交互能力；不为环境失败放宽验收。

### 让项目负责人自动规划、执行、验证和续行

#### TF-0675 / P1 让项目负责人从目标自动形成可验收任务与计划修订

目的：把用户目标变成现有TaskLedger/Forest里的任务、依赖和验收，减少人的拆解与协调。

骨架位置：L3 任务计划 + L4 受控写入。前置：A4、TF-0662。

复用与必要写集：openclaw_runtime/src/agents/role-contract.ts；openclaw_runtime/src/agents/orchestrator；electron/services/task-ledger-api.ts；src/components/agents/RolesOrchestrationPanel.tsx。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 负责人使用稳定coordinator binding；读取已有任务/事实后规划，不创建无限增长的特殊聊天。
- 保守补齐可推断假设；重大范围决定集中为具体决策卡，日常拆解不反复询问。
- 计划修订有版本、理由、影响任务和追加历史；不悄悄删除已完成节点或更换验收标准。

验收：

- 自然语言目标生成owner持久任务、依赖、acceptance和下一步；重复输入可解释为重试或新目标。
- 目标含糊时记录假设并推进安全工作；需求变更不会串用旧任务证据。
- 项目页展示实际计划与修订，来自同一任务owner，非工具临时plan复制。

必须拒绝或明确诊断：把无法确定的事实写confirmed；拆分无限递归；重规划掩盖失败。

测试入口：拟新增project-agent-planning单测；拟新增tests/e2e/project-agent-loop.spec.ts（随首次UI执行交付）。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/p1/ 下的 goal-plan-revisions.json；task-graph-refs.json；assumption-decisions.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：暂停自动规划写入，保留任务图和版本；可继续人工/agent检查既有任务。

#### TF-0676 / P2 按有效模型、权限和预算派发单项目执行会话

目的：项目负责人能够自动选择ready任务、模型和角色，并在预算内真正启动有隔离的执行会话。

骨架位置：L4 准入 + L1 执行。前置：P1、A5、R1、TF-0553。

复用与必要写集：electron/services/session-delegation-admission.ts；electron/services/sessions-api.ts；openclaw_runtime/src/agents/orchestration-resource-scheduler.ts；src/components/agents/RolesOrchestrationPanel.tsx。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 复用RoleContract、允许模型集合与sessions.delegate；模型选择有理由和预算，无需用户每次挑模型。
- 首个canary单writer，worktree/checkout由owner核实；无隔离证明退回串行。
- reserve→persist intent→dispatch→receipt→reconcile沿现有owner衔接；有界fan-out/depth，避免重复spawn。

验收：

- 一个真实任务从负责人派发到worker产生日志/修改/usage，accepted与running/completed显示分离。
- 同operation重试不重复启动；超限/无scope/错generation/预算未知按合同拒绝或等待。
- 模型限流可在允许集合内有界降级，记录实际provider/model/effort和成本缺测。

必须拒绝或明确诊断：并发越预算；角色提示词扩权；回执丢失后双spawn。

测试入口：既有delegation-admission与resource-scheduler单测；project-agent-loop Electron主旅程。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/p2/ 下的 dispatch-admission.json；model-route.json；usage-reservation.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：停止新派发，保留已确认run/lease，未知结果先reconcile。

#### TF-0677 / P3 接通事件驱动续行、负责人换代与故障恢复

目的：执行完成、等待结束或故障恢复后自动推进，不依赖人返回会话输入继续。

骨架位置：L1 生命周期 + L2 generation。前置：P2、TF-0554、TF-0559、TF-0561。

复用与必要写集：openclaw_runtime/src/agents/goal-wake*；openclaw_runtime/src/agents/mission-control；electron/services/sessions-api.ts；electron/services/workspaces-api.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 复用现有continuation/cron/goal-wake，不新增scheduler authority，不解冻未批准默认。
- 完成事件、进程退出、timer统一关联逻辑任务；durable去重、idle barrier、generation fence。
- 区分pause-dispatch、cancel-run、cancel-task与recovery-required；按任务拥有资源传播取消。

验收：

- 子完成触发一次有效续行；重复/乱序/迟到事件不能覆盖新generation或重复副作用。
- 中断模型、宿主重启、负责人handoff后从已确认checkpoint恢复；恢复前核对资源和in-flight effects。
- 重试有预算/次数/根因上限，自动做其他ready任务；可恢复故障不要求真人操作。

必须拒绝或明确诊断：僵尸旧负责人继续写；timer风暴；取消后又自动续行；未知effect盲重试。

测试入口：既有long-session completion/restart/goal-wake测试；project-agent-loop故障注入旅程。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/p3/ 下的 continuation-events.json；reconcile-report.json；cancel-cascade.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：停止续行触发，保留checkpoint与in-flight诊断；控制通道保持可用。

#### TF-0678 / P4 把独立核验、有限修复和任务收口接成项目闭环

目的：从执行产物走到独立验证、必要修复、整合后复验和自动收口，交付可查看结果。

骨架位置：L3 验收 + L5 证据。前置：P3、A3、R4。

复用与必要写集：openclaw_runtime/src/agents/task-loop-controller.ts；electron/services/task-ledger-api.ts；现有TaskForest CLI适配；src/components/task-ledger；src/components/agents。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 任务选择既有TaskLoop或一般orchestration路径，不能未经合同混用两种完成语义。
- 验证者读取固定candidate和磁盘产物；不同actor不宣称统计独立，结合负例和真实检查。
- 修复在原范围/预算内；owner提交任务完成，Forest走proposal/current hash/validate/export，不解析模型文本改done。

验收：

- 真实改动包含一次失败修复、测试、独立review和最终candidate回读；结果包可复算。
- 合并后重新验证受影响检查；旧证据/缺失产物/评审不通过保持review或明确失败。
- 项目负责人报告已验证、未测、残留和下一步；任务收口无需用户催促，发布仍独立。

必须拒绝或明确诊断：implementer自评当独立验收；修复循环超预算；验证旧候选却交付新候选。

测试入口：既有TaskLoop evidence gate与任务完成单测；project-agent-loop正向/故障完整旅程。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/p4/ 下的 fixed-candidate.json；verifier-report.json；repair-history.json；task-closeout.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：停止自动closeout，保留diff/工作树/证据，不把未通过任务丢弃。

### 让工具和工作环境支持有界并发与安全回收

#### TF-0679 / R1 把工具占用和预算预留接入现有资源准入

目的：让跨会话资源和成本有有效上限，保留现有调度器，避免各worker各自认为预算充足。

骨架位置：L1 资源owner + L4 admission。前置：A2、A5、TF-0394、TF-0560。

复用与必要写集：electron/services/resource-fabric.ts；electron/services/resource-tracker.ts；openclaw_runtime/src/agents/orchestration-resource-scheduler.ts；shared/types/session-delegation.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 资源清单为Git/Browser/Process/Provider owner投影；owner-issued lease/fence，不建第二资源事实库。
- 复用已有Fabric/capacity/wave原语，以宿主/项目/会话分层预留和reconcile扩展缺口。
- 多资源固定顺序/失败补偿，排队公平和等待老化；控制/取消通道不被工作队列占满。

验收：

- 已有writeSet缺失推迟逻辑保留；隔离证明从实际worktree owner获得，不能只信调用者bool。
- 并发预算reserve无超额双花；unknown成本单列；资源等待可归因且无饥饿。
- lease过期先fence和确认旧执行隔离再重分配；可读占用和真实effective cap。

必须拒绝或明确诊断：TTL过期即允许双writer；未测上限当无限安全；资源申请死锁。

测试入口：既有ResourceFabric/resource-scheduler单测；拟新增resource-admission并发故障测试。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/r1/ 下的 effective-resource-limits.json；lease-ledger-refs.json；fairness-contention.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：降级到已验证串行cap，保留未知资源，不能误杀非managed进程。

#### TF-0680 / R2 让浏览器任务按会话、账号和效果范围安全并发

目的：多个agent使用VB时不抢同一tab或污染登录状态，失败后能辨认实际效果。

骨架位置：L1 VB + L2 scope + L4 effect。前置：R1。

复用与必要写集：packages/versebrowser/src/engine/service.ts；packages/versebrowser/src/engine/task-service.ts；packages/versebrowser/src/core/filesystem-boundary.ts；electron/services/agent-browser-api.ts；electron/gateway/agent-browser-bridge.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 区别tab/session/context/profile/服务端账号对象，不把独立tab等同账号隔离。
- 同tab操作串行；profile/auth状态变更独占并带epoch；读操作按真实副作用分类，不仅看HTTP方法。
- 能力表、TaskRef、effect receipts、取消/重启对账贯通原VB owner；未知提交不盲重发。

验收：

- 同tab争抢被排队/拒绝，不同隔离session按能力并发；profile登录变更使旧动作失效。
- 相同网站对象写操作有逻辑operation去重；网络timeout后先回读结果，不能重复提交。
- 断连/取消/任务恢复留业务结果边界；vault/凭据不进日志，异常状态可恢复。

必须拒绝或明确诊断：tab隔离却共享cookie串任务；登录态改变后旧授权执行；页面timeout重复外部提交。

测试入口：现有agent-browser owner/bridge测试；拟新增VB并发与effect-reconcile实际浏览器旅程。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/r2/ 下的 browser-resource-matrix.json；profile-fence.json；browser-effect-recovery.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：浏览器写操作退到同scope串行，保留session和未知effect用于核对。

#### TF-0681 / R3 让终端执行具有实际进程上限、端口占用和终止回执

目的：让VS和终端在多项目下可控运行，避免资源失控、串输入和取消后残留。

骨架位置：L1 VS/Terminal + L4 admission。前置：R1。

复用与必要写集：openclaw_runtime/src/agents/verseshell/managed-process-capacity.ts；openclaw_runtime/src/agents/verseshell/process-manager.ts；openclaw_runtime/src/agents/verseshell/governed-exec.ts；electron/services/terminal-api.ts；electron/services/resource-tracker.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 复用VS instance capacity/ACI/Job Object和终端owner，不另造shell或大锁；explicit effective cap由配置operator管理。
- 隔离cwd/env/process group/输出目录，端口先claim后launch；同PTY输入按owner串行。
- cancel作用到正确owned process tree，background与foreground不同语义明确；不能把transport ok/exit0当业务完成。

验收：

- 多workspace同时执行仍受真实宿主cap；端口冲突与共享目录冲突可诊断。
- Windows真实进程树取消、deadline、restart与owner退出有终止/清理回执；不控制未知PID。
- 保留标准Windows环境；TEMP/TMP走D盘；输出截断有artifact定位。

必须拒绝或明确诊断：取消ACI却遗漏后台进程；多个workspace各占满全机；PTY输入串到另一任务。

测试入口：既有VerseShell process/capacity/governed-exec测试；真实Windows进程/端口故障旅程。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/r3/ 下的 process-capacity.json；port-reservation.json；termination-receipts.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：受控串行执行；无法确认清理则recovery-required，不冒充终止成功。

#### TF-0682 / R4 治理工作树整合、成果保留与跨工具资源回收

目的：让并发任务拥有独立工作环境，结果整合和资源退出不损坏用户成果或唯一证据。

骨架位置：L1 Git/资源 + L5 保留证据。前置：R2、R3、TF-0560。

复用与必要写集：electron/services/git-api.ts（按实际owner收窄）；electron/services/long-session-resource-reclamation.ts；shared/long-session-resource-reclamation.ts；electron/services/resource-tracker.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 复用Git/worktree owner建立task/claim/branch/checkout归属，不扫描目录名猜占用。
- 同目标分支整合队列串行，冲突自动分析并在授权范围修复，整合后固定新candidate。
- 回收核对活跃run/lease、dirty/未推送成果、evidence refs和保留期；非managed资源不删除。

验收：

- 两个独立worktree执行互不覆盖；相同目标分支整合结果复验且证据绑定新candidate。
- 归档/取消不误删dirty或被验收引用的产物；重复回收幂等，失败保留可恢复记录。
- 工作树、VB、VS、端口的释放状态统一可查但由各owner执行，不建第二清理权威。

必须拒绝或明确诊断：未推送成果误删；清理删除唯一artifact；TTL后旧writer仍写；合并成功但测试用旧树。

测试入口：既有Git/worktree和long-session resource-reclamation测试；两工作树整合及故障回收旅程。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/r4/ 下的 worktree-ownership.json；integration-candidate.json；resource-reclamation.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：暂停自动整合/删除，保留worktree与回收计划，继续只读诊断。

### 让系统总控协调跨项目工作与生效配置

#### TF-0683 / S1 在现有总控入口汇总项目、任务和资源的真实状态

目的：让用户直接和System Agent交互，快速了解各项目目标、下一步、资源和需决策事项。

骨架位置：L3 投影 + L4 Host API + UI。前置：A4、TF-0662、R1。

复用与必要写集：src/components/agents/RolesOrchestrationPanel.tsx；src/components/layout/Sidebar.tsx；src/App.tsx；electron/services/workspaces-api.ts；src/lib/host-api.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 复用现有MissionControl表现与Host入口，显式system/project scope和anchor，不把default main session当所有项目负责人。
- Portfolio仅联合读取owner summaries/refs；首版不创建新项目任务库，不复制原始transcript。
- 每个workspace有独立loading/error/freshness；资源与成本unknown不写0；通知按意义合并。

验收：

- 至少两个项目的摘要可追到Task/Session/Evidence owner，单项目不可用不清空全局列表。
- 点击项目名称进入正确负责人，返回保留视图；项目/系统角色与权限范围清楚。
- 四语、明暗/窄窗/键盘Electron E2E；只读总控不存在隐藏dispatch或配置写入。

必须拒绝或明确诊断：active workspace污染其他项目；缓存旧结果覆盖新scope；静态能力当当前可用。

测试入口：拟新增tests/e2e/system-agent-portfolio.spec.ts；scope-aware read-model与stale-response单测。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/s1/ 下的 portfolio-owner-projection.json；ui-e2e-report.json；screenshots；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：总控页不可用时保留项目入口；只读失败显示unavailable，不影响执行owner。

#### TF-0684 / S2 让总控按项目配额调度并只升级真正需要决策的事项

目的：用户交付跨项目目标后，系统自动分配执行机会、处理普通阻塞并汇总关键结果。

骨架位置：L4 跨项目准入 + L3 目标。前置：S1、P4、R4。

复用与必要写集：现有MissionControl/orchestrator入口；electron/services/session-delegation-admission.ts；electron/services/resource-fabric.ts；现有Inbox/notification owner。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- System只派发project-scoped intent，Project负责人保有本项目任务计划与执行责任。
- 公平队列、预算预留、优先级/等待老化、circuit breaker复用现有scheduler/资源原语。
- 全局pause与项目resume按版本/有效策略裁决；常规恢复不通知轰炸，重大范围/发布/资金/凭据决策才升级。

验收：

- 两个项目真实任务运行与故障隔离；三个项目争用无永久饥饿，资源等待有明确owner。
- 全局暂停立即阻止新副作用准入，在途策略可见，项目不能绕过全局限制。
- 任务/成本/通知均归因；scope外动作拒绝，不因系统Agent身份获得任意文件写权限。

必须拒绝或明确诊断：跨项目代写；重试风暴；暂停后新dispatch；同资源重复预留。

测试入口：system-agent-portfolio执行/暂停旅程；公平性/预算/跨scope故障测试。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/s2/ 下的 cross-project-dispatch.json；fairness-budget.json；decision-notification.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：总控降为只读；在途任务按既有owner安全停止或完成，保留审计。

#### TF-0685 / S3 通过配置操作员管理模型、工具和系统开关的生效状态

目的：把日常配置操作交给agent，同时清楚展示期望、持久配置和运行时生效值。

骨架位置：L3 权限 + L4 配置 + L5 readback。前置：S1、A2、A5。

复用与必要写集：electron/services/providers-api.ts；electron/services/providers/provider-runtime-sync.ts；electron/utils/config-mutex.ts；现有MCP/cron/settings owner；shared/types/session-effective-policy.ts。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 只接收typed patch，preview/schema/policy/digest/backup/apply/reload/readback/rollback同一owner路径。
- 允许模型/工具/项目额度范围内自动调整；新增付费、全局扩权、冻结默认和产品锁不自动变更。
- 凭据仅使用host引用和既有注入；不可把agent传入secret写进摘要或日志。

验收：

- 有效项目patch生效并回读；schema错误、陈旧revision、同key异patch、reload失败均真实反馈/回滚。
- UI展示desired/configured/effective及限制来源，保存成功不冒充runtime成功。
- 只读配置/预览不产生副作用，未授权扩大权限和自改evaluator被拒。

必须拒绝或明确诊断：自改审批策略；config存了但runtime没加载；密钥泄漏；成本未知自动启用付费。

测试入口：既有provider/config-mutex/effective-policy测试；拟新增config-operator Electron正负旅程。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/s3/ 下的 config-preview.json；effective-config-receipt.json；rollback-report.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：恢复版本备份并readback；无法确认则degraded，停后续配置写。

### 验证记忆复用、追溯和持续自治的完整效果

#### TF-0686 / M1 用既有上下文控制面维持负责人和执行会话的连续性

目的：长任务换代和多会话协作时无需用户复制背景，且上下文成本和机器内存分别可解释。

骨架位置：L1 Context/Memory + L2 范围。前置：P3、TF-0556、TF-0558、TF-0640。

复用与必要写集：shared/task-ledger-working-context.ts；shared/long-session-continuity.ts；shared/memory/control-plane.ts；openclaw_runtime/src/context-engine；现有checkpoint/handoff owner。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 任务工作集优先existing accepted Working Context；全局只取项目摘要和引用，原文按授权按需读。
- 复用checkpoint/起始注入/缓存边界策略，不新建注入器或第二Memory store。
- 区分token上下文、进程RAM和长期事实；压缩/handoff绑定来源版本与遗漏风险。

验收：

- 负责人换代后保留目标、限制、决策、证据和下一步；错误/过期/跨scope事实不注入。
- 长任务artifact留磁盘，上下文只放摘要与引用；可回读来源，预算/缓存成本单列。
- 沿已有配对评估证明本次连续策略，不把旧TF完成当新任务质量证据。

必须拒绝或明确诊断：摘要丢关键约束；跨项目私有原文泄漏；旧candidate直接注入；压缩被当成新会话谱系。

测试入口：既有long-session continuity/paired evaluation；context start injection与checkpoint回归。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/m1/ 下的 working-context-handoff.json；paired-continuity-report.json；context-budget.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：关闭新增自动连续策略，保留checkpoint和accepted事实；不改冻结注入默认。

#### TF-0687 / M2 把任务经验经验证晋升并支持撤销与退化回滚

目的：让agent从任务中沉淀可复用经验，并能够证明适用性和撤销错误经验。

骨架位置：L3 Memory/Knowledge owner + L5 评估。前置：P4、M1、TF-0653、TF-0655。

复用与必要写集：shared/memory/control-plane.ts；shared/knowledge-lifecycle.ts；既有Role/Runtime Memory与SEKB候选接口；既有RSI/AgentFirst改进门禁。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 成功/失败产生candidate，保留来源、scope、敏感性、TTL、冲突与适用条件。
- 复用RSI安全锚点、冻结套件和既有memory/knowledge接受owner，不新建自评分器或自动权限升级。
- 在明确授权canary中由agent执行审核与回放，默认自动写回/注入仍受冻结策略；无人证据不伪装真人。

验收：

- 未接受候选不可检索注入；接受、撤销、supersede、过期均经owner并有实际使用效果。
- 错误记忆、冲突事实、prompt注入和跨scope候选被拒；撤销后后续run不可再使用。
- 留出任务对照记录收益/退化/成本，不能用候选数量或一次自评声称学习提升。

必须拒绝或明确诊断：修改evaluator作弊；候选持久化就生效；撤销后缓存仍注入；私有事实晋升全局。

测试入口：既有memory control-plane/knowledge lifecycle/RSI gates；留出任务paired replay与真实provider边界。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/m2/ 下的 memory-candidates.json；promotion-revoke.json；heldout-evaluation.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：撤销新晋升版本并停止新增使用，回到accepted基线；历史结果不改签。

#### TF-0688 / V1 让目标到工具效果、成本和验收形成统一可查询追溯

目的：用户看结果，agent能定位每一步的真实执行、资源与成本，不靠拼聊天记录恢复事实。

骨架位置：L5 证据与失效 + UI投影。前置：P4、S2、S3、V1a（TF-0891）。

> 2026-11-22 现状注记（定义在案、实现为零）：经全仓提交史（`git log --all --grep`）核实，TF-0688 当前提交数为 0（零实现）。既有 `events.jsonl`、`observability-graph.ts` 与 TF-0867 产物保留仅为底层零件，尚未形成从交付结果逆向反查至目标的统一归因读面。为避免跨项目 S2/S3 阻塞最高优的单项目规划质量归因，已拆出前置子叶 **TF-0891 / V1a**（`autonomy-reverse-attribution-spine`）先行交付单项目六级逆向归因索引底座；TF-0688 承载以下四个可执行子项收口：① 消费 TF-0891 逆向归因底座；② 父子派发、修复重试与异步委托的唯一 attempt 费用去重及分段耗时（未知单价标 `unknown` 禁填 `0`）；③ 结果摘要→任务/规划报告→原始技术回执三层四语（`en/zh/ja/ru`）UI 展开；④ 会话删除与工作树回收下的受引用证据不灭性及篡改 `stale` 诊断（详见 `reasoning-planning-convergence-gap-plan.md` §5）。

复用与必要写集：现有Observability/trajectory/receipt owner；shared/types/session-activity.ts；src/pages/Chat/SessionActivityPanel.tsx；现有TaskLedger/Evidence呈现；shared/task-system/reverse-attribution-index.ts（TF-0891 拟新增）。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 统一关联goal/task/delegation/session/generation/scopedRun/action/effect/artifact/review，不复制Owner全状态。
- 人可读摘要、任务报告、原始技术追踪逐层展开；unknown/stale/estimated分开。
- 沿既有哈希/来源失效/retention机制保留被引用证据，删除会话不删唯一任务产物。

验收：

- 任意交付项可逆向追到源输入、执行actor、候选、检查、审批/能力引用与效果，缺链明确诊断。
- 同操作费用去重且父子不重复计费；排队/执行/验证/恢复分段，未知金额不作0。
- 资源/状态/证据UI同owner一致，artifact篡改/过期在报告可见；四语及Electron E2E。

必须拒绝或明确诊断：伪回执；成本双计；删除会话丢验收；旧source hash通过。

测试入口：既有evidence report/observability测试；项目/总控证据展开Electron旅程。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/v1/ 下的 trace-correlation.json；cost-attribution.json；evidence-retention.json；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：保留原始Owner记录和可读摘要，禁用有错的聚合，不能抹去实际费用/效果。

#### TF-0689 / V2 验证单项目与跨项目自治的真实质量和可恢复边界

目的：用同一候选的真实任务、故障与可复算指标证明减少了人工操作，而不是只证明页面存在。

骨架位置：L1-L5 集成验收。前置：V1、M2、TF-0662、P5（TF-0887）、P7（TF-0889）、R5（TF-0890）、V2a（TF-0892）。

> 2026-11-22 现状注记（定义在案、实现为零）：经全仓提交史（`git log --all --grep`）核实，TF-0689 当前提交数为 0（零实现；同阶段 TF-0687 亦为零提交）。局部脚本 `scripts/runtime-long-stability.mjs` 等不替代跨层长程自治实证。本节点直接承载长程自治真实质量缺口（不另造重复节点），接入度量子叶 **TF-0892 / V2a**（`autonomy-convergence-quality-metrics`），拆为四个可执行子项收口：① 冻结复杂多文件/10+ 依赖子任务基准样本与负控，分离脚本回放/真实模型/源码/安装包维度；② 执行复合故障与争抢注入矩阵（Provider 429 限流降级、多工作树/端口/同 profile 争抢、UI 关闭与宿主重启、R5 脱机委托重连、预算耗尽与错误记忆撤销）；③ 运行数小时至跨日长程 soak，调用 TF-0892 输出可行率 vs 最优率、迭代→成功率收敛曲线、资源浪费率、步骤冗余度及恢复 `p50/p95`；④ 独立 agent 盲审复算并封存未测边界（not-run）与残余风险账本，保持冻结产品锁不变（详见 `reasoning-planning-convergence-gap-plan.md` §5）。

复用与必要写集：现有AgentFirst被测对象/套件/评分注册入口；tests/e2e；harness/specs/fixtures/autonomous-project-system；scripts/evaluate-convergence-quality.mjs（TF-0892 拟新增）；scripts/run-autonomy-long-horizon-soak.mjs（拟新增）；README.md；README.zh-CN.md；README.ja-JP.md；README.ru-RU.md。标为拟新增/按实际owner收窄的路径不是已存在文件。

要求：

- 复用AgentFirst框架注册本范围场景，不新建suite runner/独立打分系统；固定任务样本和负控。
- 源码/冻结Windows安装包、脚本回放/真实模型、工程通过/产品批准分开；包构建依赖既有产品验收入口。
- 独立agent执行verifier，所有human步骤自动模拟并标agent；必要provider资源只询问一次或记未测，不编造真人/live。

验收：

- 从项目名进入→目标拆解→强任务会话→VB/VS/工作树→失败恢复→验收收口→资源回收完整旅程可回读，required cases零未解释失败/skip。
- 覆盖UI关闭、crash/restart、断网、模型限流、同tab/端口冲突、双writer、旧generation、预算耗尽、配置reload失败、记忆撤销。
- 真实任务自治完成率/可避免打断/恢复率/重复副作用/错误完成/p50/p95/成本都有分母与原始数据；小样本不外推GA。
- 全部前置完成、文档与effect一致、source/package边界清楚，最终report可独立复算；保持releaseApproved/liveReady/productApproved/defaultOn不变。

必须拒绝或明确诊断：mock冒充真实模型质量；source通过冒充package通过；验收为了全绿放宽断言；任务done冒充发布批准。

测试入口：本计划所有叶子的精确case inventory；既有AgentFirst评测/负控入口；产品声明涉及的完整Electron/Windows/source-package gates。拟新增测试由该叶子交付，不声称当前存在或通过。

计划证据：harness/specs/fixtures/autonomous-project-system/v2/ 下的 final-candidate-report.json；independent-verification.json；source-package-matrix.json；SHA256SUMS；原始跑次放D:/tmp或已忽略目录，最终保留文件按retention精确登记。

回退：自治退回已证实scope和并发，保留失败、原始数据及未测项，不虚构全系统可用。

## 通用验收与收口

每叶先从最新diff/CLI任务状态和当前source anchors建立窄task spec，使用gateway-backend-communication及既有相关规则，运行context。单元/合同/不带缓存的类型检查按改动范围选择；通信变更跑comms replay/compare；每项可见UI改动同叶提供四语与Electron E2E，不能全部推到V2。骨架扩展使用现有contract:check、semantic-authority、ontology/证据校验，不新增suite runner。

每项证据必须有actor/driven_by=agent、source与固定candidate、输入和配置版本、命令/退出码/计数、artifact digest、负例和未测边界。完成依磁盘回读与当前graph hash，经proposal-apply/validate/export自动收口。相关代码变化使证据失效；不得补签旧报告。所有大产物TEMP/TMP指向D:/tmp。

本计划不包含发布/公开、凭据轮换、产品锁/冻结默认变更；若实验确需改变这些边界，agent先准备可审查结果，再走已有真正决策。不能把“等待真人操作/数据/verdict”列为普通任务阻塞。

## 指标与有限范围

自治完成率、可避免的人类打断、自动恢复率、重复副作用、错误完成、跨scope写入、队列/执行/验证/恢复p50/p95、真实与估计成本分别报告并给出分母。不设置未经测量的提速承诺。先单项目单writer，再多项目受控并发；不做无限常驻/无限fan-out。

V2不复用历史绿灯：按冻结样本验证真实provider质量、独立agent审阅、源码/冻结Windows包与故障恢复。未测平台、模型、安装器、长时运营单列not-run，不用它们无限扩大本次内部自治范围，不宣称GA。

## 规划交付边界

本轮仅形成和校验规划、调整既有UI合同并应用Task Forest。新增26个节点（1个自治主目标、5个阶段、20个实施叶子），复用TF-0656及其6叶形成完整树；所有实施进度为0，不把图已建立当系统已实现。

本地任务图、proposal、快照、HTML与逐轮研究保持本地；本guide与umbrella是持久规范。源码实现、运行证据和发布批准仍由后续节点分别交付。
