---
driven_by: agent
actor: codex-g7-inline-spill-tf0749-01a1d34c
realHumanEvidence: false
---

# G7 Inline/Spill 合并与卫生收尾

G7的13个节点全部done/100。独立集成检出从main候选fda6346dd应用21个本线提交，无冲突；
集成候选46d2e27df3cc9b9bbe82ab5a1038735261a9daf7通过68项单测、完整node/web/tests类型、
契约、33组重复检查、定向Harness和完整Harness CI。完整CI的59项测试通过、188条证据引用通过，
Agent Dev grade B且无disqualifier。回流main与清理后的实际结果记录于本地交付回执。

第九轮原clean候选27c1a91dd228369ca1427d2b30f39dd6222cee37的B1–B7仍全通过：
稳定17/18、reference13/18、控制6/6，token下降5.694417567%。固定候选verifier再次接受
集成目录中的210份原封存文件和609个归档。原第五至第八轮NO_GO、dirty拒绝、预算与阈值不改。
34份评测源码绑定中33份与原候选逐字节一致，package.json保持当前main版本；生产保留实现一致。

| 检查 | 实际结果 |
|---|---|
| G7定向单测 | 9文件/68项，退出0 |
| 完整类型 | node/web/tests退出0，cache disabled |
| Host API契约 | 退出0 |
| 重复证据卫生 | 33组匹配，退出0 |
| 定向Harness | validate与dry-run退出0 |
| 完整Harness CI | 59项测试通过，退出0 |
| 第九轮同候选verifier | B1–B7全过、GO，退出0 |
| 全仓库artifact规则 | 110条现有G8/UI诊断，退出1；G7诊断0 |

11组G7证据镜像已按各原清单逐文件核验，追加到scripts/duplicate-assets-allowlist.json；
已有22组保留，阈值仍为102400字节。镜像保持原运行、机制对照、恢复汇总及独立复算的
稳定目录和原字节，详情见duplicate-reviewed-evidence.json。

首次类型检查因隔离检出缺少VerseBrowser声明失败。补齐本地依赖、上游补丁检查和声明构建后，
完整类型重跑通过。错误命令入口和用第九轮spec覆盖整个集成写集的失败回执均保留；
集成范围由独立收尾spec绑定，冻结第九轮spec保持原字节。

G7完整Git历史已导入主仓库，并封存于D:/ClawX-archives/g7-inline-spill-20261113-01a1d34c/g7-source-recovery.bundle。
6197份原始临时证据逐字节封存，原始内容总计301458178字节；
恢复索引在同归档目录raw-evidence-index.json，压缩包全部成员重新读取且SHA256一致。
临时检出在clean、无占用且Git历史和唯一产物可恢复后清理；Task Forest历史保持本地。
生产recall默认值、产品锁和发布状态保持原样。

main回读发现新收尾包4份Windows日志被text规则转换换行。新目录追加-text字节锁后，
从保留的原字节重新入库；原清单SHA256SUMS保持，历史第九轮与其它包均匹配。
