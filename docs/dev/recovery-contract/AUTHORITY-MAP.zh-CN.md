# Recovery Authority 五入口映射（TF-0713）

> 2026-11-05源码复核：main-session已增加持久化run identity、边界digest和失败尝试预算；工具相位已收口到TaskFlow CAS，unknown进入quarantine。RecoveryAuthority仍只读shadow、其余四owner尚未接入。下文路径/行号与缺口表保留原研究commit的基线；当前15个源码锚点和差异见 [最终报告](FINAL-20261105.zh-CN.md) 与最终包source-audit.json。

> 状态：研究 + 契约冻结；`driven_by: agent`，`actor: recovery-authority-agent`。  
> 基线：`main@99c142fef`。  
> 本文件只做源码映射、契约判断和收口建议，**不改变任何生产行为、默认值、产品锁或运行时开关**。  
> 行号均来自当前工作树同一提交；若后续源码移动，以符号名为准并重新核对行号。

## 0. 先给结论

1. 当前有五个彼此独立的恢复入口，分别拥有自己的“权威状态”和重试语义：主会话重启、子代理孤儿恢复、goal-wake/durable helper、最终投递、ACP runtime resume。
2. **“理念相似”不等于“代码已实现”，更不等于“恢复保证”。** 当前没有任何一个入口同时具备：稳定恢复幂等键、持久化尝试预算、效果确定性（effect certainty）、原子化“决定 + 状态 + 预算”提交。因此五个入口都只能算“局部代码已实现”，不能整体宣称“恢复保证”。
3. `effect-receipt.ts` 明确写着 receipt 只解释/关联领域日志，**永不授权 replay**（`openclaw_runtime/src/agents/effect-receipt.ts:1-13,311-316`）。
4. `replay-rollback-authority.ts` 的 event-log replay 变体仍是 `@unimplemented`；生产路径只传 legacy checkpoint，pilot gate 固定关闭（`openclaw_runtime/src/agents/replay-rollback-authority.ts:49-58,144-158`；`openclaw_runtime/src/agents/mission-control/controller.ts:1474-1535`）。当前唯一 rollback 开关是 `runtime.mission.rollback.enabled`，默认 false（`openclaw_runtime/src/config/types.openclaw.ts:287-293`）。
5. Runtime event log 的四个 flag 全部默认 false，模块自述为 built-but-unwired；event log 只能作为证据/诊断，不得作为恢复权威（`openclaw_runtime/src/runtime-core/event-log.ts:18-40,55-60`）。

### 0.1 契约层量化收益（不是运行时性能收益）

- 入口数：**5 → 1 个 `RecoveryAuthority` 决策面**；入口适配器只提供事实，不再各自解释“是否重试”。
- 重试语义：**4 套重试策略 + 1 条无重试路径 → 1 个 `RecoveryBudget`**（attempts / backoff / wedge）。
- 证据层级：**3 类 evidence-only 来源**（event-log、effect-receipt、transcript）与 **1 类 effect-truth 来源**（domain journal）被类型和校验器强制分开。
- 必须行为变更点：**9 个**（见 §4）；只读可聚合点：**9 个**（见 §4）。
- 本节点能兑现的收益是“决策与验收口径统一、错误恢复不可再各自发明重试上限”；**不能**把本节点写成运行时恢复提速或恢复成功率提升，因为尚未接线、未做故障注入。

## 1. 判读口径

| 口径 | 含义 | 本节点是否算 |
|---|---|---|
| 理念相似 | 命名、注释或设计文档表达了恢复/重放/幂等概念 | 只记录，不作为实现证据 |
| 代码已实现 | 有真实调用链、状态读写、测试或明确入口 | 可以勾选“已实现” |
| 恢复保证 | 跨进程/重启边界有持久化提交、稳定幂等、效果确定性和失败终态证据 | 当前五入口均未完整达到 |

本节点只冻结契约，不把任何“代码已实现”升级成“恢复保证”。

## 2. 五入口映射表

| # | 入口 | 触发条件 | 权威状态来源 | 重试上限 / 退避 | 终态 | 当前缺口 | 建议归属 | 收口分类 |
|---|---|---|---|---|---|---|---|---|
| 1 | 主会话重启恢复（main session restart） | gateway reload 标记活跃主会话；启动时清理 stale transcript lock 后标记；post-ready sidecar 调度扫描 | `SessionEntry.status/abortedLastRun/pendingFinalDelivery*` + transcript tail（只读准入证据） | 默认 5s 后首次；常数 `MAX_RECOVERY_RETRIES=3`、×2；实际调度调用 3 次（attempt 1..3） | 成功：`abortedLastRun=false`，session 仍为 running，交给新 run；不可恢复 tail：notice + `status=failed` 并清 pending 字段；调用失败：running/aborted=true 保留重试 | 每次 resume 用 `crypto.randomUUID()`，无稳定恢复幂等键；attempt 不持久；gateway 已接受但本地未落库时可能重复；pending 字段可能被丢弃 | `RecoveryAuthority` + main-session owner adapter；session store 仍是唯一状态源，不新增库 | `R+M` |
| 2 | 子代理孤儿恢复（subagent orphan） | gateway restart 后，subagent registry 仍有 active run，且 session entry `abortedLastRun=true` | 内存 `subagentRuns` registry + `SessionEntry.subagentRecovery` | 每 session 每 2 分钟最多 2 次“已接受”的快速 resume；调度默认 5s、`maxRetries=3`、×2（初始 attempt 0，最多 4 次调用） | 成功：清 `abortedLastRun` 并记 `automaticAttempts`；失败：保留 aborted=true；gate 超限：`wedgedAt` 墓碑；最终调度失败：`finalizeInterruptedSubagentRun` 终态 | 失败尝试不写入 `subagentRecovery`，跨重启可无限重来；`resumedSessionKeys` 只在内存；resume idempotency 也是 random UUID；remap 失败被当作 accepted 的启发式；gate 2 次与 scheduler 4 次语义不一致 | `RecoveryAuthority` + subagent-registry owner adapter；扩展现有 `subagentRecovery`，不新增 DB | `R+M` |
| 3 | Goal-wake / durable helper | 启动或低频 sweep：`task_runs` 中 queued/running 的 process run，或 helper runDir 存在 `intent.json`；goal-wake 开启时同一 sweep 还执行 deadline 过期 | SQLite `task_runs` + `flow_runs`/`mission_runs`（arm 时原子提交）+ helper `intent.json → started.json → exit.json`；event-log 只诊断 | 无 per-run 恢复重试；sweep 默认 60s、runDir TTL 默认 24h、每 session 最多 4 个 run；tick failure backoff 默认 5s | task status：`succeeded/failed/timed_out/cancelled/lost/needs_cleanup`；intent 无 started 且 helper 不存活 → `lost`，明确不 replay spawn | 没有 per-run attempt budget/wedge；`finalizeTask*` 与 `runGoalWakeLevelCheckForTask` 不在同一事务；`task_runs` 与 helper files 双源只有 level-trigger reconcile | `RecoveryAuthority` 只做 read/reconcile 投影；goal-wake/task_runs 仍是 owner；保持 arm 的 SQLite 原子事务 | `R`（可先聚合；决策记录需 `M`） |
| 4 | 最终投递（pending final delivery） | agent 结果 `deliver=true` 时先在 session entry 写 pending 字段，再调用一次 durable message batch；重启恢复把 pending text 作为恢复提示注入下一轮 | `SessionEntry.pendingFinalDelivery*` + `AgentCommandDeliveryStatus` + durable message send context；message queue 是投递效果 owner | **无重试循环、无退避、无上限**；`sendDurableMessageBatch` 只调用一次；durability 仅 `required`/`best_effort` | `sent`/`suppressed` 成功后清 pending；`failed`/`partial_failed` 非 best-effort 直接抛错且 pending 保留；没有 abandoned/terminal 状态 | `pendingFinalDeliveryIntentId` 只在类型/加载层出现，没有写入方；调用点无稳定 delivery idempotency key；attemptCount 只在主恢复里 +1 且无 cap；非恢复 tail 或 heartbeat ack 可清掉 pending 文本 | `RecoveryAuthority` + delivery owner adapter；让现有 `pendingFinalDeliveryIntentId` 真正落库；不新增投递服务 | `R+M` |
| 5 | ACP runtime resume | ACP turn 在**没有产生任何输出前**因 acpx exit code/signal 或 persistent session 缺失失败 | `SessionAcpMeta.identity`（pending/active 等）+ runtime handle cache；`sawTurnOutput` 是硬门槛 | 最多 1 次 fresh-handle retry（总 2 次 attempt：0 和 1）；无退避；`attempt > 0` 或已见输出即不再重试 | 无 ACP 专属 recovery 终态：成功继续 turn；失败交给 backend failover/调用方错误；close 时 identity 重置为 pending、state=idle | attempt 只在 turn-runner 循环内，跨进程不持久；无 recovery decision 记录；无 effect certainty/receipt；identity 清理不等于效果已核对 | `RecoveryAuthority` + ACP manager adapter；`SessionAcpMeta` 仍是 truth；不新增 session store | `R+M` |

## 3. 逐入口证据与判读

### 3.1 主会话重启恢复

**触发**

- gateway reload 时收集活跃 main session，并调用 `markRestartAbortedMainSessions`：`openclaw_runtime/src/gateway/server-reload-handlers.ts:248-262`。
- 启动清理 stale transcript lock 后按 lock 标记：`openclaw_runtime/src/gateway/server-startup-post-attach.ts:495-499`；post-ready sidecar 调度恢复：同文件 `:973-981`。
- 扫描条件为 `status === "running"` 且 `abortedLastRun === true`：`openclaw_runtime/src/agents/main-session-restart-recovery.ts:484-493`。

**权威状态**

- `SessionEntry.abortedLastRun`、`SessionEntry.status`、pending final delivery 字段：`openclaw_runtime/src/config/sessions/types.ts:283-285,365-380`。
- transcript tail 只作为准入证据：读取最近 20 条/256KB（`main-session-restart-recovery.ts:496-507`），由纯边界判断 tail 是否可恢复（`main-session-restart-recovery-boundary.ts:45-53`）；`assistant.stopReason=aborted|toolUse` 才算可恢复，`stop` 不算（同文件 `:16-31`）。

**重试与终态**

- 常数：`DEFAULT_RECOVERY_DELAY_MS=5_000`、`MAX_RECOVERY_RETRIES=3`、`RETRY_BACKOFF_MULTIPLIER=2`（`main-session-restart-recovery.ts:39-41`）。
- 调度器 `attemptRecovery(1, initialDelay)`，只有 `attempt < maxRetries` 才继续（`:596-632`）；因此实际最多 3 次调用，不是“首次 + 3 次重试”的 4 次。这是一个**命名与语义偏差**，应在新契约中消除。
- 成功 resume 后只清 `abortedLastRun`，session 仍是 `running`（`:378-408`）；这表示把生命周期交回新的 run，不是 recovery 终态。
- 不可恢复 tail：发送 best-effort notice，然后 `markSessionFailed` 把 `status` 置为 `failed`，并清空全部 pending final delivery 字段（`:216-245,514-529`）。
- resume 调用失败：保留 `status=running`/`abortedLastRun=true`，等待下一轮（`:415-418`；flow test `main-session-restart-recovery.flow.test.ts:78-89`）。

**关键缺口**

1. `idempotencyKey: crypto.randomUUID()`（`:354-360`）：如果 gateway 已经接受 agent 调用但进程在 session store 更新前崩溃，下一轮会生成新 key，可能重复恢复同一中断 turn。
2. 没有持久化 recovery attempt 计数/decision token；调度器的 attempt 只在内存。
3. 成功路径不记录“恢复 run id / 恢复决定”，无法从 session store 判断“这次恢复是由谁、以什么预算触发的”。
4. 不可恢复时清空 pending final delivery（`:232-239`）会让一个已冻结的用户可见回复永久丢失；应改成“保留 payload + 明确 terminal delivery decision”或显式丢弃证据。

### 3.2 子代理孤儿恢复

**触发**

- 只有 active subagent registry run + child session `abortedLastRun=true` 才进入：`openclaw_runtime/src/agents/subagent-orphan-recovery.ts:172-183,211-254`。
- registry 在重启后调用 `scheduleOrphanRecovery`：`openclaw_runtime/src/agents/subagent-registry.ts:293-310`；默认 delay 5s（`subagent-orphan-recovery.ts:40-41`）。

**权威状态与 gate**

- `SessionEntry.subagentRecovery`：`automaticAttempts/lastAttemptAt/lastRunId/wedgedAt/wedgedReason`（`openclaw_runtime/src/config/sessions/types.ts:155-166`）。
- gate：2 分钟窗口内最多 2 次快速 accepted resume（`subagent-recovery-state.ts:8-9,56-85`）；超限返回 `shouldMarkWedged` 并写墓碑（`subagent-orphan-recovery.ts:256-292`；`subagent-recovery-state.ts:101-121`）。

**重试与终态**

- scheduler 常数 `MAX_RECOVERY_RETRIES=3`、×2（`:396-399`），`attemptRecovery(0, initialDelay)`（`:418-475`）；实际最多 4 次调用，和 gate 的 2 次 accepted 限制是两套语义。
- 成功：清 `abortedLastRun`，写 `markSubagentRecoveryAttempt`（`:332-355`）。
- 失败：保留 `abortedLastRun=true`，日志说 next restart can retry（`:356-367`）。
- 最终失败：`finalizeInterruptedSubagentRun` 将 run 置终态（`:442-457`）。

**关键缺口**

1. **失败尝试不计数**：`markSubagentRecoveryAttempt` 只在 resume accepted 后调用（`:332-345`），`evaluateSubagentRecoveryGate` 读取的是 `automaticAttempts`（`subagent-recovery-state.ts:68-79`）。因此进程反复重启、每次 resume 都失败时，gate 不会增长。
2. `resumedSessionKeys` 是内存 Set（`:199,426`），跨进程丢失。
3. resume 的 `idempotencyKey` 是 random UUID（`:131-138`），同样没有跨重启稳定键。
4. `replaceSubagentRunAfterSteer` 返回 false 时直接 `resumed: true`（`:157-162`），这是“避免重复重启”的启发式，不是可审计的幂等结论。
5. 没有 tool effect 的 `ReplayClass`/`EffectCertainty`；resume message 可能让模型再次调用非幂等工具。

### 3.3 Goal-wake / durable helper

**触发与权威**

- sweep 同时列出 `task_runs(runtime=process, status in queued/running)` 和 helper runDir（`openclaw_runtime/src/agents/goal-wake-recovery.ts:267-281`）；service 在启动时先 `sweepOnce`，之后按 `sweepIntervalMs` 低频 sweep（`:360-375,446-455`）。
- task 是 goal-owned process run 的 truth（`task_runs`），helper 协议是 `intent.json → started.json → exit.json`；`reconcileDurableRun` 通过 `ProcessRunReconciler` 做进程/文件 level-check（`goal-wake-recovery.ts:196-258`）。
- arm 的原子提交是 `task_runs(queued) + flow_runs(waiting) + mission_runs(sleeping/activeWaitFlowIds)`（`openclaw_runtime/src/agents/goal-wake-arm.ts:64-75,216-230,306-319`）。
- `mission_runs` 的 revision/active_tick_id/last_wake_id fencing 是 effect-owner dedupe，但默认由 `RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED` 控制（`openclaw_runtime/src/agents/goal-wake-fencing.ts:1-6,64-70`）。

**重试与终态**

- 默认 sweep 60s、runDir TTL 24h、每 session 最多 4 run（`openclaw_runtime/src/agents/goal-wake-config.ts:27-34,98-134`）；tick failure backoff 默认 5s（`:58-78`）。
- 没有 per-run “最多 N 次自动恢复”的预算；它靠 level-trigger：helper 存活 → running；exit → terminal；intent 无 started 且 helper 不存活 → `lost`（`goal-wake-recovery.ts:47-49,160-187,237-245`）。
- `lost` 的 error 明确写 “Command was not replayed.”（`:180-182`）；这是当前最接近“恢复保证”的入口：它选择不 replay，而不是假装恢复。

**关键缺口**

1. 没有持久化的 “recovery decision” 记录；`finalizeTaskFromExit`/`finalizeTaskLost` 先写 task，再调 `runGoalWakeLevelCheckForTask`（`:221-244,237-245`），两步不在一个事务里。
2. `task_runs` 与 helper files 是双源；reconcile 是 level-trigger 的读判断，不是原子授权。
3. 没有 effect certainty；只根据 process exit/文件判断，工具是否产生外部副作用仍未知。
4. event-log 只适合作为证据；不能拿来升级成 “event-level 精确恢复已实现”。

### 3.4 最终投递（pending final delivery）

**触发与权威**

- `agent-command` 在 `deliver=true` 且非 subagent 时，把 payload sanitize 后写入 `pendingFinalDelivery: true/text/context/createdAt`，再调用 delivery（`openclaw_runtime/src/agents/agent-command.ts:2086-2124`）。
- 成功投递后清 pending（`agent-command.ts:2163-2187`）；heartbeat ack 也能清 pending（`openclaw_runtime/src/auto-reply/reply/get-reply.ts:518-558`）。
- delivery 只调用一次 `sendDurableMessageBatch`（`openclaw_runtime/src/agents/command/delivery.ts:711-733`）；durability 由 `bestEffortDeliver ? "best_effort" : "required"` 决定（`:718-724`）。
- `sendDurableMessageBatch` 只有一次 `ctx.send(rendered)`；成功 commit receipt，失败 fail（`openclaw_runtime/src/channels/message/send.ts:339-351`）。

**重试与终态**

- `deliverAgentCommandResult` 没有重试循环、没有退避、没有 attempt cap（`delivery.ts:426-428,711-733`）。
- `AgentCommandDeliveryStatus` 只有 `sent/suppressed/partial_failed/failed`（`:43-75,248-296`）；没有 “abandoned/terminal” 投递状态。
- 主会话重启恢复会把 pending text 作为下一轮提示注入（`main-session-restart-recovery.ts:344-347,531-537`），并在成功 resume 时把 `pendingFinalDeliveryAttemptCount` +1（`:388-394`）；但这是 resume 的副作用，不是投递重试器。

**关键缺口**

1. `pendingFinalDeliveryIntentId` 类型存在（`config/sessions/types.ts:375-376`），但没有写入方；durable send intent 与 session entry 没有真正关联。
2. 调用点没有稳定 delivery idempotency key；durable queue 的内部 intent 不是恢复决策的一部分。
3. 没有 retry budget/backoff/wedge；`pendingFinalDeliveryAttemptCount` 没有 cap 检查。
4. pending payload 在不可恢复 tail 路径被清空（`main-session-restart-recovery.ts:228-239`），或者 heartbeat ack 被清空（`get-reply.ts:518-558`），没有保留“未投递”证据的终态。

### 3.5 ACP runtime resume

**触发**

- 只对 recoverable acpx exit（`acpx exited with code ...` / signal）或 persistent session missing 生效（`openclaw_runtime/src/acp/control-plane/manager.runtime-resume-state.ts:15-26`）。
- turn-runner 的循环最多 2 次 attempt（`openclaw_runtime/src/acp/control-plane/manager.turn-runner.ts:156`），只有 `attempt === 0` 且 `sawTurnOutput === false` 才允许 fresh handle retry（`manager.runtime-resume-state.ts:29-42`；`manager.turn-runner.ts:315-336`）。

**权威状态**

- `SessionAcpMeta.identity` 的 `state: pending`、`acpxRecordId`、`source`、`lastUpdatedAt`；清理持久 resume identity 只保留 session shell（`manager.runtime-resume-state.ts:85-133`）。
- close 时 `discardPersistedManagerRuntimeState` 把 identity 置 pending、state 置 idle（`:135-176`）。
- `sawTurnOutput` 在 turn stream 中置 true（`manager.turn-runner.ts:175,240`），是“输出后不重试”的硬门。

**关键缺口**

- 没有持久化 recovery attempt 或 decision；`attempt` 只是循环变量，跨进程重置。
- 没有 effect certainty/receipt；`clearPersistedRuntimeResumeState` 只清 identity，不代表后端效果已核对。
- 没有与其它四个入口共享 admission/owner 语义；它只在 ACP manager 内部判断。

## 4. 只读可聚合 vs 必须行为变更

### 4.1 只读可聚合（可以先做统一视图，不改行为）

1. `SessionEntry.status/abortedLastRun`：`openclaw_runtime/src/config/sessions/types.ts:283-285`。
2. `SessionEntry.subagentRecovery`：同文件 `:155-166,285`。
3. `SessionEntry.pendingFinalDelivery*`：同文件 `:365-380`。
4. `task_runs` / `flow_runs` / `mission_runs` 的 status/revision：`goal-wake-recovery.ts:51-73,125-187`；`goal-wake-arm.ts:64-75`。
5. durable helper 的 `intent.json/started.json/exit.json`：`goal-wake-recovery.ts:196-258`。
6. ACP `SessionAcpMeta.identity`：`manager.runtime-resume-state.ts:85-133`。
7. `effect_receipts` 行：`effect-receipt.ts:311-379`。
8. Runtime event log：`runtime-core/event-log.ts:18-40,55-60`。
9. transcript tail 的准入判断：`main-session-restart-recovery-boundary.ts:45-53`。

这些来源可以做 `RecoveryAuthority` 的只读快照/诊断视图，**不需要新增 DB、服务或事件存储**。统一视图只能回答“现在有哪些状态”，不能单独回答“效果是否已应用”。

### 4.2 必须行为变更（要真正形成恢复保证）

| # | 变更 | 现有证据 | 目的 |
|---|---|---|---|
| M1 | main resume 使用稳定 recovery idempotency key，并持久化 attempt/decision | `main-session-restart-recovery.ts:354-360` | 防 gateway 已接受但本地崩溃后的重复恢复 |
| M2 | main 的 owner 状态 + budget + decision 原子提交；失败时保留 pending payload 的明确终态 | `main-session-restart-recovery.ts:216-245,378-408` | 让“恢复成功/失败/放弃”可审计，不丢用户可见回复 |
| M3 | subagent 持久化**失败**尝试，并统一 gate 与 scheduler 的 attempt 语义 | `subagent-recovery-state.ts:56-99`；`subagent-orphan-recovery.ts:396-475` | 防跨重启无限重试 |
| M4 | subagent resume 使用稳定 resume token；remap false 不得直接冒充 accepted | `subagent-orphan-recovery.ts:131-162` | 让 accepted 有可验证的 run 归属 |
| M5 | delivery 写入 `pendingFinalDeliveryIntentId`，增加 attempt cap/backoff/terminal | `config/sessions/types.ts:375-376`；`delivery.ts:711-733` | 让最终投递有 durable intent 与真正终态 |
| M6 | delivery 保留 pending payload 的证据链，不因不可恢复 tail/heartbeat ack 静默丢弃 | `main-session-restart-recovery.ts:228-239`；`get-reply.ts:518-558` | 避免“恢复”变成“丢失” |
| M7 | ACP 持久化 recovery attempt/decision（至少 session meta 或现有 session store 扩展） | `manager.runtime-resume-state.ts:29-42`；`manager.turn-runner.ts:156` | 让 1 次 retry 跨重启仍可审计 |
| M8 | goal-wake 的 task terminal 与 flow level-check 之间补 decision/幂等记录（不新增事件库） | `goal-wake-recovery.ts:221-244` | 消除 task 已终态但 flow 未推进的 crash window |
| M9 | 跨入口 effect certainty 分类：先读 domain journal，再决定 resume/replay/reconcile | `effect-receipt.ts:58-71,311-316` | 统一“未知效果必须 reconcile”的底线 |

“M”不等于本节点实施；本节点只冻结契约，后续节点按 M1–M9 分别接线。

## 5. 横向权威层：receipt、event-log、rollback

### 5.1 EffectReceipt 只能做证据

- 文件头三行写明：解释/关联领域 journal 结果，“it never authorizes replay”，domain journals 仍是 effect/idempotency truth（`openclaw_runtime/src/agents/effect-receipt.ts:1-13`）。
- `outcome` 枚举 `applied/not_applied/unknown/reconciled`（`:58-71），与 `RecoveryAuthority` 的 `EffectCertainty` 对齐。
- store 是 append-only，同 idempotency key 同内容=duplicate，不同内容=content-conflict（`:311-361`）。
- **结论**：Receipt 可以用于 `Reconcile` 和审计，不能单独作为 `Replay` 授权；本节点测试 `recovery-authority-contract.test.ts` 已把这条写成不变量。

### 5.2 Event log 只能做证据

- `runtime-core/event-log.ts:18-40` 明确写出 built-but-unwired；`DEFAULT_RUNTIME_EVENT_LOG_FEATURE_FLAGS` 四项全 false（`:55-60`）。
- `checkpoint-rollback-executor.ts` 对 `replayEventLog` 返回 `event_log_replay_not_implemented`；`ReplayRollbackTarget` 的 `event_log` 变体标注 `@unimplemented`（`replay-rollback-authority.ts:49-58`）。
- **结论**：event log 只能进 `RecoveryEvidenceRef(kind="event-log", role="evidence")`；它不能出现在 `effect-truth` 角色，也不能单独触发 replay。

### 5.3 Replay/rollback 的单开关

- `runtime.mission.rollback.enabled` 是当前 A3 checkpoint rollback 的唯一配置开关，默认 false（`openclaw_runtime/src/config/types.openclaw.ts:287-293`）。
- Mission Control 只有在 `rollbackEnabled && deps.rollback` 时才调用 `executeReplayRollback`（`mission-control/controller.ts:1474-1535`）。
- 生产调用点只传 legacy checkpoint target，pilot gate 传 `{ enabled:false }`（`gateway/server-methods/sessions.run-control.ts:568-612`；`mission-control/controller.ts:1497-1506`）。
- `executeReplayRollback` 的 event-log 分支即使被调用也要求 pilot gate；pilot 关闭时返回 `pilot_gate_disabled_with_no_checkpoint`，不会自动升级（`replay-rollback-authority.ts:144-158`）。
- **结论**：统一收口层不得新增第二个 rollback 开关；只能读取/转发现有 `runtime.mission.rollback.enabled`，event-log replay 永远不是默认路径。

## 6. 统一收口层的明确看法

### 6.1 应该是什么

`RecoveryAuthority` 是一个**纯决策层**，不是第六个恢复器，也不是新数据库：

- 输入：`RecoveryAuthorityRequest`（owner、admission、budget、replayClass、effect、evidence）。
- 输出：`RecoveryDecision`（单一决定 + 原因 + attempt + 依据）。
- 状态：仍然留在现有 owner（session store、subagent registry、task_runs/flow_runs、ACP meta、delivery state）。
- 证据：event-log/effect-receipt/transcript 只能作为 evidence；domain journal 才能作为 effect-truth。
- 默认：`default legacy`。统一层未接线时，五个入口完全保持现状；不改变任何默认开关。

### 6.2 不应该是什么

- 不应新建 `session_resources`、`RecoveryStore`、`RecoveryEventLog`、`RecoveryScheduler` 或第二个 workflow engine。
- 不应把 event-log 升级成权威存储；现有规则已明确它 diagnostic-only（`harness/specs/rules/runtime-authority-convergence-boundary.md`）。
- 不应让 receipt 授权 replay；receipt 是 correlation evidence，domain journal 是 effect/idempotency truth。
- 不应把“自动恢复”写成“恢复保证”；没有 effect certainty + durable decision 的恢复只能叫 best-effort。

### 6.3 推荐的落地顺序

1. **先只读投影**：用现有五入口的 status/attempt/pending 字段构造 `RecoveryAuthoritySnapshot` 诊断，不改行为。
2. **先冻结请求/决定类型**：本节点完成；所有入口适配器只能填 `RecoveryAuthorityRequest`，不能自定义 retry 语义。
3. **按 M1–M9 逐个接线**：每个入口一次，先做 owner 状态 + budget 的原子提交，再做 delivery/ACP 的 intent 持久化。
4. **最后才评估 rollback**：保持 `runtime.mission.rollback.enabled` 单开关，event-log replay 仍为 evidence/diagnostic；没有真实 crash/restore 证据不打开 pilot。

## 7. 本节点没有做什么

- 没有修改任何生产代码路径、默认开关、产品锁或配置默认值。
- 没有新增 DB、服务、事件存储、队列或网络协议。
- 没有做长对话稳定性、真实重启注入或恢复后全面回归；这些属于后续独立节点。
- 没有声称真人证据；本文件与测试均为 agent 驱动产物。
