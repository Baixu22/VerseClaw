# Inline/Spill 真实任务收益评测第二轮交付记录

driven_by: agent
actor: codex-inline-spill-benefit-r2

本轮结论为 **mechanism-only**，未通过任务收益验收。收敛修复后，recall-stable 证据正确率从第一轮 0/6 提升到 11/18；B2 成立，B3/B4/B6 仍未成立。该变化是跨轮观察，不能用作受控因果比较。

工作树：C:/Users/27933/.codex/worktrees/context-inline-spill/ClawX；分支 codex/context-inline-spill；评测时 HEAD ddd66ced9f3d389bd03a476fcbdccfc2de759f33、tree cbcd93f60b96d40bd2161a0481c8971f8485de29，dirty=true。源码 SHA256 见 provenance.json。原始 run candidate 不重签。

## 改动与运行设计

代码仅改变评测器的三处收敛控制：默认 max-turns 4→8；每轮只执行首个 recall，其余 fail-closed；提示最多三次 recall、取得精确值立即输出 JSON、否则 null。B1–B7 阈值、四臂、语料、生产投影与评分器保持冻结。文档另修正了原先“输入逐字节一致”的错误声明。

主 deterministic 自测 2026-11-04T06-49-33-988Z-deterministic：4 臂 × 8 任务 × 1 次，32 条。live 2026-11-04T06-51-18-636Z-live：4 臂 × 8 任务 × 3 次，96 条。重复三次遵守冻结语料门槛，用于报告配对差异与 pass^3，不证明更广泛可靠性。

## 冻结判据

| 判据 | 结果 | 磁盘证据 |
|---|---|---|
| B1 机制与自主性 | 通过 | recall-stable 证据任务 recall 发起 18/18，成功回读 18/18 |
| B2 任务相对基线 | 通过（本配置下观察值） | 11/18 − 0/18 = 61.11 个百分点；冻结配对统计 p=0.0001220703125 |
| B3 保留收益 | 未通过 | 正向配对 8、反向配对 1；规则要求反向为 0 |
| B4 非劣 | 未通过 | 61.11% < 66.67% − 5 个百分点 |
| B5 不臆造 | 通过 | recall-stable 无证据控制 6/6 返回 null |
| B6 预算 | 未通过 | 投影字符差 −481.375；token 相对 reference-visible 增长 38.6166%，高于 25% |
| B7 证据 | 通过 | 46/46 清单文件匹配，976 个 archive 的 checksum/byteLength 通过，凭证扫描 0 命中；逐次记录与统计复算一致 |

decision.status 原样保留 live/result.json 的 mechanism-only。engineeringAcceptedByAgent/releaseApproved/liveReady/defaultOn 均为 false。

## deterministic 四臂

| 臂 | 证据成功 | 控制成功 | recall 发起 / 成功 | 平均 input / output / total token | 每运行 p50 / p95 ms | failureClasses（含成功 none） |
|---|---:|---:|---:|---:|---:|---|
| baseline-no-reference | 0/6 (0.00%) | 2/2 | 0.00% / 0.00% | 0.000 / 0.000 / 0.000 | 0.003 / 0.007 | {"recall_not_attempted":6,"none":2} |
| reference-visible | 6/6 (100.00%) | 2/2 | 100.00% / 100.00% | 0.000 / 0.000 / 0.000 | 0.018 / 0.038 | {"none":8} |
| recall-stable | 6/6 (100.00%) | 2/2 | 100.00% / 100.00% | 0.000 / 0.000 / 0.000 | 0.014 / 0.024 | {"none":8} |
| retention-off | 2/6 (33.33%) | 2/2 | 100.00% / 100.00% | 0.000 / 0.000 / 0.000 | 0.023 / 0.035 | {"none":4,"recalled_text_evicted":4} |

deterministic 的 token=0 表示没有 provider usage，属于未测成本；微秒级延迟是脚本策略计时，不能与 live 模型性能比较。此模式永远不证明模型自主性；它的 decision.status=inconclusive。

## live 四臂

| 臂 | 证据成功 | 控制成功 | recall 发起 / 成功 | 平均 input / output / total token | 每运行 p50 / p95 ms | failureClasses（含成功 none） |
|---|---:|---:|---:|---:|---:|---|
| baseline-no-reference | 0/18 (0.00%) | 3/6 | 100.00% / 0.00% | 2904.333 / 1099.000 / 4003.333 | 18376.736 / 23123.505 | {"answer_mismatch":15,"schema_invalid":6,"none":3} |
| reference-visible | 12/18 (66.67%) | 6/6 | 100.00% / 100.00% | 24067.000 / 1246.458 / 25313.458 | 22113.979 / 29568.935 | {"none":18,"schema_invalid":6} |
| recall-stable | 11/18 (61.11%) | 6/6 | 100.00% / 100.00% | 33789.875 / 1298.792 / 35088.667 | 21310.907 / 32620.291 | {"none":17,"recalled_text_evicted":2,"schema_invalid":5} |
| retention-off | 6/18 (33.33%) | 4/6 | 100.00% / 100.00% | 33413.333 / 1534.333 / 34947.667 | 20075.638 / 35480.422 | {"none":10,"recalled_text_evicted":4,"schema_invalid":10} |

| 臂 | 总体通过 / Wilson 95% | pass^3（证据任务三次全过） | 平均投影字符 / 最后请求 JSON 字符 | provider 调用数 / p50 / p95 ms |
|---|---:|---:|---:|---:|
| baseline-no-reference | 3/24 / 4.34% – 31.00% | 0.00% | 380.875 / 2765.583 | 87 / 4529.570 / 10519.621 |
| reference-visible | 18/24 / 55.10% – 88.00% | 16.67% | 15642.417 / 58620.958 | 90 / 4776.609 / 11279.430 |
| recall-stable | 17/24 / 50.83% – 85.09% | 33.33% | 47822.958 / 87695.958 | 90 / 5389.044 / 13971.229 |
| retention-off | 10/24 / 24.47% – 61.17% | 0.00% | 48304.333 / 85857.625 | 91 / 5442.823 / 12055.777 |

上表第一组延迟沿用冻结 result.json 的“每次运行所含 provider 调用延迟之和”；第二组另按 358 次 provider 调用给出 p50/p95。Wilson 区间是每臂 24 次总体通过率的区间，包含控制任务。费用全部 not-run：未提供 billing unit/费率；usage 原值逐次保留。

## 实验限制（不能隐去）

1. 最后请求把生产投影文本和未经过投影的原始 function_call_output 历史一起发送。retention-off 的 6 次证据成功全部是投影中没有 oracle，但额外历史中仍有 oracle；该路径会干扰保留收益对照。
2. 24 对 recall-stable/retention-off 初始请求全部不逐字节相同：archive URI 包含臂名/session。不能声称达到规则的单变量输入要求。
3. mainContextChars 仅统计投影文本，遗漏提示、原始工具历史及协议字段；它是冻结评分器的代理指标。最后一次完整请求 JSON 字符数已另列，不能混作严格实际输入指标。
4. 29 次 provider 响应为 incomplete（既有 max_output_tokens=900），27 条最终运行分类为 schema_invalid。未改变该输出预算；失败原样计入。
5. 提示中的总三次 recall 是模型遵循要求，未作为硬执行上限；4 次运行超过三次。每轮的硬限制有效，唯一一次额外并行 recall 已 fail-closed。
6. 当前是 agent 驱动的评测外循环，语料是脚本构造的 6 个证据任务加 2 个控制；不是 Electron/Gateway 完整产品回合，不涵盖审批、system prompt、bootstrap、多 agent 编排。
7. 只覆盖 space-bunny、本端点与本语料；没有 real-human、GA、release-approved 或全产品质量结论。retention 仍显式 opt-in，产品锁与默认值保持原样。

## 门禁与命令退出码

| 命令 | exit code | 回读结果 |
|---|---:|---|
| deterministic --repeats 1 --max-turns 8 | 0 | 32 条；证据 0/6、6/6、6/6、2/6；控制全过 |
| live --repeats 3 --max-turns 8 | 0 | 96 条 / 358 次 provider 请求；进程句柄回读退出码 |
| deterministic 默认参数（spec requiredTests 原命令） | 0 | 96 条；证据 0/18、18/18、18/18、6/18；控制全过 |
| pnpm exec vitest run tests/unit/context-inline-spill-benefit-scoring.test.ts --maxWorkers=1 | 0 | 1 文件 / 4 passed |
| pnpm harness validate --spec harness/specs/tasks/inline-spill-real-benefit-eval.md | 1 | 被四个并行会话文件的 ownership 门禁拒绝；未删除或提交它们 |
| pnpm run typecheck | 0 | uncached node/web/tests；errorCount=0 |
| pnpm run contract:check | 0 | Contract check passed |
| pnpm exec vitest run tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts --maxWorkers=1 | 0 | 2 文件 / 39 passed |
| pnpm harness run --spec harness/specs/tasks/inline-spill-real-benefit-eval.md --dry-run | 1 | 被四个并行会话文件的 ownership 门禁拒绝；未删除或提交它们 |
| git diff --check | 0 |  |
| node harness/src/cli.mjs validate --spec harness/specs/tasks/inline-spill-real-benefit-eval.md（临时候选） | 0 | 真实 diff；无 --no-diff；候选只含本任务改动 |
| node harness/src/cli.mjs run --spec harness/specs/tasks/inline-spill-real-benefit-eval.md --dry-run（临时候选） | 0 | 原 Harness CLI 规划 pass；不执行 broad fast profile |
| node recompute.mjs（deterministic / live） | 0 | 全部统计、B1–B6、原始 usage/答案回算一致 |
| node convergence-check.mjs scripts/context-inline-spill-benefit-loop-eval.mts | 0 | 9 checks；parallel fail-closed 与下一轮恢复验证 |
| git diff --cached --check（本任务暂存后） | 2 | 六处 EOF 空行：冻结的首轮源码和原始 stdout 保留字节原样；完整输出在 D:/tmp/inline-spill-benefit-r2/cached-whitespace-check.txt |

原工作树的 Harness validate/dry-run 都保留 exit 1。临时候选 D:/tmp/inline-spill-benefit-r2/validation-candidate 使用同一基线和本任务准确副本，运行同一 Harness CLI，保留实际 diff 与所有 ownership 检查。pnpm 在缺依赖的临时候选意外启动依赖初始化，该尝试已终止（exit −1）；因此直接使用其声明的 Node CLI，不把初始化失败当作代码证据。最早的 cmd 引号启动尝试也保留在本地，命令未执行，不计为门禁通过。

## 证据、复算与收口

result.json/runs.json 保留各原始 run 的内容。live/provider-wire.jsonl.gz 是 358 次实际请求/原始响应（未捕获认证 headers）；archives.jsonl.gz 分别保留 deterministic 160、live 816 个 archive 文件的精确内容。provenance.json 列出来源及源码摘要。SHA256SUMS 覆盖除 SHA256SUMS 外全部文件；verify-evidence.mjs 还解压检查 archive payload 的 checksum/byteLength 与记录里的 handle。

第一轮原始证据完整保留于 D:/tmp/inline-spill-benefit-r2/round1-evidence，provenance.json 记录旧清单摘要。既有 context-inline-spill/ 机制证据包的 105 文件清单保持原样，最终另复验。

```powershell
$env:TEMP='D:\tmp'; $env:TMP='D:\tmp'
$pack='C:/Users/27933/.codex/worktrees/context-inline-spill/ClawX/harness/specs/fixtures/context-inline-spill-benefit'
node "$pack/recompute.mjs" "$pack/deterministic" - D:/tmp/inline-spill-benefit-deterministic-recomputed.json
node "$pack/recompute.mjs" "$pack/live" "$pack/live/provider-wire.jsonl.gz" D:/tmp/inline-spill-benefit-live-recomputed.json
node "$pack/verify-evidence.mjs" "$pack"
```

TF-0749 保持 in_progress/open：B3/B4/B6 与严格对照输入仍有实证缺口。TF-0750–0754 的已有 done 状态保留，摘要更新到第二轮结果。状态更新仅通过 proposal-save → proposal-apply → validate → export；不删除 lock、不使用 --allow-stale。未 push、未发布。
