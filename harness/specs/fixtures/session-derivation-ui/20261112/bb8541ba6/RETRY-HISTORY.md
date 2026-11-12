# TF-0662 失败与重试历史

1. 早期聚合在运行中改源码，source guard 正确失败，整轮无效。
2. runtime entry-only 产物最初缺少 `facade-activation-check.runtime.js`；归档/恢复旅程在隔离后仍复现，补齐同源码产物后通过。
3. U6 crash-recovery 第一次在 Host `gateway.start` 默认 60 秒处返回 TIMEOUT；主进程随后约 58.7 秒进入 running，session generation/history 一致。driver 保留超时并继续检查 owner 状态到最多 120 秒。
4. 最终 HEAD 的单进程 35.6 分钟聚合在机器多组 Electron 负载下出现 4 个窗口/RPC/启动资源失败，11/15；本轮未用于结论。
5. 最终 HEAD 改为五个 spec 分片、每片独立启动与清理，顺序回归 15/15；每片 source guard 未发现运行中源码变化，清理零残留。
6. 基线 5ffc 的 `chat-session-handoff` 入口存在，但旧版不显示 `chat-handoff-dialog`；基线仅记录该旅程为不可用，其余五条与候选使用同一 driver SHA256。
