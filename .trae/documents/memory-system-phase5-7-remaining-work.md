# 记忆系统 Phase 5-7 剩余实施计划

> **状态**：待批准
> **范围**：在已完成的 Phase 5.1-5.2、6.1-6.3 基础上，完成 Phase 5.3-5.6、6.4-6.6、7.1-7.5
> **前置条件**：Phase 5.1（RuntimeEmbeddingProvider 接口）、5.2（HybridSearchIndex 双向量路径）、6.1（关系表）、6.2（关系类型）、6.3（写时关系生成）已落地并通过 typecheck

---

## 一、当前状态总结

### 已完成（已持久化，typecheck 通过）

| 阶段 | 文件 | 内容 |
|------|------|------|
| 5.1 | `runtime-core/memory-embedding-provider.ts` | `RuntimeEmbeddingProvider` 接口 + `NO_EMBEDDING_PROVIDER` 哨兵 + `isEmbeddingProviderAvailable` 类型守卫 |
| 5.1 | `runtime-core/index.ts` L19 | re-export `memory-embedding-provider.js` |
| 5.2 | `runtime-core/memory-hybrid-retrieval.ts` | `buildHybridSearchIndex()` 异步工厂、`searchWithEmbedding()` 方法、`hybridSearchFactsWithEmbedding()` 入口、`cosineEmbedding()` helper、`embeddingVec` 字段、`embeddingIndexCache` 缓存 |
| 6.1 | `runtime-core/memory-persistence.ts` | `runtime_memory_fact_relations` 表 SQL + `relationTableExists`/`readRelations`/`persistRelationRow` + `persistRelation()` 方法 + `loadStore()` 关系加载 |
| 6.2 | `runtime-core/memory-context.ts` | `RuntimeMemoryRelationType`、`RuntimeMemoryFactRelation`、`RUNTIME_MEMORY_RELATION_TYPES`、`isRuntimeMemoryRelationType` |
| 6.3 | `runtime-core/memory-store.ts` | `relationsById`/`relationOrder` 字段 + `appendRelation`/`queryRelations`/`queryReverseRelations`/`listAllRelations`/`trimRelationsForFact` 方法 |
| 6.3 | `runtime-core/memory-runtime-integration.ts` | AUDN UPDATE→`supersedes`(0.9)、SUPERSEDE→`supersedes`(1.0)+`contradicts`(0.8) 关系生成 + `persistRelation` port |

### 待完成（本计划范围）

- **Phase 5.3**：Embedding 持久化（`runtime_memory_embeddings` 表）
- **Phase 5.4**：上层适配器 + Context Provider 接线
- **Phase 5.5**：Settings 页面开关
- **Phase 5.6**：验证 + RRF 重调测试
- **Phase 6.4**：读时 1-hop 关系扩展
- **Phase 6.5**：`memory_find_related` 工具
- **Phase 6.6**：关系链验证测试
- **Phase 7.1**：LoCoMo 数据集获取
- **Phase 7.2**：LoCoMo 基准测试
- **Phase 7.3**：成熟度评分 L11 + `externalBenchmark` 维度集成
- **Phase 7.4**：报告生成 + 脚本
- **Phase 7.5**：短板分析

---

## 二、Phase 5 剩余：Embedding 能力接入

### 5.3 Embedding 持久化

**目标**：将 fact embedding 持久化到 SQLite，避免每次索引构建都重新调用 embedding API。

**文件**：`openclaw_runtime/src/runtime-core/memory-persistence.ts`

**改动**：
1. 在 `RUNTIME_MEMORY_PERSISTENCE_SCHEMA_SQL`（L304-421）的 `runtime_memory_fact_relations` 表之后追加：
   ```sql
   CREATE TABLE IF NOT EXISTS runtime_memory_embeddings (
     fact_id TEXT NOT NULL PRIMARY KEY,
     provider_id TEXT NOT NULL,
     model TEXT NOT NULL,
     dimension INTEGER NOT NULL,
     embedding BLOB NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     FOREIGN KEY (fact_id) REFERENCES runtime_memory_facts(fact_id) ON DELETE CASCADE
   );
   CREATE INDEX IF NOT EXISTS idx_runtime_memory_embeddings_provider
     ON runtime_memory_embeddings(provider_id, model);
   ```
2. 新增 helper 函数（参照 `persistRelationRow` 的 raw SQL 模式，因 Kysely 类型中无此表）：
   - `embeddingsTableExists(db): boolean` — 参照 `relationTableExists`（L998）
   - `readEmbedding(db, factId, providerId, model): Float32Array | null` — 读取 BLOB → `new Float32Array(buffer.buffer)`
   - `replaceEmbeddingRow(db, { factId, providerId, model, dimension, embedding, now })` — DELETE + INSERT（参照 `manager-vector-write.ts` L10-11 的 `Buffer.from(new Float32Array(embedding).buffer)` 模式）
   - `deleteEmbeddingRow(db, factId)` — fact 删除时级联清理
3. 在 `RuntimeMemoryPersistenceStore` 新增方法：
   - `replaceEmbedding(params): void` — 调用 `replaceEmbeddingRow`
   - `getEmbedding(factId, providerId, model): Float32Array | null` — 调用 `readEmbedding`
   - `deleteEmbedding(factId): void` — 调用 `deleteEmbeddingRow`
4. Schema 版本保持 `= 1`（增量 `CREATE TABLE IF NOT EXISTS`，幂等）

### 5.4 上层适配器 + Context Provider 接线

**目标**：将 `extensions/memory-core` 的 `MemoryEmbeddingProvider` 适配为 `RuntimeEmbeddingProvider`，并在 Context Provider 中按配置启用 embedding 路径。

**文件 A（新建）**：`openclaw_runtime/extensions/memory-core/src/memory/runtime-embedding-adapter.ts`

```typescript
import type { RuntimeEmbeddingProvider } from "../../../runtime-core/memory-embedding-provider.js";
import type { MemoryEmbeddingProvider } from "../../../plugins/memory-embedding-providers.js";

export function adaptMemoryEmbeddingProvider(
  provider: MemoryEmbeddingProvider,
  dimension: number,
): RuntimeEmbeddingProvider {
  return {
    id: provider.id,
    dimension,
    embedQuery: (text) => provider.embedQuery(text),
    embedBatch: (texts) => provider.embedBatch(texts),
    close: provider.close,
  };
}
```

> `dimension` 由调用方从首次 `embedBatch` 结果推断后传入（`MemoryEmbeddingProvider` 接口不暴露 dimension 字段）。

**文件 B**：`openclaw_runtime/src/context-engine/memory-context-provider.ts`

改动点：
1. `RuntimeMemoryContextProviderOptions`（L28-37）新增可选字段：
   ```typescript
   embeddingProvider?: EmbeddingProviderOrNone;
   embeddingEnabled?: boolean;
   ```
2. 在 `getContext()`（L137-224）中，L171-172 之间插入 embedding 路径选择：
   ```typescript
   const useEmbedding = options.embeddingEnabled === true &&
     options.embeddingProvider !== undefined &&
     isEmbeddingProviderAvailable(options.embeddingProvider);
   const matchedFacts = useEmbedding
     ? await findFactsWithEmbedding(options, facts, providerQuery)
     : findRuntimeMemoryFacts(facts, { ...providerQuery, limit: undefined });
   ```
3. 新增私有 helper `findFactsWithEmbedding()`：调用 `hybridSearchFactsWithEmbedding(facts, query, embeddingProvider)`，fallback 到 `findRuntimeMemoryFacts`。

**接线说明**：实际将 adapter 注入 Context Provider 的位置在 `extensions/memory-core` 的 manager 装配处（`manager.ts` L431-439 `applyProviderResult` 附近）。本阶段先完成接口和 Context Provider 侧的接线点，manager 装配在 Phase 5.5 Settings 开关完成后一并打通。

### 5.5 Settings 页面开关

**目标**：用户在 Settings > Memory 中可开启 embedding，选择 Provider，默认关闭→优雅降级。

**文件改动清单**：

| 文件 | 改动 |
|------|------|
| `shared/host-api/contract.ts` | 在 `HostApiContract`（L2755）新增 `memory` 模块，含 `getEmbeddingConfig: () => MemoryEmbeddingConfig` 和 `setEmbeddingConfig: (config) => void` 两个 action |
| `electron/services/agent-dev-api.ts` | 参照 L409 `createAgentDevApi` 模式，实现 `memory.getEmbeddingConfig` / `memory.setEmbeddingConfig`，读写 `electron-store` key `memory.embeddingConfig` |
| `src/lib/host-api.ts` | 暴露 renderer 调用入口 `getMemoryEmbeddingConfig()` / `setMemoryEmbeddingConfig(config)` |
| `src/components/settings/MemorySettingsPanel.tsx`（新建） | Embedding 开关 + Provider 下拉（复用现有 AI Provider 列表）+ 模型显示 + 状态提示（"已启用" / "未启用，使用本地模糊匹配"）|
| `src/components/settings/SettingsPage.tsx`（或等效路由） | 注册 MemorySettingsPanel |
| `shared/i18n/locales/{en,zh,ja,ru}/settings.json` | 新增 `memoryEmbedding` 命名空间翻译 key |

**配置结构**：
```typescript
type MemoryEmbeddingConfig = {
  enabled: boolean;       // 默认 false
  providerId?: string;    // 复用现有 AI Provider
  model?: string;
};
```

**UI 约定**（遵循 `globals.css` Component conventions）：
- 开关用 `bg-surface-input` recessed 容器
- 状态色：已启用 `text-emerald-700 dark:text-emerald-400`，未启用 `text-neutral-500`
- H2 用 `font-serif font-normal tracking-tight`

**E2E 覆盖**：新增 `tests/e2e/settings-memory-embedding.spec.ts`，覆盖开关切换 + 状态显示（遵循 AGENTS.md「UI change validation」规则）。

### 5.6 验证 + RRF 重调

**文件 A（新建）**：`tests/unit/runtime-memory-embedding-integration.test.ts`

测试用例：
1. 无 Provider 时 `buildHybridSearchIndex` 走 3-gram 路径，结果与 `hybridSearchFacts` 完全一致（回归保证）
2. Mock Provider（确定性 hash embedding）时 `searchWithEmbedding` 返回正确排序
3. Embedding 持久化：`replaceEmbedding` → `getEmbedding` 往返正确；`deleteEmbedding` 后读取返回 null
4. `adaptMemoryEmbeddingProvider` 正确转换接口

**文件 B（新建）**：`tests/unit/runtime-memory-embedding-ablation.test.ts`

消融对比：
- 3-gram TF-IDF baseline vs mock embedding（确定性 hash → 语义近似模拟）
- 指标：MRR、Recall@5
- 验证 `OPTIMAL_HYBRID_FUSION` 在 embedding 路径下是否需调整
- 无害保证：embedding 启用时 MRR ≥ 3-gram 基线

---

## 三、Phase 6 剩余：轻量关系链

### 6.4 读时 1-hop 关系扩展

**目标**：检索命中 fact 后，自动沿关系链扩展 1-hop，补充关联上下文（不挤占 type-aware 槽位）。

**文件**：`openclaw_runtime/src/context-engine/memory-context-provider.ts`

**插入点**：`getContext()` L172（`findRuntimeMemoryFacts`）之后、L173（`applyTypeAwareSlots`）之前。

**实现**：
1. 新增常量 `MAX_RELATION_EXPANSIONS = 2`
2. 新增函数 `expandOneHopRelations(matchedFacts, options): RuntimeMemoryQueryableFact[]`：
   - 参数：`{ queryFacts, store?, maxExpansions, excludeIds: Set<string> }`
   - 当 `options.store` 不存在时（Context Provider 只有 `queryFacts` 回调，无直接 store 引用），需要在 `RuntimeMemoryContextProviderOptions` 新增可选 `queryRelations?: (factId) => RuntimeMemoryFactRelation[]` 回调
   - 对 matchedFacts 中每个 fact 调用 `queryRelations(factId)` + `queryReverseRelations(factId)`
   - 收集关联 factId，去重（排除已在 matchedFacts 中的）
   - 按 relation_type 优先级排序：`supersedes` > `contradicts` > `related_to`
   - 同类型按 confidence 降序
   - 取前 `MAX_RELATION_EXPANSIONS` 个
   - 通过 `queryFacts({ factId })` 获取完整 fact 对象
   - 返回 `[...matchedFacts, ...expandedFacts]`
3. 在 `applyTypeAwareSlots` 调用前插入扩展：
   ```typescript
   const expandedFacts = options.queryRelations
     ? expandOneHopRelations(matchedFacts, {
         queryFacts: options.queryFacts,
         queryRelations: options.queryRelations,
         maxExpansions: MAX_RELATION_EXPANSIONS,
       })
     : matchedFacts;
   const rankedFacts = applyTypeAwareSlots(expandedFacts, providerQuery);
   ```
4. **预算保护**：扩展 fact 不计入 `MEMORY_TYPE_SLOTS`（semantic 4 / episodic 2 / procedural 2），作为额外补充追加在 type-aware 结果之后、token budget 裁剪之前。

**Options 类型扩展**：
```typescript
export type RuntimeMemoryContextProviderOptions = {
  // ...existing...
  queryRelations?: (
    factId: string,
  ) => readonly RuntimeMemoryFactRelation[] | Promise<readonly RuntimeMemoryFactRelation[]>;
};
```

### 6.5 memory_find_related 工具

**目标**：Agent 可主动查询某 fact 的关联 fact（1-hop 或 2-hop），用于深挖记忆连接。

**文件**：`openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts`

**改动**：
1. `MemorySelfEditToolName`（L29-33）添加 `"memory_find_related"`
2. 新增 `memoryFindRelatedTool: MemorySelfEditTool`（参照 L53-58 工具形状）：
   ```typescript
   {
     name: "memory_find_related",
     description: "Find facts related to a given fact via relation chain (1-hop or 2-hop).",
     parameters: {
       type: "object",
       properties: {
         factId: { type: "string" },
         relationType: { type: "string", enum: ["supersedes", "contradicts", "related_to"] },
         hops: { type: "number", minimum: 1, maximum: 2, default: 1 },
         limit: { type: "number", minimum: 1, maximum: 20, default: 10 },
       },
       required: ["factId"],
     },
     execute: async (args, ctx) => { /* ... */ },
   }
   ```
3. `execute` 逻辑：
   - 1-hop：`ctx.store.queryRelations(factId, type)` + `queryReverseRelations(factId, type)`，收集 target/source factId
   - 2-hop：对 1-hop 结果再查一次，去重，排除起始 factId
   - 用 `ctx.store.getFactById()` 获取完整 fact 对象
   - 限制总数 ≤ `limit`
   - 返回 `{ ok: true, tool: "memory_find_related", message, data: { facts, relations } }`
4. `MEMORY_SELF_EDIT_TOOLS` 数组（L446-451）追加 `memoryFindRelatedTool`

> **注意**（L12-13 原注释）：自编辑工具目前仅接口+测试，未接入 agent 工具注册系统。Phase 6.5 保持这一边界——实现工具定义和执行逻辑，不在此阶段接入 agent runtime。

### 6.6 关系链验证测试

**文件（新建）**：`tests/unit/runtime-memory-relations.test.ts`

测试用例：
1. 关系表迁移幂等性（多次 `migrate()` 不报错）
2. `appendRelation` 写入 + `queryRelations` / `queryReverseRelations` 查询正确
3. 幂等性：相同 (source, target, type) 重复写入只更新 confidence
4. 关系爆炸防护：单 fact 超过 10 条 outgoing 时保留 confidence 最高的 10 条
5. AUDN UPDATE 自动生成 `supersedes`(0.9) 关系
6. AUDN SUPERSEDE 自动生成 `supersedes`(1.0) + `contradicts`(0.8) 关系
7. `memory_find_related` 工具 1-hop 查询返回正确关联 fact
8. `memory_find_related` 工具 2-hop 查询正确且无环
9. Context Provider 1-hop 扩展：matchedFacts 有关联 fact 时扩展 fact 被追加
10. 预算限制：扩展 fact 不超过 `MAX_RELATION_EXPANSIONS`(2)
11. fact 删除时关系级联清理（ON DELETE CASCADE）
12. 无 `queryRelations` 回调时 Context Provider 正常工作（零回归）

---

## 四、Phase 7：LoCoMo 基准

### 7.1 数据集获取

**来源**：`https://github.com/snap-research/locomo`（HuggingFace: `snap-research/locomo`）

**Fixture 存储**：`tests/fixtures/locomo/`
```
tests/fixtures/locomo/
  ├── README.md           # 数据集说明、来源、许可证（CC BY 4.0）
  ├── conversations.json  # 5 个对话
  └── questions.json      # 250 个问题（5 × 50）
```

**获取方式**：手动下载 + 预处理脚本 `scripts/download-locomo.mjs`
- 从 HuggingFace datasets API 下载 `snap-research/locomo`
- 预处理：提取 `conversation_id` / `turn_id` / `speaker` / `text` + `question_id` / `conversation_id` / `question` / `answer` / `category`
- 固化为 JSON fixture

**问题类型分布**（与论文一致）：
- `single_hop`: ~40%（100 题）
- `multi_hop`: ~25%（62 题）
- `open_ended`: ~20%（50 题）
- `adversarial`: ~15%（38 题）

### 7.2 基准测试实现

**文件（新建）**：`tests/unit/runtime-memory-locomo-benchmark.test.ts`

**测试结构**：
```typescript
// @vitest-environment node
describe.skipIf(!hasDeepSeekKey())("L11: LoCoMo benchmark — external dataset", () => {
  // 1. 加载 fixture (conversations.json + questions.json)
  // 2. 对每个对话：将 turns 转为 episodic facts，通过 appendFact + AUDN 写入
  // 3. 对每个问题：findRuntimeMemoryFacts(topK=5) → LLM 生成答案 → 评分
  // 4. 按问题类型聚合指标
});
```

**流程细节**：
1. **记忆写入**：每个对话 turn → episodic fact（`subject=speaker`, `predicate=said`, `objectSummary=turn text`），通过 `appendFact` + AUDN 写入 persistence store
2. **检索**：问题文本作为 query，调用 `findRuntimeMemoryFacts(query, { topK: 5 })`
3. **LLM 生成**：检索到的 facts 作为 context，调用 DeepSeek 生成答案（复用现有 `callDeepSeek` helper）
4. **评分**：
   - **Recall@5**：ground truth answer 关键实体是否出现在 top-5 检索结果中（实体匹配）
   - **F1**：token-level F1 between generated answer and ground truth
   - **BLEU-1**：unigram BLEU between generated answer and ground truth

**指标计算 helper**：复用 `tests/unit/helpers/` 下的统计工具，新增 `tests/unit/helpers/locomo-metrics.ts`（`computeRecallAt5`、`computeF1`、`computeBleu1`）

**目标**：
- Recall@5 ≥ 0.70
- F1 ≥ 0.40
- 按类型细分：single_hop > multi_hop > open_ended > adversarial

### 7.3 成熟度评分集成

**文件**：`tests/unit/helpers/runtime-memory-maturity-score.ts`

**改动**：
1. `LayerId`（L15-18）添加 `"L11"`
2. `EXPECTED_LAYERS`（L65-69）追加 `"L11"`
3. `MaturityDimension`（L42-49）添加 `"externalBenchmark"`
4. `DIMENSION_WEIGHTS`（L80-88）重新平衡至 sum=1.00：
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
   };
   ```
5. `dimensions` 计算块添加 `externalBenchmark`：
   - L11 通过（Recall@5 ≥ 0.70）→ 1.0
   - L11 部分通过（0.50 ≤ Recall@5 < 0.70）→ 0.5
   - L11 失败（Recall@5 < 0.50）→ 0.0
   - L11 跳过（无 LLM key）→ 不计入，不触发 `hollow_llm` disqualifier
6. `buildAllPassScenario`（L209-259）添加 L11 pass scenario

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
      "single_hop": { ... },
      "multi_hop": { ... },
      "open_ended": { ... },
      "adversarial": { ... }
    }
  },
  "shortcomings": [],
  "generatedAt": ""
}
```

**package.json 脚本**：
```json
"eval:runtime-memory:locomo": "pnpm exec vitest run tests/unit/runtime-memory-locomo-benchmark.test.ts --reporter=verbose"
```

### 7.5 短板分析

**目标**：通过 LoCoMo 结果定位真实短板，输出到 `locomo-report.json` 的 `shortcomings` 字段。

**分析维度**：
1. **问题类型短板**：哪种类型 Recall@5 最低？（预期：adversarial 最差，需时序推理+冲突检测；multi-hop 较差，验证关系链价值）
2. **检索 vs 生成短板**：Recall@5 低→检索短板（embedding/RRF）；Recall@5 高但 F1 低→生成短板（LLM 能力）
3. **时序短板**：adversarial 题涉及"之前 X，后来 Y"，验证 bi-temporal model
4. **关系链短板**：multi-hop 需关联多 fact，验证 Phase 6 关系链 1-hop 扩展效果

**对比基线**：
| 方法 | Recall@5 | 来源 |
|------|----------|------|
| Mem0 | 92.5% | 论文 |
| LangMem | 68.3% | 论文 |
| Letta | 60.1% | 论文 |
| 本系统 | ? | LoCoMo 测试 |

---

## 五、实施顺序

```
[已完成] 5.1 → 5.2 → 6.1 → 6.2 → 6.3
                  ↓
Phase 6.4 (读时 1-hop 扩展) ← 独立于 Phase 5 剩余
    ↓
Phase 6.5 (memory_find_related) ← 依赖 6.3 store 方法
    ↓
Phase 6.6 (关系链验证测试) ← 依赖 6.4 + 6.5
    ↓
Phase 5.3 (Embedding 持久化) ← 独立于 Phase 6
    ↓
Phase 5.4 (上层适配器 + 接线) ← 依赖 5.1 + 5.2
    ↓
Phase 5.5 (Settings 开关) ← 依赖 5.4
    ↓
Phase 5.6 (验证 + RRF 重调) ← 依赖 5.3 + 5.4
    ↓
Phase 7.1 (数据集获取) ← 独立于 Phase 5/6
    ↓
Phase 7.2 (基准测试) ← 建议在 5/6 完成后（测到完整能力）
    ↓
Phase 7.3 (成熟度集成) ← 依赖 7.2
    ↓
Phase 7.4 (报告 + 脚本) ← 依赖 7.2
    ↓
Phase 7.5 (短板分析) ← 依赖 7.4
```

**并行机会**：
- Phase 6.4-6.6 与 Phase 5.3-5.6 互不依赖，可并行
- Phase 7.1（数据集获取）可提前启动

---

## 六、验证步骤

### Phase 6 验证
```powershell
# 关系链测试
pnpm exec vitest run tests/unit/runtime-memory-relations.test.ts --reporter=verbose

# 回归测试（704+ 现有测试必须全绿）
pnpm exec vitest run tests/unit/runtime-memory-*.test.ts --reporter=verbose

# Typecheck + Lint
pnpm run typecheck; pnpm run lint
```

### Phase 5 验证
```powershell
# Embedding 集成测试
pnpm exec vitest run tests/unit/runtime-memory-embedding-integration.test.ts --reporter=verbose

# RRF 消融
pnpm exec vitest run tests/unit/runtime-memory-embedding-ablation.test.ts --reporter=verbose

# 回归 + Typecheck
pnpm exec vitest run tests/unit/runtime-memory-*.test.ts --reporter=verbose
pnpm run typecheck
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
pnpm run typecheck; pnpm run lint; pnpm contract:check
```

---

## 七、假设与决策

### 假设
1. 现有 704+ 测试在无 embedding 时必须零回归（3-gram TF-IDF 路径保留）
2. LoCoMo 数据集许可证允许研究/测试使用（fixture README 注明来源）
3. DeepSeek API 可用于 LoCoMo LLM judge（复用 `hasDeepSeekKey()` 模式）
4. `runtime_memory_embeddings` 表使用 raw SQL（与 `runtime_memory_fact_relations` 一致），因 Kysely 类型中未包含

### 决策
1. **不引入 ONNX 本地模型**：避免包体积膨胀，复用现有云端 Provider
2. **关系链仅 1-hop 自动扩展**：2-hop 通过 `memory_find_related` 工具手动触发
3. **LoCoMo 不在 CI 中运行**：成本高，通过 `describe.skipIf(!hasDeepSeekKey())` 保护
4. **embedding 预计算在索引构建时**：保证 `search()` 同步
5. **Context Provider 通过回调获取关系**：不直接依赖 `RuntimeMemoryStore`，保持 shadow-only 边界

---

## 八、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Embedding 异步化破坏现有同步 API | 高 | 预计算 + 缓存，`search()` 保持同步（5.2 已实现） |
| 关系链爆炸导致检索性能下降 | 中 | 单 fact 最多 10 outgoing（6.3 已实现）；扩展最多 2 fact |
| LoCoMo Recall@5 远低于 0.70 | 中 | 短板分析定位问题，可能需调优 RRF 或 topK |
| Settings 开关 UI 回归 | 低 | E2E 覆盖 + i18n 完整（4 语言） |
| DeepSeek API 限流 | 低 | 测试中加 200ms 间隔，复用现有 retry |

---

## 九、用户需要提供的信息

1. **DeepSeek API Key**：用于 LoCoMo LLM judge 测试（复用环境变量 `DEEPSEEK_API_KEY`）
2. **可选：OpenAI API Key**：用于验证 embedding 端到端流程（测试中可用 mock Provider 替代）
3. **无需提供其他材料**：LoCoMo 数据集由脚本自动下载，代码修改由我完成

**用户配置入口**（Phase 5.5 完成后）：
- Settings > Memory > Embedding：开关 + Provider 选择（复用现有 AI Provider 配置）
- 默认关闭，不使用时优雅降级到本地 3-gram TF-IDF 模糊匹配
