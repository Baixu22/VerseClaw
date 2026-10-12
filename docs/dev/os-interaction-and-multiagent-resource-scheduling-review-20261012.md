# 操作系统交互层 / 多 Agent 并发资源调度：现状评审与 Manus 对照

- Date: 2026-10-12
- Type: review / gap-analysis（非实现型 spec，无冻结默认值改动）
- driven_by: agent
- actor: arena-agent
- Base: `arena/25ea6e43-verseclaw` @ `0f39d3ac`
- 相关既有记录：#162（p1-terminal-exec-lease）、#167（p2-subagent-workspace-lease）、#154（p1-outbound-concurrency-budget）、#155（p1-windows-job-limits）、#160（verseshell-process-start）

> **证据纪律声明**：本文对 VerseClaw 的每一条判断都绑定到仓库内可核对的源码路径与常量。对 Manus 的部分严格分为「公开披露」与「推断」两类，推断部分明确标注，不作为事实引用。本文**不提出任何性能提升结论**，也不修改任何冻结默认值。

---

## 0. 结论摘要（先看这一页）

| 维度 | VerseClaw 现状 | Manus 公开模型 | 判定 |
|---|---|---|---|
| 并发隔离单元 | 进程内信号量（lease）+ 策略层 | 每任务一台完整 VM | **Manus 结构性领先**（强隔离 / 可丢弃） |
| 共享资源调度 | 5 类 lease、路径冲突检测、有界队列 | 不存在该问题（不共享） | **VerseClaw 结构性领先**（在 Manus 回避掉的维度上真正做了解法） |
| 调度是否自适应 | 否。容量是硬编码常量，wave 计划不可重规划 | 由 VM 分配器横向扩容 | **均不足，但量级不同** |
| KV 缓存纪律 | 有，且已进 CI 回归（`live-cache-regression`） | 有，且被列为生产第一指标 | **基本对齐**，VerseClaw 缺「指标化」这一层 |
| 操作系统级调优 | `oom_score_adj`、Windows Job Object、进程树残留校验 | 未公开 | **VerseClaw 领先**（公开可查范围内） |
| 内存/进程资源核算 | 基本缺失（只有单命令 Job 限额） | VM 已声明 vCPU/RAM | **VerseClaw 最大缺口** |
| 快速重置（snapshot） | 无（`policy-light` 明确不是边界） | VM 快照 / 每任务新 VM | **Manus 结构性领先** |
| 故障语义 | 类型化拒绝 + 诊断字段 + doubleRelease 计数 | 未公开 | **VerseClaw 领先** |

**一句话**：VerseClaw 和 Manus 在操作系统交互上是**镜像架构**。Manus 用「一人一台机器」把共享资源问题**消除**掉；VerseClaw 在用户真实机器上跑 N 个 agent，被迫**解**这个问题。结果是 VerseClaw 在「共享资源的细粒度调度」上客观比 Manus 公开的模型更精细，但在「隔离、可丢弃性、内存核算、快速重置」四个维度上存在结构性差距。**优化重点不应是模仿 VM-per-agent，而应是补齐「压力反馈 + 内存核算 + 快速重置」三件事，同时守住本地优先的性能红利。**

---

## 1. VerseClaw 当前与操作系统交互的全貌

这一层散落在三个进程边界里，先立地图再评估。

```
Electron Main 进程                          Gateway / Runtime 进程
┌────────────────────────────┐              ┌─────────────────────────────────┐
│ terminal-api                │              │ agents/verseshell/process-mgr   │
│   └─ resource-leases.ts     │              │   (maxProcesses 8, idleTtl 5min)│
│      workspaceExec  cap=2   │   RPC 跨进程 │   └─ VerseShell ACI 子进程       │
│      acquire timeout 30s    │ ───────────► │       ├─ Windows Job Object      │
│ resource-tracker.ts         │   无共享计数 │       │   (kill-on-close / mem)   │
│   30s 端口心跳 / 30min 回收  │              │       └─ Linux oom_score_adj=1000│
└────────────────────────────┘              │ agents/resource-leases.ts        │
                                            │   workspaceExec    2             │
                                            │   workspaceSearch  2             │
                                            │   workspaceWriter  1   (无调用点) │
                                            │   subtreeMutation  1   (无调用点) │
                                            │   fileMutation     1             │
                                            │ infra/bounded-concurrency.ts     │
                                            │ process/command-queue.ts (5 lanes)│
                                            │ agents/provider-outbound-budget  │
                                            │ process/os-containment.ts        │
                                            └─────────────────────────────────┘
```

### 1.1 已经做得好的部分（客观）

**(a) 租约内核的设计质量高于「够用」水平。**

`openclaw_runtime/src/agents/resource-leases.ts` 与 `electron/services/resource-leases.ts` 共享同一套结构：per-`(kind,key)` FIFO、有界等待、类型化超时。特别是两个细节：

- `normalizeWorkspaceLeaseKey` 用 `realpathSync.native` + Windows 大小写/分隔符归一，让同一 workspace 的**大小写变体、斜杠变体、realpath 别名共享同一预算**。这是很实务的正确性处理——很多系统在这里会静默地把容量翻倍。
- path 模式（`subtreeMutation` / `fileMutation`）用 `pathKeysConflict` 做**子树重叠检测**，而非字符串相等。这意味着 `edit a/b.ts` 与 `write a/` 会互相阻塞。这是真正的路径级并发控制，比「同一文件加锁」更强。

**(b) 故障语义是类型化的，而不是布尔值。**

`infra/bounded-concurrency.ts` 把拒绝原因分成 `overloaded` / `queue-timeout` / `aborted` 三类，并统计 `doubleRelease`（重复释放计数）与 `peakActive` / `queuedWaitMaxMs`。`ResourceLeaseTimeoutError` 携带 `leaseKind`、`leaseKey`、`queuedMs`、`timeoutMs` 四个诊断字段，且 `p1` 文档把 admission timeout 在 trace 里归类为 `timeout` 而非泛化失败。**这比大多数生产级 agent 运行时做得好**，因为「为什么排队」这个信息在事后排障时是刚需。

**(c) 操作系统级调优有真实证据，且诚实标注边界。**

- `process/linux-oom-score.ts`：通过 `/bin/sh` shim 在 post-fork 子进程里写 `1000 > /proc/self/oom_score_adj` 然后 `exec`。解决的问题很具体——长驻 gateway 的 RSS 通常最大，内核 OOM 时会优先杀它而不是瞬态 worker。这个 shim 还顺手剥掉 `BASH_ENV`/`ENV`/`CDPATH`，避免变成 env 注入的执行原语。**这是典型的「懂 OS」而不是「懂框架」的代码。**
- `p1-155-windows-job-limits-20261011.md`：走的是 `JOB_OBJECT_LIMIT_ACTIVE_PROCESS` + `JOB_OBJECT_LIMIT_PROCESS_MEMORY` + `KILL_ON_JOB_CLOSE`，fail-closed（`SetInformationJobObject` 失败即报 `E_EXEC_JOB`），并且**给出了真实行为证据表**（`maxProcesses: 1` 时子进程 spawn 被拒 `exitCode=9`；64 MiB cap 下 256 MiB 分配失败）。文档同时明确写出残留：无 `QueryInformationJobObject` 回读、无 CPU 限速、`JOB_OBJECT_LIMIT_PROCESS_MEMORY` 是**每进程 commit 限额而非 job 总量**。这种「说清楚限额的语义边界」的做法应当被当成规范延续。
- `process/os-containment.ts`：进程树捕获 + **PID 复用 token 校验**（`CreationDate.ToFileTimeUtc` / `/proc`）、512 节点上限、5s 探测超时、5s 残留沉降。

**(d) 缓存层已经覆盖到「与 Manus 同一门课」的范围。**

- Prompt/KV 缓存纪律是真实存在的，不是口号：`prompt-cache-stability.ts`（newline/trailing-whitespace 归一 + capability id 去重排序）、`prompt-cache-retention.ts`、`provider-payload-cache-shape.ts`、`system-prompt-cache-boundary.ts`、`openai-prompt-cache-payload.ts`、`google-prompt-cache.ts`，并且有 `live-cache-regression-{baseline,report,runner}.ts` + `.github/workflows/live-cache-regression.yml` 做回归。**这直接对应 Manus 的第一条经验（稳定前缀 / 确定性序列化）。**
- 进程级复用：`verseshell/process-manager.ts` 的 `idleTtlMs`（默认 5 min，`idleSweepMs` 取 `min(60s, idleTtl)`）、`maxProcesses`（默认 8）、每进程 `maxConcurrency` 4 / `maxQueueSize` 64。
- 句柄级复用：`acp/control-plane/runtime-cache.ts` 是 touch-aware 的 runtime handle 缓存，带 idle 淘汰与 `configSignature` 复用判定。
- 快照级复用：`agents/bootstrap-cache.ts`（最多 64 个 session 的 workspace bootstrap 快照，逐字段等值比较）。

**(e) 有界队列的样板是统一的，没有第三套设计。**

`bounded-concurrency.ts` 被 `provider-outbound-budget.ts` 复用（per quota group = endpoint + 凭据 SHA-256 判别子，且**默认不设限**，符合「禁止把示例并发数冻结成产品默认值」的约束）。`.` 这种「一份内核多处复用」比每处各写一个 semaphore 健康得多。

### 1.2 结构性缺口（按严重度排序）

#### 缺口 1（最高）：**调度器是准入控制，不是调度器**

现有的所有机制——lease、lane、wave——做的都是**准入**：数一数有几个在跑，超了就排队。**没有任何组件测量真实机器压力**，也没有任何组件根据压力改变容量。

具体证据：

- 容量是 `const RESOURCE_LEASE_CAPACITY` 硬编码常量（2/2/1/1/1），`WORKSPACE_EXEC_CAPACITY = 2`。
- 16 核 64 GB 的开发机和 4 核 8 GB 的笔记本站同一套常量。
- `agents/resource-aware-wave-scheduler.ts` 的 `DEFAULT_MAX_WORKERS = 64` 是静态上限，且**wave immutability 会拒绝已启动 wave 的重规划**（`{ accepted: false, reason: "wave_started" }`）。这个不可变性作为安全属性是对的（避免在飞行中改预算），但当前实现意味着**压力升高时无法收缩并发**。

后果：所有 8 个 subagent 会同时冲到 `workspaceExec` 门口，然后一起吃 30 秒的排队超时，而不是「先跑 2 个，跑完再放 2 个并且根据 CPU 空闲度决定要不要放第 3 个」。

#### 缺口 2（最高）：**跨进程租约不收敛，实际容量被静默放大**

`p2` 文档自己写明了这一点：

> **Per runtime process.** … Main `terminal.run` keeps its own `workspaceExec` lease from #162; the two are independent because they live in different processes.

也就是说，同一个 workspace 的真实并发上限是 **Main 的 2 + runtime 的 2 + （每个额外的 runtime 进程各 2）**。租约的语义是「预算」，但两个不通信的预算加起来不是预算。Manus 的对应物是单一 VM 分配器，不存在这个问题。

#### 缺口 3（高）：**内存与进程数没有账户**

有一堆 per-command 的限额（VerseShell Job Object、`maxProcesses: 8`、`maxConcurrency: 4`），但**没有「这个 agent 总共能占多少内存」这个概念**。具体缺失：

- Gateway 自身 RSS、Chromium/Playwright 上下文、LSP 子进程、node worker 的 RSS 全都没有采样。
- `linux-oom-score.ts` 是对症缓解，不是核算。
- Job Object 的 memory 限额只在「operator 显式声明」时才发（#155：`With nothing declared the admission is a no-op`）。
- `shared/agent-resource-limits.ts` 管的是 **token / 成本 / turn 超时 / DOM 行数**，不是系统资源。

后果：8 个 subagent 各自拉起浏览器上下文 + LSP，机器进入 swap，用户体验是「全局卡死」，而日志里一切正常——因为没有任何指标在观测这件事。

#### 缺口 4（高）：**没有快速重置**

`docs/runtime-design/area-1-layered-execution-isolation.md` 明确承认：

> The system cannot create per-turn filesystem snapshots or overlays for `policy-light` mode. It can block or approve operations, but it cannot cheaply reset a turn's writes.

对比 Manus：一个 subagent 跑炸了，损失的是一台 VM。VerseClaw 里跑炸了，污染的是用户的真实工作区。`policy-light` 文档也很诚实地写了「不是容器/VM 边界」。

#### 缺口 5（中）：**纯 FIFO，没有优先级、没有老化、没有公平性**

`CommandLane` 已经区分了 `Main` / `Cron` / `CronNested` / `Subagent` / `Nested`（`process/lanes.ts`），但 `workspaceExec` 的租约队列**不知道调用者属于哪个 lane**。因此：

- 一个用户交互 turn 的 `grep` 会排在一个 30 分钟的 `cron build` 后面。
- 一个失控的 subagent 可以持续抢占，把另外 7 个饿死。
- 没有老化（aging），长尾等待可能无限长（只能靠 30s 超时失败）。

#### 缺口 6（中）：**租约是票据，不是保证**

`p1` 文档写得很清楚：

> an RPC rejection/timeout releases its slot but does not itself prove that a remote process has stopped.

也就是说 `release()` 释放的是**名额**，不保证**OS 进程已经死了**。`os-containment.ts` 能做残留校验，但那是 drain 阶段的检查，不是运行期的强制。

#### 缺口 7（低，但违反仓库自身规则）：**有两个 lease kind 没有生产调用点**

`p2` §Boundary 自己写明 `workspaceWriter` / `subtreeMutation` 无生产调用点。仓库在 `harness/specs/rules` 层面反对「未接线的模块」。要么接线（如果有真实操作），要么从冻结面移除。

---

## 2. Manus 的模型：公开披露 vs 推断

### 2.1 公开披露（可直接引用）

**A. 隔离与虚拟化**

- 每个任务分配一台完整云 VM：[1](https://www.zenml.io/llmops-database/building-an-ai-agent-platform-with-cloud-based-virtual-machines-and-extended-context) 包含真实文件系统、终端、VS Code、**真实 Chromium（明确非 headless）**。
- Wide Research 的架构描述 [2](https://manus.im/blog/manus-wide-research-solve-context-problem)：n 个子任务 → n 个 subagent，**每个都是完整功能的 Manus 实例**，各自拥有完整 VM、完整工具库、独立网络连接、**全新空上下文窗口**；**subagent 之间不互相通信**，所有协调经主控；最后主控统一合成。
- 规模：官方文档称实测到 250 项 [3](https://manus.im/docs/features/wide-research)，发布时宣称「100+ 并发 subagent」[4](https://venturebeat.com/ai/youve-heard-of-ai-deep-research-tools-now-manus-is-launching-wide-research-that-spins-up-100-agents-to-scour-the-web-for-you)。
- Cloud Computer [5](https://manus.im/blog/manus-cloud-computer)：持久 VM，**同一台 Cloud Computer 上的所有任务共享同一个硬盘**；但默认仍然是「每个任务起临时 sandbox」，是否用 Cloud Computer 是 per-task 决策。

**B. 上下文 / 缓存经济学（其最重要的一课）**

- **KV-cache 命中率是生产 agent 的第一指标**；Manus 的输入:输出 token 比约 **100:1**；Claude Sonnet 缓存输入 $0.30/MTok vs 未缓存 $3/MTok [6](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)。
- 三条纪律：**前缀稳定**（禁止秒级时间戳进 system prompt）、**上下文只追加**（确定性序列化，JSON key 顺序也算）、**显式 cache breakpoint**。
- **Mask, don't remove**：工具定义在上下文前部，动态增删会毁掉后续全部缓存；改用 context-aware 状态机在解码时**掩码 logits**。
- **文件系统即上下文**：无限、持久、agent 可自操作；**压缩必须可恢复**（网页内容可以丢，URL 必须留；文档内容可以丢，路径必须留）。
- `todo.md` **复诵**：不断重写待办并追加到上下文尾部，把全局计划压进近期注意力。
- **保留错误**：失败的 action 和 observation 留在上下文里。
- **避免 few-shot rut**：注入结构化变异，防止模型陷入重复节奏。

**C. 供应链（可推断其虚拟化底座）**

Manus 是 E2B 的公开客户 [7](https://e2b.dev/)（E2B 基于 Firecracker microVM）。E2B 的技术形态是：模板 → microVM 快照 → 预热池 → 秒级/亚秒级恢复 [8](https://memo.d.foundation/breakdown/e2b)。

### 2.2 推断（标注为推断，不作为事实）

以下是从公开行为反推出的**架构性质**，Manus 未公开调度器内部实现：

**推断 1：资源是 VM 级别的静态声明，不是动态 cgroup 再平衡。**
依据：Cloud Computer FAQ 说「虚拟机会重启以应用新资源」[5](https://manus.im/blog/manus-cloud-computer)。如果资源是可热调整的 cgroup 配额，就不需要重启。→ 推断其资源分配是**声明式、静态、以 VM 为边界**的。

**推断 2：Manus 的调度器主要在解决「供给」，不解决「争用」。**
依据：subagent 之间不通信、不共享上下文、各自独立 VM。共享资源是零，所以不需要锁、不需要租约、不需要公平性算法。其调度器的核心工作只是**分配一台机器**。

**推断 3：其横向扩展的瓶颈在合成阶段，不在执行阶段。**
依据：协调全部收敛到主控，subagent 不回传中间结果。100 个 subagent 并行时，主控的合成步骤是串行尾延迟。

**推断 4：其成本模型必然是「用机器换时间」，不是「用调度换效率」。**
依据：100 个 subagent = 100 台 VM 的常驻内存开销。这解释了为什么 Wide Research 被绑定在较高价位档 [9](https://apidog.com/blog/manus-wide-research/)。**它没有尝试在 100 个 agent 之间复用任何东西**——这是明确的取舍，不是能力缺失。

**推断 5（对 VerseClaw 最有价值的一条）：Manus 把共享资源问题「消除」了，而不是「解」了。**
这意味着**不能把 Manus 的方案当成共享场景的参考实现**。它的 lease 复杂度是零，因为它的共享度是零。

---

## 3. 逐项对照：优势、劣势、以及为什么

### 3.1 VerseClaw 的优势（且应当守住）

| # | 优势 | 为什么它重要 | 对应 Manus 的代价 |
|---|---|---|---|
| 1 | **细粒度路径级并发控制** | `pathKeysConflict` 让 `a/` 与 `a/b.ts` 互斥，同时允许 `a/` 与 `c/` 并行。Manus 的「一人一 VM」根本不需要这个，但也意味着**无法在同一工作区上并行编辑** | Manus 若要共享工作区，需要从零设计这一层 |
| 2 | **本地优先的性能红利** | 直接用用户真实工具链、GPU、已装依赖、已有文件。无虚拟化开销、无每任务冷启动 | Manus 每任务一台 VM 的启动 + 内存开销 |
| 3 | **类型化故障语义** | `overloaded`/`queue-timeout`/`aborted`、`queuedMs`、`doubleRelease` 计数。可诊断性远超布尔返回 | 未公开 |
| 4 | **真实 OS 级调优** | `oom_score_adj` shim、Windows Job Object fail-closed、PID 复用 token 校验的进程树残留验证 | 未公开；其 VM 边界让这些问题被 hypervisor 吸收了，所以也不需要 |
| 5 | **KV 缓存纪律已进 CI** | `live-cache-regression.yml` 把缓存回归变成门禁，而不是口头约定 | 属同一门课，Manus 更早、更强调 |

### 3.2 VerseClaw 的劣势（结构性，非工程量问题）

| # | 劣势 | 根因 | Manus 的对应保护 |
|---|---|---|---|
| 1 | **无隔离边界** | `policy-light` 明确不是容器/VM 边界；N 个 agent 共享进程树、文件树、OS 账户 | VM 边界；一个 agent 跑炸 = 丢一台 VM |
| 2 | **无法快速重置** | 无 per-turn FS 快照 / overlay | 丢弃 VM 即可 |
| 3 | **无内存账户** | 只有单命令 Job 限额，无 agent 级内存预算 | VM 声明了 RAM |
| 4 | **容量静态** | 硬编码常量，无压力反馈 | 横向扩容（本质也是静态，但供给侧弹性） |
| 5 | **跨进程预算不收敛** | Main 与 runtime 两套独立计数器 | 单一 VM 分配器 |
| 6 | **无优先级/公平性** | 纯 FIFO，租约不知 lane | 无争用，故不需要 |

### 3.3 关键洞察

**VerseClaw 的调度复杂度高于 Manus，这不是设计缺陷，而是架构必然。** 本地优先 + 共享工作区 ⇒ 必然面对争用。因此：

- **不要**试图用「给每个 subagent 一台 VM」来对齐 Manus——在用户笔记本上这是 100× 内存税，而且直接摧毁本地优先的全部价值。
- **要**做的是：把已有的租约内核从「准入控制」升级为「压力感知调度器」，并补上 Manus 靠 VM 天然获得的三个属性——**可核算、可丢弃、可重置**——用本地等价物实现。

---

## 4. 优化方案

排序原则：**先观测，再收敛，再自适应，最后隔离**。每一步都必须能独立产出证据。

### Phase 0：统一观测（前置，无此步后续无法验收）

仓库自身的规则是「无 before/after 证据不得声明性能」。当前两套租约的日志形状不同（Main 用 `[resource-lease] acquired workspaceExec`，runtime 用 `createSubsystemLogger("agents/resource-leases")`），无法聚合。

**P0-1 统一租约事件 schema** — 新增 `resource-lease/v1` 事件：`{ leaseKind, leaseKey, requesterLane, requesterAgentId, queuedMs, holdMs, outcome: "granted"|"timeout"|"overloaded"|"aborted", capacityAtAdmission, activeAtAdmission }`。Main 与 runtime 都发同一 schema。`holdMs` 是关键新增——当前只记录了 `queuedMs`，**持有时间完全不可见**，而持有时间才是容量是否合理的主证据。

**P0-2 主机压力采样器** — 现有 `electron/services/resource-tracker.ts` 只跟踪端口（30s TCP 心跳、10 min idle、30 min 自动回收）。扩展为 `host-pressure-sampler`：
- CPU：load average（Unix）/ `GetSystemTimes`（Windows）
- 内存：`MemAvailable` / `GlobalMemoryStatusEx`
- 磁盘：IO 队列深度 / `PhysicalDisk` 平均队列长度
- FD / handle 数、总子进程数
- 采样周期与心跳同频（30s），unref，零配置可关。

产出：写入既有 Observability 导出面，同时作为 Phase 2 的输入。

**P0-3 冷启动分解指标** — 定义 **"time to first useful observation"（TTFO）**，分 surface 测量（terminal / grep / browser / LSP）。这是本地场景下对应 Manus「KV-cache 命中率」的**先行指标**：它同时反映进程复用、缓存命中、调度延迟三件事，比事后总耗时敏感得多。

### Phase 1：收敛租约宇宙（最高性价比）

**P1-1 主 authority 决策** —— 两个选项：

- **选项 A（推荐）**：让 runtime 侧的 `agents/resource-leases.ts` 成为**唯一权威**，Main 的 `terminal.run` 通过 gateway RPC 做 `lease.acquire`/`lease.release`，**不再持有自己的计数器**。这直接消除 `p2` §Boundary 记录的 2+2 超额订阅。
  - 代价：Main→Gateway RPC 增加一次往返；Gateway 未启动时需要 fail-open 策略（明确记录为 degraded，不能静默绕过）。
- **选项 B（低成本退路）**：保留两套但**共享同一 key 命名空间**并把两边容量之和暴露在诊断面，让 operator 能看见真实上限。这是治标，但成本极低，可作为 A 的过渡。

**P1-2 接线或移除 `workspaceWriter` / `subtreeMutation`** —— 当前零生产调用点。若有真实整工作区操作（例如未来的 delete/rename/move agent tool），接线；否则从冻结面移除。仓库自身反对未接线模块。

**P1-3 容量改为可配置但保留冻结默认** —— `RESOURCE_LEASE_CAPACITY` 从 `const` 变为「冻结默认 + 可覆盖」，覆盖走既有配置面而非 env 散落。**不改变默认值**（2/2/1/1/1），只打开旋钮。

### Phase 2：从准入控制到调度器

**P2-1 优先级 + 老化** —— `acquire()` 增加 `priority` 与 `requesterLane` 提示。映射：`Main` → interactive、`Subagent` → normal、`Cron`/`CronNested` → background。在 FIFO 之上实现**同 key 有界优先级 + 老化**（等待超过 N ms 的 background 请求提升到 normal），避免长尾饥饿。这是补上「cron build 阻塞用户 grep」这个具体缺陷。

**P2-2 公平份额** —— 单个 `requesterAgentId` 在任一 `(kind, key)` 上的在飞占用不得超过容量的一定比例（例如 50%），防止一个失控 subagent 饿死 7 个兄弟。在 subagent 扇出 ≥ 4 时尤其重要。

**P2-3 压力感知动态容量** —— 容量 = `clamp(base, band)`，其中 base 来自配置、band 是冻结的安全带（例如 `workspaceExec` base 2，band `[1,4]`）。下调条件：主机压力采样显示内存紧张 / IO 队列深 / load 高。**下调只影响新准入，不抢占在飞**（保持与现有 wave immutability 一致的安全姿态）。

**P2-4 未来 wave 的压力驱动重规划** —— 保留 `started` wave 不可变（这是正确的安全属性），但对**未启动**的 wave 允许由压力采样触发自动重规划。当前 `appliesToWave` 已只允许重规划未启动的 wave，所以这一步是在既有语义上接一个自动触发源，而非改语义。

**P2-5 释放即可靠化** —— 针对「租约是票据不是保证」：在 `release()` 路径上对**已知 PID 集合**做一次非阻塞存活探测；若进程仍活，标记 `release-with-residual` 并在诊断面暴露。不阻塞释放，但让泄漏可见。复用 `os-containment.ts` 的 PID token 校验，避免 PID 复用误判。

### Phase 3：内存与进程核算（最大缺口）

**P3-1 进程树内存采样** — 对 gateway 的子进程树定期采样 RSS/PSS：
- Linux：`/proc/<pid>/status` 的 `VmRSS` + `/proc/<pid>/smaps_rollup` 的 `Pss`
- macOS：`proc_pid_rusage` / `ps -o rss=`
- Windows：复用 VerseShell 已创建的 Job Object，读取 accounting（注意 #155 已记录的 readback 缺口，若不可用则降级为 `GetProcessMemoryInfo` 轮询并如实标注 `readback: "unavailable"`）

**P3-2 Agent 级内存预算（opt-in，无冻结默认）** — 定义「agent 总内存预算」并在准入时参与决策：新 subagent 若会突破预算，拒绝并返回类型化原因（复用 `bounded-concurrency.ts` 的拒绝语义，新增 `memory-budget` 理由）。**默认不设限**，与 #154 outbound budget 的处理方式保持一致（不把示例数字冻成产品默认）。

**P3-3 Linux cgroup v2 best-effort 放置** — 当宿主允许时把 gateway 子进程放进 cgroup v2 slice，获得真实的内存/CPU 计量与限制；不允许时 fail-open 并给出**如实的 reason 字段**。严格遵循 #155 建立的「请求—应用—强制—证据」回执模式，不得在未生效时声称生效。

**P3-4 浏览器上下文池** — Playwright/Chromium 上下文是最大的隐性 RSS 消耗者。参照 `acp/control-plane/runtime-cache.ts` 的 touch-aware + idle 淘汰设计，做一个有上限的 browser context 池，记录每上下文 RSS 与复用命中率。

### Phase 4：缓存与复用（把 Manus 的缓存课扩展到 OS 资源）

Manus 的第一课是「KV-cache 命中率是第一指标」。VerseClaw 已经对 **token** 做了这件事，现在把同一纪律施加到 **OS 资源**上：

**P4-1 工作区级缓存注册表** — 统一 TTL + 失效键（file digest）：ripgrep 索引、tree-sitter parse、LSP server warm state、`fd`/`find` 结果集。当前这些各自为政或完全没有。

**P4-2 进程预热池** — VerseShell 已有 `idleTtlMs` 5 min。升级为**按 kind 声明的预热池**（例如每 workspace 保 1 个 warm process），并暴露 hit/miss/evicted 计数。目标是把 TTFO（Phase 0 指标）变成可优化的数字。

**P4-3 工作区快照（本地版 snapshot/restore）** — 这是对 Manus「丢弃 VM」的**本地等价物**，也是缺口 4 的正解：
- 在 risky `subtreeMutation` 前，用**写时复制**创建轻量快照：APFS `clonefile`、Btrfs/XFS `reflink`、Windows `FSCTL_DUPLICATE_EXTENTS_TO_FILE`（块克隆）；文件系统不支持时降级为「仅记录 journal + 明确标注不支持快速回滚」。
- 某个 subagent 污染工作区时，回滚它的子树而不是整仓恢复。
- 这是**性价比最高的一项**：不引入虚拟化开销，却拿回了 Manus 最关键的「可丢弃」属性。

**P4-4 复用率仪表** — 把 Phase 0 的 TTFO 与 P4-2 的 pool hit 合并成一个「资源复用率」看板，与既有 `prompt-cache-observability` 并列。让「缓存」在两处（token、OS 资源）遵循同一套可观测规范。

### Phase 5：隔离分层（对 Manus 结构优势的诚实回应）

`docs/runtime-design/area-1-layered-execution-isolation.md` 已设计 per-turn isolation tiers。建议按**成本递增**落地，每级都保持 fail-open + 真实回执：

| 级别 | 机制 | 覆盖的威胁 | 成本 |
|---|---|---|---|
| L0 现状 | `policy-light`（审批门） | 误操作 | 零 |
| L1 | Windows Job Object + restricted token；Linux `bubblewrap`/`unshare` | 资源耗尽、部分特权逃逸 | 极低，且 #155 已有 Job 基础设施 |
| L2 | 写入 overlay（P4-3 的 COW 快照）+ 每 turn 可重置 | 工作区污染与不可逆修改 | 低 |
| L3 | `docker-strong`（已存在，默认降级） | 强隔离 | 中 |
| L4 | 未来 VM 后端 | Manus 级隔离 | 高，用户可 opt-in |

**关键判断：不要追求 L4 作为默认。** L1 + L2 能以极小代价获得 Manus 隔离能力的**实际使用价值**（资源耗尽防御 + 可丢弃 + 可重置），而保留本地优先的性能红利。L4 应作为显式 opt-in 给需要跑不可信代码的场景。

---

## 5. 不该从 Manus 抄的东西

| 不抄 | 原因 |
|---|---|
| VM-per-agent 作为默认 | 在用户机器上 100× 内存税；摧毁本地工具链/GPU/真实文件的价值 |
| subagent 之间零通信 | 该设计服务于「彼此完全独立的研究子任务」。VerseClaw 的 subagent 共享工作区，**必须**有租约内核；去掉通信反而会诱发冲突 |
| 无预算的 250 项扇出 | 云端可以按钱扩机器；本地必须按机器容量约束扇出（即 Phase 3 的 agent 级预算） |
| 把「100+ agent」当作能力指标 | 数量本身不是能力。本地场景下更有价值的指标是 TTFO 与资源复用率 |

## 6. 该从 Manus 抄的东西

| 抄 | 落地形式 |
|---|---|
| KV-cache 命中率作为第一指标 | 已有；补齐 `prompt-cache-observability` 的对外可见性 |
| **把「复用率」提升为一等指标**（本文扩展） | Phase 0-3 的 TTFO + Phase 4-4 的复用率仪表 |
| 可恢复压缩 | 已有（`compression-artifact.ts` v1）；坚持「保留引用而非保留内容」 |
| 快速重置 | Phase 4-3 的 COW 工作区快照 |
| 声明式资源 + 显式 RTT（round-trip truth） | 已由 #155 建立模式；扩展到内存/cgroup（Phase 3-3） |
| 集中协调、避免跨 agent 噪声 | 已有（主控 + 受控回传）；保持 |

---

## 7. 验收与证据要求（沿用仓库既有纪律）

每一项都不允许只有实现没有证据：

1. **P0** — 产出 `artifacts/` 下的压力采样报告；租约事件 schema 需有单测覆盖两个进程的发射端。
2. **P1** — 必须给出「同一 workspace 跨 Main+runtime 的实际并发上限」的 before/after 数值（当前应为 4+）。
3. **P2** — 需要饱和压测证据：在相同的合成负载下，比较 FIFO 与优先级+老化方案的 p50/p95/p99 等待时间。仓库已有 `resource-leases.test.ts` 里的 200 请求 FIFO 突发用例，可直接扩展。
4. **P3** — 内存预算必须在**未声明时不改变行为**（no-op 断言），并在声明时给出拒绝路径的测试；cgroup 路径必须有「不可用时的 fail-open reason」测试。
5. **P4-3** — 必须分别在支持 COW 与不支持 COW 的文件系统上验证降级路径，并如实标注。
6. **全局** — 任何改动都不得改动冻结默认值；如需改动，按 `AGENTS.md` §5 升级给所有者。

---

## 8. 优先级建议

若只能做三件事：

1. **P1-1（收敛租约宇宙）** — 它修的是一个**语义正确性**问题（预算是假的），成本最低，收益最明确。
2. **P3-1 + P3-2（内存核算 + agent 级预算）** — 这是与 Manus 差距最大的维度，也是本地用户体验「卡死」的根因。
3. **P4-3（COW 工作区快照）** — 以接近零的运行时开销拿回 Manus 最核心的「可丢弃」属性。

P2（自适应调度）虽然是最"性感"的，但它依赖 P0 的观测，且在没有 P3 的情况下，自适应也没有可用的压力信号——因此**顺序不能颠倒**。
