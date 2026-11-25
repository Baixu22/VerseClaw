# Gateway 按需加载与开发验证

原生 parser 和 grammar 在首次分析对应语言时加载；成功初始化语言后缓存 parser，加载失败可以重试。内置 harness 的支持元数据保留原能力声明，首次执行通过 runtime 入口调用原 runner，并在执行前写出可用的编译缓存。

源码提交 `9c52d611dfca761d792260754b928f46b3e861ca`，验证输入为原 r6 工作源码投影。最终两项隔离检查通过；此前 52 项定向检查保留为早期夹具版本。Node 和 Bun 各三对基线/候选、每进程七种语言的完整分析对象一致。Node 夹具的导入中位耗时 1289.847→232.442 ms；Bun 为 204.629→213.705 ms。真实路径调用检查为 27/30，其中三个 COMPASS 失败在原 HEAD 源码下同样重现，原失败和诊断保留。

`ccs-ai/gpt-6.1-sol` r6 独立复核 0 发现。类型感知 lint、完整无缓存 Node/Web/Test、runtime 重建与 Gateway 启动、六项源码门禁、两份 Harness 和通信检查通过。完整类型外层 43.178 秒，满足原 45 秒预算；此前 51.689 秒回执保留。桌面完整构建外层 60.041 秒，原预算 58 秒。

同算法编译图扫描中的 harness 静态模块为 915→857、dispatch 为 974→941，启动配置保持 187 个模块。原 984 份编译输入与当前编译入口逐 hash 回读；runtime 中的动态入口和执行前 cache checkpoint 已核对。

真实恢复批次在 Electron 导入阶段中止：0 个用例执行、0 份恢复回执，恢复时延为空。Electron 入口已连接到版本与哈希一致的既有 40.8.4 依赖，修复启动了 0 个 Electron 进程。后续三组连续三次真实 kill 在串行验收窗口恢复后执行。

GA 为 **NO_GO**，TF-0818 保持 in_progress/0。桌面原 58 秒预算和实际恢复测量待补齐；同一干净候选的两臂五窗口、30 对 live-provider、第二轮 legacy、九指标及完整源码/打包验收仍按原条件执行。

原件在 D:/tmp/g3-harness-loading-20261120-01a1f836/。本目录归档保存验证、失败、源码快照及编译输入的原字节；Task Forest 和导出 helper 继续保留在本地。report.json、verification.json 与 SHA256SUMS 绑定源码 Git blob、归档和回读结果。所有产物由 agent 驱动。
