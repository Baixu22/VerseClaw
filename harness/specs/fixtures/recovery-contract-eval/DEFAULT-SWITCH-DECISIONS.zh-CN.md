# 默认值决策证据（2026-11-05）

`driven_by: agent` · `actor: recovery-default-decision-auditor` · `realHumanEvidence: false`

完整冻结评测结论为 **FAIL / NO-GO**，qualityClaimAllowed=false；不触发默认值或产品锁变更。源码与可复算数据见 [最终证据](final-20261105/README.md)。

| 开关 | 当前默认 | 已有证据 | 剩余边界 | 建议 | 回滚 |
|---|---|---|---|---|---|
| TaskFlow lifecycle writer | legacy | 同一row的status/phase/revision CAS；15/15候选窗口正确分类 | 绝对时延失败，基线第二轮不完整且结构有差异；跨域cutover/rollback范围独立 | 保持legacy | 选择legacy，不同时写两份权威 |
| RecoveryAuthority shadow | off | 35/35已观察决策有带原因的drift记录；核心P95=.0031ms | 另1超时观察缺口；当前仅main-session，coarse事实未等同phase journal | 保持默认off，测量可显式打开 | 取消环境变量 |
| Execution phase writer | legacy | 持久化intent、前置CAS、真实executor重派、unknown quarantine；本地故障语义达标 | 45样本冻结P50=32007ms、P95=86786.4ms，分别超过5000/15000ms | 保持legacy | 任一writer切回legacy；未知效果保留对账状态 |
| Event-log replay | false | event-log/receipt作为关联证据，未授权外部效果重放 | 通用effect恢复及其否决条件仍未通过 | 不提议启用 | 保持false |

默认翻转属于所有者的重大决策；本节点交付证据和明确NO-GO建议即可收口。所有演练及判断由agent执行，产物如实标注。
