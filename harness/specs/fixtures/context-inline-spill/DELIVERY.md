# Inline/Spill 任务验收记录

源码候选：`16da6fdf22b0bda023becffa4272373be610ab54`；源码 tree：`13e352f499403ec9c2a7c1fbe700a67fbce4e8bf`。分支 `codex/context-inline-spill`。本文件与 raw run 均为 agent 驱动（actor: codex-inline-spill-retention）。证据提交只增加验收资料，运行记录保留该源码候选身份。

默认关闭的回读保留仅保护有效当前-session来源，窗口为 `ageTurns < 4`、总量最多16000字符，并遵守既有单条及aggregate预算。call-id为空/空白、页偏移缺失/负数/小数/不安全时不获保护，ID重写不能修复坏绑定。

## 指定门禁

| 命令 | Exit | 耗时 ms |
|---|---:|---:|
| `pnpm exec vitest run tests/unit/context-inline-spill-truncation.test.ts tests/unit/native-raw-output-archive-reuse.test.ts tests/unit/context-archive-recall.test.ts tests/unit/context-item-registry.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=D:/tmp/context-inline-spill-closeout-20261103/reference-family-candidate-c-vitest.json` | 0 | 32620 |
| `pnpm exec vitest run tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts tests/unit/context-pruning-would-trim.test.ts tests/unit/config-schema-parity.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=D:/tmp/context-inline-spill-closeout-20261103/retention-candidate-c-vitest.json` | 0 | 34053 |
| `pnpm exec vitest run tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-eval-budget-pressure.test.ts tests/unit/runtime-memory-eval-conflict-resolution.test.ts tests/unit/runtime-memory-eval-temporal-evolution.test.ts tests/unit/runtime-memory-eval-topic-drift.test.ts tests/unit/runtime-memory-locomo-benchmark.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts tests/unit/runtime-memory-read-hydration-shadow.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=D:/tmp/context-inline-spill-closeout-20261103/memory-cleanup-candidate-c-vitest.json` | 0 | 41835 |
| `pnpm run typecheck` | 0 | 35445 |
| `pnpm run contract:check` | 0 | 1183 |
| `pnpm run comms:replay` | 0 | 1075 |
| `pnpm run comms:compare` | 0 | 938 |
| `pnpm harness context --spec harness/specs/tasks/context-inline-spill-default-path.md` | 0 | 1361 |
| `pnpm harness validate --spec harness/specs/tasks/context-inline-spill-default-path.md` | 0 | 2199 |
| `pnpm harness run --spec harness/specs/tasks/context-inline-spill-default-path.md --dry-run` | 0 | 2151 |
| `pnpm exec eslint openclaw_runtime/src/agents/agent-hooks/context-pruning/extension.ts openclaw_runtime/src/agents/agent-hooks/context-pruning/pruner.ts openclaw_runtime/src/agents/agent-hooks/context-pruning/runtime.ts openclaw_runtime/src/agents/agent-hooks/context-pruning/would-trim.ts openclaw_runtime/src/agents/agent-tools.ts openclaw_runtime/src/agents/archive-recall-retention.ts openclaw_runtime/src/agents/embedded-agent-helpers/openai.ts openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts openclaw_runtime/src/agents/embedded-agent-runner/replay-history.ts openclaw_runtime/src/agents/embedded-agent-runner/run.ts openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.llm-boundary.ts openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts openclaw_runtime/src/agents/embedded-agent-runner/tool-result-context-guard.ts openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts openclaw_runtime/src/agents/session-transcript-repair.ts openclaw_runtime/src/agents/tool-call-id.ts openclaw_runtime/src/agents/tools/context-agent-tools.ts openclaw_runtime/src/config/runtime-feature-leaves.ts openclaw_runtime/src/config/types.openclaw.ts openclaw_runtime/src/config/zod-schema.ts scripts/context-inline-spill-eval.mts tests/unit/context-inline-spill-eval-provider.test.ts tests/unit/context-inline-spill-retention.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-eval-budget-pressure.test.ts tests/unit/runtime-memory-eval-conflict-resolution.test.ts tests/unit/runtime-memory-eval-temporal-evolution.test.ts tests/unit/runtime-memory-eval-topic-drift.test.ts tests/unit/runtime-memory-locomo-benchmark.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts tests/unit/runtime-memory-read-hydration-shadow.test.ts --max-warnings 120` | 0 | 10378 |
| `pnpm exec tsgo --noEmit -p D:/tmp/context-inline-spill-closeout-20261103/tsconfig-eval.json --composite false` | 0 | 7427 |
| `openclaw_runtime/node_modules/.bin/tsx.cmd --expose-gc scripts/context-inline-spill-eval.mts --mode deterministic --out D:/tmp/context-inline-spill-closeout-20261103/final-evals` | 0 | 7501 |
| `openclaw_runtime/node_modules/.bin/tsx.cmd --expose-gc scripts/context-inline-spill-eval.mts --mode live --out D:/tmp/context-inline-spill-closeout-20261103/final-evals` | 0 | 21795 |
| `node D:/tmp/context-inline-spill-closeout-20261103/curate-final.mjs --validate-evals-only` | 0 | 352 |
| `python -X utf8 D:/tmp/context-inline-spill-closeout-20261103/autoreview-owner-provider.py --mode commit --commit HEAD --engine codex --model codex=space-bunny --codex-bin C:/Users/27933/AppData/Local/OpenAI/Codex/bin/b6c7fc9497179c98/codex.exe --no-web-search --prompt-file D:/tmp/context-inline-spill-closeout-20261103/review-final-self-contained.md --output D:/tmp/context-inline-spill-closeout-20261103/autoreview-final-isolated.txt --json-output D:/tmp/context-inline-spill-closeout-20261103/autoreview-final-isolated.review.json --stream-engine-output` | 0 | 23782 |
| `openclaw_runtime/node_modules/.bin/tsx.cmd D:/tmp/context-inline-spill-closeout-20261103/verify-malformed-lineage.mts` | 0 | 578 |

引用回归20通过；retention/provider/pruner/schema 175通过（38/1/10/126）；Memory未使用声明清理回归41通过、1个原有LoCoMo外部模型条件跳过。清理未修改或删除任何原有测试块和hooks。专项 `.mts` typecheck 通过；现有ESLint配置未匹配该脚本，这项省略保留在lint日志。

## 四臂数据

确定性四臂行为均匹配预期；实际工具回读由agent驱动，经guarded写入、真实JSONL重载、Responses replay、pruner、precheck、convertToLlm与provider消息预算边界。

| Arm | 精确值可用/模型回答 | 主上下文字符 | 总 token | Provider ms |
|---|---|---:|---:|---:|
| baseline | false | 40334 | 10388 | 3085.868 |
| reference-visible | true | 50727 | 12421 | 4407.303 |
| recall-stable | true | 50727 | 12416 | 4094.98 |
| retention-off | false | 45375 | 11451 | 5619.545 |

Live请求模型 `space-bunny`；1个fixture、每臂1次请求，4/4匹配预期、正臂2/2返回精确值，负臂2/2保持不可回答。总token46676；费用因缺少费率记not-run。

5000次投影同数组且内容不变：确定性heap增量−186936 bytes，live增量174768 bytes，上限2097152 bytes；保留相对关闭增长5352字符，上限16000。过期4轮恢复旧路径，单条/aggregate不足时使用既有无保留计划，checksum/cross-session/archive-missing负例fail closed。

## 复审和边界

Codex CLI通过owner提供的space-bunny端点执行最终提交复审，exit0、findings为空。禁用失败的shell工具并提供完整当前函数/调用点；用户配置未改，凭据只在子进程环境中。此结论限于最终提交；整分支复审中断、无可用verdict。

附加全仓诊断属于较早候选3fd7fd92d：9801通过、118失败、55跳过（9974）；root test第二隔离组和DCS后续未运行。Harness CI因Agent Dev数据超过24h失效，均如实保留，不重签为当前候选的通过。

未证明模型自主选recall、完整自主agent-loop、长期产品soak、统计产品质量、跨平台执行、正式独立Executor/Verifier验收或GA。`engineeringAcceptedByAgent=false`、`releaseApproved=false`、`liveReady=false`、`defaultOn=false`。未push、未发布。

## 源码变更清单

- `README.ja-JP.md`
- `README.md`
- `README.zh-CN.md`
- `docs/context-family/goal-progress.md`
- `docs/modules/context-and-memory.md`
- `harness/specs/fixtures/context-inline-spill/off-mode-baseline.json`
- `harness/specs/rules/context-family-boundary.md`
- `harness/specs/scenarios/context-family.md`
- `harness/specs/tasks/context-inline-spill-default-path.md`
- `openclaw_runtime/src/agents/agent-hooks/context-pruning/extension.ts`
- `openclaw_runtime/src/agents/agent-hooks/context-pruning/pruner.ts`
- `openclaw_runtime/src/agents/agent-hooks/context-pruning/runtime.ts`
- `openclaw_runtime/src/agents/agent-hooks/context-pruning/would-trim.ts`
- `openclaw_runtime/src/agents/agent-tools.ts`
- `openclaw_runtime/src/agents/archive-recall-retention.ts`
- `openclaw_runtime/src/agents/embedded-agent-helpers/openai.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/replay-history.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/run.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.llm-boundary.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/tool-result-context-guard.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts`
- `openclaw_runtime/src/agents/session-transcript-repair.ts`
- `openclaw_runtime/src/agents/tool-call-id.ts`
- `openclaw_runtime/src/agents/tools/context-agent-tools.ts`
- `openclaw_runtime/src/config/runtime-feature-leaves.ts`
- `openclaw_runtime/src/config/types.openclaw.ts`
- `openclaw_runtime/src/config/zod-schema.ts`
- `scripts/context-inline-spill-eval.mts`
- `tests/unit/context-inline-spill-eval-provider.test.ts`
- `tests/unit/context-inline-spill-retention.test.ts`
- `tests/unit/runtime-memory-context-provider.test.ts`
- `tests/unit/runtime-memory-eval-budget-pressure.test.ts`
- `tests/unit/runtime-memory-eval-conflict-resolution.test.ts`
- `tests/unit/runtime-memory-eval-temporal-evolution.test.ts`
- `tests/unit/runtime-memory-eval-topic-drift.test.ts`
- `tests/unit/runtime-memory-locomo-benchmark.test.ts`
- `tests/unit/runtime-memory-proposal-shadow.test.ts`
- `tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts`
- `tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts`
- `tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts`
- `tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts`
- `tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts`
- `tests/unit/runtime-memory-read-hydration-shadow.test.ts`
