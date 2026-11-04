# TF-0739 收口证据

全部产物由 agent 驱动。干净受测源码候选：`6faa3e91f8297cdc4a45004000041abd8f775835`。

RC-03 复用现有 registry，覆盖 18/18 行；未知生产者、封印后 semantic 使用与重复注册均被拒。封印后改写提示词时 provider 调用为 0；合法的同次恢复和继续调用均成功。默认关闭、6000 字符受管预算与产品锁保持。

聚焦测试 98 passed / 0 failed；范围类型检查、lint、Harness validate/dry-run、comms replay/compare 均 exit 0。结构化 Codex/space-bunny 复核为 0 findings；原始评估和仅缩短说明的 schema 修复均保留，判断与置信度未变。Windows 检查工具不可用，复核使用带哈希的当前源码快照。

更宽入口套件 20 passed / 2 failed；冻结 ec7e01787 的目标复跑为 1 passed / 2 failed / 19 未选中，复现同名 COMPASS 断言。全量 uncached typecheck 仍有 2 个 RSI promotion 字段错误，相关源码 blob 与基线相同。这些门禁未记为通过；目标复跑不是完整基线通过。

请从 report.json、decisions.json、matrix.json 和测试 JSON 核对结论。commands.json 保存命令、退出码、候选身份与源码稳定性；source-manifest.json 绑定源码，review-metadata.json 记录复核输入与工具限制。probe/config 副本保留实际受测的本机 Windows 路径。SHA256SUMS 覆盖除自身外的全部精选文件，credential-scan.json 记录扫描结果。

provider 响应与场景操作均为自动模拟；不声称真人、live-provider、全部 adapter wire 或 GA 验收。
