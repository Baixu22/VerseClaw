---
id: autonomy-resource-owner-admission
title: 资源预留与释放归既有 owner，投影不授予空闲
type: ai-coding-rule
severity: error
---

资源身份携带 owner 已解析的 workspace/project/session/generation；统一视图仅保留
envelope、关联 ID 与可重建索引，不新增中央 leaseState/workflowState/effectOutcome。

同一 owner 的宿主、项目与会话预留须共同计入容量；预留检查与记账不能跨 await。
多资源采用固定次序并在部分失败时补偿，等待须可取消和老化；取消/控制通道不排在工作槽后。
Runtime 资源等待保留原 AbortSignal，取消立即移除 waiter；grant 与实际工具回调之间
再次检查。已启动工具的占用保持到原执行 owner 结束，不能仅因 signal 已取消提前释放。
未知成本、未声明容量和模拟隔离均单列，不能用0、无限值或 caller bool 声称安全余量。

Provider spend 扩展归既有 ProviderOutboundBudget：runtime.providerBudget 显式配置host、
project或session token/USD上限，未配置时不启用。预算journal在原共享SQLite内，三层
预留同一事务检查并写入，原scope和随机owner token绑定；不得用shadow视图授予额度。
每次model call按模型上下文/输出上界保守预留，最终usage按同call身份核销；缺usage、
全零未定价模型或不明发送保留unknown liability，重启/取消/TTL不清账。历史transcript
不回填为新budget的消费，预算起点及未覆盖的物理重试必须如实记录。
发送前从既有 SessionEntry 核对物理 generation 和逻辑 workspace；首次可信绑定后，
同 generation 的 caller 不能改换 workspace。子调用继承会话 owner 的逻辑身份，
不能把不同 checkout 目录当成新的项目余额。异步加载 wrapper 前即固定原 run 身份。
workspaceId 属于会话核心字段，插件 extension slot 不得覆盖它。
通用Gateway聊天和编排入口由Main转入已检查权限的workspaceId；caller给出的不同
scope拒绝派发。编排首个子调用前从原session owner绑定generation内的workspace，
启用项目预算时，非backend调用者不能为模型请求指定该身份。
每个guarded物理尝试在发送前取得预算ticket；transport拒绝未发送请求后，逻辑调用
结束时归还预留，已发送的失败尝试保持unknown。响应EOF或错误返回消费者之前，
先完成原dispatcher与并发slot的释放。费用用该调用固定费率与完整usage字段核销；
缺失使用量明细保留unknown，归一化cost=0不能授予免费余额。

工作树隔离只消费既有 worktree owner 的实际 checkout/generation 证据；writeSet 缺失的
推迟逻辑保留。租约 TTL 不能证明旧 writer 消失；先 fence，再由原执行 owner 证明隔离或结束。
清空 ResourceEnvelope 等投影后必须能从原 owner 重建占用，不能因此释放尚活跃的资源。
Main快照从HostAgentBrowserService和TerminalSessionManager重建会话条目；runtime
快照从活动租约和等待队列重建占用，实际owner关闭后再移除相应条目。
浏览器loadURL在未产生导航事件前拒绝时，同一导航等待立即清理；旧timer不能
中断后续导航，失败Promise保持可被调用方观察。
ConPTY尚未给出PID时保留null，就绪后从原PTY对象更新读取；不把0当成实际进程。
native终止失败时保留终端owner及占用；部分回收的失败数进入原回执，不能输出全部释放。
终端close与回收等待原PTY退出回调；kill请求已接受而尚无exit回执时保持占用，
会话删除仅在其终端owner确认清理后提交terminalClosed。
浏览器close、会话/工作区回收等待原窗口closed回执并确认窗口销毁；关闭失败或仍在等待
时保留原会话和占用，同一owner的并发close共用原关闭操作。
Gateway在fork时保存原native exit回执，同一进程的并发stop共用一个终止请求；
已有回执可直接消费，没有回执不能凭网络关闭释放进程owner。
Windows树终止不可用时，对原native PID施加SIGKILL并等待原exit事件；
PID已消失而事件尚未到达时继续保留owner，超时仍报告终止失败。

Worktree owner 创建遇同名、规范化后重名或未登记的已有目录必须拒绝，不先删除。
租约journal初始化以已提交WAL或其初始化marker为依据；首个mutex等待创建的目录
不证明journal已存在。已初始化journal丢失时继续拒绝新writer。
生命周期互斥复用进程出生标识锁；遗留锁身份未知时拒绝，不能仅因超时执行临界区。
Windows首选host探测超时时，经系统PowerShell读取同一native FILETIME；两个host均
不可用时继续拒绝身份准入，保持原进程标识格式及活跃owner占用。
记录的 generation 与实际 checkout HEAD、私有 Git 目录及其回指一起验证；对外快照的
修改不能改写 owner。真实 Git 创建失败不能改用目录模拟宣称成功，默认 inprocess 保留。
计划阶段尚无 checkout；调用者的 verifiedWorktreeIsolation 布尔值不是放行证据。

Subagent 的单 gateway owner 在实际 agent 请求前写入原 registry 的 pending 预留；
并发准入把预留计入已有 maxChildrenPerAgent。accepted 只把预留转为已派发占用。
取消仅凭 owner 的 ok/deleted 回执释放；网络失败、普通 wait timeout、显示层过期或
本地上下文丢失不能制造 endedAt。未知记录持久化并恢复占用，只有执行终态或确定的
取消才能归还额度。共享SQLite事务同时读取容量和写入预留；排队请求也在此事务
中取得唯一派发claim。按行读取版本校验保存和删除，旧快照不能覆盖其他进程的终态，
未读入本地Map的记录保持完整。队列决策前同步已提交的peer记录。

编排波次复用原 subagent registry 保存 queued 请求；计划波次不能把 accepted 当终态。
只有全部前序节点的原 owner 结束且成功才派发后续波次，前序失败/取消拒绝后续节点。
原 owner 的完成事件和 agent.wait 终态均推进同一队列；重复通知不重复派发。
handoff开启时，已有registry队列接收后续波次；提交RPC先返回，派发前读取前序
owner冻结输出，校验run/角色/任务/负责人身份后封装有hash的引用。缺失或错配输出
拒绝后续派发，重复drain不重复拼接或发送handoff。
派发阶段的bundle和synthesis保持pending；scheduled记规划排程，completed仅记原
registry的成功终态，queued/running/failed/unknown按原owner记录分别回读。
发送前检查负责人 generation、session admission fence、实际 worktree 与当前有效容量。
旧待派发请求从原 SQLite 恢复，发送结果未知保留占用，不因重启再次发送。
未配置的规划并发上限标为未知并串行，不使用无限容量；不改变 provider/process 的冻结默认。

Provider 重配必须保留原 gate 的实际在途/排队状态；缩容不能在 active 仍超过新上限时
接着移交槽位，扩容先服务旧等待者。未受限在途请求不能在启用限制时凭空消失；占用中的
quota 别名改绑须等待原 owner 排空。当前有效限制与历史 gate 参数分别回读，关闭限制
不等于已经测得无限安全容量；普通 caller 对旧配置对象的修改不能改变已发布策略。

宿主、项目与会话的token及USD限额分别用独立进程同时预留验证；拒绝应归因到实际满额
scope，失败事务不能留下部分allocation。原生USD核销预期从夹具显式usage与报价独立计算。

保持现有配置、产品锁与冻结默认。所有自动场景和故障注入标为 driven_by: agent；
实现阶段的局部通过不等于 TF-0679 完成，更不代表 TF-0664 或 GA。
