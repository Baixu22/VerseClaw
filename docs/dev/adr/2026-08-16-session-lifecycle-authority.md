# ADR-2026-08-16：会话生命周期权威边界（Session Lifecycle Authority）

| 字段 | 值 |
|---|---|
| 状态 | `accepted`（用户定稿；后续开发以 harness 开发规范为准，不再重新辩论） |
| 日期 | 2026-08-16 |
| 基线 | `033469f07`（工作树 dirty） |
| 范围 | Session stop/reset/delete、Goal 干涉、终端/进程/子 agent 资源回收 |
| 关联文档 | 唯一开发规范 `harness/specs/tasks/runtime-lifecycle-governance.md`；规则 `harness/specs/rules/runtime-lifecycle-governance-boundary.md`；说明 `docs/dev/runtime-lifecycle-governance/README.zh-CN.md` |

---

## 1. 决策

### 决策 1：命令式生命周期 + 原子 admission gate

- 不建 `SessionDesiredState` / `SessionReconciler`。
- 新增 `SessionAdmissionRegistry`：进程级 global singleton，身份 `agentId + canonicalSessionKey + expectedSessionId`。
- 所有副作用入口（chat.send、admitReplyTurn、runEmbeddedAgent、sessions_send queue、subagent/ACP spawn、process spawn、Electron terminal open）先拿 permit。
- reset/delete 用 `fence(identity)` 原子关闭入口并等待临界区结束，返回独占 token。
- delete 后保留 tombstone；只有显式 create 开新代。

### 决策 2：`cleanupSessionBeforeMutation` 是唯一 finalizer

- 顺序：fence → clear queues → abort parent → recursive abort children → wait quiescence → drainScope(timeout) → other owners → mutation。
- drainScope 成功条件：owner handles 全部完成 + OS containment 为空 + registry 无新记录。
- 任一 wait/tree/身份检查 timeout/unknown => 拒绝 mutation。
- `cancelScope` 只作 kill 原语；`stopSubagentsForRequester` 只作 abort 原语。

### 决策 3：delete 采用 generation-aware operation journal

- canonical store = per-agent SQLite `cache_entries`；runtime 是唯一写入者。
- Electron 首请求前生成并持久化 `operationId`；manifest 含 `expectedSessionId` 和确定性 archive plan。
- 幂等：同 ID 同 digest 返回旧结果；同 ID 不同 digest conflict。
- 提交：`cache_entries` 删除与 `store_committed` journal event 在同一 immediate transaction。
- retry：intent 继续；store_committed 不重复删；runtime_committed 返回 receipt；generation 不同 conflict。
- runtime 失败/unknown：Electron 不 sweep、不解 fence。

### 决策 4：资源留在 owner，不建通用资源事实表

- 进程：ProcessSupervisor / VerseShell（future owner）。
- 子 agent：SubagentRegistry。
- 终端：TerminalSessionManager。
- 端口：ResourceTracker。
- `SessionActivity` 是唯一跨 owner 读模型，补 goal/process/lineage。

### 决策 5：终端策略

- 默认 `keep_on_leave`。
- 关闭：显式 End、session reset/delete、权限收紧、workspace switch/delete、app quit。
- `idleTtlMs = 0`；`workspace cap = null`（有证据后只做 admission rejection）。
- 全局列表用 `terminal.list({})`；修 terminal-api 默认补 active workspace 的问题。

### 决策 6：Goal / Handoff / Fork

- Goal 命令式 API 不变。
- Handoff 保持只读；源 session、源 goal 不变。
- Fork 只继承 transcript/workspace/模型偏好；goal 转移待产品决策。
- `continuationTurns` 不引入新语义。

### 决策 7：Goal Loop Durable Process Wake 并入本程序

- 已并入唯一开发规范 `harness/specs/tasks/runtime-lifecycle-governance.md`，按 Phase 0-6 与量化验收执行。
- goal 真相 = `mission_runs`；wait 真相 = `flow_runs(controller_id=goal-wake)`；goal-owned process 真相 = `task_runs(runtime=process)`。
- 普通 exec/process 仍归 native supervisor，不持久；只有 `wait="goal"` 创建 durable process run。
- 会话 reset/delete 必须 invalidate `ownerEpoch`，取消 helper，finalize task/flow，删除 runDir。
- Wake 是 at-least-once；验收只要求重复投递不产生重复副作用。

---

## 2. 后果

正：清理顺序、admission、delete 幂等和 drain 判定都有可执行、可验证的契约。
负：需要在每个副作用入口接 permit，改动面大于“只补 cancelScope”；delete 协议要新增 operation journal。
