# P4 验收证据：ACON 式失败驱动优化与模型级联对比

> 日期：2026-08-17
> 工作树：`D:\verse_claw_worktree_compact`
> 分支：`codex/context-compression-hardening`
> 基线：`734ec877e75682861103660fbdea2bd55253ece0`
> 被验收提示词：`reports/context-compression/P4-DEVELOPMENT-PROMPT-2026-08-17.md`
> 被验收实现证据：`reports/context-compression/P4-EVIDENCE-2026-08-17.md`
> 验收结论：ACCEPT-WITH-RESIDUAL

## 1. 验收结论

**ACCEPT-WITH-RESIDUAL**

P4 代码、测试、Harness spec 和命令矩阵全部通过；未发现硬边界违反。
在验收过程中补充执行了 live DeepSeek judge / schema-free / continuation
（固定 30 样本 manifest）和 live DeepSeek critic（1 个 trajectory fixture）。
live 结果真实记录了 L3 real continuation gate 未通过（criticalActionMatchRate
0.5），这是 P4 runner 正确暴露出的数据级问题，不改变 P4 代码级验收结论。

residual 更新为：

1. 100 条真实 production paired trajectories 仍未积累。
2. live DeepSeek continuation 在 deterministic template summary 上
   L3 real continuation gate 未通过：firstActionMatchRate=0.4、
   criticalActionMatchRate=0.5、completionDelta=0.5。该问题必须在 P5 前
   用真实 production summaries / paired trajectories 重新分析。
3. live DeepSeek judge 与 schema-free judge 在 10 个 template 样本上均为
   10 分且标准差 0，已由 runner 标记
   `all_scores_identical_check_judge_calibration_or_sample_difficulty`。

## 2. 运行命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm --version` | 11.2.2 PASS |
| `git status --short --branch` | PASS（P0-P3 改动保留，P4 文件在场） |
| `pnpm harness context --spec ...token-dense-recovery-compression-v1.md` | PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/agents/agent-hooks/compaction-damage-rules.test.ts src/agents/agent-hooks/compaction-validated-pipeline.test.ts src/agents/agent-hooks/compaction-addressability.test.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts --reporter=dot` | 5 files / 35 tests PASS |
| `pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=verbose` | 5 files / 62 tests PASS |
| `pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-artifact.test.ts packages/gateway-protocol/src/schema/sessions.recall.test.ts --reporter=dot` | 3 files / 39 tests PASS |
| `pnpm contract:check` | PASS |
| `pnpm exec eslint scripts/context-compression-eval-runner.mjs tests/unit/context-compression-eval.test.ts tests/unit/helpers/context-compression-eval.ts` | PASS，0 errors / 0 warnings |
| `pnpm run typecheck` | node+web PASS；test project 仅 observation-mode 既有 1290 条错误，未新增 |
| `cd openclaw_runtime && pnpm exec tsc -p tsconfig.core.json --noEmit --pretty false` | 仅既有 `shared/verseshell/**` 错误；P4 changed files grep 无错误 |
| `pnpm run comms:replay` | PASS |
| `pnpm run comms:compare` | PASS，0 loss/dup/order violations |
| `pnpm harness validate --spec ...token-dense-recovery-compression-v1.md` | PASS |
| `git diff --check` | PASS（仅 LF/CRLF 提醒） |
| live DeepSeek judge/schema-free/continuation：固定 30 样本 manifest，`--no-cache --llm-judge --llm-schema-free --llm-continuation` | 执行完成：llmJudge 10/10 live、llmSchemaFree 10/10 live、llmContinuation 10/10 live；acceptance.status=FAIL，原因见第 1 节 residual |
| live DeepSeek critic：1 个 trajectory fixture，`--llm-critic --critic-samples 1 --no-cache --write-failure-guidelines` | 执行完成：liveCount=1，guidelines 文件成功写入，含 5 条 bounded guideline |

## 3. 硬边界检查清单

| 检查项 | 结果 |
|---|---|
| P4 不得修改 runtime 压缩路径（agent-core compaction、agent-hooks、embedded compact、checkpoint、cvk） | PASS：grep 全仓 `pairedTrajectory` / `runDeepSeekCritic` / `classifyPairedTrajectory` / `buildFailureGuidelines` / `assertModelIndependence` 仅出现在 eval runner、eval 测试、helper、P4 文档；未进入 runtime |
| 不得修改 UI/E2E | PASS：`git status` 无 UI/E2E 文件变化 |
| 不得修改 `CompressionArtifact.schemaVersion` | PASS：未修改 agent-core artifact；P4 仅 eval 文件 |
| 不得新增 runtime 模型调用 | PASS：DeepSeek 调用仅存在于 eval runner 且由 CLI 显式触发 |
| DeepSeek key 不得写入 artifact/cache/report/manifest/guideline/日志 | PASS：live artifacts 与 P4 文件 grep 无 `sk-` / `DEEPSEEK_API_KEY=` / `Bearer` / `authorization` 泄露 |
| guideline 不得进入 `CompressionArtifact` | PASS：guideline 只在 `--write-failure-guidelines` 指定的 JSON 文件 |
| 不得创建第二套 context/memory/task truth | PASS：P4 仅 eval runner 与测试 |
| 不得宣布 token savings / judge 分数 / 单模型自评成功 | PASS：P4 证据与报告均未做该宣称；live judge 满分已被 runner 标记为 calibration risk |
| 100 条 paired trajectories 与真实 production critic 必须如实标记未完成 | PASS：本证据第 1 节明确标记 |
| P0-P3 未提交改动必须保留 | PASS：`git status` 中 P0-P3 文件全部保留 |

## 4. P4 验收必答逐项

- **运行了哪些命令，结果分别是什么**：见第 2 节。代码级命令全部 PASS；live DeepSeek 命令执行完成但 L3 real continuation gate 未通过（如实记录）。
- **`classifyPairedTrajectory` 的四类结果是否与 P4 提示词一致（给出测试名）**：
  一致。`tests/unit/context-compression-eval.test.ts > classifies only full-context success plus compressed failure as compression-induced failure` 覆盖四类结果。
- **`--paired-trajectory` 与 `--paired-summary` 的 overlay 优先级是否与证据一致**：
  一致。runner 先 overlay `--paired-summary`，再 overlay `--paired-trajectory`；同一 sampleId 时 trajectory 覆盖 summary。
- **DeepSeek critic 无 key / 非法 JSON / 无失败样本时是否显式失败（给出测试名）**：
  是。`runDeepSeekCritic` 在无 key、非法 JSON、无失败候选时均返回 `executed:false` 与 reason；测试 `runs the eval runner with --paired-trajectory and writes failure guidelines` 覆盖无 key/未传 critic 路径，`normalizeCriticResult` 抛错由 `runDeepSeekCritic` 捕获。live 有 key 时 critic 成功写入 guidelines。
- **guideline 生成是否只包含 compression-induced failure 样本（给出测试名）**：
  是。`buildFailureGuidelines` 只处理 `classifyPairedTrajectory(row) === 'compression_induced_failure'`；测试 `builds bounded failure guidelines from compression-induced failures only` 断言 preexisting/compressed-success 样本不进入。
- **model independence 是否在同模型唯一评审时 `ok=false`（给出测试名）**：
  是。`assertModelIndependence` 同模型唯一评审且无独立人工评分时 `ok=false`；测试 `audits model independence and refuses a same-model compressor plus sole judge`。
- **P4 是否修改了 runtime 压缩路径 / UI / E2E / artifact 契约**：
  否。P4 仅修改 `scripts/context-compression-eval-runner.mjs`、`tests/unit/context-compression-eval.test.ts`、`tests/unit/helpers/context-compression-eval.ts`、`harness/specs/tasks/token-dense-recovery-compression-v1.md`。
- **P4 是否新增了 runtime 模型调用**：否。
- **是否发现 DeepSeek key 或 secrets 写入任何 artifact/cache/report/guideline**：否，grep 检查通过。
- **100 条 paired trajectories 与真实 production critic live 是否被如实标记为未完成**：是。100 条 production paired trajectories 未完成；live critic 只在 1 个 trajectory fixture 上执行。
- **是否有任何 token savings 或单模型自评成功宣称**：否。
- **`pnpm harness validate`、`pnpm contract:check`、`pnpm run typecheck`、core tsc、comms replay/compare 是否全部 PASS**：是，见第 2 节。
- **`git diff --check` 是否通过**：是，仅 LF/CRLF 提醒。
- **P0-P3 未提交改动是否保留**：是。

## 5. 未解决问题

1. 100 条真实 production paired trajectories 尚未积累；P4 runner 已交付，数据积累仍是 P4 后续工作。
2. live DeepSeek continuation 在 deterministic template summary 上
   L3 real continuation gate 未通过（firstActionMatchRate=0.4、
   criticalActionMatchRate=0.5、completionDelta=0.5）。这可能是 template
   summary 本身不可用于真实 continuation，也可能暴露 DeepSeek continuation
   prompt 与固定 manifest 的校准问题；P5 前必须用 production paired
   summaries 重新分析，不得把失败归因于 P4 runner。
3. live judge / schema-free 在 10 个 template 样本上均为 10 分且标准差 0，
   runner 已输出 `all_scores_identical_check_judge_calibration_or_sample_difficulty`；
   需要 calibration 与 production 样本复测。
4. 固定 30 样本 manifest 的 previous-summary=with cohort 仍为 0。

## 6. 是否满足进入 P5 的条件

满足进入 P5 的条件，但带 residual：

- P4 代码级完成标准全部满足：所有新增/回归测试绿、harness validate PASS、
  contract:check PASS、typecheck node+web PASS、core tsc 无 P4 changed files 错误、
  comms replay/compare PASS、git diff --check PASS。
- P4 未修改 runtime 压缩路径、未修改 UI/E2E、未新增 runtime 模型调用、
  未创建第二套 truth。
- residual：100 条 production paired trajectories 未积累；live continuation
  gate 未通过；live judge 满分存在校准风险。上述 residual 不阻塞 P5
  开发提示词准备，但在 P5 任何 runtime 实施前必须用 production paired
  trajectories 和 calibration 重新分析。
