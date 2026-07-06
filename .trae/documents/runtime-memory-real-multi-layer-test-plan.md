# 运行时记忆系统：抗过拟合多层次真实测试方案

## Context（为什么做这件事）

当前记忆系统评测套件存在严重过拟合问题，已由 3 个 Explore agent 审计确认：

1. **循环验证**：`tests/fixtures/runtime-memory-benefit-eval/generate.mjs` 按 consumer 的 13 个拒绝轴反向构造 fact 家族，`expectedFactIds` 永远指向 `useful` fact（consumer 设计要返回的那条），recall=1.0 是构造出来的不是测出来的。
2. **空壳 LLM**：`multi-turn-driver.ts:152-153` 注释明文 "response not used by hydration"。所谓"treatment 验证记忆被使用"实际只验证 consumer 返回了预期 fact，与 LLM 无关。
3. **Cohen's d=Infinity**：空 DB（recall=0）vs 完美匹配 DB（recall=1）→ 零方差 → d=Infinity → minimumSampleSize=1 → 平凡通过。
4. **指标操纵**：`filterQueriesBySeededGroups`（`helpers:276`）注释自承"丢弃 recall=0 的 query 以免削弱 Cohen's d"。
5. **无真实 LLM 调用**：42 个测试文件零网络调用。
6. **无 >30 轮累积测试**：最长 30 轮，无 100+ 轮留存。
7. **无语义噪声拒绝测试**：只测句法/结构噪声，未测"格式合法但语义无用"的 fact。

用户明确要求："避免过拟合""避免幻觉影响评分""多层次验证""真正意义上测试记忆系统"，并要回答 4 个核心问题：哪些信息会被保存、哪些记忆会被使用在长对话中、记忆的保有率、长期使用后沉淀的内容有多少是无用内容。

**架构现状**（已验证）：
- 记忆系统是 shadow-only 架构，4 个 flag 全默认 false
- WRITE 路径：`task-loop-controller.ts` 只写 episode（不写 fact）；fact 仅由 eval harness 写入。4 层防御：proposal shadow 输入校验 → `rejectRawRuntimeMemoryInput`（11 个正则）→ 字段级 sanitize → persistence 入口再扫一次
- READ 路径有两条独立路径：
  - consumer 路径 `consumeRuntimeMemoryHydrationFacts`（`memory-read-hydration-consumer.ts:69`）：13 个拒绝原因 + conflict winner
  - provider 路径 `createRuntimeMemoryProviderResult`（`memory-context-provider.ts:197`）：不检查 flag，可直接调，返回 `contextItems[].text`
- 无 TTL、无主动 GC。FIFO 裁剪（maxFacts=512, maxEpisodes=256）。失效 fact 不删除，打 `invalid_at` 保留。

**预期结果**：产出一套不幻觉的真实测试，回答 4 个核心问题，并给出有真实方差、有 A/B 消融、有独立 ground truth 的成熟度评分。

---

## 抗过拟合与抗幻觉原则（必须遵守）

### 抗过拟合
1. **禁止循环验证**：ground truth 必须来自独立来源（真实 LLM 行为、人工锚点、生成时标签），不能用 consumer 的设计目标
2. **禁止指标操纵**：不能丢弃低 recall query 来抬高 Cohen's d。recall=0 的 query 保留并计入分母
3. **禁止模板 fixture**：测试场景来自 3 个不同领域（编程/旅行/调试），不能用现有 8 个 category 模板
4. **禁止复用 `filterQueriesBySeededGroups`**（`helpers:276`）

### 抗幻觉
1. **唯一令牌探针**：用 LLM 绝不可能自己生成的 token（如 `Zyxqlwbr-7341`）作为 fact 的 objectSummary，验证响应中出现该 token
2. **A/B 消融**：同一 query，有记忆 vs 无记忆，响应差异必须可归因于记忆（A 含 token 且 B 不含 token）
3. **负向断言**：验证 LLM 不引用未注入的 fact（无幻觉）
4. **多 judge 投票**：关键评分用多次 LLM 调用投票（temperature=0.3），不用单次

---

## 测试文件结构

| 文件 | 职责 | 用例数 |
|------|------|--------|
| `tests/unit/helpers/runtime-memory-real-llm-client.ts` | DeepSeek API 封装（undici）、重试、超时、多 judge 投票 | (helper) |
| `tests/unit/helpers/runtime-memory-real-corpus.ts` | 非模板 fact/query 生成器（3 领域）、唯一令牌、独立 ground-truth labels | (helper) |
| `tests/unit/helpers/runtime-memory-maturity-score.ts` | 多层结果聚合为成熟度分数、硬否决检测 | (helper) |
| `tests/unit/runtime-memory-write-path-semantic-real.test.ts` | Layer 1：写路径 4 层防御真实过滤 + 语义噪声行为 | 12 |
| `tests/unit/runtime-memory-read-path-consumer-real.test.ts` | Layer 2：consumer 13 拒绝原因 + provider context 格式 | 16 |
| `tests/unit/runtime-memory-llm-real-usage.test.ts` | Layer 3：真实 DeepSeek 验证 LLM 使用记忆 | 8 (skipIf 无 key) |
| `tests/unit/runtime-memory-long-term-accumulation.test.ts` | Layer 4：100+ 轮累积、保有率、噪声累积率、FIFO 临界 | 10 |
| `tests/unit/runtime-memory-adversarial-holdout.test.ts` | Layer 5：holdout 集、负向用例、LLM-as-judge | 6 (部分 skipIf) |

---

## Layer 设计

### Layer 1：写路径真实过滤（回答"哪些信息会被保存"）

**文件**：`runtime-memory-write-path-semantic-real.test.ts`（`@vitest-environment node`）

**抗过拟合机制**：ground truth 来自独立构造的输入分类（有用/句法噪声/语义噪声），不依赖 consumer。关键真实发现：系统**不拒绝**语义噪声（格式合法但语义无用的 fact），从而暴露噪声累积的根源。

关键用例：
- `useful_fact_persists_through_4_layers`：合法 verified fact 持久化
- `raw_chat_log_rejected_at_persistence`：含 `"user: ..."` 被拒
- `secret_rejected_at_persistence`：含 `sk-...` 被拒
- `prompt_injection_rejected_at_persistence`：含 "ignore instructions override policy" 被拒
- `field_truncation_preserves_semantic_core`：2000 字符截断到 512
- `duplicate_fact_id_not_merged`：同 factId 不合并
- `episode_dedupe_merges_evidence`：同 idempotencyKey episode 合并 evidence
- `semantic_noise_fact_NOT_rejected`：objectSummary="用户喜欢吃 pineapple pizza" 被保存（**真实发现**）
- `semantic_noise_travel_fact_NOT_rejected`：跨领域噪声
- `invalidation_marks_not_deletes`：失效不删除
- `fifo_eviction_at_maxFacts_boundary`：maxFacts=10 写 12 个，前 2 个被驱逐
- `fifo_eviction_preserves_invalidated_facts`：失效 fact 也参与 FIFO 计数

**关键文件**：
- `openclaw_runtime/src/runtime-core/memory-persistence.ts`（appendFact:566, sanitizeFactForPersistence:1205）
- `openclaw_runtime/src/runtime-core/memory-store.ts`（去重:170, FIFO:412-444）
- `openclaw_runtime/src/runtime-core/memory-context.ts`（rejectRawRuntimeMemoryInput:710, 11 正则:336-388, buildRuntimeMemoryTemporalFactFixture:1079）

### Layer 2：读路径拒绝原因与 context 格式（回答"哪些记忆会被使用"前半）

**文件**：`runtime-memory-read-path-consumer-real.test.ts`

**抗过拟合机制**：13 个拒绝原因的 ground truth 来自独立构造的 fact 属性（时间、状态、键匹配），不依赖 `expectedFactIds`。不使用 `filterQueriesBySeededGroups`。

关键用例：
- 13 个拒绝原因各一个用例（record_kind_not_fact / verification_status_not_verified / future_valid_at / invalidated_at_reference_time / expired_at_reference_time / task_mismatch / subject_mismatch / predicate_mismatch / prompt_injection_sentinel / raw_leak_sentinel / conflicting_fact / token_budget_exceeded / limit_exceeded）
- `conflicting_fact_keeps_highest_confidence`：3 个冲突 fact，winner=confidence 最高
- `conflict_tiebreak_by_valid_at`：同 confidence，winner=valid_at 最大
- `provider_context_format_parseable_by_llm`：contextItems[].text 匹配正则 `verified .+ \| .+ \| time_scope=.+ \| valid_at=\d+`
- `provider_filters_non_accepted_verification_by_default`：candidate + verified，只返回 verified

**关键文件**：
- `openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts`（13 拒绝原因:15-28, rejectionReasonBeforeConflict:135-173, compareFactRank:195-212）
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`（createRuntimeMemoryProviderResult:197, contextText:515）

### Layer 3：LLM 真实使用记忆（回答"哪些记忆会被使用在长对话中"核心）

**文件**：`runtime-memory-llm-real-usage.test.ts`（`@vitest-environment node`，`describe.skipIf(!process.env.DEEPSEEK_API_KEY)`）

**抗幻觉机制**：唯一令牌探针 + A/B 消融 + 负向断言 + 多 judge 投票。

#### 拿 context 的方式（方案 A，绕过 multi-turn-driver）

```ts
import { createRuntimeMemoryProviderResult } from
  "../../openclaw_runtime/src/context-engine/memory-context-provider";

async function getMemoryContext(
  facts: readonly RuntimeMemoryQueryableFact[],
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
```

#### prompt 模板

```ts
function buildProbePrompt(memoryContextText: string, userQuestion: string): {
  system: string;
  user: string;
} {
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
```

唯一令牌设计：`Zyxqlwbr-7341`（大小写混合 + 数字 + 连字符，非英文单词，LLM 训练数据中不存在，不匹配 12 个 raw input 正则）。

#### DeepSeek API 封装（`runtime-memory-real-llm-client.ts`）

```ts
import { request } from "undici";

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export async function callDeepSeek(
  system: string,
  user: string,
  options?: { temperature?: number },
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; attempts: number }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");
  // 重试逻辑：5xx + ECONNRESET/ETIMEDOUT/AbortError 重试 3 次，指数退避 500ms×attempt
  // 4xx 立即抛出
  // ...
}
```

#### 响应验证逻辑

```ts
type ProbeResult = {
  tokenPresent: boolean;       // A 臂响应含目标 token
  negativeClean: boolean;      // A 臂响应不含未注入 token
  abAttributable: boolean;     // A 含 token 且 B 不含 token
  abDetails: { withMemory: string; withoutMemory: string };
};

async function runTokenProbe(
  facts, query, targetToken, negativeTokens, userQuestion,
): Promise<ProbeResult> {
  const memoryText = await getMemoryContext(facts, query);
  const promptA = buildProbePrompt(memoryText, userQuestion);
  const resA = await callDeepSeek(promptA.system, promptA.user);
  const promptB = buildProbePrompt("", userQuestion);
  const resB = await callDeepSeek(promptB.system, promptB.user);
  const tokenPresent = resA.content.includes(targetToken);
  const negativeClean = negativeTokens.every((t) => !resA.content.includes(t));
  const abAttributable = tokenPresent && !resB.content.includes(targetToken);
  return { tokenPresent, negativeClean, abAttributable, abDetails: { withMemory: resA.content, withoutMemory: resB.content } };
}
```

关键用例：
- `single_fact_recall_token_probe`：1 fact 含 `Zyxqlwbr-7341`，A/B 消融成立
- `multi_fact_recall_3_of_5`：5 fact 各含不同唯一 token，查 3 个，A 臂含 ≥2 个目标 token，不含未匹配的 2 个
- `invalidation_isolation`：1 有效（tokenValid）+ 1 失效（tokenInvalid），A 臂含 tokenValid 不含 tokenInvalid
- `task_isolation`：1 taskId 匹配（tokenA）+ 1 不匹配（tokenB），响应含 tokenA 不含 tokenB
- `conflict_winner_used`：2 冲突 fact（tokenOld conf=0.5, tokenNew conf=0.9），响应含 tokenNew 不含 tokenOld
- `token_budget_truncation_still_usable`：tokenBudget=64，截断后仍含 token
- `no_hallucination_of_uninjected_facts`：注入 tokenReal，prompt 提到 tokenFake，响应含 tokenReal 不含 tokenFake
- `multi_judge_vote_consistency`：同 query 调 3 次，≥2/3 含 token

### Layer 4：长期累积仿真（回答"保有率"和"无用内容占比"）

**文件**：`runtime-memory-long-term-accumulation.test.ts`（`@vitest-environment node`）

#### 100+ 轮对话生成（`runtime-memory-real-corpus.ts`）

3 个领域，每轮 1 有用 + 1 噪声 fact，跨领域轮转：

```ts
const DOMAINS = {
  programming: {
    subject: "DevPreference",
    predicates: ["package_manager", "test_framework", "lint_rule", "commit_style",
                 "error_handling", "logging_lib", "ci_platform", "deploy_target"],
    usefulSummaries: ["User project uses pnpm as package manager", ...],
    noiseSummaries: ["User likes pineapple on pizza", "User's cat is named Mittens", ...],
  },
  travel: { subject: "TravelProfile", predicates: [...], ... },
  debugging: { subject: "DebugContext", predicates: [...], ... },
};

export function generateLongTermCorpus(turns: number, seed = 42): {
  facts: RuntimeMemoryTemporalFact[];
  labels: Map<string, "useful" | "noise">;  // 独立 ground truth
  writeOrder: string[];
  domainByFactId: Map<string, string>;
} { /* 每轮 1 有用 + 1 噪声，跨领域轮转 */ }
```

#### 保有率定义

```ts
// 保有率 = (第 N 轮后仍能被 provider 返回的早期有用 fact 数) / (写入的早期有用 fact 数)
// ground truth 是 factId 集合，非 expectedFactIds
async function measureRetention(dbPath, earlyTurnRange, totalTurns, labels): Promise<{
  retentionRate: number; retained: string[]; lost: string[];
}> { /* 对每个早期有用 fact，用 provider 查询是否仍被返回 */ }
```

理论值（用于断言）：
- 200 fact（100 轮×2）< maxFacts=512：无 FIFO 驱逐，保有率应 = 1.0
- 600 fact（300 轮×2）> maxFacts=512：FIFO 驱逐前 88 个，早期保有率 < 1.0

#### 噪声累积率定义

```ts
// 噪声累积率 = DB 中噪声 fact 数 / DB 中总 fact 数
// ground truth 来自生成时 labels
function measureNoiseAccumulation(dbPath, labels): {
  noiseRate: number; noiseCount: number; totalCount: number;
} { /* 按 labels 统计 */ }
// 断言：noiseRate ≈ 0.5（每轮 1 有用 + 1 噪声）
// 真实发现：系统不拒绝语义噪声，噪声与有用 fact 等比例累积
```

关键用例：
- `retention_after_100_turns_programming`：100 轮 200 fact，保有率 ≥0.7（无 FIFO）
- `retention_after_300_turns_mixed_domains`：300 轮 600 fact，保有率与 FIFO 理论值一致
- `noise_accumulation_rate_100_turns`：噪声占比 ≈ 50%
- `noise_accumulation_rate_300_turns`：噪声占比仍 ≈ 50%
- `fifo_eviction_critical_point`：512 + 50 fact，DB 中只有后 512 个
- `fifo_eviction_does_not_prioritize_useful`：FIFO 按写入顺序，不按有用性
- `topic_drift_recall_decay`：前 50 轮编程 + 后 50 轮旅行，编程 fact 仍可查
- `invalidation_accumulation`：20% fact 失效后仍占空间
- `episode_retention_vs_fact_retention`：双 FIFO 独立裁剪
- `long_term_no_active_gc`：100 轮后无 TTL/GC

### Layer 5：对抗性与 holdout（交叉验证）

**文件**：`runtime-memory-adversarial-holdout.test.ts`（`@vitest-environment node`，部分 skipIf）

关键用例：
- `holdout_domain_not_in_template`：用"医疗健康"领域（非 8 category），含唯一 token
- `holdout_obscure_subject_predicate`：subject="量子计算偏好"，predicate="退相干阈值"
- `negative_unrelated_query_returns_empty`：编程 fact + 旅行 query，返回空
- `llm_judge_validates_attribution`：judge prompt 独立判断"响应是否可归因于记忆"
- `llm_judge_catches_hallucination`：无记忆 prompt 但问 token，judge 判断凭空
- `ablation_effect_size_real_variance`：20 query A/B，Cohen's d 为有限值（修复 d=Infinity）

---

## 评分方案（`runtime-memory-maturity-score.ts`）

```ts
export type LayerScore = {
  layer: 1 | 2 | 3 | 4 | 5;
  passed: number;
  total: number;
  rate: number;
  weight: number;
  failures: string[];
  independentGroundTruth: boolean;
  ablationVerified: boolean;
};

export type MaturityScore = {
  overall: number;              // 0-100
  layers: LayerScore[];
  disqualifiers: {
    circularValidation: boolean;
    metricManipulation: boolean;
    hollowLlm: boolean;
    cohenDInfinity: boolean;
  };
  findings: string[];           // 真实发现，不粉饰
};
```

**评分原则**：
- 任一硬否决项触发 → overall=0（宁可零分也不幻觉通过）
- Layer 3（真实 LLM）权重 0.35 最高（"记忆真的被使用"的唯一证据）
- 权重：Layer 1: 0.15, Layer 2: 0.15, Layer 3: 0.35, Layer 4: 0.20, Layer 5: 0.15
- 真实发现（如"语义噪声未被拒绝，100 轮后噪声占比 50%"）写入 findings，不掩盖也不否决
- 不用 Cohen's d 作为通过门槛，改用"探针通过率"（token 出现率 + A/B 归因率）

---

## 实现顺序与验收标准

| 步骤 | 内容 | 验收标准 |
|------|------|---------|
| **1** | `runtime-memory-real-llm-client.ts` | `callDeepSeek` 调通返回 content；无 key 抛错；5xx 重试 |
| **2** | `runtime-memory-real-corpus.ts` | `generateLongTermCorpus(100)` 生成 200 fact，3 领域均衡，labels 正确 |
| **3** | Layer 1（`write-path-semantic-real.test.ts`） | 12 用例全过；`semantic_noise_fact_NOT_rejected` 如实记录系统不拒绝语义噪声 |
| **4** | Layer 2（`read-path-consumer-real.test.ts`） | 16 用例全过；13 拒绝原因各覆盖；不用 `filterQueriesBySeededGroups` |
| **5** | Layer 3（`llm-real-usage.test.ts`） | 8 用例在 key 存在时全过；`abAttributable=true`；无 key 时 suite 跳过 |
| **6** | Layer 4（`long-term-accumulation.test.ts`） | 10 用例全过；100 轮保有率≥0.7；300 轮与 FIFO 理论值一致；噪声率≈0.5 |
| **7** | Layer 5（`adversarial-holdout.test.ts`） | 6 用例全过；`ablation_effect_size_real_variance` 的 Cohen's d 为有限值 |
| **8** | `runtime-memory-maturity-score.ts` + 聚合测试 | 正确聚合 5 层；disqualifier 检测有效；无 key 时 overall 不为 0（LLM 层跳过非失败） |

**关键验收原则**：
- Layer 1 的 `semantic_noise_fact_NOT_rejected`：断言 `persisted:true`，如实记录系统无语义过滤
- Layer 3 的 LLM 测试：必须验证 `abAttributable=true`（A 含 token 且 B 不含），不能只验证 `tokenPresent`
- Layer 5 的 `ablation_effect_size_real_variance`：用 20 个真实 query（非空 DB vs 部分 DB），产生真实方差，修复 d=Infinity
- 全程**禁止**使用 `filterQueriesBySeededGroups`

---

## 用户 4 个核心问题的回答映射

| 用户问题 | 由哪个 Layer 回答 | 如何回答 |
|---------|------------------|---------|
| 1. 哪些信息会被保存 | Layer 1 | 4 层防御真实过滤：句法噪声（raw/secret/injection）被拒；语义噪声（"喜欢吃 pizza"）**不被拒**（真实发现）；有用 fact 持久化；去重与 FIFO 行为 |
| 2. 哪些记忆会被使用在长对话中 | Layer 2 + 3 | Layer 2 测 consumer 13 拒绝原因 + provider 格式；Layer 3 用真实 DeepSeek 验证 LLM 引用注入记忆（唯一令牌 + A/B 消融） |
| 3. 记忆的保有率 | Layer 4 | 100/300 轮后查早期 fact，保有率 = provider 返回数 / 写入数；ground truth 是 factId 集合 |
| 4. 无用内容占比 | Layer 4 | 噪声累积率 = DB 中噪声 fact / 总 fact；ground truth 是生成时 labels；真实发现 ≈50% |

---

## Verification（如何验证测试本身有效）

1. **抗过拟合自检**：Layer 5 的 `ablation_effect_size_real_variance` 必须 produce 有限 Cohen's d（非 Infinity）。如果仍是 Infinity，说明测试设计仍有过拟合。
2. **抗幻觉自检**：Layer 3 的 `no_hallucination_of_uninjected_facts` 必须通过。如果失败，说明 LLM 在幻觉，评分不可信。
3. **A/B 消融自检**：所有 Layer 3 用例的 `abAttributable` 必须为 true。如果为 false，说明记忆未被真正使用。
4. **独立 ground truth 自检**：Layer 4 的保有率/噪声率计算必须用 `labels` Map（生成时标签），不能用 consumer 判断。
5. **运行命令**：
   - 无 key：`pnpm vitest run tests/unit/runtime-memory-write-path-semantic-real.test.ts tests/unit/runtime-memory-read-path-consumer-real.test.ts tests/unit/runtime-memory-long-term-accumulation.test.ts`
   - 有 key：`$env:DEEPSEEK_API_KEY="sk-9b4abb43c812453eadede49a42c8de6d"; pnpm vitest run tests/unit/runtime-memory-llm-real-usage.test.ts tests/unit/runtime-memory-adversarial-holdout.test.ts`
   - 全量：`pnpm vitest run tests/unit/runtime-memory-*-real.test.ts`
   - 类型检查：`pnpm run typecheck`

---

## 关键文件清单（实现时需读取）

- `openclaw_runtime/src/context-engine/memory-context-provider.ts`（createRuntimeMemoryProviderResult:197, contextText:515）
- `openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts`（13 拒绝原因:15-28, compareFactRank:195-212）
- `openclaw_runtime/src/runtime-core/memory-persistence.ts`（appendFact:566, sanitizeFactForPersistence:1205, FIFO trimRows:1333）
- `openclaw_runtime/src/runtime-core/memory-store.ts`（去重:170, FIFO:412-444, factsWithInvalidations:306）
- `openclaw_runtime/src/runtime-core/memory-context.ts`（rejectRawRuntimeMemoryInput:710, 11 正则:336-388, buildRuntimeMemoryTemporalFactFixture:1079）
- `tests/unit/helpers/runtime-memory-eval-helpers.ts`（createTempDbPath, seedTempDb, RUNTIME_MEMORY_EVAL_CONFIG 参考；**禁止**复用 filterQueriesBySeededGroups:276）
