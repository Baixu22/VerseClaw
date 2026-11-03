---
id: autonomy-task-actions
title: agent 提交可归因且可安全重试的任务动作
type: scenario
---

agent 自动动作经现有 typed Host API 请求 Main 回读 runtime owner，再按 workspace
日志版本提交 create/update/link。模型不能自报 user/system。重试使用同 operationId，
并发陈旧版本、同 key 异参及跨 scope 不写入；新合法意图有新 ID。
主日志追加成功后 projection 写入失败仍可从盘上重建，返回原 operation receipt。
脚本/agent 完成交互和验收并如实标 driven_by: agent，不等待真人。
