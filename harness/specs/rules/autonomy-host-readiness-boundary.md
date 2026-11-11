---
id: autonomy-host-readiness-boundary
title: 实际宿主就绪投影不授予执行权
type: ai-coding-rule
severity: error
---

通过既有 Main sessionActivity -> runtime effective-policy / cron owner 回读能力。
supported 只表明该来源在本次观测可用；调度、权限、预算与副作用仍由各执行 owner 裁决。
配置、静态 descriptor、已保存 patch、旧连接健康和历史运行证据不能生成 supported。
未知预算、未观测服务、过期或未来时间、scope 或 generation 不匹配必须明确诊断。
连接更替清除旧探针，不能让旧 RPC 回答覆盖新连接。不得安装管理员服务、删配置字段、
改变冻结默认或另建 scheduler/config writer。配置没有缺陷时不为证明活动而改写。
