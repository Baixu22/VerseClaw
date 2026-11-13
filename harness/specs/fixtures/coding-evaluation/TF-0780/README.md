# TF-0780 跨进程恢复证据

本目录保留 TF-0780 编码副作用五窗恢复评测的正式产物。所有运行由 agent 驱动，标注 `driven_by=agent`、`actor=codex-coding-recovery-evaluator`、`realHumanEvidence=false`；本次验收不改变产品锁、默认值或发布权限。

正式候选为 `84ce9695ab957129d3ed7db1ec4dd2d3cf0ba9f7`，工作树干净。聚合报告摘要为 `c6c9cb9b02713d3f57c4a4b4ac6a36bd58e25896cba579128a9096c550738fa4`。独立 verifier 通过，10/10 篡改反例被拒绝。

验证覆盖：

- 原三窗 write journal kill 基线 3/3 通过。
- intent、effect、materialized、validated、cleanup 五个真实子进程窗口各 3 次，共 15/15 通过，另有未 kill 的正常对照通过。
- 每次恢复从磁盘读回文件树、journal ref/phase、Git/JJ 状态与 operation、VG candidate receipt、STS scope、durable process intent/started 和 Task Ledger projection。
- 第一次 undo 恢复用户文件，第二次 undo 的 `restored` 为空。
- 旧 epoch 由现有 `ProcessRunReconciler` 拒绝；正常对照的 exit 被识别为 terminal。
- 旧 epoch 采纳、重复 undo、用户字节丢失、假完成、Task Ledger owner 失败、进程 reconciliation 失败、JJ operation 失败和进程残留均为 0。
- ClawX coding 定向测试 49/49、证据契约测试 10/10、comms replay/compare、Harness validate 与仓库 artifact retention 均通过。

文件：

- `report.json` / `report.sha256`：正式聚合报告及规范摘要。
- `recovery-windows.json`：五窗 driver 的原始报告，包括正常对照。
- `journal-kill-results.json`：原有三窗基线。
- `verification-final.json`：独立 verifier 与负例矩阵结果。
- `acceptance.json`：候选、门禁、工具摘要和安全计数的可读汇总。
- 其余 `.stdout.bin` / `.stderr.bin`：正式命令的原始输出，摘要可在 `acceptance.json` 中复核。
- `SHA256SUMS`：保留文件的摘要清单。

disposable Git/JJ workspace 可从上述标准输出和 `recovery-windows.json` 重建，未纳入 fixture，避免提交临时 SQLite、Git 和 JJ 存储。
