# 个人与 AI 贡献归属（对外一页）

阶段 2 材料，对应 Task Forest TF-0236。本页由 agent 从提交、diff、任务图历史与偏差账本重建，不含需要仓库所有者口述的内容。

**分工口径（2026-09-22 裁定，D8 = TF-0242）**：agent 是主线开发者——选方案、写代码、产证据、对正确性负责；仓库所有者是发布者——审查已完成且有证据的结果、决定是否发布或展示，不参与逐节点问答（[AGENTS.md:161-165](../../AGENTS.md)、[规则 R1-R3](../../harness/specs/rules/task-forest-autoclose-and-roles.md)）。

## 可核对的归属事实

- 提交总数 714；首个 `ac5a06830`（2026-06-20，初始导入），最后 `f82207b4e`（2026-09-22，D8）。
- 提交者分布（`git log --format='%an <%ae>'`）：`2302_78999445@noreply.gitcode.com` 595、`OpenClaw UFTK Pilot <uftk-pilot@openclaw.invalid>` 118（2026-08-24 起）、`Xu Bai <2793361290@qq.com>` 1（`81d3aa184`，2026-07-31 合并 PR #7）。
- 收尾窗口（2026-09-20 起）的 27 个提交全部由 `OpenClaw UFTK Pilot` 这一机器身份产生，每个都对应一个任务节点：`b2a406987`(D7)、`1000fdbbb`(TF-0228)、`29b2fd733`(TF-0230)、`db29990af`(TF-0229)、`b6c736191`(阶段 0)、`2f3f3383f`/`ba1206324`(J-02)、`e72f02ca6`/`a8c9f4b69`/`b7920af0c`/`3512acc3c`(J-03/J-04)、`f82207b4e`(D8)。
- 提交者元数据是机器身份，不足以单独支撑归属，所以下面的取舍逐条以任务图、偏差账本与 diff 为准。

## 设计决策与取舍（逐条指向记录）

| 取舍 | 事实 | 出处 |
| --- | --- | --- |
| TF-0131「receipt 转默认 + 注入解释可见」整件砍掉 | 首条理由即与硬边界「不改默认值」冲突；节点保留只为留审计痕迹（status=deprecated） | [`proposals/TFP-context-moat-2026-08-24.json:1725,1729`](../../.agent-workbench/task-forest/proposals/TFP-context-moat-2026-08-24.json)；提交 `e043cad95` |
| TF-0076 成本预算以 NO-GO 收口 | 历史重算 2.5208× token / 3.1071× latency，超 1.20×/1.50× 上限，且缺当前 paired provider 证据 | [task-forest-existing-nodes-20260915.md:44-48](task-forest-existing-nodes-20260915.md) |
| AGENT-START 用 NO-GO 横幅覆盖旧的「已通过」 | 候选 `fac6327a2` 独立审计结论 NO-GO，审计前的声明只算历史 | [AGENT-START.md:3-6](unified-agent-system/runtime-convergence/AGENT-START.md) |
| TF-0007 撤回 done | 子节点 TF-0009 受已提交的真人守卫阻塞，父节点不能收口，改标 blocked/50 | 任务图 TF-0007 摘要（`graph/nodes.json:492`）；提交 `de54b5680`；[LATEST.md:110](handoffs/LATEST.md) |
| 收据链不为好看而补注册 producer | J-03 只在驱动进程开两个 flag，产品默认未改 | [J-03 README:6,14](../../artifacts/live-model-cdp/20260922-senseaudio-journey-J03/README.md) |

## 如何审查 AI 改动（这套纪律本身就是展示内容）

1. **双执行者**：同一份 manifest 先由 Executor 产出 `executor-report.json`，再由独立 Verifier 在第二棵树上重跑出 `verifier-report.json`；Executor 不能自审、两者身份必须不同，只有 `role=verifier` 的执行才算工程验收通过（[验收边界 R1](../../harness/specs/rules/agent-engineering-acceptance-boundary.md)、`scripts/lib/agent-engineering-acceptance.mjs:2200,2224,1791-1793`）。
2. **判决只从磁盘读**：每条验收判据必须直读磁盘产物，不采信命令打印（[规则 R3.1](../../harness/specs/rules/task-forest-autoclose-and-roles.md)；bash 输出曾被伪造，见[综合规划 §8](qa-synthesis-roadmap-20260922.md)）。
3. **禁凭证环境变量**：正式验收前拒绝任何 provider/credential 环境变量，并要求 `NODE_TLS_REJECT_UNAUTHORIZED` 未设置（`scripts/lib/agent-engineering-acceptance.mjs:950-958`、[验收边界:34-37](../../harness/specs/rules/agent-engineering-acceptance-boundary.md)）。
4. **不许自宣完成**：`allowedPromotion` 恒为 false，仓库内没有把它写成 true 的路径，门禁反向校验它必须为 false（`scripts/validate-runtime-authority-convergence.mjs:326`）。
5. **偏差要登记**：`deviations.jsonl` 现有 113 条，含本轮 `TFD-autoclose-policy-override-0922`（policy_override）与 `TFD-status-md-guard-0922`（撤销对 STATUS.md 的改动）。

## 不宣称

真人证据、GA、默认开启、产品放行——四者均未发生；产品锁保持 false。
