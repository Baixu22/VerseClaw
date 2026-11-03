---
id: autonomy-task-action-boundary
title: 自动任务动作身份与提交权威
type: ai-coding-rule
severity: error
---

自动动作只消费 Main 已核对的 runtime session/agent/generation，payload 的 actor 或
principal 不是来源。自动 actor 固定 assistant，手工与已有内部事件保留原 actor。
scope/generation 不能从标题、路径或任意 sessionKey 字符串推断；缺 owner 即拒绝写入。
Gateway 的 app 内 generation 计数可能在应用重启后重复；还必须比对 owner 回读的
childPid 与 connectedAt，不允许旧进程的尚未提交请求借同计数进入新 owner。

Task Ledger 继续是事件事实 owner，操作版本、幂等摘要和批次都写入既有事件日志；
projection 不持有独立完成或授权权威。跨入口提交必须串行，先查已提交 operation，
再查 revision；同 ID 异参拒绝、同参数新 ID 允许。未完成帧不能产生部分逻辑效果。
重试、崩溃与 projection 重建不得改写历史 actor，或者把一般 done 状态当独立验收。
已提交的原请求可在 Gateway 换代或不可用时只读恢复原回执；它不准入新写入，
未提交的旧 epoch 请求仍拒绝。自动 operation 去重不占用旧生命周期的 batch key。
Main 不得持日志写权等待 Gateway RPC；runtime 同步检查点可能正等待同一日志。
source 模式只通过既有 OPENCLAW_CONFIG_DIR 传递 Main 的任务事实根，其他 runtime state/config 保持隔离。
Main 将任务事实根展开为绝对路径后传递，避免父子 cwd 不同。一般元数据先转换为
实际持久 JSON 再计算校验和。孤儿回收同时核对 PID 与进程出生标识，不按年龄驱逐活跃写者。
同键 session reset/delete/replace 与提交复用既有 session-store writer 的外层 epoch fence；
锁顺序固定为 session-store epoch -> journal，不允许反向等待或在 journal 下调用 Gateway RPC。
