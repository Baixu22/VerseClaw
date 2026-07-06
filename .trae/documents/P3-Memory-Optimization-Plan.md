# P3 记忆系统优化计划：双轨改进方案

## 概述

在 P0（双轨记忆）+ P1（Justifier 重排）+ P2（时间独立检索路）已落地的基础上，
针对 Phase 6.1 评估后仍存在的两大瓶颈，规划两个独立的 P3 改进方向：

- **P3-A（输出端 + 抽取质量）**: Cross-Encoder 重排序（B）+ 结构化生成 Prompt（F）
- **P3-B（输入端 + 抽取密度）**: 减小 chunk 重抽取（D）+ 问题分解（C）

**预期目标**: J Score 从 ~49% → 55-60%，Recall@5 从 ~39% → 50%+，multi_hop 从 40.63% → 50%+。

---

## 当前状态分析

### 已完成阶段成果

| 阶段 | 改进 | J Score | temporal | multi_hop | single_hop | open_domain | Recall@5 |
|------|------|---------|----------|-----------|------------|-------------|----------|
| Phase 4.2 | 基线 | 39.80% | 32.00% | 40.63% | 45.67% | 42.52% | 44.76% |
| Phase 5.0 | +P0 双轨 | 48.00% | 32.67% | 40.63% | 53.54% | 66.14% | 44.90% |
| Phase 6.0 | +P2 时间路 | 49.20% | 40.67% | 40.63% | 55.91% | 59.06% | 39.28% |
| Phase 6.1 | +P1 Justifier | 运行中 | | | | | |

### 关键瓶颈（基于 Phase 6.0）

| 瓶颈 | 当前值 | 目标值 | 根因 | P3 解决方案 |
|------|--------|--------|------|-------------|
| multi_hop Recall@5 极低 | 17.32% | 50%+ | 链式检索失效（实体图稀疏 + 评分衰减过快） | **P3-B/C 问题分解** |
| Recall@5 回归 | 39.28% | 50%+ | 时间过滤器对非时间问题过严 + Justifier LLM 噪声 | **P3-A/B Cross-Encoder** |
| Fact 抽取密度低 | 0.3 facts/turn | 1.0+ | chunk=100 太大 + prompt 缺乏约束 | **P3-A/F + P3-B/D** |
| temporal 仍低于目标 | 40.67% | 55%+ | 相对时间转换仍有 ~40% 未覆盖 | P3 不直接解决（需 LLM 推理） |
| open_domain 回归 | 59.06% | 65%+ | 时间过滤器误伤非时间问题 | **P3-A/B Cross-Encoder 可间接修复** |

### 链式检索失效根因分析（来自代码审查）

`openclaw_runtime/src/runtime-core/memory-chained-retrieval.ts` 的 `chainedRetrievalExpand`：

1. **实体图稀疏**：fact 抽取仅 0.3 facts/turn，实体关系图大量断边，多跳桥接实体缺失
2. **评分衰减过快**：`expansionScore = 1 / (60 + expansionRank)` 产生 ~0.016 的扁平低分，
   永远排在初始命中之后（初始命中 RRF 分数 0.5-1.0）
3. **无问题感知**：扩展所有初始命中的所有实体，不区分问题实际询问的桥接实体
4. **初始检索依赖**：若桥接 fact 不在 top-10 初始命中中，链式检索无法启动

### 抽取 Prompt 缺陷分析（来自代码审查）

`openclaw_runtime/src/runtime-core/memory-extraction-prompt.ts`：

1. **单一 few-shot 示例**：仅 1 个 occupation 示例，缺乏对比样本
2. **无 schema 约束**：依赖 LLM 自觉返回 JSON，无结构化校验
3. **无负面示例**：未告知 LLM 什么不应抽取（如寒暄、语气词）
4. **chunk_size=100 过大**：100 turns 对话塞入单次 LLM 调用，LLM 倾向摘要而非抽取原子事实

---

## P3-A: Cross-Encoder 重排序 + 结构化抽取 Prompt

### 目标

- Recall@5 从 ~39% → 48%+（Cross-Encoder 比 Justifier LLM 更精准）
- Fact 抽取密度从 0.3 → 0.6+ facts/turn（结构化 prompt 约束）
- open_domain 回归修复（Cross-Encoder 不引入时间过滤器噪声）

### 步骤 P3-A-1: 新建 Cross-Encoder 重排模块

**新文件**: `tests/unit/helpers/cross-encoder-rerank.ts`

**设计决策**:
- 不依赖外部 ONNX runtime（避免原生模块依赖），改用 **SiliconFlow Cross-Encoder API**
  或 **DeepSeek pair-wise 评分**作为轻量替代
- 若 SiliconFlow 不提供 Cross-Encoder 端点，回退到 **DeepSeek pair-wise 模式**：
  每次 LLM 调用评分单个 (question, fact) 对，返回 0.0-1.0 分数
- 与 Justifier 的区别：Justifier 是 list-wise（一次评所有），Cross-Encoder 是 pair-wise（每对独立评），
  pair-wise 更精准但成本更高（N 次 LLM 调用 vs 1 次）

**实现要点**:
```ts
export type CrossEncoderCandidate = JustifierCandidate; // 复用类型

export type CrossEncoderResult = {
  scores: Map<string, { score: number; reason: string }>;
  skipped: boolean;
  fallback: boolean;
  /** pair-wise 调用次数（用于成本统计） */
  callCount: number;
};

export async function rerankWithCrossEncoder(
  question: string,
  candidates: ReadonlyArray<CrossEncoderCandidate>,
  options?: { keepOriginalN?: number; batchSize?: number },
): Promise<CrossEncoderResult>;
```

**Prompt 设计（pair-wise）**:
```
System: You are a relevance scorer. Given a question and a single fact,
rate the fact's relevance to answering the question on a scale of 0.0 to 1.0.
Return ONLY a JSON object: {"score": <0.0-1.0>, "reason": "<one sentence>"}

User:
Question: {question}
Fact: {subject} {predicate}: {objectSummary}
```

**与 Justifier 的关系**:
- **默认替换 Justifier**：Cross-Encoder 是 Justifier 的严格升级（pair-wise > list-wise）
- **保留 Justifier 代码**：作为 fallback，当 Cross-Encoder API 失败时回退
- **配置开关**：通过环境变量 `P3_RERANKER=cross-encoder|justifier|none` 控制

**成本控制**:
- top-10 候选 × pair-wise = 10 次 LLM 调用/问题
- 500 问题 × 10 调用 × 0.5s = ~42 分钟增量
- **优化**: 批量 pair-wise（单次调用评 5 对），将调用次数降至 2 次/问题

### 步骤 P3-A-2: 集成 Cross-Encoder 到 processQuestion

**文件**: `tests/unit/runtime-memory-locomo-full-500.test.ts`

**修改位置**: 现有 Justifier 调用块（约 line 842-879）

**伪代码**:
```ts
// P3-A: Cross-Encoder 重排（替换 Justifier）
if (finalHits.length > 5) {
  const reranker = process.env.P3_RERANKER ?? "cross-encoder";
  const candidates: CrossEncoderCandidate[] = finalHits.map(h => ({
    factId: h.fact.factId,
    subject: h.fact.subject,
    predicate: h.fact.predicate,
    objectSummary: h.fact.objectSummary,
    rrfScore: h.rrfScore,
  }));

  try {
    const result = reranker === "cross-encoder"
      ? await rerankWithCrossEncoder(qa.question, candidates)
      : await rerankWithJustifier(qa.question, candidates);
    if (!result.skipped) {
      finalHits = applyRerank(candidates, result).map(c =>
        hitById.get(c.factId)!).filter(Boolean);
    }
  } catch (err) {
    console.log(`[LoCoMo-Full] Rerank failed, using original order`);
  }
}
```

**注意**: `applyRerank` 函数已 shape-agnostic，无需修改。

### 步骤 P3-A-3: 结构化抽取 Prompt 增强

**文件**: `openclaw_runtime/src/runtime-core/memory-extraction-prompt.ts`

**修改内容**:

1. **扩展 `BASE_SYSTEM_PROMPT`**：增加 schema 约束 + 3 个对比 few-shot 示例
2. **新增 `CONTRASTIVE_EXAMPLES`**：展示什么不应抽取
3. **新增 `SCHEMA_CONSTRAINTS`**：明确 subject/predicate/objectSummary 字段约束

**修改后的 prompt 结构**:
```ts
const BASE_SYSTEM_PROMPT = [
  "You are a memory extraction system. Extract atomic, self-contained facts from the dialogue.",
  "Each fact must be a clear, standalone statement understandable WITHOUT original dialogue context.",
  "",
  "Schema constraints:",
  "- subject: A person's name (e.g., 'Alice', 'John'). Never use pronouns ('I', 'he', 'she').",
  "- predicate: A short verb phrase (e.g., 'started_job', 'enjoys_hobby', 'visited_place'). snake_case.",
  "- objectSummary: The fact content, including resolved absolute dates. Self-contained.",
  "- One fact per atomic piece of information. Split compound sentences.",
  "",
  "Focus on: personal info, preferences, events (with dates), relationships, plans, opinions.",
  "Use third-person perspective. Resolve relative time to absolute dates using session date.",
  "",
  "Examples:",
  '  {"subject": "Alice", "predicate": "occupation", "objectSummary": "works as a registered nurse at City Hospital"}',
  '  {"subject": "John", "predicate": "started_hobby", "objectSummary": "started learning surfing in March 2018"}',
  '  {"subject": "Bob", "predicate": "plan", "objectSummary": "plans to visit Japan in November 2023"}',
  "",
  "DO NOT extract:",
  '  - Greetings / small talk (e.g., "Hi, how are you?")',
  '  - Vague statements without specifics (e.g., "She likes music" → extract "enjoys classical piano music")',
  '  - Meta-commentary about the conversation itself',
  "",
  'Return ONLY a JSON array: [{"subject": string, "predicate": string, "objectSummary": string}]',
].join("\n");
```

**向后兼容**: 新 prompt 是旧 prompt 的超集，现有调用方无需修改。
`ExtractionPromptOptions` 类型不变。

### 步骤 P3-A-4: 单元测试

**新文件**: `tests/unit/cross-encoder-rerank.test.ts`

测试用例:
- `test_rerank_by_relevance`: 相关 fact 得高分，无关 fact 得低分
- `test_skip_when_few_candidates`: 候选 ≤ 5 时 skipped=true
- `test_pair_wise_independence`: 每个 fact 独立评分（不互相影响）
- `test_fallback_on_api_error`: API 失败时回退原顺序
- `test_batch_mode`: 批量 pair-wise 模式（5 对/调用）
- 真实 LLM 测试用 `describe.skipIf(!hasDeepSeekKey())` 包裹

### 步骤 P3-A-5: 运行 Phase 7.0 评估（仅 P3-A）

**配置**:
- `version`: `"7.0-full-500-p3-a-cross-encoder"`
- `retrievalMode`: 加入 "P3-A Cross-Encoder pair-wise rerank + structured extraction prompt"
- `P3_RERANKER=cross-encoder` 环境变量
- 超时: `7_200_000`（120 分钟，pair-wise 增加成本）
- **重要**: 需重新生成 `extracted-facts-cache.json`（因 prompt 改变），
  或使用 `--force-extract` 标志跳过缓存

---

## P3-B: 减小 Chunk 重抽取 + 问题分解

### 目标

- multi_hop J 从 40.63% → 50%+（问题分解替代失效的链式检索）
- multi_hop Recall@5 从 17.32% → 40%+（子问题独立检索）
- Fact 抽取密度从 0.3 → 0.8+ facts/turn（小 chunk + 高密度抽取）

### 步骤 P3-B-1: 问题分解模块

**新文件**: `tests/unit/helpers/question-decomposer.ts`

**功能**: 将 multi_hop 问题分解为 2-3 个子问题，每个子问题可独立检索

**实现要点**:
```ts
export type DecomposedQuestion = {
  original: string;
  subQuestions: string[];
  /** 子问题之间的逻辑关系（用于答案合并） */
  mergeStrategy: "intersection" | "chain" | "union";
};

export async function decomposeQuestion(
  question: string,
  options?: { maxSubQuestions?: number },
): Promise<DecomposedQuestion>;
```

**LLM Prompt 设计**:
```
System: You are a question decomposer for multi-hop reasoning.
Given a complex question that requires connecting multiple facts,
break it into 2-3 simpler sub-questions that can each be answered
by a single fact retrieval.

Rules:
- Each sub-question must be self-contained and answerable independently.
- Preserve entity names from the original question.
- If the question is already simple (single-hop), return it unchanged.
- Return ONLY a JSON object: {"subQuestions": ["q1", "q2", ...], "mergeStrategy": "chain"|"intersection"|"union"}

User:
Question: {question}

Decompose:
```

**示例**:
- "What did Alice do after she left her job at the hospital?" 
  → `["Where did Alice work before leaving?", "What did Alice do after leaving the hospital?"]`, merge: "chain"
- "Who did John go surfing with last summer?"
  → `["When did John go surfing last summer?", "Who accompanied John surfing?"]`, merge: "intersection"

**单跳问题处理**: 若 `isMultiHopQuestion(question)` 返回 false，直接返回原问题，
跳过 LLM 调用（成本优化）。

### 步骤 P3-B-2: 集成问题分解到 processQuestion

**文件**: `tests/unit/runtime-memory-locomo-full-500.test.ts`

**修改位置**: 现有 multi-hop 分支（约 line 815-828）

**当前代码**:
```ts
// line 815-828
let finalHits = hybridHits;
if (isMultiHopQuestion(qa.question)) {
  const expanded = chainedRetrievalExpand(
    hybridHits, relationMap, factsById,
    { maxDepth: 2, maxExpansion: 10 },
  );
  finalHits = expanded.hits.slice(0, 10);
}
```

**改为**:
```ts
let finalHits = hybridHits;
if (isMultiHopQuestion(qa.question)) {
  // P3-B: 问题分解替代链式检索
  try {
    const decomposed = await decomposeQuestion(qa.question);
    if (decomposed.subQuestions.length > 1) {
      const subHits: HybridSearchHit[] = [];
      for (const sq of decomposed.subQuestions) {
        const sqEmb = await embeddingProvider.embedQuery(sq);
        const sqRaw = index.searchWithEmbedding(
          sq, new Float32Array(sqEmb), 10, OPTIMAL_HYBRID_FUSION,
        );
        subHits.push(...sqRaw);
      }
      // RRF 合并子问题命中
      finalHits = mergeSubQuestionHits(subHits).slice(0, 10);
    } else {
      // 分解失败（返回原问题），回退到链式检索
      const expanded = chainedRetrievalExpand(
        hybridHits, relationMap, factsById,
        { maxDepth: 2, maxExpansion: 10 },
      );
      finalHits = expanded.hits.slice(0, 10);
    }
  } catch (err) {
    console.log(`[LoCoMo-Full] Decomposition failed, using chained retrieval`);
    const expanded = chainedRetrievalExpand(
      hybridHits, relationMap, factsById,
      { maxDepth: 2, maxExpansion: 10 },
    );
    finalHits = expanded.hits.slice(0, 10);
  }
}
```

**新增辅助函数 `mergeSubQuestionHits`**:
```ts
function mergeSubQuestionHits(hits: HybridSearchHit[]): HybridSearchHit[] {
  // 按 factId 聚合，RRF 合并（k=60）
  const byId = new Map<string, HybridSearchHit>();
  const rrfByFact = new Map<string, number>();
  const rankByFact = new Map<string, number[]>(); // 每个子问题的排名

  for (const hit of hits) {
    const id = hit.fact.factId;
    if (!byId.has(id)) byId.set(id, hit);
    // RRF 累加：1 / (60 + rank_in_subquery)
    // 简化：直接累加 rrfScore
    rrfByFact.set(id, (rrfByFact.get(id) ?? 0) + hit.rrfScore);
  }

  const merged = [...byId.values()].map(h => ({
    ...h,
    rrfScore: rrfByFact.get(h.fact.factId)!,
  }));
  return merged.sort((a, b) => b.rrfScore - a.rrfScore);
}
```

**与 P1/P3-A Justifier/Cross-Encoder 的协同**:
- 问题分解在检索前（扩大候选池）
- Cross-Encoder 在检索后（精排候选）
- 两者可叠加：分解 → 检索 → Cross-Encoder 精排

### 步骤 P3-B-3: 减小 Chunk 重抽取

**文件**: `tests/unit/runtime-memory-locomo-full-500.test.ts`

**修改位置**: `extractFactsFromConversation` 函数（约 line 235）

**当前**: `const CHUNK_SIZE = 100;`

**改为**: `const CHUNK_SIZE = 30;`（减小至 1/3）

**配套修改**:
1. **缓存键版本化**: 将 `FACTS_CACHE_PATH` 改为 `extracted-facts-cache-v2.json`
   （避免与旧缓存冲突）
2. **重新抽取**: 删除旧缓存或使用新路径，强制重新抽取
3. **成本估算**: 10 conversations × ~588 turns / 30 = ~196 chunks
   vs 原 10 × 588 / 100 = ~59 chunks
   增量 ~137 chunks × 0.5s = ~68 秒（一次性成本）

**预期收益**:
- 小 chunk 让 LLM 更聚焦，抽取密度从 0.3 → 0.8+ facts/turn
- 更精确的 sessionDate 归属（小 chunk 跨会话概率更低）
- 实体图更密集，间接改善链式检索（作为 fallback 仍有价值）

### 步骤 P3-B-4: 单元测试

**新文件**: `tests/unit/question-decomposer.test.ts`

测试用例:
- `test_decompose_multi_hop`: 多跳问题分解为 2-3 子问题
- `test_skip_single_hop`: 单跳问题返回原问题，无 LLM 调用
- `test_merge_strategy`: 验证 mergeStrategy 字段正确返回
- `test_fallback_on_parse_error`: JSON 解析失败时返回原问题
- `test_max_sub_questions`: 限制子问题数量
- 真实 LLM 测试用 `describe.skipIf(!hasDeepSeekKey())` 包裹

### 步骤 P3-B-5: 运行 Phase 7.1 评估（仅 P3-B）

**配置**:
- `version`: `"7.1-full-500-p3-b-decompose-rechunk"`
- `retrievalMode`: 加入 "P3-B question decomposition + reduced chunk (30 turns) re-extraction"
- 超时: `6_000_000`（100 分钟，问题分解增加 LLM 调用）
- **重要**: 需重新生成 `extracted-facts-cache-v2.json`

---

## 联合评估 Phase 8.0

若 P3-A 和 P3-B 独立评估均有效，运行联合评估：

**配置**:
- `version`: `"8.0-full-500-p3-combined"`
- `retrievalMode`: "P0 Dual-Track + P1/P3-A Cross-Encoder + P2 Temporal + P3-B Decomposition + Re-extraction"
- 超时: `8_400_000`（140 分钟）

---

## 实施顺序

### 阶段 1: P3-A 独立验证（输出端改进）

1. **P3-A-1**: 新建 cross-encoder-rerank.ts（含 batch pair-wise 优化）
2. **P3-A-2**: 集成到 processQuestion（环境变量开关）
3. **P3-A-3**: 结构化抽取 prompt 增强
4. **P3-A-4**: 单元测试
5. **P3-A-5**: 运行 Phase 7.0 评估（仅 P3-A，cross-encoder + 新 prompt + 重抽取）

### 阶段 2: P3-B 独立验证（输入端改进）

6. **P3-B-1**: 新建 question-decomposer.ts
7. **P3-B-2**: 集成到 processQuestion（替代链式检索）
8. **P3-B-3**: 减小 chunk 重抽取（缓存版本化）
9. **P3-B-4**: 单元测试
10. **P3-B-5**: 运行 Phase 7.1 评估（仅 P3-B，分解 + 重抽取）

### 阶段 3: 联合验证

11. **Phase 8.0**: P3-A + P3-B 联合评估
12. **分析报告**: 对比 Phase 6.1 → 7.0 → 7.1 → 8.0

**分阶段评估的原因**: 避免变量混淆，独立验证每个改进的边际收益。

---

## 假设与决策

### 假设

1. **SiliconFlow/DeepSeek 支持 pair-wise**: 若 SiliconFlow 无 Cross-Encoder 端点，
   回退到 DeepSeek pair-wise 模式（N 次 LLM 调用）。成本可控因 batch 优化。
2. **问题分解覆盖 multi_hop 80%+**: 假设 LLM 能正确分解大多数多跳问题。
   若覆盖率 < 50%，回退到链式检索。
3. **小 chunk 不引入噪声**: 假设 chunk=30 不会让 LLM 抽取过多碎片化 fact。
   若 fact 质量下降，回调至 chunk=50。
4. **Cross-Encoder 优于 Justifier**: pair-wise 比 list-wise 更精准，
   预期 Recall@5 提升 5-10pp。若提升 < 2pp，回退到 Justifier。

### 决策

1. **P3-A 优先于 P3-B**: P3-A 是输出端改进，风险更低（不改变检索候选池）。
   P3-B 改变输入端（问题分解）和抽取端（重抽取），影响面更大。
2. **保留链式检索作为 fallback**: 不删除 `chainedRetrievalExpand`，
   当问题分解失败时回退。未来可完全替换。
3. **缓存版本化**: 新 chunk size 需新缓存文件，避免与旧缓存冲突。
   `extracted-facts-cache-v2.json`。
4. **Cross-Encoder 与 Justifier 并存**: 通过环境变量切换，不删除 Justifier 代码。
   便于 A/B 对比。
5. **问题分解仅用于 multi_hop**: 单跳问题不分解，避免不必要的 LLM 调用。
6. **不修改 HybridSearchIndex 核心逻辑**: Cross-Encoder 作为后处理层插入，
   不侵入检索核心，降低风险。

---

## 验收标准

| 指标 | Phase 6.1 (P1+P2) | Phase 7.0 (P3-A) | Phase 7.1 (P3-B) | Phase 8.0 (联合) | 目标 |
|------|-------------------|-------------------|-------------------|------------------|------|
| Overall J | ~49% | ≥ 52% | ≥ 53% | ≥ 55% | ≥ 55% |
| temporal | ~41% | ≥ 42% | ≥ 45% | ≥ 50% | ≥ 55% |
| multi_hop | 40.63% | ≥ 42% | ≥ 50% | ≥ 52% | ≥ 50% |
| single_hop | ~56% | ≥ 58% | ≥ 58% | ≥ 60% | ≥ 60% |
| open_domain | ~59% | ≥ 63% | ≥ 60% | ≥ 65% | ≥ 50% ✅ |
| Recall@5 | ~39% | ≥ 45% | ≥ 42% | ≥ 50% | ≥ 60% |
| Fact 密度 | 0.3/turn | ≥ 0.6/turn | ≥ 0.8/turn | ≥ 0.8/turn | ≥ 1.0/turn |

**Phase 7.0 (P3-A) 验收**: Recall@5 从 ~39% → 45%+（Cross-Encoder 精排生效），
open_domain 回归修复至 63%+。

**Phase 7.1 (P3-B) 验收**: multi_hop J 从 40.63% → 50%+（问题分解替代链式检索），
Fact 密度从 0.3 → 0.8+/turn。

**Phase 8.0 (联合) 验收**: Overall J ≥ 55%，达到任务目标。
若 < 55% 但 > 52%，输出 top-5 失败案例供 P4 决策。

---

## 验证步骤

1. **单元测试全通过**:
   - `pnpm exec vitest run tests/unit/cross-encoder-rerank.test.ts`
   - `pnpm exec vitest run tests/unit/question-decomposer.test.ts`
   - `pnpm exec vitest run tests/unit/episodic-memory.test.ts`（回归）
   - `pnpm exec vitest run tests/unit/justifier-rerank.test.ts`（回归）

2. **Typecheck 通过**: `pnpm run typecheck`

3. **Phase 7.0 评估运行**:
   ```powershell
   $env:RUNTIME_MEMORY_REAL_LLM="1"
   $env:DEEPSEEK_API_KEY="sk-..."
   $env:SILICONFLOW_API_KEY="sk-..."
   $env:P3_RERANKER="cross-encoder"
   pnpm run eval:runtime-memory:locomo:full500
   ```
   验证报告 `artifacts/runtime-memory-eval/locomo-full-500-report.json`:
   - `version` = `"7.0-full-500-p3-a-cross-encoder"`
   - Recall@5 ≥ 45%, open_domain J ≥ 63%

4. **Phase 7.1 评估运行**:
   ```powershell
   # 先删除旧缓存或使用新缓存路径
   Remove-Item tests\fixtures\locomo\extracted-facts-cache.json -ErrorAction SilentlyContinue
   $env:P3_RERANKER="justifier"  # P3-B 不测 Cross-Encoder
   $env:RUNTIME_MEMORY_REAL_LLM="1"
   pnpm run eval:runtime-memory:locomo:full500
   ```
   验证: multi_hop J ≥ 50%, Fact 密度 ≥ 0.8/turn

5. **Phase 8.0 联合评估**:
   ```powershell
   $env:P3_RERANKER="cross-encoder"
   $env:RUNTIME_MEMORY_REAL_LLM="1"
   pnpm run eval:runtime-memory:locomo:full500
   ```
   验证: Overall J ≥ 55%

6. **若未达标**: 输出每类别 delta + top-10 失败案例，
   分析失败模式供 P4 决策。

---

## 文件清单

### 新增文件
- `tests/unit/helpers/cross-encoder-rerank.ts` — Cross-Encoder pair-wise 重排模块
- `tests/unit/helpers/question-decomposer.ts` — 多跳问题分解模块
- `tests/unit/cross-encoder-rerank.test.ts` — 单元测试
- `tests/unit/question-decomposer.test.ts` — 单元测试

### 修改文件
- `openclaw_runtime/src/runtime-core/memory-extraction-prompt.ts` — 结构化 prompt 增强
- `tests/unit/runtime-memory-locomo-full-500.test.ts` — 集成 P3-A + P3-B，更新版本号/超时/缓存路径

### 不修改文件
- `openclaw_runtime/src/runtime-core/memory-chained-retrieval.ts` — 保留作为 fallback
- `openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts` — 检索核心不变
- `tests/unit/helpers/justifier-rerank.ts` — 保留作为 fallback reranker
- `tests/unit/helpers/episodic-memory.ts` — P0/P2 改动保持不变
- `tests/unit/helpers/query-time-extractor.ts` — P2 改动保持不变

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Cross-Encoder pair-wise 成本过高 | 中 | 评估时间 +60 分钟 | batch 模式（5 对/调用）+ 候选数 ≤ 10 |
| 问题分解引入噪声（同 MultiQuery 失败） | 中 | multi_hop J 回归 | 仅 multi_hop 触发 + 分解失败回退链式 |
| 小 chunk 抽取质量下降 | 低 | Fact 碎片化 | 缓存版本化 + 可回调 chunk=50 |
| DeepSeek API 限流 | 中 | 评估中断 | withRetry + 退避 + batch 优化 |
| 缓存冲突 | 低 | 使用旧 fact | 缓存文件版本化（v2.json） |
