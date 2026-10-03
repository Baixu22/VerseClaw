# P6-A 开发提示词：自动化验收与 would-retry promotion（真人评估已移除）

> 状态：Phase 0 + Phase 1 + Phase 2 完成；Phase 3 would-retry canary
> 已执行但未通过，生产保持 `shadow`。provider retry recovery material
> 候选修复已实现并通过固定 30 样本离线检查，真实 canary 待重跑。
> 工作树：`D:\verse_claw_worktree_compact`
> 分支：`codex/context-compression-hardening`
> 基线：`734ec877e75682861103660fbdea2bd55253ece0`
> 上一阶段证据：`reports/context-compression/P5-EVIDENCE-2026-08-17.md`
> 数据状态：`reports/context-compression/P6-DATA-PREP-STATUS-2026-08-18.md`

## 1. 总目标

- 默认 promotionStage 仍为 `shadow`，只有 P6-A 自动 gate 全绿才允许提升 stage。
- 验收完全改为固定 30 样本 manifest + 独立模型级联 + DeepSeek API 真实执行。
- 不读取、不生成、不要求任何 `humanScoredSamples` / `humanRaters` /
  `human-eval-pack`；对应 runner 表面、测试与报告已删除。
- 模型独立性固定为：
  - compressor：`deepseek-chat`
  - judge / schema-free / continuation / critic：`deepseek-reasoner`
- 所有 live 验收使用 `--no-cache`，真实 API，不伪造失败结果。

## 2. Phase 0 清单（已执行）

- `compaction-promotion.ts`
  - 删除 `humanScoredSamples` / `humanRaters` evidence 字段。
  - `critical-only` / `limited` 只允许自动证据全绿（含
    `modelIndependenceOk=true`、`noFabricationRate>=0.98`）。
  - `would-retry` / `provider-pressure-pilot` 前置改为 fixed samples>=30
    且 `modelIndependenceOk=true`。
- `compaction-promotion.test.ts`：人类评分测试名与预期已删除，新增
  no-fabrication 与 model-independence fail-closed 用例。
- `harness/specs/tasks/token-dense-recovery-compression-v1.md`：P6-A
  固定输入、模型角色、自动 gate 阈值写入 acceptance。
- `scripts/context-compression-eval-runner.mjs`
  - 删除 `buildHumanEvalPack` / `evaluateHumanBaseline` /
    `evaluateAgentManualBaseline` 及全部 `--human-eval-*` /
    `--agent-manual-eval-ratings` / `--write-human-eval-pack` 参数。
  - summary / report 不再写 `humanEvaluation` /
    `agentManualEvaluation` / `human-eval-pack.jsonl`。
  - `assertModelIndependence` 不再接受 human-rating override，改为要求
    compressor 与所有配置的 judge/schema-free/continuation/critic 模型
    不同。
- `tests/unit/context-compression-eval.test.ts` 与
  `tests/unit/helpers/context-compression-eval.ts` 同步改写。
- 删除：
  - `reports/context-compression/human-eval-pack-production-30.jsonl`
  - `reports/context-compression/human-eval-pack-production-9.jsonl`
  - `reports/context-compression/human-eval-rating-schema.json`
- `P6-DATA-PREP-STATUS` / `P6-EVIDENCE` 同步改写，不再包含任何人类评分阻塞或等待真人评分表述。

## 3. Phase 1 固定输入

- manifest：`reports/context-compression/production-manifest-30.json`
  - sha256：`6677b500a08c1ec3e4c1c474096d005f940726d7ec088158c6df8456d21fc82c`
- production summaries：
  `reports/context-compression/production-summaries-30-generated.jsonl`
  - sha256：`9a7021be463d41d13dde93fbb5a65f7a3d6794cb696fcc877d18ec9ce6d09957`
- 已回写
  `production-summaries-30-generated.meta.json` 的
  `fixedAcceptanceInput`。

## 4. Phase 2 验收命令

DEEPSEEK_API_KEY 只经进程环境注入，不写入仓库 / cache / report：

```powershell
$env:DEEPSEEK_API_KEY = "<key>"

node scripts/context-compression-eval-runner.mjs `
  --target D:/verse_claw_worktree_compact `
  --samples 30 --sample-source real --real-samples 30 --suite full `
  --transcript-root C:/Users/27933/.openclaw/agents `
  --sample-manifest reports/context-compression/production-manifest-30.json `
  --paired-summary reports/context-compression/production-summaries-30-generated.jsonl `
  --full-real-min 30 `
  --compression-model deepseek-chat `
  --judge-model deepseek-reasoner `
  --continuation-model deepseek-reasoner `
  --critic-model deepseek-reasoner `
  --schema-free-samples 30 `
  --llm-judge --llm-schema-free --llm-continuation --llm-critic `
  --no-cache `
  --out artifacts/p6-a-automated-acceptance
```

## 5. P6-A 自动放行门槛

| 指标 | 要求 |
|---|---:|
| fixed production paired samples | >=30 |
| model independence | `ok=true` |
| critical dropped samples | 0 |
| schema-free major omission | <=0.10 |
| real continuation critical action | >=0.95 |
| stale leakage | 0 |
| completion delta | <=0.08 |
| no fabrication | >=0.98 |

不通过就继续用 critic guideline 迭代 production summary 生成策略，不伪造。

## 6. 后续阶段（在 Phase 2 满足最低前置后）

- Phase 3：首轮 would-retry canary 未通过；候选修复已实现，待用真实
  DeepSeek provider 重跑 shadow baseline vs 临时 would-retry A/B。
- Phase 4：provider-pressure-pilot。
- Phase 5：只有 Phase 2 自动化门槛全绿后，才允许
  `critical-only -> limited` 显式生产配置。
