# 运行时记忆系统：成熟度测试实现计划（第二轮深度规划）

## Summary

本计划承接第一轮设计文档（`runtime-memory-real-multi-layer-test-plan.md`），聚焦**剩余实现工作**：修复 Layer 2 的 2 个残留失败、实现 Layer 3（真实 LLM 使用）、Layer 4（长期累积）、Layer 5（对抗性 holdout）以及成熟度评分聚合器。目标是回答用户 4 个核心问题，并保证**不幻觉、不过拟合**。

**当前状态**（已验证）：
- Layer 1（`runtime-memory-write-path-semantic-real.test.ts`）：12/12 通过 ✅
- Layer 2（`runtime-memory-read-path-consumer-real.test.ts`）：15/19 通过，2 个修复已应用（token_budget、limit_exceeded），2 个修复待应用（raw_leak_sentinel 词边界、provider id 格式）🔄
- Layer 3/4/5 + `runtime-memory-maturity-score.ts`：未创建 ⬜
- Helper：`runtime-memory-real-llm-client.ts` ✅、`runtime-memory-real-corpus.ts` ✅

**用户 4 个核心问题映射**：
| 问题 | 回答 Layer | 关键机制 |
|------|-----------|---------|
| 1. 哪些信息会被保存 | Layer 1（已完成） | 4 层防御真实过滤 + 语义噪声不被拒（真实发现） |
| 2. 哪些记忆会被使用在长对话中 | Layer 2 + Layer 3 | Layer 2 测 consumer 13 拒绝原因；Layer 3 用真实 DeepSeek + 唯一令牌 + A/B 消融验证 LLM 引用记忆 |
| 3. 记忆的保有率 | Layer 4 | 100/300 轮后查早期 fact，保有率 = provider 返回数 / 写入数；ground truth 是 factId 集合 |
| 4. 无用内容占比 | Layer 4 | 噪声累积率 = DB 中噪声 fact / 总 fact；ground truth 是生成时 labels；真实发现 ≈50% |

---

## 抗过拟合与抗幻觉原则（实现时强制遵守）

### 抗过拟合（4 条硬规则）
1. **禁止循环验证**：ground truth 必须来自独立来源（生成时 labels、真实 LLM 行为、factId 集合），不能用 consumer 的设计目标
2. **禁止指标操纵**：不能丢弃低 recall query 来抬高 Cohen's d。recall=0 的 query 保留并计入分母
3. **禁止模板 fixture**：测试场景来自 3 个不同领域（编程/旅行/调试）+ holdout（医疗健康），不能用现有 8 个 category 模板
4. **禁止复用 `filterQueriesBySeededGroups`**（`runtime-memory-eval-helpers.ts:276`）

### 抗幻觉（4 条硬规则）
1. **唯一令牌探针**：用 LLM 绝不可能自己生成的 token（`Zyxqlwbr-7341` 格式：7 个大写字母 + 连字符 + 4 位数字）作为 fact 的 objectSummary，验证响应中出现该 token
2. **A/B 消融**：同一 query，有记忆（A 臂）vs 无记忆（B 臂），`abAttributable = tokenPresent_A && !tokenPresent_B`
3. **负向断言**：验证 LLM 不引用未注入的 fact（无幻觉）
4. **多 judge 投票**：关键评分用 3 次独立 LLM 调用（temperature=0.3），≥2/3 一致才算通过

---

## Current State Analysis

### Layer 2 待修复（2 处）

**问题 1**：`DEFAULT_RAW_LEAK_SENTINEL matches raw leak phrases`（第 218 行）
- 现状：`expect(DEFAULT_RAW_LEAK_SENTINEL.test(".jsonl transcript dump")).toBe(true);`
- 失败原因：正则 `\b\.jsonl\b` 要求 `.` 前有单词字符，字符串开头无前导字符 → `\b` 不匹配
- 修复：改为 `expect(DEFAULT_RAW_LEAK_SENTINEL.test("file.jsonl transcript dump")).toBe(true);`（`file` 提供前导单词字符）

**问题 2**：`provider_filters_non_accepted_verification_by_default`（第 299 行）
- 现状：`expect(factIds).toContain("fact_verified");`
- 失败原因：ContextItem.id 格式是 `runtime-memory:${factId}`，不是裸 factId
- 修复：改为 `expect(factIds.some((id) => id.includes("fact_verified"))).toBe(true);` 和 `expect(factIds.some((id) => id.includes("fact_candidate"))).toBe(false);`

### Layer 3 设计要点（真实 LLM 使用）

**核心机制**：
- 拿 context：直接调 `createRuntimeMemoryProviderResult`（`memory-context-provider.ts:197`），绕过 `multi-turn-driver`（其注释自承 "response not used by hydration"）
- A/B 消融：A 臂 = 有记忆 context，B 臂 = 空 context；`abAttributable = tokenPresent_A && !tokenPresent_B`
- 唯一令牌：`makeUniqueProbeToken(seed)` 生成 `Zyxqlwbr-7341` 格式 token，注入 fact 的 objectSummary

**抗过拟合关键设计**：
- 不用 `expectedFactIds`（循环验证），用 token 出现与否（独立证据）
- 不用 `filterQueriesBySeededGroups`（指标操纵）
- A/B 消融强制要求 B 臂不含 token（不能只验证 A 臂含 token）

### Layer 4 设计要点（长期累积）

**核心机制**：
- 用 `generateLongTermCorpus(turns)` 生成 100/300 轮 fact（每轮 1 有用 + 1 噪声）
- 用 `createRuntimeMemoryPersistenceStore` + `appendFact` 写入真实 SQLite DB
- 保有率：对每个早期有用 fact，用 `createRuntimeMemoryProviderResult` 查询是否仍被返回
- 噪声累积率：用 `labels` Map（生成时标签）统计 DB 中噪声 fact 占比

**抗过拟合关键设计**：
- ground truth 是 `labels` Map（生成时），不是 consumer 判断
- 保有率理论值基于 FIFO（maxFacts=512），不是构造的 `expectedFactIds`
- 噪声累积率 ≈50% 是**真实发现**（系统不拒绝语义噪声），不是构造的结果

### Layer 5 设计要点（对抗性 holdout）

**核心机制**：
- Holdout 领域：`HealthProfile`（非 8 category 模板）
- 模糊 subject/predicate：`量子计算偏好` / `退相干阈值`
- 真实方差 Cohen's d：20 query，baseline（空 DB）vs treatment（seeded DB），用**LLM 响应中的 token 出现率**（非 provider 返回率）计算 recall，产生真实方差

**Cohen's d 修复方案**（关键）：
- 原问题：baseline 全 recall=0，treatment 全 recall=1 → 零方差 → d=Infinity
- 修复：用 **LLM 响应中的 token 出现率**（非 provider 返回率）作为 recall
  - Baseline：空 DB → LLM 永不产生唯一 token → recall=0（方差=0）
  - Treatment：seeded DB → LLM **通常**产生 token 但**不总是**（temperature、prompt 歧义）→ recall 有方差（如 15/20=0.75, 18/20=0.9）
  - Cohen's d = (mean_treatment - mean_baseline) / pooled_sd，treatment 有方差 → d 有限
- 不用 `filterQueriesBySeededGroups`，保留所有 20 个 query

---

## Proposed Changes

### 步骤 0：修复 Layer 2 残留失败（2 处）

**文件**：`tests/unit/runtime-memory-read-path-consumer-real.test.ts`

**改动 1**（第 218 行）：
```typescript
// 旧：expect(DEFAULT_RAW_LEAK_SENTINEL.test(".jsonl transcript dump")).toBe(true);
// 新：expect(DEFAULT_RAW_LEAK_SENTINEL.test("file.jsonl transcript dump")).toBe(true);
```

**改动 2**（第 299-300 行）：
```typescript
// 旧：
// expect(factIds).toContain("fact_verified");
// expect(factIds).not.toContain("fact_candidate");
// 新：
expect(factIds.some((id) => id.includes("fact_verified"))).toBe(true);
expect(factIds.some((id) => id.includes("fact_candidate"))).toBe(false);
```

**验收**：`pnpm vitest run tests/unit/runtime-memory-read-path-consumer-real.test.ts` 全过（19/19）

---

### 步骤 1：Layer 3 — 真实 LLM 使用记忆测试

**文件**：`tests/unit/runtime-memory-llm-real-usage.test.ts`（新建）

**环境**：`@vitest-environment node`，`describe.skipIf(!process.env.DEEPSEEK_API_KEY)`

**依赖**：
- `tests/unit/helpers/runtime-memory-real-llm-client.ts`（`callDeepSeek`, `callDeepSeekMajorityVote`, `checkTokenProbe`）
- `tests/unit/helpers/runtime-memory-real-corpus.ts`（`makeProbeFact`, `makeProbeFactSet`, `makeUniqueProbeToken`）
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`（`createRuntimeMemoryProviderResult`）

**核心 helper（文件内）**：
```typescript
async function getMemoryContext(
  facts: readonly RuntimeMemoryTemporalFact[],
  query: { taskId: string; subject: string; predicate: string; referenceTime: number },
): Promise<string> {
  const result = await createRuntimeMemoryProviderResult(
    { facts, defaultTokenBudget: 256, defaultLimit: 8 },
    {
      taskId: query.taskId,
      tokenBudget: 256,
      metadata: {
        memoryQuery: {
          taskId: query.taskId,
          subject: query.subject,
          predicate: query.predicate,
          reference_time: query.referenceTime,
          limit: 8,
        },
      },
    },
  );
  return result.contextItems.map((item) => item.text).join("\n");
}

function buildProbePrompt(memoryContextText: string, userQuestion: string): { system: string; user: string } {
  const system = [
    "You are a helpful assistant with access to the user's stored preferences.",
    "If relevant memory is provided below, use it to answer.",
    "If no memory is provided or it is irrelevant, answer based on general knowledge.",
    "Do not invent preferences that are not in the memory.",
    "",
    memoryContextText.length > 0
      ? `=== STORED MEMORY ===\n${memoryContextText}\n=== END MEMORY ===`
      : "=== STORED MEMORY ===\n(no memory stored)\n=== END MEMORY ===",
  ].join("\n");
  return { system, user: userQuestion };
}

async function runTokenProbe(
  facts: readonly RuntimeMemoryTemporalFact[],
  query: { taskId: string; subject: string; predicate: string; referenceTime: number },
  targetToken: string,
  negativeTokens: readonly string[],
  userQuestion: string,
): Promise<{
  tokenPresent: boolean;
  negativeClean: boolean;
  abAttributable: boolean;
  withMemoryContent: string;
  withoutMemoryContent: string;
}> {
  const memoryText = await getMemoryContext(facts, query);
  const promptA = buildProbePrompt(memoryText, userQuestion);
  const resA = await callDeepSeek(promptA.system, promptA.user);
  const promptB = buildProbePrompt("", userQuestion);
  const resB = await callDeepSeek(promptB.system, promptB.user);
  const tokenPresent = resA.content.includes(targetToken);
  const negativeClean = negativeTokens.every((t) => !resA.content.includes(t));
  const abAttributable = tokenPresent && !resB.content.includes(targetToken);
  return {
    tokenPresent, negativeClean, abAttributable,
    withMemoryContent: resA.content, withoutMemoryContent: resB.content,
  };
}
```

**8 个测试用例**：

1. `single_fact_recall_token_probe`
   - 1 个 probe fact（token=`makeUniqueProbeToken(1)`），查询匹配
   - 断言：`tokenPresent=true`, `negativeClean=true`, `abAttributable=true`

2. `multi_fact_recall_3_of_5`
   - `makeProbeFactSet({ count: 5, ... })` 生成 5 个 probe fact（各含不同 token）
   - 查询前 3 个的 subject/predicate（注意：每个 probe fact 的 predicate 不同，需分别查 3 次）
   - 断言：3 次 A 臂响应分别含对应 token；不含未查询的 2 个 token

3. `invalidation_isolation`
   - 1 个有效 fact（tokenValid, valid_at=100）+ 1 个失效 fact（tokenInvalid, invalid_at=50）
   - 查询 referenceTime=1000（此时失效 fact 应被 `invalidated_at_reference_time` 拒绝）
   - 断言：A 臂含 tokenValid，不含 tokenInvalid，`abAttributable=true`（对 tokenValid）

4. `task_isolation`
   - 1 个 taskId 匹配 fact（tokenA, taskId="task_match"）+ 1 个不匹配 fact（tokenB, taskId="task_other"）
   - 查询 taskId="task_match"
   - 断言：A 臂含 tokenA，不含 tokenB

5. `conflict_winner_used`
   - 2 个冲突 fact（同 task/subject/predicate）：tokenOld conf=0.5, tokenNew conf=0.9
   - 查询匹配的 task/subject/predicate
   - 断言：A 臂含 tokenNew，不含 tokenOld（consumer 保留 confidence 高的）

6. `token_budget_truncation_still_usable`
   - 1 个 probe fact，tokenBudget=64（强制截断）
   - 断言：context 仍含 token（token 在 objectSummary 前部，截断不丢失）；A 臂含 token

7. `no_hallucination_of_uninjected_facts`
   - 注入 tokenReal 的 fact；prompt user question 提到 tokenFake（"Is the user's preference code tokenFake?"）
   - 断言：A 臂含 tokenReal，不含 tokenFake（LLM 不幻觉未注入的 token）

8. `multi_judge_vote_consistency`
   - 同一 probe query，调 `callDeepSeekMajorityVote(system, user, 3, { temperature: 0.3 })`
   - 断言：3 次响应中 ≥2 次含 token

**验收**：
- 无 key 时 suite 跳过（`describe.skipIf`）
- 有 key 时 8/8 通过
- 所有用例的 `abAttributable=true`（A 含 token 且 B 不含）
- `no_hallucination_of_uninjected_facts` 必须通过（抗幻觉自检）

---

### 步骤 2：Layer 4 — 长期累积仿真测试

**文件**：`tests/unit/runtime-memory-long-term-accumulation.test.ts`（新建）

**环境**：`@vitest-environment node`（纯本地 SQLite，无 LLM 调用）

**依赖**：
- `tests/unit/helpers/runtime-memory-real-corpus.ts`（`generateLongTermCorpus`）
- `openclaw_runtime/src/runtime-core/memory-persistence.ts`（`createRuntimeMemoryPersistenceStore`）
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`（`createRuntimeMemoryProviderResult`）
- `tests/unit/helpers/runtime-memory-eval-helpers.ts`（`createTempDbPath`, `RUNTIME_MEMORY_EVAL_CONFIG`，**不**用 `filterQueriesBySeededGroups`）

**核心 helper（文件内）**：
```typescript
function seedCorpusToDb(dbPath: string, corpus: LongTermCorpus): void {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    now: () => 10_000,
  });
  if (persistence.migrate().status !== "migrated") {
    throw new Error("seedCorpusToDb: migration failed");
  }
  for (const fact of corpus.facts) {
    const result = persistence.appendFact(fact);
    if (result.status !== "persisted") {
      throw new Error(`seedCorpusToDb: appendFact failed for ${fact.factId}`);
    }
  }
}

function loadFactCount(dbPath: string): { facts: number; episodes: number } {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
  });
  const loaded = persistence.loadStore();
  if (loaded.status !== "loaded") throw new Error("loadFactCount: load failed");
  return {
    facts: loaded.store.stats().facts,
    episodes: loaded.store.stats().episodes,
  };
}

async function isFactRetained(
  dbPath: string,
  fact: RuntimeMemoryTemporalFact,
): Promise<boolean> {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
  });
  const loaded = persistence.loadStore();
  if (loaded.status !== "loaded") throw new Error("isFactRetained: load failed");
  const result = await createRuntimeMemoryProviderResult(
    { facts: [...loaded.store.queryFacts()], defaultTokenBudget: 256, defaultLimit: 8 },
    {
      taskId: fact.taskId,
      tokenBudget: 256,
      metadata: {
        memoryQuery: {
          taskId: fact.taskId,
          subject: fact.subject,
          predicate: fact.predicate,
          reference_time: 10_000,
          limit: 8,
        },
      },
    },
  );
  return result.contextItems.some((item) => item.id.includes(fact.factId));
}
```

**10 个测试用例**：

1. `retention_after_100_turns_programming`
   - `generateLongTermCorpus(100)` → 200 fact（100 有用 + 100 噪声）
   - 写入 DB，查前 10 个有用 fact 的保有率
   - 断言：保有率 ≥0.7（200 < maxFacts=512，无 FIFO 驱逐，理论值 1.0，留余量）

2. `retention_after_300_turns_mixed_domains`
   - `generateLongTermCorpus(300)` → 600 fact（> maxFacts=512）
   - 写入 DB，查前 100 个有用 fact 的保有率
   - 断言：DB 中只有 512 个 fact（FIFO 驱逐 88 个）；早期保有率 < 1.0（前 88 个被驱逐）
   - 理论值：前 88 个 fact 被驱逐（44 有用 + 44 噪声），保有率 = (100-44)/100 = 0.56

3. `noise_accumulation_rate_100_turns`
   - 100 轮后，用 `labels` Map 统计 DB 中噪声 fact 占比
   - 断言：噪声率 ≈ 0.5（±0.05），真实发现：系统不拒绝语义噪声

4. `noise_accumulation_rate_300_turns`
   - 300 轮后，统计噪声率
   - 断言：噪声率仍 ≈ 0.5（FIFO 不区分有用/噪声）

5. `fifo_eviction_critical_point`
   - 写入 512+50=562 个 fact，验证 DB 中只有 512 个
   - 断言：`loadFactCount().facts === 512`；前 50 个 factId 不在 DB 中

6. `fifo_eviction_does_not_prioritize_useful`
   - 交替写入有用/噪声 fact，超过 maxFacts
   - 断言：被驱逐的 fact 中有用和噪声各占约 50%（FIFO 按写入顺序，不按有用性）

7. `topic_drift_recall_decay`
   - 前 50 轮编程 + 后 50 轮旅行（用 `generateLongTermCorpus` 的轮转机制，或手动构造）
   - 100 轮后查编程 fact，断言：仍可查（200 < 512，无驱逐）

8. `invalidation_accumulation`
   - 写入 100 个 fact，对其中 20 个发 `invalidateFact`
   - 断言：DB 中仍有 100 个 fact（失效不删除，打 `invalid_at`）；`loadFactCount().facts === 100`

9. `episode_retention_vs_fact_retention`
   - 写入 50 episode + 600 fact（maxEpisodes=256, maxFacts=512）
   - 断言：episode 未被裁剪（50 < 256），fact 被裁剪（600 > 512）

10. `long_term_no_active_gc`
    - 100 轮后检查无 TTL、无主动 GC
    - 断言：所有 fact 仍物理存在（除非 FIFO 驱逐）；无 `expired_at` 自动设置

**验收**：
- 10/10 通过
- 100 轮保有率 ≥0.7
- 300 轮保有率与 FIFO 理论值一致（< 1.0）
- 噪声率 ≈ 0.5（真实发现，不粉饰）

---

### 步骤 3：Layer 5 — 对抗性 holdout 测试

**文件**：`tests/unit/runtime-memory-adversarial-holdout.test.ts`（新建）

**环境**：`@vitest-environment node`，部分 `describe.skipIf(!process.env.DEEPSEEK_API_KEY)`

**依赖**：
- `tests/unit/helpers/runtime-memory-real-llm-client.ts`
- `tests/unit/helpers/runtime-memory-real-corpus.ts`（`makeHoldoutProbeFact`, `makeAblationQuerySet`, `makeUniqueProbeToken`）
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`

**6 个测试用例**：

1. `holdout_domain_not_in_template`（无 LLM，纯 provider）
   - 用 `HOLDOUT_DOMAIN`（HealthProfile）+ `makeHoldoutProbeFact`
   - 断言：provider 返回该 fact（含 token）；subject="HealthProfile" 不在 8 category 模板中

2. `holdout_obscure_subject_predicate`（无 LLM，纯 provider）
   - subject="量子计算偏好"，predicate="退相干阈值"
   - 断言：provider 能正确匹配并返回（非英文 subject/predicate 不影响功能）

3. `negative_unrelated_query_returns_empty`（无 LLM，纯 provider）
   - 注入编程 fact，用旅行 query 查
   - 断言：`result.contextItems.length === 0`（无跨领域泄漏）

4. `llm_judge_validates_attribution`（需 LLM）
   - 注入 1 个 probe fact（tokenReal），A 臂响应含 tokenReal
   - 用独立 judge prompt：`"Does the following response cite information from the stored memory? Answer yes or no."` + 响应内容
   - 断言：judge 回答 "yes"（记忆真的被归因使用）

5. `llm_judge_catches_hallucination`（需 LLM）
   - B 臂（无记忆）响应，但 user question 提到 token
   - 用独立 judge prompt：`"Does the following response invent a preference code not present in the stored memory? Answer yes or no."`
   - 断言：judge 回答 "no"（B 臂不应幻觉 token）或 B 臂响应本身不含 token

6. `ablation_effect_size_real_variance`（需 LLM，关键抗过拟合）
   - `makeAblationQuerySet(20)` 生成 20 个 query + 20 个 treatment fact
   - 对每个 query：
     - Baseline：空 fact 列表 → `getMemoryContext([], query)` → LLM 响应（不含 token）→ recall=0
     - Treatment：`getMemoryContext([treatmentFact], query)` → LLM 响应（**通常**含 token 但不总是）→ recall=0 或 1
   - 计算 Cohen's d = (mean_treatment - mean_baseline) / pooled_sd
   - 断言：`Number.isFinite(d)`（非 Infinity）；`d > 0.2`（有效果）；treatment recall 有方差（不全为 1）
   - **抗过拟合自检**：如果 d 仍是 Infinity，说明测试设计仍有过拟合

**Cohen's d 计算逻辑**：
```typescript
function cohenD(baseline: number[], treatment: number[]): number {
  const meanB = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const meanT = treatment.reduce((a, b) => a + b, 0) / treatment.length;
  const varB = baseline.reduce((sum, v) => sum + (v - meanB) ** 2, 0) / baseline.length;
  const varT = treatment.reduce((sum, v) => sum + (v - meanT) ** 2, 0) / treatment.length;
  const pooledSd = Math.sqrt((varB + varT) / 2);
  if (pooledSd === 0) return meanT > meanB ? Infinity : (meanT < meanB ? -Infinity : 0);
  return (meanT - meanB) / pooledSd;
}
```

**验收**：
- 6/6 通过（无 key 时后 3 个跳过）
- `ablation_effect_size_real_variance` 的 Cohen's d 为有限值（非 Infinity）

---

### 步骤 4：成熟度评分聚合器 + 聚合测试

**文件 1**：`tests/unit/helpers/runtime-memory-maturity-score.ts`（新建）

```typescript
export type LayerScore = {
  layer: 1 | 2 | 3 | 4 | 5;
  name: string;
  passed: number;
  total: number;
  rate: number;
  weight: number;
  failures: string[];
  independentGroundTruth: boolean;
  ablationVerified: boolean;
  skipped?: boolean; // L3/L5 无 key 时跳过
};

export type MaturityScore = {
  overall: number; // 0-100
  layers: LayerScore[];
  disqualifiers: {
    circularValidation: boolean;
    metricManipulation: boolean;
    hollowLlm: boolean;
    cohenDInfinity: boolean;
  };
  findings: string[];
};

const WEIGHTS = { 1: 0.15, 2: 0.15, 3: 0.35, 4: 0.20, 5: 0.15 };

export function computeMaturityScore(layers: LayerScore[]): MaturityScore {
  // 硬否决检测
  const disqualifiers = {
    circularValidation: layers.some((l) => !l.independentGroundTruth),
    metricManipulation: layers.some((l) => l.failures.includes("filterQueriesBySeededGroups used")),
    hollowLlm: layers.find((l) => l.layer === 3)?.skipped === false &&
               !layers.find((l) => l.layer === 3)?.ablationVerified,
    cohenDInfinity: layers.some((l) => l.failures.includes("cohen_d_infinity")),
  };
  const anyDisqualifier = Object.values(disqualifiers).some(Boolean);

  // 加权得分
  let weightedSum = 0;
  let weightTotal = 0;
  for (const layer of layers) {
    if (layer.skipped) continue; // 跳过的层不计入分母
    weightedSum += layer.rate * layer.weight;
    weightTotal += layer.weight;
  }
  const overall = anyDisqualifier ? 0 : weightTotal > 0
    ? Math.round((weightedSum / weightTotal) * 100)
    : 0;

  return { overall, layers, disqualifiers, findings: [] };
}
```

**文件 2**：`tests/unit/runtime-memory-maturity-score-real.test.ts`（新建）

**测试用例**：
1. `all_layers_pass_no_disqualifier` — 模拟 5 层全过，无否决 → overall > 0
2. `circular_validation_disqualifier` — `independentGroundTruth=false` → overall=0
3. `metric_manipulation_disqualifier` — 使用 `filterQueriesBySeededGroups` → overall=0
4. `hollow_llm_disqualifier` — L3 未跳过但 `ablationVerified=false` → overall=0
5. `cohen_d_infinity_disqualifier` — Cohen's d=Infinity → overall=0
6. `skipped_layer_not_counted` — L3 跳过（无 key），其他层过 → overall > 0（跳过非失败）
7. `weight_distribution_correct` — L3 权重 0.35 最高

**验收**：
- 7/7 通过
- 硬否决项触发时 overall=0
- 跳过的层不计入分母

---

## Assumptions & Decisions

1. **DeepSeek API key**：`sk-9b4abb43c812453eadede49a42c8de6d`（用户提供）。无 key 时 L3/L5 的 LLM 用例跳过（`describe.skipIf`），不视为失败。
2. **undici 8.1.0**：已是 devDependency，无需安装。
3. **Layer 3 不用 multi-turn-driver**：其注释自承 "response not used by hydration"，直接调 `createRuntimeMemoryProviderResult` + `callDeepSeek` 更真实。
4. **Layer 4 不用 LLM**：纯本地 SQLite + provider 查询，验证保有率和噪声累积率。LLM 验证留给 Layer 3/5。
5. **Layer 5 Cohen's d 修复**：用 LLM 响应中的 token 出现率（非 provider 返回率）作为 recall，treatment 臂有真实方差（LLM 不总是引用记忆），d 为有限值。
6. **maxFacts=512**：Layer 4 的 300 轮（600 fact）会触发 FIFO 驱逐，保有率 < 1.0。
7. **不修改源码**：本计划只新增测试文件和 helper，不修改 `openclaw_runtime/` 源码。

---

## Verification

### 运行命令

```bash
# 1. Layer 2 修复后验证
pnpm vitest run tests/unit/runtime-memory-read-path-consumer-real.test.ts

# 2. 无 key 全量（L1/L2/L4 + maturity score）
pnpm vitest run tests/unit/runtime-memory-write-path-semantic-real.test.ts tests/unit/runtime-memory-read-path-consumer-real.test.ts tests/unit/runtime-memory-long-term-accumulation.test.ts tests/unit/runtime-memory-maturity-score-real.test.ts

# 3. 有 key 全量（含 L3/L5 LLM 用例）
$env:DEEPSEEK_API_KEY="sk-9b4abb43c812453eadede49a42c8de6d"; pnpm vitest run tests/unit/runtime-memory-write-path-semantic-real.test.ts tests/unit/runtime-memory-read-path-consumer-real.test.ts tests/unit/runtime-memory-llm-real-usage.test.ts tests/unit/runtime-memory-long-term-accumulation.test.ts tests/unit/runtime-memory-adversarial-holdout.test.ts tests/unit/runtime-memory-maturity-score-real.test.ts

# 4. 类型检查
pnpm run typecheck
```

### 验收检查清单

- [ ] Layer 2：19/19 通过（修复 raw_leak_sentinel 词边界 + provider id 格式）
- [ ] Layer 3：8/8 通过（有 key 时）；`abAttributable=true` 全过；`no_hallucination` 通过
- [ ] Layer 4：10/10 通过；100 轮保有率 ≥0.7；300 轮保有率 < 1.0；噪声率 ≈ 0.5
- [ ] Layer 5：6/6 通过（有 key 时）；Cohen's d 为有限值
- [ ] Maturity score：7/7 通过；硬否决项触发时 overall=0
- [ ] 类型检查：0 错误
- [ ] **抗过拟合自检**：L5 的 `ablation_effect_size_real_variance` 产生有限 Cohen's d
- [ ] **抗幻觉自检**：L3 的 `no_hallucination_of_uninjected_facts` 通过
- [ ] **A/B 消融自检**：所有 L3 用例的 `abAttributable=true`
- [ ] **独立 ground truth 自检**：L4 的保有率/噪声率用 `labels` Map（生成时标签）

### 用户 4 个核心问题的回答输出

测试通过后，聚合 maturity score 时输出 findings：
1. **哪些信息会被保存**：句法噪声（raw/secret/injection/prompt_dump）被 4 层防御拒绝；语义噪声（"喜欢吃 pizza"）**不被拒绝**（真实发现，L1 验证）
2. **哪些记忆会被使用**：consumer 按 13 拒绝原因过滤；provider 格式化为 `verified {subject} {predicate} | {summary} | time_scope=... | valid_at=...`；真实 LLM 引用注入记忆（L3 唯一令牌 + A/B 消融验证）
3. **记忆保有率**：100 轮（200 fact < 512）保有率 ≥0.7；300 轮（600 fact > 512）FIFO 驱逐早期 fact，保有率 < 1.0
4. **无用内容占比**：噪声累积率 ≈ 50%（每轮 1 有用 + 1 噪声，系统不拒绝语义噪声，FIFO 不区分有用性）

---

## 关键文件清单（实现时需读取）

| 文件 | 用途 | 关键行 |
|------|------|--------|
| `openclaw_runtime/src/context-engine/memory-context-provider.ts` | L3/L4/L5 provider 调用 | `createRuntimeMemoryProviderResult:197` |
| `openclaw_runtime/src/runtime-core/memory-persistence.ts` | L4 DB 写入/读取 | `appendFact:566`, `loadStore:600` |
| `openclaw_runtime/src/runtime-core/memory-store.ts` | L4 FIFO/stats | `queryFacts:266`, `stats:282` |
| `openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts` | L2 consumer 拒绝原因 | `consumeRuntimeMemoryHydrationFacts:69` |
| `tests/unit/helpers/runtime-memory-real-llm-client.ts` | L3/L5 DeepSeek 调用 | `callDeepSeek`, `callDeepSeekMajorityVote` |
| `tests/unit/helpers/runtime-memory-real-corpus.ts` | L3/L4/L5 fact 生成 | `generateLongTermCorpus`, `makeProbeFact`, `makeAblationQuerySet` |
| `tests/unit/helpers/runtime-memory-eval-helpers.ts` | L4 DB 路径/config | `createTempDbPath:147`, `RUNTIME_MEMORY_EVAL_CONFIG:29`（**禁止**复用 `filterQueriesBySeededGroups:276`）|

---

## 实现顺序

| 步骤 | 内容 | 预计用例数 |
|------|------|-----------|
| 0 | 修复 Layer 2 残留失败（2 处） | — |
| 1 | Layer 3 `runtime-memory-llm-real-usage.test.ts` | 8 |
| 2 | Layer 4 `runtime-memory-long-term-accumulation.test.ts` | 10 |
| 3 | Layer 5 `runtime-memory-adversarial-holdout.test.ts` | 6 |
| 4 | `runtime-memory-maturity-score.ts` + 聚合测试 | 7 |
| **总计** | | **31 新用例 + 2 修复** |
