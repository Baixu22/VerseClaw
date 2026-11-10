# TF-0781 Windows 包内编码与 VG、STS、JJ 联合证据

本目录保留 TF-0781 的正式 Windows `win-unpacked` 评测产物。所有运行由 agent 驱动，标注 `driven_by=agent`、`actor=codex-coding-package-evaluator`、`realHumanEvidence=false`；本次验收不改变产品锁、默认值或发布权限。

正式候选为 `f38218d5db6300e63a21f1209946c73e97f4f21b`，工作树干净。聚合报告摘要为 `fdf5b0f139015f178de2b5c54e54a4add6bd029c14416b47a3ef313ccb0ae01b`。12 条正式命令全部 exit 0；独立 verifier 覆盖正式报告和 supplemental evidence，10/10 篡改反例被拒绝。

验证覆盖：

- 三个 fresh profile 均从 detached package 启动真实 Electron 和 Gateway，源码 checkout 不进入运行时搜索路径。
- 每个 profile 完成 Git worktree 写入、`PACKAGED_VERIFY_PASS` 验证、worktree 回流和独立 session 的 undo；`scratch.txt` 被删除，journal remaining entries 为 0。
- 包内 `vg.exe`、`ae.exe`、`node.exe` 与各自 manifest 的 SHA-256 一致；source 与 win-unpacked 的 VG、VerseShell、Node runtime 共 6 项摘要对拍全部一致。
- 每个 profile 完成 VG capabilities、colocated JJ workspace import、change new、change snapshot。
- STS 1.1 三 profile 合计拒绝 30/30 个非法样本，并通过 27/27 个合法样本；STS 2.0 合计拒绝 24/24 个非法样本，并通过 15/15 个合法样本。
- 缺 `vg.exe` 的 VG verifier 返回 exit 1 / `artifact_missing`；错误 hash 返回 exit 1 / `artifact_mismatch`；缺解释器的 STS plan 返回 exit 3 / `dependency_unavailable`、`spawned=false`。
- 包内没有独立 `python.exe` 或 `jj.exe`，managed 模式必须显式选择；三个 profile 均保持 `default_enable=false`、`managed_opt_in=true`。
- package CLI 共执行 12 个 bundled-node / Electron fallback 探针，查询前后 isolated state 不变、无超时；安装器保持 `not-run`，正式命令后进程残留为 0。本结论为非 GA，不授权发布。

文件：

- `report.json` / `report.sha256`：正式聚合报告及规范摘要。
- `verification-final.json`：正式报告、supplemental evidence、独立 verifier 与 10 条报告篡改矩阵。
- `raw-profiles/`：三个 profile 的原始 JSON。
- `inputs/`：package manifest、Node runtime 与 package runtime 摘要。
- `evidence/`：候选与包身份的规范化摘要。
- `outputs/`、`package-cli/` 与 `supplemental/`：12 条正式命令、package CLI 与缺 binary / 错 hash / 缺解释器负例的原始输出。
- `supplemental/source-package-parity.json`：source 与 win-unpacked 摘要对拍。
- `acceptance.json`：候选、门禁、包身份、profile、STS/JJ 能力与安全计数的可读汇总。
- `SHA256SUMS`：fixture 内所有保留文件的摘要清单。

1 GB 以上的 disposable package、Electron 用户目录和 workspace 未纳入 fixture；原始 JSON、命令输出与摘要保留复算所需身份和读回值。
