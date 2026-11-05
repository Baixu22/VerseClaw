# TF-0743 读缓存一致性

干净候选 fe52d6f5ad3ea24ba4576deb0a5248d49456e529。既有 SQLite owner 提供 connection-scoped revision 与外层提交通知；query 缓存和派生索引失效，query/self-edit 输出 loadedAt/sourceRevision/scope/stale。

14 个新鲜度场景和全部相关回归共 87/87 passed、0 failed/0 skipped。类型、lint、Harness validate/dry-run、comms 全通过；结构化复核 0 findings。跨进程用自动退出的 Node writer，本产物 driven_by: agent。persist=false，不宣称恢复、live provider 或 GA。

类型检查首次触发 pnpm 自动对账而未进入编译，已停止 18 个本轮进程；最终 clean gate 使用 warn 配置通过。原 baseline 是先前九场景 fixture，不回填为当前十四场景的旧版运行。
