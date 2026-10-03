# 会话生命周期治理设计（v3，第三次碰撞后收敛版）

> 状态：Phase 2 已实现（delete operation journal + Electron mirror gate + terminal lifecycle）；Phase 3 已实现（same-gateway goal wake loop）；Phase 4 已实现（durable helper 文件协议、ProcessRunReconciler、ownerEpoch、runDir 配额/redaction/清理、Windows detached helper 实测）；Phase 5 已实现（SessionActivity read model 的 goal/process/lineage 投影与 Electron/renderer 只读 UI）。
> 日期：2026-08-16
> v3 变化：引入原子 SessionAdmissionRegistry；delete 改为 per-agent SQLite 的 generation-aware operation journal；drainScope 改为 owner wait + OS containment 双条件。

---

## 1. 最终方向

1. 生命周期命令保持命令式、幂等。
2. 所有副作用入口先拿 admission permit；reset/delete 用原子 fence 关闭入口。
3. `cleanupSessionBeforeMutation` 是唯一 canonical finalizer。
4. 资源所有权留在各 owner，不建通用资源事实表。
5. `SessionActivity` 只做跨 owner 读模型，补 goal / process / lineage 投影。
6. 跨 owner 变更写 append-only operation journal，不承载业务状态。

---

## 2. 已撤回项

| 撤回项 | 原因 | 关键证据 |
|---|---|---|
| SessionDesiredState + SessionReconciler | 与现有生命周期投影/持久写入成为第二写入者 | `openclaw_runtime/src/gateway/session-lifecycle-state.ts:123` |
| session_runs / session_resources 通用账本 | 账本既权威又投影，自相矛盾 | v1/v2 碰撞记录 |
| pause/resume 承诺 checkpoint 续跑 | 普通 Chat 不进 long-task checkpoint；恢复不覆盖 runtime 状态 | `openclaw_runtime/src/gateway/server-methods/chat.ts:3401-3423` |
| Handoff 自动转移 Goal / drain 源资源 | Handoff 是只读接力稿 | `docs/clawx-design-overview.md:861` |
| continuationTurns 新语义 | 字段从未递增，无 schema 支撑 | `openclaw_runtime/src/config/sessions/types.ts:211` |
| idleTtl / workspace cap 拍数字 | 无真实 idle 信号、无容量证据 | `electron/services/terminal-session-manager.ts:63,96-99,231-237` |
| runtime delete 后本地 sweep 兜底 | runtime 失败时 sweep = 篡改 canonical 数据；成功后再 sweep = not-found | `openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts:816-846`、`electron/services/sessions-api.ts:958-1004` |

---

## 3. Admission gate

### 3.1 进程级 SessionAdmissionRegistry

- 新模块 `src/sessions/session-admission-registry.ts`，复用 `ReplyRunRegistry` 的 global-singleton 结构，不塞进后者。
- 身份 = `agentId + canonicalSessionKey + expectedSessionId`；只用 key 会把 reset 前后两代会话混为一谈。
- API：
  - `acquirePermit(identity, kind)`：所有副作用入口调用；
  - `fence(identity)`：原子关闭入口，等待已进入的 admission 临界区结束，返回独占 fence token；
  - `isFenced(identity)` / `removeFence(identity)`。
- Fence 不是 `isFenced()` 布尔检查；单纯检查后 spawn 有 TOCTOU。
- Delete 成功后保留 tombstone：同一 key 只有显式 create 才能开新代，否则 queue drain 的 synthetic `chat.send` 会再次进入。

### 3.2 必须拿 permit 的入口

- `chat.send`：canonicalize 后、任何 enqueue/steer/ack 前；当前 enqueue/steer 早于 abort-controller 登记。
- `admitReplyTurn` 和 `runEmbeddedAgent` 直接调用路径。
- `sessions_send` 的直接 queue 路径。
- subagent / ACP 实际启动前登记 owner（当前 ACP 先 spawn 后 register）。
- Native supervisor / VerseShell / Electron terminal 各自最低 spawn 边界。
- Electron 用同一 `operationId` 驱动本地 mirror gate，至少拦 `terminal.open`；RPC outcome unknown 不解 fence，重启后从 durable operation 状态恢复。

### 3.3 生命周期身份

- 生命周期 owner identity 用 `agentId + canonicalSessionKey + expectedSessionId`。
- 不用 `scopeKey`：它允许显式覆盖、允许 sessionId/agent 退化，CLI 还有独立 key 空间。
- drain 覆盖 `key / canonicalKey / storeKeys / sessionId`，但任何覆盖都不得退化成 agent-wide kill。

---

## 4. 清理路径

### 4.1 顺序

```
fence(identity)
 -> clear queues / system events
 -> abort parent run
 -> recursive abort children
 -> waitForEmbeddedAgentRunEnd(timeout)
 -> drainScope(identity, timeout)   // 失败 => 拒绝 mutation
 -> other owners: MCP / ACP / browser / plugin host
 -> mutation
```

- `cancelScope` 只是 kill 原语，不是 drain；它返回 void，不等结果。
- `stopSubagentsForRequester` 只发 abort 并递归，不等待 child run 结束。

### 4.2 drainScope 成功条件

1. fence 已关闭；
2. 按 owner identity 快照 handles；
3. 对所有 handle 发 cancel；
4. 等全部 owner handle 完成（`ManagedRun.wait()` / VerseShell `wait()` / durable helper `exit.json`）；
5. 证实 OS containment 为空（Windows Job Object；Linux process group/cgroup；durable helper 的 started.helperPid/childPid 一并纳入 containment snapshot）；
6. 取消并 reap durable helper（control.json nonce+ownerEpoch 校验 -> 等 exit -> 终态 task/flow -> 删 runDir），未 settle 则拒绝 mutation；
7. 再次确认 owner registry 没有新记录。

任一 wait、树存活检查或身份确认 timeout/unknown => mutation 拒绝。

- 裸 root PID 检查不合格：父 PID 消失不代表 descendants 消失，PID 可能复用；现有 pid-alive 只有 Linux 有 OS starttime 支撑。
- child/PTY adapter 在收不到退出事件时 4 秒人工 settle，`wait()` resolve 不能证明进程树死。

---

## 5. Delete 协议

### 5.1 Authority 前提（v3 修正）

- canonical session store 是 per-agent SQLite `cache_entries`（`scope=session`），不是 `sessions.json`。
- `loadSqliteSessionStore` 读 `cache_entries`；`replaceSqliteSessionStore` 在同库 immediate transaction 写。
- runtime 是 per-agent SQLite session store 唯一写入者。

### 5.2 Operation journal 契约

- Electron 在首次 RPC 前生成并持久化 `operationId`，随每次 retry 发送。
- Immutable manifest：版本、操作类型、agent/store identity、canonical key、`expectedSessionId`、`deleteTranscript`、确定性 archive plan。
- 幂等：
  - 同一 `operationId` + 相同 manifest digest => 返回已有结果；
  - 同 ID 不同 digest => conflict。
  - 复用 `ApprovalLedger` 的 digest 和冲突语义，不复用 ReceiptStore 当 delete authority。
- 提交事务：`cache_entries` 删除 + `store_committed` journal event 在同一个 per-agent SQLite immediate transaction。
- Retry 顺序：先按 `operationId` 查 journal，再查 session。
  - `intent` => 继续；
  - `store_committed` => 不重复删 row，只继续 finalizer；
  - `runtime_committed` => 返回保存的 receipt；
  - generation 不同 => conflict。
- Archive destination 必须预存在 manifest 或由 `operationId` 确定；不能每次现取时间戳，否则 retry 无法判断“已归档”还是“原文件丢失”。逐文件失败不得吞掉。

### 5.3 Electron 行为

- 只有 `runtime_committed` success 才关闭 terminal、按 receipt 清理 Electron-owned artifacts。
- `runtime_committed` 但本地清理失败 => `partial_committed`，按 operation journal 重跑未完成步骤；terminal close 是 no-op，sweep 容忍 ENOENT。
- runtime 失败或 RPC outcome unknown => 不 sweep，不解 fence。
- 离线强删 = 显式 recovery 命令，先证明 gateway 已停止。

---

## 6. 终端策略

- 默认 `keep_on_leave`。
- 关闭只在：显式 End/close、session reset/delete、权限收紧、workspace switch/delete、app quit。
- `idleTtlMs = 0`：当前没有真实 idle 信号。
- `workspace cap = null`：无容量证据不编数字；将来只允许 admission rejection。
- 全局可见复用 `terminal.list({})`；只修 service 层未传 `workspaceId` 时强行补 active workspace。

---

## 7. Goal / Handoff / Fork

### 7.1 Phase 3 goal wake（已实现，default-off）

- Arm 事务：`task_runs(queued,runtime=process)` + `flow_runs(waiting,controller_id=goal-wake)` + `mission_runs(sleeping,activeWaitFlowIds)` 在同一个 per-agent SQLite immediate transaction；提交成功后才 spawn，并立即 level-check。
- Turn barrier：flow `wait_json.turnBarrier` 先为 `pending`，embedded run 完全 idle 并持有 `goal-wake-ack` admission permit 后才持久化 `acked`；ack 前 dispatcher 不投递 continuation。
- `goal_wait` 只允许 mission owner/lead top-level turn，mission/session/tick 从运行上下文绑定；P0 单 process 依赖，continuation 固定 `mission_tick`。
- `exec(background=true, wait="goal")` default-off：arm -> spawn -> yield；spawn 结果 unknown 写 `lost`，绝不自动重放命令。
- 进程退出只 finalize `task_runs`；level-check 先 `waiting->running` 再投递 mission tick；effect owner 用 `last_wake_id + revision` 去重，重复 wake 不重复 tick/副作用。

### 7.2 Phase 4 durable helper（已实现，default-off）

- runDir 协议：`<trusted-root>/background-processes/<runId>/`，`intent.json -> started.json -> exit.json`；`control.json` 只承载 cancel，不覆盖 `exit.json`；另有 bounded `heartbeat.json` / `tail.txt` / `stdout.log`。
- `intent.json` 只存 protocolVersion/runId/nonce/commandDigest/policyRevision/ownerEpoch/createdAt；raw argv/cwd/env/命令原文/密钥永不落盘。
- 同一 Gateway 路径在 `runtime.mission.goalWake.durableHelper.enabled=true` 时升级为真实 detached helper；默认关闭，Phase 3 路径字节不变。
- `ProcessRunReconciler` 启动 + 低频 sweep level-triggered 对账：`intent` 无 `started` 且无存活 helper => `lost`，绝不自动重启/重放 spawn；`exit.json` 是终态第一真相；恢复顺序 task terminal -> flow level-check -> mission tick effect-owner 去重。
- session reset/delete 通过 `cleanupSessionBeforeMutation -> drainScope` 取消 helper（nonce+ownerEpoch 校验）→ 等 exit → task/flow terminal → 删 runDir → 再 mutation；新 session generation 不 adopt 旧 wait/helper。
- 配额：每 session maxRunsPerSession=4、maxOutputBytesPerRun=10MB、runTtlMs=24h、sweepIntervalMs=60s；超限转 `needs_cleanup`，不清空 task/flow 真相。
- Windows detached spawn 已由 `goal-wake-helper-host.test.ts` 真实子进程证明；packaged Electron 复用当前 entry/loader + `ELECTRON_RUN_AS_NODE`，无法解析 helper entry 时 fail-closed 并写 lost。

### 7.3 Phase 5 SessionActivity read model（已实现）

- `session.activitySnapshot` 在保留原 `session/tasks/subagents/terminals/continuity/availability` 形状不变的前提下，附加 `goals/processes/lineage` 三个只读数组。
- 数据来源：`mission_runs`（只读查询）、`flow_runs(controller_id=goal-wake)` / `task_runs(runtime=process)`（只读 SQL 查询）、bash process registry 的 running/finished snapshot、supervisor 新只读 `snapshotRunsForSession`、subagent lineage 只读查询。
- 投影只输出 `id/label/status/phase/progress/pid/digest/updatedAt`；objective、raw command、argv、cwd、env、error 原文不进 snapshot。任何来源缺失/空数组/已终态都稳定返回空或终态投影，不写任何 owner 状态。
- Electron `session-activity-api.ts` 只做 Gateway RPC 结果转发与类型化聚合；renderer store 只消费 snapshot，panel 用现有 `globals.css` design token 渲染 goal/process/lineage，不新增取消/恢复/删除按钮。
- `snapshotRunsForSession` 是 supervisor 的只读 metadata snapshot，不暴露 cancel/wait 能力，不参与 drain。

- Handoff 保持只读 continuity artifact；源 session、源 goal 不变。
- Fork 只承诺 transcript/workspace/模型偏好继承；goal 转移是待产品决策。

---

## 8. 接口最小集

Runtime：
- `sessions.delete/reset`：接入 admission fence + operation journal + drainScope。
- `sessions.stop`：复用 4.1 前段，不做 mutation。
- `session.activitySnapshot`：已补 goal / processes / lineage（只读投影，无写路径）。
- delete schema：新增 `operationId`、`expectedSessionId`。

Electron：
- `terminal.closeForSession`
- `sessionActivity.snapshot` 扩展（只转发与类型化聚合）
- delete 调用方持持久化 `operationId`

---

## 9. 边界

- 不建 `session_desired_state` / `session_runs` / `session_resources`。
- native supervisor 重启无法重新拥有 => 标 `lost`；VerseShell 启用后由其 durable lifecycle 接管。
- 产品锁不变：VerseShell default-off、liveReady=false、productApproved=false。
