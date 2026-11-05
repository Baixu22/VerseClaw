# 恢复契约的原始证据与报告

driven_by: agent · actor: recovery-acceptance · realHumanEvidence: false

冻结契约仍为 recovery-contract-eval-manifest.json。旧探针与旧 user-input 质量评分已撤回验收资格；historical-readback-correction.json 保存更正，不用于当前候选通过声明。

最终干净候选运行入口为 scripts/recovery-contract-acceptance.mjs。它采集 legacy/candidate 两臂各 15 个真实进程故障窗口、30 个 live-provider 边界后新 assistant 答案，保留原始 receipt 和 artifact 哈希。所有已完成答案统一按 recovery-readback/v3 评分；preliminary 保留，JSON 格式合规独立列出。

raw-evidence.json.gz 是可离线复算的原始证据包，不需要恢复 D 盘路径。读取器直接校验包内原始 bytes 的 SHA-256；改写原文或哈希即失效。

复算命令：node --experimental-strip-types scripts/recovery-contract-eval.mjs --bundle harness/specs/fixtures/recovery-contract-eval/final-20261105/raw-evidence.json.gz --arm candidate --check

总体 FAIL 的退出码为 1；不得放宽冻结时延门槛或删慢样本。Windows x64 的脚本 provider 验证效果边界，live provider 验证指定质量语料；accepted handoff 消费不证明自动摘要的提取质量。TF-0715 其他四入口与默认值发布决策仍独立。
