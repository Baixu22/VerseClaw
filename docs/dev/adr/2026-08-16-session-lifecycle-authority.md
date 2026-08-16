# ADR-2026-08-16：会话生命周期权威边界（Session Lifecycle Authority）

| 字段 | 值 |
|---|---|
| 状态 | `proposed`（待评审；批准前不实施） |
| 日期 | 2026-08-16 |
| 基线 | `033469f07`（工作树 dirty） |
| 范围 | Session create/stop/pause/resume/fork/handoff/reset/delete、Goal 干涉、终端/进程/子 agent 资源回收 |
| 关联文档 | `docs/dev/session-lifecycle-control-plane/DESIGN.zh-CN.md`、`docs/dev/session-lifecycle-control-plane/RESEARCH.zh-CN.md`、`docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md` |

---

## 1. 背景

审计确认当前会话系统不缺信息源，缺一个统一的控制平面：

- 桌面新对话只改 workspace 的 `activeSessionKey`，不回收旧 session 的 PTY。
- 运行时 session reset/delete 清理了 subagent/browser/MCP/ACP/queue，但不清理 `bash-process-registry` 和 `ProcessSupervisor`。
- `sessions.list` 返回 goal，但桌面 `ChatSession` 丢弃；SessionActivity 没有 goal 和后台进程。
- Fork/handoff、goal、资源回收分别存在于多个模块，没有统一 transition 语义。


### 决策 0：把会话系统建模为“面向 agent workload 的控制平面”

外部主流设计（Temporal durable execution、K8s reconciliation、Erlang/Akka supervision tree、systemd scope、Lease、Saga、Control/Data/Management plane、Session-as-first-class-resource）共同指向同一结论：会话不是聊天对象，而是带 desired/actual state、资源树、租约和 lineage 的受管 workload。

- SLCP = control plane（决策 + reconciliation）
- agent loop / tool / terminal / subagent = data plane（执行）
- UI / model tools / host API = management plane（命令与投影）

## 2. 决策

### 决策 1：在现有 authority 之上新增薄层 SLCP，不重写

Session Lifecycle Control Plane 拥有 **transition 编排和 transition journal**：

- 所有 effectful session 操作必须带 intentId / idempotencyKey / revision。
- SLCP 负责 admission、checkpoint、资源 drain、canonical owner 调用、事件发布。
- SLCP 不拥有 session identity、transcript、workflow、子 agent、进程执行。

非 owner 禁止：
- renderer 直接 kill OS 进程；
- UI 直接推断/覆盖 session 状态；
- 新模块双写 session store 或 flow state。

### 决策 2：资源必须有 owner chain 和显式 cleanup policy

所有资源（terminal/process/subagent/browser/server/mcp/acp）统一投影到持久资源账本 `session_resources`，必须包含：

- `owner_session_key`
- `owner_run_id`
- `owner_task_id`
- `parent_resource_id`（用于子 agent 进程链）
- `cleanup_policy`：`close_on_leave | keep_on_leave | kill_on_session_delete | cascade | idle_ttl`
- `lease_key`、`last_heartbeat_at`、`cleanup_after`

进程级 `bash-process-registry` 和 `ProcessSupervisor.registry` 降级为热缓存；重启后用账本 reconcile，running 无法重新拥有则标 `lost`。

### 决策 3：离开会话 ≠ 结束会话

- **离开/切换/新会话**：关闭交互终端；后台进程保留但必须在 Resource Center 可见、可 kill、可过期。
- **stop/reset/delete/handoff**：按 cleanup policy 递归 drain。
- 保留“普通 run abort 不杀后台进程”的重连语义，不扩大为 session 级语义。

### 决策 4：Goal 双轨，不新建 workflow 权威

- 轻量目标继续用 `SessionGoal`。
- 多步 workflow 目标继续向 `TaskFlow/TaskRegistry` 收敛。
- SLCP 只提供 `goal.create/update/clear/fork/handoff` 的 transition 编排。
- `continuationTurns` 在 fork/handoff/resume 时递增。

### 决策 5：pause 不伪装成“冻结模型推理”

`pause` = gate + checkpoint + abort active run；`resume` = 开 gate + 从 checkpoint/queue 续跑。不做底层模型推理冻结。

## 3. 后果

正：
- 终端/进程泄漏路径被关闭。
- 所有 session 操作可幂等、可审计、可 reconcile。
- UI/模型/命令共享一套语义，不再各写一套清理。

负：
- 需要新增 SQLite 表与 transition 层，启动路径和 spawn 路径增加少量写入。
- 需要迁移现有内存注册表调用点。
- pause/fork/handoff 的产品语义需要评审确认。

## 4. 待评审问题

1. 模型是否应获得 `session.stop/pause/fork/handoff`，还是仅 operator UI？
2. `handoff` 默认是否转移 Goal，还是复制 Goal？
3. 离开会话时后台进程默认保留还是默认停止？
4. 进程账本是否落盘 command 摘要（推荐只落 digest/label，不落全文）？
