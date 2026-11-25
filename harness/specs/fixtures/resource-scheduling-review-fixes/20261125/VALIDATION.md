资源调度修复已合入 main，代码候选为 8a565c8ba49687c9ffd03b6d0e86dca45db87423，审查基线为 526645345fac24c0ecb0f7e4170d920e57d37153。所有执行和回归均由 agent 驱动。

六项修复覆盖执行槽位保留、主机压力缩容、实际入口排队上限、排队取消与期限、诊断记录与保护分离，以及降载期间的公平回收。补齐了恢复重置、出生标识暂缺、终态写入重试、休眠恢复和活动刷新边界。

214 项资源定向测试（Main 148、runtime 66）和 59 项 Harness 测试通过。Electron 设置场景通过，退出后记录的进程全部结束；主机原生回执最终无残留预约。Main/Web/Test 类型检查、构建、通信回放及比较通过。ESLint 0 个错误、0 个新增警告，Main 入口保留 1 个既有警告。

四份 WorkBuddy 审查均由 ccs-workbuddy/deepseek-v4.1-flash 返回正式纯文本结论：NO_ACTIONABLE_FINDINGS。各审查所读文件已与最终候选逐字节核对。不同提交上的复用验证按 owning source 范围核对等价，详情见 checks.json。

Main 以快进方式接纳修复，七个重叠文档/语言文件通过三方合并保留既有改动，其他暂存条目保留。38 个非写集文件未被本次集成写入；其中三个文件的并行更新保留当前内容。

完整 Harness CI 的 Agent Dev 严格审计仍失败：四份既有证据超过 24 小时有效期，旧 deep-test 报告的 typecheck、Playwright、contract 超过冻结预算。该失败及原始反例保留，见 baseline-agent-dev-audit.json、negative-probes.json。

远端 main 的八个提交已整合为 e82b5ff1d626a8fb2d47f4d978a0302b7504e165。资源审查所读源码保持一致；新候选重新通过 214 项资源测试、三组类型检查、VerseBrowser/Main 构建、Electron 设置场景和通信回放比较。整合过程继续保留主线已有改动，详情见 remote-main-validation.json。
