# 会话、运行与连续性

> 面向问题：Session、Run、Task、Workspace 分别是什么？聊天记录怎样保存和恢复？fork、handoff、archive、delete 和 checkpoint 各自改变哪些事实？

## 1. 五个对象不能混写

| 对象 | 作用 | 当前权威 |
|---|---|---|
| Workspace | 本地执行根、权限上下文、文件面板与 session 的组织容器 | `electron/services/workspaces-api.ts` + Workspace store |
| Session | 一个稳定逻辑对话 key 及其 transcript 树 | Runtime session authority |
| Physical generation | 某次物理会话实例的 `sessionId`；reset/restore 可产生新 generation | Runtime session owner |
| Run | 一次模型/工具执行尝试，有 runId 与终态 | Agent runner / Gateway events |
| Task | 用户可见目标、依赖、状态和 evidence | Task Ledger |

稳定 session key 通常形如：

```text
agent:<agentId>:<suffix>
```

默认主会话是 `agent:main:main`。session key 不是 runId，也不是 Task Ledger node id。session stop 不完成任务；archive 不删除任务；run abort 不替代 session stop。

### 跨会话身份读取

`hostApi.sessionActivity.read({ scope, expectedBindingRevision?, expectedExecution? })` 读取显式的 workspace/project、sessionKey 和 sessionGeneration。Main 使用 typed `host:invoke`，经自己的 Gateway WebSocket 调用已有 `session.activitySnapshot`；Runtime 从原 SessionStore 和运行 registry 取得当前身份，并从执行域与 TaskSystem 读取原任务引用。

`snapshot.readModel.sources` 分别标明会话、ScopedRun、任务、执行域、Workspace binding 和后台来源。`ready` 是已读事实，`empty` 是 owner 确认的空任务或无当前运行；`not_read` 表示尚未查询，`unavailable` 表示 owner 缺失或不可读，`stale` 表示代次或绑定已改变，`unknown` 表示缺少身份核验依据。消费者按来源状态读取值与 `readAt`。

同 key 跨工作区、旧 generation、旧执行域或绑定 revision 会被拒绝。Runtime 读取后复核 session 与执行域，Main 在异步返回边界再次核对，reset 会丢弃整份旧关联。查询使用现有 SQLite 的只读连接；Workspace 选择、会话、任务、模型配置与资源准入保持原 owner 状态。

## 2. 持久化模型

### 会话发现与轻量详情

`hostApi.sessionActivity.query({ requester, workspace?, target?, search?, fields?, limit?, cursor? })` 与 agent 的 `sessions_list({ collaboration: true })` 消费同一读取合同。`requester` 绑定原 workspace/project/sessionKey/generation，`target` 固定详情的目标范围；`workspace` 过滤项目，`search` 匹配会话 metadata 与原 TaskSystem 目标。

列表默认 20 条，最多 50 条，单次检查最多 100 个可见候选。游标绑定读取者、过滤条件、可见候选和原 metadata 身份，metadata 或读取策略变化、reset 均返回 stale。字段可选择 goal、tasks、run、actions、origin、execution；未选择的字段为 not_read。目标摘要最多 512 个 Unicode 字符，原任务 digest/revision 与详情引用保留，完整任务目标可通过 A1 `read` 接口按需取得。

agent 使用 `session_status({ readOnly: true, scope: row.detail.scope })` 读取目标详情；不指定 scope 时读取当前运行的会话。只读模式拒绝模型更改，跳过转录用量与状态卡的配置写入。读取结果包含原任务目标、writer/observer 引用、ScopedRun、实际工具/进程动作和逐来源状态。

查询先应用既有 visibility、A2A allow 与 sandbox 读取策略，再读取任务和动作；它不读取完整 transcript，不调用摘要模型，也不切换活动工作区。实际动作从原 session-task effect request 和 bash process owner 投影，工具的 ScopedRun 使用 Main 原准入结果；待准入、缺少归属或运行中尚未观测到动作时保留 unknown。同 key/generation 的准入工作区或项目不符返回 unavailable/scope-mismatch。搜索无法核验的目标计入 unknownMatches；每个执行根在一次查询中只尝试一个任务连接，旧 schema 保持原数据并返回 unavailable。

协作模式使用上述 workspace、search、fields、limit、cursor 参数；混入旧列表模式的过滤或转录参数会被拒绝。Main、UI 和工具共同校验返回范围、字段选择与读取预算，缺少 session owner 的行不携带任务或运行事实。

回复的旧 requester、当前会话行或详情代次返回 `stale/generation-changed`，同代范围不符返回 `stale/scope-mismatch`。`not_read` 的 `readAt` 为 null，未知搜索匹配保留 unknown；重复会话行、未知原因码和失败页的分页游标被共同拒绝为 `unknown/protocol-unverified`。

Workspace、Gateway 或 Host 读取失败返回 `unavailable/owner-unavailable`；读取已返回但合法页缺失时为 `unknown/protocol-unverified`。Main、UI 与只读会话工具保留请求者身份并清除事实和分页，参数与发送者身份仍在读取前校验。

`sessions_watch({ scope, condition, run?, cursor?, timeoutMs? })` 与 typed `sessionActivity.watch` 按原 owner 条件等待。`run-terminal` 使用原 ScopedRun，`task-receipt` 等待 TaskSystem 回执，`idle` 仅表示会话空闲；`changed` 和 `blocking-changed` 补读已变化的原来源。单次最长 25 秒，返回游标可供重连与去重；页面卸载通过 `cancelWatch` 释放该读取者的等待，不发送消息或调用目标模型。

系统总览和项目会话面板提供同一个会话协作视图，可搜索其他会话的目标、查看已观测动作并选中来源详情。列表分页读取，详情和历史按需打开；更新保留搜索、选择和键盘焦点。会话、worker 历史和任务入口使用既有导航，来源未读取或不可用时显示相应状态。

协作消息使用 finding、status、request、handoff、result 用途和稳定意图 ID，携带源目标会话代次及原任务/证据引用。工具的来源绑定当前运行，Main 发送入口读取活动 Workspace/Session owner，并核对用户预览的源 scope。消息仍是 inter_session 数据；同 ID 异内容、过期意图、旧代和失效任务引用被原发送入口拒绝。

消息意图在原 shared state SQLite 中保留首次来源和派发回执。相同意图重试返回原记录；缺失派发回执时保持 unknown。`sessions.collaborationMessages` 按当前读取者和目标 scope 分页读取有界摘要，指定原 ID 后读取完整意图与回执；读取不创建数据库或修改投递状态。

选中会话后可展开消息区，查看用途、发件/收件代次、投递阶段、原正文和回复。发送前预览 Main 当前来源；草稿按源目标完整身份保留，明确接受后清空。unknown 保留原 ID 与内容，使用“回读原回执”核对结果。原会话控制目录继续打开对应 owner 的引导、分支、接力和迁移入口。

同源目标代次、任务和完全相同内容的 finding/status 突发由原消息 owner 合并，回执携带 coalescedTo 原意图引用；request/handoff/result 保持独立。实际协作模型调用在原 Task Trace 标记 coordination，原价格、用量、预算和队列决定继续由各自 owner 提供。

`sessions.collaborationContext` 读取当前目标 scope 的原 TaskSystem 合同、checkpoint、证据和有界上下文。observer 保留只读引用身份，读取不取得 claim；旧 Ledger WorkingContext 在缺少已验证关联时显示 association-not-verified，不隐式桥接或迁移。

`task_control.publishMaterial` 将当前任务的事实、主张、决策候选、产物、冲突和交接记录发布到原 TaskSystem。发布携带稳定 `material.id`、摘要、证据引用、敏感性及可选适用条件和到期时间。来源绑定当前运行与会话代次。摘要字节或产物哈希经当前任务证据确认后可标为 `evidence-backed`，缺少对应证据的事实保留为 `claim`。相同意图重试返回首次发布回执。

在会话协作面板展开“共享材料”，可按任务、文件、主题或证据查询当前工作区内可见会话的材料。列表提供有界摘要和分页，选中后按原材料版本读取完整摘要、适用条件、产物哈希与证据引用。受限材料仅由原发布会话代次读取。模型可通过 `sessions_list({ materials: { search, taskNodeId, file, evidenceRef } })` 使用同一入口，详情传入结果中的 `source` 作为 `target`，并附原 `ref`。

发布替代版本时使用新的材料 ID，并在 `supersedes` 指明原版本。冲突记录以 `conflictsWith` 保存各方引用；已核实材料的替代同样需要可核实证据。当前任务 writer 可通过 `revokeMaterial` 携带原引用和原因撤销。材料面板跟踪所选版本的状态变化，任务修订、证据或产物变化、期限和来源缺失分别回读。源会话删除后，关联同一任务的授权读者可按原引用查看留存证据回执。

模型工具的持久回复保存材料引用。模型在当次运行中选中原版本后，运行时在准备模型请求时核对可见性和材料状态，并在现有工具回复预算内带入内容。Task Trace 分别保留检索候选、实际打开的界面详情、模型引用、请求所带材料和已收到的响应摘要哈希。

核心实现：

- `openclaw_runtime/src/agents/sessions/session-manager.ts`
- `openclaw_runtime/src/config/sessions/transcript-jsonl.ts`
- `openclaw_runtime/src/transcripts/`
- `electron/services/sessions-api.ts`

### 2.1 JSONL append-only tree

SessionManager 使用追加型 JSONL：

- 第一行是 `session` header，含 id、timestamp、cwd、可选 parentSession；
- 后续 entry 有 `id`、`parentId`、`timestamp`；
- 支持 message、thinking level change、model change、compaction、branch summary、label、session info、custom message 和 extension-specific entry；
- 通过 parent/child 关系形成会话树；
- 当前 leaf 决定“当前继续哪条分支”；
- fork 从既有分支派生新的 session。

这种设计同时保留原始分支、摘要、标签和模型/思考变更，不需要用 UI 字符串推断历史。

### 2.2 transcript 限额

- 单条工具结果持久化前最多保留 80,000 字符，超出会写入截断标记。
- renderer 默认最多保留 300 条消息、一次加载 200 条、DOM 同时渲染 120 条。
- 大历史窗口化渲染，避免一次性挂载全部节点。
- 历史读取失败时会尝试 transcript fallback；这是恢复路径，不保证 `chat.history` 永不失败。

## 3. 创建、切换与 UI 组织

Renderer 相关：

- `src/stores/chat/session-actions.ts`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/SessionSearchModal.tsx`
- `src/components/layout/SessionFolderTree.tsx`
- `src/components/layout/SessionContextMenu.tsx`
- `src/components/layout/session-buckets.ts`

支持：

- 新建 session；
- 从 agent 主 session 切换；
- 按最后活动排序与分桶；
- 搜索当前 agent 的会话，并显示所属 workspace/workgroup；
- 重命名；
- 置顶；
- workspace 级 session folder/workgroup 分组；
- archive 到 recycle-bin 索引；
- restore；
- permanently delete；
- empty archive。

当前工作区 store 明确把新 folder 作为项目根级 workgroup 创建，不递归嵌套。旧参数仍可兼容接收，但新 UI 不建立无限层级文件夹。

侧栏只负责组织，不改变 session key。把 session 放入 workgroup 不等于改变 cwd、模型、权限或任务归属。

## 4. Run 生命周期与输入模式

会话活动状态来自 `SessionActivitySnapshot`：

- run：`idle / running / waiting_approval / completed / failed / aborted`；
- task：`queued / running / review / blocked / completed / failed / aborted`；
- subagent：`started / yielded / completed / error / aborted / verified`；
- terminal：`idle / starting / running / exited / blocked / completed / error`；
- goal/process/lineage 有各自状态与 owner。

输入模式由 `openclaw_runtime/src/sessions/input-mode.ts` 定义：

| 模式 | 当前 run | 用户意图 |
|---|---|---|
| `interrupt` | abort | 立即停止并接管 |
| `revise-goal` | abort | 修订目标后重新开始 |
| `guide` | 不 abort | 将补充作为 steering message |
| `queue` | 不 abort | 当前 run 结束后作为 follow-up 发送 |

Renderer 还有 pending message queue；运行中普通发送会被保存、排序，并在 run drain 后自动发送。

Runtime 审批按 `expiresAtMs` 撤下过期输入遮罩，原草稿保持挂载。连接状态变化和失败的审批操作会重新读取待处理快照；空快照清除过时项，迟到的旧快照不会复活已解决的审批。

## 5. 历史加载与恢复

历史动作包括：

- `loadHistory(true/false)`；
- 分页加载更多历史；
- transcript fallback；
- startup retry；
- pending / final / streamed tool result merge；
- session label hydration；
- 重新加载失败时的可见 error，而不是伪造空历史。

`sessions-api.ts` 还支持：

- `summaries`：读取 head/tail 生成侧栏摘要，避免每次扫描完整 transcript；
- `history`：读取某一 session 历史；
- `compactionStatus` / `compactionHistory`；
- `compressionArtifact`；
- `recoveryContext`；
- `recallOriginal` / `expandSelector`：按 owner ref 重新展开原始材料，而不是把全文常驻 prompt。

## 6. Checkpoint

当前 Host API：

- `sessions.resumeCheckpoints`
- `sessions.restoreCheckpoint`
- `sessions.checkpointDiff`
- `sessions.compact`
- `sessions.compactRange`
- `sessions.truncate`

Checkpoint 是 session 内可恢复点，不等同于 Git commit、worktree 或 Task Ledger checkpoint。

恢复结果区分：

- `event_log_replay`：使用事件日志重放；
- `legacy_checkpoint_fallback`：旧 checkpoint 兼容路径。

`checkpointDiff` 返回文件级差异与错误。恢复成功后应刷新 transcript/history；仅收到 RPC success 不足以证明 UI 和磁盘都已对齐。

## 7. Compaction 与 recovery context

SessionManager 的 `compaction` entry 记录：

- summary；
- `firstKeptEntryId`；
- `tokensBefore`；
- 可选 extension details；
- 是否来自 hook。

Compaction 的目标是减小后续 prompt，而不是改写原始 transcript。压缩 artifact/recovery context 让后续 turn 能引用摘要、决策、未完成项、风险和 evidence refs。

边界：

- compaction 摘要不是无损原文；
- 结构损坏/摘要缺失可以被 observability 评分识别；
- 长会话策略目前仍为 baseline；连续压缩、价值剪枝和摘要树没有因本轮文档更新而默认启用；
- native backend 可能自己拥有 compaction；Session policy 会区分 configured 与 effective，并把不支持的参数标为 ignored/unsupported。

## 8. Handoff 与 fork

### 8.1 Handoff

执行环境迁移与新建续接会话分别处理。Chat 工具栏的“在另一个检出中继续”保留逻辑 sessionKey 和业务任务，将物理代次、任务 epoch 与执行根按持久操作转交到已配置的工作区。源环境先关闭新效果并排空，目标 transcript、任务合同和产物回读确认后才开放。中断后使用同一操作继续恢复，不需要重述目标。目标必须与源使用同一任务 authority；独立 clone 需要已有的显式注册。

迁移复制会话记录并保留源记录，检查点产物继续引用源检出的明确路径。产物校验失败会保留操作和原因，恢复原检查点版本后可继续。目标写入预留在绑定发布后释放；窗口在最后一步关闭时，“继续迁移”仍能完成释放。中断超过领取租期时，系统重新核对原任务、代次和资源排空后恢复资格。

`prepareHandoff` / `createHandoff`：

- 先验证 handoff ancestry；
- 验证并持久化 Task Ledger lineage；
- runtime 创建并确认带直接父会话的新目标，保存 operationId、源代次、child 与首发 key；
- “创建并发送”提交已审阅草稿作为首条消息；未知结果先核实既有回执，恢复时复用同一 child 和首发 key；
- 源 session、源任务和源 goal 不因 handoff 自动消失；
- 循环或不可读 lineage 被拒绝；
- 写入被串行化，避免并发 handoff 竞争。

深度限制默认关闭。显式设置：

```json
{
  "runtime": {
    "handoff": {
      "enabled": true,
      "maxDepth": 3
    }
  }
}
```

`maxDepth` 允许 1–64；未指定时隐式使用 3，但只在 `enabled=true` 时执行限制。fork 保留 relay ancestry。

### 8.2 Fork

`fork` 的已声明继承边界：

- transcript/branch；
- workspace 与模型偏好按既有实现继承；
- 不是完整 Git worktree 隔离；
- goal 转移不是当前承诺；
- 不因 fork 自动创建第二轮任务权威。

## 9. Archive、restore、delete 和 reset

Change Context 评论由独立的 Main review store 保留为审查证据。会话 archive、
restore、delete 或 reset 不赋予评论任何会话权威，也不会自动移动或淘汰评论。
评论删除使用显式 tombstone；源已不可读取时显示 unavailable。入口回滚与范围见
[Change Context 受控启用](../dev/change-context-review-loop/rollout.md)。

### Archive

- 将活动 transcript 变成 `<id>.archived.jsonl`；
- 从活动 `sessions.json` 移除；
- 写入 Verse Claw 自己的 `sessions.archives.json` 索引；
- 保留 workspace/folder hints 和原始 entry snapshot；
- 不证明任务完成，也不终止任意外部进程。

### Restore

- 通过运行时生命周期 owner 恢复；
- 分配新的 physical `sessionId` generation；
- 旧 generation 的迟到事件不能写入恢复后的活动行；
- restore 不等于恢复任务/goal 状态。

### Permanent delete

删除会级联清理：

- 活动/归档 transcript；
- `.deleted.jsonl`；
- `.jsonl.reset.*`；
- trajectory `*.trajectory.jsonl` 与 pointer；
- context archive artifacts；
- archive index entry；
- 与 session 关联的受管资源。

删除先建立 operation identity；如果派生文件删除失败，archive locator 会保留以便重试，而不是显示假成功。

### Reset

reset 改变物理 generation，但保留逻辑 session key。它不通过字符串猜新会话，也不自动迁移旧 generation 的后台进程/等待。

## 10. 长会话 Coordinator 与 delegation

长会话 surface 复用 Sidebar 与 Chat activity rail，不建立第二套 task list。

显式 coordinator binding 绑定：

- workspace；
- agent；
- session key；
- physical session generation；
- canonical root / managed worktree；
- branch、detached、setup profile；
- binding revision；
- Task Ledger refs；
- archive/restore policy。

Chat 发送前会检查：

- binding 是否 active；
- agent 是否匹配；
- session generation 是否一致；
- canonical root 是否存在；
- working context、compression artifact、memory surface 和 effective policy 是否可读。

这些读取是 bounded 且 best-effort 的：缺失/失效会降低 continuity pack，而不是把旧事实注入新 generation。

`sessions.delegate` 经过 typed admission：

- coordinator revision + session generation；
- Task Ledger reference；
- role/worker task；
- child session/run；
- tool authorization；
- isolation backend（worktree 或 in-process）；
- write set；
- resource budget；
- idempotency key。

`accepted` 只表示 child admission 已被现有 owner 接受，不表示已运行、已完成或任务已验收。Stale generation、revoked approval、unsupported backend 和未证明的并行写会 fail closed 或串行化。

## 11. Session Effective Policy

`SessionEffectivePolicy/v1` 把配置事实与运行事实分开：

- backend：OpenClaw/native/CLI，provider/model，是否 owns native compaction；
- model：provider/model/effort；
- grants：allowed / requires-approval / denied / unknown；
- context：context tokens 与 pressure；
- queue：mode/cap/drop/debounce；
- resources：并发 runs/subagents/spawn depth/processes/RSS/terminals/worktrees/idle TTL；
- schedule：cron 与 retention；
- compatibility：参数是否 ignored/unsupported 及原因；
- generation：effective/unverified/stale/mismatch/missing。

Chat activity panel 只把与当前 workspace/run/gateway generation 匹配的观察标为 effective。旧观察不会覆盖当前选择。

## 11.1 会话阶段（SessionStage）只读投影

`session.activitySnapshot` 现在附带一个 `stage` 投影，回答“这属于哪种会话”。它是诊断，不是执行输入。

| stage | 证明它的既有事实（任一即可） |
|---|---|
| `forked` | `forkedFromParent`，或 `forkedFromLeafId` + `parentSessionKey` |
| `handedOff` | 只有 `parentSessionKey` 或 `spawnedBy`，无 fork 三元组 |
| `restored` | `usageFamilySessionIds` 里存在非当前 `sessionId` 的旧代 |
| `compacted` | `compactionCount > 0`，或存在压缩 checkpoint |
| `resumed` | 会话起始时间与最新 transcript 活动相隔超过 6 小时 |
| `continued` | 有 transcript 活动，但无轮换证明 |
| `fresh` | 有身份、无轮换、无活动 |
| `unknown` | entry 缺失、事实矛盾（例如只有 leafId 没有父 key）、或缺少身份 |

边界：

- 身份只用 `sessionKey` + `sessionId`（generation），不使用 `scopeKey`。
- 事实矛盾时返回 `unknown` 并在 `stageEvidence.reasons` 写明原因，禁止从标题、label、模型名猜测。
- **任何提示词装配、注入预算、压缩时机或存储写入都不得读取 stage**；`tests/unit/session-stage-no-execution-coupling.test.ts` 以源码扫描方式守住这条边界。
- entry 找不到是“没读到”，不是“空会话”，因此是 `unknown` 而不是 `fresh`。

源码：`shared/types/session-stage.ts`（纯函数 `deriveSessionStage`）、`openclaw_runtime/src/gateway/server-methods/session-stage-projection.ts`（只读适配器）。

## 11.2 衍生血缘（SessionDerivation）只读投影

`session.activitySnapshot` 的 `derivation` 回答“这个会话从哪来、每一跳能不能证明”。它不新建血缘表，只读 `fork` / `handoff` / `spawn` 已经持久化的字段。

| hop.kind | 证明它的字段 |
|---|---|
| `fork` | `forkedFromParent`，或 `forkedFromLeafId` + `parentSessionKey` |
| `handoff` | `parentSessionKey`，且无 fork 事实与 `spawnedBy` |
| `spawn` | `spawnedBy` |
| `unknown` | 该 entry 没有声明任何父会话（这是根，不是缺口） |

| hop.status | 含义 |
|---|---|
| `resolved` | 父 entry 在 store 中读到 |
| `parent-missing` | 指明了父 key，但父 entry 读不到——**不是**“没有父” |
| `cycle` | 链上重复出现同一 key，停止并如实标注 |
| `bound-exceeded` | 超过深度上限（默认 8），`truncated: true` |

边界：

- 只读；不建 `session_derivations` 表、不写 receipt、不改变 fork/handoff/restore/reset 行为。
- 血缘不是任务或 goal 权威；Task Ledger 与 goal truth 不变。
- 血缘读取失败不得让整个 snapshot 失败；缺失时 `derivation` 缺省。
- 继承策略默认仍是 transcript-only，本投影不改变继承内容。

源码：`shared/types/session-derivation.ts`（纯函数 `deriveSessionLineage` / `classifyDerivation`）、`openclaw_runtime/src/gateway/server-methods/session-derivation-projection.ts`（只读适配器）。

## 12. 隐私与存储

- transcript、label、archive index 和 trajectory 都是本地数据。
- 模型请求会发送当前 prompt 所需的 transcript/context；本地存储不等于离线。
- archive 保留 transcript，因此删除前应理解它仍可被恢复和读取。
- permanent delete 是不可逆删除；不要通过手工删除 archive index 来“修状态”。
- 本地 handoff/archive 索引不是可公开提交的项目数据。

## 13. 当前限制

- 全量跨平台 session 生命周期没有整体验收。
- fork 不是文件/进程级快照。
- handoff 默认不强制深度上限。
- long-session continuity 默认保持 baseline，不自动启用连续压缩/剪枝。
- ACP/native/CLI backend 对 compaction 和参数支持不一致，必须看 effective policy。
- activity snapshot 是只读投影，不是 task completion authority。
- session stage 同样是只读投影：它解释会话处于哪一阶段，但不能改变提示词、预算或压缩时机。
- derivation 只报告可证明的父链；parent-missing 与 cycle 必须如实呈现，不能补成一条看起来完整的链。
- 任何 run/session 终态声明都必须来自 owner 事实和可回读 transcript/event，不接受 UI 假想状态。

## 14. 源码索引

- `openclaw_runtime/src/agents/sessions/session-manager.ts`
- `openclaw_runtime/src/agents/sessions/agent-session.ts`
- `openclaw_runtime/src/sessions/input-mode.ts`
- `openclaw_runtime/src/sessions/session-lifecycle-events.ts`
- `openclaw_runtime/src/transcripts/`
- `electron/services/sessions-api.ts`
- `electron/services/session-delete-gate.ts`
- `electron/services/session-cascade-delete.ts`
- `electron/services/session-delegation-admission.ts`
- `electron/services/session-delegation-store.ts`
- `shared/types/session-activity.ts`
- `shared/types/session-stage.ts`
- `shared/types/session-derivation.ts`
- `openclaw_runtime/src/gateway/server-methods/session-derivation-projection.ts`
- `openclaw_runtime/src/gateway/server-methods/session-stage-projection.ts`
- `shared/types/session-effective-policy.ts`
- `shared/types/session-delegation.ts`
- `shared/types/delegation-admission.ts`
- `src/stores/chat/session-actions.ts`
- `src/components/layout/Sidebar.tsx`

延伸阅读：[产品语义中的生命周期边界](../clawx-product-semantics.md)、[长会话控制面设计](../dev/session-lifecycle-control-plane/DESIGN.zh-CN.md)、[Delegation admission](../../harness/specs/guides/long-session-delegation-admission.md)。

## 会话索引与能力预设（B1 决策）

- 决策记录：`docs/dev/session-lifecycle-control-plane/B1-DECISION.zh-CN.md`（TF-0647）。
- 当前结论：**可重建会话索引与会话能力预设均为 NO-GO**，原因是缺少实测查询压力与消费需求语料，而不是技术不可行。
- 本决策不新增索引、store、adapter 或 preset；冻结 `SessionEffectivePolicy` 语义，不建多机 SessionStore 适配器。
- 重开条件与未来写集/owner 见决策记录第 3、5 节。
