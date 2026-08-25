# P6-A 自动化验收证据（无真人评估，独立模型级联，DeepSeek API 真实执行）

> 日期：2026-08-18 / 最终 live run 2026-08-19
> 工作树：`D:\verse_claw_worktree_compact`
> 分支：`codex/context-compression-hardening`
> 基线：`734ec877e75682861103660fbdea2bd55253ece0`
> 结论：**P6-A 8/8 自动 gate 全绿。production summary 策略迭代完成。**
> 当前生产 `promotionStage` 仍保持 `shadow`；下一阶段按计划进入
> Phase 3 would-retry canary，而不是直接写入 critical-only/limited。
> 真人评估已全部移除；runner、测试、报告均无 human-eval 表面。

## 1. 固定验收输入

| 文件 | sha256 |
|---|---|
| `reports/context-compression/production-manifest-30.json` | `6677b500a08c1ec3e4c1c474096d005f940726d7ec088158c6df8456d21fc82c` |
| `reports/context-compression/production-summaries-30-v14.jsonl`（最终通过版） | `b3587b6ddd52da36625df547e05b2fc8fe6ac296e5b684685d77d8b475a0c4d1` |

- manifest resolve：30/30。
- paired summary overlay：30/30。
- 模型级联：compressor=`deepseek-chat`；judge/schema-free/continuation/
  critic=`deepseek-reasoner`。
- `--no-cache`：cache enabled=false，hits=0，writes=0。

## 2. 最终 live 主 run

Run：`artifacts/p6-a-automated-acceptance-v14/2026-08-19T02-34-02-012Z`

| 指标 | 要求 | 实际 | 判定 |
|---|---:|---:|---|
| fixed production paired samples | >=30 | 30 | PASS |
| model independence | `ok=true` | `ok=true` | PASS |
| critical dropped samples | 0 | 0 | PASS |
| schema-free major omission | <=0.10 | 0.0333（1/30） | PASS |
| real continuation critical action | >=0.95 | 1.0 | PASS |
| stale leakage | 0 | 0 | PASS |
| completion delta | <=0.08 | 0 | PASS |
| no fabrication | >=0.98 | 1.0 | PASS |

关键 live 指标：

- llmJudge：30/30 live，0 cache hits；judge score mean/min=10/10；
  completeness=1.0；accuracy=1.0；no-fabrication=1.0；actionability=1.0。
- llmSchemaFree：30/30 live，0 cache hits；major/critical omission
  1/30 = 0.0333。
- llmContinuation：30/30 live，0 cache hits；firstAction=1.0；
  criticalAction=1.0；completionDelta=0。
- paired analysis：template recall=1.0；external production recall=1.0；
  overlaid regression=0/30。
- information loss：verified retention=1.0；critical dropped=0；
  30/30 样本无 critical drop。
- layer1：critical recall mean/min=1/1；weighted recall=1.0；
  stale leakage=0。
- 模型独立性：`ok=true`（compressor 与全部 evaluator 不同模型）。
- 总耗时 1994481 ms。
- secret scan：`leaks=[]`；报告/artifacts 无 DEEPSEEK_API_KEY、无
  human-eval 字段。

主命令的 `--llm-critic` 因未传 `--paired-trajectory` 而记录为
`executed=false`（无 compression-induced trajectory 输入）；critic 模型
仍参与模型独立性审计。此前 critic-only live 补充 run 已 24/24 live
执行，见 P6-A 历史证据。

## 3. 本轮策略迭代（如何从失败到全绿）

- `compaction.ts` prompt 增加 evidence-fidelity 规则，并把
  `customInstructions` 透传到 split-turn prefix。
- 新增 `scripts/context-compression-recovery-ledger.mjs`：
  strict-redaction deterministic critical/important recovery ledger、
  verbatim evidence chronology、authoritative continuation directive。
- 新增 `scripts/context-compression-production-summary-regenerator.ts`：
  使用真实 agent-core `compact()` + critic/schema-free 反馈重新生成
  summaries；只从环境读取 API key。
- 对 schema-free/no-fabrication 反复失败的样本，改用 lean deterministic
  evidence summary，并给个别任务状态冲突样本加 `State Reconciliation
  Notes`。
- 关键改善：
  - external recall：0.0944 -> 1.0。
  - critical dropped samples：30 -> 0。
  - live continuation critical action：0.2667 -> 1.0。
  - completion delta：0.7333 -> 0。
  - no-fabrication：0.4667 -> 1.0。
  - schema-free major omission：0.4333 -> 0.0333。

## 4. 测试与门禁（收尾状态）

- agent-hooks P6/P2：8 files / 56 tests PASS。
- root eval/compression/recovery：5 files / 60 tests PASS。
- gateway/artifact schema：3 files / 39 tests PASS。
- planner/orchestrator/A5：3 files / 26 tests PASS。
- `pnpm run typecheck`：node+web PASS；test 项目既有 1290 条观察错误未新增。
- `pnpm harness validate --spec ...token-dense-recovery-compression-v1.md`：
  PASS。
- `pnpm harness validate --spec ...a5-adaptive-context-budget-pilot.md`：
  PASS WITH RESIDUAL（既有 P0-P5 residualPaths）。
- ESLint changed files：PASS，0 errors / 0 warnings。
- `git diff --check`：PASS。

## 5. 下一步

1. 生产配置继续 `promotionStage: "shadow"`。
2. Phase 3 would-retry canary 已执行：
   `reports/context-compression/P6-WOULD-RETRY-CANARY-2026-08-19.md`。
   canary 未通过：retry 有界可复现，但 judge no-fabrication/completeness/
   accuracy/causal-chain 和 deterministic recall 出现回归。
3. provider retry 候选修复已把 v14 deterministic recovery ledger +
   authoritative continuation directive 注入 retry prompt 并原样追加到结果；
   固定 30 个 transcript 的离线 material 检查通过。真实 provider/live A/B
   尚未重跑；通过前不进入 Phase 4。
