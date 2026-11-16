# RSI coding 接力收尾（2026-11-06）

driven_by: agent · actor: codex/rsi-relay-verifier

**结论：NO_GO / insufficient-evidence。216 槽完整测量未完成，TF-0809 保持 in_progress / 80。**

已完成 24/24 任务准入、精确 markdown-it 14.2.0、独立 SEKB 候选冻结与正式 coding collector。S03/L01/L03 是明确标注的实现重建起点，原 oracle/reference 字节未改。候选 feca048d749ad123780b7015e6e945b15bfc50ec 的隔离验证为 86/86 测试、带 diff 的 Harness、RSI 范围类型检查通过；完整 node/web/test 类型检查分别退出 2，保留 29/57/121 项非 RSI 路径错误。依赖复用不等于 fresh install；pnpm 类型包装器曾意外启动依赖准备并被停止。

| 测量事实 | 数量 |
|---|---:|
| 计划槽位 | 216 |
| dispatch 记录 | 16 |
| provider 最终响应 | 15 |
| oracle 判模型失败 | 10 |
| JSON edits 格式失败 | 4 |
| 输出上限 incomplete | 1 |
| 在途终态未知 | 1 |
| 未启动 | 200 |
| 已知响应 tokens | 172119 |

第 14 槽 tf-0275-e02-2-sekb-off 返回 incomplete/max_output_tokens，达到冻结的 16000 输出上限。既有完整性门要求零 incomplete，且每槽禁止重试；依 live-acceptance 规范允许的硬失败停止规则结束本轮。停止时第 16 个 dispatch 在途，保留为未知，未伪造响应或用量。172119 仅是 15 份响应的已知用量；不包含预检 180 tokens，也不代表未知在途请求的完整计费。

报告保留 201 个没有终态收据的槽位（1 未知 + 200 未启动）及 1 个 incomplete；完整 check 退出 1、报 unexecuted-slots，不能包装成通过。原始响应、edits、grader 报告在 ../../rsi-benefit-eval/coding-20261106/measurement/；额外 dispatch/oracle 日志由 raw-archive.json 指向本地私有 ZIP。SHA256 清单、凭据扫描和报告复算均单独保留。

复算（D:/ClawX，已有本地 Git 历史）：

- node scripts/rsi-live-acceptance.mjs check --run-dir harness/specs/fixtures/rsi-live-acceptance/reconstructed-cohort-20261106-v7 （应退出 0）
- node scripts/rsi-benefit-eval.mjs check --run-dir harness/specs/fixtures/rsi-benefit-eval/coding-20261106/measurement （应退出 1，未完成门拒绝）

下一轮需要独立预登记的执行协议及新的 runId；不得覆盖本轮输出、重试既有 dispatch、事后扩大本轮 token 上限或用本轮结果训练该候选。未声称 RSI 收益、产品晋级、GA、真人证据、默认值变更或发布。
