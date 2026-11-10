# RAG-02 冻结评测输入验收

候选 `9d084050e589d47f43f75192fe7b844b2efff19a` 的 240 查询、60 任务、三臂 540 槽和 64 安全负例已冻结。54 份来源快照与 pinned Git blob 相符。

当前候选相关单测 182/182、完整 node/web/test 类型检查、合同、通信及 12 项 Harness CI 通过。首次并行检查的两项超时及原始失败保存在 historical/；同候选串行重跑保持原超时设置，182/182 通过。

`report.json` 对应五项验收，`review.json` 保存独立复核，`failure-history.json` 保留 v1/v2/v3 与中间门禁失败。所有产物由 agent 驱动。540 个模型执行槽状态为 not-run，由后续长期验收执行。
