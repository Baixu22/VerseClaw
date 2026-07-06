# 北极星文档：Query-Aware Adaptive Retrieval Loop

> **文档性质**：北极星规格（Northstar Spec）。定义"为了解决四家共同短板而差异化"的完整架构、接口、验收标准。
>
> **维护规则**：
> - 本文档是 `mem-status.md` 的上位规划，`mem-status.md` 记录执行状态，本文档记录设计规格。
> - 任何代码实现必须与本文档接口签名一致；接口变更必须先更新本文档。
> - 长对话后如出现信息精度丢失，以本文档为准。
> - 每个 Phase 的"验收标准"章节是不可妥协的硬门槛。

---

## 0. 战略定位

### 0.1 为什么不是抄架构

四家（Hindsight/Mem0/Memobase/Zep）的 SOTA 来自各自独有的架构组件：
- Hindsight：Observation 合成层 + Memory Graph 因果边 + Mental Model + 分层 Reflect
- Mem0 Platform V3：异步事件轮询 + ADDITIVE 抽取 + entity boost
- Memobase：双视角插入 + Profile merge 控制器 + event 窗口
- Zep/Graphiti：Temporal Knowledge Graph + 自定义 Ontology

**抄其中任何一家，都只是"另一个 Hindsight/Mem0/Memobase/Zep"，没有差异化价值。**

### 0.2 真正的差异化：解决四家共同短板

四家都未解决的 4 个共同短板，任何一家先解决就能成为 SOTA：

| 共同短板 | 现状 | 解决方向 |
|---------|------|---------|
| **Query-aware routing** | 四家都用原 query 检索（Hindsight 四路全跑是浪费，Mem0/Zep/Memobase 单路是不足） | 按 query 类型路由到不同检索策略 |
| **Retrieval→Generation feedback loop** | Zep 评估了 completeness 但不反馈；其他三家连评估都没有 | INSUFFICIENT 触发 query rewrite + 重检索 |
| **Self-ask sub-question 合并回主 pipeline** | 四家都无（Hindsight reflect 内部 LLM 自决，不合并） | sub-question 结果作为第 5 路 RRF 臂 |
| **统一 judge 校准** | Hindsight 用 gpt-5+thinking，Zep 用 gpt-4o-mini，分数不可比 | 采用 generous prompt + DeepSeek + 多 judge 投票 |

### 0.3 预期收益

| Phase | 解决的短板 | 预估 J Score 提升 | 累计 J Score |
|-------|-----------|------------------|-------------|
| Phase 1: Query Classifier | 四家无 query-aware routing | +2-3pp | 71-72% |
| Phase 2: Feedback Loop | Zep/Mem0/Memobase 无 feedback | +3-5pp | 74-77% |
| Phase 3: Self-ask 合并 | Mem0/Memobase 多跳弱 + Hindsight 无 self-ask | +5-8pp | 79-85% |
| Phase 4: Judge 校准 | 四家分数不可比 | 评测层面公平性 | - |
| **最终预期** | | | **79-85%** |

超过 Memobase(75.78%) 和 Zep(75.14%)，接近 Hindsight(89.61%)。

---

## 1. 总体架构

### 1.1 数据流

```
Query
  ↓
[Phase 1] Query Classifier → QueryPlan { type, strategy, armWeights, rewriteHint }
  ↓
[Phase 3] Self-ask Decomposer (仅 multi_hop) → sub-questions[]
  ↓
[Initial Retrieval]
  ├─ temporal_query → temporal arm 加权 + 时间窗过滤
  ├─ multi_hop_query → self-ask 子问题检索 + 合并回主 RRF (第 5 路)
  ├─ open_domain_query → profile/mental 注入 + 外部知识 fallback
  └─ single_hop_query → 标准混合检索
  ↓
[Cross-encoder Rerank] (已有)
  ↓
[Phase 2] Context Completeness Check
  ├─ COMPLETE → Generate
  ├─ PARTIAL → [Query Rewrite + 重检索] → Merge → Generate
  └─ INSUFFICIENT → [Query Rewrite + 重检索] → Merge → Generate
  ↓
[Phase 4] Judge (generous prompt + 多投票)
```

### 1.2 与四家的根本差异

| 维度 | Hindsight | Mem0 | Memobase | Zep | **本方案** |
|------|-----------|------|----------|-----|-----------|
| 检索策略选择 | 四路全跑+RRF | 单路+entity boost | 单路 profile | 双路 graph | **Query-aware routing** |
| 多跳处理 | Graph 因果链 | 单跳 entity boost | 无 | 隐式 traversal | **Self-ask 合并回主 RRF** |
| Feedback | 无（reflect 独立） | 无 | 无 | 评估不反馈 | **Completeness→重检索闭环** |
| Temporal | 独立 RRF arm | 无 | event 窗口 | 显示 valid_at | **Query 分类→时间窗过滤** |

---

## 2. Phase 1: Query Classifier

### 2.1 目标

按 query 类型路由到不同检索策略，避免"temporal 问题跑 graph 浪费，multi-hop 问题单路又不够"。

### 2.2 接口定义

```typescript
// 文件：tests/unit/helpers/query-classifier.ts

export type QueryType =
  | "temporal"        // 时间相关："When did...", "How long ago..."
  | "multi_hop"       // 多跳推理：需要跨实体/跨 session 关联
  | "open_domain"     // 开放域：需要外部知识
  | "single_hop";     // 单跳：直接事实查询

export type RetrievalStrategy =
  | "temporal_priority"   // temporal arm 权重 ×2, 时间窗过滤
  | "multi_hop_deep"      // self-ask 分解 + sub-question 合并
  | "profile_augment"     // profile/mental 注入 + 外部知识 fallback
  | "standard";           // 标准混合检索

export interface QueryPlan {
  readonly type: QueryType;
  readonly strategy: RetrievalStrategy;
  readonly armWeights: {
    readonly bm25: number;
    readonly vector: number;
    readonly entity: number;
    readonly temporal?: number;   // 仅 temporal_priority 时定义
    readonly selfAsk?: number;    // 仅 multi_hop_deep 时定义
  };
  readonly rewriteHint?: string;  // 给 Phase 2 feedback loop 的提示
  readonly timeWindow?: {         // 仅 temporal 时定义
    readonly referenceTime: number;
    readonly beforeDays?: number;
    readonly afterDays?: number;
  };
  readonly subQuestions?: string[]; // 仅 multi_hop_deep 时定义
}

// 主接口：分类 + 规划
export async function classifyQuery(
  query: string,
  options?: {
    conversationContext?: string;  // 可选：对话上下文辅助分类
    referenceTime?: number;        // 可选：当前参考时间
  },
): Promise<QueryPlan>;

// 纯函数：基于规则的快速分类（不调 LLM，用于回退）
export function classifyQueryHeuristic(query: string): QueryType;
```

### 2.3 分类规则

| Query 类型 | 启发式信号 | LLM 分类 prompt 要点 |
|-----------|-----------|---------------------|
| temporal | "when/why/how long/since/until/before/after" + 时间词 | 判断是否需要时间推理 |
| multi_hop | 多实体、多事件关联、因果词 | 判断是否需要跨 session 推理 |
| open_domain | 对话之外的知识、常识 | 判断答案是否在记忆中 |
| single_hop | 单一事实查询 | 默认 |

### 2.4 路由策略

| Query 类型 | 检索策略 | arm 权重 | 特殊行为 |
|-----------|---------|---------|---------|
| temporal | temporal_priority | bm25=0.5, vector=1.0, entity=0.5, temporal=1.5 | 时间窗过滤 valid_at ∈ [ref-before, ref+after] |
| multi_hop | multi_hop_deep | bm25=0.5, vector=1.0, entity=1.0, selfAsk=0.8 | self-ask 分解，sub-question 作为第 5 路 RRF |
| open_domain | profile_augment | bm25=0.3, vector=0.8, entity=0.5 | 注入 profile context + （可选）外部知识 |
| single_hop | standard | bm25=0.5, vector=1.0, entity=0.5（OPTIMAL_HYBRID_FUSION） | 无特殊 |

### 2.5 实现要点

1. **LLM 优先**：调用 DeepSeek 分类，返回结构化 JSON
2. **启发式回退**：LLM 失败时用 `classifyQueryHeuristic`（正则匹配关键词）
3. **sub-question 分解**：仅 multi_hop 时调用，复用已有 `decomposeSequentialQuestion`
4. **timeWindow**：仅 temporal 时定义，从 `extractQueryTimeConstraint` 提取

### 2.6 验收标准

```typescript
// 测试文件：tests/unit/helpers/query-classifier.test.ts

describe("Query Classifier", () => {
  // 启发式分类
  it("classifies temporal queries by heuristic", () => {
    expect(classifyQueryHeuristic("When did Alice start surfing?")).toBe("temporal");
    expect(classifyQueryHeuristic("How long has Bob worked at Google?")).toBe("temporal");
  });
  it("classifies single_hop by default", () => {
    expect(classifyQueryHeuristic("What is Alice's job?")).toBe("single_hop");
  });
  // LLM 分类（需要 DEEPSEEK_API_KEY）
  it.skipIf(!hasDeepSeekKey())("classifies multi_hop via LLM", async () => {
    const plan = await classifyQuery("What job did Alice have before becoming a nurse?");
    expect(plan.type).toBe("multi_hop");
    expect(plan.strategy).toBe("multi_hop_deep");
    expect(plan.subQuestions).toBeDefined();
    expect(plan.subQuestions!.length).toBeGreaterThan(0);
  });
  // 回退
  it("falls back to heuristic when LLM fails", async () => {
    const plan = await classifyQuery("When did Alice start surfing?", { /* 无 LLM */ });
    expect(plan.type).toBe("temporal");
  });
});
```

**硬门槛**：
- [ ] typecheck 通过
- [ ] 单元测试 ≥ 10 个，覆盖 4 种类型 + 回退
- [ ] 150q dev-slice J Score 不下降（≥ 69.33%）
- [ ] 分类准确率 ≥ 80%（人工抽检 20 个 query）

---

## 3. Phase 2: Feedback Loop

### 3.1 目标

检索后评估 context completeness，INSUFFICIENT/PARTIAL 触发 query rewrite + 重检索，合并结果后生成。

### 3.2 接口定义

```typescript
// 文件：tests/unit/helpers/retrieval-feedback-loop.ts

export interface RetrievalResult {
  readonly hits: readonly HybridSearchHit[];
  readonly episodicHits: readonly EpisodicHit[];
  readonly assembledContext: string;
  readonly retrievedFacts: readonly RuntimeMemoryQueryableFact[];
}

export interface FeedbackLoopOptions {
  readonly maxIterations: number;          // 默认 2
  readonly completenessThreshold: "COMPLETE" | "PARTIAL";  // 触发重检索的阈值
  readonly queryPlan: QueryPlan;           // 来自 Phase 1
}

export interface FeedbackLoopResult extends RetrievalResult {
  readonly iterations: number;
  readonly finalCompleteness: "COMPLETE" | "PARTIAL" | "INSUFFICIENT";
  readonly rewriteHistory: string[];      // 重写过的 query 历史
}

// 主接口：带 feedback loop 的检索
export async function retrieveWithFeedbackLoop(
  query: string,
  initialResult: RetrievalResult,
  options: FeedbackLoopOptions,
  retrieveFn: (q: string) => Promise<RetrievalResult>,
): Promise<FeedbackLoopResult>;

// Query 重写：基于缺失证据重写 query
export async function rewriteQueryForRetrieval(
  originalQuery: string,
  missingEvidence: string[],
  queryPlan: QueryPlan,
): Promise<string>;

// 合并多次检索结果（去重 + RRF 融合）
export function mergeRetrievalResults(
  results: readonly RetrievalResult[],
): RetrievalResult;
```

### 3.3 工作流

```
1. initialResult = retrieveFn(query)
2. completeness = computeContextCompletenessDeterministic(query, initialResult.retrievedFacts)
3. if completeness.level == "COMPLETE" || iterations >= maxIterations:
     return initialResult
4. else:
     rewrittenQuery = rewriteQueryForRetrieval(query, completeness.missingEvidence, queryPlan)
     newResult = retrieveFn(rewrittenQuery)
     merged = mergeRetrievalResults([initialResult, newResult])
     goto 2
```

### 3.4 Query 重写策略

| Query 类型 | 重写策略 |
|-----------|---------|
| temporal | 扩展时间窗（beforeDays/afterDays ×2）+ 同义词扩展 |
| multi_hop | 分解为子问题 + 每个子问题单独检索后合并 |
| open_domain | 移除记忆中不存在的实体，聚焦可检索关键词 |
| single_hop | 同义词替换 + 去停用词 |

### 3.5 合并策略

- **facts 去重**：按 factId 去重，保留 RRF 分数更高的
- **episodic hits 去重**：按 sentence_id 去重
- **RRF 融合**：两次检索的 hits 按 RRF 分数重新排序

### 3.6 验收标准

```typescript
// 测试文件：tests/unit/helpers/retrieval-feedback-loop.test.ts

describe("Retrieval Feedback Loop", () => {
  it("returns immediately when completeness is COMPLETE", async () => {
    const result = await retrieveWithFeedbackLoop(/* ... */);
    expect(result.iterations).toBe(1);
  });
  it("retries when completeness is INSUFFICIENT", async () => {
    const result = await retrieveWithFeedbackLoop(/* INSUFFICIENT mock */);
    expect(result.iterations).toBe(2);
    expect(result.rewriteHistory.length).toBe(1);
  });
  it("respects maxIterations", async () => {
    const result = await retrieveWithFeedbackLoop(/* always INSUFFICIENT */, { maxIterations: 2 });
    expect(result.iterations).toBe(2);
  });
  it("merges results by factId dedup", () => {
    const merged = mergeRetrievalResults([result1, result2]);
    const factIds = merged.retrievedFacts.map(f => f.factId);
    expect(new Set(factIds).size).toBe(factIds.length); // 无重复
  });
});
```

**硬门槛**：
- [ ] typecheck 通过
- [ ] 单元测试 ≥ 8 个
- [ ] 150q dev-slice J Score 提升 ≥ 1pp（feedback 生效）
- [ ] not_retrieved 数量下降（重检索找回了部分 gold evidence）

---

## 4. Phase 3: Self-ask 合并回主 RRF

### 4.1 目标

multi_hop 问题的 sub-question 检索结果不丢弃，作为第 5 路 RRF 臂合并回主 pipeline。

### 4.2 接口定义

```typescript
// 文件：tests/unit/helpers/self-ask-merge.ts

export interface SelfAskSubQuestion {
  readonly question: string;
  readonly answer?: string;           // hop answer（给 generator 作 reasoningHints）
  readonly retrievedFactIds: string[]; // 该子问题检索到的 fact IDs
  readonly retrievedFacts: RuntimeMemoryQueryableFact[];
}

export interface SelfAskMergeResult {
  readonly subQuestions: SelfAskSubQuestion[];
  readonly mergedArmHits: HybridSearchHit[];  // 合并后的第 5 路 RRF hits
  readonly reasoningHints: string[];          // 给 generator 的 hop answers
}

// 主接口：self-ask 分解 + 检索 + 合并
export async function selfAskDecomposeAndMerge(
  query: string,
  retrieveFn: (q: string) => Promise<readonly HybridSearchHit[]>,
  options?: {
    readonly maxSubQuestions?: number;  // 默认 3
    readonly armWeight?: number;        // 默认 0.8
  },
): Promise<SelfAskMergeResult>;

// 将 self-ask hits 作为第 5 路 RRF 臂合并到主 hits
export function mergeSelfAskIntoMainHits(
  mainHits: readonly HybridSearchHit[],
  selfAskHits: readonly HybridSearchHit[],
  armWeight: number,
): HybridSearchHit[];
```

### 4.3 工作流

```
1. subQuestions = decomposeSequentialQuestion(query)  // 已有函数
2. for each subQ:
     subHits = retrieveFn(subQ)
     subAnswer = generateHopAnswer(subQ, subHits)  // 已有函数
3. mergedArmHits = RRF(所有 subHits, weight=armWeight)
4. mainHits = mergeSelfAskIntoMainHits(mainHits, mergedArmHits, armWeight)
5. return { subQuestions, mergedArmHits, reasoningHints: hopAnswers }
```

### 4.4 RRF 合并公式

对于第 5 路 self-ask arm，每个 fact 的 RRF 贡献：

```
rrf_selfask(fact) = armWeight × (1 / (k + rank_selfask(fact)))
```

其中 k=60（与主 RRF 一致），armWeight=0.8（略低于 vector=1.0，高于 entity=0.5）。

最终 fact 的总 RRF 分数：

```
total_rrf(fact) = w_bm25 × rrf_bm25(fact)
                + w_vector × rrf_vector(fact)
                + w_entity × rrf_entity(fact)
                + w_selfask × rrf_selfask(fact)
```

如果 fact 在多个 arm 中出现，分数累加（RRF 的标准行为）。

### 4.5 与 S1-2（已有）的区别

S1-2 已经实现了 self-ask merge，但作为独立优化。Phase 3 的改进是：
1. **只在 multi_hop_deep 策略时触发**（避免对 single_hop 浪费）
2. **armWeight 可配置**（Phase 1 QueryPlan 传入）
3. **sub-question 数量限制**（默认 3，避免过多 LLM 调用）

### 4.6 验收标准

```typescript
// 测试文件：tests/unit/helpers/self-ask-merge.test.ts

describe("Self-ask Merge", () => {
  it("decomposes multi_hop query into sub-questions", async () => {
    const result = await selfAskDecomposeAndMerge(
      "What job did Alice have before becoming a nurse?",
      mockRetrieveFn,
    );
    expect(result.subQuestions.length).toBeGreaterThan(0);
    expect(result.subQuestions.length).toBeLessThanOrEqual(3);
  });
  it("merges self-ask hits into main hits with RRF", () => {
    const merged = mergeSelfAskIntoMainHits(mainHits, selfAskHits, 0.8);
    // 主 hits 中已有的 fact 应该获得 boost
    const boostedFact = merged.find(h => h.fact.factId === "shared-fact");
    expect(boostedFact!.rrfScore).toBeGreaterThan(mainHits.find(h => h.fact.factId === "shared-fact")!.rrfScore);
  });
  it("respects maxSubQuestions", async () => {
    const result = await selfAskDecomposeAndMerge(query, mockRetrieveFn, { maxSubQuestions: 2 });
    expect(result.subQuestions.length).toBeLessThanOrEqual(2);
  });
});
```

**硬门槛**：
- [ ] typecheck 通过
- [ ] 单元测试 ≥ 6 个
- [ ] 150q dev-slice multi_hop J Score 提升 ≥ 5pp（从 46.43% 到 51%+）
- [ ] multi_hop not_retrieved 数量下降

---

## 5. Phase 4: Judge 校准

### 5.1 目标

建立统一的 judge 评测标准，使分数可与四家横向对比。

### 5.2 接口定义

```typescript
// 文件：tests/unit/helpers/unified-judge.ts

export interface JudgeConfig {
  readonly model: "deepseek-chat";
  readonly temperature: 0;
  readonly promptVersion: "unified-v1-2026-07-04";
  readonly votingEnabled: boolean;       // 多 judge 投票
  readonly voteCount?: number;           // 默认 3
  readonly voteAgreementThreshold?: number; // 默认 2/3
}

export interface JudgeResult {
  readonly verdict: "CORRECT" | "WRONG";
  readonly confidence: number;           // 0-1
  readonly reasoning?: string;
  readonly voteBreakdown?: { correct: number; wrong: number }; // 多投票时
}

// 主接口：统一 judge
export async function judgeWithUnifiedPrompt(
  query: string,
  goldAnswer: string,
  predictedAnswer: string,
  config?: Partial<JudgeConfig>,
): Promise<JudgeResult>;

// 5 类 category 专用 prompt（参考 Hindsight benchmark_runner.py:260-322）
export function getCategorySpecificPrompt(
  category: "single_hop" | "multi_hop" | "temporal" | "open_domain",
): string;
```

### 5.3 统一 prompt 规则（基于四家最佳实践）

```
Rules (合并 Hindsight + Mem0 + Zep 的 generous 规则):
- CORRECT if predicted conveys same meaning, even if worded differently
- Date format differences acceptable ("2023-05" vs "May 2023")
- Paraphrases acceptable ("oat milk" vs "oat milk instead")
- Partial credit: if predicted covers part of gold truth, CORRECT
- List: predicted must cover ≥50% of items
- Time tolerance: within 14 days = CORRECT
- Superstring/substring (case-insensitive) = CORRECT
- Same entity (synonyms, aliases) = CORRECT
- Temporal-reasoning category: off-by-one day tolerance (19d vs 18d)
- Knowledge-update category: allow old info + new answer
```

### 5.4 多 judge 投票

- 调用 3 次 DeepSeek（temp=0.3，引入轻微方差）
- ≥2/3 判 CORRECT → 最终 CORRECT
- 用于降低 judge_error（当前 1/150 → 目标 0/150）

### 5.5 验收标准

**硬门槛**：
- [ ] typecheck 通过
- [ ] 单元测试 ≥ 5 个
- [ ] judge_error 从 1 降到 0
- [ ] 重新评测基线，J Score 应与当前 ±1pp 内（验证 prompt 不引入偏差）

---

## 6. 整体验收标准

### 6.1 最终 J Score 目标

| 阶段 | 目标 J Score | 对标 |
|------|-------------|------|
| 当前 | 69.33% | - |
| Phase 1 完成 | ≥ 71% | 超过 Mem0 OSS (66.88%) |
| Phase 2 完成 | ≥ 74% | 接近 Memobase (75.78%) |
| Phase 3 完成 | ≥ 79% | 超过 Memobase + Zep |
| Phase 4 完成 | ≥ 79% | 同上（校准后） |
| **最终目标** | **≥ 85%** | 接近 Hindsight (89.61%) |

### 6.2 分类别目标

| 类别 | 当前 | 目标 | 对标 |
|------|------|------|------|
| temporal | 83.87% | ≥ 85% | Memobase 85.05% |
| single_hop | 70.73% | ≥ 80% | Mem0 V3 92.27% |
| multi_hop | 46.43% | ≥ 70% | Mem0 V3 93.26% |
| open_domain | 77.78% | ≥ 80% | Mem0 V3 76.04% |

### 6.3 非功能验收

- [ ] 每个 Phase 完成后 typecheck 通过
- [ ] 每个 Phase 完成后单元测试通过
- [ ] 每个 Phase 完成后 150q dev-slice J Score 不下降
- [ ] 总工程量 ≤ 4 周（Phase 1: 1周, Phase 2: 1.5周, Phase 3: 1周, Phase 4: 0.5周）

---

## 7. 文件清单

### 7.1 新增文件

| 文件 | Phase | 用途 |
|------|-------|------|
| `tests/unit/helpers/query-classifier.ts` | 1 | Query 分类 + QueryPlan 生成 |
| `tests/unit/helpers/query-classifier.test.ts` | 1 | 单元测试 |
| `tests/unit/helpers/retrieval-feedback-loop.ts` | 2 | Feedback loop 检索 |
| `tests/unit/helpers/retrieval-feedback-loop.test.ts` | 2 | 单元测试 |
| `tests/unit/helpers/self-ask-merge.ts` | 3 | Self-ask 合并回主 RRF |
| `tests/unit/helpers/self-ask-merge.test.ts` | 3 | 单元测试 |
| `tests/unit/helpers/unified-judge.ts` | 4 | 统一 judge prompt + 多投票 |
| `tests/unit/helpers/unified-judge.test.ts` | 4 | 单元测试 |

### 7.2 修改文件

| 文件 | Phase | 改动 |
|------|-------|------|
| `tests/unit/runtime-memory-locomo-full-500.test.ts` | 1-4 | 集成到主 pipeline |
| `tests/unit/helpers/runtime-memory-dev-slice.ts` | 1-4 | CACHE_VERSION bump |

### 7.3 不修改的文件

- `openclaw_runtime/src/runtime-core/*.ts` — 不改 runtime-core（本次是评测层优化，非产品层）
- `tests/unit/helpers/buffered-extraction.ts` — 不改 extraction
- `tests/unit/helpers/memory-observation-consolidation.ts` — 不改 observation consolidation

---

## 8. 决策记录

### 8.1 为什么不做 Observation 合成层（Hindsight 路线）

- **理由**：Observation 层是 Hindsight 的核心架构，抄了就是"另一个 Hindsight"
- **替代**：用 Query-aware routing + Feedback loop 解决同样的"gold evidence 检索到但用不上"问题
- **验证**：如果 Phase 2 能把 retrieved_not_used 从 17 降到 ≤10，证明不需要 Observation 层

### 8.2 为什么不做 Memory Graph 因果边

- **理由**：Graph 因果边工程量大（4-6 周），且 Hindsight 已做
- **替代**：用 Self-ask 合并回主 RRF 解决多跳问题
- **验证**：如果 Phase 3 能把 multi_hop 从 46.43% 提升到 70%+，证明不需要 Graph

### 8.3 为什么用 DeepSeek 而非 GPT-5 做 judge

- **理由**：成本（DeepSeek ~$0.50/run vs GPT-5 ~$5/run）+ 已有 generous prompt 基础
- **风险**：DeepSeek 判断能力可能弱于 GPT-5
- **缓解**：多 judge 投票（3 次，≥2/3 一致）降低方差

### 8.4 为什么用启发式回退而非纯 LLM 分类

- **理由**：LLM 分类有延迟（~1s）和成本，启发式可零延迟回退
- **适用**：temporal 分类启发式准确率高（"when/how long"关键词），multi_hop 需 LLM

---

## 9. 与 mem-status.md 的关系

- **本文档**（mem-northstar.md）：设计规格，接口定义，验收标准
- **mem-status.md**：执行状态，验收结果，变更文件清单

执行流程：
1. 开始 Phase N → 在 mem-status.md 创建 Phase N 任务，状态 `IN_PROGRESS`
2. 实现完成 → 在 mem-status.md 记录变更文件清单
3. 验收完成 → 在 mem-status.md 记录 J Score + 单元测试结果，状态 `DONE`
4. 接口变更 → 先更新本文档，再更新 mem-status.md

---

## 10. 参考资料

- `C:\Users\27933\Desktop\mem\hindsight-main\hindsight-api-slim\hindsight_api\engine\search\fusion.py:29-109` — RRF k=60
- `C:\Users\27933\Desktop\mem\hindsight-main\hindsight-api-slim\hindsight_api\engine\search\reranking.py:188-192` — 复合打分公式
- `C:\Users\27933\Desktop\mem\hindsight-main\hindsight-api-slim\hindsight_api\engine\reflect\agent.py:732-746` — 分层检索序列
- `C:\Users\27933\Desktop\mem\hindsight-main\hindsight-dev\benchmarks\common\benchmark_runner.py:260-322` — 5 类 category judge prompt
- `C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\prompts.py:10-13` — category 映射
- `C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\results\platform\locomo_results.json:24-63` — Mem0 V3 分类别得分
- `C:\Users\27933\Desktop\mem\memobase-main\docs\experiments\locomo-benchmark\README.md:53-65` — Memobase 分类别得分
- `C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\evaluation.py:251-337` — Zep context_completeness 评估（但不反馈）
- `C:\Users\27933\Desktop\mem\zep-main\legacy\src\lib\search\rrf.go:19` — Zep RRF k=1（反面教材）
