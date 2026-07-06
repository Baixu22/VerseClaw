# P1 + P2 记忆系统优化计划

## 概述

在 Phase 5.0 P0 双轨记忆系统基础上（J=48.0%），落地两个改进方案：
- **P1**: Justifier LLM 重排序（对 top-K 候选事实做 LLM 相关性裁决）
- **P2**: 时间独立检索路（修复 temporal 推理失败）

**预期目标**: J Score 从 48.0% → 54-58%，达到 55% 验收阈值。

---

## 当前状态分析

### Phase 5.0 P0 已落地

| 模块 | 文件 | 状态 |
|------|------|------|
| EpisodicMemory 类 | `tests/unit/helpers/episodic-memory.ts` | ✅ 已实现 |
| 单元测试 | `tests/unit/episodic-memory.test.ts` | ✅ 21/21 通过 |
| 双轨集成 | `tests/unit/runtime-memory-locomo-full-500.test.ts` | ✅ Phase 5.0 |
| 评估报告 | `artifacts/runtime-memory-eval/locomo-full-500-report.json` | ✅ J=48.0% |

### 分类表现与瓶颈

| 类别 | Phase 4.2 | Phase 5.0 | Delta | 瓶颈根因 |
|------|-----------|-----------|-------|---------|
| Overall J | 39.80% | 48.00% | +8.20pp | temporal/multi_hop 拖累 |
| temporal | 32.00% | 32.67% | +0.67pp | **相对时间无法转绝对；日期冲突** |
| multi_hop | 40.63% | 40.63% | 0pp | 链式检索失效（不在本计划范围） |
| single_hop | 45.67% | 53.54% | +7.87pp | 已接近目标 |
| open_domain | 42.52% | 66.14% | +23.62pp | **已超标** |

### Top 失败模式（来自 Phase 5.0 sampleResults）

| 模式 | 占比 | 案例 | P1/P2 解决方案 |
|------|------|------|---------------|
| 相对→绝对时间转换失败 | ~60% | "five years ago" → 期望"2018" | **P2** |
| 日期冲突/错误日期 | ~20% | "July 2023" vs "August 2023" | **P1** |
| Judge 误判 | ~15% | "work stress" ≈ "work-related stress" 判错 | 不在本计划范围 |
| Recall 失败 | ~5% | 未检索到包含日期的句子 | P1+P2 联合 |

### 关键架构缺陷（已识别）

1. **referenceTime 设计错位**（test line 673-680）: 用 `max(valid_at)` 作为问题查询的 referenceTime，导致 temporal filter 几乎不生效
2. **Episodic 时间戳未显示**（episodic-memory.ts:459）: `formatEpisodicBlock` 不显示 timestamp，LLM 看不到具体日期
3. **Episodic 无时间筛选能力**: `EpisodicMemory.search()` 签名没有时间参数
4. **日期精度损失**: chunk 级多数日期策略（test lines 235-247）为跨会话 chunk 赋错日期

---

## P2: 时间独立检索路

### 目标

修复 temporal 类别从 32.67% → 55%+，解决相对时间→绝对时间转换失败。

### 实施步骤

#### 步骤 P2-1: formatEpisodicBlock 显示日期（零风险，立即收益）

**文件**: `tests/unit/helpers/episodic-memory.ts`

**修改位置**: `formatEpisodicBlock` 函数（约 line 459）

**当前代码**:
```ts
lines.push(
  `[Session ${first.session_id} · Turn ${first.turn_index} · ${first.speaker}]`,
);
```

**改为**:
```ts
const dateStr = new Date(first.timestamp).toISOString().slice(0, 10);
lines.push(
  `[${dateStr} · Session ${first.session_id} · Turn ${first.turn_index} · ${first.speaker}]`,
);
```

**理由**: 让 LLM 在生成答案时直接看到日期，解决"找到 turn 但没说日期"的失败模式（Phase 5.0 案例 q14）。

#### 步骤 P2-2: 新建 query 时间提取器

**新文件**: `tests/unit/helpers/query-time-extractor.ts`

**功能**: 从问题文本中提取时间约束，返回 `{ referenceTime?: number; mode: "absolute" | "relative" | "unknown" }`

**实现要点**:
- 复用 `parseLocomoDateTime`（`tests/unit/helpers/locomo-date-parser.ts:24`）解析绝对日期
- 绝对日期正则: `/(?:on|at|before|after|since|in)\s+(\d{1,2}\s+)?([A-Za-z]+)?,?\s*(\d{4})/`
- 相对时间关键词映射（基于 Phase 5.0 失败案例）:
  - `"five years ago"` / `"X years ago"` → 当前 referenceTime 减去 X 年
  - `"last month"` / `"last week"` / `"last Tuesday"` → 需要 referenceTime 锚点
  - `"recently"` / `"currently"` / `"now"` → 用会话最大时间
  - `"next Sunday"` → 需要上下文时间锚点（暂不支持，返回 unknown）
- 返回 `mode: "unknown"` 时，调用方回退到 conversation 级 referenceTime

**单元测试**: `tests/unit/query-time-extractor.test.ts`
- test_absolute_date: "What happened on 15 March 2023?" → referenceTime = parsed
- test_relative_years: "five years ago" → referenceTime = anchor - 5 years
- test_unknown: "How is Alice?" → mode = "unknown"

#### 步骤 P2-3: 修改 processQuestion 使用问题时间约束

**文件**: `tests/unit/runtime-memory-locomo-full-500.test.ts`

**修改位置**: `processQuestion` 函数内，约 line 733-734

**当前代码**:
```ts
const referenceTime = referenceTimeByConversation.get(conversationId);
```

**改为**:
```ts
const queryTimeConstraint = extractQueryTimeConstraint(qa.question);
const referenceTime = queryTimeConstraint.referenceTime
  ?? referenceTimeByConversation.get(conversationId);
```

**理由**: 当前所有问题都用同一个 conversation 级 referenceTime，无法区分"五年前"和"现在"的查询意图。

#### 步骤 P2-4: EpisodicMemory 加时间筛选参数

**文件**: `tests/unit/helpers/episodic-memory.ts`

**修改**: `search()` 方法签名增加可选时间筛选

```ts
async search(
  query: string,
  queryEmbedding: Float32Array | null,
  topK = 15,
  options?: {
    minTimestamp?: number;
    maxTimestamp?: number;
  },
): Promise<EpisodicHit[]>
```

**实现**: 在 BM25/Vector 排序后、RRF 融合前，按 `sentence.timestamp` 过滤候选集。若 `options` 为 undefined 则保持原行为。

**调用方修改**（`runtime-memory-locomo-full-500.test.ts` line 826）:
```ts
const episodicHits = await episodic.search(
  qa.question,
  new Float32Array(queryEmbArr),
  15,
  queryTimeConstraint.referenceTime
    ? { maxTimestamp: queryTimeConstraint.referenceTime }
    : undefined,
);
```

**理由**: 时间问题应只检索问题时间点之前的句子，避免未来信息污染。

#### 步骤 P2-5: 报告元数据与超时更新

**文件**: `tests/unit/runtime-memory-locomo-full-500.test.ts`

- `version` 改为 `"6.0-full-500-p2-temporal-track"`
- `retrievalMode` 描述加入 "P2 temporal track (query time extractor + episodic time filter + date display)"
- 超时保持 `4_500_000`（P2 不增加 LLM 调用，时间相近）

---

## P1: Justifier LLM 重排序

### 目标

对 top-K 候选事实做 LLM 相关性裁决，解决日期冲突/错误日期问题。预期 J +3-5pp。

### 关键设计决策

**与之前 P0 失败的 MultiQuery rewriting 区别**:
- MultiQuery 是输入端改写（query 端），已被证伪
- Justifier 是输出端重排（result 端），让 LLM 做"这个 fact 是否回答了问题"的裁决
- 必须包含 `reason` 字段（chain-of-thought），让 LLM 显式说出"为什么相关"

### 实施步骤

#### 步骤 P1-1: 新建 justifier-rerank.ts 模块

**新文件**: `tests/unit/helpers/justifier-rerank.ts`

**导出函数**:
```ts
export async function rerankWithJustifier(
  question: string,
  candidates: ReadonlyArray<{
    factId: string;
    subject: string;
    predicate: string;
    objectSummary: string;
    rrfScore: number;
  }>,
  options: {
    topK?: number;       // 默认 10，重排后保留数量
    keepOriginalN?: number;  // 默认 5，保留原 top-N 不动（防止 Justifier 误判）
  },
): Promise<{
  reranked: Array<{ factId: string; relevanceScore: number; reason: string }>;
  skipped: boolean;  // 候选 ≤ keepOriginalN 时跳过
}>
```

**实现要点**:
- 候选数 ≤ `keepOriginalN`（默认 5）时直接返回原顺序，跳过 LLM 调用（成本优化）
- 单次 `callDeepSeek` 调用，prompt 中列出所有候选（factId + subject + predicate + objectSummary）
- 要求模型返回 JSON 数组: `[{"factId": "...", "relevanceScore": 0.0-1.0, "reason": "..."}]`
- 默认参数: `temperature=0, maxTokens=512`
- JSON 解析失败时回退到原顺序（graceful degradation）
- 复用 `withRetry` 包裹

**Prompt 设计**:
```
System: You are a relevance judge. Given a question and a list of candidate facts,
rate each fact's relevance to the question on a scale of 0.0 to 1.0.
- 1.0 = directly answers the question
- 0.5 = partially relevant
- 0.0 = not relevant
Return ONLY a JSON array, no preamble. Each element: {"factId": "...", "relevanceScore": 0.0-1.0, "reason": "..."}

User:
Question: {question}

Candidate facts:
[1] factId: f1 | Alice | started_job | March 2023
[2] factId: f2 | Alice | promoted_to | Senior Engineer
...

Return JSON array:
```

#### 步骤 P1-2: 单元测试

**新文件**: `tests/unit/justifier-rerank.test.ts`

测试用例:
- `test_rerank_by_relevance`: 给出明显相关+明显无关的候选，验证排序
- `test_skip_when_few_candidates`: 候选 ≤ 5 时 skipped=true，无 LLM 调用
- `test_json_parse_fallback`: 模拟 JSON 解析失败，验证回退原顺序
- `test_reason_field_populated`: 验证 reason 字段非空

注: 真实 LLM 调用测试用 `describe.skipIf(!hasDeepSeekKey())` 包裹，与现有模式一致。

#### 步骤 P1-3: 集成到 processQuestion

**文件**: `tests/unit/runtime-memory-locomo-full-500.test.ts`

**插入位置**: line 807（finalHits 计算完成后）、line 811（retrievedFacts 提取前）

**伪代码**:
```ts
// P1: Justifier LLM 重排序
let rerankedHits = finalHits;
if (finalHits.length > 5) {
  const rerankResult = await withRetry(() =>
    rerankWithJustifier(qa.question, finalHits.map(h => ({
      factId: h.fact.factId,
      subject: h.fact.subject,
      predicate: h.fact.predicate,
      objectSummary: h.fact.objectSummary,
      rrfScore: h.rrfScore,
    })), { topK: 10, keepOriginalN: 5 }),
  );
  if (!rerankResult.skipped) {
    const scoreById = new Map(rerankResult.reranked.map(r => [r.factId, r.relevanceScore]));
    // 混合排序: top-5 按 Justifier 分数，6-10 保留原 RRF 顺序
    const top5 = finalHits
      .map(h => ({ h, score: scoreById.get(h.fact.factId) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(x => x.h);
    const rest = finalHits.slice(5, 10);
    rerankedHits = [...top5, ...rest];
  }
}
const retrievedFacts = rerankedHits.map(h => h.fact);
```

**理由**: 保留 top-5 原始作为安全网（防止 Justifier 误判），只对 6-10 做 Justifier 重排。但根据探索，更激进的做法是 top-10 全部重排。**采用激进方案**: top-10 全部按 Justifier 分数排序，保留原 RRF 顺序作为 tiebreaker。

**最终采用**:
```ts
if (finalHits.length > 5) {
  // top-10 全部重排，原 RRF 顺序作为 tiebreaker
  rerankedHits = finalHits
    .map(h => ({ h, score: scoreById.get(h.fact.factId) ?? 0 }))
    .sort((a, b) => b.score - a.score || b.h.rrfScore - a.h.rrfScore)
    .map(x => x.h);
}
```

#### 步骤 P1-4: 报告元数据与超时更新

- `version` 改为 `"6.1-full-500-p1-p2-combined"`
- `retrievalMode` 加入 "P1 Justifier LLM rerank (top-10, DeepSeek temperature=0)"
- 超时增加至 `5_400_000`（90 分钟，P1 每问题 +1 次 LLM 调用，500 问题 × 1s ≈ +8 分钟）

---

## 实施顺序

1. **P2-1**: formatEpisodicBlock 显示日期（5 分钟，零风险）
2. **P2-2**: 新建 query-time-extractor.ts + 单测（30 分钟）
3. **P2-3**: processQuestion 集成 query 时间约束（10 分钟）
4. **P2-4**: EpisodicMemory.search 加时间筛选（15 分钟）
5. **P2-5**: 运行 Phase 6.0 评估（仅 P2，~20 分钟）
6. **P1-1**: 新建 justifier-rerank.ts（30 分钟）
7. **P1-2**: justifier-rerank 单测（20 分钟）
8. **P1-3**: processQuestion 集成 Justifier（15 分钟）
9. **P1-4**: 运行 Phase 6.1 评估（P1+P2 联合，~30 分钟）

**分两次评估的原因**: 先验证 P2 单独效果，确认 temporal 类别改善后再叠加 P1，避免变量混淆。

---

## 假设与决策

### 假设

1. **DeepSeek API 稳定性**: P1 每问题增加 1 次 LLM 调用，500 次调用 × 1s ≈ 8 分钟增量。假设 API 不限流（已有 withRetry + 退避）。
2. **query-time-extractor 覆盖率**: 假设 60% 的 temporal 问题包含可提取的时间约束（基于 Phase 5.0 失败案例分布）。剩余 40% 回退到 conversation 级 referenceTime。
3. **Justifier 不会回归**: P0 的 MultiQuery 回归是因为 query 端改写引入噪声；P1 在 result 端重排，且保留原 RRF 作为 tiebreaker，风险更低。

### 决策

1. **P2 优先于 P1**: P2 零 LLM 调用成本，且解决 60% 的失败模式（相对时间转换）。先做 P2 可以独立验证 temporal 改善。
2. **P1 采用激进重排**: top-10 全部按 Justifier 分数排序，而非保留 top-5 原顺序。理由: Phase 5.0 证明 RRF 排序本身有噪声，Justifier 应有完整重排权。
3. **不修改 Semantic Track 抽取逻辑**: fact 抽取的日期精度损失（chunk 多数日期策略）是已知缺陷，但修改会影响所有历史缓存，超出本计划范围。
4. **query-time-extractor 放在 tests/helpers 而非 openclaw_runtime**: 这是评估专用工具，生产代码的 temporal 推理应走另一条路径（带 LLM 推理）。与 episodic-memory.ts 同级。

---

## 验收标准

| 指标 | Phase 5.0 | Phase 6.0 (P2) | Phase 6.1 (P1+P2) | 目标 |
|------|-----------|----------------|---------------------|------|
| Overall J | 48.00% | ≥ 52% | ≥ 55% | ≥ 55% |
| temporal | 32.67% | ≥ 45% | ≥ 55% | ≥ 55% |
| single_hop | 53.54% | ≥ 55% | ≥ 60% | ≥ 60% |
| open_domain | 66.14% | ≥ 65% | ≥ 65% | ≥ 50% ✅ |
| multi_hop | 40.63% | ≥ 40% | ≥ 45% | ≥ 50% |
| Recall@5 | 44.90% | ≥ 45% | ≥ 50% | ≥ 60% |

**Phase 6.0 (P2) 验收**: temporal J 从 32.67% → 45%+（+12pp），证明时间独立检索路有效。

**Phase 6.1 (P1+P2) 验收**: Overall J ≥ 55%，达到任务目标。若 < 55% 但 > 50%，输出 top-5 失败案例供 P3 决策。

---

## 验证步骤

1. **单元测试全通过**:
   - `pnpm exec vitest run tests/unit/episodic-memory.test.ts`
   - `pnpm exec vitest run tests/unit/query-time-extractor.test.ts`
   - `pnpm exec vitest run tests/unit/justifier-rerank.test.ts`

2. **Typecheck 通过**: `pnpm run typecheck`

3. **Phase 6.0 评估运行**:
   ```powershell
   $env:RUNTIME_MEMORY_REAL_LLM="1"
   $env:SILICONFLOW_API_KEY="sk-..."
   pnpm run eval:runtime-memory:locomo:full500
   ```
   验证报告 `artifacts/runtime-memory-eval/locomo-full-500-report.json` 中 temporal J ≥ 45%。

4. **Phase 6.1 评估运行**: 同上，验证 Overall J ≥ 55%。

5. **若未达标**: 输出每个类别 delta + top-5 失败案例（修改 `sampleResults` 切片为 `results.filter(r => r.judgeScore === 0).slice(0, 50)`）。

---

## 文件清单

### 新增文件
- `tests/unit/helpers/query-time-extractor.ts` — 问题时间约束提取器
- `tests/unit/helpers/justifier-rerank.ts` — LLM 重排序模块
- `tests/unit/query-time-extractor.test.ts` — 单元测试
- `tests/unit/justifier-rerank.test.ts` — 单元测试

### 修改文件
- `tests/unit/helpers/episodic-memory.ts` — formatEpisodicBlock 显示日期 + search 加时间筛选参数
- `tests/unit/runtime-memory-locomo-full-500.test.ts` — 集成 P1+P2，更新版本号和超时

### 不修改文件
- `openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts` — Semantic Track 检索逻辑保持不变
- `openclaw_runtime/src/runtime-core/memory-temporal-detector.ts` — detectQueryTemporalMode 保持不变
- `tests/fixtures/locomo/extracted-facts-cache.json` — fact 缓存保持不变
