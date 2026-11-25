# 主会话恢复准入验证

主会话恢复在 Session SQLite 中提交统一准入和原三次预算。公开输出经过写入屏障，未知效果保留对账。压缩后继在重试前提交；native、CLI、Codex 和后续回复沿用已提交身份。模型尝试先发 finishing，整条命令在 fallback 与持久化收尾完成后提交终态。完成恢复及原轮次已结束/正常运行时，旧准入被拒绝。

源码候选 `80af3990693d53f78d739e707e698f7b76cf8bd6`，43 文件、221 个不同用例、225 次执行和 26 道检查通过。Codex 引擎按用户指定模型 `ccs-workbuddy/deepseek-v4.1-flash` 复审退出 0、发现 0。隔离 tracked-source 投影复用已安装依赖，实际进程证明保持效果 1、尝试 2、重复准入 0，子进程全部退出。

`manifest.json` 记录来源与 SHA256；`raw-evidence.json.gz` 保留可恢复的原报告、日志、驱动和失败；`SHA256SUMS` 校验交付文件。全部产物由 agent 驱动，凭据扫描 0 命中。

GA 后续验收包括投递、ACP、goal-wake、五入口回滚、五窗口各三次、30 live-provider 对、九指标、5s/15s 门槛、重复 legacy 一致及完整源码/打包门禁。
