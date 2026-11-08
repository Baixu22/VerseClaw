# 资源治理、可观测性与恢复

> 面向问题：系统怎样限制进程、终端、端口、消息和 token 资源？后台任务在 CPU/RSS 压力下怎样降载？Trace、Problem、Session Activity、Doctor、backup 和 support bundle 各能证明什么？

## 1. 设计原则

聊天状态仍由既有 Zustand store 同步更新。普通 assistant/thinking 增量按动画帧合并订阅通知，
隐藏窗口的帧暂停时使用 100 ms 定时发布；最后一个观察者卸载后清理等待中的帧和 timer。
批准、取消、错误与终态立即发布，包含之前已接收的文本。运行时按 run 的单调序列拒绝重复或迟到事件，
终态之后的文本不能重新打开运行。已完成历史段按不可变消息及相关上下文缓存投影，当前回复增长不重新解析它们。

长会话的历史视口通过 ResizeObserver 测量消息与执行卡片高度；窗口外使用总高度占位，
导航覆盖已加载的所有用户轮次。图片载入、展开和历史前插保留第一条可见消息及偏移，
仍沿用用户滚动后解除底部锁定的行为。默认最多 120 个历史 DOM 行与最多 300 条保留消息不变。

历史、运行快照、图片预览、消息投影和执行图缓存共用 32 MiB 载荷预算。
`BoundedCache` 按 UTF-16 字符串、容器开销与二进制 buffer 长度计量，条数、TTL、字节任一超限均淘汰旧值。
该数值用于缓存准入；renderer heap/RSS 用原生工具另测。缓存命中只复用当前值，淘汰后从
sessionKey 的历史入口或 filePath/gatewayUrl 的媒体入口读取；活动 run 身份单独保留。

WatcherHub 按独立订阅句柄计数，重复使用同一回调也分别释放。递归祖先监听可覆盖相同
persistence 策略的子根，每个订阅仍使用自己的相对路径、深度与过滤规则；最后一个引用释放时关闭原生监听。
递归根以一个非驻留轮询器观察目录身份，删除后重建会重新绑定。文件轮询采用当前订阅的最短间隔，
关闭时只注销 hub 自己的回调。

知识源同步复用 Main 的 hub，捕获内容、模式匹配与 cursor 提交沿用原 owner。
Main Git 状态按工作区根共享 5 秒缓存，目录身份或 `.git` 元数据改变后重新读取；
失效代次隔离正在执行的旧请求，旧结果不能回填新缓存。同进程多个窗口共享服务，跨进程监听各自由本地 owner 管理。

Main 可显式登记同一应用入口、preload 和 session 的只读观察窗。该窗口仅能调用 `git.status`
与 `efficiency.getState`；主窗保留原有权限，未登记窗口、导航到其他页面的窗口及写操作均拒绝。
观察窗销毁或主窗 owner 结束时释放登记，renderer 没有自行登记的接口。

VerseShell host 调度优先发送 `process.write` / `process.kill`，poll 最多使用并发上限减一的额度；
单并发场景仍使用一个槽位。原生 JSONL server 顺序处理单请求，host 将每次 poll 等待限制到
`1000 / maxConcurrency` ms 内，避免已发送的 poll 堵住控制请求。请求总并发、队列和控制5秒期限保持原值。
受管生命周期持有 executor 引用，确认终态后释放；共享引用或活动请求仍存在时不关闭进程，unknown占用继续保留。

受管输出的 stdout/stderr 共用 UTF-8 字节尾部预算，并报告 raw/retained/omitted 字节及原artifact引用。
callback式 bash 输出溢出使用私有文件同步分段写入，为生产者提供背压；内存尾部按字节截取，避免单个Unicode大块超限。

当前资源治理是**合作式**的：

- 不引入 Job Object、cgroup、ACL、restricted token 等内核级沙箱；
- 不承诺 OS 强制 QoS；
- 由 Main/runtime 的队列、lease、采样和 policy 共同约束；
- foreground/user-initiated work 不能被后台 shed 静默终止；
- 资源观测以 shadow envelope 为主，未证明的数值保持 unknown；
- 不新增外部 APM 或 metrics 服务。

## 2. ResourceFabric

实现：

- `electron/services/resource-fabric.ts`
- `shared/resources/`

当前 admission account 只有两个：

| Account | 用途 | min | initial | max | queue | timeout |
|---|---|---:|---:|---:|---:|---:|
| `workspaceExec` | terminal/workspace exec | 1 | 2 | 4 | 64 | 30 s |
| `chatHistory` | chat history RPC | 1 | 2 | 4 | 64 | 30 s |

表中的 queue 64 是等待队列硬上限，活动许可另行计数；超界请求在入队前返回
`RESOURCE_QUEUE_FULL`。现有 DRF 容量由所有租户共同使用；
各 workspace account 释放后会唤醒其他等待 account。

排队可取消，获得许可后、实际调用前仍重新检查取消。后台与 opportunistic 工作持续老化，
最终可排到新交互请求及临时 boost 之前。Main 的 envelope 读取从 Fabric owner 重建活跃
许可与队列投影；删除投影不能释放仍被持有的许可。这里不声称其他工具 owner 或成本核销已统一。

Fabric 组成：

- `AdaptiveLimit`：按执行类别隔离延迟反馈，积压只表示扩容需求；
- `PriorityQueue`：interactive / background / opportunistic QoS；
- `DrfShare`：进程槽与并发额的 DRF-lite；
- `Singleflight`：同 key chat history 请求合并；
- Resource envelope ledger：记录 limit history、排队、拒绝和 active slots。

特征：

history 使用 `read` 基线；terminal 按已有权限分类映射为 `read`、`execution` 或
`remote-wait`。远端等待记录耗时，由原 provider owner 管理配额，不调整本地执行容量。
同类连续两次延迟恶化且短期均值超过长期基线的 10%（至少 1 ms）时先收缩，
隔离单次读取/启动抖动；健康且有积压连续三次才加一个槽位。
拥塞期间冻结长期基线，恢复后经过三个健康样本再开始积累扩容条件。

既有效率观察者接入物理可用内存、Windows 系统 commit 和 event-loop 压力。
可用物理内存 ≤10%、commit 使用率 ≥90% 或 event-loop degraded 会收缩 admission；
物理内存恢复到 ≥15%、commit 到 ≤80%、event-loop 恢复后，需要新鲜低压样本跨越
至少 10 秒才解除压力。30 秒外、未来、重复或缺失观测不能推进恢复。
Windows commit 随既有进程探针读取，其他平台或探针不可用时在 Fabric diagnostics 中
显示该信号未启用。CPU 利用率不单独触发本地并发收缩；整机 I/O wait 未启用，
I/O 拥塞通过同类读操作的服务延迟反馈。诊断同时列出阈值、压力原因和分类基线。

收缩不终止已获许可的任务。账户在活动和队列均为零且空闲五分钟后回收，
下次使用按原始 2 槽位和当前压力状态重建。

- 有 min-change dead zone，避免 limit 抖动；
- opportunistic 有过期/晋升策略，避免永久饥饿；
- acquire 超时会返回 typed error；
- Chat history 同 key 并发只打一次真实请求；
- 资源事件写 shadow envelope，不自动升级为外部 metrics。

## 3. BackgroundWorkGate

实现：`openclaw_runtime/src/resources/background-work-gate.ts`。

高水位：

| 条件 | 高水位 | 低水位 |
|---|---:|---:|
| queue depth | 16 | 4 |
| process tree RSS | 3 GiB | 2 GiB |
| tree CPU | 300% | 120% |

其他：

- min dwell：10 秒；
- shed signal 可来自窗口隐藏、display sleep、power saver；
- 进入 deferring 后，background task 暂存；
- 只有所有观测回到低水位并满足 dwell 才恢复；
- 缺少当前导致 defer 的观测时，不盲目 resume；
- foreground priority 永不 defer。

Gate 是 backpressure，不是 kill switch。它延迟/排队后台工作，不杀死正在交互使用的前台工作。

## 4. Efficiency / Power Policy

实现：

- `electron/services/efficiency-sampler.ts`
- `efficiency-power-policy.ts`
- `efficiency-orchestrator.ts`
- `efficiency-api.ts`

每 5 秒采样：

- process tree CPU；
- process count；
- tree RSS；
- active/queued slots；
- Main/aggregate resource envelope；
- active timers/watchers；
- spawn counts。

Shed 原因：

1. window hidden/minimized；
2. display sleep；
3. power saver / OS speed limit <100%。

优先级：window-hidden > display-sleep > power-saver。

发生 transition 时：

- 更新 TimerAligner shedding；
- 写日志；
- 更新 BackgroundWorkGate；
- 只影响 background 周期任务和 opportunistic work。

这不是电池管理结论；它是本地 resource policy。

## 5. 资源原语

`shared/resources/` 当前提供：

| 原语 | 用途 |
|---|---|
| `BoundedCache` | LRU + TTL + invalidate |
| `Singleflight` | 同 key 并发请求合并 |
| `AdaptiveLimit` | 自适应并发 |
| `TokenBucket` | 令牌桶限速 |
| `PriorityQueue` | 优先级/老化/QoS |
| `DrfShare` | dominant-share 记账 |
| `TimerAligner` | 周期任务对齐与 shed-aware 降频 |
| `WatcherHub` | 按 root 合并文件 watcher |
| `WriteCoalescer` | 写入合并 |

已见生产使用：

- Git status：BoundedCache + Singleflight；
- read-only renderer query：BoundedCache + per-call cache + Singleflight；
- ACP event ledger：WriteCoalescer；
- ResourceTracker / efficiency / cron maintenance / SQLite WAL：TimerAligner；
- runtime fs watch/footer：WatcherHub；
- terminal/chat history：ResourceFabric。

不是所有 20+ 定时器、9 路 watcher 或全部网络请求都已统一池化。路线图中的 P3/P4/P5 仍有未完成部分。

可选 symbol/path 写租约保持默认关闭，memory/WAL 的默认选择不变。新租约由原 owner
签发随机 nonce 并绑定进程出生标识；TTL 到期先记为 fenced，只有旧进程已退出或出生标识
已改变才可回收。活跃或无法验证的旧 owner 不会仅因到期而让出写权限。释放需匹配原 nonce
与当前进程，旧释放不能撤销后续租约。WAL 模式复用既有跨进程互斥原语；损坏或丢失的
owner 日志保持不可用，无身份的遗留租约也不被猜测为空闲。多目标写入按 owner key 固定排序，
后续资源失败时反向归还已取得的租约。此边界不等同于完整的跨工具预算核销。

Provider outbound quota 仍由原 `provider-outbound-budget` owner 管理，未配置时不施加
并发限制。重配不会清空活跃槽位或等待者；缩容保留已开始的请求，容量回到新上限以下后
才继续准入，扩容优先服务原队列。已占用 quota 的别名改绑、或未受限请求尚未结束时启用
新限制，会返回可重试的 busy；原请求终态可回读后再应用。共享别名使用同一个有效上限，
循环别名和无效配置在修改 owner 前被拒绝。`effectiveLimits: null` 表示当前没有配置限制，
旧槽位仍可继续排空；不能把这种状态解释成已经证明的无限容量。此处只治理物理请求并发，
尚不代表跨项目/会话 token 或货币成本已完成预留与核销。

Worktree owner 对重复 ID、规范化后的同名以及已有目录直接拒绝；进程内记录丢失也不
允许覆盖盘上 checkout。创建、合并与清理复用有进程出生标识的互斥锁，旧式锁信息未知
时保持不可用。真实 Git checkout 记录 generation 与实际 HEAD；派发前检查 Git 私有目录、
公共仓库和 checkout 回指。目录模拟明确保持未验证，真实 Git 创建失败不自动冒充成功。
对外列表是快照，修改它不改写原 owner。调度计划不再接受调用方布尔值作为并行写入的
隔离证明；这仍不代表跨波次执行生命周期、跨进程配额或完整 R1 已验收。

Subagent 单 gateway 进程在实际派发前向既有 registry 持久化 pending 预留，配额检查
计入这些准备中的请求。accepted 保留活动占用；取消必须有 owner 的 ok/deleted 回执。
wait 的通信错误或没有结束记录的超时、显示层的两小时过期、本地执行上下文丢失，
都不能自动腾出名额；未知执行保持 interrupted 或 pending，重启后从 SQLite 恢复。
完成和取消路径负责释放，完成通知尚未送达不会额外占用已确认结束的名额。
编排把已准备的 agent 请求作为 queued 行写入同一 registry；前序波次全部结束且成功
才发送下一波，失败或取消会拒绝后继。运行完成事件与 agent.wait 终态共同驱动原队列，
重复事件不会重复派发。队列从 SQLite 恢复；发送前重新检查负责人 generation、取消屏障、
worktree checkout 和当前子任务上限，发送后确认失败的请求保持 unknown 占用。
规划并发上限缺失时标为未知并串行。共享状态数据库中的多个gateway通过同一SQLite
事务检查session子任务容量并预留；
排队请求取得唯一派发claim。保存按行检查读取版本，保留其他进程的记录，冲突时拒绝
旧快照更新和删除；缺少终态的占用继续计入容量。

Runtime 的 exec/search/file mutation 等待队列接收原工具取消信号；排队取消立即结束，
获准到执行回调之间也再次检查，避免取消后启动 shell 或写文件。已开始的操作仍由其
完成或终止回调归还槽位，不把取消请求本身当作进程退出证据。

可选 `runtime.providerBudget` 为内嵌模型调用增加预算；`host`、`project`、`session` 各自
可设置 `maxTokens` 与 `maxCostUsd`。未配置时保持原默认。host 指向同一运行时状态数据库，
project 必须有执行 owner 提供的逻辑 workspace 身份，session 包含物理 generation。
三个层级在同一个 SQLite 事务中检查及预留，不把不同 session 的空余额重复花费。

预留使用模型 contextWindow 与输出上限，属于保守边界；成本按已解析模型费率换算为
整数微美元。核销按本次调用固定的费率和最终token明细计算，保留原usage记录。
transport确认未发送并结束的调用归还预留，已发送重试另占额度，没有usage的旧尝试
保留unknown。响应EOF或错误返回之前完成并发槽位释放。全零价格按未知处理，有
USD限额时拒绝未知价格。计数从显式启用后的第一笔预算准入开始，不追补既有 transcript
历史，也不代表服务商账单。
usage分项合计为正且与总量不一致时，token和USD均保持unknown并保留原预留。只有总量
有效、分项缺失时，可单独核销token；USD成本仍保持unknown。
运行时在发送前从既有会话 owner 核对 generation 并绑定逻辑 workspace；同 generation
的 workspace 漂移拒绝发送。子代理通过原会话存储继承该逻辑身份，磁盘 checkout 不
改变项目余额。缺失 owner 或逻辑 workspace 的调用在 project 限额下拒绝；跨工具和
跨独立状态目录预算仍未验收。
通用Gateway聊天与编排请求从Main使用已检查权限的workspaceId，调用方的不同
坐标会被拒绝；无需给每次聊天手工填写项目身份。首次编排在子调用前绑定原session
owner的workspace。


## 6. ResourceTracker 与端口/进程
ResourceEnvelope读取时从Main浏览器与终端owner重建会话条目，runtime快照从活动
租约和队列重建；清空投影后占用继续存在，关闭owner后相应条目移除。WAL初始化
marker区分首次锁等待与已提交journal，已初始化journal丢失会拒绝新writer。
ConPTY异步连接完成前PID为null；连接就绪后，终端状态与资源清单从同一PTY owner
刷新实际PID。
native关闭失败时保留终端占用，回收报告记录failed；部分成功不会覆盖其余失败。
终端关闭等待原PTY的exit回执，再释放占用和完成回收。会话删除保留清理操作，
终端清理失败后沿同一operationId重试。
Gateway的停止消费fork时绑定的native退出回执，并发停止共用同一终止操作。
Windows树终止不可用时，对原PID施加SIGKILL并等待原exit事件；PID已消失而事件
尚未到达时继续保留owner，超时报告终止失败。

生命周期锁的进程身份来自native FILETIME。首选host探测超时时，由系统PowerShell
读取同一出生标识；两个host均不可用时保持unknown并拒绝准入。

浏览器导航加载失败会立即结束同一等待并清理监听器与超时计时器；后续导航使用新的等待，
不会被上一次加载失败留下的计时器停止。
浏览器会话与工作区回收等待原窗口关闭回执并确认销毁；失败与待关闭的owner继续计入占用，
重试沿用原会话，并发关闭复用同一操作。

实现：`electron/services/resource-tracker.ts`。

策略：

- 30 秒 TCP heartbeat；
- 单 probe timeout 3 秒；
- session 无活动 10 分钟 → `idle`；
- 30 分钟无活动 → 自动清理；
- 新 listening ports 在 1/5/15/30 秒窗口扫描；
- 只登记扫描前不存在的端口；
- 忽略 Main 自身 PID；
- ownership 可为 managed/observed；
- session delete/stop/reset/workspace delete 时执行 `unregisterBySession`；
- shutdown 时 stop all。

风险：

- TCP reachability 是本地端口事实，不等于服务业务健康；
- 自动清理只应针对已登记的资源；
- 不应通过全局 kill-all 清理未知进程；
- 端口复用可能造成 PID/端口身份变化，必须保留 owner/session 关联。

## 7. Long-session 资源回收

`electron/services/long-session-resource-reclamation.ts` 协调：

- terminal sessions；
- web preview dev server；
- browser sessions；
- managed ports；
- session generation 不匹配的残留；
- workspace switch/delete、permission change、session stop/reset/delete。

恢复失败不是静默成功：

- 先返回 `recovery_required` 或等价错误；
- 保留 owner/evidence；
- stop 后再次尝试；
- task/Task Ledger 真相不因清理失败而被重置。

## 8. 会话/渲染资源上限

`shared/agent-resource-limits.ts`：

| 维度 | 默认 |
|---|---:|
| 最大 retained messages | 300 |
| history page size | 200 |
| max DOM render messages | 120 |
| max tool result chars | 80,000 |
| max session total tokens | 1,000,000 |
| max session cost | 100 USD |
| turn timeout | 30 min |

行为：

- 超出 token/cost budget：Host 在发送前拒绝新 turn；
- 超出消息内存上限：保留最新消息；
- tool result 超长：保留头尾并插入截断标记；
- DOM 只渲染窗口，避免大历史挂满节点；
- turn timeout 到点后应 abort 并释放 run state。

这些上限可通过显式配置/测试覆盖，但默认值是产品保护而不是建议。

## 9. Resource Envelope

Schema：`openclaw.resource-envelope/v1`，当前 `mode:"shadow"`。

Entry 形状包含：

- id/workspaceKey；
- kind；
- priority；
- owner；
- activeSlots/queuedCount/queueWaitMs；
- processCount/treeRssBytes/treeCpuPercent；
- pids；
- limits；
- limitHistory；
- updatedAt/reason。

ResourceKind 包括：

- agent-turn；
- terminal-exec；
- runtime-bash；
- workspace-search/writer；
- subtree/file mutation；
- browser session；
- PTY；
- MCP process；
- provider sidecar；
- background index；
- chat history；
- network pool。

Snapshot 汇总 totals 与 exceeded，但 shadow 不自动 enforcement。`resourceEnvelope.getState` 只读当前状态。

## 10. Observability

实现：

- `electron/services/observability-api.ts`
- `observability-service.ts`
- `observability-trajectory.ts`
- `observability-trajectory-index.ts`
- `observability-graph.ts`
- `observability-issues.ts`
- `observability-problems.ts`
- `openclaw_runtime/src/observability/`

Trace 包含：

- trace id/name/status/run/session/task/mode；
- started/ended/duration；
- spans/events；
- token usage；
- metrics；
- tags；
- error。

Span kinds：

- orchestrator / role-router / team；
- subagent；
- model；
- tool；
- memory / context-pack / gatekeeper；
- verifier / security-intercept / verification；
- input-mode；
- custom。

Graph node/edge 提供因果和执行投影，不自动成为完整审计链。

## 11. Scorecard 与 issues

Scorecard：

- 0–100 score；
- A/B/C/D/F；
- weighted items + reason。

ContextHealth 可以投影成 synthetic `ctx-health-<turnId>` scorecard，但 synthetic 标识必须保留。

Issue categories 包括：

- error-root-cause；
- aborted；
- stalled-running；
- slow-node；
- token-hotspot；
- tool-retry；
- approval-wait；
- artifact；
- command-failed；
- missing-verifier；
- orphan-trajectory；
- missing-output。

Issue 是诊断建议，不是自动修复命令。

## 12. Cross-run Problems

`pnpm observability:problems` 是**显式 agent batch**，不是 resident auto-remediation service。

规则：

- 从 sanitized trace index 聚合；
- signature 由 category + normalized title + model/agent + optional tool 构成；
- seven-day window；
- 每条 trace 对同 signature 最多贡献一次；
- 第二次 occurrence 或 critical occurrence → `open`；
- state：`pending / open / mitigated / closed`；
- 重新出现可 reopen；
- 导出 manifest/evidence/resolution，内容 redacted；
- 不自动修改代码或任务状态。

## 13. Session Activity

`SessionActivitySnapshot` 是只读读模型：

- session/run 状态；
- git status；
- tasks；
- subagents；
- completion batches；
- terminals；
- goals；
- processes；
- lineage；
- effective policy。

它明确区分：

- `known` vs `unknown` 的 background read；
- retained facts vs fresh facts；
- run 完成 vs 后台进程仍运行；
- task completion vs activity row；
- generation mismatch/fenced。

Session Activity 不是任务状态 authority，也不是资源清理 authority。

## 14. Diagnostics / Doctor / Logs

相关服务：

- `diagnostics-api.ts`
- `logs-api.ts`
- `app.openClawDoctor`
- `gateway.health`
- `gateway-control`
- `support-bundle.ts`
- `performance-metrics.ts`

可观察：

- Gateway 状态/pid/restart；
- local control plane status/reports/correlations；
- Doctor JSON；
- logs recent/memory/files；
- process tree sample；
- spawn counts/active intervals/watchers；
- support bundle。

Doctor/Doctor Fix：

- Doctor 是只读诊断；
- Doctor Fix 是显式修复操作；
- 二者不能混写为“发现问题并已自动修复”；
- packaged/headless/环境差异可能让 Doctor 失败，不等于产品功能失败。

## 15. Backup / Restore

`backup-restore.ts` 设计与边界：

- 读取 archive manifest；
- 校验 schema、createdAt、assets；
- preview 输出 create/skip-existing/rejected；
- restore 仅创建不存在路径，不覆盖当前数据；
- 拒绝路径遍历/越出 manifest root；
- 中途失败时回滚本次已创建文件；
- 结果包含 written/skipped/rejected/errors/rolledBack。

这是保守恢复，不是“完整灾难恢复无风险”。若用户当前数据损坏而目标路径已存在，restore 会跳过而不是覆盖；需要人工/agent 另行判断。

## 16. 当前限制

- ResourceFabric 只正式接管 workspaceExec 与 chatHistory，不是全局进程调度器。
- 合作式资源治理不等于内核沙箱。
- emulator/sampler 观测值不是业务吞吐或用户体验 SLA。
- BackgroundWorkGate 只延迟 background；不能阻止 bug 导致持续前台过载。
- ResourceTracker 只清理已登记资源。
- Resource envelope 是 shadow，不代表运行时已验证 enforcement。
- Trace 缺失/零项是 `not-runnable/partial`，不能因页面存在宣称完整 trace。
- Cross-run Problems 是批次工具，不是自动运维机器人。
- Backup restore 不覆盖现有数据；不能代替离线备份策略。
- Named platform acceptance 仍以 Windows x64 controlled workflow 为主。

## 17. 源码与命令索引

关键源码：

- `shared/resources/`
- `shared/types/resources.ts`
- `shared/types/resource-tracker.ts`
- `shared/agent-resource-limits.ts`
- `openclaw_runtime/src/resources/`
- `openclaw_runtime/src/observability/`
- `electron/services/resource-fabric.ts`
- `electron/services/resource-tracker.ts`
- `electron/services/resource-envelope.ts`
- `electron/services/efficiency-*.ts`
- `electron/services/long-session-resource-reclamation.ts`
- `electron/services/observability-*.ts`
- `electron/services/session-activity-api.ts`
- `electron/services/backup-restore.ts`
- `electron/services/support-bundle.ts`
- `electron/services/diagnostics-api.ts`

常用入口：

```bash
pnpm observability:problems
pnpm runtime:perf
pnpm runtime:event-log:inspect
pnpm runtime:memory:inspect
```

实际脚本名以根 `package.json` 为准；不存在或需要 provider/凭据的命令必须明确报告，而不是临时拼一个替代步骤。

延伸阅读：[运行时控制平面](../dev/runtime-control-planes.md)、[Windows 运行时效率观测](../dev/windows-runtime-efficiency-observability.md)、[资源调度规划](../dev/resource-scheduling-plan-20261018.md)。
