# 默认开关决策包（TF-0724）

> `driven_by: agent` · `realHumanEvidence: false` · **决策人：仓库所有者**

本文件把四个默认开关的 go/no-go 证据整理齐，**不改变任何默认值或产品锁**。
机器可读版本见同目录 `default-switch-decisions.json`。

| 开关 | 当前默认 | 候选 | 现有证据 | 仍缺 | 风险 | 回滚 |
|---|---|---|---|---|---|---|
| TaskFlow 生命周期写者 | `legacy` | `taskflow` | RC-06B/C/D 独立 verifier 通过（已证明未启用） | 本评测 PASS + 一次回滚演练 | 中高（一次改三个域的真相） | 选回 `legacy`，冻结 TaskFlow 写者 |
| RecoveryAuthority shadow | 关闭 | 打开（仅影子） | 24 单测；开关受保护、默认关闭 | 真实运行影子零未记录分歧 | 低（影子不改行为） | 取消环境变量 |
| 执行 phase 写者 | `legacy` | `taskflow` | 状态机 + K1–K5 决策 24 单测 | intent 生产接线 + kill-window 矩阵 | 高（误判会重复/丢弃外部效果） | 选回 `legacy`，先 reconcile 未决行 |
| event-log replay | 全 false（built-but-unwired） | 不提议 | `event-log.ts` 自述未接线；`replayEventLog` 返回 not_implemented | 崩溃/恢复正确性证据、veto gate 清零 | 极高（重放可能重复副作用） | 保持 false |

## 结论

- 只有 **RecoveryAuthority shadow** 属于低风险、可由 operator 打开做测量的项。
- **TaskFlow 写者**、**执行 phase 写者**、**event-log replay** 都必须等本评测
  出现 `PASS`（而不是 `EVIDENCE_INSUFFICIENT`）后再谈；它们改变的是产品默认值，
  按仓库政策属于所有者决策，agent 不代替所有者翻转。
- 本目录所有产物不含任何真人证据声明。
