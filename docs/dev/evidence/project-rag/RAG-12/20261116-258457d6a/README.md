# RAG-12 配置与索引运维验收

候选 `258457d6a45a0bab5b32eed47b88745dde84f666` 完成配置、owner 状态、索引暂停恢复、撤权清理、模型生命周期和回滚验证。270 项前端/Host、21 项 Runtime、两条 Electron 旅程和十二阶段 CI 通过；独立复核无可操作发现，六张截图已检查。

正式结果与全部源码输入见 `report.json`、`source-inputs.json`、`gate-summary.json` 和 `SHA256SUMS`。本包保留完整 Agent Dev 的实际功能与耗时结果；日常流程使用仓库已有的构建复用、缓存类型检查和 Workbench 烟测，审计 91 分。完整性能超限继续由 RAG-19 核对。

`run-candidate-gates.py` 记录各阶段命令，验证树只含已跟踪文件并复用已安装依赖。运行需指定新的输出目录和相同候选；来源 owner、session、模型和作业 generation 均由产品路径回读。Runtime scoped lint 复用已生成的公开 SDK 类型声明，整仓声明准备时的 Slack 缺模块记录保存在 `history/runtime-lint-prepare`。

失败、复跑和修复链见 `failure-history.json`。原始跑次与一次性诊断保存在其列出的 D 盘私有目录。所有脚本与模型执行均为 agent 驱动。
