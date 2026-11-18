# RAG-15 代码关系与当前任务线索验收

候选 `17c80e283e4e7184791a7be0f168bd35309494bf` 通过 196 项单元、5 项 Electron、完整无缓存类型、Runtime/桌面构建、通信及 12 阶段 Harness CI。独立复核通过，发现 0 项。

相对模块按实际路径解析，调用绑定真实符号；显式未知路径返回缺口，活动文件和同名符号保持各自含义。关系默认一跳、最多两跳，文件与返回边有界。末次异步 owner 校验后同步复验版本、字节和链接状态。当前任务 hint 保留 generation、revision、约束与证据引用，读取保持任务事实，代码 chunk 表排除任务内容。跨工作区、同名文件、旧边、旧任务 pin 与回滚通过。

两个末次校验窗口在旧候选 `1d474d1e9` 返回旧片段；独立复核随后在 `0e8dbec54` 发现显式未知路径被同名符号替代。修复回归已在当前候选通过。随后在 `6118a355b` 复现了 513 条 incoming calls 静默漏检；修复后每跳共用 512 条候选预算，SQLite 边读取有界，截断返回 partial/truncated。当前 Runtime parity 使用与原判据 SHA-256 一致的七份冻结输入。此前的类型性能、Electron 等待时序、Runtime 启动超时、针对性回归失败和未完成复核保存在 `history-index.json` 指定的本地归档。独立 Verifier 的完整跑次见 `independent-review/archive-index.json`。当前正式收据、截图、逐项测试覆盖、源文件摘要和独立复核位于本目录；执行均标记为 agent 驱动。

复现时检出上述候选，使用其 `requiredTests`、当前目录的命令收据和 `COMMANDS.md`。运行前将 TEMP/TMP 指向 D:。本轮复用已安装的依赖，模型旅程使用本地脚本 provider。
