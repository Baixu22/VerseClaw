---
lifecycleStatus: active
id: performance-resource-governance-20261107
title: 性能调控、资源复用与回收的缺口和验收合同
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c7573ec11095b541f3a4a9c5470bf4e0727489bc
intent: 将已复现缺陷、源码设计缺口和待测性能机会分开追踪，逐节点实现并在同一候选上验收。
expectedUserBehavior:
  - Each performance or reclamation improvement has an owning task and a reproducible acceptance result.
  - Concurrent windows and agents retain responsive controls while using measured resource budgets.
requiredRules:
  - backend-communication-boundary
  - task-forest-autoclose-and-roles
  - disk-temp-policy
  - repository-artifact-retention
docs:
  required: true
  readmeTranslations: not-required
touchedAreas:
  - harness/specs/tasks/performance-resource-governance-20261107.md
  - harness/specs/tasks/verseshell-concurrent-acquisition-20261107.md
---

# 性能与资源治理合同

日期：2026-11-07。初始检查基线：`c7573ec11095b541f3a4a9c5470bf4e0727489bc`。
开发使用独立 Git 工作树；Task Forest 使用 `D:/ClawX` 的既有权威图。
状态与执行顺序由 Task Forest 管理；本文件定义缺口、交付与验收，供实现者和验收者使用。
总目标为 `TF-0822`，阶段节点为 `TF-0823`–`TF-0827`，开发包 A–L 对应
`TF-0828`–`TF-0839`。当前开发树：
`C:/Users/27933/.codex/worktrees/performance-resource-lifecycle/ClawX`。

旧资源 Fabric 与 Electron 性能阶段的通过记录保留其原候选和范围。当前任务图中的
`TF-0010` 已废止，后续工作关联仍在使用的资源 owner 和当前验收合同。
宿主/项目/会话预算沿用 `TF-0679`；会话工作树与存储交互沿用 `TF-0821`；跨工具回收沿用
`TF-0682`。这些节点已有的实现和证据需要在整合候选重新核对。

## 缺口全集

证据类别：**复现**表示隔离探针已触发实际源码行为；**源码**表示调用链或状态机存在具体缺口；
**待测**表示需要 profiling 或同工作量对照才能决定实现与收益。

| ID | 类别 | 缺口或短板 | 影响 | 交付包 |
|---|---|---|---|---|
| G01 | 复现 | 同 key 并发获取 VerseShell executor 能创建两份并覆盖 Map 引用 | 所有权丢失、关闭遗漏 | A |
| G02 | 复现 | 创建中的 executor 未预留 maxProcesses 容量 | 不同 key 并发突破总量 | A |
| G03 | 复现 | process.start 前获取 executor 失败未退回 managed capacity | 后续请求持续误拒 | A |
| G04 | 源码 | 获取/握手与 shutdown、workspace shutdown、kill switch 跨 await 交错 | 关闭后迟到创建或状态发布 | A |
| G05 | 源码 | 明确未启动失败、可能已发送、已观测终态缺少统一回滚分界 | 错归还或泄漏进程容量 | A |
| G06 | 复现 | ResourceFabric queueLength 只写账本，入队未拦截 | 积压内存与等待失控 | B |
| G07 | 源码 | Fabric/workspace 等待入口未全面接入 AbortSignal 和绝对 deadline | 取消后仍排队或工作超期 | B |
| G08 | 复现 | workspace 各自的并发限额可叠加超过实例预算 | 多项目同时放大资源竞争 | C |
| G09 | 复现 | DrfShare reserve 按 tenant 检查，fairness 结果未参与选择 | 总量与公平性未闭合 | C |
| G10 | 源码 | model 等待、CPU 计算、I/O、writer、内存和进程使用同类槽位难以表达成本 | 错误串行或重任务超售 | C |
| G11 | 源码 | quota 与 long-session/managed 限额未配置时不生效，缺少统一 effective-cap 投影 | 模块存在与实际门禁不一致 | C |
| G12 | 源码 | Main/Gateway 各进程的预算需要原子分区或 owner 租约协调 | globalThis 无法跨进程协调 | C |
| G13 | 源码 | 降载 treeCpuPercent 实际接 Main 自身 CPU | Gateway/工具繁忙无法正确反馈 | D |
| G14 | 源码 | Main 后代树和 Gateway 树可重叠后直接累计 | 内存/CPU/进程计数失真 | D |
| G15 | 源码 | 快照未以 owner epoch、TTL 与 PID creation token 贯穿聚合 | 旧占用影响新准入 | D |
| G16 | 源码 | RSS/working set、private/commit、逻辑额度与机器物理余量口径混用 | 预算与回收结果无法准确比较 | D |
| G17 | 源码 | 多窗口 visibility 事件覆盖同一个 windowHidden | 一个隐藏窗影响可见窗调控 | E |
| G18 | 源码 | 窗口订阅/共享服务引用和后台任务 owner 生命周期需要分离 | 关闭误停或隐藏仍重复刷新 | E |
| G19 | 源码 | 主聊天 delta 逐事件发布，整页订阅 streaming state | 多窗口流式更新放大 renderer CPU | F |
| G20 | 待测 | 流式文本参与历史投影依赖，已完成消息可能重复派生和解析 | markdown、diff、历史遍历开销 | F |
| G21 | 源码 | DOM 目前是尾部 120 行切片，非完整动态高度视口窗口 | 大消息、历史定位和滚动预算受限 | G |
| G22 | 源码 | 缓存按消息/会话条数限制，缺少合计字节预算和冷内容句柄 | 图片/工具对象/解析缓存常驻增长 | G |
| G23 | 源码 | 页面各自 interval，shed 缓存刷新最长约 30 秒 | 重复唤醒与压力传播滞后 | E/G |
| G24 | 源码 | watcher 仅部分同 key 复用，跨窗口/根重叠需按监听语义去重 | 重复句柄、扫描和 I/O | H |
| G25 | 待测 | repo 读模型、索引和网络缓存跨窗口/进程的重复成本未测量 | 复用收益与陈旧失效难取舍 | H |
| G26 | 源码 | 长轮询占 executor 工作并发，控制请求需保留响应额度 | start/kill/stdin 延迟或排队 | I |
| G27 | 源码 | governed wait 完成会 shutdownProcess，共享 executor 引用关系需核对 | 一个使用者退出影响其他使用者 | I |
| G28 | 待测 | 外部 CLI 每次启动成本、native typed 操作与 batch/server 协议收益未按负载比较 | 常驻中转可能只增加内存 | I |
| G29 | 源码 | 大日志到 artifact/store/IPC/renderer 的背压与字节上限需串联 | 输出洪泛、复制和 GC | I |
| G30 | 复现 | AdaptiveLimit 把真实 backlog 加进梯度公式，延迟变差时仍扩容 | 过载正反馈 | J |
| G31 | 源码 | 短读、长构建、provider 等待共用延迟反馈难归因 | 误限流、控制抖动 | J |
| G32 | 待测 | 整机内存/commit、I/O 等待、event-loop 与吞吐未形成校准闭环 | CPU 忙与资源拥塞难区分 | J |
| G33 | 待测 | 缺少当前候选多窗、多 agent、混合执行阶段的配对曲线 | 无法确定可持续并发拐点 | K |
| G34 | 待测 | 长时间与反复生命周期的进程/句柄/private/commit 回收证据不足 | 局部单测不能决定长期资源预算 | L |

原始 6 组复现归档于本地 `D:/tmp/clawx-performance-research/`；开发时将最小负例纳入回归测试。
此前通用 git 中转池的 30 对样本仅改善约 0.52%，保留在
`harness/specs/fixtures/tf0415-p5-process-pool/worker-overhead.json`，新实验必须实际减少工作或测得收益。

## 开发和验收包

| 包 | 交付 | 可执行验收与磁盘产物 |
|---|---|---|
| A | executor 单飞创建、创建中容量、关闭屏障与未启动补偿 | process-manager/governed-process/capacity 回归、真实 Node 协议子进程生命周期、clean candidate、JSON 报告与哈希 |
| B | 有界队列、取消、deadline 和 timer 释放 | 超界/取消/过期负例，200-request 压力，活动/等待/计时器归零 |
| C | 整合既有 TF-0679 的实例/项目/会话预算和公平选择 | 多 workspace、多 Gateway reserve 原子性、unknown 保留、老化、公平等待、资源补偿和缓存清空重建 |
| D | 按 PID/creation token 去重、CPU 对齐、快照 epoch/TTL、指标口径 | 重叠树、PID 复用、过期快照、Gateway 忙/Main 闲、未知采样负例与固定输入 JSON |
| E | 多窗口 visibility 聚合、观察者引用、隐藏窗口节拍 | 真实 Electron 两窗与 BrowserWindow，多窗显隐/关闭/重开，后台 run 持续，订阅/控制请求计数 |
| F | 普通流式输出按帧合并、终态即时发布和气泡隔离 | seq/终态/取消负例；真实 Electron 流式输入、滚动、React commit/long-task 配对；4 语回归 |
| G | 动态高度视口、锚点和合计缓存字节预算 | 长会话/大消息/图片/工具对象、定位和展开 E2E；字节淘汰和回读正确性 |
| H | 同语义 watcher 与只读模型共享、失效与零引用释放 | 相同/重叠根及不同 filter、两个窗口引用、最后释放、删除重建/失效负例；句柄与 I/O 对照 |
| I | 控制与 poll 额度、共享 executor 引用、大日志背压，按测量选择 CLI 服务 | 并发 poll 下 kill/stdin deadline，引用退出隔离，输出字节上限和 artifact 回读；spawn/RSS/延迟对照 |
| J | 按执行阶段与压力采样调整并发，软回收冷资源 | latency+backlog 反例、不同类别延迟、内存压力、恢复/滞回/吞吐拐点；不得删除失败样本 |
| K | 冻结混合工作负载与 before/after 配对 | 单窗/多窗、1/4/8 agent、远端等待/检索/git/日志/重构建、资源压力；ABBA 顺序、原始样本与 P50/P95 |
| L | 长期回收、整合候选与最终验收 | 至少 50 lifecycle、5 分钟 idle 起点，长 soak 单列；取消到退出、PID/句柄/private/commit/缓存；负例、哈希和 credential scan |

每个开发叶节点都交付回归测试；对应验收通过后才标 done。性能包的完成要求配对收益或有依据的 reject 决策。
不以改进平均数覆盖超额分配、错误完成、丢事件、误杀、未知成本或回收残留。

## 实施边界与复用

- 继续使用既有 ResourceFabric、provider quota owner、session/generation、WatcherHub、TimerAligner 和回收 receipt。
- 总量、公平与执行阶段预算通过这些 owner 扩展；不建立第二资源事实库。
- 所有交互由脚本/agent 执行并标注 `driven_by: agent`。证据写入 D:。
- 开发、功能验收、性能收益与发布状态分别记录。当前工作不改变冻结产品锁或默认值。
- 与现有节点重叠的功能先整合其提交，再用当前候选验证；保留其他会话修改。

