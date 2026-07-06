# 记忆系统优化规划：超越 MVP

## Progress（截至 2026-07-01）

| Phase | 任务 | 状态 | 说明 |
|-------|------|------|------|
| 1.1 | 使用频率跟踪 | ✅ 完成 | `memory-store.ts` 已添加 `usageCounts`/`lastAccessedAt`/`recordFactAccess`/`computeUsageScore`，8 测试通过 |
| 1.2 | HybridSearchIndex 缓存 | ✅ 完成 | `memory-hybrid-retrieval.ts` 已添加模块级 LRU 缓存（max 16），7 测试通过 |
| 1.3 | 成熟度评分天花板 | 🔄 进行中 | L6/L7 已补齐 4/4 特性，当前 6/10 LLM 层完整 → antiHallucination=0.6 → 总分≈0.928。需≥7/10 才达 0.95 |
| 2.1 | Supersession 冲突检测 | ⏳ 待开始 | |
| 2.2 | 后台合并模块 | ⏳ 待开始 | |
| 3.1 | 三信号融合 | ⏳ 待开始 | |
| 3.2 | 时序查询操作符 | ⏳ 待开始 | |
| 4.1 | 记忆类型字段 | ⏳ 待开始 | |
| 4.2 | 类型感知淘汰 | ⏳ 待开始 | |
| 4.3 | 类型感知检索 | ⏳ 待开始 | |
| 4.4 | 自编辑记忆接口 | ⏳ 待开始 | |

**Phase 1.3 精确现状（基于实际文件分析）：**

10 个 LLM 层的反幻觉 4 项特性（usesUniqueTokenProbe / usesAbAblation / usesNegativeAssertion / usesMultiJudgeVote）：

| Layer | UTP | ABA | NA  | MJV | 全 4 项? | 说明 |
|-------|-----|-----|-----|-----|---------|------|
| L3 | ✓ | ✓ | ✓ | ✓ | ✓ | |
| L5 | ✓ | ✓ | ✓ | ✓ | ✓ | |
| L6 | ✓ | ✓ | ✓ | ✓ | ✓ | Phase 1.3 已修 |
| L7 | ✓ | ✓ | ✓ | ✓ | ✓ | Phase 1.3 已加 multi_judge_recall_stability |
| L8 | ✗ | ✗ | ✓ | ✗* | ✗ | *metadata 标了 MJV 但测试文件无 `callDeepSeekMajorityVote`——**metadata bug 需修复** |
| CV1 | ✗ | ✗ | ✗ | ✓* | ✗ | *metadata 标了 MJV 但需验证测试文件 |
| CV2 | ✗ | ✗ | ✓ | ✓* | ✗ | *metadata 标了 MJV 但需验证测试文件 |
| CV3 | ✓ | ✓ | ✓ | ✓ | ✓ | |
| CV4 | ✓ | ✓ | ✓ | ✗ | ✗ | **最接近——只缺 MJV，加 1 个测试即可达 7/10** |
| CV5 | ✓ | ✓ | ✓ | ✓ | ✓ | |

**达成 ≥0.95 的路径（按性价比排序）：**
1. **CV4 加 multi-judge 测试**（必做）：7/10 → antiHallucination=0.7 → 总分≈0.946
2. **L8 修 metadata bug + 补 UTP/ABA/MJV 测试**（推荐）：8/10 → 0.8 → 总分≈0.964
3. **CV2 补 UTP/ABA 测试**（可选）：9/10 → 0.9 → 总分≈0.982

---

## Summary

在 MVP 4 模块全部完成、105/105 测试通过、W19 融合最优的基础上，对记忆系统进行 4 个方向的优化，使其能力对齐主流记忆系统（Zep / mem0 / LangMem / Cognee / Letta），同时保持纯 TS、无原生依赖、完全可测试的架构思想。

**核心原则：**
- 保持纯 TS 后端（BM25 + 字符 3-gram 向量），不引入 ONNX/FTS5 原生依赖
- 所有优化必须通过现有 14 层评测框架验证，满足 no-harm 约束
- 渐进式增强，每个 Phase 可独立交付和验证
- 保留 W19 融合作为基线，新信号作为可选增强

## Current State Analysis

### 已完成
- **Module A** (`memory-write-curation.ts`): AUDN 写入策展，9 测试通过
- **Module B** (`memory-hybrid-retrieval.ts`): BM25+向量混合检索，W19 最优融合（k=0 + 归一化 + 非对称权重），21 变体消融测试
- **Module C** (`memory-store.ts`): 重要性感知淘汰，`trimFactsByImportance` (lines 440-528)，4 测试通过
- **Module D**: 7 维成熟度评分（0.892 理论上限），4 个取消资格检查
- **评测**: 13 文件 105 测试，L1-L9 + CV1-CV5 全通过

### 关键差距（探索发现）

**记忆生命周期差距：**
- `decideAUDN` 只做去重（exact + BM25 + Jaccard），**不检测语义冲突**——同一 subject+predicate 的矛盾事实共存
- 无后台合并——低质量事实只能等 FIFO 淘汰，不会主动剪枝
- Module C 的 `usageScore = 0.5` 是硬编码常量，**无实际使用频率跟踪**

**检索能力差距：**
- 只有两信号（BM25 + 向量），mem0 用三信号（+ 实体匹配）
- L2 `preFilter` 有 `referenceTime` 过滤，但**不参与排序评分**——时序信号未被利用
- 无时序查询操作符（"在时间点 X 我们知道什么"）

**记忆分类法差距：**
- 所有事实统一处理，无 semantic/episodic/procedural 分类
- 无程序性记忆（用户反馈强化的行为模式）
- 无自编辑记忆接口（Letta 式 agent 自主管理记忆）

**生产化差距：**
- 所有持久化操作同步执行（`executeSqliteQuerySync`），阻塞事件循环
- `hybridSearchFacts` 每次调用重建索引，无跨查询缓存
- 无并发安全测试、无大规模压测（>540 事实）
- 向量嵌入不持久化，每次查询重新计算

**成熟度评分天花板：**
- 0.892 是理论上限，因为只有 4/10 个 LLM 层有完整 4 项反幻觉特性
- 需要让 L6/L7/L8/CV1/CV2/CV4 补齐 `usesUniqueTokenProbe` + `usesAbAblation` + `usesNegativeAssertion` + `usesMultiJudgeVote`

---

## Proposed Changes

### Phase 1: 生产基础（解锁后续阶段的依赖）

**目标：** 实现使用频率跟踪和索引缓存，为 Phase 2-4 提供数据基础。

#### 1.1 使用频率跟踪
**文件：** `openclaw_runtime/src/runtime-core/memory-store.ts`

**问题：** Module C 的 `trimFactsByImportance` (line ~480) 使用 `usageScore = 0.5` 硬编码常量。

**改动：**
- 在 `RuntimeMemoryStore` 类中添加 `private usageCounts: Map<string, number>` 和 `private lastAccessedAt: Map<string, number>`
- 添加 `recordFactAccess(factId: string): void` 方法——在 L2 检索返回结果时调用
- 修改 `scoreFactForEviction(fact, now)` 计算：`usageScore = decayedUsageCount / maxUsageCount`（指数衰减，半衰期 7 天）
- 导出 `getUsageStats(): { factId: string; count: number; lastAccessedAt: number }[]` 供诊断使用

**验证：** 新增测试 `tests/unit/runtime-memory-usage-tracking.test.ts`：
- 写入 100 事实，查询 10 次（命中 5 个），验证 usageCounts 正确
- 验证淘汰时高使用频率事实优先保留
- 验证衰减：模拟时间前进 14 天，验证旧访问记录权重下降

#### 1.2 HybridSearchIndex 缓存
**文件：** `openclaw_runtime/src/context-engine/memory-context-provider.ts`

**问题：** Provider 每次 `getMemoryContext` 调用都通过 `hybridSearchFacts` 重建索引。

**改动：**
- 在 `createRuntimeMemoryContextProvider` 闭包中添加 `private indexCache: Map<string, { index: HybridSearchIndex; factCount: number; lastWriteAt: number }>`
- Cache key = `${taskId}:${subject ?? "*"}`，factCount + lastWriteAt 作为失效条件
- 当 `store.stats().facts` 变化或 `store.getLastWriteAt() > cached.lastWriteAt` 时失效
- LRU 淘汰，最多缓存 16 个索引实例

**验证：** 新增测试验证缓存命中/失效逻辑；验证相同查询第二次延迟 < 首次的 10%

#### 1.3 成熟度评分天花板提升（剩余工作）
**文件：** `tests/unit/helpers/runtime-memory-maturity-score.ts` + 3 个测试文件

**已完成：** L6/L7 metadata 修复 + L7 `multi_judge_recall_stability` 测试已添加。当前 6/10 LLM 层有全 4 项特性，antiHallucination=0.6，总分≈0.928。

**剩余改动（按优先级）：**

**Step A（必做，达 0.946）：CV4 加 multi-judge 测试**
- 文件：`tests/unit/runtime-memory-retention-llm-judge.test.ts`
- 在 imports 中添加 `callDeepSeekMajorityVote`（从 `./helpers/runtime-memory-real-llm-client`）
- 在 `describe.skipIf(!hasDeepSeekKey())` 块末尾添加 `multi_judge_retention_stability` 测试：
  - 复用现有 probe 模式（`makeUniqueProbeToken` + `PROBE_SUBJECT` + `PROBE_TASK_ID`）
  - 写入 1 个 probe fact，加载全部 facts，调用 `getMemoryContextFromFacts`
  - 用 `callDeepSeekMajorityVote(system, userQuestion, 3, { temperature: 0.3, maxTokens: 64 })` 获取 3 票
  - 断言 ≥2/3 票包含 token（`agreementCount >= 2`）
  - 超时 120_000ms
- 文件：`tests/unit/helpers/runtime-memory-maturity-score.ts` line 251-252：
  - CV4 添加 `usesMultiJudgeVote: true`
  - testCount: 4 → 5

**Step B（推荐，达 0.964）：L8 修 metadata bug + 补 3 项特性**
- 文件：`tests/unit/runtime-memory-useless-content-judge.test.ts`
- **先修 metadata bug**：L8 当前 metadata 标了 `usesMultiJudgeVote: true` 但测试文件无 `callDeepSeekMajorityVote`。需要实际添加测试或移除标记。
- 补 `usesUniqueTokenProbe`：在现有 LLM 测试中使用 `makeUniqueProbeToken` 注入唯一 token，断言 LLM 回复包含它
- 补 `usesAbAblation`：添加 with-memory vs without-memory A/B 对比测试
- 补 `usesMultiJudgeVote`：添加 3 票多数投票测试
- 更新 metadata：L8 标记全部 4 项特性为 true，testCount 相应增加

**Step C（可选，达 0.982）：CV2 补 UTP/ABA**
- 文件：`tests/unit/runtime-memory-consumer-llm-judge.test.ts`
- 补 `usesUniqueTokenProbe` + `usesAbAblation` 测试
- 更新 metadata

**验证：** `pnpm exec vitest run tests/unit/runtime-memory-maturity-score-real.test.ts --reporter=verbose` 验证 antiHallucination 维度从 0.6 提升到 ≥0.7（Step A）或 ≥0.8（Step A+B）

---

### Phase 2: 记忆生命周期优化（Zep + Cognee 思想）

**目标：** 实现 supersession 废止和后台合并，提升存储事实的质量。

#### 2.1 Supersession 冲突检测
**文件：** `openclaw_runtime/src/runtime-core/memory-write-curation.ts`

**问题：** 当前 AUDN 只检测去重（Stage 1 exact match → UPDATE），不检测语义矛盾。例如 "用户偏好深色主题" 和 "用户偏好浅色主题" 会共存。

**改动：**
- 扩展 `AUDNAction` 类型：添加 `"SUPERSEDE"` 动作
- 扩展 `AUDNDecision`：添加 `supersessionReason?: "contradiction" | "outdated" | "refined"`
- 在 `decideAUDN` 的 Stage 1（exact subject+predicate match）后新增 Stage 1.5：
  - 如果 subject+predicate 匹配但 objectSummary 语义矛盾（词重叠 < 0.3 且存在否定词模式 "not"/"no longer"/"switched from"）
  - 则返回 `SUPERSEDE` 决策，附带被废止的旧 factId
- 在 `applyAUDNDecision` 中处理 `SUPERDEDE`：创建 invalidation proposal 标记旧事实 `invalid_at = now`，同时 ADD 新事实

**冲突检测算法（纯 TS）：**
```
function detectConflict(newFact, existingFact): boolean {
  if (newFact.subject !== existingFact.subject) return false;
  if (newFact.predicate !== existingFact.predicate) return false;
  const newObjTokens = tokenize(newFact.objectSummary);
  const existObjTokens = tokenize(existingFact.objectSummary);
  const overlap = jaccard(newObjTokens, existObjTokens);
  const hasNegation = /(?:not|no longer|switched|changed|updated|now)\b/i.test(newFact.objectSummary);
  return overlap < 0.3 && hasNegation;
}
```

**验证：**
- 新增测试 `tests/unit/runtime-memory-supersession.test.ts`：
  - 矛盾事实写入 → 旧事实 `invalid_at` 设置，新事实 ADD
  - 非矛盾更新（信息补充）→ 走 UPDATE 而非 SUPERSEDE
  - 多次废止链：A→B→C，验证查询只返回 C
- 在 `runtime-memory-mvp-deep-test.test.ts` 中新增 supersession 测量

#### 2.2 后台合并模块
**新文件：** `openclaw_runtime/src/runtime-core/memory-background-consolidation.ts`

**设计（来自 Cognee memify + Letta v2 sleep-time）：**
```typescript
export interface ConsolidationConfig {
  /** 低于此 importance 的事实被视为剪枝候选。默认 0.15 */
  pruneImportanceThreshold: number;
  /** 超过此天数未访问的剪枝候选将被删除。默认 14 */
  pruneStaleDays: number;
  /** 语义相似度高于此值的事实对被视为近重复。默认 0.88 */
  mergeSimilarityThreshold: number;
  /** 单次合并运行最多处理的事实数。默认 256 */
  batchSize: number;
}

export interface ConsolidationResult {
  prunedFactIds: string[];
  mergedPairs: { survivorId: string; absorbedId: string; similarity: number }[];
  strengthenedFactIds: string[]; // usage count boost
  durationMs: number;
}

export function runConsolidation(
  store: RuntimeMemoryStore,
  config: ConsolidationConfig,
  now: number,
): ConsolidationResult;
```

**合并逻辑：**
1. **剪枝：** `importance < threshold AND lastAccessedAt < now - staleDays*86400000` → 删除
2. **去重合并：** 同一 subject 下，objectSummary 的字符 3-gram 余弦相似度 > 0.88 → 保留高 confidence 的，废止低 confidence 的
3. **增强：** usage count > P75 的事实 importance += 0.1（上限 1.0）

**集成：** 在 `memory-runtime-integration.ts` 中添加 `runBackgroundConsolidation(): Promise<ConsolidationResult>` 方法，可由上层调度（不阻塞写入路径）。

**验证：**
- 新增测试 `tests/unit/runtime-memory-background-consolidation.test.ts`：
  - 注入 200 事实（50 低质量 + 100 正常 + 50 高使用频率），运行合并，验证剪枝/合并/增强结果
  - 验证合并后的事实保留最高 confidence
  - 验证批量大小限制
- 验证不破坏现有 105 测试

---

### Phase 3: 检索能力增强（mem0 + Zep 思想）

**目标：** 添加实体匹配第三信号和时序查询操作符，提升检索精度。

#### 3.1 三信号融合（实体增强）
**文件：** `openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts`

**问题：** 当前只有 BM25 + 向量两信号。mem0 证明实体匹配作为第三信号能显著提升精度。

**改动：**
- 新增实体提取函数：
  ```typescript
  function extractEntities(text: string): Set<string> {
    // 大写开头词（专有名词）+ 标识符（驼峰/下划线/连字符）+ 数字串
    const entities = new Set<string>();
    const properNouns = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
    const identifiers = text.match(/\b[a-z][a-zA-Z0-9]*(?:[A-Z][a-z]+)+\b/g) ?? [];
    const numbers = text.match(/\b\d{2,}\b/g) ?? [];
    properNouns.forEach(e => entities.add(e.toLowerCase()));
    identifiers.forEach(e => entities.add(e.toLowerCase()));
    numbers.forEach(e => entities.add(e));
    return entities;
  }
  ```
- 在 `HybridSearchIndex` 构造函数中预计算每个 fact 的实体集合 `entitySet: Set<string>`
- 在 `search()` 中新增实体排名路径：
  ```typescript
  const queryEntities = extractEntities(queryText);
  const entityRanked = this.facts
    .map(f => ({ factId: f.fact.factId, entityScore: jaccard(queryEntities, f.entitySet) }))
    .filter(e => e.entityScore > 0)
    .sort((a, b) => b.entityScore - a.entityScore);
  ```
- 扩展 `HybridSearchFusionOptions`：添加 `wEntity?: number`（默认 0.5）
- 扩展 `OPTIMAL_HYBRID_FUSION`：添加 `wEntity: 0.5`
- RRF 融合扩展为三路：`rrf = wBm25/(k+bm25Rank) + wVector/(k+vecRank) + wEntity/(k+entityRank)`，归一化除以 pathCount（1/2/3）

**验证：**
- 扩展 `runtime-memory-mvp-module-b-ablation-test.test.ts` 新增 5-8 个三信号变体
- 验证三信号 no-harm（MRR ≥ W19 基线）
- 新增测试 `tests/unit/runtime-memory-three-signal-retrieval.test.ts`：专有名词查询、标识符查询、混合查询

#### 3.2 时序查询操作符
**文件：** `openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts`

**问题：** L2 的 `preFilter` 有 `referenceTime` 过滤，但不参与排序。Zep 的 bi-temporal 模型支持 "在时间点 X 我们知道什么" 查询。

**改动：**
- 扩展 `HybridSearchQuery`：添加 `temporalMode?: "filter" | "boost" | "strict"`
  - `filter`（默认，当前行为）：过滤掉 `valid_at > referenceTime` 或已失效的事实
  - `boost`：在过滤基础上，对接近 `referenceTime` 的事实加分（时间衰减函数）
  - `strict`：只返回在 `referenceTime` 时刻有效的事实（`valid_at ≤ referenceTime < invalid_at`）
- `boost` 模式评分：
  ```typescript
  const timeDelta = Math.abs(referenceTime - fact.valid_at);
  const temporalBoost = Math.exp(-timeDelta / (30 * 86400 * 1000)); // 30天半衰期
  rrf *= (1 + 0.1 * temporalBoost); // 最多 10% 加成
  ```

**验证：**
- 新增测试 `tests/unit/runtime-memory-temporal-query.test.ts`：
  - 注入带 `valid_at`/`invalid_at` 的事实
  - `filter` 模式：验证未来事实被过滤
  - `boost` 模式：验证接近 referenceTime 的事实排名提升
  - `strict` 模式：验证只返回 referenceTime 时刻有效的事实
- 扩展 ablation 测试验证 boost 不破坏 no-harm

---

### Phase 4: 记忆分类法（LangMem + Letta 思想）

**目标：** 引入 semantic/episodic/procedural 三分法，不同类型有不同的写入、淘汰、检索策略。

#### 4.1 记忆类型扩展
**文件：** `openclaw_runtime/src/runtime-core/memory-context.ts`

**改动：**
- 扩展 `RuntimeMemoryTemporalFactCandidate`：
  ```typescript
  export type RuntimeMemoryType = "semantic" | "episodic" | "procedural";

  export interface RuntimeMemoryTemporalFactCandidate {
    // ... 现有字段 ...
    memoryType?: RuntimeMemoryType; // 默认 "semantic"
  }
  ```
- 类型语义：
  - `semantic`：稳定事实（用户偏好、属性、知识）——慢淘汰，高 importance 权重
  - `episodic`：时间事件（何时发生了什么）——时间衰减，中等淘汰
  - `procedural`：习得行为（什么有效/无效，来自用户反馈）——最高保留优先级

**文件：** `openclaw_runtime/src/runtime-core/memory-persistence.ts`
- 在 `runtime_memory_facts` 表添加 `memory_type TEXT DEFAULT 'semantic'` 列
- Migration：`ALTER TABLE runtime_memory_facts ADD COLUMN memory_type TEXT DEFAULT 'semantic'`
- `record_json` 中也存储 `memoryType` 字段

#### 4.2 类型感知淘汰策略
**文件：** `openclaw_runtime/src/runtime-core/memory-store.ts`

**改动：** 修改 `trimFactsByImportance` 的评分函数：
```typescript
function scoreFactForEviction(fact, now, usageStats) {
  const baseImportance = computeImportance(fact);
  const recencyScore = sigmoidRecency(fact, now);

  // 类型感知权重
  const typeWeights = {
    semantic: { importance: 0.7, recency: 0.1, usage: 0.2 },
    episodic: { importance: 0.3, recency: 0.6, usage: 0.1 },
    procedural: { importance: 0.8, recency: 0.05, usage: 0.15 },
  };
  const w = typeWeights[fact.memoryType ?? "semantic"];
  return baseImportance * w.importance + recencyScore * w.recency + usageScore * w.usage;
}
```

**效果：**
- procedural 事实最难被淘汰（importance 权重 0.8）
- episodic 事实按时间衰减为主（recency 权重 0.6）
- semantic 事实按重要性为主（importance 权重 0.7）

#### 4.3 类型感知检索插槽
**文件：** `openclaw_runtime/src/context-engine/memory-context-provider.ts`

**改动：** 在 `getMemoryContext` 中按类型分配检索配额：
```typescript
const slots = {
  semantic: { limit: 4, sortBy: "importance" },      // 稳定事实总是有用
  episodic: { limit: 2, sortBy: "recency+relevance" }, // 最近相关事件
  procedural: { limit: 2, sortBy: "usage+relevance" }, // 常用行为模式
};
```
每个插槽独立检索，合并后按 token 预算截断。

#### 4.4 自编辑记忆接口（Letta 思想）
**新文件：** `openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts`

**设计：**
```typescript
export interface MemorySelfEditTool {
  name: "memory_recall" | "memory_update" | "memory_forget" | "memory_strengthen";
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: unknown, store: RuntimeMemoryStore) => Promise<ToolResult>;
}
```
- `memory_recall(query)`：主动检索记忆
- `memory_update(factId, newInfo)`：更新事实（触发 SUPERSEDE）
- `memory_forget(factId)`：主动遗忘（标记 invalid_at）
- `memory_strengthen(factId)`：增强事实 importance（基于用户正向反馈）

**集成：** 作为 OpenClaw 工具注册，agent 可在对话中主动调用。第一阶段只实现接口和测试，不接入实际 agent 工具注册系统。

**验证：**
- 新增测试 `tests/unit/runtime-memory-taxonomy.test.ts`：验证三种类型的淘汰优先级
- 新增测试 `tests/unit/runtime-memory-self-edit.test.ts`：验证 4 个自编辑工具
- 扩展 deep test 测量类型分布和类型感知淘汰效果

---

## Assumptions & Decisions

1. **保持纯 TS：** 不引入 ONNX/FTS5 原生依赖。实体提取用简单正则，向量用字符 3-gram。所有优化在纯 TS 层完成，保持可测试性。

2. **W19 作为基线：** 三信号融合扩展 `OPTIMAL_HYBRID_FUSION`，但 W19 的 k=0 + 归一化 + 非对称权重策略保持不变。新信号（实体）作为可选增强，默认启用但可关闭。

3. **渐进式迁移：** `memoryType` 字段可选（默认 "semantic"），不破坏现有事实。Migration 是加列，不重组数据。

4. **后台合并不阻塞写入：** `runConsolidation` 设计为可异步调用的独立函数，不在写入路径中同步执行。由上层调度（如每 N 次写入后或空闲时）。

5. **不实现完整的知识图谱：** 保持事实模型，不引入图结构。supersession 通过 invalidation 实现，不是图节点删除。

6. **不实现 LLM-in-the-loop 重排：** 检索排序保持确定性（BM25 + 向量 + 实体 + 时序），不在检索路径中调用 LLM。LLM 只用于写入策展和评测。

7. **自编辑工具只实现接口：** Phase 4.4 只实现工具接口和单元测试，不接入 OpenClaw agent 工具注册系统（那是后续工作）。

8. **异步 I/O 暂不实现：** Phase 1 聚焦使用频率跟踪和索引缓存（快速见效）。异步 I/O 改造影响面大（所有 persistence 调用），留待独立 PR。

---

## Verification Steps

### 每个 Phase 的验证

**Phase 1:**
```powershell
# 新增测试
pnpm exec vitest run tests/unit/runtime-memory-usage-tracking.test.ts tests/unit/runtime-memory-index-cache.test.ts --reporter=verbose
# 回归
pnpm run eval:runtime-memory:round2  # 105 + 新增测试全通过，成熟度 ≥0.95
```

**Phase 2:**
```powershell
# 新增测试
pnpm exec vitest run tests/unit/runtime-memory-supersession.test.ts tests/unit/runtime-memory-background-consolidation.test.ts --reporter=verbose
# 回归
pnpm run eval:runtime-memory:round2  # 不破坏现有 105 测试
pnpm exec vitest run tests/unit/runtime-memory-mvp-deep-test.test.ts --reporter=verbose  # supersession 测量
```

**Phase 3:**
```powershell
# 三信号消融
pnpm exec vitest run tests/unit/runtime-memory-mvp-module-b-ablation-test.test.ts --reporter=verbose  # 新增变体 no-harm
# 新增测试
pnpm exec vitest run tests/unit/runtime-memory-three-signal-retrieval.test.ts tests/unit/runtime-memory-temporal-query.test.ts --reporter=verbose
```

**Phase 4:**
```powershell
# 新增测试
pnpm exec vitest run tests/unit/runtime-memory-taxonomy.test.ts tests/unit/runtime-memory-self-edit.test.ts --reporter=verbose
# 回归
pnpm run eval:runtime-memory:round2  # 全通过
pnpm run typecheck  # 类型安全
```

### 最终验证
```powershell
# 完整 Round 2 评测
$env:RUNTIME_MEMORY_REAL_LLM="1"; pnpm run eval:runtime-memory:round2
# Deep test 测量所有新能力
pnpm exec vitest run tests/unit/runtime-memory-mvp-deep-test.test.ts --reporter=verbose
# Typecheck
pnpm run typecheck
# Lint
pnpm run lint
```

### 成功标准
1. 所有现有 105 测试继续通过（no-harm）
2. 新增 ~20-30 个测试覆盖新功能
3. 成熟度评分从 0.892 提升到 ≥0.95
4. Deep test 展示：supersession 废止率、后台合并剪枝率、三信号 MRR 提升、时序查询准确性、类型感知淘汰保留率
5. Typecheck + Lint 零错误

---

## Implementation Order

```
Phase 1 (生产基础)          Phase 2 (生命周期)         Phase 3 (检索增强)        Phase 4 (分类法)
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐      ┌──────────────────┐
│ 1.1 使用频率跟踪 │ ────▶ │ 2.1 Supersession │ ────▶ │ 3.1 三信号融合   │ ───▶ │ 4.1 类型字段     │
│ 1.2 索引缓存     │       │ 2.2 后台合并     │       │ 3.2 时序查询     │      │ 4.2 类型淘汰     │
│ 1.3 评分天花板   │       │                  │       │                  │      │ 4.3 类型检索     │
└──────────────────┘       └──────────────────┘       └──────────────────┘      │ 4.4 自编辑接口   │
        │                          │                          │                 └──────────────────┘
        ▼                          ▼                          ▼                          ▼
   usage tracking             冲突检测 + 剪枝            实体信号 + 时序             三分法 + 自编辑
   为 2.2 提供数据            依赖 1.1 usage              依赖 W19 基线              依赖 1.1/2.1/3.1
```

**依赖关系：**
- Phase 1.1 (usage tracking) → Phase 2.2 (后台合并需要 usage 数据)
- Phase 2.1 (supersession) → Phase 4.2 (类型淘汰需要冲突废止)
- Phase 3.1 (三信号) → Phase 4.3 (类型检索用三信号)
- Phase 1-3 可以部分并行，Phase 4 依赖前三个 Phase 的基础设施
