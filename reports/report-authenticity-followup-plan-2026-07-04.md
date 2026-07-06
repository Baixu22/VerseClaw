# 源码真实性审计第二阶段总结报告

日期：2026-07-04  
仓库：`C:\Users\27933\Desktop\clawx\ClawX`  
当前分支：`knowledge-ux-polish`  
当前 HEAD：`5d9a3f3`  
关联报告：`reports/report-authenticity-audit-2026-07-04.md`  
机器可读准入矩阵：`shared/capability-claims.ts`  
目标：基于第一阶段“外部报告数据真实性审计”和后续 17 组深度问题，补齐源码级调用链、产品化差距、安全边界、运行时可验证性和工程化路线图。

## 0. 执行摘要

第一阶段审计给出的“80%-85% 可信度”总体成立。第二阶段进一步复核后，核心判断需要精化为：

> Verse Claw / OpenClaw Runtime 的底层能力确实很丰富，但成熟度不均衡。Chat、Gateway、Workspace permission、角色编排、Task Loop、Memory、Compaction、Observability 等基础设施真实存在；其中一部分已经产品化，一部分仍停留在默认关闭、shadow/pilot、只读展示、质量信号未贯通或缺 UI 闭环的状态。

本轮新增结论：

- 普通 Chat 与 Task Loop 仍是两套执行模型。普通 `chat.send` 不会自动获得 Task Loop 的 checkpoint、evidence gate、repair iteration。
- `Task Ledger / Workboard / Chat orchestration plan` 是三块相邻但未完全统一的数据与 UI 表面。Chat plan 当前仍是只读计划展示。
- `routingMemoPilot` 已有 off/shadow/active 三态，但默认 off，active 的启用条件在类型注释中写为“至少 20 次 shadow run + 至少 70% divergence improvement”，且 `qualityOverall` 尚未完整接入。
- 普通 `team_orchestrate` 已有 worker failure、partial、repairNodes、rerouteRecommendations，但质量评分在工具返回中仍是空数组摘要；Task Loop 的质量闭环更完整。
- Workspace permission 是主进程边界的硬拒绝/审批机制；Role permission 是 runtime/subagent 工具面的 allow/deny 机制。二者不是同一张权限表，但在实际效果上应按“最严格边界生效”理解。
- Memory 比第一阶段报告显示得更产品化：有 host API、Gateway RPC、proposal/review/store、context pack、Roles 面板 UI。但自动提取的 memory 仍是 proposal-first，不会静默写入。
- Compaction 已有手动入口、状态、质量提示、checkpoint/restore/list/get/branch 等路径；但压缩摘要仍不能声称全链路敏感信息安全或零损失。
- “任务失败自动回滚”严格意义上仍未产品化。当前有 rollback plan UI、compaction/session restore、replay rollback authority pilot 代码，但不是任意任务失败后的自动文件级回滚。

综合可信度更新：**88%-92%**。  
提升原因是本轮补充了源码调用链、目录扫描和 11 个单元测试文件的通过证据。未提升到 95% 的主要原因是：未启动真实 Electron/Gateway 做端到端运行验证，CodeGraph CLI 当前不可用，且工作区非常脏。

## 1. 本轮证据与限制

### 1.1 CodeGraph 状态

用户要求优先使用 CodeGraph 定位；本轮尝试运行：

```powershell
node openclaw_runtime/extensions/codegraph/dist/bin/codegraph.js --help
```

结果失败：

```text
Error: Cannot find module 'picomatch'
Require stack:
... openclaw_runtime/extensions/codegraph/dist/bin/codegraph.js
```

因此本轮按用户授权跳过 CodeGraph，改用 `rg`、直接源码读取和单元测试结果。CodeGraph 未参与最终事实判断。

### 1.2 已执行测试

通过的定向单元测试：

```powershell
pnpm exec vitest run tests/unit/routing-memo.test.ts tests/unit/rollback-plan.test.ts tests/unit/replay-rollback-authority.test.ts --reporter=dot
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts --reporter=dot
pnpm exec vitest run tests/unit/workspace-permissions.test.ts tests/unit/memory-api.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/role-memory-context-provider.test.ts tests/unit/observability-index.test.ts tests/unit/compression-artifact.test.ts --reporter=dot
pnpm exec vitest run tests/unit/task-loop-controller.test.ts --reporter=dot
```

结果：**11 个测试文件、212 个用例全部通过**。

覆盖范围：Routing Memo、rollback plan、replay rollback authority、orchestrator.plan/run、team_orchestrate partial failure、角色工具 allow/deny、Workspace permission、Memory API/store/context provider、Observability index、Compression artifact、Task Loop checkpoint/evidence gate/repair/blocked。

未执行：Electron E2E、真实 Gateway RPC 手工场景、真实模型调用、真实 UI 截图验证。

### 1.3 版本边界

当前 `git status --short` 约有 **922 条变更/未跟踪项**。因此本报告只能证明“当前工作区状态”下的真实性，不能证明这些能力已经合入 `main/master` 或远端主分支。

## 2. 17 组问题逐项结论

### 2.1 Task Ledger / Workboard 与 Chat Plan 的断层

结论：**底层存在但未贯通**。

证据：

- `src/components/agents/OrchestrationPlanView.tsx` 只渲染 Lead、Workers、Verifier 的计划视图，未见拖拽、加边、依赖编辑、节点状态写回。
- `shared/types/task-ledger.ts` 定义 `TaskLedgerNode`、`TaskLedgerEdge`、`edge_added`、`dependency_added` 等事件模型。
- `electron/services/task-ledger-api.ts` 与 `electron/services/task-ledger-service.ts` 提供 node/edge/event log/snapshot 的主进程服务。
- `openclaw_runtime/ui/src/ui/views/workboard.ts` 有 Workboard card、拖拽、依赖状态、详情、运行/打开/归档等交互。

回答：

- (a) Chat orchestration plan 没接 Task Ledger DAG 编辑，更像产品/架构表面未统一，而不是底层完全没有 DAG 能力。
- (b) 最近可行路径是：给 Chat plan 增加 plan-to-ledger adapter，将 `OrchestrationTaskGraph`/workers/verifier 映射到 Task Ledger node/edge；先做只读同步，再做轻量编辑依赖；最后把编辑结果回写 orchestrator plan 或 Task Loop root。
- (c) Task Ledger 与 Workboard 不是同一套数据源的简单两种视图。Task Ledger 是 workspace-scoped event log/snapshot；Workboard 是 runtime UI card/board 状态和执行控制表面。两者概念接近，但模型、存储和入口不同。

工程化建议：优先做“Chat Plan -> Task Ledger 只读投影”，再做 `addEdge/removeEdge/updateNodeStatus` 的受控编辑。

### 2.2 Routing Memo 的未启用状态

结论：**底层存在但默认关闭，尚未形成在线学习闭环**。

证据：

- `openclaw_runtime/src/agents/routing-memo.ts` 定义 JSONL memo store，默认 `DEFAULT_ROUTING_MEMO_PILOT_MODE = "off"`。
- `openclaw_runtime/src/config/types.openclaw.ts` 注释说明 `routingMemoPilot` 支持 `off | shadow | active`，active gate 为“>=20 shadow runs + >=70% divergence improvement”。
- `openclaw_runtime/src/agents/routing-memo.ts` 中 good/completed 返回 `+2`，`poor_attempt` 返回 `-1`。
- `openclaw_runtime/src/agents/orchestrator-run-observed.ts` 注释说明 `qualityOverall` 还没有真正 plumb through。

回答：

- (a) pilot 默认 off，原因是它被设计成受控 pilot，不是主路径能力；active 需要先收 shadow evidence。
- (b) `qualityOverall` 最合理来源是普通 orchestration 的 worker/verifier scorecard 或 Task Loop evidence/self-check 的归一化结果。目前普通路径没有完整接入。
- (c) 手动打开 `active` 会让类似任务 memo 对 matching lead role 做有限加减分。副作用是：在 `qualityOverall` 缺失时，completed graph 可能被过度当作成功；memo 只 nudges，不应主导路由。
- (d) `+2/-1` 是工程启发式。源码注释强调与 keyword evidence 同量级、bounded，成功权重大于失败，目的是轻推而非替代关键词/role contract。

工程化建议：先开启 shadow 并收集 dashboard，再把 `summarizeQuality` 或 Task Loop evidence gate 的 outcome 接到 `qualityOverall`。

### 2.3 team_orchestrate 的质量评分空洞

结论：**普通 team_orchestrate 有失败/partial 处理，但质量评分仍弱于 Task Loop**。

证据：

- `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts` 返回 `qualitySummary: summarizeQuality([])`。
- `openclaw_runtime/src/agents/orchestrator-run-observed.ts` 会收集 failures，返回 `partial`、`repairNodes`、`rerouteRecommendations`。
- `openclaw_runtime/src/agents/task-loop-controller.ts` 有 evidence gate、worker_failed/worker_timeout、self_check、repair/blocked 决策。

回答：

- (a) Task Loop 的 evidence gate/self check 可以部分复用，但需要把普通 orchestrator 的 worker outcome、evidenceRefs、verifier verdict 统一成同一份 `WorkerQualityScore` 或 scorecard 输入。
- (b) 源码里已有质量结构和 repair/reroute 节点，但 `team_orchestrate` 的正式质量输出尚未接入。
- (c) 当前普通编排下，worker 差会表现为 partial/failure、repairNodes/rerouteRecommendations；但不会像 Task Loop 一样强制进入 repair iteration 或 blocked gate。

工程化建议：先把 `orchestration-protocol.ts` 的 `scoreWorkerOutcome` 接入 `team-orchestrate-tool.ts`，再让 routing memo 消费 worst/overall score。

### 2.4 脱敏的全链路缺口

结论：**Observability 持久化脱敏真实存在，但不能声称全链路绝不落明文**。

证据：

- `electron/services/observability-redaction.ts` 会对 span input/output 做 redacted preview/hash，并过滤敏感 attributes。
- `electron/services/observability-index.ts` 在写 index 前调用 `sanitizeTraceForPersistence`。
- `openclaw_runtime/src/memory/gatekeeper.ts` 拒绝 secret-like memory。
- `openclaw_runtime/src/agents/sessions/tools/write.ts`、`edit.ts`、`apply-patch.ts` 会真实写文件/生成 diff/patch；文件内容本身不是脱敏存储。

回答：

- (a) 用户要求写 `.env` 时，密钥会经过 renderer message、Electron chat API、Gateway `chat.send`、runtime tool call、文件写入工具、可能的 transcript/tool result/trace/event。Observability 持久化点会脱敏；聊天 transcript、目标文件内容和模型上下文不是同一套脱敏保证。
- (b) Assistant message 如果进入 Observability persistence，会被 redacted preview 化；但 transcript 中的 assistant content 不应默认视为已脱敏。
- (c) Compaction summary 有 identifier 保护和结构质量检查，但未见专门 secret scrubber。若历史轮次包含假/真密钥，摘要有保留风险。
- (d) patch/diff 如果作为 trace span input/output/attribute 持久化，会经过 Observability redaction；但 raw patch、工具输出、文件内容、session transcript 不应声称全量脱敏。

工程化建议：增加 transcript/compaction/file-diff 的 secret scanner，至少对常见 key/token 形态做 warning 或 redacted projection。

### 2.5 Workspace Permission 的边界验证

结论：**Plan/readOnly 是主进程边界的硬拒绝；acceptEdits 是审批路径；fullAccess 仍记录高风险审批/审计**。

证据：

- `electron/services/workspace-permissions.ts`：
  - `decideWorkspaceCommand`：plan 下返回不允许执行命令。
  - `decideWorkspaceFileWrite`：plan/readOnly 下拒绝文件写入。
  - `decideGatewayRpc`：plan/readOnly 下拒绝 mutating Gateway RPC。
- `electron/services/terminal-api.ts`、`files-api.ts`、`gateway-api.ts` 调用这些 decision 并返回 blocked/permissionDenied/approval。
- `electron/services/permissions-api.ts` 使用 `electron-store` 的 `workspace-permissions` 存储审批记录。

回答：

- (a) 对终端、文件写入、mutating Gateway RPC 是硬拒绝或审批 gate，不是仅提示。
- (b) 潜在绕过主要来自未纳入该边界的 runtime 内部工具或新 host API；Renderer 侧应继续禁止直接 IPC/direct Gateway fetch。
- (c) 有审批记录和部分审计信息，但它不是完整 SIEM 级别审计日志。
- (d) 执行点主要在 Electron Main service 边界；runtime 工具还有自己的 sandbox/tool policy 层。

工程化建议：统一输出 permission decision audit event，并在 UI 显示“被谁、在哪个边界、因为什么拒绝”。

### 2.6 Checkpoint 的真实恢复能力

结论：**checkpoint 真实持久化，但不是完整 agent VM 快照**。

证据：

- `shared/types/long-task-control.ts` 定义 `ResumeCheckpoint` 字段：objective、activeTask、decisions、deviations、openBlockers、filesTouched、testsRun、evidenceRefs、reviewNeededItems、nextAction、controlSignals 等。
- `openclaw_runtime/src/agents/long-task-control/store.ts` 写入 `long_task_checkpoints`，并把 checkpoint JSON 存起来。
- `buildRuntimeCoreCheckpointFromResumeCheckpoint` 中 `toolResults: []`，`fileHashes` 默认 `{}`，说明不保存完整工具调用历史或文件快照。
- JSON 解析失败时会退回空/default 结构，没有强 checksum。
- `task-loop-controller.test.ts` 通过，覆盖 Task Ledger root、checkpoint、worker failure、repair/blocked 等。

回答：

- (a) 保存的是恢复摘要、任务状态、证据引用和少量运行元数据，不是完整 agent 上下文、完整工具历史或文件快照。
- (b) 恢复后不应认为上下文窗口完全一致；更准确是从 checkpoint summary/evidence refs 继续。
- (c) 工具调用中间态没有事务级恢复；若文件写了一半，依赖文件系统实际状态和后续 repair/review。
- (d) 存储介质是本地 SQLite/Kysely 状态表，不是纯内存；但 active run map 仍有内存态部分。
- (e) 损坏时多为 default/fallback 或 no_checkpoint/checkpoint_corrupted 类失败，不是强一致恢复。

工程化建议：补 file fingerprint、tool result digest、checksum，并把 checkpoint restore 的 UI 文案改成“handoff/resume”而非“完整回滚”。

### 2.7 Context Compaction 的实际行为

结论：**Compaction 已部分产品化，但不是无损压缩，也不是 secret-safe 保证**。

证据：

- `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts` 默认 `reserveTokens: 16384`、`keepRecentTokens: 20000`，`shouldCompact` 为 `contextTokens > contextWindow - reserveTokens`。
- `openclaw_runtime/src/agents/agent-hooks/context-pruning/settings.ts` 默认 cache-ttl：TTL 5 分钟、keepLastAssistants 3、softTrimRatio 0.3、hardClearRatio 0.5、minPrunableToolChars 50000。
- `compaction-safeguard-quality.ts` 要求结构化章节：Goal/Progress、Current state、Key decisions、Open TODOs、Constraints/Preferences、Pending asks、Exact identifiers 等。
- `ChatInput.tsx` 有 `/compact`、token usage、hidden messages、last compaction、quality badge、manual compaction dialog。
- `sessions.ts` 有 `sessions.compactionStatus/history/list/get/branch/restore/compact`。

回答：

- (a) 主 compaction 由 token 阈值触发；context pruning 是工具结果 cache TTL/大小修剪；还有 overflow recovery 和手动 compact。
- (b) 用户有感知：Chat composer 显示 compact 状态与手动入口；自动 compaction 也会发 session events。但是否“阻止/延迟”取决于当前 UI/设置，不是全局确认。
- (c) 摘要是结构化 Markdown；预算由 reserveTokens/model context 参与计算。
- (d) identifier 保护覆盖路径、URL、端口、hash、长数字、hex、日期时间等“连续性必需的精确值”。
- (e) 多次压缩会 re-distill prior summaries，可减少重复；但摘要的摘要仍有累积信息损失风险，没有无损上限保证。

工程化建议：增加 compaction artifact viewer 和 secret-safe audit，显示“哪些信息被保留/丢弃/不确定”。

### 2.8 Memory Gatekeeper 的决策过程

结论：**Memory 生命周期较完整，且已有用户管理 UI 的一部分**。

证据：

- `openclaw_runtime/src/memory/gatekeeper.ts`：
  - 默认 confidence 0.7。
  - `<0.45` reject。
  - `<0.7` needs_review。
  - secret-like content reject。
  - duplicate/contradiction/scope/role/sensitive/high-importance-without-evidence 会 needs_review。
- `openclaw_runtime/src/memory/memory-store.ts`：
  - automatic proposals (`trace/session_summary/role/system`) 即使 gatekeeper accept，也会转为 needs_review proposal-only。
  - proposal/card/conflict/audit/injection 都有 SQLite 表。
- `openclaw_runtime/src/memory/context-pack.ts`：
  - 默认 total budget 3000 tokens。
  - secret 不注入；secret_adjacent 会 redacted。
  - 按 injection class、score、bucket budget、total budget 截断。
- `RolesOrchestrationPanel.tsx`：
  - memory list、proposal review、preview、detail、injection explain、retention/health 等 UI 状态。

回答：

- (a) proposal 可以来自 UI、role/system/trace/session summary 等；自动来源不会静默落 active card。
- (b) confidence 由 proposal 提供并 normalize，不是从重复次数自动计算；默认 0.7。
- (c) 冲突不是自动覆盖，而是 needs_review/proposal/conflict，后续通过 review action 处理。
- (d) retention 是按 API/界面/任务调用评估，不是已证明有后台定时清理。
- (e) context pack 总预算 3000；先按分类/score 选择，再按 bucket 和 total budget 截断，超额会在 explanations 中标记 truncated reason。

工程化建议：补“自动 proposal 来源/证据/风险”的 UI 筛选，并把 retention run 做成可审计操作。

### 2.9 普通 Chat 与 Task Loop 的架构鸿沟

结论：**分裂真实存在，且当前是显式入口优先，不是自动升级**。

证据：

- `src/pages/Chat/index.tsx` 调用 store 的 `sendMessage`。
- `src/stores/chat.ts` `sendMessage` 走 `hostApi.chat.sendWithMedia`。
- `electron/services/chat-api.ts` 将消息转为 Gateway `chat.send`。
- `openclaw_runtime/src/gateway/server-methods/chat.ts` 的 `inputMode` 分支要求 active `/loop` Task Ledger root；否则返回 “ordinary Chat cannot enter long-task checkpoint/intervention state”。
- `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts` 暴露 `task_loop.run/status`。
- `openclaw_runtime/src/agents/task-loop-controller.ts` 启动时必须创建 Task Ledger root，失败则不能 start `/loop`。

回答：

- (a) 源码显示这是明确分层：ordinary chat、role orchestration、task_loop.run 各自入口不同。
- (b) 进入 Task Loop 需要显式 task_loop/run 或 `/loop` 类路径；普通复杂消息不会自动创建 Task Ledger root。
- (c) 普通 Chat 收到复杂任务会按普通 runtime 工具执行，可能调用 team_orchestrate，但不自动拥有 checkpoint/evidence gate。
- (d) 长远统一方向可从 runtime event log、Task Ledger、Mission/Task Loop shadow pilots 看出，但未见“所有 Chat 都走 Task Loop”的默认切换。

工程化建议：在 Chat 输入复杂任务时提供“升级为 Task Loop”的明确 affordance，而不是静默升级。

### 2.10 Workspace Permission 与 Role Permission 的关系

结论：**两套权限在不同边界执行，实际按最严格约束生效**。

证据：

- Workspace permission：`electron/services/workspace-permissions.ts` 控制终端、文件写入、Gateway mutating RPC。
- Role permission：`openclaw_runtime/src/agents/role-spawn.ts` 将 `role.tools` 转为 hard allowlist；`role-permissions-policy.ts` 将 filesystem/network/commands 转为 additive denylist。
- `role-permissions-policy.ts` 注释明确：deny lists do not grant tools; only remove what tools allowlist already permits。
- `tests/unit/role-orchestration-methods.test.ts` 覆盖 role.tools=[read] 不能使用 write/edit/exec/bash。

回答：

- (a) workspace 允许但 role 禁止：role 工具面禁止。workspace 禁止但 role 允许：主进程/Gateway 边界仍禁止。
- (b) 当前没有一个统一三维权限矩阵，但可以抽象为 `[workspace mode] x [role tool policy] x [runtime sandbox/tool policy]`。
- (c) Workspace 在 Electron Main service 边界评估；Role 在 runtime/subagent spawn 和 tool materialization/policy gate 评估。
- (d) 有 role-audit/gateway log/permission approval 等碎片记录，但不是统一角色级审计视图。

工程化建议：建立统一 `PermissionDecisionEvent`，字段包含 workspaceMode、roleName、toolName、boundary、decision、reason、requestId。

### 2.11 Runtime 行为验证场景

本轮完成的是源码+单元级验证，不是完整真实 UI/Gateway 场景。

已验证：

- Routing Memo、rollback plan、replay rollback authority：60 tests passed。
- Role orchestration/team_orchestrate/role permissions：39 tests passed。
- Workspace permission、Memory、Observability index、Compression artifact：48 tests passed。
- Task Loop controller：65 tests passed。

仍需补充的真实运行场景：

1. Electron Plan 模式下实际点击/调用文件写入，记录 UI toast 和返回错误。
2. 通过 Gateway `memory.propose` 创建 secret-like proposal，记录真实返回体。
3. 构造长上下文触发 compaction，对比摘要中的 identifiers 与敏感文本。
4. 启动 Task Loop 并制造 worker timeout/error，记录 checkpoint、repair iteration、event log。
5. 使用假密钥进入 chat message/tool diff/trace，检查 transcript、trace index、UI trace detail。

### 2.12 完整调用链追踪

#### Chat 输入到模型处理

```text
ChatInput / Chat page
-> src/stores/chat.ts sendMessage
-> hostApi.chat.sendWithMedia
-> electron/services/chat-api.ts
-> gatewayManager.rpc('chat.send')
-> openclaw_runtime/src/gateway/server-methods/chat.ts
-> embedded agent/runtime execution
-> transcript append + runtime events
-> src/stores/chat runtime handlers
-> ChatMessage / ExecutionGraphCard render
```

关键边界：Renderer -> Electron Main -> Gateway -> Runtime -> transcript/event UI。

#### 多角色编排

```text
Gateway role-orchestration methods or team_orchestrate tool
-> createOrchestratorPlan
-> role-router scoreRole / select roles
-> runOrchestrationObserved
-> build role spawn context
-> sessions_spawn / subagent execution
-> collect worker/verifier outcomes
-> failures/partial/repairNodes/rerouteRecommendations
-> trace/runtime graph/UI
```

关键断点：普通 `team_orchestrate` 不强制 Task Loop evidence gate；质量摘要仍空。

#### Memory 生命周期

```text
Roles panel / automatic runtime source
-> electron/services/memory-api.ts
-> Gateway memory.propose / memory.update / memory.list
-> memory-store proposeMemoryCard / reviewMemoryProposal
-> gatekeeper accept / needs_review / reject
-> SQLite cards/proposals/conflicts/audit
-> role-memory-context-provider / buildContextPack
-> role-spawn context injection
-> Roles panel detail / injection explain
```

关键边界：自动来源 proposal-first；secret-like reject；context pack budget 截断。

#### Trace span 持久化到 UI

```text
ObservabilityTraceRecorder
-> spans/events in runtime or service layer
-> electron/services/observability-index.ts
-> sanitizeTraceForPersistence
-> trace-index.jsonl
-> observability graph/API/UI render
```

关键边界：持久化前 redaction，不等于 transcript/file/tool raw content 全链路 redaction。

### 2.13 挑战 80%-85% 可信度

剩余不确定性集中在：

- 真实 Electron/Gateway runtime 行为，尤其是 permission UI、compaction UI、Task Loop live run。
- 默认配置在用户安装环境中的实际值。
- dirty worktree 中大量未合并代码是否代表目标版本。
- shadow/pilot 代码是否在真实产品路径中开启。
- transcript/file/diff 的敏感信息治理。

提升到 95% 需要：

- Playwright/Electron E2E：Plan mode refusal、manual compaction、memory review、Task Loop failure repair。
- Gateway RPC replay：`chat.send`、`task_loop.run`、`memory.propose`、`sessions.compact`。
- 主分支对比：确认当前关键文件是否存在于 `origin/main` 或目标发布分支。
- 真实 trace/transcript 文件检查：假密钥脱敏矩阵。

死代码风险最高区域：

- `routingMemoPilot: active`。
- `replay-rollback-authority`。
- Task Loop intervention 的部分 inputMode 分支。
- Compaction checkpoint branch/restore 的 UI 到 Gateway 端到端路径。

### 2.14 原报告遗漏能力扫描

扫描目录：

- `openclaw_runtime/src/agents/`
- `openclaw_runtime/src/gateway/server-methods/`
- `electron/services/`
- `shared/types/`
- `src/stores/`

重要遗漏能力：

- Agent Browser：`agent-browser-*`、browser service/API。
- Mission Control：`mission-control/*`、mission-control server methods。
- Local control plane / ACP：`local-control-plane`、`acp/control-plane`。
- Capability system：`capabilities-api.ts`、capability registry/publication。
- Orchestration presets：`orchestration-presets-api.ts`。
- Resource tracking / leases：`resource-tracker*`、`resource-leases`。
- Remote tasks / cron / channels：remote-tasks、cron、channels。
- Voice/TTS/Talk/Voicewake：server methods 下有 talk/tts/voicewake。
- Model auth/catalog/fallback：大量 provider/model policy 文件。
- Tool policy / sandbox / effective tools inventory：runtime 工具治理远比第一报告覆盖更广。

影响：这些能力不推翻第一报告，但说明系统成熟度矩阵应扩大，不应只围绕 Chat/Task Loop/Memory。

### 2.15 产品化三分类

| 能力 | 分类 | 依据 |
| --- | --- | --- |
| 可编辑任务 DAG | 底层存在但未贯通 | Task Ledger/Workboard 有 node/edge/drag/dependency；Chat plan 只读。 |
| 角色动态淘汰/学习 | 底层存在但未贯通 | Routing Memo off/shadow/active 存在；默认 off，qualityOverall 未接入。 |
| 任务失败自动回滚 | 底层存在但未贯通；严格“自动全量回滚”未实现 | rollback plan、checkpoint restore、replay rollback authority 存在；不是任意失败自动文件级回滚。 |
| 低置信度自动暂停请求确认 | 底层存在但未贯通 | Task Loop 有 confidence/controlSignals/ask_user；普通 route confidence 未接自动暂停确认。 |
| 跨会话经验迁移 | 部分产品化 | Role Memory 管理/注入已可达；Routing Memo 仍默认 off。 |
| 并发子任务执行 | 部分产品化 | orchestrator/team_orchestrate/subagent/wave 执行存在并有测试；普通 Chat 不强制启用。 |
| 用户自定义角色 | 底层存在但未贯通 | `cfg.agents.roles[]`、role registry、custom origin 显示存在；未见完整用户友好的角色创建 UI。 |
| 任务执行实时进度推送 | 部分产品化 | runtime events、ExecutionGraphCard、long-task UI 存在。 |
| 上下文压缩用户可感知通知 | 部分产品化 | Chat composer 显示 compaction status/quality/manual compact；自动压缩仍需更明确通知。 |
| Memory 用户管理界面 | 部分产品化 | Roles panel 有 list/proposal/review/detail/injection explain/retention 等路径。 |

### 2.16 产品化优先级建议

| 优先级 | 能力 | 用户价值 | 工程成本 | 风险 | 建议 |
| --- | --- | --- | --- | --- | --- |
| 1 | Chat Plan -> Task Ledger 只读/轻编辑 | 高 | 中 | 中 | 先做 plan projection，再开放 add/remove dependency。 |
| 2 | team_orchestrate quality summary | 高 | 中 | 中 | 复用 worker outcome score，输出 quality/reason。 |
| 3 | Workspace/Role permission 统一审计视图 | 高 | 低-中 | 低-中 | 打通 permission decision event 和 UI。 |
| 4 | Routing Memo shadow 到 active 的证据面板 | 中高 | 中 | 中高 | 先 shadow dashboard，达标后允许 active。 |
| 5 | Low-confidence ask-user bridge | 中高 | 中 | 高 | 把 route confidence/evidence gaps 映射成用户确认，不要静默阻断。 |

暂不建议优先做“全自动回滚”。当前 checkpoint 并非完整文件系统快照，直接产品化自动回滚风险高。

### 2.17 审计能力自评

本轮方法：

- 直接读取/片段读取了报告、CodeGraph README/CLI 类型、权限、Memory、Compaction、Task Loop、Rollback、Role registry 等关键文件。
- 使用 `rg` 对 70+ 个源码/测试文件做符号定位和调用链核对。
- 跑了 11 个定向单元测试文件，212 个用例通过。

读取/工具异常：

- CodeGraph CLI 启动失败，缺 `picomatch`。
- `src/lib/api-client.ts` 在一次搜索中不存在，但该文件不是本轮关键证据路径。

行号验证方法：

- 不是只验证文件范围；本轮对关键符号用 `rg -n` 精确定位，并读取上下文做语义判断。
- 报告中未大量引用行号，是因为当前工作区 922 条变更，行号漂移风险很高；保留文件级/符号级证据更稳定。

发现的第一阶段需要修正点：

- 用 deprecated `work-mode.ts` 证明当前 Plan 权限不够强，应以 `workspace-permissions.ts` 为准。
- “未见可编辑 DAG”应收窄为“Chat orchestration plan 未接 DAG 编辑”，而不是底层完全没有 DAG/Workboard。
- “动态角色淘汰未实现”应修正为“Routing Memo 底层存在但默认关闭且质量信号未贯通”。
- “Memory 未产品化”要降权，当前 Roles 面板已有较多管理路径。
- Task Loop 与普通 team_orchestrate 的质量闭环不能混写。

如果重做：

1. 先修 CodeGraph 依赖，输出原始 CodeGraph 定位记录。
2. 固定一个干净分支或 commit，再做行号报告。
3. 用 Playwright 跑 Plan/memory/compaction/Task Loop 四个 E2E。
4. 用假密钥做 trace/transcript/diff/compaction 脱敏矩阵。

## 3. 最终审计结论

原外部报告不是伪造，第一阶段判断“整体可信”成立；第二阶段进一步证明，这个仓库确实有大量底层能力和部分产品化表面。

但最终表述必须避免三类过度结论：

1. **代码存在不等于产品化可用**：Routing Memo、replay rollback、Chat Plan DAG 编辑仍属于灰色地带。
2. **Task Loop 能力不等于普通 Chat 能力**：checkpoint、evidence gate、repair iteration 主要属于 Task Loop。
3. **Observability 脱敏不等于全链路敏感信息安全**：transcript、文件内容、模型回显、compaction summary 仍需单独治理。

最准确的产品事实表述是：

> Verse Claw 已具备较完整的 Chat/Gateway/Workspace 权限、角色编排、Trace/Observability、Memory gatekeeper、Context Compaction、Task Ledger、长任务 checkpoint 与 Task Loop 验证基础。  
> 其中 Workspace permission、Memory 管理、Compaction 状态、执行图、部分角色编排已经具备用户可触达表面；Task Ledger/Workboard、Routing Memo、普通编排质量评分、自动回滚、低置信度确认仍处于“底层存在但未完全贯通”的阶段。  
> 下一阶段工程化重点应放在把这些灰色地带接成清晰、可控、可审计的用户路径，而不是继续堆新的底层 pilot。
