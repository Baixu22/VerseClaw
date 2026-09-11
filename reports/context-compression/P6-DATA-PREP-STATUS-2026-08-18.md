# P6-A 前置数据准备状态（2026-08-18，human-eval 已移除）

> 结论：本地能完成的固定数据已冻结；真人评估内容已全部移除。
> 不再等待任何 `humanScoredSamples` / `humanRaters` /
> `human-eval-pack-*.jsonl` / `human-eval-rating-schema.json`。

## 1. 固定 production paired baseline（本轮唯一验收输入）

- manifest：`reports/context-compression/production-manifest-30.json`
  - sha256：
    `6677b500a08c1ec3e4c1c474096d005f940726d7ec088158c6df8456d21fc82c`
- production summaries：
  `reports/context-compression/production-summaries-30-generated.jsonl`
  - sha256：
    `9a7021be463d41d13dde93fbb5a65f7a3d6794cb696fcc877d18ec9ce6d09957`
- summaries meta：
  `reports/context-compression/production-summaries-30-generated.meta.json`
  已新增 `fixedAcceptanceInput`（manifest sha256 + summaries sha256）。
- 30 个 production summaries 由本地 agent-core `compact()` 真实生成，
  唯一 summary sha256 = 30/30；tier3=15、tier4=15。
- 本轮迭代产物（最终通过版）：
  - `reports/context-compression/production-summaries-30-v14.jsonl`
    sha256 `b3587b6ddd52da36625df547e05b2fc8fe6ac296e5b684685d77d8b475a0c4d1`
  - 保留 v5 / v9 / v10 / v11 迭代证据与对应 meta。

## 2. 已移除内容

- runner 不再读取/生成 `--human-eval-ratings`、
  `--agent-manual-eval-ratings`、`--write-human-eval-pack`、
  `--human-eval-samples`。
- runner summary/report 不再包含 `humanEvaluation` /
  `agentManualEvaluation` / Human Evaluation / Agent Manual Evaluation。
- 以下文件已删除：
  - `reports/context-compression/human-eval-pack-production-30.jsonl`
  - `reports/context-compression/human-eval-pack-production-9.jsonl`
  - `reports/context-compression/human-eval-rating-schema.json`
- 模型独立性改为纯模型级联判断，不接受 human-rating override。

## 3. Live 验收命令

DEEPSEEK_API_KEY 只经环境变量注入：

```powershell
node scripts/context-compression-eval-runner.mjs `
  --target D:/verse_claw_worktree_compact `
  --samples 30 --sample-source real --real-samples 30 --suite full `
  --transcript-root C:/Users/27933/.openclaw/agents `
  --sample-manifest reports/context-compression/production-manifest-30.json `
  --paired-summary reports/context-compression/production-summaries-30-v14.jsonl `
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

## 4. P6-A 自动放行门槛

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

任何一门不达标：保持 `promotionStage: "shadow"`，用 critic guideline
迭代 production summary 生成策略后重跑，不伪造。

## 5. 完成度

| 项目 | 状态 |
|---|---|
| fixed manifest 30 冻结 | 完成 |
| production summaries 30 冻结 | 完成 |
| human-eval 移除 | 完成（代码、测试、报告、文件） |
| P6-A live 全量验收 | 最终 v14 run 8/8 全绿；Phase 3 首轮 would-retry canary 未通过，retry material 候选修复已实现且 30/30 离线检查通过，真实 A/B 待重跑；生产保持 shadow |
