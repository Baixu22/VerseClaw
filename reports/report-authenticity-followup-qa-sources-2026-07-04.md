# 阶段二深度追问：完整问答与源码出处汇总

日期：2026-07-04  
仓库：`C:\Users\27933\Desktop\clawx\ClawX`  
分支：`knowledge-ux-polish`  
HEAD：`5d9a3f3`  
工作区状态：`git status --short` 当前约 926 条变更/未跟踪项。  
关联摘要报告：`reports/report-authenticity-followup-plan-2026-07-04.md`
机器可读准入矩阵：`shared/capability-claims.ts`

## 0. 审计边界与验证状态

本文件回答用户提出的 17 组阶段二问题，并把每个结论绑定到源码位置或测试证据。结论只代表当前工作区状态；由于工作区很脏，不能直接证明这些代码已经合入 `main/master` 或发布分支。

CodeGraph 状态：已尝试运行 `node openclaw_runtime/extensions/codegraph/dist/bin/codegraph.js --help`，失败原因是缺少 `picomatch` 模块，栈从 `openclaw_runtime/extensions/codegraph/dist/resolution/frameworks/cargo-workspace.js` 进入。因此本轮按用户授权跳过 CodeGraph，改用 `rg`、源码复核和单元测试。

本轮已重新运行的定向单元测试：

```powershell
pnpm exec vitest run tests/unit/routing-memo.test.ts tests/unit/rollback-plan.test.ts tests/unit/replay-rollback-authority.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/workspace-permissions.test.ts tests/unit/memory-api.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/role-memory-context-provider.test.ts tests/unit/observability-index.test.ts tests/unit/compression-artifact.test.ts tests/unit/task-loop-controller.test.ts --reporter=dot
```

结果：11 个测试文件、212 个用例通过。该组单元测试本身不覆盖 Electron E2E、真实 Gateway RPC 手工场景、真实模型调用或真实 UI 截图验证；Electron E2E 补充结果见下。

本轮补充运行的构建与 Electron E2E：

```powershell
pnpm run build:vite
pnpm exec playwright test tests/e2e/chat-work-mode.spec.ts tests/e2e/chat-task-visualizer.spec.ts tests/e2e/role-memory-panel.spec.ts tests/e2e/role-origin-badge.spec.ts --workers=1
```

结果：

| 验证项 | 真实结果 | 对审计结论的影响 |
| --- | --- | --- |
| `pnpm run build:vite` | 通过；存在 Vite chunk/dynamic import 体积与分块警告。 | 证明当前工作区至少可完成 renderer/main/preload 构建，但不能证明所有运行时路径稳定。 |
| `chat-work-mode.spec.ts` | 1/1 通过。 | Work Mode UI 隐藏/发送 payload 场景可通过 E2E。 |
| `role-memory-panel.spec.ts` | 1/1 通过。 | Memory 管理面板的创建、预览、模拟、归档路径有 UI 级验证。 |
| `role-origin-badge.spec.ts` | 1/1 通过。 | 内置/配置角色来源标识有 UI 级验证。 |
| `chat-task-visualizer.spec.ts` | 2/4 通过，2/4 失败。失败用例分别是 `renders internal yield status and linked subagent branch from mocked IPC` 与 `preserves long execution history counts and strips the full folded reply prefix`；共同失败点是等待 `data-testid="chat-execution-graph"` 30 秒后仍未出现。 | 执行图不能写成“所有历史/内部 yield 场景稳定产品化”。更准确结论：基础 team orchestration graph 与 terminal error 场景通过；内部 yield/长历史折叠场景当前存在回归或测试夹具不匹配，需要降级为“部分产品化”。 |

失败证据文件：

- `test-results/chat-task-visualizer-Verse-c9a54-gent-branch-from-mocked-IPC/error-context.md`
- `test-results/chat-task-visualizer-Verse-dbd17-he-full-folded-reply-prefix/error-context.md`

CodeGraph 补充验证：直接执行 `node openclaw_runtime/extensions/codegraph/dist/bin/codegraph.js --help` 以及 `pnpm --dir openclaw_runtime exec node extensions/codegraph/dist/bin/codegraph.js --help` 均失败，原因仍是 `Cannot find module 'picomatch'`。因此，附件里“先用 CodeGraph 定位”的说法在本轮没有被复现，只能作为线索，不能作为本报告证据等级的一部分。

证据等级说明：

| 等级 | 含义 |
| --- | --- |
| 高 | 有明确源码路径，且有定向单元测试覆盖或调用链清晰。 |
| 中 | 源码存在且路径合理，但缺少端到端验证或配置默认值可能影响实际触达。 |
| 低 | 只能证明局部代码存在，无法确认真实产品路径已启用。 |

### 0.1 真实性总判定

| 类别 | 结论 | 代表问题 |
| --- | --- | --- |
| 已被测试增强，真实性高 | 这些不是报告臆测，源码与定向测试能共同支撑。 | Workspace permission 拦截；routing memo 的 off/shadow/active 和 +2/-1 评分；Memory proposal/review/context pack；Observability trace 持久化脱敏；compaction artifact 结构；Task Loop repair/checkpoint；role origin badge；Memory 管理面板。 |
| 源码真实，但缺用户闭环 | 底层能力存在，但缺明确用户入口、默认开关、回写路径、质量信号或端到端运行证据。 | Chat Plan 未接 Task Ledger DAG 编辑；Task Ledger 与 Workboard 不是同一数据源双视图；普通 `team_orchestrate` 质量数组为空；Routing Memo 默认 off 且 `qualityOverall` 未贯通；checkpoint 不是完整上下文/文件快照；低置信度确认没有统一状态机；普通 Chat 与 Task Loop 仍分裂。 |
| 被 E2E 反向削弱，需要降级 | 之前若写成“稳定产品化”是不准确的。 | Chat execution graph 的 internal yield/subagent branch 和长历史折叠场景 E2E 失败，表现为 `chat-execution-graph` 未出现。 |
| 仍未完成真实运行验证 | 只能给中/低可信，不能冒充 95% 结论。 | 真实 Gateway RPC 手工场景、真实模型调用、真实 `.env` secret 写入后的 transcript/diff/trace 全链路检查、真实长会话多次 compaction、真实 Task Loop 子任务失败后的端到端恢复。 |

### 0.2 边界用语收紧规则

为避免“部分实现”“未完全实现”“产品化不足”这类模糊话语，本报告后续按以下规则解读：

| 禁止单独使用的说法 | 必须改写为 |
| --- | --- |
| “部分实现” | “已确认 A/B/C；当前未找到 D/E/F；因此用户当前只能做到 X，不能做到 Y”。 |
| “未完全实现” | 直接列缺口，例如“无 UI 入口”“默认开关 off”“返回空数组”“未持久化”“未接质量信号”“E2E 失败”。 |
| “底层存在但未贯通” | 必须说明断在哪一层：数据模型、Gateway RPC、Runtime 执行、Electron Main 权限、Renderer UI、默认配置、测试覆盖、或运行时证据。 |
| “产品化不足” | 必须说明用户可触达范围：可通过 UI 触达、仅能通过配置/API 触达、仅单元测试触达、或只存在源码结构。 |
| “不能证明/可能” | 必须说明尚未验证的具体场景，例如真实 Gateway replay、真实模型调用、真实文件写入后的 transcript/trace 检查。 |

本报告中若保留“部分实现”作为短标签，最终判定以本节和 `0.3 精确功能边界矩阵` 为准。

### 0.3 精确功能边界矩阵

| 功能 | 已确认成立的边界 | 当前不成立或未找到的边界 | 坚定结论 |
| --- | --- | --- | --- |
| Chat Plan 可编辑 DAG | Task Ledger 有 node/edge/DAG 类型和 `addEdge` API；Workboard 有卡片移动/依赖相关能力；Chat 角色面板可调用 `orchestrator.plan` 并渲染 `OrchestrationPlanView`。 | Chat 的 `OrchestrationPlanView` 没有 add/remove edge、拖拽排序、断点、依赖编辑、任务产出编辑或“编辑后回写 orchestrator plan”的路径。 | 不是“DAG 能力不存在”，而是“Chat Plan DAG 编辑器未实现”。用户当前不能在 Chat plan 阶段直接编辑依赖图。出处：`shared/types/task-ledger.ts:45`, `electron/services/task-ledger-api.ts:153`, `openclaw_runtime/ui/src/ui/views/workboard.ts:1611`, `src/components/agents/OrchestrationPlanView.tsx:68`, `src/components/agents/RolesOrchestrationPanel.tsx:2248`。 |
| Task Ledger 与 Workboard | Task Ledger 是 workspace-scoped task event/snapshot；Workboard 是 runtime UI board/card 表面。两者都有任务/依赖概念。 | 未找到二者共享同一数据源并自动同步为同一任务系统的证据。 | 不能称为“同一数据源的两种视图”。当前应判定为两套相关但不同的数据/视图系统。出处：`electron/services/task-ledger-service.ts:162`, `electron/services/task-ledger-service.ts:243`, `openclaw_runtime/ui/src/ui/views/workboard.ts:1105`, `openclaw_runtime/ui/src/ui/views/workboard.ts:1611`。 |
| Routing Memo 动态学习/淘汰 | routing memo 有 off/shadow/active；active 会给相似任务 lead role 加减分；成功 `+2`、poor attempt `-1` 有单元测试。 | 默认 `routingMemoPilot` 是 off；源码注释说明 `qualityOverall` 尚未填充；未找到基于真实质量评分自动淘汰角色的闭环。 | 不能称为“角色会动态淘汰/学习”。准确说：有默认关闭的 routing memo 评分试点，但未贯通质量信号和产品闭环。出处：`openclaw_runtime/src/agents/routing-memo.ts:57`, `openclaw_runtime/src/agents/routing-memo.ts:209`, `openclaw_runtime/src/agents/routing-memo.ts:212`, `openclaw_runtime/src/agents/orchestrator-run-observed.ts:632`, `tests/unit/routing-memo.test.ts:195`。 |
| 普通 `team_orchestrate` 质量评分 | 普通编排会返回 worker/failure/partial/repair/reroute 结构；Task Loop 另有 evidence gate、self-check、repair iteration。 | `team-orchestrate-tool.ts` 里普通路径返回 `quality: []` 和 `summarizeQuality([])`；未接入 Task Loop 的 quality/evidence gate。 | “普通编排质量评分未实现”的具体含义是：接口位存在，但质量数组为空，不能驱动路由学习或自动 repair gate。出处：`openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:272`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:273`, `openclaw_runtime/src/agents/task-loop-controller.ts:3111`。 |
| 普通 Chat 与 Task Loop | 普通 Chat 走 `chat.send`；Task Loop 有 `task_loop.run/status`、checkpoint、evidence gate、repair iteration；inputMode intervention 要求 active `/loop` Task Ledger root。 | 普通 Chat 的复杂任务不会自动拥有 Task Loop checkpoint/evidence/repair；未找到“所有 Chat 默认升级 Task Loop”的状态机。 | 这是两套执行模型，不是同一模型的不同 UI。复杂任务是否进入 Task Loop，需要显式路径或产品入口。出处：`openclaw_runtime/src/gateway/server-methods/chat.ts:3117`, `openclaw_runtime/src/gateway/server-methods/chat.ts:3361`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:436`, `openclaw_runtime/src/agents/task-loop-controller.ts:2956`。 |
| Checkpoint 恢复 | `ResumeCheckpoint` 保存 objective、activeTask、blockers、decisions、deviations、files、tests、nextAction、evidence、controlSignals 等结构化状态；checkpoint 写入 SQLite/Kysely 表。 | 不保存完整 agent 上下文窗口、完整工具调用历史、文件系统快照或事务中间态。 | checkpoint 是“恢复摘要/恢复锚点”，不是 VM 快照，也不是文件级回滚快照。出处：`shared/types/long-task-control.ts:85`, `openclaw_runtime/src/agents/long-task-control/store.ts:53`, `openclaw_runtime/src/agents/long-task-control/store.ts:527`, `openclaw_runtime/src/agents/long-task-control/store.ts:686`。 |
| 自动全量回滚 | 有 rollback panel/plan、replay rollback authority、checkpoint restore 和 subagent provisional cleanup。 | 未找到任意任务链失败后自动恢复所有文件改动的事务系统；checkpoint 不包含文件系统快照。 | “自动回滚未实现”的具体含义是：没有全局、自动、文件级事务回滚。当前更接近 review/restore/replay 辅助能力。出处：`src/pages/Chat/rollback-plan.ts:73`, `openclaw_runtime/src/agents/replay-rollback-authority.ts:143`, `openclaw_runtime/src/agents/replay-rollback-authority.ts:180`, `openclaw_runtime/src/agents/long-task-control/store.ts:304`。 |
| Workspace Permission | plan/readOnly/fullAccess 决策函数存在；文件写入、终端命令、Gateway mutating RPC 在 Electron Main service 边界拦截；单元测试覆盖 readOnly/plan 阻断。 | 不能证明所有未来 host API 或 runtime 内部工具都天然经过该 gate；权限审计不是统一 SIEM 级全链路审计。 | Workspace permission 是已实现的边界 gate，但边界是 Electron Main service/API 层，不是对整个进程所有副作用的形式化证明。出处：`electron/services/workspace-permissions.ts:171`, `electron/services/files-api.ts:364`, `electron/services/terminal-api.ts:253`, `electron/services/gateway-api.ts:379`, `tests/unit/workspace-permissions.test.ts:40`。 |
| Role Permission | role permission policy、role spawn tool allow/deny、workspace approval gate 均存在。 | 未找到命令参数级强过滤和统一角色权限审计视图；workspace 和 role 权限不是同一个三维矩阵。 | Role permission 是 runtime/subagent tool materialization 边界；Workspace permission 是 Main service 边界。两者叠加生效，不能合并描述。出处：`openclaw_runtime/src/agents/role-permissions-policy.ts:78`, `openclaw_runtime/src/agents/role-spawn.ts:207`, `openclaw_runtime/src/agents/role-spawn.ts:212`, `electron/services/permissions-api.ts:183`。 |
| Memory 管理与注入 | Memory API、proposal/review/archive/simulateInjection/context-pack/retention 存在；`role-memory-panel` E2E 通过创建、预览、模拟、归档 mocked RPC 场景。 | 自动任务结束写入不是直接激活，仍走 proposal/gatekeeper；真实 Gateway/真实用户 review 流未端到端验证。 | Memory 不是“只存在底层代码”；它已有 UI 管理面板。但“每次任务自动总结并长期写入”不成立。出处：`electron/services/memory-api.ts:92`, `openclaw_runtime/src/memory/context-pack.ts:18`, `src/components/agents/RolesOrchestrationPanel.tsx:1411`, `tests/e2e/role-memory-panel.spec.ts:433`, `tests/e2e/role-memory-panel.spec.ts:484`。 |
| 敏感内容处理 | Observability 持久化前会 sanitize trace input/output/attributes；Memory gatekeeper 拒绝 secret-like memory；context pack 不注入 secret/secret_adjacent。 | 目标文件、chat transcript、模型回显、raw patch/diff 不因 Observability redaction 自动全链路脱敏；compaction safeguard 未显示专门 secret scrubber。 | 可以说“trace persistence 和 memory 注入有敏感内容防护”；不能说“全链路无明文”。出处：`electron/services/observability-redaction.ts:90`, `electron/services/observability-redaction.ts:93`, `openclaw_runtime/src/memory/gatekeeper.ts:304`, `openclaw_runtime/src/memory/context-pack.ts:54`, `electron/services/files-api.ts:356`。 |
| Compaction | 有 compression planner、compaction safeguard、identifier audit、quality retry/re-distill；单元测试覆盖 artifact 结构。 | 未证明真实长会话多次压缩无信息损失；未找到每次自动压缩都要求用户确认；未找到压缩次数硬上限。 | compaction 是“有防护的有损摘要机制”，不是无损存档或用户逐条确认机制。出处：`openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:879`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:233`, `tests/unit/compression-artifact.test.ts:64`, `src/pages/Chat/ChatInput.tsx:3378`。 |
| Execution Graph | 源码有 ExecutionGraphCard、task visualization、Observability graph/index；E2E 中基础 team orchestration graph 和 terminal error 场景通过。 | `chat-task-visualizer.spec.ts` 两个用例失败：internal yield/subagent branch、长历史折叠场景均找不到 `chat-execution-graph`。 | 执行图不是“全场景稳定产品化”。只能确认部分场景可用，历史/内部 yield 场景当前有回归或测试夹具不匹配。出处：`src/pages/Chat/ExecutionGraphCard.tsx:166`, `tests/e2e/chat-task-visualizer.spec.ts:373`, `tests/e2e/chat-task-visualizer.spec.ts:501`。 |
| 用户自定义角色 | role registry 支持 config roles；RoleCard 显示 built-in/config origin；E2E 验证 built-in 和 Custom badge。 | 未找到面向用户完整创建/编辑/删除角色的产品 UI；未找到按任务自动生成临时角色并 TTL 退役。 | “自定义角色”当前边界是配置级角色和 UI 展示来源，不是完整角色管理器。出处：`openclaw_runtime/src/agents/role-registry.ts:6`, `src/components/agents/RoleCard.tsx:98`, `tests/e2e/role-origin-badge.spec.ts:89`。 |
| 低置信度暂停确认 | Memory low confidence 可 `needs_review`；Task Loop self-check/control signals 可 ask/repair/block；orchestration diagnostics 有 confidence。 | 普通 Chat/Plan 未找到统一阈值状态机：低于阈值自动暂停问用户、高于阈值自动执行、并用历史反馈动态调阈值。 | “低置信度自动暂停确认”未产品化；存在的是分散在 Memory/Task Loop/orchestration diagnostics 的局部信号。出处：`openclaw_runtime/src/memory/gatekeeper.ts:317`, `openclaw_runtime/src/agents/task-loop-self-check.ts:289`, `openclaw_runtime/src/agents/orchestration-protocol.ts:454`。 |
| 重试、幂等与降级 | 模型 fallback、Gateway reconnect、web cache/timeout、Chat/checkpoint/intervention idempotency/upsert/dedupe 存在。 | 没有统一“所有 API 重试 N 次”的全局策略；文件写入/创建/外部命令没有全局幂等保证。 | 只能按子系统说明重试/幂等，不能写成全局可靠性事务框架。出处：`openclaw_runtime/src/agents/model-fallback.ts:1225`, `electron/gateway/manager.ts:1415`, `openclaw_runtime/src/agents/tools/web-shared.ts:24`, `openclaw_runtime/src/agents/long-task-control/store.ts:511`。 |

## 1. Task Ledger / Workboard 与 Chat Plan 的断层

| 子问题 | 答案 | 出处 |
| --- | --- | --- |
| (a) 为什么 Chat orchestration plan 没有接入 Task Ledger 的 DAG 编辑能力？ | 更像是产品表面和架构入口尚未统一，而不是底层完全没有 DAG 能力。Chat 侧 `OrchestrationPlanView` 只渲染 lead/workers/verifier，没有 add edge、拖拽、依赖编辑、状态写回。Task Ledger 和 Workboard 分别存在节点/边/依赖/拖拽能力。 | `src/components/agents/OrchestrationPlanView.tsx:68`, `src/components/agents/OrchestrationPlanView.tsx:108`, `src/components/agents/OrchestrationPlanView.tsx:118`, `src/components/agents/OrchestrationPlanView.tsx:131`; `shared/types/task-ledger.ts:45`, `shared/types/task-ledger.ts:63`; `electron/services/task-ledger-api.ts:153`; `openclaw_runtime/ui/src/ui/views/workboard.ts:1611` |
| (b) 如果用户想在 plan 阶段编辑任务依赖关系，最近的可行路径是什么？ | 最近路径是新增 Chat Plan 到 Task Ledger 的 adapter：先把 orchestration plan 投影成 Task Ledger node/edge，再通过现有 `hostApi.taskLedger.addEdge/updateNode` 做受控编辑，最后决定是否回写 orchestrator plan 或只作为 Task Ledger 事实层。当前 Chat 已能展示 Task Ledger summary 和 link session，但 Chat plan 本身没有 DAG 编辑 UI。 | `src/lib/host-api.ts:1136`, `src/lib/host-api.ts:1141`; `electron/services/task-ledger-api.ts:125`, `electron/services/task-ledger-api.ts:153`; `src/pages/Chat/index.tsx:1727`, `src/pages/Chat/index.tsx:2433`; `src/components/task-ledger/TaskLedgerSummaryPanel.tsx:53` |
| (c) Task Ledger 和 Workboard 是同一数据源的两种视图吗？ | 不是简单的同一数据源双视图。Task Ledger 是 workspace-scoped event log/snapshot，Workboard 是 runtime UI board/card 执行表面。二者概念接近，但模型、存储和入口不同。 | `electron/services/task-ledger-service.ts:162`, `electron/services/task-ledger-service.ts:163`, `electron/services/task-ledger-service.ts:243`; `openclaw_runtime/ui/src/ui/views/workboard.ts:1105`, `openclaw_runtime/ui/src/ui/views/workboard.ts:1134`, `openclaw_runtime/ui/src/ui/views/workboard.ts:1611` |

验证状态：源码高可信；未做 UI 拖拽/编辑端到端验证。  
产品化判断：Chat 侧可编辑任务 DAG 当前缺 UI 编辑入口、依赖回写路径和 plan-to-ledger adapter；底层 Task Ledger/Workboard 图能力不能等同于 Chat Plan 编辑器。

## 2. Routing Memo 的未启用状态

| 子问题 | 答案 | 出处 |
| --- | --- | --- |
| (a) pilot 开关启用条件是什么？ | `routingMemoPilot` 默认 `off`，支持 `off/shadow/active`。源码注释写明 active gate：至少 20 次 shadow run，并且 shadow divergence 建议在至少 70% 分歧中等同或改善结果。 | `openclaw_runtime/src/agents/routing-memo.ts:57`, `openclaw_runtime/src/agents/routing-memo.ts:65`, `openclaw_runtime/src/agents/routing-memo.ts:72`; `openclaw_runtime/src/config/types.openclaw.ts:230`, `openclaw_runtime/src/config/types.openclaw.ts:235`, `openclaw_runtime/src/config/types.openclaw.ts:237`; `tests/unit/routing-memo.test.ts:411` |
| (b) `qualityOverall` 应该从哪里来？ | 合理来源应是普通 orchestration 的 worker/verifier scorecard，或 Task Loop evidence/self-check 的归一化质量结果。但当前普通路径没有完整打通；记录 routing memo 时源码明确注释 `qualityOverall is not yet populated`。 | `openclaw_runtime/src/agents/orchestrator-run-observed.ts:632`; `openclaw_runtime/src/agents/task-loop-controller.ts:2956`, `openclaw_runtime/src/agents/task-loop-controller.ts:2982`, `openclaw_runtime/src/agents/task-loop-controller.ts:3087` |
| (c) 现在手动打开 active 会发生什么？ | active 会对相似任务的 matching lead role 做有界加减分；shadow 只写 diagnostic reason，不改分。风险是 `qualityOverall` 不完整时，completed/partial graph status 可能被过度当作质量代理。 | `openclaw_runtime/src/agents/orchestrator.ts:300`, `openclaw_runtime/src/agents/orchestrator.ts:301`, `openclaw_runtime/src/agents/orchestrator.ts:306`; `openclaw_runtime/src/agents/routing-memo.ts:185`, `openclaw_runtime/src/agents/routing-memo.ts:201` |
| (d) +2/-1 是经验值还是理论值？ | 源码没有给出理论证明，属于工程启发式。注释强调这是 memo，不是 learned policy；active phase 使用 bounded score delta。成功 `+2`、poor `-1` 已被单元测试固化。 | `openclaw_runtime/src/agents/routing-memo.ts:5`, `openclaw_runtime/src/agents/routing-memo.ts:6`, `openclaw_runtime/src/agents/routing-memo.ts:209`, `openclaw_runtime/src/agents/routing-memo.ts:212`; `tests/unit/routing-memo.test.ts:195`, `tests/unit/routing-memo.test.ts:218` |

验证状态：源码和单元测试高可信；active 真实产品效果未 E2E 验证。  
产品化判断：角色动态学习/淘汰当前缺默认启用、质量信号 `qualityOverall` 和真实路由效果闭环；Routing Memo 只能证明默认关闭的评分试点存在。

## 3. `team_orchestrate` 的质量评分空洞

| 子问题 | 答案 | 出处 |
| --- | --- | --- |
| (a) Task Loop 的 evidence gate/self check/repair 是否能降级复用？ | 可以部分复用理念和数据结构，但需要 adapter。普通 `team_orchestrate` 的 worker outcome、failures、verifier verdict 需要先转成统一 scorecard，才能复用 evidence/self-check。当前代码没有直接共享 Task Loop gate。 | `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:130`; `openclaw_runtime/src/agents/orchestrator-run-observed.ts:526`, `openclaw_runtime/src/agents/orchestrator-run-observed.ts:544`; `openclaw_runtime/src/agents/task-loop-controller.ts:2956`, `openclaw_runtime/src/agents/task-loop-controller.ts:3087` |
| (b) 普通编排是否计划接入质量评分？ | 源码已经有 `repairNodes`、`rerouteRecommendations`、partial/failure 结构，但工具返回的 `qualitySummary` 仍是 `summarizeQuality([])`。可判断为接口位存在、质量信号未接入。 | `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:228`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:244`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:273`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:285`; `openclaw_runtime/src/agents/orchestrator-run-observed.ts:83` |
| (c) worker 输出很差时系统实际行为是什么？ | 普通编排会记录 failure/timeout，返回 partial、repairNodes、rerouteRecommendations；但不会像 Task Loop 那样强制进入 repair iteration 或 blocked gate。 | `openclaw_runtime/src/agents/orchestrator-run-observed.ts:554`, `openclaw_runtime/src/agents/orchestrator-run-observed.ts:567`, `openclaw_runtime/src/agents/orchestrator-run-observed.ts:568`; `openclaw_runtime/src/agents/task-loop-controller.ts:2997`, `openclaw_runtime/src/agents/task-loop-controller.ts:3116`; `tests/unit/role-orchestration-methods.test.ts:360`, `tests/unit/role-orchestration-methods.test.ts:390` |

验证状态：源码和单元测试高可信；普通编排质量评分仍为空。  
产品化判断：普通编排质量评分属于“底层结构存在但未贯通”。

## 4. 脱敏的全链路缺口

| 子问题 | 答案 | 出处 |
| --- | --- | --- |
| (a) 用户要求把 API key 写入 `.env` 时，完整数据流和脱敏点是什么？ | key 会经过 renderer message、Electron chat API、Gateway `chat.send`、runtime tool call、write/edit/apply_patch 文件写入路径，并可能进入 transcript/tool result/trace。Observability 持久化前会 redaction；目标文件、原始 transcript、模型上下文不应默认视为已脱敏。 | `electron/services/chat-api.ts:338`, `electron/services/chat-api.ts:435`; `openclaw_runtime/src/gateway/server-methods/chat.ts:3117`, `openclaw_runtime/src/gateway/server-methods/chat.ts:4056`; `openclaw_runtime/src/agents/sessions/tools/write.ts:407`; `openclaw_runtime/src/agents/sessions/tools/edit.ts:421`; `openclaw_runtime/src/agents/apply-patch.ts:168`; `electron/services/observability-index.ts:145` |
| (b) assistant message 是否经过脱敏？ | 如果 assistant 内容进入 Observability trace persistence，会被 `sanitizeTraceForPersistence` 变成 redacted preview/hash；但 assistant transcript append 本身没有在这些路径上看到统一 redaction。 | `electron/services/observability-redaction.ts:93`, `electron/services/observability-redaction.ts:107`; `openclaw_runtime/src/gateway/server-methods/chat.ts:1702`, `openclaw_runtime/src/gateway/server-methods/chat.ts:4139`, `openclaw_runtime/src/gateway/server-methods/chat.ts:4509`, `openclaw_runtime/src/gateway/server-methods/chat.ts:5076` |
| (c) compaction summary 是否可能保留明文密钥？ | 当前边界判定：不能保证不会保留。compaction safeguard 保护结构、pending ask 和 exact identifiers；本轮未找到针对 compaction summary 的专门 secret scrubber。Memory gatekeeper 会拒绝 secret-like memory，但它不处理 compaction summary。 | `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:8`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:19`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:22`; `openclaw_runtime/src/memory/gatekeeper.ts:159`, `openclaw_runtime/src/memory/gatekeeper.ts:304` |
| (d) file patch/diff 是否经过脱敏？ | patch/diff 如果作为 trace span input/output/attributes 持久化，会经过 Observability redaction；但 raw patch、工具输出、目标文件内容和 session transcript 不能据此认为全量脱敏。 | `electron/services/observability-redaction.ts:11`, `electron/services/observability-redaction.ts:93`, `electron/services/observability-index.ts:145`; `openclaw_runtime/src/agents/sessions/tools/edit.ts:426`, `openclaw_runtime/src/agents/sessions/tools/edit.ts:427`, `openclaw_runtime/src/agents/apply-patch.ts:451`; `tests/unit/observability-index.test.ts:46`, `tests/unit/observability-index.test.ts:118` |

验证状态：Observability redaction 有单元测试，结论高可信；全链路 secret-safe 未验证，不能过度声明。

## 5. Workspace Permission 的边界验证

| 子问题 | 答案 | 出处 |
| --- | --- | --- |
| (a) 三种拒绝是硬拒绝还是软拒绝？ | Plan/readOnly 对命令、文件写入、mutating Gateway RPC 是硬 gate 或 approval gate，不是单纯 warning。文件写入拒绝返回 `permissionDenied`；终端和 Gateway mutating RPC 走 block/approvalRequired。 | `electron/services/workspace-permissions.ts:171`, `electron/services/workspace-permissions.ts:179`, `electron/services/workspace-permissions.ts:198`, `electron/services/workspace-permissions.ts:206`, `electron/services/workspace-permissions.ts:235`, `electron/services/workspace-permissions.ts:250`; `electron/services/files-api.ts:395`; `electron/services/terminal-api.ts:253`; `electron/services/gateway-api.ts:379` |
| (b) 是否存在绕过路径？ | 主要风险来自未接入该 Main service 边界的新 host API、runtime 内部工具或直接 Gateway/IPC 调用。当前项目规则也要求 renderer 通过 host-api/api-client，不应直接 IPC 或 direct Gateway fetch。 | `electron/services/workspace-permissions.ts:72`, `electron/services/workspace-permissions.ts:84`; `AGENTS.md` 的 Renderer/Main API boundary 规则；`electron/services/gateway-api.ts:379` |
| (c) 权限决策是否记录日志？ | 有 approval event 持久化到 `electron-store` 的 `workspace-permissions`，并可按 workspace/session/source/status 查询。但这不是完整 SIEM 级审计日志。 | `electron/services/permissions-api.ts:57`, `electron/services/permissions-api.ts:106`, `electron/services/permissions-api.ts:183`, `electron/services/permissions-api.ts:230`, `electron/services/permissions-api.ts:238` |
| (d) 权限层在哪个组件边界执行？ | Workspace permission 主要在 Electron Main service 边界执行；Role permission 在 runtime/subagent spawn 和 tool policy 层执行；OpenClaw exec approval/sandbox 还有独立层。 | `electron/services/terminal-api.ts:253`, `electron/services/files-api.ts:364`, `electron/services/gateway-api.ts:379`; `openclaw_runtime/src/agents/role-spawn.ts:207`, `openclaw_runtime/src/agents/role-spawn.ts:212`; `openclaw_runtime/src/agents/role-permissions-policy.ts:41` |

验证状态：源码和 `tests/unit/workspace-permissions.test.ts:40` 到 `:111` 高可信；Electron UI 实操未跑。

## 6. Checkpoint 的真实恢复能力

| 子问题 | 答案 | 出处 |
| --- | --- | --- |
| (a) ResumeCheckpoint 保存哪些数据？ | 保存 objective、activeTask、decisions、deviations、openBlockers、filesTouched、testsRun、evidenceRefs、reviewNeededItems、nextAction、controlSignals 等结构化恢复摘要，不是完整 agent 上下文、完整工具历史或文件快照。 | `shared/types/long-task-control.ts:85`; `openclaw_runtime/src/agents/long-task-control/store.ts:53`, `openclaw_runtime/src/agents/long-task-control/store.ts:387`; `openclaw_runtime/src/agents/long-task-control/store.ts:304`, `openclaw_runtime/src/agents/long-task-control/store.ts:305` |
| (b) 恢复后上下文窗口是否完全一致？ | 不完全一致。恢复依赖 checkpoint summary/evidence refs/Task Ledger/Context Pack 等重建，不是原上下文窗口 bit-for-bit replay。 | `openclaw_runtime/src/agents/long-task-control/store.ts:274`, `openclaw_runtime/src/agents/long-task-control/store.ts:304`; `docs/clawx-design-overview.md:829` |
| (c) 工具调用中间态如何处理？ | 没有看到事务级工具中间态恢复。若文件写了一半，恢复依赖实际文件系统状态、后续 review/repair 和 evidence；checkpoint 本身不保存工具结果列表，`toolResults: []`。 | `openclaw_runtime/src/agents/long-task-control/store.ts:304`; `openclaw_runtime/src/agents/sessions/tools/write.ts:407`; `openclaw_runtime/src/agents/sessions/tools/edit.ts:421` |
| (d) 存储介质是什么？ | Runtime checkpoint 写入 OpenClaw state SQLite/Kysely 表 `long_task_checkpoints`；不是纯内存。active run map 仍可能有内存态部分。 | `openclaw_runtime/src/agents/long-task-control/store.ts:137`, `openclaw_runtime/src/agents/long-task-control/store.ts:527`, `openclaw_runtime/src/agents/long-task-control/store.ts:686` |
| (e) 是否有完整性校验？损坏会怎样？ | JSON parse 有 fallback/default；replay rollback authority 对 missing/corrupted checkpoint 返回 `no_checkpoint` 或 `checkpoint_corrupted`。未见强 checksum 或完整快照一致性校验。 | `openclaw_runtime/src/agents/long-task-control/store.ts:166`, `openclaw_runtime/src/agents/long-task-control/store.ts:170`, `openclaw_runtime/src/agents/replay-rollback-authority.ts:180`, `openclaw_runtime/src/agents/replay-rollback-authority.ts:192`; `tests/unit/replay-rollback-authority.test.ts:179`, `tests/unit/replay-rollback-authority.test.ts:194` |

验证状态：源码和 Task Loop 单元测试高可信；真实崩溃恢复未 E2E 验证。  
产品化判断：checkpoint 是真实持久化恢复摘要，不是完整 VM 快照。

## 7. Context Compaction 的实际行为

| 子问题 | 答案 | 出处 |
| --- | --- | --- |
| (a) 默认阈值是多少？触发条件是什么？ | core compaction 默认 `reserveTokens: 16384`、`keepRecentTokens: 20000`，`shouldCompact` 条件是 `contextTokens > contextWindow - reserveTokens`。context-pruning 默认是 cache-ttl 模式：TTL 5 分钟、保留最近 3 个 assistant、soft trim 0.3、hard clear 0.5、最小可裁剪 tool chars 50000。 | `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts:155`, `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts:157`, `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts:158`, `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts:249`; `openclaw_runtime/src/agents/agent-hooks/context-pruning/settings.ts:52` |
| (b) 压缩发生时用户是否有感知？能否阻止或延迟？ | Chat composer 有 `/compact`、token usage、hidden messages、last compaction、quality badge、manual dialog。manual compact 会在 active run/in-progress 时禁用。自动 compaction 的用户可阻止/延迟能力没有完全确认。 | `src/pages/Chat/ChatInput.tsx:170`, `src/pages/Chat/ChatInput.tsx:926`, `src/pages/Chat/ChatInput.tsx:930`, `src/pages/Chat/ChatInput.tsx:3378`, `src/pages/Chat/ChatInput.tsx:3589`; `openclaw_runtime/src/gateway/server-methods/sessions.ts:3290` |
| (c) 压缩摘要结构是什么？预算固定还是动态？ | 摘要是结构化 Markdown/CompressionArtifact，包含 Goal、progress、current state、decisions、TODOs、constraints、exact identifiers 等。summary token limit 使用 reserveTokens 的比例计算，不是单一固定数字。 | `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts:458`, `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts:504`, `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts:581`; `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:16`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:19`; `tests/unit/compression-artifact.test.ts:64`, `tests/unit/compression-artifact.test.ts:117` |
| (d) identifier 保护具体保护什么？ | strict policy 要求 exact identifiers 逐字保留，包括 IDs、URLs、file paths、ports、hashes、dates、times。Main manual compaction 默认指令还要求保留 file paths、session ids、issue ids、function names、user decisions。 | `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:19`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:22`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:159`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:166`; `electron/services/sessions-api.ts:83`, `electron/services/sessions-api.ts:86` |
| (e) 多次压缩是否会累积损失？是否有上限？ | 会有累积信息损失风险。源码支持 previous compaction summary iterative update 和 re-distill，但未见“无损保证”或压缩次数硬上限。 | `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts:643`, `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts:829`; `openclaw_runtime/src/gateway/server-methods/sessions.ts:3384` |

验证状态：源码和 compression artifact 单元测试高可信；真实长会话多次压缩未 E2E 验证。

## 8. Memory Gatekeeper 的决策过程

| 子问题 | 答案 | 出处 |
| --- | --- | --- |
| (a) Memory proposal 由谁发起？ | 可由 UI/host API、Gateway `memory.propose`、role/system/trace/session_summary 等来源发起。自动来源会走 proposal-first，不会静默直接激活。 | `electron/services/memory-api.ts:92`; `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:557`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:569`; `openclaw_runtime/src/memory/memory-store.ts:502`, `openclaw_runtime/src/memory/memory-store.ts:509` |
| (b) confidence 如何计算？ | proposal 提供后被 normalize，默认 0.7；低于 `minConfidence` 或 0.45 会 reject，低于 0.7 会 needs_review。没有看到基于重复次数自动计算 confidence 的主路径。 | `openclaw_runtime/src/memory/gatekeeper.ts:32`, `openclaw_runtime/src/memory/gatekeeper.ts:33`, `openclaw_runtime/src/memory/gatekeeper.ts:273`, `openclaw_runtime/src/memory/gatekeeper.ts:296`, `openclaw_runtime/src/memory/gatekeeper.ts:317` |
| (c) conflict review 怎么处理？ | duplicate、contradiction、scope_conflict、role_conflict、sensitive_review 等会进入 needs_review/proposal/conflict，不是自动覆盖。review 支持 approve/reject/applyAsCold/supersede/merge。 | `openclaw_runtime/src/memory/gatekeeper.ts:321`, `openclaw_runtime/src/memory/gatekeeper.ts:334`, `openclaw_runtime/src/memory/gatekeeper.ts:337`, `openclaw_runtime/src/memory/gatekeeper.ts:340`, `openclaw_runtime/src/memory/gatekeeper.ts:342`; `openclaw_runtime/src/memory/memory-store.ts:1208`, `openclaw_runtime/src/memory/memory-store.ts:1218`, `openclaw_runtime/src/memory/memory-store.ts:1524` |
| (d) retention candidate 的评估周期是什么？ | 有 API/函数按调用生成 retention candidates/proposals，并写 `role_memory_retention_runs`。未证明有后台定时清理周期。retention 建议也是 proposal-first，需要 review。 | `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:773`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:784`; `openclaw_runtime/src/memory/memory-store.ts:1426`, `openclaw_runtime/src/memory/memory-store.ts:1454`, `openclaw_runtime/src/memory/memory-store.ts:1463`, `openclaw_runtime/src/memory/memory-store.ts:1480` |
| (e) context-pack token budget 是多少？超出怎么选？ | 默认总预算 3000 tokens。secret/secret_adjacent 不注入或被 redacted；候选按 injection class、score、role/task match、confidence、importance 排序，先受 bucket budget 限制，再受 total budget 限制，超出会标记 `bucket_budget` 或 `total_budget`。 | `openclaw_runtime/src/memory/context-pack.ts:26`, `openclaw_runtime/src/memory/context-pack.ts:54`, `openclaw_runtime/src/memory/context-pack.ts:145`, `openclaw_runtime/src/memory/context-pack.ts:161`, `openclaw_runtime/src/memory/context-pack.ts:200`, `openclaw_runtime/src/memory/context-pack.ts:241`, `openclaw_runtime/src/memory/context-pack.ts:279` |

验证状态：源码和 memory/role-memory 单元测试高可信；本轮 `role-memory-panel.spec.ts` mocked RPC UI E2E 通过，但真实 Gateway/真实用户 review 流仍未端到端验证。  
产品化判断：Memory 用户管理和注入已部分产品化，自动写入仍是 proposal-first。

## 9. 普通 Chat 与 Task Loop 的架构鸿沟

| 子问题 | 答案 | 出处 |
| --- | --- | --- |
| (a) 架构分裂是有意还是历史演化？ | 源码显示是明确分层：普通 Chat 走 `chat.send`，Task Loop 走 `task_loop.run/status`，inputMode 进入 long-task intervention 时要求 active `/loop` Task Ledger root。是否历史演化无法仅凭源码断言，但当前实现是显式边界。 | `src/pages/Chat/index.tsx:1123`; `src/stores/chat/runtime-send-actions.ts:70`; `electron/services/chat-api.ts:435`; `openclaw_runtime/src/gateway/server-methods/chat.ts:3117`; `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:436`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:503` |
| (b) 用户何时进入 Task Loop？ | 需要显式 `task_loop.run` 或 `/loop` 类路径。普通 Chat 的 `inputMode` 若没有 active Task Ledger root 会返回“ordinary Chat cannot enter long-task checkpoint/intervention state”。 | `openclaw_runtime/src/gateway/server-methods/chat.ts:3346`, `openclaw_runtime/src/gateway/server-methods/chat.ts:3361`, `openclaw_runtime/src/gateway/server-methods/chat.ts:3365`; `openclaw_runtime/src/agents/task-loop-controller.ts:2802`, `openclaw_runtime/src/agents/task-loop-controller.ts:2818` |
| (c) 普通 Chat 收到复杂任务但未触发 Task Loop 会怎样？ | 仍按普通 runtime/chat/tool 路径处理，可能调用 `team_orchestrate`，但不会自动拥有 Task Loop checkpoint、evidence gate、repair iteration。 | `openclaw_runtime/src/gateway/server-methods/chat.ts:4231`, `openclaw_runtime/src/gateway/server-methods/chat.ts:4234`; `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:130`; `openclaw_runtime/src/agents/task-loop-controller.ts:2956` |
| (d) 长远是否计划统一？ | 代码里能看到 Mission Control、Task Ledger、compaction、runtime event log 等长期统一方向，但没有证据表明“所有 Chat 默认走 Task Loop”。 | `README.md:48`, `README.md:136`; `docs/clawx-design-overview.md:22`, `docs/clawx-design-overview.md:800` |

验证状态：源码高可信；产品路线意图只能中等可信。  
产品化建议：复杂 Chat 输入应提供“升级为 Task Loop”的显式 affordance。

## 10. Workspace Permission 与 Role Permission 的关系

| 子问题 | 答案 | 出处 |
| --- | --- | --- |
| (a) 两套权限优先级是什么？ | 不在同一层，实际按更严格边界生效。workspace 允许但 role 禁止：role tool allow/deny 会挡住。workspace 禁止但 role 允许：Main/Gateway workspace gate 仍会挡住。 | `electron/services/workspace-permissions.ts:171`, `electron/services/workspace-permissions.ts:235`; `openclaw_runtime/src/agents/role-spawn.ts:6`, `openclaw_runtime/src/agents/role-spawn.ts:212`; `openclaw_runtime/src/agents/role-permissions-policy.ts:8` |
| (b) 是否存在三维权限矩阵？ | 未见统一 `[workspace mode] x [role] x [tool]` 矩阵。现状是多个 gate 叠加：workspace permission、role tool allowlist/denylist、runtime sandbox/tool policy。 | `electron/services/workspace-permissions.ts:72`; `openclaw_runtime/src/agents/role-permissions-policy.ts:41`; `openclaw_runtime/src/agents/role-spawn.ts:207` |
| (c) 评估发生在哪？ | Workspace 在 Electron Main service 对 terminal/file/Gateway RPC gate；Role 在 runtime role spawn 和 tool materialization/policy gate。 | `electron/services/terminal-api.ts:253`, `electron/services/files-api.ts:364`, `electron/services/gateway-api.ts:379`; `openclaw_runtime/src/agents/role-spawn.ts:238` |
| (d) 是否有审计日志？ | Workspace 有 approval record；role orchestration 有 role-audit 日志片段；但没有统一角色级权限审计视图。 | `electron/services/permissions-api.ts:183`, `electron/services/permissions-api.ts:238`; `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:488`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:493` |

验证状态：源码和测试高可信；当前缺统一的 `[workspace mode] x [role] x [tool]` 权限审计视图，只有 workspace approval record 与 role orchestration 日志片段。

## 11. Runtime 行为验证场景

| 场景 | 当前真实结果 | 出处 |
| --- | --- | --- |
| (a) Plan 模式调用文件写入工具，实际返回什么？ | 未跑 Electron UI 端到端。源码和单元测试显示 Plan 下 `decideWorkspaceFileWrite` 返回不允许，Main `files-api` 返回 `permissionDenied`；终端和 Gateway mutating RPC 走 block/approvalRequired。 | `electron/services/workspace-permissions.ts:206`; `electron/services/files-api.ts:364`, `electron/services/files-api.ts:395`; `tests/unit/workspace-permissions.test.ts:82`, `tests/unit/workspace-permissions.test.ts:86` |
| (b) 创建 memory proposal，观察 gatekeeper 返回值。 | 未跑真实 Gateway。单元/源码显示 secret-like reject，低置信度 reject/needs_review，自动来源 proposal-first。 | `openclaw_runtime/src/memory/gatekeeper.ts:296`, `openclaw_runtime/src/memory/gatekeeper.ts:304`, `openclaw_runtime/src/memory/gatekeeper.ts:317`; `tests/unit/memory-api.test.ts:65` |
| (c) 触发 context compaction，对比 identifier 保护。 | 未跑真实长上下文 UI。单元测试覆盖 CompressionArtifact、`## Goal`、quality warnings、micro-compact、causal anchors；identifier strict audit 源码存在。 | `tests/unit/compression-artifact.test.ts:64`, `tests/unit/compression-artifact.test.ts:117`, `tests/unit/compression-artifact.test.ts:182`, `tests/unit/compression-artifact.test.ts:198`; `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:247` |
| (d) Task Loop 制造子任务失败，观察 checkpoint/repair。 | 未跑真实 Gateway，但 `task-loop-controller.test.ts` 覆盖 worker failure、repair/blocked、checkpoint、Task Ledger root。 | `tests/unit/task-loop-controller.test.ts:508`, `tests/unit/task-loop-controller.test.ts:551`, `tests/unit/task-loop-controller.test.ts:2614`, `tests/unit/task-loop-controller.test.ts:2796`; `openclaw_runtime/src/agents/task-loop-controller.ts:3106`, `openclaw_runtime/src/agents/task-loop-controller.ts:3120` |
| (e) 明文密钥 chat message，检查 Trace 持久化脱敏。 | 未跑真实 chat transcript。`observability-index` 单元测试确认 raw span input/output/attribute 不泄漏到 persisted index，并出现 redacted preview/hash。不能外推到 transcript/file/raw tool content。 | `tests/unit/observability-index.test.ts:46`, `tests/unit/observability-index.test.ts:108`, `tests/unit/observability-index.test.ts:118`; `electron/services/observability-index.ts:145` |

结论：第 11 组指定的 5 个运行时压力场景仍未完成“真实端到端”验证，只完成源码级和单元级验证；第 0 节补充的 E2E 只覆盖部分 UI mocked RPC 场景。把可信度提升到 95% 仍需要真实 Gateway replay、真实文件/trace/transcript 检查和长会话压缩验证。

## 12. 代码路径完整链路追踪

| 路径 | 调用链 | 关键出处 |
| --- | --- | --- |
| (a) Chat 输入框回车到模型处理 | `src/pages/Chat/index.tsx` 调用 store `sendMessage` -> `src/stores/chat/runtime-send-actions.ts` -> `hostApi.chat.sendWithMedia` -> `electron/services/chat-api.ts` -> `gatewayManager.rpc('chat.send')` -> `openclaw_runtime/src/gateway/server-methods/chat.ts` -> `dispatchInboundMessage` -> runtime/agent -> transcript/runtime events -> store handlers/UI render。 | `src/pages/Chat/index.tsx:1123`; `src/stores/chat/runtime-send-actions.ts:70`, `src/stores/chat/runtime-send-actions.ts:241`; `src/lib/host-api.ts:971`; `electron/services/chat-api.ts:338`, `electron/services/chat-api.ts:435`; `openclaw_runtime/src/gateway/server-methods/chat.ts:3117`, `openclaw_runtime/src/gateway/server-methods/chat.ts:4231`, `openclaw_runtime/src/gateway/server-methods/chat.ts:4234`; `src/stores/chat.ts:4568` |
| (b) 多角色编排 | Gateway `orchestrator.plan/run` 或 runtime `team_orchestrate` -> `createOrchestratorPlan` -> routing memo/role router scoring -> `runOrchestrationObserved` -> `buildRoleSpawnContext` -> subagent sessions/spawn -> collect worker/verifier outcomes -> failures/partial/repair/reroute -> trace/runtime graph/UI。 | `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:275`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:341`; `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:205`; `openclaw_runtime/src/agents/orchestrator.ts:288`; `openclaw_runtime/src/agents/orchestrator-run-observed.ts:219`, `openclaw_runtime/src/agents/orchestrator-run-observed.ts:526`, `openclaw_runtime/src/agents/role-spawn.ts:208` |
| (c) Memory 生命周期 | UI/host API/Gateway `memory.propose` -> `proposeMemoryCard` -> `gatekeeper` accept/needs_review/reject -> SQLite cards/proposals/conflicts/audit/injections -> review API -> context-pack selection -> role-memory context provider/role spawn 注入 -> UI explain/detail。 | `electron/services/memory-api.ts:92`; `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:557`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:691`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:963`; `openclaw_runtime/src/memory/memory-store.ts:236`, `openclaw_runtime/src/memory/memory-store.ts:293`, `openclaw_runtime/src/memory/memory-store.ts:862`, `openclaw_runtime/src/memory/memory-store.ts:1208`, `openclaw_runtime/src/memory/context-pack.ts:229` |
| (d) Trace span 生命周期 | runtime/service 创建 trace/span/event -> `observability.reportTrace` 或 Main index -> `sanitizeTraceForPersistence` -> `trace-index.jsonl` -> observability API/UI graph。 | `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:522`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:531`; `electron/services/observability-index.ts:145`, `electron/services/observability-index.ts:239`; `electron/services/observability-redaction.ts:93`, `electron/services/observability-redaction.ts:107`; `tests/unit/observability-index.test.ts:118` |

验证状态：源码调用链高可信；未做全链路运行跟踪。

## 13. 挑战 80%-85% 可信度评估

| 子问题 | 答案 | 出处 |
| --- | --- | --- |
| (a) 剩余 15%-20% 不确定性在哪？ | 集中在真实 Electron/Gateway 行为、UI 状态、默认配置、dirty worktree 是否代表目标版本、pilot/shadow 是否真实启用、transcript/file/diff 的敏感内容处理。 | `git status --short` 约 926 条；CodeGraph 失败；第 11 组未 E2E 验证。 |
| (b) 提升到 95% 需要补什么？ | 需要更多针对灰色地带的 Playwright/Electron E2E、真实 Gateway RPC replay、真实 trace/transcript 文件检查、主分支对比、dirty worktree 固定 commit。 | 测试缺口来自本文件第 0 和第 11 节；本轮 E2E 还暴露了 execution graph 的两个失败场景。 |
| (c) 高可信结论中是否可能是死代码？是否检查调用者？ | 有可能，尤其 routing memo active、replay rollback authority、compaction branch/restore、某些 Task Loop intervention 分支。已检查部分调用者：routing memo 在 orchestrator plan/run 中被调用；Task Loop 由 gateway methods 暴露；Memory/Observability 有 host/Gateway API。仍需 runtime coverage/telemetry 证明真实流量。 | `openclaw_runtime/src/agents/orchestrator.ts:306`; `openclaw_runtime/src/agents/orchestrator-run-observed.ts:610`; `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:436`; `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:557`; `openclaw_runtime/src/gateway/server-methods/sessions.ts:3200` |
| (d) 是否确认主分支存在？ | 未确认。当前结论基于工作区 `knowledge-ux-polish@5d9a3f3`，且工作区有大量变更/未跟踪文件。 | `git branch --show-current`, `git rev-parse --short HEAD`, `git status --short` |

更新后的综合可信度：源码真实性约 88%-92%；产品化真实性低于源码真实性。经过本轮补充 E2E 后，Memory 面板、Work Mode、角色来源 badge 的产品化可信度上调；Chat execution graph 历史/内部 yield 场景的产品化可信度下调。

## 14. 原报告可能遗漏的重要能力扫描

| 目录 | 发现的重要能力 | 代表出处 |
| --- | --- | --- |
| `openclaw_runtime/src/agents/` | Agent Browser tool、Mission Control、model auth/catalog/fallback、sandbox、tool policy/effective inventory、resource-aware scheduler、media generation、runtime memory eval 等。 | `openclaw_runtime/src/agents/tools/agent-browser-tool.ts`; `openclaw_runtime/src/agents/mission-control/controller.ts`; `openclaw_runtime/src/agents/model-catalog.ts`; `openclaw_runtime/src/agents/model-fallback.ts`; `openclaw_runtime/src/agents/sandbox.ts`; `openclaw_runtime/src/agents/tools-effective-inventory.ts`; `openclaw_runtime/src/agents/resource-aware-wave-scheduler.ts` |
| `openclaw_runtime/src/gateway/server-methods/` | Agent Browser、Mission Control、local control plane、capabilities、tools-effective、TTS/talk/voicewake、models、cron/channels 等 RPC surface。 | `openclaw_runtime/src/gateway/server-methods/agent-browser.ts`; `openclaw_runtime/src/gateway/server-methods/mission-control-methods.ts`; `openclaw_runtime/src/gateway/server-methods/local-control-plane.ts`; `openclaw_runtime/src/gateway/server-methods/capabilities.ts`; `openclaw_runtime/src/gateway/server-methods/tools-effective.ts`; `openclaw_runtime/src/gateway/server-methods/tts.ts`; `openclaw_runtime/src/gateway/server-methods/talk.ts`; `openclaw_runtime/src/gateway/server-methods/voicewake.ts` |
| `electron/services/` | Agent Browser service/API、capabilities API、memory API、orchestration presets、resource tracker/leases、sandbox API、work providers、remote tasks。 | `electron/services/agent-browser-api.ts`; `electron/services/agent-browser-service.ts`; `electron/services/capabilities-api.ts`; `electron/services/memory-api.ts`; `electron/services/orchestration-presets-api.ts`; `electron/services/resource-tracker-api.ts`; `electron/services/resource-leases.ts`; `electron/services/sandbox-api.ts`; `electron/services/work-providers-api.ts` |
| `shared/types/` | Mission Control、Memory、Task Ledger、Sandbox、Resource Tracker、Remote Tasks、Cron、Channel、Work Provider 等类型面。 | `shared/types/mission-control.ts`; `shared/types/memory.ts`; `shared/types/task-ledger.ts`; `shared/types/sandbox.ts`; `shared/types/resource-tracker.ts`; `shared/types/remote-tasks.ts`; `shared/types/cron.ts`; `shared/types/channel.ts`; `shared/types/work-provider.ts` |
| `src/stores/` | Resource tracker、providers、cron/channels/chat 等前端状态管理，说明 UI surface 不止 Chat/Task Loop。 | `src/stores/resource-tracker.ts`; `src/stores/providers.ts`; `src/stores/cron.ts`; `src/stores/channels.ts`; `src/stores/chat.ts` |

这些能力不推翻原审计核心结论，但说明系统能力矩阵应扩展到 Agent Browser、Mission Control、Sandbox、Capabilities、Resource/Provider/Channel 等领域。

## 15. 产品化三分类细化

本节分类只作为路线图短标签，不作为最终边界。最终边界以第 0.3 节为准。这里的三类含义收紧为：

| 分类短标签 | 精确定义 |
| --- | --- |
| 已产品化 | 至少有用户 UI 或明确 API 入口，并且本轮源码/测试未发现阻断该入口的反证。 |
| 底层存在但未贯通 | 已找到数据模型、API、测试或局部 UI，但至少缺一个关键闭环：默认启用、用户入口、持久化、质量信号、回写路径、端到端运行证据。 |
| 未实现 | 当前定位范围内没有找到支撑该能力的核心数据模型、执行路径或 UI/API 入口。 |

| 能力 | 分类 | 答案与依据 |
| --- | --- | --- |
| (a) 可编辑任务 DAG | 底层存在但未贯通 | Task Ledger/Workboard 有 node/edge/drag/dependency；Chat `OrchestrationPlanView` 只读。出处见第 1 节。 |
| (b) 角色动态淘汰/学习 | 底层存在但未贯通 | Routing Memo off/shadow/active 存在，默认 off，qualityOverall 未贯通。出处见第 2 节。 |
| (c) 任务失败自动回滚 | 底层存在但未贯通；严格意义“全自动文件级回滚”未实现 | rollback plan、checkpoint restore、replay rollback authority 存在，但 checkpoint 不是文件系统快照。出处：`openclaw_runtime/src/agents/replay-rollback-authority.ts:143`, `openclaw_runtime/src/agents/replay-rollback-authority.ts:180`, `openclaw_runtime/src/agents/long-task-control/store.ts:304`。 |
| (d) 低置信度自动暂停请求确认 | 底层存在但未贯通 | Memory low confidence needs_review；Task Loop control signals/self-check 可 ask/repair/block；普通 Chat route confidence 未统一成自动暂停确认。出处：`openclaw_runtime/src/memory/gatekeeper.ts:317`, `openclaw_runtime/src/agents/task-loop-self-check.ts:289`, `openclaw_runtime/src/agents/task-loop-controller.ts:3087`。 |
| (e) 跨会话经验迁移 | 部分产品化 | Role Memory 管理/注入已有 UI/API；Routing Memo 仍默认 off。出处见第 8 节和第 2 节。 |
| (f) 并发子任务执行 | 部分产品化 | Orchestrator/team_orchestrate/subagent 执行存在并有测试；普通 Chat 不强制进入该模式。出处：`openclaw_runtime/src/agents/orchestrator-run-observed.ts:219`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:130`, `tests/unit/role-orchestration-methods.test.ts:360`。 |
| (g) 用户自定义角色 | 底层存在但未贯通到完整创建 UI | `cfg.agents.roles[]` 可定义/覆盖角色，RoleCard 显示 built-in/config badge；但未见完整友好角色创建 UI。出处：`openclaw_runtime/src/agents/role-registry.ts:6`, `openclaw_runtime/src/agents/role-registry.ts:75`, `src/components/agents/RoleCard.tsx:27`, `tests/e2e/role-origin-badge.spec.ts:89`。 |
| (h) 任务执行实时进度推送 | 部分产品化 | runtime events、ExecutionGraphCard、Task Loop/role events 存在；本轮 E2E 证明部分执行图场景可显示，但 internal yield/长历史折叠场景失败，稳定性不足。出处：`src/pages/Chat/ExecutionGraphCard.tsx:166`, `src/stores/chat.ts:4568`, `openclaw_runtime/src/agents/task-loop-controller.ts:2972`; `tests/e2e/chat-task-visualizer.spec.ts:373`, `tests/e2e/chat-task-visualizer.spec.ts:501`。 |
| (i) 上下文压缩用户可感知通知 | 部分产品化 | Chat composer 显示 compact 状态、quality、manual dialog；自动压缩通知/延迟控制仍需确认。出处见第 7 节。 |
| (j) Memory 用户可管理界面 | 部分产品化 | Roles panel/host API/Gateway 提供 list/proposal/review/detail/injection/retention 等路径。出处：`src/components/agents/RolesOrchestrationPanel.tsx`, `electron/services/memory-api.ts:92`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:673`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:691`。 |

## 16. 产品化优先级建议

| 优先级 | 能力 | 用户价值 | 工程成本 | 风险 | 建议 |
| --- | --- | --- | --- | --- | --- |
| 1 | Chat Plan -> Task Ledger 投影/轻编辑 | 高 | 中 | 中 | 先只读投影，再开放 add/remove dependency，最后决定回写策略。 |
| 2 | `team_orchestrate` quality summary | 高 | 中 | 中 | 先把 worker outcome 和 verifier verdict 转成统一 scorecard，再提供 overall/worst/reason。 |
| 3 | Workspace/Role permission 统一审计视图 | 高 | 低到中 | 低到中 | 新增 `PermissionDecisionEvent`，串联 workspaceMode、roleName、toolName、boundary、decision、reason、requestId。 |
| 4 | Routing Memo shadow dashboard | 中高 | 中 | 中高 | 先默认 shadow，展示 divergence/outcome 证据，达标后再允许 active。 |
| 5 | Low-confidence ask-user bridge | 中高 | 中 | 高 | 把 evidence gap/route uncertainty 映射成明确用户确认，不要静默阻断或静默升级。 |

暂不建议优先做“全自动回滚”。当前 checkpoint 不是文件快照，直接产品化为自动文件级回滚风险高。

## 17. 审计能力自我评估

| 子问题 | 回答 |
| --- | --- |
| (a) 实际读取多少文件？是否有读取失败？ | 本轮直接或片段读取/定位了 70+ 个源码、测试、文档文件；目录扫描覆盖 `openclaw_runtime/src/agents`、`openclaw_runtime/src/gateway/server-methods`、`electron/services`、`shared/types`、`src/stores`。CodeGraph CLI 读取失败，原因是缺 `picomatch`。 |
| (b) 行号验证方法是什么？ | 用 `rg -n` 精确定位符号和关键字符串，再结合上下文判断语义；不是只验证行号在文件范围内。行号基于当前 dirty workspace，后续变更可能漂移。 |
| (c) 是否发现原报告事实性错误？ | 更准确地说，是发现了需要收窄的表述：不能用旧/deprecated `work-mode.ts` 证明当前 Plan 权限；“未见可编辑 DAG”应收窄为 Chat plan 未接 DAG 编辑，而非底层完全没有 DAG；“动态角色淘汰未实现”应改为 Routing Memo 底层存在但默认 off；“Memory 未产品化”应降权，因为 Roles panel/API 已有不少管理路径；Task Loop 质量闭环不能和普通 `team_orchestrate` 混写。 |
| (d) 如果重做，会改变什么？ | 先修 CodeGraph 依赖并保存原始定位记录；固定干净 commit/branch；补 Playwright/Electron E2E；用假密钥做 trace/transcript/diff/compaction 脱敏矩阵；对 `origin/main` 做关键文件存在性对比。 |

## 18. 新附件 44 项模块化问题核验补充

本节复核附件 `C:\Users\27933\.codex\attachments\c9b708c0-0feb-411e-ad5b-18b55f773633\pasted-text.txt` 中的 44 项模块化结论。附件开头声称“已先用 CodeGraph 做函数定位”，但本轮本地执行 `node openclaw_runtime/extensions/codegraph/dist/bin/codegraph.js --help` 失败，错误为缺少 `picomatch` 依赖。因此，本节不把 CodeGraph 定位视为本轮已复现证据，结论以当前工作区源码、测试和 `rg` 定位复核为准。

本节表格里的 `已实现`、`部分实现`、`未见完整实现` 只是短标签，不能单独作为结论。每一项的正式边界必须读成：已确认哪些代码/测试成立、当前未找到哪些链路、用户因此能做什么和不能做什么。对核心能力的硬边界汇总见第 0.3 节。

### 18.1 模块一：用户输入到任务执行

| 编号 | 原问题/能力点 | 核验答案 | 出处 |
| --- | --- | --- | --- |
| 1 | 用户输入后是否进入明确 Plan 状态机？ | 部分实现。Chat send 主链路真实存在；若 Workspace 模式为 plan/readOnly，会在终端、文件、Gateway mutating RPC 边界拦截变更。但普通 Chat 输入后并不会自动进入一个独立的、可编辑的 Plan 状态机。 | `src/stores/chat.ts:3795`, `src/stores/chat/runtime-send-actions.ts:218`, `electron/services/chat-api.ts:338`, `openclaw_runtime/src/gateway/server-methods/chat.ts:3117`, `shared/types/work-mode.ts:250`, `electron/services/workspace-permissions.ts:179` |
| 2 | 是否自动拆解并分配多角色？ | 部分实现。普通 Chat 不强制多角色拆分；走 `orchestrator.plan/run`、`team_orchestrate` 或 Task Loop 时，才会按 role router、orchestrator 和 role contract 选择 planner、architect、implementer、tester、reviewer 等角色。 | `openclaw_runtime/src/agents/role-contract.ts:261`, `openclaw_runtime/src/agents/role-router.ts:45`, `openclaw_runtime/src/agents/orchestrator.ts:288`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:230`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:275` |
| 3 | Workspace 是否自动创建项目、装依赖并执行？ | 部分实现。Workspace 权限层能控制终端命令、文件写入和 Gateway RPC；依赖安装本质上仍是终端命令或工具调用，不是“自动生成完整项目”的统一产品流。 | `electron/services/workspace-permissions.ts:200`, `electron/services/terminal-api.ts:251`, `electron/services/files-api.ts:356`, `electron/services/gateway-api.ts:374` |
| 4 | Trace / 事件图是否存在？ | 已实现。Observability trace/span/event 类型、runtime recorder/buffer、Main 持久化 API、Chat 执行图和 Observability 页面均存在。 | `shared/types/observability.ts:37`, `openclaw_runtime/src/observability/trace-recorder.ts:100`, `openclaw_runtime/src/observability/trace-buffer.ts:34`, `electron/services/observability-api.ts:41`, `src/pages/Chat/ExecutionGraphCard.tsx:166`, `src/pages/Observability/index.tsx:547` |
| 5 | 工作面板是否展示计划/执行图并随状态更新？ | 部分实现。ExecutionGraphCard、task visualization 和 OrchestrationPlanView 存在；但 Chat plan 视图主要是只读渲染，不能直接编辑 DAG。 | `src/pages/Chat/task-visualization.ts:388`, `src/pages/Chat/ExecutionGraphCard.tsx:196`, `src/components/agents/OrchestrationPlanView.tsx:68`, `src/components/agents/RolesOrchestrationPanel.tsx:2248` |
| 6 | 完成后是否回写 final assistant 和完成态？ | 已实现。Chat store/runtime send 链路会处理 assistant final、streaming/sending 状态清理和 runtime graph 事件；Observability/Execution graph 可反映完成或失败状态。 | `src/stores/chat.ts:3978`, `src/stores/chat.ts:4003`, `src/stores/chat.ts:4022`, `src/stores/chat/runtime-send-actions.ts:241`, `electron/services/chat-api.ts:435` |

### 18.2 模块二：Plan 编辑与任务 DAG

| 编号 | 原问题/能力点 | 核验答案 | 出处 |
| --- | --- | --- | --- |
| 7 | 是否有可拖拽编辑的 Chat 任务 DAG？ | 未见完整实现。Task Ledger 有 node/edge/DAG 类型和 `taskLedger.addEdge`，Workboard 有卡片拖拽和依赖/移动能力；但 Chat 侧 `OrchestrationPlanView` 是只读计划渲染，没有接入 DAG 编辑、断点或依赖调整。 | `shared/types/task-ledger.ts:16`, `shared/types/task-ledger.ts:45`, `electron/services/task-ledger-api.ts:117`, `openclaw_runtime/ui/src/ui/controllers/workboard.ts:372`, `openclaw_runtime/ui/src/ui/views/workboard.ts:595`, `src/components/agents/OrchestrationPlanView.tsx:68` |
| 8 | 确认 plan 后是否持久化可恢复？ | 部分实现。角色编排可确认并调用 `orchestrator.run`；Task Loop checkpoint 是持久化的；普通 orchestration plan 本身没有被证明会作为独立可编辑 DAG 持久化。 | `src/components/agents/RolesOrchestrationPanel.tsx:1129`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:341`, `shared/types/long-task-control.ts:85`, `openclaw_runtime/src/agents/long-task-control/store.ts:527` |
| 9 | Plan 阶段是否支持结构化 diff/增量编辑？ | 部分实现。普通计划未见结构化 plan-diff 编辑 UI；长任务运行中支持 guide/queue/interrupt/revise-goal 等 intervention，并会通过 checkpoint/abort/drain 处理。 | `shared/types/long-task-control.ts:360`, `shared/types/long-task-control.ts:399`, `openclaw_runtime/src/gateway/server-methods/chat.ts:3336`, `openclaw_runtime/src/gateway/server-methods/chat.ts:3370`, `openclaw_runtime/src/gateway/server-methods/chat.ts:3423` |

### 18.3 模块三：角色系统

| 编号 | 原问题/能力点 | 核验答案 | 出处 |
| --- | --- | --- | --- |
| 10 | 内置角色及职责是否真实存在？ | 已实现。内置角色包括 planner、architect、implementer、tester、reviewer、security-reviewer、docs-writer、skeptic；角色由 prompt、tools、capabilities、permissions、output schema、handoff 等定义。 | `openclaw_runtime/src/agents/role-contract.ts:261`, `openclaw_runtime/src/agents/role-contract.ts:277`, `openclaw_runtime/src/agents/role-contract.ts:293`, `openclaw_runtime/src/agents/role-contract.ts:309`, `openclaw_runtime/src/agents/role-contract.ts:325`, `openclaw_runtime/src/agents/role-contract.ts:341`, `openclaw_runtime/src/agents/role-contract.ts:357`, `openclaw_runtime/src/agents/role-contract.ts:373` |
| 11 | 是否会根据表现动态淘汰/学习角色？ | 部分实现。role router、orchestrator diagnostics 和 routing memo 存在；routing memo 有 success +2、poor_attempt -1 等打分逻辑。缺口是：pilot 默认 off，`qualityOverall` 尚未填充，未找到基于真实质量评分自动降低/淘汰角色的路由闭环。 | `openclaw_runtime/src/agents/role-router.ts:59`, `openclaw_runtime/src/agents/orchestration-protocol.ts:454`, `openclaw_runtime/src/agents/routing-memo.ts:55`, `openclaw_runtime/src/agents/routing-memo.ts:65`, `openclaw_runtime/src/agents/routing-memo.ts:192`, `openclaw_runtime/src/agents/orchestrator-run-observed.ts:617` |
| 12 | 子代理是否隔离上下文并避免全量泄漏？ | 部分实现。subagent 支持 isolated/fork 模式，role spawn 会构造角色上下文、工具权限和 memory context；但不是所有路径都能证明“只传最小上下文”，仍需依赖具体 spawn/context pack 策略。 | `openclaw_runtime/src/agents/role-spawn.ts:115`, `openclaw_runtime/src/agents/role-spawn.ts:124`, `openclaw_runtime/src/agents/role-spawn.ts:187`, `openclaw_runtime/src/agents/subagent-spawn.ts:475`, `openclaw_runtime/src/agents/subagent-spawn.ts:498`, `openclaw_runtime/src/agents/subagent-spawn.ts:1459` |
| 13 | 角色级工具权限是否真实拦截？ | 部分实现偏强。role permission policy、tool allow/deny 和 workspace approval gate 均存在；但命令参数级过滤和统一权限审计不是完整闭环。 | `openclaw_runtime/src/agents/role-permissions-policy.ts:78`, `openclaw_runtime/src/agents/role-spawn.ts:207`, `openclaw_runtime/src/agents/role-spawn.ts:212`, `electron/services/workspace-permissions.ts:249`, `electron/services/permissions-api.ts:183` |
| 14 | 用户自定义/临时角色是否存在？ | 部分实现。role registry 支持配置角色、覆盖/新增角色，UI 可显示 built-in/config origin；未见按技术栈自动生成临时角色并任务结束退役的完整机制。 | `openclaw_runtime/src/agents/role-registry.ts:1`, `openclaw_runtime/src/agents/role-registry.ts:6`, `openclaw_runtime/src/agents/role-registry.ts:75`, `src/components/agents/RoleCard.tsx:27`, `src/components/agents/RoleCard.tsx:96` |
| 15 | worker 输出是否有质量评分并反馈路由？ | 部分实现。Task Loop 有 evidence gate、self-check、repair iteration；普通 `team_orchestrate` 明确返回 `quality: []` 和空质量摘要，未形成统一质量评分反哺路由。 | `openclaw_runtime/src/agents/task-loop-controller.ts:2956`, `openclaw_runtime/src/agents/task-loop-controller.ts:3111`, `openclaw_runtime/src/agents/task-loop-self-check.ts:132`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:272`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:273` |

### 18.4 模块四：Gateway 与通信生命周期

| 编号 | 原问题/能力点 | 核验答案 | 出处 |
| --- | --- | --- | --- |
| 16 | Electron 是否启动并管理 Gateway？ | 已实现。Main 初始化阶段会启动 Gateway manager、广播状态，Gateway API 通过 manager RPC 转发，并有状态/错误事件。 | `electron/main/index.ts:929`, `electron/main/index.ts:1003`, `electron/main/index.ts:1202`, `electron/gateway/manager.ts:586`, `electron/gateway/manager.ts:611`, `electron/services/gateway-api.ts:374` |
| 17 | 退出时是否清理 Gateway/扩展/连接？ | 已实现但为 best-effort。退出路径会 teardown extension、stop Gateway、清 timer/WebSocket/进程，超时或异常时走强制终止/兜底。 | `electron/main/index.ts:1323`, `electron/main/index.ts:1325`, `electron/main/index.ts:1328`, `electron/gateway/manager.ts:984`, `electron/gateway/manager.ts:995`, `electron/gateway/manager.ts:999` |
| 18 | 是否避免 Workspace/Runtime 循环依赖？ | 部分实现。未见 Workspace 任意反调 Runtime 的循环依赖模型；Gateway/host API 是主要边界。子代理侧有 spawn depth、children 等限制，防止递归失控。 | `electron/gateway/manager.ts:1306`, `electron/gateway/manager.ts:1328`, `openclaw_runtime/src/agents/subagent-spawn.ts:1170`, `openclaw_runtime/src/agents/subagent-spawn.ts:1179` |
| 19 | 通信是否为异步 JSON-RPC 并有 timeout？ | 已实现。Gateway manager 有 pending request、timeout、resolve/reject 和 event broadcast；这是异步 RPC/事件机制，不是强事务消息队列。 | `electron/gateway/manager.ts:229`, `electron/gateway/manager.ts:239`, `electron/gateway/manager.ts:633`, `electron/gateway/manager.ts:1306`, `src/stores/chat.ts:4568` |
| 20 | Observability 失败是否影响任务执行？ | 已实现为 best-effort。observability API 和 trace buffer 设计为尽量记录；buffer 是 MVP 内存态，trace 拉取/索引失败不应阻塞主任务，但重启丢失内存 buffer。 | `openclaw_runtime/src/observability/trace-buffer.ts:1`, `openclaw_runtime/src/observability/trace-buffer.ts:50`, `electron/services/observability-api.ts:79`, `electron/services/observability-index.ts:145` |

### 18.5 模块五：失败、回滚与幂等

| 编号 | 原问题/能力点 | 核验答案 | 出处 |
| --- | --- | --- | --- |
| 21 | 任务失败是否自动全量回滚？ | 部分实现。rollback plan、replay rollback authority、checkpoint restore 和 subagent provisional cleanup 存在；但没有证据表明任意任务链失败后会自动回滚所有文件系统变更。 | `src/pages/Chat/rollback-plan.ts:73`, `openclaw_runtime/src/agents/replay-rollback-authority.ts:143`, `openclaw_runtime/src/agents/replay-rollback-authority.ts:180`, `openclaw_runtime/src/agents/subagent-spawn.ts:1609`, `openclaw_runtime/src/agents/subagent-spawn.ts:1647` |
| 22 | 是否有全局幂等策略？ | 部分实现。Chat/checkpoint/intervention/queue 等有 idempotency/upsert/dedupe 思路；文件写入、创建、外部命令没有统一全局幂等保证，仍取决于具体工具行为。 | `openclaw_runtime/src/gateway/server-methods/chat.ts:3912`, `openclaw_runtime/src/gateway/server-methods/chat.ts:4103`, `openclaw_runtime/src/agents/long-task-control/store.ts:511`, `openclaw_runtime/src/agents/long-task-control/store.ts:521`, `src/stores/chat.ts:4568` |
| 23 | 长任务运行中是否支持用户干预？ | 已实现。long-task input mode 支持 guide、queue、interrupt、revise-goal 等；interrupt/revise 会 checkpoint/abort 并启动新 run，queue 会等待当前 run 后 drain。 | `shared/types/long-task-control.ts:399`, `shared/types/long-task-control.ts:405`, `shared/types/long-task-control.ts:416`, `openclaw_runtime/src/gateway/server-methods/chat.ts:3370`, `openclaw_runtime/src/gateway/server-methods/chat.ts:3566` |
| 24 | checkpoint 是否保存完整上下文和文件快照？ | 已实现恢复摘要，但不是完整快照。ResumeCheckpoint 保存 objective、activeTask、blockers、decisions、deviations、files、tests、nextAction、evidence、controlSignals 等结构化状态；不包含完整 agent 上下文、完整工具历史或文件系统快照。 | `shared/types/long-task-control.ts:85`, `shared/types/long-task-control.ts:91`, `shared/types/long-task-control.ts:97`, `shared/types/long-task-control.ts:104`, `openclaw_runtime/src/agents/long-task-control/store.ts:53`, `openclaw_runtime/src/agents/long-task-control/store.ts:387` |
| 25 | approval 无反馈时是否自动通过？ | 部分实现。workspace approval 有 pending/TTL/event record；未见无反馈自动批准。更准确说是保持 pending、过期或阻塞，取决于调用边界。 | `electron/services/permissions-api.ts:45`, `electron/services/permissions-api.ts:116`, `electron/services/permissions-api.ts:183`, `electron/services/permissions-api.ts:238` |
| 26 | 是否有统一重试和降级？ | 部分实现。模型 fallback、Gateway reconnect、web tool cache/timeout 存在；未见“所有 API 统一重试 N 次”的全局策略。 | `openclaw_runtime/src/agents/model-fallback.ts:1225`, `openclaw_runtime/src/agents/model-fallback.ts:1297`, `openclaw_runtime/src/agents/model-fallback.ts:1511`, `electron/gateway/manager.ts:1415`, `openclaw_runtime/src/agents/tools/web-shared.ts:24` |

### 18.6 模块六：资源与上下文预算

| 编号 | 原问题/能力点 | 核验答案 | 出处 |
| --- | --- | --- | --- |
| 27 | token/timeout/tool 次数是否有统一上限与新会话建议？ | 部分实现。token 压力会触发 compaction/context pruning；Chat/Gateway 有 timeout/no-response 保护；未见统一工具调用次数上限和自动建议新开会话的产品闭环。 | `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts:106`, `openclaw_runtime/src/agents/agent-hooks/context-pruning/settings.ts:53`, `src/stores/chat.ts:169`, `electron/services/chat-api.ts:435` |
| 28 | 上下文压力阈值是否真实存在？ | 已实现。compression planner 有 0.6/0.75/0.85/0.95 等压力等级；context-pruning 默认 TTL、soft/hard trim、最近 assistant 保留等配置也存在。 | `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts:106`, `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts:107`, `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts:108`, `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts:109`, `openclaw_runtime/src/agents/agent-hooks/context-pruning/settings.ts:53` |
| 29 | 压缩时哪些内容优先保留/牺牲？ | 已实现。compaction safeguard 保护 recent turns、exact identifiers、pending asks、workspace rules 等；旧 tool/trace/低优先内容更可能被摘要或裁剪。 | `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:326`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:344`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:879`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:167` |

### 18.7 模块七：Compaction 质量与用户感知

| 编号 | 原问题/能力点 | 核验答案 | 出处 |
| --- | --- | --- | --- |
| 30 | compaction 能否保证不偏离？ | 已实现防护但不能证明零偏差。代码要求固定结构、identifier audit、quality guard、retry/re-distill；但源码只能证明有防护机制，不能证明真实长会话永不丢失或扭曲信息。 | `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:907`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:952`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:233`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts:249` |
| 31 | 用户是否能看见/确认压缩摘要并恢复？ | 部分实现。Chat input 有 compact 状态、manual compact dialog、quality badge 等用户感知点；未见每次自动压缩都要求用户确认。恢复依赖 transcript/checkpoint/ledger/memory/trace 等，runtime trace buffer 重启会丢。 | `src/pages/Chat/ChatInput.tsx:926`, `src/pages/Chat/ChatInput.tsx:942`, `src/pages/Chat/ChatInput.tsx:3378`, `src/pages/Chat/ChatInput.tsx:3589`, `openclaw_runtime/src/observability/trace-buffer.ts:1` |
| 32 | 多次压缩是否会摘要再摘要？ | 已实现防护。代码存在 previous summary re-distill、latest ask overlap、identifier audit 和 quality retry；仍不能宣称无损，也未见压缩次数硬上限。 | `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:1065`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:1156`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:1173`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:1256`, `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts:1307` |

### 18.8 模块八：Memory

| 编号 | 原问题/能力点 | 核验答案 | 出处 |
| --- | --- | --- | --- |
| 33 | Memory 是否有置信度、冲突与覆盖策略？ | 部分实现。MemoryCard/Proposal 有 confidence、importance、status、source、scope、supersedes 等；gatekeeper 会标记 duplicate、contradiction、scope/role conflict 并进入 review，不是无条件覆盖。 | `openclaw_runtime/src/memory/types.ts:55`, `openclaw_runtime/src/memory/types.ts:60`, `openclaw_runtime/src/memory/types.ts:65`, `openclaw_runtime/src/memory/gatekeeper.ts:321`, `openclaw_runtime/src/memory/gatekeeper.ts:334`, `openclaw_runtime/src/memory/gatekeeper.ts:337` |
| 34 | retention 是否评分？ | 已实现。memory-policy 会按 age、access、evidence、importance、confidence、sensitivity 等因素评估 keep/cold/archive/tombstone/review。 | `openclaw_runtime/src/memory/memory-policy.ts:244`, `openclaw_runtime/src/memory/memory-policy.ts:247`, `openclaw_runtime/src/memory/memory-policy.ts:258`, `openclaw_runtime/src/memory/memory-policy.ts:269`, `openclaw_runtime/src/memory/memory-policy.ts:278` |
| 35 | 跨会话经验迁移是否可用？ | 部分实现。SQLite memory store、context-pack 和 role memory injection 支撑跨会话召回；routing memo 是另一套机制且默认 off，不能等同为完整在线学习。 | `openclaw_runtime/src/memory/memory-store.ts:54`, `openclaw_runtime/src/memory/context-pack.ts:18`, `openclaw_runtime/src/memory/context-pack.ts:230`, `openclaw_runtime/src/agents/role-spawn.ts:124`, `openclaw_runtime/src/agents/routing-memo.ts:80` |
| 36 | 是否每次任务结束都自动总结入库？ | 部分实现。proposal source 包括 user、role、system、trace、session_summary；gatekeeper 审核后 accept/reject/needs_review。未见“每次任务结束自动激活写入”的保证，自动路径仍是 proposal-first。 | `openclaw_runtime/src/memory/types.ts:17`, `openclaw_runtime/src/memory/gatekeeper.ts:273`, `openclaw_runtime/src/memory/gatekeeper.ts:296`, `openclaw_runtime/src/memory/gatekeeper.ts:304`, `electron/services/memory-api.ts:87`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:555` |

### 18.9 模块九：UI 状态一致性

| 编号 | 原问题/能力点 | 核验答案 | 出处 |
| --- | --- | --- | --- |
| 37 | 用户编辑某个任务时是否有事务回滚？ | 部分实现。runtime event 去重/stale event 处理存在；但普通 Chat plan 没有“用户编辑任务4”的事务模型，因此也没有对应的计划编辑事务回滚。 | `src/stores/chat.ts:4568`, `src/pages/Chat/execution-projection.ts:1`, `src/pages/Chat/task-visualization.ts:413`, `src/components/agents/OrchestrationPlanView.tsx:68` |
| 38 | 执行图/Trace 是否可折叠、过滤和检索？ | 部分实现。源码层面 Chat 执行图、Observability trace graph 和 trace index/filter 均存在；E2E 中基础 team orchestration graph 与 terminal error 场景通过，但 internal yield/subagent branch 和长历史折叠两个场景失败，均找不到 `chat-execution-graph`。因此只能确认部分场景产品化，不能确认所有历史/折叠执行图稳定。 | `src/pages/Chat/ExecutionGraphCard.tsx:166`, `src/pages/Chat/ExecutionGraphCard.tsx:219`, `src/pages/Observability/AgentTraceGraph.tsx:194`, `src/pages/Observability/index.tsx:568`, `electron/services/observability-index.ts:51`; `tests/e2e/chat-task-visualizer.spec.ts:373`, `tests/e2e/chat-task-visualizer.spec.ts:501` |
| 39 | UI 是否按用户能力自动切换简化/高级视图？ | 部分实现。存在 work mode、展开详情、执行图和角色面板等不同深度入口；未见基于“非技术/高级用户”自动切换展示策略。 | `shared/types/work-mode.ts:250`, `src/pages/Chat/ExecutionGraphCard.tsx:196`, `src/components/agents/RolesOrchestrationPanel.tsx:2268`, `src/pages/Observability/index.tsx:694` |

### 18.10 模块十：敏感内容处理

| 编号 | 原问题/能力点 | 核验答案 | 出处 |
| --- | --- | --- | --- |
| 40 | Observability 和 Memory 是否有敏感内容防护？ | 已实现。observability-redaction 会在持久化前处理 input/output/attributes 中的 prompt、message、args、body、payload 等；Memory gatekeeper 会拒绝 secret-like memory，context pack 不注入 secret/secret_adjacent。 | `electron/services/observability-redaction.ts:11`, `electron/services/observability-redaction.ts:71`, `electron/services/observability-redaction.ts:90`, `electron/services/observability-index.ts:145`, `openclaw_runtime/src/memory/gatekeeper.ts:304`, `openclaw_runtime/src/memory/context-pack.ts:54` |
| 41 | 是否能保证 chat transcript、文件、模型回显全链路无明文？ | 部分实现，不能保证。Observability 持久化会脱敏 span；但若用户批准写入 `.env`，文件本身会包含明文；chat transcript、模型回显、patch/diff 是否全链路脱敏未由这些代码完全证明。 | `electron/services/files-api.ts:356`, `electron/services/files-api.ts:421`, `openclaw_runtime/src/gateway/server-methods/chat.ts:1584`, `openclaw_runtime/src/gateway/server-methods/chat.ts:1600`, `openclaw_runtime/src/gateway/server-methods/chat.ts:1721`, `electron/services/observability-redaction.ts:93` |

### 18.11 模块十一：决策质量与自我修复

| 编号 | 原问题/能力点 | 核验答案 | 出处 |
| --- | --- | --- | --- |
| 42 | 低置信度是否自动暂停并请求确认？ | 部分实现。orchestration route diagnostics 有 confidence，Memory low confidence 会 needs_review；但普通 Chat/Plan 未见统一阈值状态机来决定“低于阈值自动暂停，高于阈值自动执行”。 | `openclaw_runtime/src/agents/orchestration-protocol.ts:454`, `openclaw_runtime/src/agents/orchestration-protocol.ts:565`, `openclaw_runtime/src/agents/orchestrator.ts:343`, `openclaw_runtime/src/memory/gatekeeper.ts:317`, `electron/services/workspace-permissions.ts:253` |
| 43 | 是否有统一的计划自审/反方角色？ | 部分实现。内置 reviewer、security-reviewer、skeptic，Task Loop 有 self-check 和 evidence gate；但普通 Chat 计划生成前未见统一强制自审角色。 | `openclaw_runtime/src/agents/role-contract.ts:325`, `openclaw_runtime/src/agents/role-contract.ts:341`, `openclaw_runtime/src/agents/role-contract.ts:373`, `openclaw_runtime/src/agents/task-loop-self-check.ts:24`, `openclaw_runtime/src/agents/task-loop-controller.ts:3087` |
| 44 | 失败后是否自动 repair / blocked？ | 部分实现偏强。Task Loop 有 subagent evidence、quality score、evidence gate、selfCheck、repair iteration 和 blocked 分支；默认 maxIterations 3、maxRepairIterations 2。普通 orchestrator/team path 的质量闭环明显弱。 | `openclaw_runtime/src/agents/task-loop-controller.ts:2797`, `openclaw_runtime/src/agents/task-loop-controller.ts:2798`, `openclaw_runtime/src/agents/task-loop-controller.ts:3046`, `openclaw_runtime/src/agents/task-loop-controller.ts:3111`, `openclaw_runtime/src/agents/task-loop-controller.ts:3121`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:272` |

### 18.12 本节补充结论

这 44 项里，最稳的结论是：Chat/Gateway 主链路、Workspace permission、角色定义、Trace/Observability 数据模型、Task Loop checkpoint、Memory gatekeeper/context pack、compaction safeguard、Gateway 生命周期等都是真实存在的工程能力。

需要收窄的结论是：可编辑 Chat DAG、动态角色淘汰、普通 `team_orchestrate` 质量评分、自动全量回滚、低置信度统一暂停确认、敏感内容全链路治理，都不能写成“已完整产品化”。本轮 E2E 还显示 Chat execution graph 的 internal yield/长历史折叠场景未通过，因此执行图也应写成“部分场景产品化”，而不是全场景稳定。

## 最终总结

本轮完整问答支持一个更精确的总判断：

Verse Claw / OpenClaw Runtime 的很多能力是真实存在的，尤其是 Workspace permission、Role permission、Task Loop checkpoint/evidence、Memory gatekeeper/context pack、Observability redaction、Compaction artifact、Task Ledger、role orchestration 等。它们不是凭空编造；其中一批结论已经通过 212 个定向单元测试、一次 Vite/Electron 构建和 5 个通过的 E2E 用例增强可信度。

但“代码存在”不能自动等于“用户可稳定触达”。最重要的灰色地带是：Chat Plan 未接 Task Ledger DAG 编辑；Routing Memo 默认关闭且质量信号未贯通；普通 `team_orchestrate` 没有完整质量评分；checkpoint 不是完整 agent/文件系统快照；Observability redaction 不等于 transcript/file/diff/compaction 全链路敏感内容治理；普通 Chat 和 Task Loop 仍是两套执行模型。并且，`chat-task-visualizer` 的 2 个 E2E 失败说明执行图历史/内部 yield 场景当前不能按“稳定产品化”归类。

因此，后续工程化应聚焦把这些灰色地带接成明确、可控、可审计的产品路径，而不是继续堆更多默认关闭的 pilot。
