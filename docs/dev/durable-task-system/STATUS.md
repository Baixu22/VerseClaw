**持久任务系统已接通产品调用链，正在对最终候选执行完整验收。** 实施目录为 D:/ClawX-work/durable-task-system-20261107，分支为 codex/durable-task-system-20261107。前一批实现已通过 f533277c7 整合到 main；当前工作树已同步到 7bd784bd2。

目标契约、来源、修订、任务识别、Git common-dir 共享任务域、事务领取、session/run 互斥、epoch、检查点及每次模型调用的目标恢复均已实现。task_control 支持分页查询、相似建议、分解与效果恢复；多级分解保留根目标及祖先约束，父任务等待子项验收，取消计划等待后代操作结清。事件 journal 与状态共享事务，未确认事件可以重送；旧 Task Ledger 事件有可重建投影缓存。

Main Task Ledger/chat/delegation、runtime before-tool-call、embedded model stream 和子代理 registry 使用同一执行契约。writer 在实际派发前转移，队列容量可用后重新核对，子代理终态与效果结清后归还；父会话保留只读目标。验收复用 EvidenceVerifier、EffectReceiptStore 和独立 verifier run。tasks.contract.accept、tasks.contract.receipt、tasks.contract.reconcile 均有真实 Gateway 方法测试。

当前证据：任务相关 56 项测试通过；完整目标恢复配对评测覆盖两个真实模型、3 个中英文场景、每个场景 10 次上下文重装配，6 个保护组样本逐字段及格式全部通过；摘要组 5 个完成样本均未恢复原始字段，1 个请求未完成。首次运行的 1 个格式偏差及复测原始响应均保留。

两棵真实工作树的 16 进程领取为 1 成功、15 拒绝。独立子进程在文件写入后以 23 退出，接续保留部分文件和未知写入说明。1 万任务下，领取 p95 5.55 ms、目标上下文 p95 0.317 ms、50 条分页 p95 4.61 ms；数据见当前原始证据目录 D:/tmp/durable-task-system-20261108/。

完整 Runtime 构建保留全部 17 个配置、插件、声明、导出与启动检查。当前候选首次在 8 GiB 堆上限退出 134；以显式 OPENCLAW_TSDOWN_HEAP_MB=12288 串行重跑后退出 0，用时 527.693 秒。声明阶段命中内容缓存，导出和启动检查正常执行；裁剪源码中不存在的历史 CLI 元数据步骤按构建规则跳过。该变量只改变构建进程预算；容器内仍遵守 cgroup 内存上界。Windows Plugin SDK 声明使用已有 TypeScript 编译器，OPENCLAW_PLUGIN_SDK_DTS_COMPILER=tsgo 可显式选择原编译器。

待完成：全部类型与相关回归、桌面分页/搜索/状态筛选及跨工作树旅程、候选指纹与证据封存、最终 main 整合和研发节点回读。产品运行不依赖 Task Forest；本机同仓库工作树共享是当前部署范围，不同机器需要独立协调服务。
