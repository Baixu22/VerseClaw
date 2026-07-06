# 外部报告数据真实性审计

审计日期：2026-07-04  
仓库：`C:\Users\27933\Desktop\clawx\ClawX`  
审计对象：`C:\Users\27933\.codex\attachments\592003b4-6ca0-408b-80e9-f63b6118483e\pasted-text.txt`
机器可读准入矩阵：`shared/capability-claims.ts`

## 结论

这份报告整体可信，属于“确实查过源码后的能力现状矩阵”，不是凭空编造。报告中的证据索引大多数能在当前仓库中定位到真实文件和有效行号，核心判断也基本能被源码支撑。

综合可信度评估：80%-85%。

它可以作为后续产品能力梳理、差距分析、路线图讨论的参考材料；但不建议原样作为最终事实表发布，因为少数结论把“底层能力存在但 UI 未完整暴露”“默认关闭”“管线尚未打通”简化成了“未见实现”。

## 审计方法

本次审计做了三层核验：

1. 编码复原：原文件首次读取出现乱码，使用 UTF-8 重新读取后内容正常。
2. 证据定位：抽取报告中的 E1-E14 和后续散落引用，检查文件是否存在、行号是否有效。
3. 语义复核：阅读关键引用附近源码，判断报告结论是否由对应源码支撑。

限制说明：

- 本次是源码静态审计，没有启动 Electron UI，也没有运行 E2E 或单元测试。
- 行号是当前工作区状态下的行号，后续代码变动后可能漂移。
- 报告末尾的 `Goal tokensUsed=1408033` 属于执行过程自述，不能由仓库源码独立验证。

## 总体真实性判断

| 维度 | 判断 | 说明 |
| --- | --- | --- |
| 文件路径真实性 | 高 | 抽查的 60 个以上引用点均能落到当前仓库文件，未发现虚构路径或越界行号。 |
| 源码语义支撑 | 较高 | Chat、Workspace 权限、角色、Trace、Memory、长任务 checkpoint 等核心判断基本成立。 |
| 结论措辞准确性 | 中高 | 大方向准确，但少数“未见实现”需要改成更精确的“未完整产品化/默认关闭/未接入 UI”。 |
| 运行时真实性 | 未完全证明 | 没有通过测试或实际运行验证行为闭环，只能证明源码存在和静态逻辑成立。 |
| 数据来源透明度 | 中 | 报告引用了 CodeGraph 和源码行号，但没有附原始命令输出、测试日志或截图证据。 |

## 关键可采信结论

### Chat / Workspace / Gateway

报告关于 Chat 主链路和 Workspace 权限的判断基本成立。

源码显示，`plan` 模式下会拒绝终端命令、文件写入和 Gateway mutating RPC：

- `electron/services/workspace-permissions.ts:171` 的 `decideWorkspaceCommand`
- `electron/services/workspace-permissions.ts:198` 的 `decideWorkspaceFileWrite`
- `electron/services/workspace-permissions.ts:235` 的 `decideGatewayRpc`

普通 Chat 并不会自动进入独立 Plan 状态机。`chat.send` 中的长任务输入模式还明确要求存在 `/loop` Task Ledger root；否则会报错说明 ordinary Chat 不能进入 long-task checkpoint/intervention state。

可采信表述：

> Verse Claw 有 workspace permission 约束，Plan 权限会阻止真实变更；但普通 Chat 发送并不等于进入一个独立 Plan 状态机。

### 角色与编排

报告关于内置角色、角色路由、角色权限的判断基本成立。

源码支撑点：

- `openclaw_runtime/src/agents/role-contract.ts:259` 定义内置角色。
- `openclaw_runtime/src/agents/role-router.ts:44` 基于关键词、tag、文件提示等进行角色评分。
- `openclaw_runtime/src/agents/role-permissions-policy.ts:1` 将角色权限映射为工具 allow/deny。
- `openclaw_runtime/src/agents/role-spawn.ts:207` 构造角色 spawn context。

报告说“命令参数级过滤仍是 future enhancement”也被源码注释支撑。

可采信表述：

> 角色权限是工具粒度的硬约束；尚不是命令参数级、语义级的细粒度策略系统。

### Trace / Observability / 执行图

报告关于 Trace、runtime event graph、Chat 执行图的判断成立。

源码支撑点：

- `shared/types/observability.ts:1` 定义 trace/span/event/tokenUsage/metrics 等类型。
- `openclaw_runtime/src/observability/trace-recorder.ts:90` 实现 `ObservabilityTraceRecorder`。
- `src/stores/chat/runtime-graph.ts:87` 将 runtime event 应用到 Chat run state。
- `src/pages/Chat/task-visualization.ts:388` 将 tool、command、patch、approval 等事件转成步骤。
- `src/pages/Chat/ExecutionGraphCard.tsx:173` 支持 trace 入口和执行图折叠展开。

可采信表述：

> 执行观测链路已经存在，但部分 runtime trace buffer 是内存态、best-effort，不等于强持久审计日志。

### 长任务 checkpoint / intervention / queue

报告关于长任务 checkpoint、guide/queue/interrupt/revise-goal 的判断成立。

源码支撑点：

- `shared/types/long-task-control.ts:85` 定义 `ResumeCheckpoint`。
- `shared/types/long-task-control.ts:395` 定义不同 input mode 的 intervention policy。
- `openclaw_runtime/src/agents/long-task-control/store.ts:440` 记录 checkpoint。
- `openclaw_runtime/src/gateway/server-methods/chat.ts:3335` 处理 active run 下的 input mode。

可采信表述：

> 长任务有 checkpoint 和 intervention 机制；但普通 Chat 不自动拥有长任务事务状态。

### Context Compaction

报告关于上下文压缩保护的判断基本成立。

源码支撑点：

- `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:879` 注册 compaction hooks。
- `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:1142` 保留最近轮次并提取 identifiers。
- `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:59` 构建结构化摘要要求。
- `openclaw_runtime/src/agents/agent-hooks/context-pruning/settings.ts:52` 定义 context pruning 默认阈值。

可采信表述：

> 源码能证明有压缩防护和质量约束，不能证明历史上从未发生压缩导致的语义偏差。

### Memory

报告关于 Memory 的 confidence、importance、conflict review、retention 的判断成立。

源码支撑点：

- `openclaw_runtime/src/memory/gatekeeper.ts:281` 审核 Memory proposal。
- `openclaw_runtime/src/memory/gatekeeper.ts:304` 拒绝 secret-like memory。
- `openclaw_runtime/src/memory/memory-policy.ts:244` 评估 retention candidate。
- `openclaw_runtime/src/memory/context-pack.ts:18` 定义 context pack token budget。

可采信表述：

> Memory 有 gatekeeper 和 retention 评分，不是每次任务自动总结入库，也不是冲突时自动覆盖。

### 脱敏

报告关于 Observability 持久化脱敏和 Memory secret gate 的判断成立。

源码支撑点：

- `electron/services/observability-redaction.ts:11` 定义敏感 key pattern。
- `electron/services/observability-redaction.ts:90` 脱敏 span input/output/attributes。
- `electron/services/observability-redaction.ts:107` 脱敏 trace 后再持久化。
- `openclaw_runtime/src/memory/gatekeeper.ts:304` 拒绝 secret-like memory。

可采信表述：

> Observability 持久化层会脱敏敏感字段，但不能声称全链路绝不出现明文，因为文件内容、聊天 transcript 或模型回显仍可能包含用户批准写入的密钥。

## 需要修正或降权的结论

### 1. `work-mode.ts` 不能作为当前 Plan 权限的强证据

报告引用 `shared/types/work-mode.ts:4` 作为 Plan/Workspace 权限证据，但该文件自身标注：

> deprecated Internal compatibility for legacy Work Mode data and tests only.

更准确的证据应来自 `electron/services/workspace-permissions.ts`，而不是 legacy work mode 类型。

建议修正：

> Plan 权限由 Workspace permission 层实际执行；`work-mode.ts` 只是 legacy/compat 类型，不能单独证明当前 runtime policy。

### 2. “未见可编辑任务 DAG”需要收窄范围

报告说未见“可编辑任务 DAG”，方向基本对，但表述过宽。

实际情况：

- Chat 角色面板里的 orchestration plan 只是展示，不支持拖拽、编辑子任务产出、设置依赖或断点。
- `src/components/agents/OrchestrationPlanView.tsx` 只渲染 Lead / Workers / Verifier 的卡片流。
- 但仓库中存在 Task Ledger 页面、DAG 标签页和 `taskLedger.addEdge` 主进程接口。
- runtime UI 的 workboard 也有卡片拖拽和依赖展示。

建议修正：

> 未见面向 Chat/orchestrator plan 的完整可拖拽 DAG 编辑器；但底层 Task Ledger/Workboard 已有节点、边、DAG 展示或拖拽卡片能力。

### 3. “表现差不影响未来路由”需要补充 routing memo

报告说未见“表现差则降低未来概率”的完整在线淘汰，结论方向对，但遗漏了一部分 routing memo 能力。

源码显示：

- `openclaw_runtime/src/agents/routing-memo.ts` 存在 workspace-scoped routing memo。
- active 模式下相似任务成功会对 lead role 加 `+2`。
- `poor_attempt` 会对 lead role 加 `-1`。
- 默认 `routingMemoPilot` 是 `off`。
- 记录端注释说明 `qualityOverall` 尚未真正打通。

建议修正：

> 存在 routing memo 的早期反馈机制，但默认关闭，且质量评分没有完整接入记录端；因此还不是完整在线淘汰/学习系统。

### 4. Task Loop 与普通 orchestrator.run 的验证能力不能混写

报告总体区分了 Task Loop 和普通 orchestration，但部分段落容易让读者误以为二者拥有同等验证闭环。

源码显示：

- Task Loop 有 evidence gate、self check、repair iteration、blocked 判断。
- `team-orchestrate-tool.ts` 中仍有 `quality: []` 和 `qualitySummary: summarizeQuality([])`。

建议修正：

> Task Loop 验证闭环较强；普通 `team_orchestrate/orchestrator.run` 的质量评分和反馈闭环仍弱。

### 5. `Goal tokensUsed=1408033` 不应作为事实证据

报告末尾的 tokensUsed 是执行过程元信息，不能由源码证明。

建议处理：

> 保留为“原报告生成过程自述”，不要纳入源码真实性判断。

## 建议采用的最终摘要

以下是一版更准确、可发布的摘要：

> Verse Claw 已具备较完整的 Chat/Gateway/Workspace 权限、角色编排、Trace/Observability、Memory gatekeeper、长任务 checkpoint 与 Task Loop 验证基础。源码能够支撑这些能力真实存在。  
>
> 但目前仍不能声称具备完整产品化的“可拖拽编辑 orchestration plan DAG”“任意文件自动全量回滚”“动态角色自动淘汰”“Plan 低置信度自动确认/执行阈值状态机”。其中部分底层能力已存在雏形，例如 Task Ledger 的节点/边/DAG 展示、routing memo 的相似任务反馈、Task Loop 的 evidence gate；但这些能力要么未接入 Chat/orchestration plan UI，要么默认关闭，要么质量信号尚未完整打通。  
>
> 因此，原报告总体可信，但少数“未见实现”应改为“未完整产品化/未默认启用/未贯通到对应用户路径”。

## 分区结论表

| 报告主题 | 审计判断 | 可信度 | 备注 |
| --- | --- | --- | --- |
| Chat 主链路 | 基本真实 | 高 | `sendMessage`、`sendWithMedia`、`chat.send` 路径存在。 |
| Workspace permission | 真实 | 高 | Plan/readOnly/fullAccess 决策逻辑明确。 |
| 普通 Chat 自动 Plan 状态机 | 报告否定成立 | 高 | 未见独立 Plan 状态机，普通 send 仍发送消息。 |
| 多角色拆分 | 部分真实 | 高 | 需走 orchestrator/team/task_loop，普通 Chat 不强制多角色。 |
| 角色权限 | 真实但粒度有限 | 高 | 工具级 allow/deny，命令参数级仍未实现。 |
| 可编辑 orchestration DAG | 报告方向对但需收窄 | 中高 | Chat plan 不可编辑；Task Ledger/Workboard 有部分底层能力。 |
| Trace/执行图 | 真实 | 高 | 类型、recorder、runtime graph、UI card 均存在。 |
| 长任务 checkpoint | 真实 | 高 | checkpoint/intervention/queue 逻辑明确。 |
| 自动全量回滚 | 报告否定成立 | 高 | 未见任意文件改动失败后的全量自动回滚。 |
| 幂等策略 | 部分真实 | 中高 | Chat send、checkpoint/queue 有幂等；文件写入无全局幂等。 |
| Context compaction | 真实 | 高 | 有结构化摘要、防丢失、recent turns/identifier 保护。 |
| Memory gatekeeper | 真实 | 高 | confidence、secret、conflict、retention 均有逻辑。 |
| 动态角色淘汰 | 部分误差 | 中 | routing memo 存在早期反馈，但默认关闭且未完整打通质量。 |
| 低置信度自动确认阈值 | 报告否定成立 | 高 | route confidence 存在，但未见 Plan 自动确认/执行状态机。 |
| 脱敏 | 真实但非全链路保证 | 高 | Observability 持久化脱敏；chat transcript/文件内容不保证。 |

## 后续建议

1. 如果要把报告用于产品路线图，应拆成三类：已产品化、底层已存在但未贯通、未实现。
2. 如果要作为对外说明，应删除或脚注 `Goal tokensUsed`、CodeGraph 过程自述等不可复验证据。
3. 如果要继续做“数据真实性”硬审计，应补充：
   - 自动化测试结果；
   - UI 截图或 Playwright 录制；
   - Gateway RPC 实测日志；
   - 关键功能的端到端路径证明。
