# 恢复契约的原始证据与报告

`driven_by: agent` · `actor: recovery-evidence-auditor` · `realHumanEvidence: false`

当前结论 **FAIL / NO-GO**，qualityClaimAllowed=false。冻结manifest未改；正式结论以 [2026-11-05最终证据](final-20261105/README.md) 为准，根目录report.json同步为最终candidate报告。

本包保留60个真实provider的边界后新assistant答案、30个主故障窗口，以及15次独立legacy复跑尝试（14完整、1注入后序列未完成）。每臂质量为120/120事实、30/30下一步、0错误完成/禁止事实泄漏；格式合规独立统计。主故障矩阵两臂dup/lost均0，终态正确率legacy60%、candidate100%；未归类比例40%→0。候选冻结P50=32007ms、P95=86786.4ms超过5000/15000ms。

源头与复算见source-index、bundle-index、comparison、baseline-repeat、attempt-inventory、source-audit、gates和offline-verification。343份artifact、105份receipt原文、442份metadata在raw-evidence.json.gz中按原bytes保留；不要求原始D盘case路径存在。基线结构只匹配12/15，TF-0711保持review_needed，不能引用旧“两轮完全一致”。

隔离核验：两臂--verify退出0重现既有负面报告；--check退出1仍是验收失败。篡改副本的answer字节后被拒绝，原包哈希未变。

历史redispatch-proof.json、historical-readback-correction.json保留为开发过程记录。它们的旧窗口/旧user-input评分及独立execution_phases描述不用于当前通过声明；撤回原因在最终包的epoch-disposition与metadata中。

TaskFlow已统一工具相位和生命周期写者；RecoveryAuthority仍是主会话只读shadow，生产决策仍经phase恢复器。TF-0715四个其他owner尚未接入，不能称五入口统一、通用external-effect exactly-once或GA。默认writer=legacy、shadow=off、event-log replay=false。
