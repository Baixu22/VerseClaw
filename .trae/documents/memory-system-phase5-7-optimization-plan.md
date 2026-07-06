# 记忆系统 Phase 5-7 优化计划

> **状态**：已批准，待实施
> **范围**：Embedding 能力接入（Phase 5）、轻量关系链（Phase 6）、LoCoMo 基准（Phase 7）
> **前置条件**：Phase 1-4 已完成（usage 频率追踪、索引缓存、评分上限、记忆分类法）

---

## 一、当前状态分析

### 1.1 Embedding 基础设施现状

**已有成熟能力**（位于 `extensions/memory-core` 和 `plugins/`）：
- `MemoryEmbeddingProvider` 接口（`openclaw_runtime/src/plugins/memory-embedding-providers.ts:38-52`）：`embedQuery` / `embedBatch` / `embedBatchInputs` / `close`
- 9+ Provider 适配器通过 `registerMemoryEmbeddingProvider` 注册到进程级 Symbol map
- `createEmbeddingProvider(options)` 工厂（`extensions/memory-core/src/memory/embeddings.ts:187-226`）：支持 `provider` + `fallback` 双路径
- sqlite-vec `vec0` 虚拟表 KNN 搜索（`extensions/memory-core/src/memory/manager-search.ts:130-225`）：oversampling ×8，`vec_distance_cosine` 距离，score = 1 - dist
- 向量持久化（`manager-vector-write.ts`）：`Float32Array` → `Buffer` 存入 `chunks_vec` 表
- 默认 Provider：`"openai"`（`embeddings.ts:37`）

**runtime-core 层缺口**：
- `HybridSearchIndex`（`memory-hybrid-retrieval.ts:288`）当前使用 character 3-gram TF-IDF 作为向量路径（lines 13-15 明确标注为 swap point）
- 构造函数签名：`constructor(facts: readonly RuntimeMemoryQueryableFact[])` — 无 Provider 注入点
- `hybridSearchFacts()` 为同步函数 — 无法支持异步 embedding 调用
- runtime-core **不能** import `extensions/` 或 `plugins/`（已验证零反向 import），必须依赖注入

### 1.2 关系链现状

**完全不存在关系图代码**。最接近的：
- `RuntimeMemoryInvalidationProposal.replacementFactId`（`memory-context.ts:255`）— 隐式 supersede→successor 边，但非通用关系类型
- `memory-write-curation.ts` 的 AUDN 已能检测冲突（`detectConflict` lines 86-105，negation regex + Jaccard 差异 ≥ 0.3）并产出 SUPERSEDE/UPDATE 动作，但结果只存为 invalidation，不存为显式关系

**后果**：记忆成为孤岛，相同实体的多个 fact 之间无显式连接，检索时无法 1-hop 扩展，导致冗余信息共存。

### 1.3 LoCoMo 基准现状

- **零实现**：无测试文件、无 fixture、无下载逻辑
- 仅两份规划文档引用：`net use/mem.md`（lines 680-730）和本文件
- 成熟度评分（`tests/unit/helpers/runtime-memory-maturity-score.ts`）：15 层（L1-L10 + CV1-CV5），7 维度，阈值 ≥0.7
- 添加 L11 需扩展：`LayerId` union（L15-18）、`EXPECTED_LAYERS`（L65-69）、`buildAllPassScenario`（L209-259）
- 添加 `externalBenchmark` 维度需扩展：`MaturityDimension` union（L42-49）、`DIMENSION_WEIGHTS`（L80-88，需重新平衡至 sum=1.00）、`dimensions` 对象（L173-181）、计算块（L122-171）

### 1.4 用户决策（已确认）

| 决策点 | 选择 | 说明 |
|--------|------|------|
| Embedding 接入方式 | 复用现有 Provider | Settings 页面提供开关，默认关闭→优雅降级到 3-gram TF-IDF |
| 关系链模式 | 自动 + 工具 | 写时自动生成 + 读时 1-hop 扩展 + `memory_find_related` 工具 |
| LoCoMo 规模 | 完整 5×50 | 5 对话 × 50 问题，~250 LLM 调用，可与 Mem0 论文对比 |
| LoCoMo 数据源 | 公开仓库下载 | `snap-research/locomo`，存入 `tests/fixtures/locomo/` |

---

## 二、Phase 5：Embedding 能力接入

### 设计原则
- **依赖注入**：runtime-core 定义接口，上层适配，不破坏分层
- **优雅降级**：无 Provider 时回退到 3-gram TF-IDF，保证 704 现有测试零回归
- **用户可控**：Settings 页面开关，默认关闭，用户配置 API Key 后可启用

### 5.1 定义 RuntimeEmbeddingProvider 接口

**文件**：`openclaw_runtime/src/runtime-core/memory-embedding-provider.ts`（新建）

```typescript
export type RuntimeEmbeddingProvider = {
  id: string;
  dimension: number;
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
  close?: () => Promise<void> | void;
};

export const NO_EMBEDDING_PROVIDER: unique symbol = Symbol("no-embedding");
export type EmbeddingProviderOrNone = RuntimeEmbeddingProvider | typeof NO_EMBEDDING_PROVIDER;

export function isEmbeddingProviderAvailable(
  provider: EmbeddingProviderOrNone,
): provider is RuntimeEmbeddingProvider {
  return provider !== NO_EMBEDDING_PROVIDER;
}
```

**导出**：在 `openclaw_runtime/src/runtime-core/index.ts` 添加 re-export

### 5.2 修改 HybridSearchIndex 接受 Provider

**文件**：`openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts`

**改动点**：
1. `HybridSearchIndex` 构造函数新增可选参数 `embeddingProvider?: EmbeddingProviderOrNone`
2. 当有 Provider 时：构造时预计算所有 fact 的 embedding（`embedBatch`），查询时用 `embedQuery` 替代 `tfidfVector(characterNgrams(queryText))`
3. 当无 Provider 时：保持现有 3-gram TF-IDF 行为（零回归）
4. `search()` 方法保持同步（embedding 已预计算并缓存）
5. `hybridSearchFacts()` 保持同步（索引缓存命中时同步返回）

**关键实现细节**：
- 新增 `async buildHybridSearchIndex(facts, embeddingProvider?)` 异步工厂函数，用于需要 embedding 的场景
- 现有 `new HybridSearchIndex(facts)` 同步构造保留，内部走 3-gram 路径
- `getCachedHybridSearchIndex()` 缓存 key 加入 provider id + dimension，避免不同 Provider 混用
- embedding 向量存为 `Float32Array`，cosine similarity 用 `dotProduct / (normA * normB)`

**文件**：`openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts` lines 288-316（构造函数）、lines 318-400（search 方法）、lines 162-189（hybridSearchFacts）、lines 192-226（缓存）

### 5.3 Embedding 持久化

**文件**：`openclaw_runtime/src/runtime-core/memory-persistence.ts`

**新增表**：`runtime_memory_embeddings`
```sql
CREATE TABLE IF NOT EXISTS runtime_memory_embeddings (
  fact_id TEXT NOT NULL PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  embedding BLOB NOT NULL,  -- Float32Array → Buffer
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (fact_id) REFERENCES runtime_memory_facts(fact_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runtime_memory_embeddings_provider
  ON runtime_memory_embeddings(provider_id, model);
```

**迁移函数**：`migrateRuntimeMemoryEmbeddingsTable(db)` — 使用现有 `PRAGMA table_info` + `CREATE TABLE IF NOT EXISTS` 幂等模式

**Schema 版本**：保持 `RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION = 1`（增量迁移，不破坏现有 schema）

**读写 API**：
- `replaceRuntimeMemoryEmbedding({ db, factId, providerId, model, dimension, embedding })` — DELETE + INSERT 模式（参照 `manager-vector-write.ts`）
- `getRuntimeMemoryEmbedding({ db, factId, providerId, model })` — 返回 `Float32Array | null`
- `deleteRuntimeMemoryEmbedding({ db, factId })` — fact 删除时级联清理

**缓存失效**：`appendFact` 后若 embedding 已变化，需删除旧 embedding；`invalidateFact` 时删除对应 embedding

### 5.4 上层适配器 + 接线

**文件**：`openclaw_runtime/extensions/memory-core/src/memory/runtime-embedding-adapter.ts`（新建）

```typescript
import type { RuntimeEmbeddingProvider } from "../../../../../src/runtime-core/memory-embedding-provider.js";
import type { MemoryEmbeddingProvider } from "../../../../../src/plugins/memory-embedding-providers.js";

export function adaptMemoryEmbeddingProvider(
  provider: MemoryEmbeddingProvider,
): RuntimeEmbeddingProvider {
  return {
    id: provider.id,
    dimension: 0, // 从首次 embedBatch 结果推断
    embedQuery: (text) => provider.embedQuery(text),
    embedBatch: (texts) => provider.embedBatch(texts),
    close: provider.close,
  };
}
```

**接线点**：`extensions/memory-core/src/memory/manager-provider-state.ts`（L123, L130 附近）
- 在创建 `MemoryEmbeddingProvider` 后，调用 `adaptMemoryEmbeddingProvider` 转换
- 传入 `RuntimeMemoryStore` 或 `HybridSearchIndex` 构造时

**Context Provider 接线**：`openclaw_runtime/src/context-engine/memory-context-provider.ts`
- `getContext()` 中构建索引时，若 embedding 启用则调用 `buildHybridSearchIndex(facts, provider)`，否则走同步路径
- 新增配置项 `embeddingEnabled: boolean`（从 Settings 读取）

### 5.5 Settings 页面开关

**文件**：
- `shared/host-api/contract.ts` — 新增 host route `memory:getEmbeddingConfig` / `memory:setEmbeddingConfig`
- `electron/services/agent-dev-api.ts` — 实现上述 route
- `src/lib/host-api.ts` — 暴露 renderer 调用入口
- `src/components/settings/MemorySettingsPanel.tsx`（新建或扩展）— Embedding 开关 + Provider 选择 + 模型显示

**配置结构**：
```typescript
type MemoryEmbeddingConfig = {
  enabled: boolean;           // 默认 false
  providerId?: string;        // 复用现有 AI Provider 配置
  model?: string;
};
```

**配置存储**：`electron-store` key `memory.embeddingConfig`

**i18n**：`shared/i18n/locales/{en,zh,ja,ru}/settings.json` 添加翻译 key

### 5.6 验证 + RRF 重调

**测试文件**：`tests/unit/runtime-memory-embedding-integration.test.ts`（新建）

**测试用例**：
1. 无 Provider 时 `HybridSearchIndex` 走 3-gram 路径，结果与现有完全一致（回归保证）
2. Mock Provider 时 embedding 向量被正确预计算和缓存
3. Embedding 持久化读写正确，fact 删除时级联清理
4. 适配器正确转换 `MemoryEmbeddingProvider` → `RuntimeEmbeddingProvider`
5. Settings 开关关闭时走 3-gram，开启时走 embedding

**RRF 重调**：`tests/unit/runtime-memory-embedding-ablation.test.ts`（新建）
- 对比 3-gram TF-IDF vs mock embedding（使用确定性 hash embedding 模拟）的 MRR / Recall@5
- 验证 `OPTIMAL_HYBRID_FUSION` 参数在 embedding 路径下是否需要调整（预期：embedding 质量更高，wVector 可提升至 1.5）
- 无害保证：embedding 启用时 MRR ≥ 3-gram 基线

---

## 三、Phase 6：轻量关系链

### 设计原则
- **三种关系类型**：`supersedes`（AUDN SUPERSEDE/UPDATE）、`contradicts`（AUDN 冲突检测）、`related_to`（embedding 语义相似）
- **写时自动生成**：AUDN 决策时同步写入关系，无需额外批处理
- **读时预算受限**：1-hop 扩展最多 2 个 fact，不挤占主检索槽位
- **工具补充**：`memory_find_related` 供 Agent 主动深挖

### 6.1 关系表 + 迁移

**文件**：`openclaw_runtime/src/runtime-core/memory-persistence.ts`

**新增表**：`runtime_memory_fact_relations`
```sql
CREATE TABLE IF NOT EXISTS runtime_memory_fact_relations (
  relation_id TEXT NOT NULL PRIMARY KEY,
  source_fact_id TEXT NOT NULL,
  target_fact_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,  -- 'supersedes' | 'contradicts' | 'related_to'
  confidence REAL NOT NULL,     -- 0.0-1.0
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (source_fact_id) REFERENCES runtime_memory_facts(fact_id) ON DELETE CASCADE,
  FOREIGN KEY (target_fact_id) REFERENCES runtime_memory_facts(fact_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runtime_memory_relations_source
  ON runtime_memory_fact_relations(source_fact_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_runtime_memory_relations_target
  ON runtime_memory_fact_relations(target_fact_id, relation_type);
```

**迁移函数**：`migrateRuntimeMemoryFactRelationsTable(db)` — 幂等

### 6.2 类型定义

**文件**：`openclaw_runtime/src/runtime-core/memory-context.ts`

```typescript
export type RuntimeMemoryRelationType = "supersedes" | "contradicts" | "related_to";

export type RuntimeMemoryFactRelation = {
  relationId: string;
  sourceFactId: string;
  targetFactId: string;
  relationType: RuntimeMemoryRelationType;
  confidence: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export const RUNTIME_MEMORY_RELATION_TYPES: readonly RuntimeMemoryRelationType[] = [
  "supersedes", "contradicts", "related_to",
];

export function isRuntimeMemoryRelationType(v: unknown): v is RuntimeMemoryRelationType {
  return typeof v === "string" && RUNTIME_MEMORY_RELATION_TYPES.includes(v as RuntimeMemoryRelationType);
}
```

### 6.3 写时关系生成

**文件**：`openclaw_runtime/src/runtime-core/memory-store.ts`

**新增方法**：
- `appendRelation(relation: Omit<RuntimeMemoryFactRelation, "relationId" | "createdAt">): string`
- `queryRelations(factId: string, type?: RuntimeMemoryRelationType): RuntimeMemoryFactRelation[]`
- `queryReverseRelations(factId: string, type?: RuntimeMemoryRelationType): RuntimeMemoryFactRelation[]`

**接线点**：`openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`（AUDN 调用处，L252 附近 `buildSupersedeInvalidation`）

**生成逻辑**：
1. **AUDN SUPERSEDE** → 写入 `supersedes` 关系（new fact → old fact，confidence = 1.0）
2. **AUDN UPDATE** → 写入 `supersedes` 关系（new fact → old fact，confidence = 0.9）
3. **detectConflict 命中** → 写入 `contradicts` 关系（new fact ↔ old fact，confidence = 1 - Jaccard）
4. **related_to**（可选，Phase 5 embedding 就绪后）→ 当 embedding cosine similarity ≥ 0.75 时写入（confidence = similarity）

**幂等性**：同一 (source, target, type) 三元组只保留一条，重复写入时更新 confidence

**限制**：每个 fact 最多 10 条 outgoing 关系（防止关系爆炸），超出时保留 confidence 最高的 10 条

### 6.4 读时 1-hop 扩展

**文件**：`openclaw_runtime/src/context-engine/memory-context-provider.ts`

**插入点**：`getContext()` L172（`findRuntimeMemoryFacts`）之后、L173（`applyTypeAwareSlots`）之前

**实现**：
```typescript
// 1-hop relation expansion (budget-limited)
const MAX_RELATION_EXPANSIONS = 2;
const expandedFacts = expandOneHopRelations(matchedFacts, store, {
  maxExpansions: MAX_RELATION_EXPANSIONS,
  excludeRelationTypes: [], // 可配置排除某些关系类型
});
const slottedFacts = applyTypeAwareSlots(expandedFacts, query);
```

**扩展策略**：
- 对 matchedFacts 中每个 fact 查询 `queryRelations` + `queryReverseRelations`
- 收集所有关联 fact，去重（不在 matchedFacts 中）
- 按 relation_type 优先级排序：`supersedes` > `contradicts` > `related_to`
- 按 confidence 降序排序
- 取前 `MAX_RELATION_EXPANSIONS` 个，追加到 matchedFacts 末尾（不挤占 type-aware 槽位，作为补充上下文）
- 标记 `metadata.relationExpansion = true`，便于 buildSummary 区分

**预算保护**：扩展 fact 不计入 `MEMORY_TYPE_SLOTS`（semantic 4 / episodic 2 / procedural 2），作为额外补充

### 6.5 memory_find_related 工具

**文件**：`openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts`

**新增工具**：
```typescript
export const memoryFindRelatedTool: MemorySelfEditTool = {
  name: "memory_find_related",
  description: "Find facts related to a given fact via relation chain (1-hop or 2-hop). Useful for exploring memory connections.",
  parameters: {
    type: "object",
    properties: {
      factId: { type: "string", description: "The fact ID to find relations for" },
      relationType: {
        type: "string",
        enum: ["supersedes", "contradicts", "related_to"],
        description: "Optional filter by relation type",
      },
      hops: { type: "number", minimum: 1, maximum: 2, default: 1, description: "Number of hops (1 or 2)" },
      limit: { type: "number", minimum: 1, maximum: 20, default: 10 },
    },
    required: ["factId"],
  },
  execute: async (args, ctx) => { /* ... */ },
};
```

**更新**：
- `MemorySelfEditToolName` 添加 `"memory_find_related"`（L29-33）
- `MEMORY_SELF_EDIT_TOOLS` 数组添加 `memoryFindRelatedTool`（L446）
- 2-hop 支持：对 1-hop 结果再次 `queryRelations`，去重，限制总数 ≤ limit

### 6.6 验证测试

**文件**：`tests/unit/runtime-memory-relations.test.ts`（新建）

**测试用例**：
1. 关系表迁移幂等性
2. `appendRelation` 写入 + `queryRelations` 查询正确
3. AUDN SUPERSEDE/UPDATE 自动生成 `supersedes` 关系
4. `detectConflict` 命中自动生成 `contradicts` 关系
5. 1-hop 扩展：matchedFacts 中的 fact 有关联 fact 时，扩展 fact 被追加
6. 预算限制：扩展 fact 不超过 `MAX_RELATION_EXPANSIONS`
7. `memory_find_related` 工具返回正确关联 fact
8. 2-hop 遍历正确且无环
9. fact 删除时关系级联清理
10. 关系爆炸防护：单 fact 最多 10 条 outgoing 关系

---

## 四、Phase 7：LoCoMo 基准

### 设计原则
- **真实短板诊断**：不只是跑分，要定位哪些问题类型表现差
- **可比性**：使用与 Mem0 论文相同的指标（Recall@5/F1/BLEU-1）
- **可重复**：fixture 固化，不依赖网络
- **成熟度集成**：作为 L11 层 + `externalBenchmark` 维度

### 7.1 数据集获取

**来源**：`https://github.com/snap-research/locomo`

**Fixture 存储**：`tests/fixtures/locomo/`
```
tests/fixtures/locomo/
  ├── README.md           # 数据集说明、来源、许可证
  ├── conversations.json  # 5 个对话（每个 ~600 turns）
  └── questions.json      # 250 个问题（5 对话 × 50 问题）
```

**获取方式**：手动下载 + 预处理脚本 `scripts/download-locomo.mjs`
- 从 GitHub raw 下载原始数据
- 预处理：提取 conversation_id / turn_id / speaker / text + question_id / conversation_id / question / answer / category
- 固化为 JSON fixture

**问题类型分布**（与论文一致）：
- single-hop: 40% (100 题)
- multi-hop: 25% (62 题)
- open-ended: 20% (50 题)
- adversarial: 15% (38 题)

### 7.2 基准测试实现

**文件**：`tests/unit/runtime-memory-locomo-benchmark.test.ts`（新建）

**测试结构**：
```typescript
// @vitest-environment node
describe.skipIf(!hasDeepSeekKey())("L11: LoCoMo benchmark — external dataset", () => {
  // 1. 加载 fixture
  // 2. 对每个对话：模拟写入记忆（将对话 turns 转为 facts）
  // 3. 对每个问题：检索记忆 → LLM 生成答案 → 评分
  // 4. 按问题类型聚合指标
});
```

**流程**：
1. **记忆写入**：将对话的每个 turn 转换为 episodic fact（subject=speaker, predicate=said, objectSummary=turn text），通过 `appendFact` + AUDN 写入
2. **检索**：用问题文本作为 query，调用 `findRuntimeMemoryFacts`（topK=5）
3. **LLM 生成**：将检索到的 facts 作为 context，调用 DeepSeek 生成答案
4. **评分**：
   - **Recall@5**：ground truth answer 中的关键实体是否出现在 top-5 检索结果中
   - **F1**：token-level F1 between generated answer and ground truth
   - **BLEU-1**：unigram BLEU between generated answer and ground truth

**指标计算**：复用 `tests/unit/helpers/runtime-memory-maturity-score.ts` 中的统计 helper

**目标**：
- Recall@5 ≥ 0.70（vs Mem0 论文 92.5%）
- F1 ≥ 0.40
- 按问题类型细分：single-hop > multi-hop > open-ended > adversarial

### 7.3 成熟度评分集成

**文件**：`tests/unit/helpers/runtime-memory-maturity-score.ts`

**改动**：
1. `LayerId` union（L15-18）添加 `"L11"`
2. `EXPECTED_LAYERS`（L65-69）追加 `"L11"`
3. `MaturityDimension` union（L42-49）添加 `"externalBenchmark"`
4. `DIMENSION_WEIGHTS`（L80-88）重新平衡：
   ```typescript
   const DIMENSION_WEIGHTS = {
     correctness: 0.20,        // 0.22 → 0.20
     statisticalRigor: 0.12,   // 0.13 → 0.12
     antiOverfitting: 0.16,    // 0.18 → 0.16
     antiHallucination: 0.16,  // 0.18 → 0.16
     coverage: 0.08,           // 0.09 → 0.08
     crossValidation: 0.08,    // 0.09 → 0.08
     retrievalQuality: 0.10,   // 0.11 → 0.10
     externalBenchmark: 0.10,  // 新增
   }; // sum = 1.00
   ```
5. `dimensions` 对象（L173-181）添加 `externalBenchmark` 计算块
6. `buildAllPassScenario`（L209-259）添加 L11 pass scenario

**externalBenchmark 计算逻辑**：
- L11 通过（Recall@5 ≥ 0.70）→ dimension score = 1.0
- L11 部分通过（0.50 ≤ Recall@5 < 0.70）→ dimension score = 0.5
- L11 失败（Recall@5 < 0.50）→ dimension score = 0.0
- L11 跳过（无 LLM key）→ dimension 不计入（不触发 `hollow_llm` disqualifier，因为是外部基准）

### 7.4 报告生成 + 脚本

**报告输出**：`artifacts/runtime-memory-eval/locomo-report.json`
```json
{
  "dataset": "locomo",
  "version": "1.0",
  "totalQuestions": 250,
  "metrics": {
    "overall": { "recall_at_5": 0.0, "f1": 0.0, "bleu1": 0.0 },
    "byCategory": {
      "single_hop": { "count": 100, "recall_at_5": 0.0, "f1": 0.0, "bleu1": 0.0 },
      "multi_hop": { "count": 62, "recall_at_5": 0.0, "f1": 0.0, "bleu1": 0.0 },
      "open_ended": { "count": 50, "recall_at_5": 0.0, "f1": 0.0, "bleu1": 0.0 },
      "adversarial": { "count": 38, "recall_at_5": 0.0, "f1": 0.0, "bleu1": 0.0 }
    }
  },
  "shortcomings": [],
  "generatedAt": "2026-07-01T00:00:00Z"
}
```

**package.json 脚本**：
```json
"eval:runtime-memory:locomo": "pnpm exec vitest run tests/unit/runtime-memory-locomo-benchmark.test.ts --reporter=verbose"
```

### 7.5 短板分析

**目标**：通过 LoCoMo 结果定位真实短板，输出到 `locomo-report.json` 的 `shortcomings` 字段

**分析维度**：
1. **问题类型短板**：哪种问题类型 Recall@5 最低？
   - 预期：adversarial 最差（需要时序推理 + 冲突检测）
   - 预期：multi-hop 较差（需要关系链，验证 Phase 6 关系链的价值）
2. **检索 vs 生成短板**：
   - Recall@5 低 → 检索短板（embedding/RRF 问题）
   - Recall@5 高但 F1 低 → 生成短板（LLM 能力问题，非记忆系统问题）
3. **时序短板**：adversarial 题涉及 "之前是 X，后来变成 Y"，验证 bi-temporal model 有效性
4. **关系链短板**：multi-hop 题需要关联多个 fact，验证 Phase 6 关系链 1-hop 扩展是否提升 multi-hop 表现

**对比基线**：
| 方法 | Recall@5 | F1 | BLEU-1 | 来源 |
|------|----------|-----|--------|------|
| Mem0 | 92.5% | - | - | 论文 |
| LangMem | 68.3% | - | - | 论文 |
| Letta | 60.1% | - | - | 论文 |
| 本系统 | ? | ? | ? | LoCoMo 测试 |

---

## 五、实施顺序与依赖

```
Phase 5.1 (RuntimeEmbeddingProvider 接口)
    ↓
Phase 5.2 (HybridSearchIndex 修改) ← 独立于 Phase 6
    ↓
Phase 5.3 (Embedding 持久化) ← 独立于 Phase 6
    ↓
Phase 5.4 (上层适配器) ← 依赖 5.1
    ↓
Phase 5.5 (Settings 开关) ← 依赖 5.4
    ↓
Phase 5.6 (验证 + RRF 重调)

Phase 6.1 (关系表) ← 独立于 Phase 5
    ↓
Phase 6.2 (类型定义) ← 依赖 6.1
    ↓
Phase 6.3 (写时生成) ← 依赖 6.2
    ↓
Phase 6.4 (读时扩展) ← 依赖 6.3
    ↓
Phase 6.5 (memory_find_related) ← 依赖 6.3
    ↓
Phase 6.6 (验证)

Phase 7.1 (数据集获取) ← 独立于 Phase 5/6
    ↓
Phase 7.2 (基准测试) ← 建议在 Phase 5/6 完成后（能测到完整能力）
    ↓
Phase 7.3 (成熟度集成) ← 依赖 7.2
    ↓
Phase 7.4 (报告 + 脚本) ← 依赖 7.2
    ↓
Phase 7.5 (短板分析) ← 依赖 7.4
```

**并行机会**：Phase 5.1-5.3 与 Phase 6.1-6.2 可并行（互不依赖）

---

## 六、假设与决策

### 假设
1. 现有 704 个测试在无 embedding 时必须零回归（3-gram TF-IDF 路径保留）
2. LoCoMo 数据集许可证允许用于研究/测试（需在 fixture README 中注明）
3. DeepSeek API 可用于 LoCoMo LLM judge（复用现有 `hasDeepSeekKey()` 模式）
4. sqlite-vec 扩展在测试环境可用（现有 `manager-search.ts` 已依赖）

### 决策
1. **不引入 ONNX 本地模型**：避免增加 23MB 包体积，复用现有云端 Provider
2. **关系链仅 1-hop 自动扩展**：2-hop 通过 `memory_find_related` 工具手动触发
3. **LoCoMo 不在 CI 中运行**：成本高（~$2-5），通过 `describe.skipIf(!hasDeepSeekKey())` 保护
4. **embedding 预计算在索引构建时**：而非查询时，保证 `search()` 同步
5. **关系表与 fact 表分离**：不污染 `runtime_memory_facts`，便于独立查询和清理

---

## 七、验证步骤

### Phase 5 验证
```powershell
# 回归测试（无 embedding，必须全绿）
pnpm exec vitest run tests/unit/runtime-memory-*.test.ts --reporter=verbose

# Embedding 集成测试
pnpm exec vitest run tests/unit/runtime-memory-embedding-integration.test.ts --reporter=verbose

# RRF 重调消融
pnpm exec vitest run tests/unit/runtime-memory-embedding-ablation.test.ts --reporter=verbose

# Typecheck
pnpm run typecheck
```

### Phase 6 验证
```powershell
# 关系链测试
pnpm exec vitest run tests/unit/runtime-memory-relations.test.ts --reporter=verbose

# 回归测试
pnpm exec vitest run tests/unit/runtime-memory-*.test.ts --reporter=verbose

# Typecheck + Lint
pnpm run typecheck && pnpm run lint
```

### Phase 7 验证
```powershell
# LoCoMo 基准（需要 DEEPSEEK_API_KEY）
$env:DEEPSEEK_API_KEY="sk-..."; pnpm run eval:runtime-memory:locomo

# 成熟度评分（验证 L11 集成）
$env:DEEPSEEK_API_KEY="sk-..."; $env:RUNTIME_MEMORY_REAL_LLM="1"; pnpm run eval:runtime-memory:round2

# 查看报告
type artifacts\runtime-memory-eval\locomo-report.json
```

### 最终验证
```powershell
# 全量回归
pnpm exec vitest run tests/unit/runtime-memory-*.test.ts --reporter=verbose

# Typecheck + Lint + Contract
pnpm run typecheck && pnpm run lint && pnpm contract:check
```

---

## 八、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Embedding 异步化破坏现有同步 API | 高 | 预计算 + 缓存，`search()` 保持同步 |
| 关系链爆炸导致检索性能下降 | 中 | 单 fact 最多 10 条 outgoing，扩展最多 2 fact |
| LoCoMo Recall@5 远低于 0.70 | 中 | 短板分析定位问题，可能需要调优 RRF 或增加 topK |
| sqlite-vec 在某些环境不可用 | 低 | 现有 fallback 逻辑（batch scan + cosine）已存在 |
| DeepSeek API 限流 | 低 | 测试中加 200ms 间隔，复用现有 retry 逻辑 |

---

## 九、用户需要提供的信息

基于用户决策"用户自己配置接口"，实施时需要：

1. **DeepSeek API Key**：用于 LoCoMo LLM judge 测试（复用现有环境变量 `DEEPSEEK_API_KEY`）
2. **可选：OpenAI API Key**：用于验证 embedding 端到端流程（测试中可用 mock Provider 替代）
3. **无需提供其他材料**：LoCoMo 数据集由脚本自动下载，代码修改由我完成

**用户配置入口**（实施完成后）：
- Settings > Memory > Embedding：开关 + Provider 选择（复用现有 AI Provider 配置）
- 无需单独配置 embedding API Key（复用 AI Provider 的 Key）
