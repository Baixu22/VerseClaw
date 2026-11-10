TF-0660 的原九条验收已逐项读回，候选 `1ce245ee69ef6d30a38365f12ee58848624ea91d`。

子代理面板现在从当前会话代次的 Task owner 读取验证记录和业务验收；任务可打开对应 worker transcript 与产物，未知费用显示“未知”。队列收到拒绝时保留原消息；权威任务读取绕开繁忙的派生缓存写锁；读取前后的代次核验共享既有 Gateway 预算。

当前候选相关单测 **227** 项、Electron **12** 项通过。完整未缓存类型、Runtime/桌面构建、契约、四语、通讯与专项 Harness 均通过，详细原件见 `report.json` 和 `commands/`。

Electron worker 场景使用本地脚本 provider，实际执行 Host/Gateway 与文件工具；故障注入和 owner 回放在各自原件中标注。每次最终运行均有独立源码和进程退出核对。

重启回放保留 worker 的 `failed` 终态和 `pending` 投递阶段，验证同一 consolidated receipt 在重启后保持、旧 generation 被隔离。

完整 Harness CI 的退出码为 **1**，具体 Agent Dev 基线过期/性能结果保留在 `baseline/`。失败与修复后的通过各自记录候选；原会话 1,223 份证据的恢复入口为 `recovery-index.json`。

在仓库内运行 `python harness/specs/fixtures/session-delegation-status/20261110/verify.py` 可复核计数、所有 retained 文件哈希、候选源码、原九条验收与命令终态。
