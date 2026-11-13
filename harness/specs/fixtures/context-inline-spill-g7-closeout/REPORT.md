---
driven_by: agent
actor: codex-g7-inline-spill-tf0749-01a1d34c
realHumanEvidence: false
---

# G7 Inline/Spill 合并与卫生收尾

TF-0700、TF-0749及11个子节点均已done/100。本轮完成合并与证据卫生检查，不追加live评测。
第九轮实测候选27c1a91dd228369ca1427d2b30f39dd6222cee37的B1–B7全通过，GO维持原值；
第五至第八轮NO_GO、dirty拒绝、预算阈值、模型输出和SHA256SUMS均保持原字节。

第七、八、九轮共有11组需要登记的证据镜像。各文件的SHA256与所属原始清单逐一匹配，
登记仅追加这11组及其来源说明到scripts/duplicate-assets-allowlist.json，已有22组保持。
重复检查退出0，33组与清单一致；阈值仍为102400字节。每组来源与摘要见duplicate-reviewed-evidence.json。

本线合并清单只含20个G7提交，排除Windows和Knowledge的相邻提交；评测候选身份从完整
G7 Git历史与bundle恢复。集成检查和稳定证据路径在本地合并回执中记录。
源码仓库的repo:artifacts:check退出1，具体为15份历史UI文件未登记并被忽略，共30条诊断；
主线集成后重新检查，原失败日志保留。该问题不会通过改写G7证据清单消除。

合并前工作树清理必须满足clean、无其它会话占用、独立Git历史与唯一产物可恢复。
生产recall默认值、产品锁和发布状态保持原样。
