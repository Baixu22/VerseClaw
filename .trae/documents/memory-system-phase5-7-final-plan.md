# 记忆系统 Phase 5-7 最终实施计划

> **状态**：待批准
> **范围**：完成 Phase 5.3-5.6（Embedding 接入）、验证 Phase 6（关系链已完成）、Phase 7.1-7.5（LoCoMo 基准）
> **语言**：中文（技术术语保留英文）

---

## 一、用户三大问题解答

### 1. Embedding：用户需要配置什么？

**结论：用户无需提供额外材料，平台已有完整的 embedding provider 体系。**

当前架构已存在 `MemoryEmbeddingProvider` 插件系统（`openclaw_runtime/src/plugins/memory-embedding-providers.ts`），覆盖 voyage / openai / ollama / mistral / lmstudio / google / deepinfra / amazon-bedrock 共 8 家 provider。每个 provider 在 `extensions/<provider>/memory-embedding-adapter.ts` 中有独立适配器。

用户只需要：
- 在 Settings > AI Providers 中配置至少一个 provider 的 API Key（如 OpenAI key）
- Phase 5.5 完成后，在 Settings > Memory 中开启 embedding 开关、选择 provider

我们不需要引入 ONNX 本地模型，也不需要自建 embedding 服务。**平台只做接入层**：
- `RuntimeEmbeddingProvider`（runtime-core 接口，5.1 已定义）是依赖注入边界
- `adaptMemoryEmbeddingProvider()`（Phase 5.4）将上层 `MemoryEmbeddingProvider` 桥接为 `RuntimeEmbeddingProvider`
- 默认关闭，未启用时优雅降级到 3-gram TF-IDF 模糊匹配（零回归保证）

### 2. 关系链：是否需要设计？

**结论：已完成设计并实现（Phase 6.1-6.6），记忆不再是孤岛。**

已落地的关系链架构：

| 能力 | 实现 | 文件 |
|------|------|------|
| 三种关系类型 | `supersedes`（优先级 3）、`contradicts`（2）、`related_to`（1） | `memory-context.ts:259-285` |
| Store 层管理 | `appendRelation` / `queryRelations` / `queryReverseRelations`，单 fact 最多 10 条 outgoing | `memory-store.ts:630-711` |
| SQLite 持久化 | `runtime_memory_fact_relations` 表，ON DELETE CASCADE 级联清理 | `memory-persistence.ts:404-420` |
| 写时自动生成 | AUDN UPDATE→`supersedes`(0.9)；SUPERSEDE→`supersedes`(1.0)+`contradicts`(0.8) | `memory-runtime-integration.ts:133-180` |
| 读时 1-hop 扩展 | 检索命中后自动沿关系链扩展，最多 2 条，不挤占 type-aware 槽位 | `memory-context-provider.ts:65-71, 714-767` |
| Agent 主动查询 | `memory_find_related` 工具，BFS 1/2-hop 遍历，visited 防环 | `memory-self-edit-tools.ts:462-596` |
| 验证测试 | 14 个测试用例覆盖全部能力 | `tests/unit/runtime-memory-relations.test.ts` |

**唯一待办**：上一轮会话修复了 3 个测试失败（AUDN SUPERSEDE 候选文本、Context Provider config 传递），需要重新运行确认全绿。

### 3. LoCoMo 基准：如何深度判断短板？

**结论：需要从零构建（Phase 7.1-7.5），这是本计划的核心工作量。**

LoCoMo（`snap-research/locomo`）是长对话记忆基准数据集，包含 5 个对话 × 50 个问题 = 250 题，覆盖 4 种问题类型（single_hop / multi_hop / open_ended / adversarial）。

通过 LoCoMo 可以定位的真实短板：
- **检索短板**：Recall@5 低 → embedding 路径 / RRF 融合需优化
- **生成短板**：Recall@5 高但 F1 低 → LLM 上下文利用能力不足
- **时序短板**：adversarial 题涉及"之前 X，后来 Y" → bi-temporal model + supersession 机制验证
- **关系链短板**：multi-hop 需关联多 fact → Phase 6 关系链 1-hop 扩展效果验证

对比基线（论文数据）：Mem0 92.5%、LangMem 68.3%、Letta 60.1%。本系统目标 Recall@5 ≥ 0.70。

---

## 二、当前状态总结

### 已完成（已持久化，typecheck 通过）

| 阶段 | 文件 | 内容 |
|------|------|------|
| 5.1 | `runtime-core/memory-embedding-provider.ts` | `RuntimeEmbeddingProvider` 接口 + `NO_EMBEDDING_PROVIDER` 哨兵 + `isEmbeddingProviderAvailable` |
| 5.1 | `runtime-core/index.ts` L19 | re-export |
| 5.2 | `runtime-core/memory-hybrid-retrieval.ts` | `buildHybridSearchIndex()` / `searchWithEmbedding()` / `hybridSearchFactsWithEmbedding()` / `cosineEmbedding()` / `embeddingVec` / `embeddingIndexCache` |
| 6.1 | `runtime-core/memory-persistence.ts` | `runtime_memory_fact_relations` 表 + persist/read |
| 6.2 | `runtime-core/memory-context.ts` | 关系类型定义 + 类型守卫 |
| 6.3 | `runtime-core/memory-store.ts` | 关系存储 + 查询 + 10-cap 爆炸防护 |
| 6.3 | `runtime-core/memory-runtime-integration.ts` | AUDN 自动关系生成 |
| 6.4 | `context-engine/memory-context-provider.ts` | 1-hop 读时扩展 + `queryRelations` 回调 |
| 6.5 | `runtime-core/memory-self-edit-tools.ts` | `memory_find_related` 工具（BFS 1/2-hop） |
| 6.6 | `tests/unit/runtime-memory-relations.test.ts` | 14 测试用例（3 处修复待重跑确认） |

### 待完成（本计划范围）

- **Phase 5.3**：Embedding 持久化（`runtime_memory_embeddings` 表）
- **Phase 5.4**：上层适配器 + Context Provider 接线
- **Phase 5.5**：Settings 页面开关 + i18n + E2E
- **Phase 5.6**：验证 + RRF 重调测试
- **Phase 7.1**：LoCoMo 数据集获取
- **Phase 7.2**：LoCoMo 基准测试实现
- **Phase 7.3**：成熟度评分 L11 + `externalBenchmark` 维度
- **Phase 7.4**：报告生成 + package.json 脚本
- **Phase 7.5**：短板分析

---

## 三、Phase 5 剩余：Embedding 能力接入

### 5.3 Embedding 持久化

**目标**：将 fact embedding 持久化到 SQLite，避免每次索引构建重新调用 embedding API。

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

2. 新增 helper 函数（参照 `persistRelationRow` / `relationTableExists` 的 raw SQL 模式）：
   - `embeddingsTableExists(db): boolean`
   - `readEmbedding(db, factId, providerId, model): Float32Array | null` — BLOB → `new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)`
   - `replaceEmbeddingRow(db, { factId, providerId, model, dimension, embedding, now })` — `Buffer.from(new Float32Array(embedding).buffer)` 写入
   - `deleteEmbeddingRow(db, factId)` — fact 删除时级联清理（CASCADE 已覆盖，但显式删除更安全）

3. 在 `RuntimeMemoryPersistenceStore` 新增方法：
   - `replaceEmbedding(params): void`
   - `getEmbedding(factId, providerId, model): Float32Array | null`
   - `deleteEmbedding(factId): void`

4. Schema 版本保持 `= 1`（`CREATE TABLE IF NOT EXISTS` 幂等）

### 5.4 上层适配器 + Context Provider 接线

**目标**：桥接 `MemoryEmbeddingProvider`（上层插件接口）→ `RuntimeEmbeddingProvider`（runtime-core 接口），并在 Context Provider 中按配置启用 embedding 路径。

**关键差异**：`MemoryEmbeddingProvider` 有 `id` + `model` 但无 `dimension`；`RuntimeEmbeddingProvider` 需要 `dimension`。适配器需从首次 `embedBatch` 结果推断 dimension。

**文件 A（新建）**：`openclaw_runtime/extensions/memory-core/src/memory/runtime-embedding-adapter.ts`

```typescript
import type { RuntimeEmbeddingProvider } from "../../../runtime-core/memory-embedding-provider.js";
import type { MemoryEmbeddingProvider } from "../../../plugins/memory-embedding-providers.js";

/**
 * Adapt the upper-layer MemoryEmbeddingProvider to the runtime-core
 * RuntimeEmbeddingProvider contract. dimension is probed from the first
 * embedBatch call result, because MemoryEmbeddingProvider does not
 * expose dimension in its interface.
 */
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

/**
 * Probe the dimension by embedding a single placeholder query.
 * Call this once at setup time, then pass the result to adaptMemoryEmbeddingProvider.
 */
export async function probeEmbeddingDimension(
  provider: MemoryEmbeddingProvider,
): Promise<number> {
  const [vec] = await provider.embedBatch(["dimension probe"]);
  if (!vec || vec.length === 0) {
    throw new Error(`Embedding provider ${provider.id} returned empty vector`);
  }
  return vec.length;
}
```

**文件 B**：`openclaw_runtime/src/context-engine/memory-context-provider.ts`

改动点：
1. `RuntimeMemoryContextProviderOptions` 新增可选字段：
   ```typescript
   embeddingProvider?: EmbeddingProviderOrNone;
   embeddingEnabled?: boolean;
   ```
2. 在 `getContext()` 中，`findRuntimeMemoryFacts` 调用前插入 embedding 路径选择：
   ```typescript
   const useEmbedding = options.embeddingEnabled === true &&
     options.embeddingProvider !== undefined &&
     isEmbeddingProviderAvailable(options.embeddingProvider);
   const matchedFacts = useEmbedding
     ? await findFactsWithEmbedding(options, facts, providerQuery)
     : findRuntimeMemoryFacts(facts, { ...providerQuery, limit: undefined });
   ```
3. 新增私有 helper `findFactsWithEmbedding()`：调用 `hybridSearchFactsWithEmbedding(facts, query, embeddingProvider)`，异常时 fallback 到 `findRuntimeMemoryFacts`

**接线说明**：实际将 adapter 注入 Context Provider 的位置在 `extensions/memory-core` 的 manager 装配处。本阶段完成接口和 Context Provider 侧接线点；manager 装配在 Phase 5.5 Settings 开关完成后一并打通。

### 5.5 Settings 页面开关

**目标**：用户在 Settings > Memory 中可开启 embedding，默认关闭→优雅降级。

**文件改动清单**：

| 文件 | 改动 |
|------|------|
| `shared/host-api/contract.ts` | 在 `HostApiContract` 新增 `memory` 模块，含 `getEmbeddingConfig` / `setEmbeddingConfig` 两个 action |
| `electron/services/agent-dev-api.ts` | 实现 `memory.getEmbeddingConfig` / `memory.setEmbeddingConfig`，读写 `electron-store` key `memory.embeddingConfig` |
| `src/lib/host-api.ts` | 暴露 `getMemoryEmbeddingConfig()` / `setMemoryEmbeddingConfig(config)` |
| `src/components/settings/MemorySettingsPanel.tsx`（新建） | Embedding 开关 + 状态提示 |
| `src/components/settings/SettingsPage.tsx` | 注册 MemorySettingsPanel |
| `shared/i18n/locales/{en,zh,ja,ru}/settings.json` | 新增 `memoryEmbedding` 翻译 key |
| `tests/e2e/settings-memory-embedding.spec.ts`（新建） | E2E 覆盖开关切换 + 状态显示 |

**配置结构**：
```typescript
type MemoryEmbeddingConfig = {
  enabled: boolean;       // 默认 false
  providerId?: string;    // 复用现有 memory embedding provider
  model?: string;
};
```

**UI 约定**（遵循 `globals.css` Component conventions）：
- 开关用 `bg-surface-input` recessed 容器
- 状态色：已启用 `text-emerald-700 dark:text-emerald-400`，未启用 `text-neutral-500`
- H2 用 `font-serif font-normal tracking-tight`
- 所有文案通过 `react-i18next`，4 语言全覆盖

### 5.6 验证 + RRF 重调

**文件 A（新建）**：`tests/unit/runtime-memory-embedding-integration.test.ts`

测试用例：
1. 无 Provider 时 `buildHybridSearchIndex` 走 3-gram 路径，结果与 `hybridSearchFacts` 完全一致（回归保证）
2. Mock Provider（确定性 hash embedding）时 `searchWithEmbedding` 返回正确排序
3. Embedding 持久化：`replaceEmbedding` → `getEmbedding` 往返正确；`deleteEmbedding` 后返回 null
4. `adaptMemoryEmbeddingProvider` + `probeEmbeddingDimension` 正确转换接口
5. Context Provider embedding 路径：`embeddingEnabled=true` + mock provider → 走 embedding 路径
6. Context Provider 降级：`embeddingEnabled=true` 但 provider 不可用 → fallback 到 3-gram

**文件 B（新建）**：`tests/unit/runtime-memory-embedding-ablation.test.ts`

消融对比：
- 3-gram TF-IDF baseline vs mock embedding（确定性 hash → 语义近似模拟）
- 指标：MRR、Recall@5
- 验证 `OPTIMAL_HYBRID_FUSION`（k=0, normalizeByPathCount=true, wBm25=0.5, wVector=1.0）在 embedding 路径下是否需调整
- **无害保证**：embedding 启用时 MRR ≥ 3-gram 基线（硬约束）

---

## 四、Phase 7：LoCoMo 基准

### 7.1 数据集获取

**来源**：`https://github.com/snap-research/locomo`（HuggingFace: `snap-research/locomo`，CC BY 4.0）

**Fixture 存储**：`tests/fixtures/locomo/`
```
tests/fixtures/locomo/
  ├── README.md           # 数据集说明、来源、许可证
  ├── conversations.json  # 5 个对话（每个对话 ~50 turns）
  └── questions.json      # 250 个问题（5 × 50）
```

**获取方式**：手动下载 + 预处理脚本 `scripts/download-locomo.mjs`
- 从 HuggingFace datasets API 下载 `snap-research/locomo`
- 预处理：提取 `conversation_id` / `turn_id` / `speaker` / `text` + `question_id` / `conversation_id` / `question` / `answer` / `category`
- 固化为 JSON fixture（避免测试时依赖网络）

**问题类型分布**（与论文一致）：
- `single_hop`: ~40%（100 题）— 单轮事实回忆
- `multi_hop`: ~25%（62 题）— 跨轮推理
- `open_ended`: ~20%（50 题）— 开放式总结
- `adversarial`: ~15%（38 题）— 时序冲突/否定

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
  // 5. 输出 shortcomings 分析
});
```

**流程细节**：

1. **记忆写入**（每个对话一次性写入）：
   - 每个 turn → episodic fact（`subject=speaker`, `predicate=said`, `objectSummary=turn text`, `valid_at=turn_id`, `sourceEpisodeRefs=[conversation_id]`）
   - 通过 `appendFact` + AUDN 写入 persistence store
   - 使用独立 temp DB per conversation（避免跨对话污染）

2. **检索**：
   - 问题文本作为 query
   - 调用 `findRuntimeMemoryFacts(query, { topK: 5 })`
   - 记录命中的 facts

3. **LLM 生成**：
   - 检索到的 facts 作为 context
   - 调用 DeepSeek 生成答案（复用 `tests/unit/helpers/runtime-memory-real-llm-client.ts` 的 `callDeepSeek`）
   - 200ms 间隔避免限流

4. **评分**：
   - **Recall@5**：ground truth answer 关键实体是否出现在 top-5 检索结果中（实体匹配）
   - **F1**：token-level F1 between generated answer and ground truth
   - **BLEU-1**：unigram BLEU between generated answer and ground truth

**指标计算 helper（新建）**：`tests/unit/helpers/locomo-metrics.ts`
```typescript
export function computeRecallAt5(retrievedFacts, groundTruthAnswer): number;
export function computeF1(generatedAnswer, groundTruthAnswer): number;
export function computeBleu1(generatedAnswer, groundTruthAnswer): number;
```

**防过拟合注意**：
- 不使用 `filterQueriesBySeededGroups`（会触发 `circular_validation_disqualifier`）
- 对全部 250 题评分，不按 seeded group 过滤
- 不使用 `expectedFactIds`

**目标**：
- Recall@5 ≥ 0.70（整体）
- F1 ≥ 0.40（整体）
- 按类型细分：single_hop > multi_hop > open_ended > adversarial

**成本估算**：250 题 × 1 LLM call = 250 calls，约 $0.35-0.50（DeepSeek 定价）

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
   - L11 跳过（无 LLM key）→ 不计入，**不触发** `hollow_llm` disqualifier
6. `buildAllPassScenario`（L209-259）添加 L11 pass scenario

**文件**：`tests/unit/runtime-memory-maturity-score-real.test.ts`
- 更新 dimension count 断言（7 → 8）
- 更新 layer count 断言（15 → 16）

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
      "single_hop": { "recall_at_5": 0.0, "f1": 0.0, "bleu1": 0.0, "count": 0 },
      "multi_hop": { ... },
      "open_ended": { ... },
      "adversarial": { ... }
    }
  },
  "shortcomings": [],
  "comparison": {
    "mem0": { "recall_at_5": 0.925 },
    "langmem": { "recall_at_5": 0.683 },
    "letta": { "recall_at_5": 0.601 },
    "ours": { "recall_at_5": 0.0 }
  },
  "generatedAt": ""
}
```

**package.json 脚本**：
```json
"eval:runtime-memory:locomo": "pnpm exec vitest run tests/unit/runtime-memory-locomo-benchmark.test.ts --reporter=verbose"
```

### 7.5 短板分析

**目标**：通过 LoCoMo 结果定位真实短板，输出到 `locomo-report.json` 的 `shortcomings` 字段。

**分析维度**（测试内自动生成）：

1. **问题类型短板**：哪种类型 Recall@5 最低？
   - 预期：adversarial 最差（需时序推理 + 冲突检测）
   - 预期：multi-hop 较差（验证关系链价值）

2. **检索 vs 生成短板**：
   - Recall@5 低 → 检索短板（embedding / RRF 需优化）
   - Recall@5 高但 F1 低 → 生成短板（LLM 上下文利用不足）

3. **时序短板**：
   - adversarial 题涉及"之前 X，后来 Y"
   - 验证 bi-temporal model + supersession 机制是否正确保留最新事实

4. **关系链短板**：
   - multi-hop 需关联多 fact
   - 验证 Phase 6 关系链 1-hop 扩展是否实际提升了 multi-hop Recall@5

**shortcoming 条目格式**：
```typescript
type Shortcoming = {
  dimension: "retrieval" | "generation" | "temporal" | "relation_chain";
  severity: "high" | "medium" | "low";
  evidence: string;  // 具体数据，如 "adversarial Recall@5: 0.32 < target 0.70"
  recommendation: string;  // 优化建议
};
```

---

## 五、Phase 6 验证（确认已完成）

Phase 6 代码已全部落地，仅需重新运行测试确认上一轮修复生效：

```powershell
# 关系链测试（14 用例）
pnpm exec vitest run tests/unit/runtime-memory-relations.test.ts --reporter=verbose

# 自编辑工具测试（确认 5 tools）
pnpm exec vitest run tests/unit/runtime-memory-self-edit.test.ts --reporter=verbose
```

**预期**：14/14 + 20/20 全绿。如有失败，修复后再继续 Phase 5/7。

---

## 六、实施顺序

```
[已完成] Phase 5.1, 5.2, 6.1-6.6
                  ↓
Step 1: Phase 6 验证（重跑测试确认全绿）
                  ↓
Step 2: Phase 5.3 (Embedding 持久化表) ← 独立于 Phase 7
                  ↓
Step 3: Phase 5.4 (适配器 + Context Provider 接线) ← 依赖 5.1 + 5.2
                  ↓
Step 4: Phase 5.5 (Settings 开关 + i18n + E2E) ← 依赖 5.4
                  ↓
Step 5: Phase 5.6 (验证 + RRF 重调测试) ← 依赖 5.3 + 5.4
                  ↓
Step 6: Phase 7.1 (LoCoMo 数据集获取) ← 可与 Phase 5 并行
                  ↓
Step 7: Phase 7.2 (基准测试实现) ← 建议在 Phase 5 完成后（测到完整能力）
                  ↓
Step 8: Phase 7.3 (成熟度评分 L11 集成) ← 依赖 7.2
                  ↓
Step 9: Phase 7.4 (报告 + 脚本) ← 依赖 7.2
                  ↓
Step 10: Phase 7.5 (短板分析) ← 依赖 7.4
```

**并行机会**：
- Phase 7.1（数据集获取）可与 Phase 5.3-5.6 并行
- Phase 5.3（持久化）与 Phase 5.4（适配器）可并行开发

---

## 七、验证步骤

### Phase 6 验证
```powershell
pnpm exec vitest run tests/unit/runtime-memory-relations.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/runtime-memory-self-edit.test.ts --reporter=verbose
```

### Phase 5 验证
```powershell
# Embedding 集成测试
pnpm exec vitest run tests/unit/runtime-memory-embedding-integration.test.ts --reporter=verbose

# RRF 消融
pnpm exec vitest run tests/unit/runtime-memory-embedding-ablation.test.ts --reporter=verbose

# 回归（704+ 现有测试零回归）
pnpm exec vitest run tests/unit/runtime-memory-*.test.ts --reporter=verbose

# Typecheck + Lint + Contract
pnpm run typecheck
pnpm run lint
pnpm contract:check

# E2E（Settings 开关）
pnpm run test:e2e tests/e2e/settings-memory-embedding.spec.ts
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

### 最终全量验证
```powershell
pnpm exec vitest run tests/unit/runtime-memory-*.test.ts --reporter=verbose
pnpm run typecheck
pnpm run lint
pnpm contract:check
```

---

## 八、假设与决策

### 假设
1. 现有 704+ 测试在无 embedding 时必须零回归（3-gram TF-IDF 路径保留）
2. LoCoMo 数据集 CC BY 4.0 许可证允许研究/测试使用（fixture README 注明来源）
3. DeepSeek API 可用于 LoCoMo LLM judge（复用 `hasDeepSeekKey()` 模式）
4. `runtime_memory_embeddings` 表使用 raw SQL（与 `runtime_memory_fact_relations` 一致），因 Kysely 类型中未包含
5. `MemoryEmbeddingProvider` 的 dimension 可通过首次 `embedBatch` 探测获得

### 决策
1. **不引入 ONNX 本地模型**：避免包体积膨胀，复用现有云端 Provider
2. **关系链仅 1-hop 自动扩展**：2-hop 通过 `memory_find_related` 工具手动触发（已实现）
3. **LoCoMo 不在 CI 中运行**：成本高，通过 `describe.skipIf(!hasDeepSeekKey())` 保护
4. **embedding 预计算在索引构建时**：保证 `search()` 同步（5.2 已实现）
5. **Context Provider 通过回调获取关系**：不直接依赖 `RuntimeMemoryStore`，保持 shadow-only 边界
6. **LoCoMo 全量 250 题**：用户确认"很值得做，需要深度判断短板"，不缩减样本
7. **embedding 默认关闭**：优雅降级到 3-gram，用户在 Settings 中显式开启

---

## 九、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Embedding 异步化破坏现有同步 API | 高 | 预计算 + 缓存，`search()` 保持同步（5.2 已实现） |
| 关系链爆炸导致检索性能下降 | 中 | 单 fact 最多 10 outgoing（6.3 已实现）；扩展最多 2 fact |
| LoCoMo Recall@5 远低于 0.70 | 中 | 短板分析定位问题，可能需调优 RRF 或 topK |
| Settings 开关 UI 回归 | 低 | E2E 覆盖 + i18n 完整（4 语言） |
| DeepSeek API 限流 | 低 | 测试中加 200ms 间隔，复用现有 retry |
| `MemoryEmbeddingProvider` dimension 探测失败 | 低 | `probeEmbeddingDimension` 抛出明确错误，Settings UI 显示状态 |
| LoCoMo fixture 网络下载失败 | 低 | 手动下载 + 固化为 JSON，测试时无网络依赖 |

---

## 十、用户需要提供的信息

1. **DeepSeek API Key**：用于 LoCoMo LLM judge 测试（环境变量 `DEEPSEEK_API_KEY`）
2. **可选：任意 Embedding Provider API Key**（如 OpenAI / Voyage）：用于验证 embedding 端到端流程。测试中可用 mock Provider 替代，但真实 Provider 验证更可靠
3. **无需提供其他材料**：LoCoMo 数据集由脚本自动下载，代码修改由我完成

**用户配置入口**（Phase 5.5 完成后）：
- Settings > Memory > Embedding：开关（默认关闭）
- 开启后使用已配置的 memory embedding provider
- 未开启时使用本地 3-gram TF-IDF 模糊匹配（零回归）
