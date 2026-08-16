# Session Lifecycle Control Plane（会话生命周期控制平面）设计

> 状态：**draft / 待评审**
> 日期：2026-08-16
> 基线：`033469f07`（工作树另有无关 WIP）
> 关联审计：上一轮“会话 / Goal 信息识别与终端治理”审计
> 关联文档：
> - `docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md`
> - `docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md`
> - `docs/dev/session-workstreams-design.md`
> - `harness/specs/rules/verseshell-process-lifecycle-boundary.md`

---

## 0. 决策结论（优化 vs 重建）

**结论：不做推翻式重写；做“控制平面补全 + 生命周期闭环”。**

理由不是“现状够好”，而是现有系统里已经存在多个成熟 authority：

| Authority | 现有能力 | 不能重建的原因 |
|---|---|---|
| OpenClaw session store | sessionId、transcript、parent/fork、workspace、goal | session 身份与转录权威，重建等于双写 |
| TaskRegistry / TaskFlow | `task_runs`、`flow_runs` SQLite、状态机、CAS proof、retention | TARGET-ARCHITECTURE 已指定其为 workflow 目标 owner |
| SubagentRegistry | `subagent_runs` SQLite、ended/cleanup/archive/delivery | 子 agent 生命周期已有持久化闭环 |
| LongTaskControl | checkpoint/intervention/queue SQLite | 干涉语义已有成熟持久层 |
| ProcessSupervisor / bash registry | child+PTY 生命周期、整树 kill、输出上限 | 进程执行能力本身不需要重写 |
| VerseShell governed lifecycle | owner=workspace+agent+session、24h retention、restart `lost` | 这是最终进程 owner，当前 default-off |

真正缺的是：

1. **一个会话生命周期编排器**：把 create/stop/pause/resume/fork/handoff/reset/delete 变成有前置条件、有清理顺序、有幂等和回滚的 transition。
2. **一个持久资源账本**：终端、后台进程、子 agent、浏览器、MCP runtime 统一以 `owner_session_key + owner_run_id + owner_task_id` 注册，可 drain、可 reconcile。
3. **一个统一控制面**：Gateway RPC / Electron host-api / renderer 控件 / 模型工具共享同一组 transition。
4. **进程级缓存与持久账本分离**：`bash-process-registry`、`ProcessSupervisor` 从“事实源”降级为“热缓存”。

因此本设计不是“再写一套 session 系统”，而是在现有 authority 之上加一层很薄、但必须闭环的 **Session Lifecycle Control Plane（SLCP）**。

### 0.1 外部主流设计印证（2026-08-16 Anysearch 检索）

调研全文见 `docs/dev/session-lifecycle-control-plane/RESEARCH.zh-CN.md`。结论：本设计的方向与当前主流高度一致：

- **Temporal / Durable Execution**：session/run 必须活在 worker 之外，工具调用是带幂等键的 activity；进程和 transition 必须有持久 journal。
- **Kubernetes declarative + reconciliation**：会话操作应写成 `desired state`，由 reconciler 把 `actual state` 拉齐；不是散落的命令式清理。
- **Erlang OTP / Akka supervision tree**：session → run → subagent → process/terminal 应构成父子 ownership tree，父停则子递归停。
- **systemd transient scope / cgroup / Windows Job Object**：每个 session/run 的资源应归入一个可整组回收的 scope。
- **Lease（Chubby / K8s Leases）**：资源所有权不能只靠 pid，必须带 TTL + heartbeat + fencing epoch；重启后过期或标 lost。
- **Saga / Compensating transaction**：fork/handoff/delete 跨 transcript、goal、checkpoint、资源、lineage 多个 owner，必须建模为 saga。
- **Control/Data/Management plane 三层分离**：runtime 是 control plane，agent/tool/terminal/subagent 是 data plane，UI/model tools 是 management plane。
- **Session as first-class resource（AWS Bedrock Session Management、LangGraph thread/checkpoint、OpenAI Agents SDK sessions）**：会话是可寻址、可恢复、可 ACL 的资源，不是消息数组。
- **Windows 365 Agents 的 Prepare→Acquire→Connect→Act→Release**：是“会话池”生命周期的最佳参照。

由此，本系统应被明确类比为：**一个局部的、面向 agent workload 的控制平面**，每个 session 是带 lineage、goal、checkpoint、resource set、lease 的受管 workload。


---

## 1. 设计原则

1. **Single writer per fact**
0. **声明式 desired state + level-triggered reconcile**
   - 会话操作写入 `session_desired_state`；`SessionReconciler` 持续观察 actual（run/resource/goal/lineage）并收敛。
   - 不依赖“必须看到 edge event”；错过事件也能靠周期性 resync 纠正 drift。

   - session identity/transcript → OpenClaw session authority
   - workflow → TaskFlow/TaskRegistry（迁移窗口内继续由旧控制器写）
   - 子 agent → SubagentRegistry
   - 进程生命周期 → ProcessSupervisor / VerseShell
   - 生命周期 transition 日志 → SLCP
2. **每个 effectful 会话操作都是一个 Intent**
   - 必须携带 `intentId`、幂等键、发起者、预期 revision。
   - 重复提交返回同一结果；冲突提交 fail-closed。
3. **所有资源注册时声明清理策略**
   - 资源必须携带 owner chain 和 `cleanupPolicy`。
   - 不允许“先 spawn 后想起来记账”。
4. **进程内 Map 只是缓存，SQLite 是可恢复事实**
   - 当前 `bash-process-registry` 和 `supervisor registry` 是内存态；SLCP 把它们变成 `session_resources` 表的热缓存。
5. **UI / 模型工具只是 projection 和 command surface**
   - 不直接写资源表、不直接 kill OS 进程；都通过 SLCP transition。
6. **不破坏现有语义**
   - “普通 run abort 不杀后台进程”是有意的重连语义，保留。
   - 新增的语义是 **session stop / delete / handoff / 离开会话** 这些更高级动作必须能显式 drain。
7. **默认路径可恢复，未知状态宁可 `lost` 也不猜**
   - 重启后不 replay spawn；running 记录无法重新拥有时标 `lost`。

---

## 2. 概念模型

```
Session（会话）
 ├─ identity + transcript + workspace
 ├─ Goal（simple SessionGoal / managed TaskFlow）
 ├─ Lineage（parentSessionKey、fork/handoff 链）
 ├─ Runs（执行尝试，可 0..n）
 └─ Resources（终端/进程/子agent/browser/server/mcp）
       └─ owned by: session → run → task/flow → resource
```

### 2.1 Session 聚合状态

`SessionEntry.status` 继续是外部投影；SLCP 内部维护可恢复的 `session_runs` 与资源状态，投影规则：

| 聚合状态 | 判定条件 |
|---|---|
| `provisioned` | 无 sessionId / 无 run |
| `idle` | 无 active run，无 running session-resource |
| `running` | 存在 active run |
| `waiting_approval` | active run 存在 approval pending |
| `paused` | `session_gate.paused=1` |
| `draining` | 一个 terminal transition 正在清理 |
| `terminal` | 最近 run 进入 done/failed/killed/timeout |
| `archived/deleted` | archive/tombstone 完成 |

重要：**聚合状态永远是派生的**，不得新增一个和 SessionEntry/runtime 状态竞争的写入者。

### 2.2 生命周期状态机

```
provisioned ──create/start──▶ idle
idle ──send──▶ running
running ──complete/error──▶ terminal
running ──stop──▶ draining ──▶ idle
running ──pause──▶ draining ──▶ paused
paused ──resume──▶ idle
idle/terminal ──fork──▶ child:provisioned
idle/terminal/paused ──handoff──▶ child:running, source:paused|terminal
terminal/archived ──delete──▶ deleted(tombstone)
```

### 2.3 Goal / Flow 状态

- 轻量目标：`SessionGoalStatus = active|paused|blocked|usage_limited|budget_limited|complete`（保持现状）。
- 多步 workflow：复用 `flow_runs` 的合法转移图 `queued→running→waiting|blocked|succeeded|failed|cancelled|lost`。
- SLCP 只负责把 goal 操作翻译成：
  - `goal.create`
  - `goal.update`
  - `goal.clear`
  - `goal.fork`（复制目标到子会话）
  - `goal.handoff`（目标随 checkpoint 交给子会话）

### 2.4 SessionReconciler（借鉴 K8s control loop）

所有 UI/模型/命令只写入 desired state；reconciler 负责把 actual 拉向 desired：

```
loop:
  desired = read(session_desired_state)          # spec
  actual  = observe(run, resources, goal, lineage) # status
  if actual == desired:
      mark healthy; wait(event | resyncTimer)
  else:
      action = planner(desired, actual)
      if action needs async transition:
          journal(intent, status=requested)
          apply_one_step(action)                  # spawn/abort/drain/fork...
          journal(result)
      if action failed:
          requeue(backoff)
```

规则：

- **level-triggered**：只根据当前 desired/actual 差距行动，不假设看到过某个 edge event。
- **one session at a time**：同一 session 的 transition 串行化，避免并发 drain/fork/delete。
- **finalizer**：delete 先进入 `draining`，全部资源 finalize 后才移除 session 行。
- **status 由 reconciler 单写**：renderer/模型工具只读或提交 desired。
- 周期性 resync 只做轻量 reconcile，不重新扫描磁盘/进程（沿用 runtime hot-path 规则）。

---

## 3. 资源模型（核心）

### 3.1 资源类型与清理策略

| resource kind | owner 字段 | 默认 cleanupPolicy | 说明 |
|---|---|---|---|
| `terminal` | Electron Workspace Terminal | `close_on_leave` | 切换会话关闭；会话删除强杀 |
| `process` | runtime exec/process | `keep_on_leave`, `kill_on_session_delete` | 后台进程可跨 turn 重连 |
| `subagent` | childSessionKey | `cascade` | 父停/删递归清理，已有 registry |
| `browser` | session keys | `close_on_session_end` | 已有 browser lifecycle cleanup |
| `server` | Electron ResourceTracker 端口 | `idle_ttl` | 保留现有 10/30 分钟策略 |
| `mcp_runtime` | sessionId | `close_on_session_end` | 已有 retire path |
| `acp_runtime` | sessionKey | `close_on_session_end` | 已有 ACP close path |

### 3.2 持久表建议（openclaw-state.sqlite）

```sql
CREATE TABLE IF NOT EXISTS session_runs (
  run_id TEXT NOT NULL PRIMARY KEY,
  session_key TEXT NOT NULL,
  agent_id TEXT,
  run_kind TEXT NOT NULL,          -- chat-send | agent | cron | acp | task-loop
  status TEXT NOT NULL,            -- starting|running|draining|succeeded|failed|cancelled|lost
  revision INTEGER NOT NULL DEFAULT 0,
  controller_json TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  terminal_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_resources (
  resource_id TEXT NOT NULL PRIMARY KEY,
  owner_session_key TEXT NOT NULL,
  owner_run_id TEXT,
  owner_task_id TEXT,
  parent_resource_id TEXT,          -- e.g. subagent run that owns a child process
  resource_kind TEXT NOT NULL,      -- terminal|process|subagent|browser|server|mcp_runtime|acp_runtime
  scope_key TEXT NOT NULL,
  pid INTEGER,
  lease_key TEXT,
  status TEXT NOT NULL,             -- registering|running|terminating|exited|killed|lost|retained
  cleanup_policy TEXT NOT NULL,
  cleanup_after INTEGER,
  last_heartbeat_at INTEGER,
  payload_json TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_transitions (
  transition_id TEXT NOT NULL PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  session_key TEXT NOT NULL,
  actor TEXT NOT NULL,              -- user|model|system|desktop
  transition TEXT NOT NULL,         -- create|start|stop|pause|resume|fork|handoff|reset|delete
  status TEXT NOT NULL,             -- requested|admitted|draining|applied|failed|rolled_back
  intent_json TEXT,
  result_json TEXT,
  error_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

索引按 `owner_session_key + status + cleanup_after`、`idempotency_key`、`session_key + created_at` 建。

补充一个 desired-state 投影（也可以并入 `session_runs`，不新增独立 store）：

```sql
CREATE TABLE IF NOT EXISTS session_desired_state (
  session_key TEXT NOT NULL PRIMARY KEY,
  desired TEXT NOT NULL,          -- provisioned|idle|running|paused|handed_off|deleted
  requested_by TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
```

### 3.3 与现有内存注册表的关系

- `bash-process-registry` 的 `runningSessions/finishedSessions` 变成 `session_resources(kind=process)` 的 **hot cache**：
  - spawn 前：`resourceLedger.register()` 成功才 spawn。
  - spawn 成功：pid/lease 写回。
  - exit：cache move-to-finished，同时 ledger 标 `exited`，retention 由 ledger 决定。
- `ProcessSupervisor.registry` 同理；`cancelScope()` 变成 `resourceLedger.drain(scopeKey, policy)` 的执行层。
- 现有 `subagent_runs` 不动；每个 subagent run 在 `session_resources` 写一条轻量 owner 行（或通过 view 联合 `subagent_runs`，避免双写）。

---

## 4. 会话操作语义（Intervention Catalog）

### 4.1 通用 transition 流程

```
request(intent)
  → validate actor/scope/visibility/approval
  → admission（active run？gate？lease？）
  → checkpoint（如需）
  → drain resources（按策略，descendant-first）
  → mutate canonical owner（session store / flow / task）
  → persist transition
  → emit events（session.lifecycle / resource.changed / goal.changed / lineage.changed）
```

### 4.2 操作表

| 操作 | 前置 | 资源处理 | 持久化效果 | 幂等键 |
|---|---|---|---|---|
| `session.create` | agent 存在 | 无 | 新 sessionId/store 行 | `agentId:mainKey` |
| `session.start/send` | 非 paused；lane 允许 | 沿用 chat.send | 新 run | chat.send 现有键 |
| `session.stop` | 无 | 停 run + 子 agent cascade + session scope 进程 kill + 关终端 | status=idle，保留 transcript | `stop:sessionKey:rev` |
| `session.pause` | 无 | 停 run（默认 checkpoint+abort）；关交互终端；进程默认 keep | `session_gate.paused=1` | `pause:sessionKey:rev` |
| `session.resume` | paused | 不重放；queued 消息 drain | `paused=0`，必要时从 checkpoint 开新 run | `resume:sessionKey:rev` |
| `session.fork` | 源非 active；大小 admission | 不继承终端/进程 | 新 child + `parentSessionKey` | `fork:sourceKey:childKey` |
| `session.handoff` | 源可 checkpoint；目标不存在 | 默认源资源 drain，可选 `transfer=terminal` | child 继承 checkpoint/goal；源 paused/terminal | `handoff:sourceKey:childKey` |
| `session.reset` | 非 active | 全部 drain（现有 cleanup + 新增进程） | 旋转 sessionId | 现有 reset 键 |
| `session.delete` | 非 active | 全部 drain + archive + tombstone | session store 移除 | `delete:sessionKey:rev` |

### 4.3 “离开会话”与“结束会话”必须分开

- **离开（switch/new conversation）**：
  - 关闭交互终端（`close_on_leave`）
  - 后台进程保留但重新投影到 Resource Center
  - 不清 transcript、不清 Task Ledger
- **结束（stop/reset/delete/handoff）**：
  - 按 cleanupPolicy 全部 drain
  - 才允许 archive/tombstone

这样既解决 PTY 泄漏，又不会因为用户切个会话就杀掉一个有意跑着的 dev server。

---

## 5. Fork 与 Handoff 设计

### 5.1 数据链

- 保留 `parentSessionKey + forkedFromParent`（已有）。
- 新增 transition 记录 `fork/handoff` 的 `sourceKey/targetKey/sourceRunId/targetRunId/checkpointId/goalId`。
- UI 侧沿用 `session-workstreams-design.md` 的溯源链，不新增文件夹/嵌套。

### 5.2 Fork 语义

1. 源会话必须非 active（现有 `sessions.fork` 已检查 busy）。
2. 父 transcript 大小 admission（现有 `resolveParentForkDecision`）。
3. 新 child 继承：
   - transcript 分支（现有能力）
   - workspace/模型偏好（现有 `inheritSessionRuntimeSelection`）
   - **Goal：默认复制 objective 为新 goal**，`continuationTurns = parent.continuationTurns + 1`，`parentGoalId` 写入 metadata。
4. 不继承：active run、终端、后台进程、子 agent、审批。
5. child 状态 `provisioned`，第一次 send 才起 run。

### 5.3 Handoff 语义

1. 复用 `sessions.prepareHandoff` 的 checkpoint 组装（task ledger + git + traces + recovery context）。
2. SLCP 生成 handoff intent，写 checkpoint。
3. 创建 child（同 fork 的 transcript/workspace 继承）。
4. Goal 默认 **转移**：child goal=source goal；source goal 标 `complete`（或 `paused`，策略可配）。
5. 源资源默认 drain；`transferResources=terminal` 时只允许转移 workspace terminal（关闭后在新 session 重开，不迁移 OS 进程）。
6. 源状态标 `paused|terminal`，lineage 写 `handoff_from`。
7. 全链路幂等键 `handoff:sourceKey:childKey`，重复调用返回同一 child。

### 5.4 防环与失败恢复

- 写 lineage 前检查 child→source 可达性，禁止成环。
- checkpoint 失败：不创建 child，源保持原状态。
- child 创建失败：transition 标 `failed`，源不被 pause。
- drain 失败：transition 标 `rolled_back` 或 `partial`，资源状态标 `lost`，绝不假装成功。

---

## 6. 子 Agent 及其进程的回收

现有 `subagent_runs` 已经有 `cleanup_handled / archive_at / ended_cleanup`。SLCP 只补两件事：

1. **child session 的进程 owner 链**：
   - `session_resources` 行：
     `owner_session_key = childSessionKey`
     `parent_resource_id = subagentRunId`
     `owner_run_id = childRunId`
2. **递归 drain 顺序**（由外到内，由父到子）：
   ```
   parent stop/delete
     → abort parent run
     → stopSubagentsForRequester(parent)   // 已有递归
       → 每个 child: drain(childSessionKey)
          → cancelScope(childSessionKey)   // 新增：child 自己的 exec/process
          → close child terminals
       → retire child MCP/ACP/browser
     → drain(parent session resources)
   ```

不引入新的子 agent 权威；只是在现有 cascade 里补上“child 进程 scope”。

---

## 7. 终端治理闭环

### 7.1 桌面 Workspace Terminal

- `TerminalSessionManager` 增加：
  - `closeForSession(workspaceId, sessionKey, reason)`
  - `listAll()`（Resource Center 使用，不再被 sessionKey 过滤隐藏）
- 调用点：
  - `workspaces-api.update()` 检测 `activeSessionKey` 变化 → close 旧 session 的 interactive terminal
  - `sessions.delete/archive/permanentDelete` → close
  - `session.stop/pause/handoff` → close
- 持久化与重启对账：
  - 最小方案：终端元数据写入现有 electron-store workspace 文档；启动时对 `pid + startedAt + shell` 做安全 liveness 检查，无法证明仍属于本 app 则标 lost 并提示。
  - 不尝试在 Electron 里重建 runtime 的 `session_resources` 权威。

### 7.2 Runtime exec/process

- 每个 `runExecProcess` 在 spawn 前先登记 `session_resources`。
- 前台退出立即 `exited`；后台退出进入 `retained`，retention 默认 30 分钟（兼容现有 TTL），上限 3 小时；running 行有 heartbeat。
- `session.stop/reset/delete/handoff` 调用 `drainScope`。
- Gateway close 增加 supervisor/registry 全量 shutdown；重启后 `reconcile()` 对 running 行做 OS liveness 判断，不 replay，不静默保留。

---

## 8. 控制面 API 分层

### 8.1 Runtime Gateway RPC（新增/扩展）

```
sessions.create / sessions.stop / sessions.pause / sessions.resume
sessions.fork              # 已有，接入 transition
sessions.handoff.prepare / sessions.handoff.commit
sessions.goal.get / sessions.goal.put / sessions.goal.clear
sessions.resources.list / sessions.resources.kill
session.activitySnapshot   # 扩展：processes[] + goal + lineage
```

- 保留 `chat.abort`、`sessions.abort`、`sessions.send/steer` 作为底层原语。
- `sessions.pause/resume` 是 SLCP 语义，不伪造“冻结模型推理”。

### 8.2 Electron Host API

```
hostApi.sessions.stop/pause/resume/handoff/goal/resources
hostApi.terminal.closeForSession
```

- 全部经 Main → Gateway，renderer 不直接访问 Gateway HTTP。
- 资源 kill 需要 approval 语义：桌面 workspace 命令沿用 permission 流程；runtime 进程 kill 复用 exec/process 审批边界。

### 8.3 模型工具

- `session_status` 扩展输出：
  - current run
  - goal
  - owned resources（terminals/processes/subagents）
  - lineage
- 新增 `session_control`（或拆成 `sessions_create/sessions_pause/sessions_resume/sessions_handoff`），受 `tools.sessions` / agent-to-agent / sandbox visibility 约束。
- goal 工具扩展：
  - `update_goal` 继续只允许 `complete|blocked`
  - 新增 `goal_handoff`（把 goal 交给子会话）
  - pause/resume/clear 仍为 operator 权限，不默认给模型

### 8.4 Renderer

- 一个 `Session Control Center`：
  - 状态行：聚合状态 / goal / lineage / resources
  - 动作：pause / resume / stop / new / fork / handoff
  - Resource Center：列出 terminals/processes/subagents，支持 kill/close
- 现有 SessionActivityPanel 作为只读快照保留，Resource Center 作为可操作投影。

---

## 9. 事件模型

新增事件流（沿用 Gateway → Main → renderer 现有通道）：

| 事件 | 关键字段 |
|---|---|
| `session.lifecycle` | transition, from, to, sessionKey, intentId |
| `session.goal.changed` | sessionKey, goal, source |
| `session.lineage.changed` | parent, child, relation |
| `session.resource.changed` | resourceId, kind, status, ownerSessionKey |

规则：
- 事件只做 projection，不承载回滚决策。
- 乱序事件按 `revision + ts` 丢弃旧值（沿用 session-activity 的单调 guard）。

---

## 10. 迁移路径（分阶段，每阶段可独立验证）

### Phase A：先堵泄漏（不改产品语义）
1. Desktop：`closeForSession` + 新会话/删除路径接线。
2. Runtime：`bash-process-registry.cancelScope()`；`ensureSessionRuntimeCleanup()` 调用 supervisor/registry drain。
3. `/stop` 和 `chat.abort` 增加显式 session-stop 语义（普通 run abort 保留原语义）。
4. 回归测试：session 切换/删除后 PTY 与进程 registry 均归零。

### Phase B：Resource Ledger 与重启对账
1. 新增 `session_resources` + `session_transitions` 表。
2. 让 supervisor/bash registry 变成 ledger 的热缓存。
3. Gateway close drain；启动 reconcile running → `lost`。
4. 进程记录含 pid/startedAt/owner/lease，不落盘完整 command 文本。

### Phase C：SLCP RPC + UI + 模型工具
1. Gateway `sessions.stop/pause/resume/handoff/goal/resources`。
2. Electron host-api + renderer Control Center。
3. `session_status` 扩展；`session_control` 模型工具（受策略约束）。
4. SessionActivity 纳入 goal + process resources。

### Phase D：Fork/Handoff 闭环
1. `sessions.handoff.prepare/commit` 接入现有 `prepareHandoff`。
2. Goal fork/handoff 规则落地，`continuationTurns` 真正递增。
3. 子 agent 进程 owner 链 + 递归 drain。

### Phase E：与目标架构收敛
1. Flow 生命周期逐步切到 TaskFlow/TaskRegistry（RC-06A cutover）。
2. 进程生命周期逐步切到 VerseShell governed owner（保持现有 product locks，不提前 default-on）。
3. 删除旧内存注册表的权威语义，只留热缓存。

---

## 11. 不做的事（非目标）

- 不重写 session store/transcript 格式。
- 不建第二个 workflow 权威。
- 不让 renderer 直接操作 OS 进程。
- 不做“真暂停模型推理”的伪能力；pause=gate+checkpoint+abort，resume=checkpoint 续跑。
- 不自动迁移历史 running 进程；旧进程只能显式 kill 或标 lost。
- 不在当前阶段 flip VerseShell/UAS-06 产品锁。

---

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 清理顺序错误造成半死资源 | 所有 terminal transition 只写状态机，drain 失败标 `lost`，提供 reconcile |
| PID 复用误杀 | ledger 记录 pid+startedAt+command digest；kill 前做 OS liveness 校验；Windows 走 Job Object/进程树 |
| 语义回归：后台进程本应存活 | `cleanupPolicy` 显式化，只有 session stop/delete/handoff 触发 kill；run abort 不触发 |
| 模型滥用 pause/fork | 新工具走 session visibility + A2A + approval；pause/resume 默认 operator-only |
| 桌面与 runtime 双权威 | 终端归 Electron，进程归 runtime；`session_resources` 只存投影/引用，不互相写 |
| SQLite 写入变热路径 | spawn 注册用同步 immediate transaction；高频 stdout 不写库，只更新内存缓存和低频 heartbeat |

---

## 13. 验收锚点（草案）

1. 单元：transition 幂等/冲突、资源 drain 顺序、fork/handoff lineage 防环、goal fork/handoff、restart reconcile。
2. 集成：真实 Gateway 下 session stop/delete 后无残留 child process；子 agent cascade 时其 exec 进程被杀。
3. E2E：新对话旧 PTY 关闭；Control Center kill 后台进程；fork/handoff 后 lineage 与 goal 正确。
4. 内存/资源：循环 50 次 create/stop 后 `session_resources` 与进程缓存不增长；RSS 有界。
5. 回归：`comms:replay/compare`、`pnpm test`、typecheck、harness validate 全绿。

---

## 14. 建议落地文件边界

- Runtime：
  - `src/sessions/session-lifecycle-control-plane/`（orchestrator / intents / admission / drain）
  - `src/sessions/session-resource-ledger.ts`（SQLite store + reconcile）
  - 扩展 `src/gateway/server-methods/sessions.lifecycle.ts`、`sessions.run-control.ts`、`session-activity.ts`
- Electron：
  - `electron/services/session-control-api.ts`
  - 扩展 `terminal-session-manager.ts`、`workspaces-api.ts`、`sessions-api.ts`
- Shared：
  - 扩展 `shared/host-api/contract.ts`、`shared/types/session-activity.ts`、`shared/chat/types.ts`
- UI：
  - `src/pages/Chat/SessionControlCenter.tsx`、`src/stores/session-control.ts`
