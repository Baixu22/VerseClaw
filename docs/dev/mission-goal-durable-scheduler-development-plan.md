# Mission / Goal 持久调度开发计划（休眠—唤醒—续跑）

> 状态：Plan-only，待外部 agent 审计后再实施。
> 日期：2026-08-16（工作树未提交；本文件不包含实现代码）。
> 上游任务线索：`harness/specs/tasks/mission-control-loop-mvp.md` Phase 5「scheduler integration」尚未落地。

---

## 1. 问题定义

当前 `/loop` 与 Mission 的名称和边界不符合长期任务本质：

- `/loop` 是**在 agent 会话内部运行的有限执行循环**，由模型在当前 turn 内调用工具推进。
- Mission 虽有 `sleeping` / `nextWakeAt` / `enableSchedule` 字段，但**没有调度器消费这些字段**；`schedule_json` 恒为 `"{}"`。
- 用户期望的 goal 语义是：**一次短 turn 结束即休眠，等待“时间到 / 后台子进程完成 / 子代理完成 / 外部事件”，然后由外部控制器自动唤醒下一次 turn，并基于持久 checkpoint 继续。**

目标不是让模型无限循环，而是把循环移出模型，形成：

```text
Goal Controller（小、非 LLM、常驻/持久）
  -> Wake Trigger（timer/event/subprocess/subagent）
  -> 一次短 agent run
  -> 写 checkpoint + plan snapshot
  -> 声明下一次 wait
  -> 休眠
```

## 2. 现状证据（已审计）

### 2.1 已经具备的底座

| 能力 | 实现位置 | 结论 |
|---|---|---|
| 持久化定时调度 | `openclaw_runtime/src/cron/service/**`：CronService、JSON store、SQLite lease、启动补跑、错误退避、timeout watchdog | ✅ 生产级 |
| Mission 状态持久 | `mission-control/store.ts`：`mission_runs` SQLite | ✅ |
| Mission tick checkpoint | `mission-control/controller.ts:1121+`：每个 tick 写 `long_task_checkpoints` | ✅ |
| 后台子代理完成续跑 | `subagent_runs` SQLite + `subagent-registry.ts restoreSubagentRunsOnce` + `agent-steering-queue.ts` | ✅ 较完整 |
| 后台进程完成通知 | `bash-tools.exec-runtime.ts maybeNotifyOnExit` -> `enqueueSystemEvent` + `requestHeartbeat` | ⚠️ 通路存在，注册表/事件在内存 |
| 定时/事件 wake 桥 | `infra/heartbeat-wake.ts` + `infra/heartbeat-runner.ts` | ⚠️ pending wake 在内存 |
| 幂等副作用证据 | `effect_receipts` SQLite + `agents/effect-receipt.ts` | ✅ 局部覆盖 |

### 2.2 关键缺口

1. **Mission 休眠无唤醒者**：`mission-control/controller.ts:1215/1255/1263` 写 `nextWakeAt`，全库无任何模块消费它；`resumeMission` 只把 `paused` 改成 `sleeping`，不触发新 run。
2. **`tickPolicy` / `enableSchedule` 是死配置**：`resolveAgentMissionConfig` 返回后仅 metadata 记录，没有调度决策。
3. **system event / heartbeat wake 不持久**：`infra/system-events.ts` 注释明确 ephemeral；`heartbeat-wake.ts pendingWakes` 为模块级 Map。Gateway 在事件未 drain 时崩溃会丢事件。
4. **后台子进程不持久**：`bash-process-registry.ts` 为 in-memory；`process/supervisor/adapters/child.ts:46-53` 在 Windows / service-managed runtime 下 `detached:false`。
5. **Mission 无并发 tick 保护**：`tickMission` 没有 CAS；两个进程可同时 tick 同一 mission。
6. **cron per-run 会话不携带 goal 状态**：main-session cron 每次创建 `cron:<job>:run:<ts>` 子会话，isolated cron session rollover 会丢弃旧 run resume handle；没有把 Mission checkpoint/plan 注入 wake prompt。

## 3. 外部范式结论（anysearch 检索）

- Claude Code `/goal`、`/loop`：session-scoped，任务状态持久，后台工作完成会 re-invoke agent；跨会话调度由 Routines / cloud scheduled tasks 承担。
- Codex：长时任务依赖“超长 session + 仓库外部化状态”；后台 subprocess/subagent 完成唤醒父 agent 仍是 open issue（`openai/codex#15723`）。
- Cursor：Background/Cloud Agents 采用“任务队列 + 云端 VM + 分支隔离 + 完成 PR/通知”。
- Durable Execution（Temporal、Cloudflare Workflows）：**controller 在 agent 外、turn 短命、durable timer/signal、activity idempotency、replay 不重复副作用**。
- 《Autonomous agents that sleep》的核心规则与本计划一致：**A turn never waits. Something outside the agent holds the state, waits, and starts the next turn only when the world actually changes.**

结论：我们的底座已经超过多数 CLI agent，但缺少把 Mission、CronService、checkpoint、wake event 组合起来的 Goal Controller。

## 4. 目标架构（终态）

```text
+----------------------------------------------------------------------+
| MissionWakeScheduler (non-LLM, periodic sweep, SQLite CAS lease)     |
|   scan mission_runs: status=sleeping AND next_wake_at<=now           |
|   -> claim lease {missionId, tick}                                    |
|   -> tickMission(missionId, reason="scheduled")                      |
|   -> release lease                                                   |
+----------------------------+-----------------------------------------+
                             |
                             v
               MissionController.tickMission()
                 buildMissionContextPack(goal/checkpoint)
                 -> task_loop bounded execution
                 -> MissionReviewer decide
                 -> write long_task_checkpoint
                 -> status=sleeping + nextWakeAt (nextTick.afterMs)
                             |
                             v
              Wake Event Journal (SQLite, pending/delivering/delivered)
              Timer: scheduler row / cron
              Event: exec completion / subagent completion / hook
                             |
                             v
              heartbeat/requestHeartbeat (accelerator, not source of truth)
```

关键不变量：

1. **先排下一次唤醒，再进入 sleeping**；排程失败 -> `blocked`。
2. **同一 mission 同一时刻至多一个 tick**：SQLite CAS lease，stale lease 可回收。
3. **tick 幂等**：`mission_id + tick` 作为 lease/idempotency key。
4. **wake event 先落 SQLite 再发 heartbeat**；heartbeat 只是加速器。
5. **每次休眠前持久化 plan snapshot**（接上一轮任务规划持久化审计）。
6. **预算上限**：maxTicks / maxRepairTicks / guardian / error backoff / timeout 必须仍然生效。

## 5. 分阶段开发计划

### P0 — Mission Wake Bridge（本计划首要实施项）

**目标**：让 `sleeping + nextWakeAt` 真正产生自动 tick。

不新建调度器产品，不新增 Gateway RPC，不改变 UI。先做最小闭环。

#### 5.1 P0 文件变更清单（计划）

| 文件 | 类型 | 内容 |
|---|---|---|
| `openclaw_runtime/src/agents/mission-control/store.ts` | 修改 | 增加 `listSleepingMissionsDue(nowMs)`、`markMissionTickLost/retryable`（或最小 `resetStaleRunningMissions`） |
| `openclaw_runtime/src/agents/mission-control/wake-scheduler.ts` | 新增 | `MissionWakeScheduler`：setInterval sweep、SQLite `state_leases` CAS、调用 `tickMission`、lease 释放、错误隔离 |
| `openclaw_runtime/src/agents/mission-control/wake-scheduler.test.ts` | 新增 | 单元测试：due 选择、lease 互斥、tick 幂等、terminal 不扫、crash stale lease |
| `openclaw_runtime/src/gateway/server-runtime-services.ts` | 修改 | post-ready 启动/关闭 scheduler（随 heartbeat 一起） |
| `openclaw_runtime/src/gateway/server.impl.ts` | 修改 | 传入 `broadcast`/runtime deps，把 scheduler handle 存入 `runtimeState` 并在 close 时 stop |
| `harness/specs/tasks/mission-goal-scheduler-wake-bridge.md` | 新增 | 本次任务 spec |
| `docs/dev/mission-goal-durable-scheduler-development-plan.md` | 新增 | 本文档 |

#### 5.2 P0 设计细节

**5.2.1 扫描条件**

```text
mission_runs
WHERE status = 'sleeping'
  AND next_wake_at IS NOT NULL
  AND next_wake_at <= :nowMs
  AND (:requireScheduleFlag = 0
       OR metadata_json.enableSchedule = true
       OR agent missionLoop.tickPolicy.mode = 'scheduled')
```

默认：
- `enableSchedule !== true` 且 `tickPolicy.mode !== 'scheduled'` 的 mission 不自动 wake，保持现状（向后兼容）。
- 只有显式创建/配置为 scheduled 的 mission 才自动 tick。
- 这样可以先 default-off 灰度，符合 `runtime-local-ecosystem-boundary` 的“active behavior behind explicit user configuration”。

**5.2.2 Lease 方案（不新增表，复用 `state_leases`）**

```text
scope     = 'mission-wake'
lease_key = missionId
owner     = '<pid>:<uuid>'
expires_at = now + MISSION_WAKE_LEASE_TTL_MS (建议 5min)
heartbeat_at = now
payload_json = { missionId, tick, reason: 'scheduled' }
```

CAS：
- `insert` 或 `update` 仅当 `expires_at IS NULL OR expires_at < now`；
- 成功才调用 `tickMission`；
- `finally` 只删除仍属于自己的 owner/lease；
- sweep 发现 lease 未过期则跳过。

**5.2.3 tick 调用**

```ts
await tickMission(
  { missionId, reason: "scheduled" },
  cfg, // getRuntimeConfig()
  {
    lifecycle: broadcastMissionLifecycle, // gateway broadcast
    taskLoopDeps: {}, // 允许默认 spawnSubagentDirect；P0 不引入新 transport
  },
);
```

`reason: "scheduled"` 已经是 `MissionTickInput` 合法枚举值（`types.ts`），无需协议变更。

**5.2.4 错误处理**

- `tickMission` 抛错：lease 释放，记录日志，不改变 mission 状态，等待下一次 due；连续失败按现有 mission error backoff/guardian 处理。
- `nextWakeAt` 缺失：扫描跳过；不自行合成 timer，避免失控循环。
- terminal（complete/blocked/cancelled/error）：扫描跳过。
- `paused/ask_user/running`：扫描跳过。
- stale lease 由 `expires_at` 自动可回收。

**5.2.5 生命周期**

- `startMissionWakeScheduler({ cfg, broadcast, sweepIntervalMs? })` 返回 `{ stop() }`。
- `sweepIntervalMs` 默认 `15_000`，测试注入 `0` 或手动 `sweepNow`。
- Gateway post-ready 启动；`minimalTestGateway` 不启动真实 interval。
- Gateway reload 时复用现有 `cronState` 重建路径：scheduler 必须 stop 后再建，避免双 timer。

#### 5.3 P0 明确不做

- 不新增 `mission_runs` schema 字段。
- 不新增 Gateway RPC / Host API / renderer 页面。
- 不处理 subprocess/subagent/event wake（P1/P2）。
- 不把 cron store 变为 mission truth。
- 不默认开启：只有 `enableSchedule` 或 `tickPolicy.mode='scheduled'` 才自动 tick。

### P1 — Durable Wake Event Journal

新增/复用 SQLite 表 `goal_wake_events`（或复用 `delivery_queue_entries` 语义，先评审）：

```text
wake_id | scope | session_key | mission_id | kind(timer|subprocess|subagent|event|heartbeat)
status(pending|draining|delivered|failed|lost) | due_at | attempts | last_error | payload_json
```

- 生产端：exec completion / subagent completion / cron tick / hook 先写 journal。
- 消费端：heartbeat 只做加速；Gateway 启动 drain pending 并恢复 draining。
- 验收重点：crash-in-drain 恢复、idempotency、不重复投递。

### P2 — 后台子进程 durable handle

- `exec background=true` 创建 `task_runs` 行（runtime 建议新增 `process`，或先复用 `cli` 并加 taskKind）。
- 进程退出更新 `task_runs` + 写 wake event。
- 启动 reconcile：PID 存在与否 -> running/lost；Windows 采用 detached/job/supervisor helper，先做 Windows 可行方案评估。
- 验收重点：Gateway 重启后 background process 状态与完成通知不丢。

### P3 — Goal Context 注入与 plan snapshot

- 休眠前把最新 `update_plan` snapshot 写入 Mission metadata / checkpoint。
- wake prompt 由 MissionContextPack 增加：plan snapshot、上次 compaction recovery projection、本次 wake reason/event payload。
- 验收重点：多 tick 后 plan 状态仍可机读恢复，压缩不丢。

### P4 — 关键副作用幂等化与生产开关

- 对 goal 路径高风险工具接入 `effect_receipts` / idempotency key。
- 增加 `missionLoop.scheduler` 生产开关：`disabled | shadow | enabled`，shadow 模式只记录“would tick”不执行。
- 达到 P0-P3 全绿后再 promote，默认 `enabled` 只对显式 scheduled mission 生效。

## 6. 验收标准（供审计 agent 勾选）

### P0 功能

- [ ] 一个 `enableSchedule=true` 的 mission 进入 `sleeping + nextWakeAt` 后，到期无需人工操作自动执行下一次 tick。
- [ ] `paused/ask_user/complete/blocked/cancelled/error` 永不被自动 tick。
- [ ] 同一 mission 两个 sweep 并发时只有一个 `tickMission` 调用。
- [ ] `tickMission` 抛错不会让 scheduler 崩溃或破坏 lease。
- [ ] Gateway close 后 interval 被清掉；reload 后不会出现两个 scheduler。

### P0 测试

- [ ] `wake-scheduler.test.ts`：
  - due mission 命中；
  - terminal/paused/no-nextWakeAt 跳过；
  - lease CAS 互斥；
  - stale lease 可回收；
  - tick 异常释放 lease；
  - `enableSchedule=false` + mode!=scheduled 不扫。
- [ ] `store.listSleepingMissionsDue` 单测。
- [ ] 现有 `mission-control` 相关测试全绿。

### P0 命令

```bash
pnpm harness validate --spec harness/specs/tasks/mission-goal-scheduler-wake-bridge.md
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run \
  --config test/vitest/vitest.agents.config.ts \
  src/agents/mission-control/wake-scheduler.test.ts
pnpm run typecheck
git diff --check
```

> 注：P0 不改 renderer/Main/host-api/事件 contract，因此不要求 comms replay；但若审计 agent 认为 scheduler 通过 `broadcast("mission-lifecycle")` 影响事件流，应补 `pnpm run comms:replay` 和 `pnpm run comms:compare`。

## 7. 审计 agent 检查清单

1. 是否违反 `runtime-local-ecosystem-boundary`：没有新增 task database / mission store / parallel source of truth？
2. 是否违反 `backend-communication-boundary`：没有 renderer 直连 Gateway？
3. 是否破坏 `chat-loop-boundary`：普通 Chat 没有自动进入 long-task 状态？
4. Mission scheduler 是否可能造成无限 tick / token 风暴？是否有 maxTicks / backoff / lease / 单飞？
5. `nextWakeAt` 是否只在 reviewer 返回 `nextTick` 或明确 sleep 决策后写入？
6. scheduler 与 CronService 是否职责清晰：Cron 只管触发，Mission 状态是唯一 truth？
7. Gateway restart / reload / close 三条路径是否有明确 stop-start 语义？
8. 失败与 stale state 恢复是否明确？哪些保留 running、哪些 retry、哪些转 blocked？
9. P0 默认 off / 显式配置是否满足灰度边界？
10. 测试是否覆盖 crash window（claim 后崩溃、tick 中崩溃、scheduler stop race）？

## 8. 风险与开放问题

| 风险/问题 | 处理建议 |
|---|---|
| `tickMission` 内部 task_loop 可能长时间阻塞 timer | 先串行单 lease；后续 P1 用 queue + timeout；当前 maxTicks/maxIterations 已有上限 |
| 系统睡眠导致 `nextWakeAt` 落后 | sweep 使用 wall-clock，到期后最多延迟一个 interval；不采用 cron missed-run 语义，P0 接受 |
| 崩溃时 mission 留在 `running` | P0 增加 `resetStaleRunningMissions`（按 updatedAt + lease 过期）或 P1 journal；审计时确认策略 |
| Windows 后台子进程跨 Gateway 生命周期 | P2 需先做 OS 可行性 spike，不能假设 POSIX detach |
| 定时唤醒是否应复用 CronService 而非自建 timer | P0 自建 15s sweep 为了独立性和简单性；P1 评审时可折叠进 CronService maintenance callback |
| `reason:"scheduled"` 是否触发用户可见回复 | 复用现有 mission lifecycle；P0 不新增用户消息语义 |

## 9. 外部参考

- Claude Code goal/scheduled tasks:
  - https://code.claude.com/docs/en/goal
  - https://code.claude.com/docs/en/scheduled-tasks
- Codex long-horizon + background wake open issue:
  - https://developers.openai.com/blog/run-long-horizon-tasks-with-codex
  - https://github.com/openai/codex/issues/15723
- Durable execution / agent-that-sleeps:
  - https://veelenga.github.io/autonomous-agents-that-sleep/
  - https://developers.cloudflare.com/workflows/get-started/durable-agents/
  - https://learn.temporal.io/tutorials/ai/durable-ai-agent/
- Cursor background agents:
  - https://blink.new/blog/cursor-background-agent
  - https://docs.cursor.com/background-agent

## 10. 当前不修改代码

本文件是计划文档。实施必须从 `harness/specs/tasks/mission-goal-scheduler-wake-bridge.md` 开始，并在同一变更集内提交源码、测试、本计划和必要的 README/设计文档同步。
