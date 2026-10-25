# Codex 桌面端 / CLI 会话语义对照与 ClawX 落地评估

日期：2026-10-22 · actor: codex · driven_by: agent
检索路由：versesearch -> AnySearch（发现 + 官方页 Markdown 提取）；官方一手页为主，Exa 未使用。
本地定位：已编译 CodeGraph 1.6.2 CLI（全局 codegraph.cmd），索引 D:/ClawX/.codegraph/codegraph.db（13,358 文件 / 312,373 符号 / 865,304 边），再回读真实源码。

---

## 0. 先回答你最直接的问题

**Codex 目前没有把"会话生命周期"作为一组 CLI 工具整体交给大模型。**

Codex 把会话生命周期拆成了三个不同的消费面：

1. **人类用户**：CLI 子命令与斜杠命令。
   - CLI：codex resume（按 ID 或 --last）、codex fork（含 --worktree，要求显式 SESSION_ID）、codex archive / unarchive / delete（按 session ID 或名字）、codex queue --thread、codex agents（命令中心）、codex app-server。
   - App 斜杠命令：/archive、/fork、/worktree、/local、/cloud、/compact、/new、/side、/status、/goal、/memories、/project、/pin、/rename。
2. **宿主/客户端程序**：Codex app-server 的 JSON-RPC API。
   - thread/start、thread/resume、thread/read、thread/list、thread/fork、thread/archive、thread/delete、thread/unarchive、thread/compact/start、thread/revert、thread/inject_items、thread/metadata/update、thread/name/set、thread/goal/set|get|clear、thread/shellCommand、thread/backgroundTerminals/list|clean|terminate、turn/start、turn/steer。
3. **模型**：干活用的工具面。
   - 本地 shell / apply_patch / 计划 / MCP / 网页检索，加上**子代理委派**（subagents）。
   - 模型拿到的是"当前 thread 的 cwd、沙箱策略、截断后的历史"；它不是自己调用 codex resume 去加载别的会话，也不是自己决定 thread 绑哪个 worktree。

**桌面端与 CLI 的关键差别就在这里**：CLI 把生命周期动作暴露给"终端里的人"；桌面端把它们暴露给"客户端程序"（app-server），并在客户端内部做成 UI 状态机。当前桌面端这层还会把 thread / worktree 管理能力以受控工具形式注入给 agent（本会话中可观察到 list/read/fork/create/archive/pin/rename/handoff/wait 以及 worktree create/attach/archive/restore 一类能力），这属于 app 层工具，不是 codex CLI 子命令。

一句话：**resume-by-id / worktree 切换是客户端与 app-server 的职责；模型只拿到被授权的工作区和委派工具。** ClawX 现有架构与这个分层基本同构，差别主要在"桌面端会话级 worktree 绑定"和"每会话 OS 资源账本"。

---

## 1. Codex 的一手事实

### 1.1 工作树（桌面端为主）

官方 Worktrees 文档给出的事实：

- Worktree 使用 Git worktree，实现"同一项目多个独立 chat"。
- 新 chat 在 composer 处选择 Worktree；可选起始分支；默认 detached HEAD。
- Handoff 把 **chat 和代码一起** 在 Local 与 Worktree 间移动；同一个 chat 回到 worktree 时会回到同一个关联 worktree。
- Codex 托管 worktree 默认放在 $CODEX_HOME/worktrees；默认保留最近 15 个，可在 Settings > Worktrees 修改或关闭自动删除。
- 自动删除的保护条件：chat 被 pin、chat 仍在进行中、worktree 是 permanent。
- 删除相关 chat 时自动删除其 worktree；删除前会保存快照，重新打开该 chat 时提供 restore。
- 忽略文件可通过 .worktreeinclude 复制（.env、.env.local、config/secrets.json 等）；AGENTS.override.md 自动复制；不覆盖已存在文件；不复制 source symlink。
- 分支只能在一个 checkout 中检出，因此提供了 Handoff 而不是"两处同时检出"。

来源：https://learn.chatgpt.com/docs/environments/git-worktrees

### 1.2 CLI 会话生命周期

官方 Developer commands：

- codex resume：按 ID 继续，或 --last 恢复最近；--last 默认限定在当前工作目录，除非 --all。
- 当当前 cwd 与 session 保存的目录不同，Codex 会询问用哪个目录；可用 tui.resume_cwd = "current" | "session" 固定策略；显式 --cd 优先。
- codex resume **不接受 --worktree**。
- codex fork：默认打开 session picker；codex fork <SESSION_ID> --worktree 可以 fork 到托管 worktree，但要求显式 SESSION_ID，且不支持 --last 或 picker。
- codex archive / codex unarchive：按 session ID 或 session 名；ID 优先于名字；只隐藏不删除 transcript。
- codex delete：永久删除 transcript；delete <SESSION_UUID> --force 只对 UUID 允许强制。
- codex queue --thread <SESSION_ID> --message ...：向已有 session 排队消息。
- codex agents：命令中心，浏览并切换共享 server 上的 chat。
- codex app-server：本地 app-server，主要用于富客户端集成；--remote 可把 TUI 接到 app-server。
- 全局 --worktree：支持新的交互 session、codex fork <SESSION_ID>、codex exec，要求本地执行。

来源：https://learn.chatgpt.com/docs/developer-commands

### 1.3 app-server（桌面端真正用的控制面）

官方 Codex App Server 文档给出：

协议：JSON-RPC 2.0；transport 支持 stdio（默认，JSONL）、WebSocket（实验性、不保证生产）、Unix socket、off。

核心原语：Thread（会话，含 turns）、Turn（一轮请求及其工作）、Item（消息/命令执行/文件改动/工具调用等）。

生命周期方法：

- 创建/resume/fork：thread/start、thread/resume、thread/fork（可用 lastTurnId 截断，ephemeral: true 为内存 fork）。
- 读取：thread/read（只读元数据）、thread/turns/list、thread/items/list、thread/list（支持 cwd、archived、isPinned、parentThreadId/ancestorThreadId 等过滤）、thread/loaded/list。
- 变更：thread/archive（迁移 JSONL 到 archived 目录，并尝试归档派生 thread）、thread/delete（永久删除并级联派生 thread）、thread/unarchive、thread/metadata/update、thread/name/set、thread/compact/start、thread/revert、thread/inject_items、thread/unsubscribe。
- 目标：thread/goal/set|get|clear。
- 执行：turn/start、turn/steer；turn/start 可逐轮覆盖 model、effort、cwd、sandbox policy、summary，且这些会成为后续 turn 的默认值。
- 宿主 shell：thread/shellCommand，带 timeoutMs（默认一小时），**在沙箱之外运行且不继承 thread sandbox**，文档明确要求客户端只对"用户显式发起"的命令暴露它。
- 后台终端：thread/backgroundTerminals/list|clean|terminate（实验性）。list 返回 itemId/processId/command/cwd/osPid/cpuPercent/rssKb，nextCursor 分页。这说明 Codex 已经有"线程级后台进程台账"的概念，但字段本身可以为 null，属于观测面而非硬约束。
- 背压：WebSocket 模式使用 bounded queue，队列满返回 -32001 "Server overloaded; retry later."，客户端应指数退避重试。

来源：https://learn.chatgpt.com/docs/app-server

### 1.4 定时任务 / 子代理

- 定时任务：桌面端可以在项目目录或隔离 worktree 中运行，需要电脑开机且 app 运行；CLI 与 IDE 扩展没有 Scheduled 管理界面。
  https://learn.chatgpt.com/docs/automations
- 子代理：app/CLI/IDE 默认启用；可在 .codex/config.toml 用 [agents] max_concurrent_threads_per_session 限制并发（示例为 8）；自定义 agent 用 .codex/agents/*.toml + 名称 + 模型 + 指令；写密集任务要谨慎并行。
  https://learn.chatgpt.com/docs/agent-configuration/subagents

---

## 2. ClawX 现状（源码证据）

### 2.1 会话生命周期 API（renderer -> Main）

D:/ClawX/shared/host-api/contract.ts:5690 的 sessions 模块已经包含：

- 读取：summaries、history、listArchived、compactionStatus、compactionHistory、compressionArtifact、recoveryContext、recallOriginal、expandSelector、longTaskControlStatus/History、resumeCheckpoints、checkpointDiff、sessionActivity.snapshot。
- 执行/生命周期：stop、compact、compactRange、prepareHandoff、createHandoff、fork、truncate、archive、restore、permanentDelete、emptyArchive、queueDrain、restoreCheckpoint。
- 会话属性：rename、patchThinking、patchRuntimeModel。

这已经覆盖 Codex resume/read/fork/archive/delete 的主要语义，差别在"工作区/环境绑定"与"资源账本"。

### 2.2 归档/恢复/永久删除

D:/ClawX/electron/services/sessions-api.ts:1457 archiveSession：

- 解析 sessionKey -> agentId；
- 读 sessions.json；
- resolveSessionTranscriptPath 做路径归属校验；
- snapshotSessionEntry 快照 sessions.json 行；
- archiveSessionTranscript 重命名 transcript（.archived.jsonl）；
- 从 sessions.json 移除条目（容忍并发改写，以文件名为准）；
- 写 archive index。

D:/ClawX/electron/services/sessions-api.ts:1534 restoreSession：反向操作，幂等；缺 index 才算硬失败。
D:/ClawX/electron/services/sessions-api.ts:1581 permanentDeleteSession：永久删除。

**与 A2 计划一致的真实缺口**：archive 是直接改文件，不先经过 session admission fence / stop barrier。运行中的归档与 runtime delete receipt 之间存在不对称，这正是 long-session-lifecycle-barrier 要解决的。

### 2.3 stop / drain / admission

- D:/ClawX/openclaw_runtime/src/sessions/session-admission-registry.ts：permit + fence，身份为 agentId + canonicalSessionKey + expectedSessionId；kind 覆盖 chat-send、sessions-steer、spawn、exec、goal-wait 等；被 session 发送、runEmbeddedAgent、spawnSubagentDirect、chat.send、runExecProcess、createExecTool、createGoalWaitTool 调用。
- D:/ClawX/openclaw_runtime/src/gateway/session-drain-service.ts:124 drainScope：要求 admission fence 已关闭；快照 bash 进程 handle、supervisor runs、durable helper PIDs；captureProcessTrees 采集 OS 进程树；取消 + 等待 + durable reap；未知 owner 时拒绝清记录。
- D:/ClawX/openclaw_runtime/src/gateway/session-reset-service.ts：runSessionStopFront 调用 drainScope。

这一层比 Codex 当前公开文档更"硬"：Codex 是有 stop/turn 控制，但公开文档没有等价的三元身份 fence + 进程树 drain 语义。

### 2.4 工作树

- D:/ClawX/openclaw_runtime/src/agents/worktree-service.ts:288 createWorktreeService。
- 生产调用者：orchestrator-run-observed.ts:360（并行 worker 编排）、orchestration-worktree-merge.ts:38（合并 worker worktree）。
- renderer 侧：shared/host-api/contract.ts:5390 git.worktrees / worktreeAdd / worktreeRemove / worktreePrune，属于审批门控的 Git 操作面板。

**差别**：Codex 的 worktree 是"chat 级环境选择 + Handoff"；ClawX 的 worktree 目前是"编排 worker 级隔离 + Git 面板手动操作"。没有"这个 chat 永久绑定这个 worktree、archive 时自动清理、重开可 restore"的会话级生命周期。

### 2.5 资源追踪（进程/端口）

D:/ClawX/electron/services/resource-tracker.ts:63：

- 记录：id、port、pid、command、sessionKey、sessionLabel、workspaceId、agentId、status（healthy/idle/unreachable）、ownership（managed/observed）、startedAt、lastHeartbeatAt、sessionLastActiveAt。
- 30 秒 TCP heartbeat；10 分钟 idle 阈值；30 分钟自动清理（AUTO_CLEANUP_IDLE_MS）。
- register / registerNewListeningPortsSince / unregisterBySession / stopResource / stopAll / killProcess（Windows: taskkill /F /PID <pid> /T；POSIX: SIGTERM -> SIGKILL）。
- 只跟踪"监听端口"这一种资源发现方式，没有 CPU / RSS / 进程树大小 / 文件描述符。
- host-api：resourceTracker.list/stop/stopAll（shared/host-api/contract.ts:5897）。
- UI 已接线：src/stores/resource-tracker.ts、src/components/chat/ResourceChip.tsx。

### 2.6 模型可见的会话工具

D:/ClawX/openclaw_runtime/src/agents/tools/ 中：

- sessions_list：列会话（kinds/limit/activeMinutes/label/agentId/search），受 sandboxed visibility 限制。
- sessions_history：按 sessionKey 读历史，受 visibility / restrictToSpawned 限制。
- sessions_send：向会话发消息。
- sessions_compact：只能压缩"当前会话"，不能指定别的会话。
- sessions_spawn：委派 worker；参数含 task、taskName、label、runtime(subagent|acp)、agentId、model、thinking、cwd、thread、mode(run|session)、cleanup(delete|keep)、sandbox、context(isolated|fork)、lightContext、attachments。没有 worktree 参数，也没有内存/资源预算参数。
- sessions_yield：结束当前 turn，等子代理结果。
- subagents：只 list 当前 controller 的 active/recent subagents。
- session_status：读会话状态。

配置层并发限制：DEFAULT_AGENT_MAX_CONCURRENT = 4，DEFAULT_SUBAGENT_MAX_CONCURRENT = 8，DEFAULT_CRON_MAX_CONCURRENT_RUNS = 8，acp.maxConcurrentSessions 可配。这些是"数量"约束，不是"内存/CPU"约束。

测试侧：D:/ClawX/tests/unit 下 *session*.test.ts 共 29 个文件；另有 runtime 侧 session-admission、session-drain、session-ecosystem-reclamation 等测试。

---

## 3. 逐项对照

| 维度 | Codex（CLI + 桌面 app-server） | ClawX 现状 | 判断 |
|---|---|---|---|
| 会话身份 | session UUID / 名称；thread id（thr_*）；turn / item | sessionKey + agentId + sessionId；turn/run；Task Ledger | 基本对齐 |
| 按 ID 读会话 | CLI resume/read；app-server thread/read + turns/items/list（分页 + itemsView） | host-api sessions.summaries/history；模型 sessions_history（受可见性约束） | 基本对齐，缺服务端分页/itemsView 级别 |
| resume 与 cwd | resume 保存目录，cwd 不一致时询问；tui.resume_cwd；--cd 优先 | workspace 绑定 + resumeCheckpoints / recoveryContext | 语义不同但覆盖 |
| fork | codex fork、/fork、thread/fork（lastTurnId / ephemeral） | host-api sessions.fork；模型不可直接 fork | 接近 |
| archive / restore / delete | CLI 三个命令 + app-server 三方法；delete 级联派生 thread | archive/restore/permanentDelete + listArchived/emptyArchive | 接近；但 archive 未过 stop barrier（A2） |
| 工作树绑定 | chat 级 Local/Worktree/Cloud；Handoff 同时移动 chat + 代码 | workspace 级 + worker 级 worktree；无 chat 级绑定 | **主要差距** |
| worktree 清理 | 默认保留 15、pin/in-progress/permanent 保护、删除前快照、重开可 restore | 无会话级 worktree 保留/清理策略 | **主要差距** |
| 定时任务运行位置 | 项目目录或隔离 worktree；app 常开 | Cron/Workboard 已有；运行位置/绑定语义待 B/E 阶段 | 部分覆盖 |
| 子代理 | subagents + max_concurrent_threads_per_session；有 app/CLI/IDE 视图 | sessions_spawn/subagents/sessions_yield + maxConcurrent 4/8 | 基本对齐 |
| 后台进程台账 | thread/backgroundTerminals/list 返回 osPid/cpuPercent/rssKb；clean/terminate | resourceTracker 只按监听端口发现；有 pid/port/heartbeat/stop | **差距：无 CPU/RSS/进程树规模** |
| 进程树终止 | backgroundTerminals/clean 为线程级；shellCommand 单独超时 | drainScope 采进程树 + taskkill /F /T + durable helper reap | **ClawX 更强** |
| 会话 fence | 文档未给出等价三元身份 fence | admission permit + fence + expectedSessionId | **ClawX 更强** |
| 内存约束 | 文档只有 rssKb 观测字段；无公开的 per-thread RSS 配额 | 无 RSS 采集、无内存水位/配额 | 双方都弱，ClawX 可先做 |
| 背压 | WebSocket bounded queue + -32001 重试 | 有 background work gate、timer aligner、并发上限 | 语义不同，可互相借鉴 |
| 生命周期对模型开放度 | 宿主/客户端拥有；模型拿到工作区 + 委派工具；桌面端另有 app 层 thread/worktree 工具 | 模型有 sessions_list/history/send/compact/spawn/yield/subagents；无 archive/delete/fork/worktree 工具 | 分层同构，ClawX 更保守 |

---

## 4. 结论与建议

### 4.1 结论

1. **不要把 Codex 理解成"把会话生命周期当 CLI 工具给模型"**。它的真实分层是：人类用户走 CLI/斜杠命令，富客户端走 app-server JSON-RPC，模型只拿到工作区和委派工具。桌面端比 CLI 多一层：客户端可以把 thread/worktree 管理能力以受控工具形式注入 agent。
2. ClawX 的**会话内部控制面并不落后**：admission fence、drainScope 进程树、archive/restore index、compaction/checkpoint、handoff、session activity 都有真实实现和 29 个会话相关单测。
3. 真正的主要差距是两条：
   - **chat/thread 级环境绑定与 worktree 生命周期**（Local/Worktree 语义、Handoff、保留策略、删除前快照与 restore）。
   - **每会话统一的资源账本**（CPU、RSS、进程树规模、后台终端清单、配额与水位），目前只有"监听端口的 PID 台账"。
4. 资源管理上，ClawX 的起点比 Codex 公开能力更适合做"硬约束"：已经有 fence + drain + 进程树终止，只差"采集 + 配额 + 统一模型"。

### 4.2 建议的落地路线（映射到现有 TF 节点）

- **A1/A2**：先把会话身份、动作合同和归档/恢复/删除的 stop barrier 打通。这是其他一切绑定的地基。
- **B1/B2**：把 backend/权限/生效配置做成会话级事实，为资源配额提供"这个会话允许什么"的输入。
- **C1-C4**：把"主会话 + worker 会话 + Task Ledger"串起来；在这里引入 chat 级环境绑定（workspace vs worktree），但先只做单工作区，不做 cloud。
- **D1-D3**：上下文连续性按测量决定；不要靠"看起来更好"的摘要。
- **E1/E2（重点扩充）**：把 resourceTracker 升级为会话资源账本：
  - 采集：osPid、进程树、CPU%、RSS KB、子进程数、后台终端清单、worktree 占用；
  - 约束：每会话 maxProcesses / maxRssMb / maxBackgroundTerminals / maxWorktrees，超限策略（拒绝/排队/终止最旧）；
  - 生命周期：stop/archive/delete 时按 owner 回收；unknown 一律 recovery_required，不静默成功；
  - 观测：UI ResourceChip 从"端口"扩展到"会话资源总览"，host-api 增加 list/terminate/clean。
- **F1-F3**：用跨重启旅程和长时测量证明"资源会归还、会话能恢复"。

### 4.3 不建议做的事

- 不要把 codex resume/archive/delete 这类原始 CLI 直接开放给模型；应做成 typed、scope 受限、审批门控的 host 工具。
- 不要在没有采集的情况下先做配额；先有诚实读数，再有硬限制。
- 不要引入第二套 thread store；Codex 的 app-server 与 ClawX 的 host-api 都说明"同一权威 + 多消费面"才是正确形状。

---

## 5. 证据清单

- 官方面板：git-worktrees、developer-commands、app-server、cli/slash-commands、reference/slash-commands、automations、subagents、local-environment（learn.chatgpt.com，2026-10-22 抓取）。
- 本地索引：D:/ClawX/.codegraph/codegraph.db（13,358 文件 / 312,373 符号 / 865,304 边）。
- 本地源码：shared/host-api/contract.ts、electron/services/sessions-api.ts、electron/services/resource-tracker.ts、electron/services/resource-tracker-api.ts、openclaw_runtime/src/sessions/session-admission-registry.ts、openclaw_runtime/src/gateway/session-drain-service.ts、openclaw_runtime/src/gateway/session-reset-service.ts、openclaw_runtime/src/agents/worktree-service.ts、openclaw_runtime/src/agents/tools/sessions-*.ts、src/components/chat/ResourceChip.tsx、src/stores/resource-tracker.ts。
