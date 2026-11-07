---
id: autonomy-resource-admission
title: 多会话在真实资源 owner 上预留、等待、核销与恢复
type: scenario
---

并发会话分别申请有限资源，已有 owner 原子预留宿主/项目/会话额度；争用者等待并可取消。
持续新工作不能使旧等待者永久饥饿。部分资源准入失败须归还未启动的预留，活跃执行只由
原 owner 的终态释放，控制与取消调用保持可达。

隔离并发需要实际 worktree checkout 证据。模型或调用者自报隔离、未声明上限、
过期租约但旧 writer 仍活跃、清空投影后的假空闲，均不能放行第二份危险工作。
预算保留 unknown 成本和待核销占用，不把缺失使用量当0。
Main给通用聊天与编排请求绑定当前已检查权限的工作区身份；不同caller坐标在
provider派发前拒绝。首次编排也从原session generation绑定项目，子调用继续使用
同一owner坐标。
启用项目预算后，父会话完成首次 workspace 绑定，子代理即使在不同 checkout 执行，
仍从原会话 owner 继承该项目身份。缺失或已换代的 owner、同 generation 的 workspace
漂移在 provider 发送前拒绝；清空缓存与重新打开 SQLite 后绑定和消费都能回读。
派发确认后展示pending；执行计数从registry回读，规划scheduled数与成功completed数
分别呈现。第一波尚未结束时，后续波次保持queued且完成计数为0。
handoff开启后同样先返回queued；后续请求携带前序owner冻结、校验和散列后的输出。
没有可用冻结输出时不派发后续工作。
多个进程共享状态数据库时，在同一事务内检查容量并写入claim。同一排队请求只派发
一次；旧快照写入和删除遇版本漂移时拒绝，原child/controller/generation保持绑定。
provider并发拒绝或排队取消确认没有发送后归还预算；发送失败保留unknown。完整
响应消费后立即可重新准入。模型费率固定到本次调用，遗漏成本计算的usage仍按
真实token明细核算；明细不足时保留unknown成本。

验收读取真实 owner 记录和故障反例，包括跨会话竞争、部分失败补偿、缓存重建、
旧 generation/fence 与实际受控子进程；所有交互由 agent 执行并如实标注。
