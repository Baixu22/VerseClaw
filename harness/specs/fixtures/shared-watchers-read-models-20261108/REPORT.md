# 监听与只读服务复用验收

干净候选 `68533427ba832f574924ff526a8446a3b7635ca8`，全部自动执行标注 agent 驱动。

107 项回归与 Node/Web 类型、lint、契约、四语、comms、Harness、retention 均通过。8 项旧源码负例已复现。
同回调多次订阅独立计数，旧句柄重复关闭不会释放新订阅；递归重叠根共享监听，保留各自路径/深度/过滤，文件轮询采用最短活动间隔。
知识源同步复用 WatcherHub；根删除重建后恢复，模式、symlink、capture与cursor语义通过真实文件回归。
Git 状态按根共享，失效阻止旧请求回填；目录或.git身份变化重新读取。Main显式创建只读观察窗，入口、写权限和生命周期回归通过。

两窗口 ABBA 每轮8次真实Git状态读取：对照Git进程数 [34, 32]，共享 [4, 4]，减少 87.9%。关闭观察窗后主窗继续读取并观察文件变更。
8订阅、2重叠根、20写入的ABBA：引用监听句柄 [8, 8]→[1, 1]，每个共享递归根另有1个非驻留恢复轮询器；最后释放后计数归零。
内存与I/O计数保留原始样本，未据此声称RSS降低。

read-models.json、watcher-pressure.json与performance-summary.json记录原始及汇总数据；prior-runs.json保留首次失败。
SHA256SUMS覆盖本目录，credential-scan.json零命中；所有原生进程已退出。
