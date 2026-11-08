# 恢复契约实测与统一收口判断

本包由 agent 驱动；不含 real-human 声明。Runtime 源码冻结于 8137cdb2e；窗口采样为1909dfd0c；读取器为c0184e62e，运行时源码与原候选完全一致。

整体判定 **NO-GO / FAIL**，qualityClaimAllowed=false。默认 writer=legacy、authority shadow=off、event-log replay=false，未翻转产品锁或默认值。

| 指标 | legacy | candidate | candidate - legacy | 每臂样本 | 候选判据 |
|---|---:|---:|---:|---:|---|
| duplicateEffects | 0 | 0 | 0 | 15 | 通过 |
| lostTasks | 0 | 0 | 0 | 15 | 通过 |
| terminalCorrectness | 0.6 | 1 | 0.4 | 15 | 通过 |
| unknownClassifiableRate | 0.4 | 0 | -0.4 | 15 | 通过 |
| mustPreserveFidelity | 1 | 1 | 0 | 30 | 通过 |
| falseCompletionClaims | 0 | 0 | 0 | 30 | 通过 |
| nextActionAccuracy | 1 | 1 | 0 | 30 | 通过 |
| recoveryLatencyP50 | 30114 | 32007 | 1893 | 45 | 未通过 |
| recoveryLatencyP95 | 116443.4 | 86786.4 | -29657 | 45 | 未通过 |

两臂共享30个质量caseId，共60个新assistant答案；故障矩阵30条主结果，另15次独立legacy复跑尝试，14条完整、1条K5注入后未完成且指标为null；不把第二跑次混入主比较。基线结构复跑INCOMPLETE_REPEAT，匹配12/15个目标槽位；TF-0711保持review_needed。原始时间、路径和真实IDs保留，结构hash只规范化非确定身份且保留同会话/PID唯一性约束。故障窗口独立P95为legacy 179712.39999999997ms / candidate 112635.69999999998ms，比值0.6268，只用于TF-0721的相对判据；不替代冻结的45样本时延门槛。

原文统一按v4重判：legacy 120/120事实、30/30下一步；candidate 120/120、30/30。JSON数组形状合规分别17/30和20/30；格式合规不混同事实保真。原始preliminary分数与原文hash均在报告和gzip中。

我对统一方向的工程认可度为8/10（判断，不是实测指标）：用TaskFlow单一CAS写者保存工具状态与相位，以持久化意图和会话/调用/参数digest绑定恢复，并复用原执行器；domain journal持有效果真相，receipt与event-log提供关联证据。TaskFlow已收口主会话/工具路径的状态写者，RecoveryAuthority仍是只读shadow，生产恢复决策还经phase恢复器；跨四个其他owner的权威收敛、通用外部效果自动对账和完整原子可见性仍未成立，不能宣称五入口统一或整体持久化执行保证。

本表是固定工作负载的描述性差值。统计推广/因果收益为EVIDENCE_INSUFFICIENT，不能升级为GA或生产SLA。脚本模型验证故障效果语义，真实relay验证指定事实读回；时延包含重启及模型等待，慢样本不删除、不改阈值。

复算（正常负面门禁退出1；数据重现核验退出0）：

`node --experimental-strip-types scripts/recovery-contract-eval.mjs --bundle harness/specs/fixtures/recovery-contract-eval/final-20261105/raw-evidence.json.gz --arm candidate --check`

`node --experimental-strip-types scripts/recovery-contract-eval.mjs --bundle harness/specs/fixtures/recovery-contract-eval/final-20261105/raw-evidence.json.gz --arm candidate --verify harness/specs/fixtures/recovery-contract-eval/final-20261105/candidate-report.json`

原始包包含343份磁盘/答案artifact、105份receipt原文、442份调用与失败metadata。所有parsed receipt已逐一与原始bytes绑定核对；来源与边界见 `source-index.json`、`source-audit.json`、`attempt-inventory.json`。

隔离核验见 `offline-verification.json`：两臂 `--verify` 均退出0、`--check` 均退出1；篡改副本的answer字节后退出1且证据不足。原包未变。独立运行 `node harness/specs/fixtures/recovery-contract-eval/final-20261105/offline-verify.mjs --output D:/tmp/recovery-offline-recheck.json` 可重现这些检查。该脚本用Node builtins，不安装依赖，不读取原始case的D盘路径。

主矩阵35次可观察的恢复决策均有shadow记录，35条分歧均写明原因；另1个无决策的超时窗口作为观察缺口单独保留。没有把“0未记录分歧”写成“0分歧”。核心聚合微基准10000次，P95=0.0031ms，只含request/decide/compare/bounded sink，不含Gateway、provider或磁盘探针I/O。

门禁见 `gates.json` 与原始 `gates-raw.json.gz`：新修复30/30测试、定向lint、test类型检查及实际diff的Harness validate通过；source projection的41项契约与50项runtime focused单测通过。Node进程证明15/15与Electron/Gateway主矩阵是不同覆盖。完整harness:ci在59项测试通过后因4份Agent Dev证据过期退出1，不能称全量CI、打包平台或发布已通过。
