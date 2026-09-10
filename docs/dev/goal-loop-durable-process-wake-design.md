# Goal/Loop 切换与耐久后台进程续跑设计（v2，可转实现规格）

> 状态：Design source；已并入 Runtime Lifecycle Governance。执行以 `harness/specs/tasks/runtime-lifecycle-governance.md` 和 `harness/specs/rules/runtime-lifecycle-governance-boundary.md` 为权威。Phase 0-3 已交付；Phase 4 durable helper / restart recovery 已交付（`artifacts/runtime-lifecycle-governance/audit-4.json`）。
> 日期：2026-08-16
> 上游：`docs/dev/mission-goal-durable-scheduler-development-plan.md`、`harness/specs/tasks/mission-control-loop-mvp.md`。
> v1 主要修订：flow 写入权威统一、Mission fencing、原子 arm 事务、typed yield barrier、helper claim/start 协议、秘密卫生、终态对账、阶段重排。

---

## 0. 已采纳的五项决策

1. **不叫“进程 replay”。** 准确语义是：helper 继续运行；Gateway 恢复后对账 `started.json/exit.json` 终态并唤醒。启动结果模糊时进入 `unknown/lost`，**绝不自动重启命令**。将补充/修订 `session-lifecycle-control-plane` ADR。
2. **存活边界**：Gateway 崩溃/升级/重启默认让 goal-owned helper 存活；用户显式 Quit Electron 默认取消，除非产品提供“退出后继续目标任务”开关；OS 注销/重启/断电不作存活承诺。
3. **独立 `goal_wait` 工具**，P0 仅 mission owner/lead 可调；mission/session/tick 从运行上下文绑定，**不信任模型传入的 `missionId`**。
4. **命令续跑**：声明时预检 + 执行时完整重验。预检不等于授权；`needs_approval` 转结构化审批等待；结果不确定进入 `needs_reconciliation`，不自动重放。
5. **激活 `flow_runs` 的前提**：统一 SQL-CAS 权威、明确合法状态转换、controller ownership、版本化 JSON codec、恢复对账。满足后才允许 `controller_id="goal-wake"` 成为正式 wait ledger。

---

## 1. 语义模型

```text
Goal = mission_runs（唯一长期目标真相）
Tick = 一次有界 agent turn，只工作不等待
Wait = flow_runs managed row（持久依赖与续跑边）
ProcessRun = task_runs(runtime="process")（进程生命周期真相）
Helper = durable-process-host（OS 层继续运行者）
Wake  = 至少一次投递；effect owner 负责幂等去重
```

正常路径：

```text
helper exit.json（原子）
  -> task_runs terminal
  -> 持久化对账/观察者 push
  -> flow CAS waiting -> running
  -> dispatcher 投递 continuation
  -> effect owner 用 launch claim / mission wakeId / durable receipt 去重
  -> flow -> succeeded
```

恢复路径：低频 sweep + 启动对账只做 level-triggered reconciliation，不承担“任务1是否完成”的正常判断。

---

## 2. 基础整改（P0a，必须先做）

### 2.1 统一 flow SQL-CAS 权威

现状问题（评审确认）：

- `openclaw_runtime/src/tasks/task-flow-registry.ts:502` 的 expected-revision 只检查内存 Map，随后 SQLite 无条件 upsert；
- `openclaw_runtime/src/tasks/task-flow-cas.ts:51` 有合法状态图，但主 Registry 并不经过它；
- `setFlowWaiting(blockedTaskId)` 实际写 `status="blocked"`，不是 `waiting + blocked_task_id`；
- CAS 图有 `waiting -> running`，没有 `waiting -> queued`。

v2 规定：

1. 所有 `controller_id="goal-wake"` 的 flow 只能经 **一个 SQL-CAS writer** 写：
   ```sql
   UPDATE flow_runs
   SET revision = :nextRevision, status = :next, ...
   WHERE flow_id = :flowId AND revision = :expectedRevision
   ```
   内存 Map 只作只读缓存；写路径不复用 `updateFlowRecordByIdUnchecked`。
2. 合法状态图明确为：
   ```text
   waiting -> running   (dependency satisfied, dispatcher claims)
   waiting -> failed    (timeout/lost/cancel)
   running -> succeeded (continuation accepted by effect owner)
   running -> failed
   running -> cancelled
   waiting/running -> cancelled
   ```
   v2 不使用 `queued` 表示 goal wait；`resume` 即 `waiting -> running`。
3. 新增 `createGoalWaitFlow()`：直接创建 `status="waiting"` 且允许携带 `blocked_task_id`（不经过现有 `setFlowWaiting` 的 blocked 语义）。
4. 创建时写 `controller_id="goal-wake"`、`sync_mode="managed"`、`owner_key=<sessionKey>`、版本化 JSON codec（`wait_json.v` / `state_json.v`）。
5. 索引：
   ```sql
   CREATE INDEX IF NOT EXISTS idx_flow_runs_blocked_task
     ON flow_runs(blocked_task_id, status, updated_at)
     WHERE blocked_task_id IS NOT NULL;
   CREATE INDEX IF NOT EXISTS idx_flow_runs_controller_status
     ON flow_runs(controller_id, status, updated_at);
   ```

### 2.2 Mission fencing（不是只靠 lease）

现状问题：`tickMission` 读内存后直接改；`saveMissionRun` 是 `insert ... onConflict doUpdateSet` 盲 upsert。旧 tick 即使 lease 过期也可能覆盖新 tick。

v2 增加：

```text
mission_runs.revision INTEGER NOT NULL DEFAULT 0
mission_runs.active_tick_id TEXT          -- 当前 tick 的 fencing token
mission_runs.last_wake_id TEXT            -- 已消费的 wake 去重键
```

规则：

1. 启动 tick 的 CAS：
   ```sql
   UPDATE mission_runs
   SET status='running', tick_count=tick_count+1,
       active_tick_id=:traceRunId, revision=revision+1
   WHERE mission_id=:id
     AND revision=:expectedRevision
     AND status IN ('idle','sleeping','ask_user')
   ```
2. tick 期间每个阶段写和终态写都带 `WHERE mission_id=? AND revision=? AND active_tick_id=?`；任何冲突立即中止该 tick（fenced），不再继续写。
3. 终态写清空 `active_tick_id`，保留 `last_wake_id`。
4. `lease` 只用于协调多个进程**尝试**启动 tick；**CAS/fence 才是数据权威**。
5. `last_wake_id` 用于 wake 去重：相同 `(missionId, wakeId)` 已消费时返回已存在结果，不启动新 tick。

### 2.3 原子 arm 事务（消除孤儿进程与丢 wake 窗口）

v1 顺序“先启进程再挂 flow”作废。v2 所有持久步骤在一个 SQLite 写事务内：

```text
ArmTransaction(missionId, ownerSessionKey, intent):
  1. 读取 mission，校验 expectedRevision/status/owner
  2. INSERT task_runs(runtime='process', status='queued', runtime_json={nonce,intentDigest,policyRevision})
  3. INSERT flow_runs(status='waiting', controller_id='goal-wake',
                       blocked_task_id=taskId, wait_json={...}, state_json={...})
  4. UPDATE task_runs SET parent_flow_id=flowId
  5. UPDATE mission_runs SET status='sleeping',
        metadata_json.activeWaitFlowIds += flowId,
        revision=revision+1
  COMMIT
```

提交后：

1. 才 spawn helper；
2. helper 写 `started.json` 后，`task_runs queued -> running`（写入 helperPid/nonce）；
3. spawn 失败：task/flow 写 failed，按 policy 唤醒 owner；
4. 提交后立刻做一次 **terminal level-check**：若依赖已满足（例如 task 行已 terminal）则继续 flow resume，不依赖观察者。

**Turn barrier**：

- flow 的 `wait_json.turnBarrier="pending"`；
- `goal_wait` 调 `onYield`，run 完全 idle 后由 runtime 调 `ackGoalWaitYield(waitId)`；
- dispatcher 只处理 `turnBarrier="acked"` 的 waiting flow。
- 这样避免“任务过快完成时，wake 与当前 turn 并发注入”。

### 2.4 Typed wait 传播（P0 不硬闯 TaskLoop）

现状：TaskLoop 没有 `waiting` 结果，`runObserved` 同步等待 orchestration；`sessions_yield` 只是回调 abort embedded turn，不能代表 TaskLoop 内部 wait。

v2 P0 边界：

- `goal_wait` 仅在 mission owner/lead 的 top-level turn 可用；
- 只暴露单依赖 schema：`waitFor: [{kind:"process", taskId}]`、`then: {kind:"mission_tick"}`；
- 工具从运行上下文绑定 `sessionKey/missionId/tickId`，不接受模型传入任意 missionId；
- TaskLoop / orchestrator 内不提供 `goal_wait`；后续要支持时，先增加 typed `wait_requested` 从 orchestration → TaskLoop → Mission 传播，再做工具。

---

## 3. 进程耐久协议（P1，但 P0b 同 Gateway 路径也要先定义）

### 3.1 runDir 文件协议（v2，安全版）

```text
<trusted-root>/background-processes/<runId>/
  intent.json      arm 前持久：protocolVersion, runId, nonce,
                   commandDigest, policyRevision, ownerEpoch, createdAt
  started.json     helper 启动后独占原子写：runNonce, helperPid,
                   childPid, startedAtMs, protocolVersion, commandDigest
  exit.json        终态：{exitCode, signal, timedOut, endedAtMs, outcomeDigest}
  heartbeat.json   helper liveness
  control.json     cancel/kill 请求：{nonce, action, reason}
  tail.txt         最近 8KB，注入 wake 前过既有 redaction
  stdout.log       有界滚动输出（见配额/ACL）
```

**禁止**：`intent.json`、`runtime_json`、flow `state_json` 中不出现 raw argv/cwd/env/命令原文/密钥。只存 `commandDigest`、脱敏展示名、参数结构摘要、secret reference、policy revision。
命令真实 argv/env 通过 OS 进程 argv/env 传给 helper；超出 OS 参数限制的复杂命令必须由 agent 先落成**经审批的脚本文件**，intent 只引用脚本路径 digest，不持久化脚本文本之外的秘密。

### 3.2 helper 状态机与模糊处理

```text
intent committed, task=queued
  -> spawn helper
  -> started.json observed => task=running + runtime_json(helperPid, runNonce)
  -> exit.json observed     => task=succeeded/failed/timed_out/cancelled
```

恢复判定：

| intent | started | helper PID | exit.json | 结论 |
|---|---|---|---|---|
| 有 | 无 | 不存在 | 无 | `unknown/lost`；禁止自动重启；按 onLost 唤醒 |
| 有 | 有 | 存活 | 无 | running；文件通知 + sweep 兜底 |
| 有 | 有 | 死亡 | 无 | `lost`；不自动重启 |
| 有 | 有 | 任意 | 有 | 读 exit.json 终态并唤醒 |

- Gateway 重启后**不能**对非子进程 helper 重挂 Node `exit` listener；只能 `fs.watch`/`fs.watchFile` + sweep。
- helper 启动后写 `started.json` 是 claim；Gateway 不得覆盖。
- 同一 runId/nonce 最多启动一次；恢复时若没有 started 且无存活 helper，不得猜测是否已启动。

### 3.3 安全、配额与清理

- `trusted-root` 0700 目录；单文件原子 rename；runDir 内全部文件由 owner 权限控制。
- 配额：每 session 同时最多 N 个耐久进程（建议 4），每 runDir tail+log 总量上限（建议 10MB），全局 TTL（建议 24h），达到后转 `needs_cleanup`，不清空任务记录。
- `stdout.log` 视为敏感工件：不进入 `runtime_json`；wake prompt 只用 redacted tail；session delete/reset 按 owner epoch 级联删除。
- helper/control 协议带 nonce；旧 Gateway、旧 session epoch 的 cancel 请求一律无效。

---

## 4. 续跑幂等（effect owner 负责，不承诺“只 tick 一次”）

语义统一改为：

> Wake 是 **at-least-once delivery**。每个 effect owner 持久去重，重复投递必须幂等返回。

| Continuation | 幂等 owner | 机制 |
|---|---|---|
| `mission_tick` | mission_runs | `last_wake_id + active_tick_id + revision` fencing |
| `agent_turn` | delivery/receipt | 先写 durable receipt / 用现有 delivery idempotency key，再触发 turn |
| `command` | approval_ledger + task_runs | 唯一 `launch_key`；只有一次 `intent_reserved -> execution_started`；不确定 -> `needs_reconciliation` |
| `flow_task` | flow_runs + task_runs | 唯一 parent flow revision + task runId |

Flow 只有在 **effect owner 持久 ACK** 后才 `running -> succeeded`：

- mission_tick：mission CAS 认领成功即 ACK；
- agent_turn：receipt/delivery 持久化成功即 ACK；
- command：approval ledger `execution_started` + task_runs `queued/running` 成功即 ACK。

崩溃窗口处理：

- task2 已启动但 flow 未 succeeded：恢复后凭 launch_key 发现已启动，flow 补写 succeeded，不重复启动；
- mission tick 已认领但 flow 未 succeeded：mission 行带 active_tick_id/wakeId，恢复后对账，不重复启动 tick；
- agent turn 已投递但 flow 未 succeeded：durable receipt 去重。

验收测试不写“只产生一次 tick”，写“重复投递不产生重复副作用”。

---

## 5. 终态与生命周期策略（v2 补齐）

1. **task observer 只是加速器**。`openclaw_runtime/src/tasks/task-registry.store.ts:52` 明确 best-effort。启动恢复和 sweep 必须做 level-triggered 对账：
   ```text
   for each flow(controller_id='goal-wake', status IN ('waiting','running'))
      recompute from blocked_task_id/task_runs and effect owner claims
   ```
2. **唯一 goal 唤醒者**：
   - `wait="goal"` 的 process task 关闭通用 `maybeDeliverTaskTerminalUpdate` 会话唤醒；
   - WaitFlow 是唯一 goal waker，并注入一个格式化的 completion event；
   - `maybeNotifyOnExit` 只保留用户可见通知，不承担 goal truth。
3. **竞态**：helper exit.json 是进程终态第一真相；cancel 只写 control.json，不得覆盖 exit.json；timeout 由 helper 判定并写 timedOut。
4. **session epoch**：`ownerEpoch` 写入 intent/flow/task。session delete/reset 使旧 epoch 全部失效并 cancel helper；新 session 不能接管旧 wait。
5. **Mission 取消级联**：`mission.cancel` -> 级联 `goal.wait.cancel(flowId)` -> control helper -> task/flow terminal。
6. **多 waiter**：P0 单依赖用 `blocked_task_id` + 索引；P2 ALL/ANY 前增加维护的 `flow_wait_index(wait_ref, flow_id, expected, status)`（与 flow 同事务写），不再把 `blocked_task_id` 当通用依赖图。
7. **资源预算不后置**：P0b 即实现 max active wait、flow 数量上限、tick 退避；P1 加 runDir 配额。

---

## 6. 工具与运行上下文（v2 约束版）

### 6.1 P0 `goal_wait` 最小 schema

```ts
goal_wait({
  waitFor: [{ kind: "process", taskId: "<bound taskId>" }], // 只允许单 process
  timeoutMs?: number,
  onTimeout?: "blocked" | "ask_user"
})
// continuation 由运行上下文固定为 mission_tick(reason="event")
```

约束：

- tool 只在 mission owner/lead 构造；`missionId/sessionKey/tickId` 从 tool context 注入；
- 模型不可指定 `missionId`、不可选择 command/flow_task continuation；
- 工具执行 = ArmTransaction + turn barrier + yield；
- 若当前 session 有 active non-mission turn 或位于 TaskLoop/orchestrator 内，返回明确错误，不静默降级。

### 6.2 `exec` 扩展（P0b/P1）

```ts
exec(background=true, wait?: "none" | "session" | "goal")
```

- `none`：现状；
- `session`：现状内存通知；
- `goal`：P0b 同 Gateway；P1 启用 helper。
- `goal` 模式要求存在绑定的 active mission owner context；普通 Chat 调用直接报错。

---

## 7. 阶段重排（采用评审建议）

### P0a：基础设施（无用户可见新行为）

- 统一 Flow SQL-CAS writer + goal-wake 合法状态图 + 索引；
- Mission `revision/active_tick_id/last_wake_id` fencing + 条件保存；
- ArmTransaction + turn barrier；
- `goal_wait` 上下文绑定与 schema 限制；
- 单元测试：双 writer 竞争、stale mission writer、arm 事务回滚、重复 wake 去重。

### P0b：同 Gateway、单 process 依赖、仅 mission_tick 闭环（Phase 3 已交付）

- `runtime="process"` + `runtime_json`（同 Gateway 路径暂用现有 supervisor，但 task 行与 flow 已持久）；
- helper 协议可先以同进程 mock 验证 exit.json/started.json；
- `exec wait="goal"` -> arm -> yield -> exit -> process-exit finalize + level-check -> flow resume -> mission.tick(wake payload)；（已交付，`processPollToolCalls=0`）
- 最小 E2E：**全程无 `process poll` 轮询**；重复投递不重复 tick；资源上限生效。

### P1：跨 Gateway 重启 + Windows/Electron 打包

- durable-process-host 真实 helper + claim/start/exit/heartbeat/control；
- ProcessRunReconciler + fs.watch + sweep；
- 秘密卫生、runDir ACL/配额/清理；
- Windows detached 验证、Electron 打包后的 helper 路径；
- 恢复矩阵：intent/started/exit 各阶段崩溃。

### P2：命令链与 effect 幂等

- `then.kind="command"`（task2）单依赖；
- approval ledger `launch_key`、needs_approval、needs_reconciliation；
- agent_turn durable receipt；
- task1 -> task2 端到端，无轮询。

### P3：多依赖、timer、UI、灰度

- ALL/ANY + `flow_wait_index`；
- timer wait 与 Mission `nextWakeAt` 的统一；
- `goal.wait.list/cancel` RPC + UI 投影；
- `runtime.goal.durableWait: disabled|shadow|enabled` 灰度、预算与熔断。

---

## 8. 验收口径（v2）

- 功能：`exec background wait=goal` 后当前 turn 结束；进程退出后 goal 自动续跑；无任何按任务轮询。
- 幂等：同一 exit.json / 同一 wake 重复投递，不产生重复 tick 或重复 task2。
- 崩溃：arm 提交前后、helper spawn 前后、started/exit 前后、flow resume 前后分别崩溃，恢复状态正确且无自动重放模糊命令。
- 竞态：进程在 yield barrier 前退出；cancel 与 exit 并发；session delete 与 wake 并发。
- 安全：持久行/runDir 元数据不含 raw command/env 秘密；runDir ACL/配额生效。
- 回归：普通 Chat 与 `background` 默认路径行为不变。

---

## 9. 与现有代码的接缝（v2）

| 现有能力 | v2 用法 |
|---|---|
| `TaskFlowCasStore`（SQL CAS + 合法转换） | 成为 goal-wake flow 唯一 writer，主 Registry 只读镜像 |
| `task_runs` + `runtime_json` + maintenance | process 生命周期真相；恢复时复用 detached task recovery hook |
| `mission_runs` 新增 revision/active_tick_id/last_wake_id | fencing 与 wake 去重 |
| `sessions_yield` abort/persist 机制 | goal_wait 的 turn-end 执行器；barrier 由 GoalWaitController 负责 |
| `approval_ledger` / `effect_receipts` | command continuation 的预检、重验与 effect 幂等 |
| `infra/system-events.ts` + `heartbeat-wake.ts` | 仅作通知加速器，不再是 wake truth |
| `process/supervisor` | 仅普通 foreground/short background；goal 耐久进程走 helper |

---

## 10. Phase 4 实现接缝（2026-08-18）

- 文件协议：`openclaw_runtime/src/agents/goal-wake-helper-protocol.ts`。API 不接收 raw argv/cwd/env/command；`intent.json -> started.json -> exit.json` 全部单文件原子 rename，root 0700、文件 0600；cancel 只写 `control.json`。
- detached helper：`goal-wake-helper-host.ts` 复用当前 Gateway entry/loader（source: tsx cli；packaged: electron + `ELECTRON_RUN_AS_NODE=1`）并 `detached:true + unref()`；helper entry 在 `entry.ts --goal-wake-helper-run`，stdin 传递 OS argv/env/cwd。
- 恢复：`process-run-reconciler.ts` 只读 intent/started/exit + OS liveness；`goal-wake-recovery.ts` 启动/低频 sweep 做 task terminal -> flow level-check -> mission tick 顺序，fs.watch + 递归 setTimeout，不用 setInterval/process.poll。
- 清理：`goal-wake-durable-cleanup.ts` 接入 `session-drain-service.ts`；control nonce+ownerEpoch 校验、等待 exit、终态 task/flow、删 runDir、重复调用幂等。
- 配额/开关：`runtime.mission.goalWake.durableHelper` 默认关，maxRunsPerSession=4、maxOutputBytesPerRun=10MB、runTtlMs=24h、sweepIntervalMs=60s。
- Windows detached 实测通过 `goal-wake-helper-host.test.ts`；packaged Electron 未在本机复现，fail-closed fallback 在 `resolveDurableHelperLaunch` 记录为 blocked。
