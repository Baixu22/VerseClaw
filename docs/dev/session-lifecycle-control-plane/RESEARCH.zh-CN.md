# 主流设计调研与映射（Session Lifecycle Control Plane）

> 状态：draft / 待评审
> 日期：2026-08-16
> 方法：Anysearch 外部检索 + 当前 ClawX/OpenClaw 源码审计。
> 目的：回答“这不是 agent 工具链内部问题，而是一套可类比成熟软件系统的控制平面问题”。

---

## 1. 检索到的设计家族

| 家族 | 代表 | 核心思想 | 我们该借鉴什么 |
|---|---|---|---|
| Durable Execution / Workflow | Temporal、Azure Durable Functions、AWS Step Functions、Dapr Workflow | 工作流状态持久化在外部；worker 无状态；每个步骤可恢复、可重放、可补偿 | Session/Run 不是进程内对象，而是 durable workflow；工具调用是 activity，必须有幂等键 |
| Agent runtime 五件套 | “Long-Running AI Agent Runtime: Sessions and Checkpoints”（slavadubrov.github.io） | 显式命名 Session log / Harness / Sandbox / Checkpoint / Trace | 我们应把这五件套作为第一性架构检查表 |
| Declarative Control Loop | Kubernetes controller、Operator SDK、Cluster API | spec=desired，status=actual；controller 循环 reconcile；level-triggered | 会话操作改为声明式意图 + reconcile，而不是散落的命令式清理 |
| Supervision Tree | Erlang OTP、Akka | 父子树；父停则子递归停；restart strategy；失败向上传播 | session → run → subagent → process/terminal 应是一棵 ownership tree |
| Process containment | systemd scope/transient unit、cgroup、Windows Job Object | 进程归组管理；scope 结束时整组回收；迟退出进程也能被追踪 | 每个 session/run 的资源应归属一个“scope”，按组 kill 和 reconcile |
| Lease / Ownership | Chubby、etcd、K8s Lease | 锁必须有 TTL + heartbeat + fencing token | 资源 ownership 不能只靠 pid；要 lease + epoch，重启后过期/续租/lost |
| Saga / Compensation | Microservices.io、Azure Architecture Center、Temporal Compensations | 长事务拆为本地事务 + 补偿动作；orchestration vs choreography | session 的 create/fork/handoff/delete 是 saga，不是一次函数调用 |
| Control / Data / Management plane | HashiCorp Well-Architected、Azure multitenant、Cloudflare Durable Objects、Service Mesh | 决策、执行、管理三层分离 | 把 agent 工具执行当 data plane，生命周期决策当 control plane，UI 当 management plane |
| Session as first-class resource | AWS Bedrock Session Management APIs、OpenAI Agents SDK sessions、LangGraph checkpoint/thread | session 是可寻址、可恢复、可 ACL 的资源，不只是消息数组 | 现有 sessions.list/activitySnapshot 应向这个方向收敛 |
| Session-as-a-Service / pool | Microsoft Windows 365 Agents session lifecycle | Prepare → Acquire → Connect → Act → Release | 这几乎就是我们的会话池模型：provision → attach → run → handoff → release |

---

## 2. 关键证据摘录

### 2.1 Durable execution 不是“重试”

- Temporal 体系：workflow 状态在 cluster，worker 无状态；LLM call / 工具调用是 activity，独立重试；副作用靠幂等键。
- Vadim's Durable Execution guide：durable layer 记录 intent → 调用 LLM → 记录结果；恢复时发现 pending call，带着同一个幂等键重试。
- Zylos 调研：LangGraph 是最强 agent-native checkpoint；但 session memory ≠ durable execution；“node boundary 必须被工程化为 replay boundary”。

→ 对应我们的现状：transcript 有，但 `ProcessSession` 在内存、`ProcessSupervisor` no-op reconcile、session transition 没有 journal。**缺口正是 durable execution 层。**

### 2.2 Kubernetes reconcile 的四个要点

- `.spec` 是想要的状态，`.status` 是观察到的状态，controller 永远把 actual 拉向 desired。
- level-triggered，不是 edge-triggered；控制器可能错过中间事件。
- 失败 requeue + backoff，一个 item 同一时间只有一个 worker。
- 状态写入只由 controller 的 status 更新，避免双写。

→ 对应我们的现状：`createWorkspaceScopedNewSession` 只是改 key，没有声明“旧 session 的 terminal 应该关闭”；进程注册表没有 desired state。**应该为 session 资源建立 desired/actual reconciliation。**

### 2.3 Supervision tree 的父子生命周期

- Erlang OTP：supervisor 有 `one_for_one / rest_for_one / one_for_all`，child spec 声明 shutdown 策略。
- Akka：parent stop 会递归 stop 所有 children；restart 会处理 children；DeathWatch 用于监控。
- systemd：transient scope 结束自动回收；最后进程退出后再清理 cgroup；晚退出进程也要追踪。

→ 对应我们的现状：已有 `stopSubagentsForRequester` 递归，但没有把 **child session 的进程** 和 **workspace terminal** 挂到同一棵树。

### 2.4 Lease 的核心

- Chubby/K8s Lease：锁必须有 TTL；holder 心跳续租；fencing token 防止旧 owner 回来乱写。
- 资源 ownership 不靠“谁记得 pid”，靠“谁持有未过期 lease”。

→ 对应我们的现状：进程注册表只有 pid + startedAt；没有 lease/epoch。重启后无法安全判断 PID 复用。**资源账本必须带 lease_key + heartbeat + cleanup_after。**

### 2.5 Saga 与 compensation

- orchestration saga 有 pivot transaction（go/no-go）和 compensating transaction。
- 不是每个步骤都可逆；补偿可能失败，失败必须可见。

→ 对应我们的现状：fork/handoff/delete 涉及 transcript、goal、checkpoint、资源、lineage 多个 owner。**必须建模为 saga，失败时明确 rolled_back/partial/lost，不假装成功。**

### 2.6 Session 是 first-class resource

- AWS Bedrock Session Management APIs：checkpoint 阶段、保存中间态、恢复失败点、pause/replay、IAM 隔离、加密。
- LangGraph：thread_id 是隔离边界；checkpoint 是恢复点；store 是跨 thread 长期记忆。
- OpenAI Agents SDK：sessions 是持久化的 conversation item 集合，支持 SQLite/Redis 等 backend。

→ 对应我们的现状：SessionEntry + transcript 已经接近，但桌面投影丢掉 goal，activity 不含 process，控制 API 不完整。方向是把 Session 升级为完整受管资源。

### 2.7 Windows 365 Agents session lifecycle

- `Prepare > Acquire > Connect > Act > Release`。
- Acquire 返回可重试而不重复分配 session 的 reservation identity。
- Release 关闭 channel、重置 Cloud PC、容量回池。

→ 这正是我们 session 池想要的形态：**reserve 一个 session → attach 资源 → 执行 → 显式 release**。

---

## 3. 重新表述我们的系统

我们的会话系统不是“聊天窗口 + 工具调用”，而是：

> **一个局部的、面向 agent workload 的控制平面**：
> 每个 session 是一个可寻址的、带 lineage、goal、checkpoint、resource set、lease 的受管 workload；
> Gateway/runtime 是 control plane，agent loop/tool/terminal/subagent 是 data plane，UI/model tools 是 management plane。

这个类比解释了我们当前为什么“功能都在、治理散落”：

| 系统类别 | 对应我们 |
|---|---|
| K8s `.spec/.status` | `SessionDesiredState`（想要：running/paused/forked/handed-off/deleted） vs `SessionActualState`（现在：run 状态、资源状态、goal 状态） |
| Controller / Reconcile | `SessionReconciler`：观察 actual，执行 transition 或 requeue |
| OwnerReference / Finalizer | `session_resources.owner_session_key` + session delete 前必须 drain 的 finalizer |
| Supervision tree | `session → run → subagent → child session → process/terminal` |
| systemd scope | 每 run/每 session 一个 resource scope；scope 结束时 kill 整树 |
| Lease | 每个资源带 lease；heartbeat 丢失则 reconcile 为 lost |
| Saga | create/fork/handoff/delete 是带 compensation 的 saga |
| Durable Execution | session_runs/session_transitions 是 event-sourced，restart 后 resume 或标 lost |
| Session-as-a-Service | 桌面“新对话”本质是 acquire 一个新 session handle，而不是只切 key |

---

## 4. 对原设计的三处修正

1. **从“API 编排”提升为“声明式控制循环”**：
   - 不要只做 `sessions.stop/pause` RPC；
   - 要维护 `session_desired_state`，由 reconciler 把 actual 拉向 desired。
   - 交互式 API 只是写入 desired state 的入口。
2. **所有资源都走 OwnerReference + Finalizer + Lease**：
   - spawn 前登记 owner；
   - delete 先 finalize（drain）再 tombstone；
   - 进程/终端所有权不是 pid，而是带 heartbeat 的 lease。
3. **fork/handoff/delete 按 saga 实现**：
   - 每个 transition 有 pivot 点；
   - 每步有 compensation；
   - transition journal 保留中间态和失败态。

---

## 5. 外部来源索引

- Temporal durable AI agents：https://activewizards.com/blog/indestructible-ai-agents-a-guide-to-using-temporal
- Durable execution for LLM agents：https://vadim.blog/durable-execution-llm-agents
- Durable execution agent runtimes（Zylos）：https://zylos.ai/research/2026-04-24-durable-execution-agent-runtimes/
- Long-running AI agent runtime：https://slavadubrov.github.io/blog/2026/05/26/ai-agent-runtime/
- Kubernetes controllers：https://kubernetes.io/docs/concepts/architecture/controller/
- K8s desired vs actual：https://www.golinuxcloud.com/desired-state-vs-actual-state-kubernetes/
- K8s Leases：https://kubernetes.io/docs/concepts/architecture/leases/
- Erlang OTP supervision：https://www.erlang.org/doc/apps/stdlib/supervisor.html
- Akka supervision：https://doc.akka.io/libraries/akka-core/current/general/supervision.html
- systemd transient scope：https://man7.org/linux/man-pages/man5/systemd.scope.5.html
- Saga pattern：https://microservices.io/patterns/data/saga.html
- Temporal sagas/compensations：https://temporal.io/blog/compensating-actions-part-of-a-complete-breakfast-with-sagas
- Control/data/management planes：https://developer.hashicorp.com/well-architected-framework/design-resilient-systems/design-control-data-management-plane
- Azure multitenant control planes：https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/control-planes
- AWS Bedrock Session Management APIs：https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-launches-session-management-apis-for-generative-ai-applications-preview/
- LangGraph persistence：https://docs.langchain.com/oss/python/langgraph/persistence
- Microsoft multi-agent reference architecture：https://microsoft.github.io/multi-agent-reference-architecture/docs/reference-architecture/Reference-Architecture.html
- Windows 365 agent session lifecycle：https://learn.microsoft.com/en-us/windows-365/agents/agent-session-lifecycle

### 2.8 OwnerReferences + Finalizers（K8s GC）

- OwnerReference 声明依赖；父删除时按 foreground / background / orphan 三种传播策略回收。
- Finalizer 处理 Kubernetes 不认识的外部资源：先给对象加 finalizer，再创建外部资源；删除时先 cleanup，成功后才移除 finalizer。
- 关键纪律：**cleanup 必须幂等**、**不能无限阻塞**、**崩溃后 requeue**。

→ 对应我们：session_resources 需要显式 owner chain 和 finalizer；PTY/进程 kill 属于 external cleanup，必须幂等、有超时。

### 2.9 Windows Job Objects

- Job Object 把一组进程作为 unit 管理；子进程默认继承 job；`TerminateJobObject` 一次杀掉整组。
- 常用于“父进程死亡，子进程树也死亡”的进程守护。

→ 对应我们：每个 session/run 可以有一个 process scope；Windows 用 Job Object，Linux 用 process group + cgroup，现有 killProcessTree 只是兜底。

### 2.10 Restate Virtual Objects

- 每个 key 只有一个 virtual object；同一 key 的 handler 串行；状态和调用进度 atomically commit。
- durable log 是 ground truth；replay 时非确定性副作用放 `ctx.run` 或 memoize。

→ 对应我们：Session 非常适合建模为 virtual object / single-writer actor；同一 session 的 transition 串行，杜绝并发 fork/delete/drain。

### 2.11 Step Functions task token / awaitable

- 工作流等待人工或外部系统时，park 在 awaitable，不占计算；外部持 task token 回调 `sendTaskSuccess/Failure`。

→ 对应我们：approval / user intervention / handoff 都是 awaitable，而不是 busy poll；现在 session activity 的 poll 应替换为 parked run + 事件唤醒。
