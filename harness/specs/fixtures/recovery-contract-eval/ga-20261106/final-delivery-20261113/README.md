# 最终投递恢复验收

源码候选 aacbe24397c6fd8d7b9d67f0147932de25ab8a72。最终投递沿原 durable intent 保存准确 Session 引用，每次平台发送重新核对身份；global permit 使用已持久保存的 outbound agentId。已应用 intent 可在旧世代 reset/delete fence 后结算；未知或部分发送保留原真值、预算与退避。仍引用同一 intent 的不匹配答复保留 applied 真值。

31 项检查、主回归 241 项、独立检出 139 项通过，包含原生类型、严格 lint、构建、comms、contract 与目标 Harness。两份当前 PID/SQLite 证明均为效果 1、尝试 2、重复准入 0，测试子进程全部退出。gpt-6.1-sol fresh autoreview 退出 0，findings=[]。源码全文和 Git blob 哈希均可回算；独立检出复用已安装依赖视图。

R11 首轮进程证明出现空准入，当时 PID 存活状态未捕获；原失败、探针及复跑均保留。nullable intent 和测试 fixture 类型失败按原记录保留。回调限制试验与既有确认通知契约冲突，已撤回；原发现、失败及处置保留。确认通知使用原 intent 消息与 receipt，Session 引用结算以 CAS 保护后来的答复；applied 重启不重放进程内回调。旧整仓源码快照按索引和 SHA256 保留在原路径，本包包含当前26个源码文件与相关失败证据。

完整 Harness CI 退出 1：旧 Agent Dev 报告超过原 24h 新鲜度门禁，具体条目见 manifest.fullHarnessCI。整体 GA 为 NO_GO，继续 ACP、goal-wake、五入口回滚、两轮 legacy 一致性与冻结指标/完整候选门禁。所有执行均为 agent 驱动。
