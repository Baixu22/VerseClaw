---
id: autonomy-host-readiness
title: 自治执行前回读实际宿主能力
type: scenario
---

agent 通过现有 sessionActivity.snapshot 读取 owner 的当前会话策略和宿主探针。
首次无 run、断连、过期观测、跨 scope 和缺失服务保持 unknown/unsupported；
真实 run、continuation 和重启后的新观测可追溯到当前代。关闭 UI 的运行与退出应用
分开测量，脚本化 provider 仅证明工程接线，不声称真实模型质量。
