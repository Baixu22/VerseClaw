# Goal/Loop 耐久后台进程续跑：可直接复制的实现提示词

> 用途：把 `## 可直接复制的提示词` 一整段原样发给下一个实现 agent。
> 配套设计：`docs/dev/goal-loop-durable-process-wake-design.md`（v2，已经过两轮审计）。
> 状态：只读沉淀，不包含实现代码。

---

## 可直接复制的提示词

```text
你是 Verse Claw / OpenClaw runtime 的实现 agent。任务是把已定稿的 v2 设计转成代码和测试。
这不是头脑风暴：先按本提示词做一次 30 分钟内的方案核对，发现设计结论与当前代码事实冲突时停下报告，不要自行改设计方向。

## 0. 必读（按顺序）

1. AGENTS.md
2. docs/dev/goal-loop-durable-process-wake-design.md
3. docs/dev/mission-goal-durable-scheduler-development-plan.md
4. harness/specs/tasks/mission-control-loop-mvp.md
5. docs/dev/session-lifecycle-control-plane/DESIGN.zh-CN.md 的 §5（理解你要修订的 ADR）
6. 以下代码接缝：
   - openclaw_runtime/src/tasks/task-flow-cas.ts
   - openclaw_runtime/src/tasks/task-flow-registry.ts
   - openclaw_runtime/src/tasks/task-flow-registry.store.sqlite.ts
   - openclaw_runtime/src/tasks/task-registry.ts
   - openclaw_runtime/src/tasks/task-registry.store.sqlite.ts
   - openclaw_runtime/src/tasks/task-registry.maintenance.ts
   - openclaw_runtime/src/agents/mission-control/controller.ts
   - openclaw_runtime/src/agents/mission-control/store.ts
   - openclaw_runtime/src/agents/tools/sessions-yield-tool.ts
   - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.sessions-yield.ts
   - openclaw_runtime/src/state/openclaw-state-db.ts
   - openclaw_runtime/src/state/openclaw-state-schema.sql

## 1. 已锁定的决策（不要重新讨论）

1. Goal = mission_runs，Tick = 一次有界 agent turn，Wait = flow_runs managed row，ProcessRun = task_runs(runtime="process")。
2. Wake 是 at-least-once delivery；effect owner 负责幂等去重。验收不写“只产生一次 tick”，写“重复投递不产生重复副作用”。
3. flow_runs 的 goal-wake 写入必须统一到 SQL CAS；内存 Map 只读缓存；不用 setFlowWaiting 的 blocked 语义。
4. Mission 必须加 revision / active_tick_id / last_wake_id fencing；lease 只协调尝试，CAS/fence 才是权威。
5. arm 必须在一个 SQLite 事务内完成 task(queued) + flow(waiting) + mission(sleeping)；提交后才 spawn helper；提交后必须做 terminal level-check。
6. turn barrier：goal_wait 的 wait 先处于 pending，run 完全 idle 并 ack 后才允许 dispatcher resume。
7. P0 的 goal_wait 只允许 mission owner/lead 顶层 turn 调用；只支持单 process 依赖；continuation 固定 mission_tick；missionId/sessionKey/tickId 从运行上下文绑定，不信任模型参数。
8. 普通 Chat 与 background 默认路径行为不变；任何新行为必须 feature-flag default-off。
9. helper 协议：intent.json -> started.json -> exit.json。intent 有、started 无、helper 不存活 = unknown/lost，绝不自动重启命令。
10. 不持久化 raw argv/env/命令原文/密钥；只存 commandDigest、脱敏展示、secret reference、policy revision；runDir ACL/配额/清理必须同时落地。
11. wait="goal" 时 WaitFlow 是唯一 goal waker；关闭通用 task terminal delivery 对该任务的重复会话唤醒；system events/heartbeat 只是加速器。
12. P0a/P0b 不引入 renderer/UI 改动；新增 RPC 与 host-api 留到 P3。

## 2. 实施范围

本轮只做两个阶段，完成即停：

### P0a：基础设施，无用户可见新行为
- 统一 flow SQL-CAS writer：
  - 条件 UPDATE flow_runs SET ... WHERE flow_id=? AND revision=?；
  - controller_id="goal-wake" 的合法转换：waiting -> running，running -> succeeded/failed/cancelled，waiting -> failed/cancelled；
  - 新增 createGoalWaitFlow(status="waiting", blocked_task_id, wait_json.v=1, state_json.v=1)。
- 索引：
  - idx_flow_runs_blocked_task ON flow_runs(blocked_task_id, status, updated_at) WHERE blocked_task_id IS NOT NULL；
  - idx_flow_runs_controller_status ON flow_runs(controller_id, status, updated_at)。
- Mission fencing：
  - mission_runs 增加 revision INTEGER NOT NULL DEFAULT 0、active_tick_id TEXT、last_wake_id TEXT；
  - tick 启动 CAS（expectedRevision + status in idle/sleeping/ask_user）；
  - tick 内所有阶段写和终态写都是条件更新，冲突即 fenced abort；
  - 终态清 active_tick_id、保留 last_wake_id。
- ArmTransaction：
  - 一个 runOpenClawStateWriteTransaction 内完成 task(queued,runtime=process) + flow(waiting) + task.parent_flow_id + mission(sleeping,activeWaitFlowIds)；
  - 任一子步骤失败整体回滚，mission 不进入 sleeping。
- turn barrier 持久字段与 ackGoalWaitYield。
- 单测：双 writer 竞争、stale mission writer、arm 回滚、重复 wakeId 去重、状态转换非法路径拒绝。

### P0b：同 Gateway、单 process 依赖、mission_tick 闭环
- TaskRuntime 增加 "process"；task_runs.runtime_json TEXT NOT NULL DEFAULT '{}'；TaskRecord.runtimeJson 映射。
- exec(background=true, wait="none"|"session"|"goal")：
  - wait="goal" 仅在有绑定的 active mission owner context 时允许；
  - 同 Gateway 阶段可用现有 supervisor 执行，但 task 行与 flow 必须在 arm 事务先持久。
- goal_wait 工具：
  - schema 只暴露 waitFor:[{kind:"process",taskId}]、timeoutMs、onTimeout；
  - 执行 = ArmTransaction + turn barrier + sessions_yield 同类 abort/persist；
  - 在 TaskLoop/orchestrator/无 mission 上下文时返回明确错误。
- 进程退出路径：
  - 先 finalize task_runs(process)，再由 task observer + level-check 找 blocked_task_id 对应 flow；
  - flow CAS waiting -> running；
  - 调用 mission.tick(reason="event", wake={wakeId, reason, payload})；
  - mission wakeId 去重后，flow 收到 effect ACK 才 running -> succeeded。
- wake payload 进入 MissionContextPack（受保护上下文，不替代模型判断）。
- AgentInternalEventSource 增加 "process"（用于 completion event 注入）。
- 资源预算：max active goal waits、max flows、tick 失败退避，本阶段必须存在。

## 3. 硬性边界

- 不新建第二 Mission 真相；mission_runs 是唯一 goal 真相。
- 不新增 goal_wake_events 表；P0/P1 用 flow_runs + task_runs。P2 的 flow_wait_index 本轮不建。
- 不把 flow_runs CAS 接给普通 task-mirrored flow 或普通 Chat。
- 不在 P0 做 command continuation、agent_turn continuation、ALL/ANY、timer wait。
- 不在 P0 做真实 detached helper；可以写 protocol 类型和 mock 测试，但 helper 打包放 P1。
- 不在 P0 改 renderer、host-api、Electron E2E。
- 不把 task observer 当作正确性来源；启动恢复和 sweep 必须做 level-triggered 对账。
- 不持久化 raw 命令/环境/密钥；approval 语义沿用 approval_ledger 的 digest-only 约束。
- 新行为默认 disabled；只有显式 wait="goal" 且 flag 开启才进入新路径。

## 4. 交付物（同一变更集）

1. 新 task spec：harness/specs/tasks/goal-loop-durable-process-wake.md。
   - scenario 引用 gateway-backend-communication；
   - requiredRules 至少包含 backend-communication-boundary、runtime-local-ecosystem-boundary、chat-loop-boundary、active-config-guards、docs-sync、comms-regression；
   - acceptance 与 v2 文档 §8 一致。
2. ADR 补充：docs/dev/adr/ 下新增或修订 session-lifecycle 局部例外，内容对齐 v2 §0 第 1、2 条。
3. 源码 + 单测：
   - flow SQL-CAS、Mission fencing、ArmTransaction、goal_wait、process runtime。
4. 设计文档同步：
   - docs/dev/goal-loop-durable-process-wake-design.md；
   - docs/dev/mission-goal-durable-scheduler-development-plan.md 的阶段状态更新；
   - docs/clawx-design-overview.md（若行为/接口变化）。
5. 测试证据：
   - 目标单测全部通过；
   - pnpm run typecheck；
   - pnpm run lint；
   - pnpm harness validate --spec harness/specs/tasks/goal-loop-durable-process-wake.md；
   - 若改动了 gateway broadcast / mission-lifecycle 事件流，补 pnpm run comms:replay 和 pnpm run comms:compare。

## 5. 工作步骤

1. 跑 pnpm harness context --spec harness/specs/tasks/mission-control-loop-mvp.md 获取最小阅读集。
2. 用当前代码逐条核对 v2 设计里的行号与假设；冲突只报告，不改方向。
3. 先写 harness task spec，再写 ADR 补充，再写代码。
4. P0a 完成并通过单测后，再做 P0b。
5. 每个阶段结束时跑类型检查；不要攒到最后。

## 6. 验收口径

- P0a：两个 writer 并发只有一次 SQL CAS 成功；stale mission writer 无法覆盖新 tick；arm 任一子步骤失败无残留 task/flow/sleeping；同一 wakeId 不启动第二个 tick。
- P0b：exec(background=true, wait="goal") 后当前 turn 结束；进程退出后 goal 自动续跑；测试里没有 process poll 轮询调用；重复投递同一 exit/wake 不产生重复副作用；默认 flag-off 时行为与旧版一致。
- 崩溃窗口单测：arm 提交前后、task finalize 前后、flow resume 前后、mission tick 认领前后分别模拟崩溃并验证恢复。
- 安全单测：runtime_json/flow state 不含 raw command/env；非法 controller 写 goal-wake flow 被拒。

## 7. 报告格式

完成后输出：
- Spec/ADR/代码/测试文件清单；
- 与 v2 设计不一致的代码事实（若有）；
- 每个验收项的测试名或手动验证步骤；
- 运行过的命令与结果；
- 明确下一阶段 P1 的前置条件。

约束：不要写 P1/P2/P3 的代码；不要扩展范围；不要修改 UI；不要做未经本提示词授权的重构。
```
