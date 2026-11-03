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

run 编排到 attempt 必须原样传递已有 owner 的 workspaceId 和 workspaceFingerprint。
缺失值保持缺失，不能以实际工作目录代替逻辑身份。独立运行旅程复用宿主已有 generation
生成与 stamp 入口，并核对实际子进程回执，不把未盖章的 CLI 当成已确认的宿主代。

队列续行也必须保留已有 workspaceId/fingerprint，不能在手工组参时丢失 owner 身份。
Gateway 的 pipe 输出必须被消费；未转发的 stdout 也不能堆满并阻塞实际请求或续行。
无 owner ID 的 legacy profile 仅供本地 prompt，不发布成按目录寻址的 owner 观测。
chat 输入队列沿用既有 SQLite payload 保存 fingerprint，两条 drain 复用同一身份；
不同 agent/workspace/fingerprint/task-root 的行分批 claim，不能合并成首行的执行范围。
