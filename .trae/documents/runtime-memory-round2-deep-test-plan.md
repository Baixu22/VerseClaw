# 运行时记忆系统第二轮深度测试 — 实施计划

## 摘要

本计划针对整个运行时记忆系统（8 层架构）设计**第二轮深度测试**，回答用户的 4 个核心问题：
1. **哪些信息会被保存？** — 写入路径真实过滤
2. **哪些记忆会被使用在长对话中？** — 真实长对话 + LLM token 出现率
3. **长对话中记忆的保有率** — 1000 轮模拟 + 30 轮 LLM 采样
4. **长期使用后沉淀的无用内容占比** — LLM-as-judge 独立判定

用户选择：**1000 轮脚本化 + 30 轮 LLM 采样**（最佳性价比），**新增维度 + 交叉验证现有层**（最彻底）。

核心约束：**不过度调整**现有框架，仅新增 Layer 6-9 + CV1-CV5 交叉验证测试。

---

## 当前状态分析

### 已完成的 Layers 1-5（第一轮）

| Layer | 文件 | 用例数 | LLM? | 状态 |
|-------|------|--------|------|------|
| L1 写入路径真实过滤 | `runtime-memory-write-path-semantic-real.test.ts` | 12 | 否 | ✅ 通过 |
| L2 消费者拒绝+Provider格式 | `runtime-memory-read-path-consumer-real.test.ts` | 19 | 否 | ✅ 通过 |
| L3 真实LLM使用 | `runtime-memory-llm-real-usage.test.ts` | 8 | 是 | ✅ 通过 |
| L4 长期累积 | `runtime-memory-long-term-accumulation.test.ts` | 10 | 否 | ✅ 通过 |
| L5 对抗性holdout | `runtime-memory-adversarial-holdout.test.ts` | 6 | 是 | 🔄 4/6 通过，2 修复待重跑 |

### 已识别的关键缺口（第二轮必须填补）

1. **无真实长对话模拟**：现有 `multi-turn-driver.ts` 使用脚本化 LLM（`baseline-turn-${i}`），仅测量 fact-ID 返回率，不测 LLM token 出现率。明确禁止真实模型调用。
2. **无交错写入**：Driver 仅读不写 — 事实通过 `seedCorpusToDb`/`seedTempDb` 预种子，turn 循环内无 `appendFact` 调用。
3. **无 1000 轮规模**：长期累积上限 300 轮；长对话 eval 上限 30 轮 × 4 查询 = 120 查询。
4. **`filterQueriesBySeededGroups` 仍在使用**：4 个旧文件仍调用（违反反过拟合规则）。
5. **`makeAblationQuerySet`/`makeHoldoutProbeFact` 已脚手架但未被任何测试使用**。
6. **无用内容的 LLM-as-judge 缺失**：L4 noise 标签由测试作者决定，非独立验证。
7. **无跨层交叉验证**：L1/L2 未被独立 LLM judge 验证；仅 L5 提供 LLM-as-judge。
8. **成熟度评分聚合器未实现**：`runtime-memory-maturity-score.ts` 不存在。

### 8 层架构（来自 Phase 1 探索）

1. Core 类型/sanitize/fixtures — `memory-context.ts`
2. 内存 store — `memory-store.ts`（MAX_FACTS=512, MAX_EPISODES=256）
3. SQLite 持久化 — `memory-persistence.ts`（FIFO `trimRows` by `created_at ASC, fact_id ASC`）
4. Runtime 集成端口 — `memory-runtime-integration.ts`
5. 写入路径 shadow（proposal）— `memory-proposal-shadow.ts`
6. 读取路径 shadow（DB 只读投影）— `memory-read-hydration-shadow.ts`
7. 读取路径 consumer（冲突+哨兵）— `memory-read-hydration-consumer.ts`（13 拒绝理由，冲突解决）
8. Context-engine provider — `memory-context-provider.ts`（**不做冲突解决**，仅排序）

---

## 反过拟合规则（继承 + 新增）

1. **无循环验证** — 仅独立 ground truth（生成时标签、LLM-as-judge）
2. **无指标操纵** — 保留 recall=0 在分母
3. **无模板 fixtures** — 3 域（programming/travel/debugging）+ HealthProfile holdout
4. **禁用 `filterQueriesBySeededGroups`** — 新文件不得使用
5. **【新】禁用 `expectedFactIds`** — 用 LLM token 出现率作为 recall，而非 fact-ID 返回率
6. **【新】真实方差 Cohen's d** — temperature=0.3 + 开放式 prompt，让 treatment 臂有真实方差
7. **【新】交错写入** — 不只预种子，turn 循环内必须 `appendFact`
8. **【新】采样策略独立** — LLM 采样轮次由固定步长（每 33 轮）决定，非测试作者挑选

## 反幻觉规则（继承 + 新增）

1. **唯一 token 探针** — `Zyxqlwbr-7341` 格式（7 字母 + 4 数字）
2. **A/B 消融** — with-memory vs without-memory，`abAttributable = tokenPresent_A && !tokenPresent_B`
3. **负向断言** — 未注入的 token 不得出现
4. **多评判投票** — 3 次 LLM 调用 at temp=0.3，≥2/3 同意
5. **【新】负向查询探针** — 查询不相关 subject，验证 LLM 不产生任何注入 token
6. **【新】冲突赢家探针** — 验证 LLM 使用高置信度事实，而非低置信度

---

## 提议变更

### Layer 6: 真实长对话模拟（1000 轮脚本化 + 30 轮 LLM 采样）

**文件**: `tests/unit/runtime-memory-long-conversation-real.test.ts`（新建）

**回答**: Q2（哪些记忆被使用）+ Q3（保有率）

**设计**:
- **1000 轮纯本地模拟**（无 LLM）：
  - 每轮：`appendFact(1 useful + 1 noise)` → 查询 N 轮前的事实（N=10/50/100/500）
  - 使用 `generateLongTermCorpus(1000, seed=42)` 生成语料，但**改为流式写入**而非批量预种子
  - 测量：
    - `retentionRateAtTurn(t)` = turn-t 时刻写入的事实，在 turn-1000 仍物理存在的比例
    - `noiseAccumulationRate` = turn-1000 时 noise 事实 / 总事实
    - `fifoEvictionAt512` = 当事实数 > 512 时，最早的事实被驱逐
    - `invalidationAccumulation` = 失效事实数随轮次增长
  - 使用 `now: () => now++` 保证 FIFO 按插入顺序

- **30 轮 LLM 采样**（每 33 轮采样一次：33, 66, 99, ..., 990）：
  - 每个采样轮次：A/B 消融
    - Baseline：空 DB → LLM 响应 → 检查 token 不存在
    - Treatment：DB 种子至该轮次 → LLM 响应 → 检查 token 存在
  - 测量：
    - `llmTokenRecall` = LLM 响应包含 token 的查询比例（真实功能性 recall）
    - `cohenD` = 有限值（非 Infinity），> 0.2
    - `treatmentVariance` = treatment 臂有真实方差（非全 1）
    - `baselineAllZero` = baseline 臂全 0
  - 使用开放式 prompt: `"Tell me about this user. What preferences do they have?"` + temperature=0.3
  - 总 LLM 调用：30 baseline + 30 treatment = 60 次（~$0.10/run）

**反过拟合**:
- 独立 ground truth：`labels` Map 来自语料生成时，非 `expectedFactIds`
- 禁用 `filterQueriesBySeededGroups`
- 采样步长固定（每 33 轮），非挑选
- LLM token 出现率作为 recall，非 fact-ID 返回率

**反幻觉**:
- 唯一 token 探针（`makeUniqueProbeToken`）
- A/B 消融（`abAttributable`）
- 负向断言（未注入 token 不出现）

**测试用例数**: ~12（8 非LLM + 4 LLM-gated）

---

### Layer 7: 交错读写测试（新维度）

**文件**: `tests/unit/runtime-memory-interleaved-read-write.test.ts`（新建）

**回答**: Q2（长对话中使用）— 验证写入与读取交错时记忆行为

**设计**:
- **1000 轮交错读写**（纯本地）：
  - 每轮：
    1. `appendFact(1 useful + 1 noise)` — 写入新事实
    2. 查询 N 轮前的事实（recall）
    3. 每 50 轮：`invalidateFact` 一个早期事实
  - 测量：
    - `recallDegradation` = turn-100 事实的 recall，在 turn-100/500/1000 三个时间点
    - `invalidationEffective` = 失效事实不再出现在 consumer `acceptedFacts`
    - `fifoPreservesRecent` = 驱逐后，最近 512 个事实仍存在
    - `writeReadConsistency` = 写入后立即查询能找到该事实
  - 使用 consumer path（`consumeRuntimeMemoryHydrationFacts`）做冲突解决

- **30 轮 LLM 采样**：
  - 在交错写入过程中采样，验证 LLM 能引用最近写入的事实
  - 测量 `recentFactRecall` = 最近 10 轮内写入事实的 LLM token recall

**反过拟合**:
- 独立 ground truth：写入时记录 `factId` + `token` + `label`
- 禁用 `filterQueriesBySeededGroups`
- LLM 采样步长固定

**测试用例数**: ~10（7 非LLM + 3 LLM-gated）

---

### Layer 8: 无用内容 LLM-as-judge（新维度）

**文件**: `tests/unit/runtime-memory-useless-content-judge.test.ts`（新建）

**回答**: Q4（长期使用后沉淀的无用内容占比）

**设计**:
- 用 `generateLongTermCorpus(1000, seed=42)` 生成 1000 轮语料（500 useful + 500 noise）
- 种子到 DB
- **分层采样 50 个事实**（25 useful-label + 25 noise-label）
- 对每个事实，调用独立 LLM judge：
  - Prompt: `"You are evaluating a stored memory fact. Is this fact useful for future conversations? Answer 'useful' or 'noise' only."`
  - 多评判投票：3 次调用 at temp=0.3，≥2/3 同意
- 测量：
  - `agreementRate` = LLM judge 与生成时标签的一致率（应 > 80%）
  - `falsePositiveRate` = LLM 说 useful 但标签是 noise 的比例
  - `falseNegativeRate` = LLM 说 noise 但标签是 useful 的比例
  - `cohenKappa` = inter-rater agreement（应 > 0.6）
  - `uselessContentRatio` = turn-1000 时 noise 事实 / 总事实（来自 L4 的 50%，由 LLM 独立确认）

**反过拟合**:
- LLM judge 独立于标签生成（标签来自语料，judge 来自 LLM）
- 分层采样保证两类都有代表
- 多评判投票减少单次偏差

**反幻觉**:
- LLM judge 仅看事实内容，不看标签
- 多评判投票

**测试用例数**: ~6（2 非LLM + 4 LLM-gated）

---

### CV1: LLM-judge 确认 L1 写入路径 noise 分类

**文件**: `tests/unit/runtime-memory-write-path-llm-judge.test.ts`（新建）

**回答**: Q1 交叉验证 — L1 用 regex 拒绝 raw input，用 LLM 独立验证

**设计**:
- 取 20 个 L1 拒绝的 raw 输入（`raw_chat_log`, `raw_leak`, `prompt_injection` 等）
- 对每个，调用独立 LLM judge：
  - Prompt: `"You are evaluating a proposed memory fact input. Is this input appropriate for storing as a structured fact, or is it raw chat log / leaked memory / prompt injection? Answer 'appropriate' or 'reject' only."`
  - 多评判投票
- 测量：
  - `agreementRate` = LLM judge 与 L1 regex 分类一致率（应 > 80%）
  - 每个拒绝理由的 per-reason agreement

**测试用例数**: ~4（1 非LLM + 3 LLM-gated）

---

### CV2: LLM-judge 确认 L2 消费者拒绝理由

**文件**: `tests/unit/runtime-memory-consumer-llm-judge.test.ts`（新建）

**回答**: Q2 交叉验证 — L2 用 13 拒绝理由，用 LLM 独立验证

**设计**:
- 为每个拒绝理由构造一个应被拒绝的事实（13 个）
- 对每个，调用独立 LLM judge：
  - Prompt: `"You are evaluating whether a stored memory fact should be used to answer a user's query. Given the fact and the query, should this fact be used? Answer 'use' or 'reject' only."`
  - 多评判投票
- 测量：
  - `agreementRate` = LLM judge 与 L2 拒绝决策一致率（应 > 80%）
  - per-reason agreement

**测试用例数**: ~4（1 非LLM + 3 LLM-gated）

---

### CV3: L3 多评判投票扩展

**文件**: `tests/unit/runtime-memory-llm-multi-judge.test.ts`（新建）

**回答**: Q2 交叉验证 — L3 单评判，扩展为多评判投票

**设计**:
- 对 L3 的 8 个测试用例，每个运行 3 次 LLM judge at temp=0.3
- 要求 ≥2/3 同意
- 测量：
  - `multiJudgeAgreement` = 3 次投票的一致率
  - `abAttributableStability` = A/B 消融在 3 次投票中都成立

**测试用例数**: ~4 LLM-gated

---

### CV4: LLM-judge 确认 L4 保有率指标

**文件**: `tests/unit/runtime-memory-retention-llm-judge.test.ts`（新建）

**回答**: Q3 交叉验证 — L4 测物理存在，用 LLM 功能性 recall 验证

**设计**:
- 取 L4 说"保留"的 20 个事实（物理存在于 DB）
- 对每个，运行 LLM token-appearance recall 测试
- 测量：
  - `physicalRetentionVsLlmRecall` = 物理保留的事实中，LLM 实际引用的比例（应 > 70%）
  - `retentionGap` = 物理保留率 - LLM recall 率（应 < 30%）

**测试用例数**: ~3 LLM-gated

---

### CV5: L5 holdout 多评判投票（小扩展）

**文件**: 修改 `tests/unit/runtime-memory-adversarial-holdout.test.ts`

**设计**:
- 为现有 L5 LLM 测试添加多评判投票（3 次 at temp=0.3，≥2/3 同意）
- 不新增测试用例，仅增强现有

**测试用例数**: 0 新增（修改现有）

---

### Layer 9: 成熟度评分聚合器

**文件**:
- `tests/unit/helpers/runtime-memory-maturity-score.ts`（新建 helper）
- `tests/unit/runtime-memory-maturity-score-real.test.ts`（新建测试）

**设计**:
- 聚合所有层（L1-L9 + CV1-CV5）为单一成熟度评分
- 7 维度：Correctness, Statistical Rigor, Anti-Overfitting, Anti-Hallucination, Coverage, Cross-Validation, Maturity
- 硬性否决项：
  1. `circular_validation_disqualifier` — 使用 `filterQueriesBySeededGroups`
  2. `metric_manipulation_disqualifier` — recall=0 在分母被排除
  3. `hollow_llm_disqualifier` — LLM 测试全跳过
  4. `cohen_d_infinity_disqualifier` — Cohen's d = Infinity（零方差）
- 7 测试用例：
  1. `all_layers_pass_no_disqualifier`
  2. `circular_validation_disqualifier`
  3. `metric_manipulation_disqualifier`
  4. `hollow_llm_disqualifier`
  5. `cohen_d_infinity_disqualifier`
  6. `skipped_layer_not_counted`
  7. `weight_distribution_correct`

---

## 假设与决策

### 假设
1. DeepSeek API key 通过 `process.env.DEEPSEEK_API_KEY` 提供；无 key 时 LLM 测试 `skipIf` 跳过（非失败）
2. 现有 `runtime-memory-real-corpus.ts` 的 `generateLongTermCorpus` 可复用，但需新增流式写入 helper
3. 现有 `runtime-memory-real-llm-client.ts` 的 `callDeepSeek` + `callDeepSeekMajorityVote` 可复用
4. 现有 `createRuntimeMemoryPersistenceStore` + `consumeRuntimeMemoryHydrationFacts` + `createRuntimeMemoryProviderResult` API 不变
5. 测试在 Windows Node.js 环境运行（`@vitest-environment node`）

### 决策
1. **不修改** Layers 1-5 现有测试文件（CV5 除外，仅小扩展）
2. **不修改** `multi-turn-driver.ts`（明确禁止真实 LLM，与本轮目标冲突）
3. **不清理** 4 个旧文件中的 `filterQueriesBySeededGroups` 使用（超出本轮范围；仅在 maturity score 中标记为 legacy）
4. **新增** 流式写入 helper 到 `runtime-memory-real-corpus.ts`：`streamCorpusToDb(dbPath, turns, seed)`
5. **LLM 采样步长**：1000 轮 / 30 采样 = 每 33 轮一次（固定，非随机）
6. **多评判投票**：3 次调用 at temp=0.3，≥2/3 同意
7. **成熟度阈值**：≥0.7 为 mature，<0.5 为 immature
8. **总 LLM 成本**：< $1 per full run（60 + 30 + 50 + 20 + 13 + 24 + 20 = ~217 LLM 调用，~$0.30）

---

## 验证步骤

### 单元测试验证
1. 所有非 LLM 测试在无 `DEEPSEEK_API_KEY` 时通过
2. 所有 LLM 测试在有 `DEEPSEEK_API_KEY` 时通过（或 skipIf 跳过）
3. Cohen's d 为有限值（非 Infinity）
4. 成熟度评分 ≥ 0.7
5. 新文件无 `filterQueriesBySeededGroups` 引用

### 类型检查
6. `pnpm run typecheck` 零错误

### 反过拟合自检
7. Layer 6 的 `cohenD` 自检：`expect(Number.isFinite(d)).toBe(true)`
8. Layer 6 的 `treatmentVariance` 自检：treatment 臂非全 1
9. Layer 6 的 `baselineAllZero` 自检：baseline 臂全 0
10. Layer 8 的 `cohenKappa` > 0.6（LLM judge 与标签一致）

### 反幻觉自检
11. CV1/CV2 的 `agreementRate` > 80%（LLM judge 与 regex/consumer 一致）
12. Layer 6 的负向断言：未注入 token 不出现
13. Layer 7 的 `invalidationEffective`：失效事实不出现在 acceptedFacts

### 实施顺序
1. **Layer 6** 真实长对话（1000 + 30 LLM）— 最大价值
2. **Layer 7** 交错读写 — 填补关键缺口
3. **Layer 8** 无用内容 LLM judge — 回答 Q4
4. **CV1** L1 交叉验证
5. **CV2** L2 交叉验证
6. **CV3** L3 多评判
7. **CV4** L4 交叉验证
8. **CV5** L5 小扩展
9. **Layer 9** 成熟度聚合器 — 最后

### 运行命令
```bash
# 非 LLM 测试（无 key 时）
pnpm vitest run tests/unit/runtime-memory-long-conversation-real.test.ts tests/unit/runtime-memory-interleaved-read-write.test.ts

# 全量 LLM 测试（有 key 时）
DEEPSEEK_API_KEY=sk-... pnpm vitest run tests/unit/runtime-memory-long-conversation-real.test.ts tests/unit/runtime-memory-interleaved-read-write.test.ts tests/unit/runtime-memory-useless-content-judge.test.ts tests/unit/runtime-memory-write-path-llm-judge.test.ts tests/unit/runtime-memory-consumer-llm-judge.test.ts tests/unit/runtime-memory-llm-multi-judge.test.ts tests/unit/runtime-memory-retention-llm-judge.test.ts tests/unit/runtime-memory-maturity-score-real.test.ts

# 类型检查
pnpm run typecheck
```

---

## 文件清单

### 新建文件（9 个测试 + 1 个 helper）

| 文件 | Layer | 用例数 | LLM? |
|------|-------|--------|------|
| `tests/unit/runtime-memory-long-conversation-real.test.ts` | L6 | ~12 | 部分 |
| `tests/unit/runtime-memory-interleaved-read-write.test.ts` | L7 | ~10 | 部分 |
| `tests/unit/runtime-memory-useless-content-judge.test.ts` | L8 | ~6 | 部分 |
| `tests/unit/runtime-memory-write-path-llm-judge.test.ts` | CV1 | ~4 | 部分 |
| `tests/unit/runtime-memory-consumer-llm-judge.test.ts` | CV2 | ~4 | 部分 |
| `tests/unit/runtime-memory-llm-multi-judge.test.ts` | CV3 | ~4 | 是 |
| `tests/unit/runtime-memory-retention-llm-judge.test.ts` | CV4 | ~3 | 是 |
| `tests/unit/runtime-memory-maturity-score-real.test.ts` | L9 | 7 | 否 |
| `tests/unit/helpers/runtime-memory-maturity-score.ts` | L9 helper | — | — |

### 修改文件（2 个）
- `tests/unit/runtime-memory-adversarial-holdout.test.ts` — CV5 多评判扩展
- `tests/unit/helpers/runtime-memory-real-corpus.ts` — 新增 `streamCorpusToDb` helper
- `package.json` — 新增 `eval:runtime-memory:round2` 脚本

### 不修改文件
- Layers 1-4 现有测试文件
- `multi-turn-driver.ts`（明确禁止真实 LLM）
- `runtime-memory-eval-helpers.ts`（legacy，仅在 maturity score 中标记）

---

## 预期成果

- **总测试用例数**：~60 新增（35 非LLM + 25 LLM-gated）
- **总 LLM 调用**：~217 per full run（~$0.30）
- **回答用户 4 问**：
  1. Q1（保存）：L1 + CV1 交叉验证 ✅
  2. Q2（使用）：L3 + L6 + L7 + CV2 + CV3 交叉验证 ✅
  3. Q3（保有率）：L4 + L6 + CV4 交叉验证 ✅
  4. Q4（无用内容）：L4 + L8 LLM-judge 交叉验证 ✅
- **成熟度评分**：≥0.7（mature）
- **反过拟合**：8 条规则全部自检
- **反幻觉**：6 条规则全部自检
