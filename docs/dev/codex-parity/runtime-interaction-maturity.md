# 会话运行时交互方案成熟度对比：ClawX vs Codex CLI

> 对比对象：ClawX（Electron 应用 + OpenClaw Gateway 运行时，本仓库） vs Codex CLI（`%USERPROFILE%\Desktop\coding\codex-main\codex-rs`，Rust）
> 范围：三种会话运行时交互方案——**打断（interrupt）**、**引导（guide/steer）**、**排队（queue）**
> 日期：2026-07（调查基于当前工作区源码，行号以调查当日为准）

---

## 0. 结论摘要

| 方案 | ClawX 成熟度 | Codex CLI 成熟度 | 总体判断 |
|---|---|---|---|
| 打断 interrupt | **B-（链路通、门禁重、验证弱）** | **A（生产级、测试完备）** | Codex 领先；ClawX 的 checkpoint+重启是独特设计但受 `/loop` 门禁限制 |
| 引导 guide/steer | **B-（注入真实、验证断层）** | **A（设计克制、测试充分）** | Codex 领先；ClawX 的 steering queue 注入已接通但零运行时测试 |
| 排队 queue | **B+（持久化是亮点）** | **B+（mailbox 语义，无用户级队列）** | 各有胜负：ClawX 有跨进程持久化用户队列（但显式 queue 同样受 `/loop` root 门禁，见 §1.3）；Codex 有更精细的 turn 边界语义 |

**核心差距不是"有没有"而是"验证与可达性"**：ClawX 三种模式的类型层、UI、IPC、运行时代码全部存在且大部分端到端接通，但
① 运行时分支（chat.ts 的 inputMode 三分支）几乎无直接单测，e2e 只到 mock IPC 层；
② interrupt/guide/queue 三模式均依赖 `/loop` Task Ledger root 门禁，普通会话不可达且 UI 无感知；
③ 恢复（restoreCheckpoint）是 legacy 文件回滚，event-log replay 显式未实现。
Codex 侧是生产级三层链路（TUI→RPC→core）+ guardian 熔断 + 大量竞态/事件序测试。

---

## 1. 三方对比矩阵（层 × 方案）

### 1.1 打断（interrupt）

| 层 | ClawX | Codex CLI |
|---|---|---|
| 类型 | `LongTaskInputMode='interrupt'`（`shared/types/long-task-control.ts:3`）；`LongTaskInterventionPolicy`（delivery='restart_now'、shouldAbortActiveRun、checkpointRequired、resumeTrigger='interrupt'，`:184-197,419-434`）。**`interventionPolicyForInputMode` 生产侧零引用（仅 `tests/unit/long-task-control.test.ts` 单测调用），运行时决策实际由 `chat.ts` 白名单 + `input-classifier.ts` + `input-mode.ts` 完成** | `Op::Interrupt`（`protocol/src/protocol.rs:524-527`，注释明确"中止当前任务但不终止后台终端"）；`TurnAbortReason { Interrupted, Replaced, ReviewEnded, BudgetLimited }`；`TurnAborted { guidance }` 上下文片段（`core/src/context/turn_aborted.rs:3-30`） |
| UI | 双通道：Stop 按钮→`chat.abort` RPC；打断按钮（`ChatInput.tsx:2940-2946` testid `chat-intervention-interrupt`）+ Shift+Enter（`:2509`）→ `chat.send`+`inputMode:'interrupt'` | Ctrl+C（`tui/src/chatwidget/interaction.rs:382-436`：modal 优先→有可取消工作则 interrupt→否则双按退出）；`/stop` 是杀后台终端（`slash_command.rs:113`），不中断 turn |
| IPC | `electron/services/chat-api.ts:459-478` inputMode 白名单→`chat.send` RPC；`chat.abort` 在 `VERSE_CLAW_REQUIRED_GATEWAY_METHODS`（`gateway/manager.ts:140-166`） | `TurnInterruptParams {threadId, turnId}`（`app-server-protocol/.../v2/turn.rs:206-212`）→ `turn_processor.rs:1418-1480`（turn_id 必须等于活跃轮；`pending_interrupts` 去重；收到 TurnAborted 事件才应答） |
| 运行时 | `chat.ts:3397-3449`：checkpoint（trigger:'interrupt'，幂等键 `chat:${clientRunId}:interrupt:checkpoint`）→ intervention event 'checkpointed' → `abortChatRunsForSessionKeyWithPartials`（stopReason:'interrupt'）→ 清 dedupe → 新 run 重启。**门禁**：无 `/loop` Task Ledger root 时 `INVALID_REQUEST`（`:3382-3396`） | `interrupt_task`（`session/mod.rs:4070-4077`）→ `abort_all_tasks`（`tasks/mod.rs:527-555`：take task→handle_task_abort→emit lifecycle→`input_queue.clear_pending`→`maybe_start_turn_for_pending_work`）→ `handle_task_abort`（`:897-982`：cancel token→100ms 宽限→强杀→任务级 abort→`<turn_aborted>` marker 先 flush 再发 TurnAborted 事件） |
| 恢复 | `restoreCheckpoint`（`sessions/run-control.ts:501-574`）→ `executeReplayRollback` **显式未实现**（`:550` `{enabled:false, reason:"event-log replay not implemented"}`）→ legacy 文件回滚（`checkpoint-rollback-executor.ts`）；自动恢复仅摘要注入（`loop-context-pack.ts:189+`） | fork/resume 重建：`ForkSnapshot`（`thread_manager.rs:146-165`）+ `rollout_reconstruction.rs`（历史重建）；无"任务状态检查点"概念 |
| 测试 | UI/IPC 层：`tests/e2e/chat-long-task-control.spec.ts:344-377`（mock 断言 inputMode 透传）、`chat-input.test.tsx:1711-1780`、`system-maturity-p45.spec.ts:101-172`（chat.abort）；**运行时 interrupt 分支无直接单测** | core：`session/tests.rs` 中断系列（事件序 10168-10270、Replaced 10783-10881、shell 中断 11471+）、`codex_delegate_tests.rs:144-225`、`app-server/tests/suite/v2/turn_interrupt.rs`、TUI `composer_submission.rs:1179` 等 |

**成熟度**：ClawX B-（链路通、门禁重、恢复半成品、运行时零测试）｜ Codex A（三层完备、幂等/竞态/事件序有测试、guardian 熔断兜底）。

### 1.2 引导（guide/steer）

| 层 | ClawX | Codex CLI |
|---|---|---|
| 类型 | `LongTaskInputMode='guide'|'revise-goal'`；guide policy：delivery='steer_active_run'、recordsSteeringEvidence、resumeTrigger='guide'（`long-task-control.ts:453-466`） | `steer_input` API（`session/mod.rs:3984-4057`）+ `TurnSteerParams`（`v2/turn.rs:170-196`，含 expected_turn_id、additional_context）；`TurnInput` 三态（`input_queue.rs:12-20`） |
| UI | guide 按钮（`ChatInput.tsx:2920-2926` testid `chat-intervention-guide`）+ Ctrl+Enter（`:2500-2511`）；运行中发送按钮默认=queue（`:2488-2498`）；**revise-goal 无任何 UI 入口**（仅运行时 `input-classifier.ts` REVISE_GOAL_PATTERNS 触发） | turn 活跃时提交消息自动走 `turn_steer`（`thread_routing.rs:664-727`）；`/side` `/btw` 侧边对话（`tui/src/app/side.rs`，单实例 fork）；`/goal` 线程目标（`thread_goal_actions.rs`）；plan mode、approval 附注 |
| IPC | 无独立 guide 方法：`chat.send`+`inputMode:'guide'` 透传（`electron/services/chat-api.ts:459-478`） | `turn/steer` RPC → `turn_steer_inner`（`turn_processor.rs:922-1029`）→ `Session::steer_input` |
| 运行时 | `chat.ts:3592-3661`：`queueEmbeddedAgentMessageWithOutcomeAsync(activeSessionId, inboundMessage, {steeringMode:"all", debounceMs:0})` → steering queue → LLM 循环下一轮消费（`agent-session.ts` steer/queueSteer）；成功→checkpoint（trigger:'guide'）+event 'steered'+respond `{steered:true}`；被拒/失败→fallback 事件后**静默降级普通 send**。注：该分支（`else if (taskLedgerRootId)`）**不校验 `mode==='guide'`**，且 `input-classifier.ts:49` 无显式模式时默认意图即 guide（置信度 0.45）——有 root 会话中普通消息也会先尝试 steering 注入 | `steer_input`：无活跃 turn→NoActiveTurn；expected_turn_id 校验；Review/Compact 拒绝（`ActiveTurnNotSteerable`）；输入并入 `pending_input` + `InputQueueActivity::Steer` watch 通知；`MailboxDeliveryPhase` 答案边界门控（`input_queue.rs:146-167,192-203`）；`try_start_turn_if_idle`（`inject.rs`，Plan/任务门控） |
| 多 agent | **无运行中 agent 消息/侧边对话**（角色编排模型：`RolesOrchestrationPanel`、`role-promotion-store`，非消息注入） | `send_message`（排队投递）/`interrupt_agent`/`wait_agent`/`spawn_agent`（`multi_agents_v2`，60+ 测试）；`realtime_conversation.rs` V2 实时 steer |
| 测试 | 策略层：`tests/unit/long-task-control.test.ts:13-27`；UI/IPC：`chat-long-task-control.spec.ts:340-377`（mock）；**运行时 steer 分支零测试** | core：`session/tests.rs` steer 系列（10607-10999：expected_turn 不匹配、非 Regular 拒绝、mailbox 重开等）；`input_queue.rs:294-481` 单测；TUI `chatwidget/tests/side.rs` |

**成熟度**：ClawX B-（注入真实但无验证、revise-goal 无入口、无 root 静默降级）｜ Codex A（steer 语义严谨、侧边对话+多 agent 消息生态完整、测试充分）。

### 1.3 排队（queue）

| 层 | ClawX | Codex CLI |
|---|---|---|
| 类型/存储 | **SQLite `long_task_user_queue` 表**（`openclaw-state-schema.sql:1078-1104`：pending/draining/drained/failed 四态、幂等键、session/status/ledger 三索引）；`LongTaskQueueItem`（`long-task-control.ts:151-168`）；queue policy：delivery='follow_up_after_run'、shouldAbortActiveRun=false、resumeTrigger='queue_drain'。**⚠️ 显式 queue 同样受 `/loop` root 门禁**（`chat.ts:3382` 对所有显式 inputMode 一律 `INVALID_REQUEST`） | 无用户级任务队列：`spawn_task` 是 **Replace-abort**（`tasks/mod.rs:319-329`）；队列 = session 级 mailbox FIFO（`input_queue.rs:35-52`）+ turn 级 `pending_input`（整批消费 `get_pending_input` :224-256） |
| UI | 排队提示：`chat-long-task-queue-count` testid、rollback panel drain 按钮（`chat-rollback-action-drain-queue`）；`chat.queue-status` 事件→`index.tsx:1762-1768` 刷新 | TUI 三队列：`queued_user_messages`/`pending_steers`/`rejected_steers_queue`（`chatwidget/input_queue.rs:22-45`）；turn 边界每次发一条（`input_flow.rs:136-179`） |
| 运行时 | 入队：`chat.ts:3450-3590`（checkpoint→`enqueueUserMessage` SQLite 幂等→event 'queued'→`chat.queue-status` 广播→`setQueueDrainCallback`）；**触发 drain**：run 结束 `clearEmbeddedAgentRun`（`runs.ts:812`）→`triggerQueueDrain`→`drainQueuedUserMessagesForSession`（`chat.ts:2700-2831`：claim→广播→新 run 竞态回滚 restore→checkpoint→合成 `chat.send` 合并多条消息重分发→complete/failed）；手动：`sessions.queueDrain` RPC | 消费在**采样边界**（`turn.rs:234,271-281,364-385`）；`MailboxDeliveryPhase` CurrentTurn→NextTurn（`stream_events_utils.rs:99-112`）；`trigger_turn` 邮件唤醒 idle session（`tasks/mod.rs:496-525`）；interrupt 丢未消费 steer（TUI 补偿 `input_restore.rs:124-155`） |
| 持久化 | **跨进程 SQLite，断线/重启存活**（`tests/unit/user-message-queue.test.ts:70-94` 直接验证 closeOpenClawStateDatabaseForTest 后队列仍在） | **无持久化**：turn 级 pending_input 是内存 Vec，重启丢失；TUI 三队列也在内存（仅 pending_start 竞态窗口内排队） |
| 测试 | 存储层：`tests/unit/user-message-queue.test.ts`（232 行：幂等去重 46-68、重启存活 70-94、失败恢复 96-122）；UI/mock：`chat-long-task-control.spec.ts`；**chat.ts queue 分支（入队/drain 合成重分发）无直接测试** | `input_queue.rs:294-481` 单测（FIFO 顺序、trigger 唯一性）；`session/tests.rs` 排队系列（10804-10999：答案边界 defer、steer 重开 mailbox、stale defer）；`composer_submission.rs`（排队/重试/interrupt 恢复） |

**成熟度**：ClawX B+（持久化+自动 drain+竞态回滚是真实亮点；存储层有测试；**但普通会话显式 queue 不可达——与 interrupt/guide 一样受 `/loop` root 门禁**）｜ Codex B+（turn 边界语义精细、多 agent mailbox 完备；但无用户级队列、无持久化）。

---

## 2. 能力清单差异（摘要）

| 能力 | ClawX | Codex CLI |
|---|---|---|
| 检查点+重启恢复（checkpoint→abort→restart） | ✅ 独有（ResumeCheckpoint + SQLite） | ❌ 无（fork/rollout 重建是另一语义） |
| 跨进程持久化用户队列 | ✅ 独有 | ❌ 无 |
| 运行中注入（不打断推理） | ✅ steer（steering queue） | ✅ steer_input（采样边界） |
| 侧边对话（/side /btw） | ❌ | ✅ |
| 运行中 agent 间消息（send_message 等） | ❌（角色编排模型） | ✅ |
| 打断携带指令（interrupt-with-instruction） | ✅（打断消息即新 run 起点，天然携带） | ⚠️ 分离（interrupt 无载荷 + steer 不打断） |
| guardian/审查熔断自动中断 | ❌ | ✅（GuardianRejectionCircuitBreaker） |
| 事件序保证（marker 先 flush） | ⚠️ 部分（checkpoint 先于 abort 写入是类似保证） | ✅ 显式 |
| 用户级排队消息合并投递 | ✅（多条 `\n\n` 合并） | ⚠️ 无用户级队列 |
| 排队消息失败重试 | ✅（restore→attempts+1） | ⚠️（仅 TUI 层 rejected 队列重试） |
| 运行中 UI 反馈（queue-status 事件） | ✅（事件+轮询） | ✅（watch/事件） |

---

## 3. 验证缺口（最优先关注）

> 状态更新（2026-07 实施后）：**P0 三项已闭环**（见 §6 标记）。以下保留历史描述并标注当前状态。

1. **~~ClawX 运行时 inputMode 三分支（interrupt/guide/queue，`chat.ts:3371-3661`）无直接单测~~** —— ✅ **已解决**：新增 `tests/unit/chat-send-input-mode.test.ts`（7 用例：门禁、协议校验、interrupt checkpoint-then-abort 顺序+幂等键、guide steered/fallback、queue 入队广播+drain 竞态回滚），全部直接调用 `chatHandlers['chat.send']`，不 mock chat.ts 本体。e2e 均 mock Host API 层；Codex 同类逻辑有全套 core 测试。这是两者成熟度差距的最大来源。
2. **restoreCheckpoint 的 event-log replay 未实现**（`sessions/run-control.ts:550`），恢复实际走 legacy 文件回滚，语义弱于设计意图。—— ✅ **部分解决（降级声明）**：authority 的 legacy 分支 evidenceSummary 明确"文件写入已回滚，运行态/外部副作用未恢复"；CheckpointsDialog 在 `legacy_checkpoint_fallback` 时展示"部分恢复"标注（4 语言 i18n）。**完整 replay 落地独立立项（3-5 人日）**。
3. **`interventionPolicyForInputMode` 生产侧死代码**（`long-task-control.ts:398-467`）—— ✅ **已解决**：runtime 侧新增 `intervention-policy.ts`（与 shared 同构，7 组组合 toEqual 一致性测试锁定）；`chat.ts:3399` 调用 policy（resumeTrigger 替换 trigger 推导、recordsDeviation/reviewRequired 控制 checkpoint 字段、confirmationRequired/reviewRequired 进事件审计面）；`LONG_TASK_INPUT_MODES` 常量消除三处白名单字符串重复。
4. **interrupt/guide/queue 三模式的 `/loop` Task Ledger root 门禁**（`chat.ts:3382`）：普通会话显式 inputMode（含 queue）一律 `INVALID_REQUEST` 且 UI 无前置提示；guide 无 root 时静默降级普通发送，用户无感知。—— ⏳ **未解决（P1）**：UI 前置提示尚未实现。
5. **revise-goal 无 UI 入口**（仅运行时分类器）。—— ⏳ **未解决（P1）**。

---

## 4. 相对优势（ClawX 领先项，保持）

- 检查点语义（证据/偏差/决策/验收快照）深于 Codex 的任何机制；
- 用户级队列跨进程持久化 + 重启存活 + 自动 drain 竞态回滚；
- 双通道打断（abort 与 checkpoint+restart 分离）给了"软/硬"两种中断粒度。

## 5. 参考来源（主要文件）

- ClawX：`shared/types/long-task-control.ts`、`openclaw_runtime/src/gateway/server-methods/chat.ts`、`openclaw_runtime/src/agents/user-message-queue.ts`、`openclaw_runtime/src/agents/long-task-control/store.ts`、`openclaw_runtime/src/state/openclaw-state-schema.sql`、`src/pages/Chat/ChatInput.tsx`、`src/pages/Chat/index.tsx`、`tests/unit/user-message-queue.test.ts`、`tests/e2e/chat-long-task-control.spec.ts`
- Codex CLI：`core/src/session/mod.rs`、`core/src/session/input_queue.rs`、`core/src/tasks/mod.rs`、`core/src/agent/control.rs`、`core/src/guardian/mod.rs`、`core/src/context/turn_aborted.rs`、`tui/src/chatwidget/interaction.rs`、`tui/src/app/side.rs`

---

## 6. 差异整改建议（只列建议，不实现）

按优先级 P0（验证/正确性风险）→ P1（体验缺口）→ P2（对等能力）排列。每条标注目标文件与建议验收标准。

### P0 — 验证与正确性

> 实施状态（2026-07）：**三项全部完成**，本清单保留为历史记录。

1. **~~运行时 inputMode 三分支补单测~~**（对标 Codex `session/tests.rs` 的 steer/abort 测试密度）—— ✅ **已完成**：`tests/unit/chat-send-input-mode.test.ts`（7/7 通过）。
   - 目标：`openclaw_runtime/src/gateway/server-methods/chat.ts:3371-3661`（interrupt/guide/queue 分支）
   - 建议：以 `tests/unit/user-message-queue.test.ts` 为模板（它已覆盖存储层），新增 chat 层测试：① interrupt：checkpoint 先于 abort 写入、幂等键、abort 后新 run 启动；② guide：steer 成功→'steered' 事件、被拒→fallback 降级；③ queue：入队→广播→drain 合成 chat.send 合并投递→drained/failed、`active_run_started_before_queue_drain` 竞态回滚。
   - 验收：三个分支各有 ≥1 个直接单测（不 mock 掉 chat.ts 本体）；`pnpm test` 通过。

2. **~~消除 `interventionPolicyForInputMode` 生产侧死代码或接线~~** —— ✅ **已完成**：runtime 侧 `intervention-policy.ts` 接线（`chat.ts:3399` 调用，resumeTrigger/recordsDeviation/reviewRequired 生效），shared 与 runtime 两侧 7 组组合 toEqual 一致性测试；`LONG_TASK_INPUT_MODES` 常量消除三处白名单字符串重复。
   - 目标：`shared/types/long-task-control.ts:398-467`
   - 建议：二选一——要么让 `electron/services/chat-api.ts:459-461` 白名单校验复用该 policy（`confirmationRequired`/`checkpointRequired` 等字段进运行时决策），要么删除并注明策略实际在 `input-classifier.ts` + `input-mode.ts` 实现。
   - 验收：`interventionPolicyForInputMode` 有生产引用或已删除（单测引用不计数），无生产侧死代码。

3. **~~restoreCheckpoint 的 event-log replay 落地或降级声明~~** —— ✅ **已完成（降级声明方案）**：authority legacy evidenceSummary 明确恢复粒度；CheckpointsDialog '部分恢复' 标注（4 语言 i18n）+ mode 断言单测；**完整 replay 落地独立立项（3-5 人日）**。
   - 目标：`openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts:501-574`
   - 建议：短中期把 `executeReplayRollback` 的 `{enabled:false}` 改为显式文档化降级（UI 标注"部分恢复"），长期按 `runtime_task_event_log_records` 表（schema 已建，`:1106-1122`）实现事件日志重放。
   - 验收：UI 恢复对话框明确标注恢复粒度；或 replay 实现后移除 legacy fallback。

### P1 — 可达性与体验

4. **interrupt/guide 门禁的前置提示**（对标 Codex 无此门禁——其 steer 对任何 Regular turn 可用）
   - 目标：`src/pages/Chat/ChatInput.tsx` 的 `canIntervene`（:1938）+ `chat.ts:3382-3396`
   - 建议：UI 在无 `/loop` Task Ledger root 时禁用 guide/interrupt 按钮并提示"需要 /loop 长任务上下文"；运行时错误透传 `INVALID_REQUEST` 原因到 toast，而非静默。
   - 验收：普通会话中打断/引导按钮有禁用态提示；e2e 断言提示文案。

5. **revise-goal 补 UI 入口**
   - 目标：`src/pages/Chat/ChatInput.tsx`（可复用 `/goal` slash 命令的 mission 语义）
   - 建议：打断面板增加"修改目标"入口，发送 `inputMode:'revise-goal'`，无 root 时提示。
   - 验收：`chat-long-task-control.spec.ts` 增加 revise-goal 透传断言。

### P2 — 对等能力（可选，按产品方向取舍）

6. **运行中 agent 间消息 / 侧边对话**（对标 Codex `/side` + `send_message`）—— **决策（2026-07）：不引入，记为设计差异**。ClawX 采用角色编排模型（`orchestrator.run` + 任务 DAG + 黑板 + verifier + `subagent-lifecycle` 事件），与 Codex 的消息传递模型（`/side` 临时 fork + `send_message`）是不同协作范式；运行时虽已有 `sessions_send` A2A 工具（默认关闭）与 `subagent-lifecycle` 事件等 80% 构件，但引入 side chat 属产品方向变更，非纯技术补缺。差距记录：无"运行中可寻址侧边对话"UI、A2A 默认关、`targetAgentId` 为会话切换语义。

7. **~~guardian 式自动中断兜底~~**（对标 Codex `GuardianRejectionCircuitBreaker`）—— ✅ **已完成（2026-07）**：新建 `openclaw_runtime/src/agents/guardian-circuit-breaker.ts`——会话级聚合器，阈值对标 Codex（连续 blocking ≥3 = `MAX_CONSECUTIVE_GUARDIAN_DENIALS_PER_TURN`；50 次窗口内 ≥10 = `MAX_RECENT_AUTO_REVIEW_DENIALS`），clean 复位连续计数、trip 保持至 reset；接入 task-loop（self-check 后 `record.controlSignals` 处）与 mission-control（reviewer 后）两条信号源，trip 时强制 `blocked` + 写 `audit_fail` checkpoint（该 trigger 此前无产生点，现由熔断器语义化使用）+ 停止 repair/tick 循环；单测 7 用例（连续 3 拒/窗口 10 拒/clean 复位/trip 保持/会话隔离/选项校验）。已知限制：普通 chat turn 不产生 `LongConversationControlSignal`（信号只来自 task-loop/mission），run 级失败观察为后续独立项。

---

## 7. 对齐核对矩阵（2026-07 真实 review 输出）

逐项对照 Codex CLI（`codex-rs/tui/src/slash_command.rs` 描述 + 运行时语义）核对 ClawX 实现。

### 7.1 slash 会话生命周期命令

| ClawX 命令 | Codex 命令 | Codex 语义 | ClawX 实现 | 对齐 |
|---|---|---|---|---|
| `/new` | `/new` | "start a new chat during a conversation" | `onNewSession` prop → `createWorkspaceScopedNewSession`（workspace-session.ts:70） | ✅ 一致 |
| `/resume <keyword>` | `/resume` | "resume a saved chat"（会话选择器） | 关键词匹配 `store.sessions`（label/key，按 updatedAt 降序取最近）→ `switchSession` | ✅ 等价（参数定位比选择器更快；无参数时提示用法） |
| `/rename <label>` | `/rename` | "rename the current thread" | `renameSession(currentSessionKey, label)`（空参数提示 renameNoArgs） | ✅ 一致 |
| `/archive` | `/archive` | "archive this session and exit" | `archiveSession(currentSessionKey)`（IPC 失败 throw → archiveFailed toast，修复后） | ✅ 一致 |
| `/delete` | `/delete` | "permanently delete this session"（含确认） | `window.confirm(deleteConfirm)` → `deleteSession(key)`（IPC 失败 throw → deleteFailed toast） | ✅ 一致（确认对齐） |
| `/clear` | `/clear` | "clear the terminal and start a new chat" | `clearSessionView`（停轮询+清缓存+消息/运行态复位，保留会话与服务端历史） | ⚠️ 语义差异：Codex 清屏+新对话；ClawX 本地清空视图。桌面端无"终端清屏"，该映射可接受，文档已记录 |
| `/copy` | `/copy` | "copy last response as markdown" | 复制最后一条 assistant 响应（本回合从"整个会话"修正为对齐 Codex） | ✅ 一致（修正后） |

### 7.2 运行时三模式

| 模式 | Codex 语义 | ClawX 实现 | 对齐 |
|---|---|---|---|
| interrupt | 中止当前 turn（纯中断，无载荷），`<turn_aborted>` marker | checkpoint → abort → 新 run 重启（带载荷=新消息即新 run 起点） | ✅ 语义等价（ClawX 更强：checkpoint 先写） |
| guide/steer | `steer_input` 注入 pending，下一采样边界生效，不打断推理 | steering queue 注入，LLM 循环下一轮消费，不打断 run | ✅ 一致 |
| queue | 无用户级队列（mailbox/turn pending）；TUI 层排队 | SQLite 持久化队列 + run 结束 drain + 竞态回滚 | ✅ ClawX 更强（用户级持久化） |

### 7.3 全量功能测试结论（2026-07 真实运行）

- **单测**：`pnpm test` 全链通过（无失败项）。
- **核心 e2e**：本会话新增/触及 spec 全部通过（slash-session-lifecycle 2/2、checkpoints 1/1、sidebar 3/3）；9 个失败全部为 `app.evaluate` 导航竞态（Execution context destroyed），与会话前文档记录的 pre-existing 问题一致，非本会话功能缺陷。
- **功能可用性 review**：7 命令均真实可触发/可完成/有反馈；修复了 2 个真实缺陷（/archive /delete IPC 失败仍弹成功 toast；/clear 状态复位不完整）与 3 个 nit（/resume 排序、/copy 文案、policy 注释）。
- **安全 review**：pass（无注入面；剪贴板/错误文案 2 个低风险观察项）。
