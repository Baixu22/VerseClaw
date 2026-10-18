# 统一资源分配与资源调用策略 — 深度调研与总体规划（v2）

日期：2026-10-18　范围：ClawX main / gateway / renderer 全栈
硬约束：**不引入内核沙箱**（Job Object / ACL / cgroup / restricted token 全部排除）；全部机制为合作式（in-process）调度。

---

## 第一部分：全量资源触点普查（代码证据）

### 1. 资源类别与本仓触点清单

| # | 资源类 | 本仓触点（证据） | 现状评级 |
|---|--------|------------------|----------|
| R1 | 进程槽位 | `utilityProcess.fork`（gateway/doctor/pairing）、`execFile/spawn`（git-api 多处、office-tools ×10、system-api、terminal-api）、node-pty（terminal-session-manager） | 有租约（workspaceExec=2）但硬编码；git/office 无管控 |
| R2 | CPU 预算 | efficiency-sampler 只测不控；无 CPU 预算概念 | 观测有，控制无 |
| R3 | 内存 | sampler 记 RSS/heap；knowledge-api（234KB 单文件服务）等大对象无上限 | 观测有，控制无 |
| R4 | 磁盘 I/O | sqlite-wal（已用 WAL，好）；session-transcript、task-registry 多 sqlite store；无写合并/限速 | 局部好（WAL），全局无 I/O 调度 |
| R5 | 网络 | ws-client、proxy-fetch、telemetry、mcp-api 等 ≥8 处 fetch/WS；未见统一 keep-alive agent / DNS 缓存 | 每处自建连接，无池化 |
| R6 | 定时器 | runtime 侧 server-maintenance ×8、channel-health-monitor、gmail-watcher 等；electron 侧 sampler/orchestrator/resource-tracker/cron-maintenance；renderer 侧 gateway/resource-tracker/storage-health/Skills/Chat/Models 各页 | 全局 20+ 独立 setInterval，无对齐、无统一降频 |
| R7 | 文件监听 | openclaw_runtime agents/utils/fs-watch、skills/runtime/refresh、gateway/config-reload、session-transcript-files.fs 等 ≥9 处独立 watcher | 无 watcher 合并（VS Code parcel-watcher 路线的空白） |
| R8 | 端口 | resource-tracker 已有心跳/闲置/自动清理 | 唯一治理完善的资源类 |
| R9 | 并发队列 | command-queue、keyed-async-queue、session-actor-queue、config-mutex、provider-outbound-budget、resource-leases | 散件多（6+ 种各自实现），无统一准入/优先级/公平性 |
| R10 | 缓存 | runtime 侧 RuntimeCache、ManagerRuntimeHandleCache、手写 promise 合并多处；electron 侧无统一原语 | 手写 Map 遍布，无 LRU+TTL+失效三要素齐全者 |
| R11 | 渲染调度 | 无 requestIdleCallback 使用；backgroundThrottling 未见显式配置 | 空白 |
| R12 | 背压传播 | shed 状态只影响 background-work-gate；renderer 轮询、watcher、timer 不感知 | 单点背压，未端到端传播 |

### 2. 结论
ClawX 的现状是"**每类资源各有一个好零件，但没有一个统一的分配者**"。教科书意义上的资源管理 = 统一资源模型 + 准入控制 + 优先级/QoS + 公平性 + 自适应上限 + 端到端背压。当前只具备其中"观测"和"单点限流"。

---

## 第二部分：教科书模式选型（anysearch 调研，共 8 组查询）

1. **Kubernetes requests/limits + QoS**（kubernetes.io、design-proposals-archive/resource-qos.md）：
   每个工作单元声明 request（保证量）与 limit（上限），调度器按 request 准入，QoS 分 Guaranteed/Burstable/BestEffort 三级决定驱逐/降级顺序。→ 映射为 ClawX 的 **interactive / background / opportunistic** 三级。
2. **DRF（Dominant Resource Fairness，Ghodsi et al. NSDI'11，引用 1900+）**：
   多资源公平分配的标准算法——按各租户的 dominant share 均衡。→ ClawX 租户 = session/workspace，资源 = 进程槽 + I/O + 网络。完整 DRF 过重，取 **DRF-lite**：只对进程槽和并发额度做 dominant-share 均衡。
3. **Netflix Gradient2 自适应并发**（github.com/Netflix/concurrency-limits；Envoy adaptive_concurrency filter 同款）：
   长/短窗口 RTT 指数均值 divergence 驱动 limit 升降，`newLimit = currentLimit × gradient + queueSize`。
4. **Apple QoS 优先级反转处理**（Apple Energy Guide）：
   高 QoS 等待低 QoS 时系统自动提升低 QoS。→ ClawX 队列需 **priority boost**：foreground 等待某 background 持锁时临时提升其优先级。
5. **防缓存击穿三件套**（thundering herd 文献）：singleflight 合并 + TTL 抖动（staggered）+ refresh-ahead 热点提前刷新。
6. **VS Code watcher 合并**（microsoft/vscode Wiki: File Watcher Internals）：parcel-watcher 按 root 合并递归监听，一份订阅多方分发。→ 本仓 9 处 watcher 应合并为按 root 单实例。
7. **HTTP keep-alive 池化**（undici 文档/实测）：单一全局 keep-alive Agent + DNS 缓存，启动时设置，延迟可减半。
8. **令牌桶 vs 漏桶**（arcjet 对比）：限速用令牌桶（允许突发），整形用漏桶（平滑输出）。→ 准入用令牌桶，I/O 写合并用漏桶式节流。

---

## 第三部分：目标架构 — 统一资源分配器（Cooperative Resource Fabric）

```
┌────────────────────────── ResourceFabric（main 进程单例，gateway 经快照同步）──────────────┐
│                                                                                          │
│  资源注册表（R1-R12 每类一个 Account）                                                      │
│   ├─ 容量声明：总量 = f(os.cpus, totalmem, sampler 实时余量)                                │
│   └─ 每 Account 四件套：                                                                   │
│        1. semaphore（并发额度，Gradient2 自适应调整）                                        │
│        2. token-bucket（速率准入，允许突发）                                                 │
│        3. priority-queue（interactive > background > opportunistic，含 priority boost）     │
│        4. drf-share（按 session/workspace 记 dominant share，超 share 者排队靠后）           │
│                                                                                          │
│  准入路径：所有资源调用 → acquire({class, qos, tenant, request}) → Fabric                  │
│   ├─ 通过：返回 lease（含超时、释放钩子、计量回调）                                           │
│   ├─ 排队：按 QoS + DRF 排序，超时即拒（现有 TERMINAL_RESOURCE_LEASE_TIMEOUT 模式推广）      │
│   └─ shed 时：opportunistic 直接拒，background 延迟，interactive 不受影响                    │
│                                                                                          │
│  可观测：每次 acquire/release/调整写入 resource-envelope ledger（复用现有账本）              │
└──────────────────────────────────────────────────────────────────────────────────────────┘

复用层（ResourceFabric 之下的执行优化）
 ├─ process-pool：git/office 只读 CLI 长驻 worker（P5，独立评审）
 ├─ http-pool：全局 undici/https keep-alive Agent + DNS 缓存（TTL 60s）
 ├─ watcher-hub：按 root 合并 fs watcher，多订阅者分发（parcel-watcher 模式）
 ├─ pty-reuse：终端会话按 workspace 复用 shell（现有 session-manager 扩展）
 └─ sqlite-write-coalescer：同 store 写合并 + WAL 下 checkpoint 调度避开高峰

缓存层（统一原语，三级）
 ├─ L1 static：系统信息、provider 探测 → TTL=∞，启动预热
 ├─ L2 hot：git status/branch、workspace-permissions、session 元数据
 │         → LRU + TTL(2-10s, ±20% 抖动) + singleflight + refresh-ahead(80% TTL 时后台续期)
 └─ L3 stream：文件内容类 → 以 watcher-hub 事件主动失效（无 TTL 依赖）

调度协同
 ├─ timer-aligner：全局节拍器（1s tick），所有周期任务注册对齐相位，
 │                  shed 时非交互 timer 降频 ×4，display-sleep 时 opportunistic 暂停
 ├─ poll-scheduler（renderer）：统一轮询注册表，页面不可见即暂停
 └─ idle-dispatch：renderer 非紧急工作走 requestIdleCallback 等价物
```

**不变量**（每条都可写测试）：
- I1：interactive 工作永不因 shed/额度被拒（沿用现有 power-policy 承诺）。
- I2：任何 Account 的在用量 ≤ 其当前自适应 limit。
- I3：同一 tenant 的 dominant share 不超过所有活跃 tenant 平均值的 2 倍（DRF-lite 界）。
- I4：缓存三要素齐全（容量界 + 时间界 + 失效路径），缺一禁止合入。
- I5：所有 limit 调整、准入拒绝、shed 转换均入 envelope 账本，可回放。

---

## 第四部分：分阶段路线图

### P0 — 原语层（纯新增，无行为变化）
交付：`shared/resources/` 下 6 个纯函数模块 + 单测
- `bounded-cache.ts`（LRU+TTL+invalidate）
- `singleflight.ts`（通用化自 rpc-backpressure）
- `adaptive-limit.ts`（Gradient2）
- `token-bucket.ts`
- `priority-queue.ts`（QoS + boost）
- `drf-share.ts`（dominant share 记账）
验收：核心分支单测全覆盖；`pnpm agent-dev:fast` 绿。

### P1 — 统一缓存 + 防击穿（低风险只读路径）
- git-api 只读查询 → L2 缓存；写操作后按 repo 前缀失效。
- system-api 静态信息 → L1；sandbox provider 探测迁入。
- renderer 五处轮询 → poll-scheduler，页面隐藏即暂停。
验收：空闲 5min spawn 次数降 ≥80%（sampler before/after 对）；无缓存击穿（并发同 key 只产生 1 次真实调用，单测）。

### P2 — ResourceFabric 准入（核心改造）
- R1 进程槽、R9 队列接入 Fabric：workspaceExec 与 chat.history 的硬编码 2 → Gradient2 自适应（min 1 / max 4）。
- QoS 三级 + priority boost 上线；DRF-lite 记账上线。
- limit/拒绝/排队轨迹入 envelope。
验收：合成压力脚本（N=20 并发 exec + 20 history RPC）：无超时率回归，limit 收敛曲线可见；I1-I3 不变量测试绿。

### P3 — 定时器与监听合并
- timer-aligner 接管 electron/renderer 周期任务；watcher-hub 合并 9 处 fs watcher 为按 root 单实例。
验收：进程内 setInterval 总数降 ≥50%；watcher fd/handle 数降 ≥60%（Windows 句柄计数取样）；shed 时 CPU 采样降 ≥30%。

### P4 — 网络池化 + I/O 整形
- 全局 keep-alive Agent + DNS 缓存接入 proxy-fetch/telemetry/mcp 等 8 处 fetch。
- sqlite 写合并 + checkpoint 错峰。
验收：重复 HTTPS 请求 P50 延迟降 ≥30%；高峰期磁盘写次数降 ≥40%。

### P5 — 进程池（独立评审门槛）
- git/office 只读命令长驻 utilityProcess worker 池（min(2, cpus/4)，空闲 60s 回收）。
验收：批量 git 查询 P50 延迟降 ≥50%；worker 回收后 RSS 曲线平稳（sampler 证据）。
若评审认定 Windows 长驻进程生命周期风险不可接受，则止于 P4，缺口如实记录。

---

## 第五部分：风险与边界

| 风险 | 缓解 |
|------|------|
| 统一准入成为新瓶颈/单点 | Fabric 纯内存、无锁（JS 单线程），acquire 路径 O(log n)；给 acquire 自身设 1ms 预算并计量 |
| 自适应 limit 抖动 | Gradient2 自带平滑窗口；加 min-change 死区（变化 <10% 不调整） |
| 缓存失效遗漏导致陈旧 | L2 TTL 上限 10s 兜底；L3 强制走 watcher 事件；每类缓存注册到账本便于审计 |
| QoS 饥饿 | opportunistic 设最大等待时长，超时晋升 background（防饥饿老化） |
| 与现有 lease/backpressure 双轨 | P2 合入时旧实现删除，不留并行路径（ponytail：先删后加同类物） |

## 第六部分：不做清单（决策边界）
- 内核级强制：Job Object / cgroup / nice / affinity / ACL 沙箱 —— 本轮明确排除。
- work-stealing 线程调度、worker_threads 计算池 —— JS 单线程语义下复杂度不抵收益。
- 外部 metrics/APM 后端 —— 继续用 efficiency-sampler + envelope，不引依赖。
- 完整 DRF（多资源向量公平） —— 只取进程槽/并发额度的 lite 版。

## 外部调研来源
- DRF：Ghodsi et al., NSDI'11（usenix.org/conference/nsd11；amplab 论文 PDF）
- K8s requests/limits/QoS：kubernetes.io/docs/concepts/configuration/manage-resources-containers；design-proposals-archive/node/resource-qos.md
- Gradient2：github.com/Netflix/concurrency-limits；Envoy adaptive_concurrency 文档
- QoS/优先级反转：Apple Energy Guide（Prioritize Work with QoS Classes）
- 防击穿：thundering herd / singleflight / refresh-ahead 文献
- Watcher 合并：github.com/microsoft/vscode/wiki/File-Watcher-Internals
- HTTP 池化：undici.nodejs.org/api/Client；Node keep-alive 实测文章
- 限流选型：arcjet.com/learn/rate-limiting-guide
