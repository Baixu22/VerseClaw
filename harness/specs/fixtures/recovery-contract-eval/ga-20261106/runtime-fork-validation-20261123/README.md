# Runtime fork 拒绝契约验证

冻结候选 eaf7e65fe 的 `sessions.lifecycle.fork-reject.test.ts` 两项用例全部通过：超过父上下文限额时返回原结构化错误并创建零分支；满足 fork 条件时继续转交原 fork runtime。

实际单 worker、零重试运行49.500秒，峰值1990.74 MiB。该文件展开完整 runtime 依赖，后续文件回归按共享串行窗口执行。原代码、阈值、断言和冻结候选保持。

[报告](report.json)记录原候选结果与独立标注的未采用隔离实验；[原件](raw-evidence.jsonl.gz)和[SHA256SUMS](SHA256SUMS)提供逐字节读回。验收由agent驱动，realHumanEvidence=false。
