# 恢复契约最终候选验收

源码候选 `6115256e882051a154945b5b7298ef8a83d756cc` 已完成五入口开发验证、压缩逐字保真修正及完整冻结采集。505 项回归、22 个原生阶段、4 份 PID/SQLite 证明、2 轮打包 helper 和 10 轮 goal canary 通过；固定 DeepSeek fresh review 发现 0 项问题。

candidate 的 120/120 项事实、30/30 项下一步判断、15/15 个故障窗口终态通过，重复效果和丢失任务均为 0。两轮 legacy 各 15 槽，原冻结投影 15/15 匹配。GA 为 **NO_GO**：恢复 P50/P95 为 17.439/83.204 秒，构建耗时超限，源码行数门禁有 165 项失败。

[REPORT.zh-CN.md](REPORT.zh-CN.md) 给出九指标、两臂差值、样本量和剩余门禁。`manifest.json` 绑定候选、冻结 hash、证据来源和实际状态；`SHA256SUMS` 覆盖目录全部保留文件。

`raw-evidence.json.gz` 保留原采样 bundle 的字节，含两臂 60 份真实模型质量答案、30 个故障窗口及其 294 个原始证据文件。`development-evidence.json.gz` 保留 437 个开发验证文件，每项包含原路径、SHA-256 与 Base64 字节，覆盖原始进程、SQLite、测试、复审、第二轮 legacy 与此前失败报告。所有产物均为 agent 驱动。

在该候选的源码检出中，以原评测器重算两臂：

```powershell
$env:TEMP = 'D:\tmp'
$env:TMP = 'D:\tmp'
New-Item -ItemType Directory -Force -Path 'D:\tmp\g3-6115256e-replay' | Out-Null
node --experimental-strip-types scripts/recovery-contract-eval.mjs --bundle harness/specs/fixtures/recovery-contract-eval/ga-20261106/final-candidate-6115256e-20261116/raw-evidence.json.gz --batch --arm candidate --output D:/tmp/g3-6115256e-replay/candidate-report.json
node --experimental-strip-types scripts/recovery-contract-eval.mjs --bundle harness/specs/fixtures/recovery-contract-eval/ga-20261106/final-candidate-6115256e-20261116/raw-evidence.json.gz --batch --arm legacy --output D:/tmp/g3-6115256e-replay/legacy-report.json
```

两臂的指标状态均为 `FAIL`，评测命令返回 1。封存时已重算并逐项核对九指标、覆盖和门禁，与原报告一致；该回读结果记录在 `manifest.json`。
