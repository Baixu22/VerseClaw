# 恢复验收工具修复与证据

模块相对 `new URL(path, import.meta.url)` 引用现按源文件所在目录解析，同一引用只记录一次，缺失目标继续触发检查失败。两份历史清单中的 10 项漂移已逐一从原提交的 Git blob 核对，并写入现有 INTEGRITY 标注；原 SHA256SUMS 字节保留。

源码提交 `809c5c7c7513e1e8c93d3ea6687f34e7dfe99201` 与审查对象具有同一 Git tree。关联回归 10/10、6 项检查、10 项历史哈希核对通过。WorkBuddy `ccs-workbuddy/deepseek-v4.1-flash` 最终复查无可操作发现。此前三次缺少有效判断的审查原件完整收录。

`report.json` 记录源码、验证与审查结果，`verification.json` 提供原件哈希，`raw-evidence.jsonl.gz` 保留可还原的输入和输出。全部产物由 agent 驱动。

TF-0818 和 TF-0707 的正式验收继续使用原冻结条件：同一候选的故障窗口、live-provider 样本、九项指标与必要门禁仍需完成，当前 GA 为 NO_GO。
