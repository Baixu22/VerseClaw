# Hindsight 检索与反思层源码研究规范

## 0. 元信息

- 研究对象：`C:\Users\27933\Desktop\mem\hindsight-main`
- 研究目标：扒取 Hindsight（LoCoMo J=89.61% 口径）的检索、实体链接、图遍历、reflect/observation/mental-model、LoCoMo benchmark 与 judge 设计。
- 输出用途：指导当前记忆系统从 `BM25 + Vector RRF`、无图、无 reflect，升级到实体链接检索 + cross-encoder 重排 + 轻量图/反思。
- 约束结论：本文只基于本地源码与文档静态分析；未运行 Hindsight benchmark，因此不独立复现 J=89.61%。

## 1. 一页结论

Hindsight 的核心检索不是 3 路或 5 路，而是 TEMPR 四路检索：Semantic、BM25/Keyword、Graph、Temporal。实体匹配不是单独第 5 路，而是 Graph 路内部的第一等信号，通过 `unit_entities` 自连接扩展共享实体候选。Temporal 是“有时间约束时参与 RRF 的独立检索臂”，同时 temporal proximity 又作为最终重排 boost。

最值得直接借鉴的设计是：

1. 在现有 `BM25 + Vector RRF` 后增加实体/图检索臂：先做 `fact_entities`/`unit_entities`，query-time 共享实体扩展，实体分数用 `tanh(shared_count * 0.5)` 饱和。
2. RRF 后增加 cross-encoder 重排：候选先按 RRF 截到 300，再用 `cross-encoder/ms-marco-MiniLM-L-6-v2` 或等价中文/多语模型重排，最终分数再乘 recency/temporal/proof_count 小幅 boost。
3. 不把 reflect 理解成“直接写新 fact”的在线逻辑；Hindsight 的可落地写入层是 background consolidation 生成 `fact_type='observation'`，保留 `source_memory_ids` 与 `proof_count`，而 mental model 是保存的 reflect 响应/手工查询摘要。

关键证据：

- TEMPR 官方文档说明四路并行：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/retrieval.md:36`
- RRF 后接 Cross-Encoder 的流程图：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/retrieval.md:10`
- 代码按 temporal 是否存在合并 3 或 4 个列表：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/memory_engine.py:4703`
- Graph 路内部包含实体、语义、因果三种扩展信号：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/link_expansion_retrieval.py:4`
- reflect 是查询时 agentic loop：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/reflect.mdx:10`
- retain 后 background observation consolidation：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/retain.md:217`

## 2. 技术 1：多路检索 + RRF + Cross-Encoder

### 2.1 Hindsight 到底是几路检索

结论：官方设计是 4 路 TEMPR；运行时通常是 3 或 4 个 RRF 输入列表。

| 路径 | 是否独立 RRF 臂 | 作用 | 证据 |
|---|---:|---|---|
| Semantic | 是 | embedding ANN/向量召回 | `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/retrieval.md:42` |
| BM25 / Keyword | 是 | 精确词、姓名、术语召回 | `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/retrieval.md:66` |
| Graph | 是 | 通过实体、语义边、因果边扩展 | `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/retrieval.md:82` |
| Temporal | 条件独立臂 | query 包含时间约束时按窗口召回并做覆盖选择 | `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/retrieval.md:97` |

代码路径：

- 先提取 temporal constraint，再跑 semantic+BM25，若有约束再跑 temporal：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:748`
- semantic + BM25 合并查询：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:766`
- temporal 仅在 `temporal_constraint` 存在时执行：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:784`
- graph retrieval 对每个 fact type 并行执行：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:808`
- RRF 合并 3 或 4 路：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/memory_engine.py:4703`

实体匹配不是第 5 路。它属于 Graph 路内部的 `entity` source，与 semantic link、causal link 在 graph 臂内部先合并排序，再作为一个 `graph_results` 列表进入 RRF。源码注释明确“Entity links - query-time self-join through unit_entities”：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/link_expansion_retrieval.py:7`

### 2.2 RRF 公式、k 值、归一化

RRF 公式：

```text
score(d) = sum_i 1 / (k + rank_i(d))
```

- `k = 60`，函数默认值即 60：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/fusion.py:29`
- 文档字符串给出公式：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/fusion.py:33`
- source name 固定为 `semantic`, `bm25`, `graph`, `temporal`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/fusion.py:56`
- 贡献项直接是 `1.0 / (k + rank)`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/fusion.py:85`
- 不做各路 raw score 归一化；RRF 只吃排名。raw score 只影响各自列表内排序。

工程规范：

- 我们当前已有 BM25 + Vector RRF，可保持同一公式。
- 新增实体/图臂时，不要把实体 raw score 与 BM25/vector 分数线性相加；应先在实体/图臂内部排序，再按 RRF rank 融合。
- 若新增 temporal，只有 query 时间约束明确时加入 RRF 输入，否则保持 3 路，避免无意义 recency 污染 multi-hop。

### 2.3 Cross-Encoder 模型、候选数、top-K、时延

默认实现：

- provider 默认 `local`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:763`
- local reranker 默认模型 `cross-encoder/ms-marco-MiniLM-L-6-v2`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:764`
- 模型注释：约 80MB，CPU 上 100 pairs 约 80ms：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/cross_encoder.py:132`
- local batch size 默认 32：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:772`
- TEI batch size 默认 128，最大并发 8：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:773`
- TEI rerank 通过 `/rerank` endpoint：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/cross_encoder.py:346`

候选与预算：

- RRF 后先按 `reranker_max_candidates` 截断，默认 300：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:786`
- 截断位置在 cross-encoder 前：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/memory_engine.py:4740`
- cross-encoder 对截断后的候选重排：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/memory_engine.py:4764`
- recall fixed budget：low=100、mid=300、high=1000，这是各臂召回/graph traversal 的 thinking budget，不等于最终返回 topK：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:1070`
- benchmark 传统 recall 使用 `thinking_budget=500` 映射为 `Budget.HIGH`，`max_tokens=4096`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:457`
- runner 内 `thinking_budget > 70` 映射为 `Budget.HIGH`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/common/benchmark_runner.py:595`

最终 top-K：

- Hindsight 不是固定 top-K，而是按 `max_tokens` 预算裁剪最终 facts/chunks。benchmark 传 `max_tokens=4096`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:463`
- 内部 recall 默认 token budget 是 2048：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:1061`

最终打分：

```text
combined_score = CE_normalized
               * recency_boost
               * temporal_boost
               * proof_count_boost
```

- 公式与 alpha 注释：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/reranking.py:79`
- alpha：recency=0.2、temporal=0.2、proof_count=0.1：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/reranking.py:15`
- temporal proximity 无值时中性 0.5，不影响非 temporal query：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/reranking.py:89`
- cross-encoder 后再 combined scoring 并排序：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/memory_engine.py:4820`

### 2.4 实体匹配一路的具体实现

#### 抽取与输入

- retain pipeline 中 `ProcessedFact.entities` 的 LLM 抽取实体会转成 `{"text": entity.name, "type": "CONCEPT"}`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/retain/entity_processing.py:31`
- 用户提供的 entities 会与 LLM entities 合并去重：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/retain/entity_processing.py:34`
- controlled vocabulary label 也可作为实体进入图，从而改善检索：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/retain.md:104`

#### 存储与索引

- `entities` 表保存 canonical entity：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/models.py:176`
- `unit_entities` 是 memory unit 与 entity 的关联表：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/models.py:214`
- `entity_cooccurrences` 是实体共现缓存：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/models.py:236`
- `unit_entities` 有 `unit_id` 与 `entity_id` 索引：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/models.py:230`
- retain phase 2 在同一事务插入 facts 与 retrieval-critical links：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/retain/orchestrator.py:433`
- entity resolution 后插入 `unit_entities`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/retain/orchestrator.py:456`
- 注意：entity links 不写入 `memory_links`，检索用 `unit_entities` 自连接；UI 图才派生 entity edges：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/retain/orchestrator.py:488`

#### 实体解析打分

批量 resolve：

- 按类型批量查询候选、减少 DB roundtrip：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/entity_resolver.py:225`

候选打分：

```text
entity_resolution_score =
  0.5 * name_similarity
+ 0.3 * cooccurrence_overlap
+ 0.2 * temporal_proximity_if_within_7_days
```

- name similarity 0-0.5：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/entity_resolver.py:663`
- co-occurring entities 0-0.3：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/entity_resolver.py:667`
- temporal proximity 0-0.2，7 天内线性衰减：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/entity_resolver.py:674`
- 统一阈值 `> 0.6` 才合并到 existing canonical entity：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/entity_resolver.py:690`

#### Query-time 扩展与图臂打分

Graph 路内部先从 seed memory 的 entities 找共享实体候选：

- `seed_entities` 从 seed unit ids 查 distinct `entity_id`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/db/ops_postgresql.py:491`
- `entity_expanded` 对每个 entity 做 lateral cap，默认受 `graph_per_entity_limit` 控制，避免高频实体爆炸：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/db/ops_postgresql.py:503`
- entity score 是 `COUNT(DISTINCT se.entity_id)`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/db/ops_postgresql.py:500`

Graph 臂内部三信号：

- Entity：共享实体数。
- Semantic：预计算 kNN link，双向查询，取 `MAX(weight)`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/db/ops_postgresql.py:526`
- Causal：`causes/caused_by/enables/prevents` 等显式 causal links：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/link_expansion_retrieval.py:15`

Graph 内部分数：

```text
entity_score = tanh(shared_entity_count * 0.5)
graph_internal_score = entity_score + semantic_score + causal_score
```

- `tanh(count * 0.5)` 的饱和映射说明：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/link_expansion_retrieval.py:210`
- 实现行：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/link_expansion_retrieval.py:224`
- additive 合并：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/link_expansion_retrieval.py:239`

### 2.5 时态过滤是独立一路还是后处理

结论：两者都是，但职责不同。

1. Temporal retrieval 是条件独立 RRF 臂：只有 query 能抽出时间窗口时执行，结果作为第 4 个 list 加入 RRF。
2. Temporal proximity 是重排阶段的小幅后处理 boost：只在 temporal query 有意义，无 temporal proximity 时按 0.5 中性值处理。

Hindsight 不使用 `valid_from/valid_to` 命名。它的时间字段是：

- legacy `event_date`
- `occurred_start`
- `occurred_end`
- `mentioned_at`

证据：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/models.py:114`

窗口匹配逻辑：

- range overlap：`occurred_start <= window_end AND occurred_end >= window_start`
- 或 `mentioned_at` / `occurred_start` / `occurred_end` 落在窗口内
- 同时保留 semantic similarity 下限

证据：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:492`

Temporal 覆盖策略：

- temporal pool per fact type 默认 60：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:324`
- 每个 fact type 保留 10 个 entry points：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:325`
- 时间窗口分 8 个 bucket，按 similarity 排名池做覆盖选择：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:326`
- 选择函数说明“每个 populated bucket 先贡献最强项”：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:341`
- temporal proximity 以窗口中心距离计算：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:563`
- temporal spreading 最多 5 轮，通过 temporal/causal 相关边扩展；Oracle 不支持 `unnest` 时跳过 spread：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:596`

对当前系统的规范建议：

- 如果你们已有 `valid_from/valid_to`，可映射为 Hindsight 的 `occurred_start/occurred_end`。
- `mentioned_at` 应保存“何时说出/写入”，用于用户问“最近提到什么”或事实没有明确发生时间时回退。
- Temporal 不应替代 BM25/vector；应作为条件检索臂，解决 multi-hop 与 temporal 混合问题。

## 3. 技术 3：Reflect、Observations、Mental Models

### 3.1 先拆概念

Hindsight 里容易被混用的三层：

| 层 | 是否写入新 memory fact | 触发 | 输入 | 输出 |
|---|---:|---|---|---|
| `reflect()` | 否，查询时回答 | API/CLI 手动调用 | query + mental models + observations + raw facts + expand | answer/text、citations、tool traces、based_on |
| Observation consolidation | 是，写 `memory_units.fact_type='observation'` | retain 后后台触发，也可等待 consolidation | new raw facts + recalled existing observations | observation memory unit，带 `source_memory_ids`/`proof_count` |
| Mental model refresh | 是，写 `mental_models` 表内容，不是 fact | 手动 refresh、创建后 async、consolidation 后触发、cron 配置 | source query 经 reflect 重新执行 | 保存的 curated summary / reflect response |

官方 reflect 文档明确它是 agentic loop：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/reflect.mdx:10`

Observations 与 mental models 的区别在 consolidator 顶部注释中说明：observations 是 bottom-up 自动生成，mental models 是用户定义查询、通过 reflect 刷新：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py:13`

### 3.2 reflect 操作触发条件

`reflect()` 本身：

- 手动/API/CLI 调用，适合需要综合推理、引用证据、使用 disposition 的问题。
- 文档对比 `recall()` 与 `reflect()` 的使用场景：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/reflect.mdx:93`
- CLI 有 `memory reflect` 命令：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-cli/src/commands/memory.rs:342`

Observation consolidation：

- retain 完成后 background 触发，分析新 facts、创建/更新 observations、追踪支持 facts：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/retain.md:219`
- runner 支持 `wait_consolidation`，用于 LoCoMo benchmark 等待后台观察合并完成：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:306`

Mental model refresh：

- 创建 mental model 后异步刷新：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/common/benchmark_runner.py:468`
- consolidation 后可触发 `refresh_after_consolidation=true` 的 mental models：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py:1390`
- 触发时提交 async refresh task：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py:1431`

### 3.3 reflect 输入与输出

reflect agent 工具层级：

1. `search_mental_models`
2. `search_observations`
3. `recall`
4. `expand`
5. `done`

证据：

- 官方工具列表与优先级：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/reflect.mdx:44`
- agent signature 接收 `search_mental_models_fn`、`search_observations_fn`、`recall_fn`、`expand_fn`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/agent.py:421`
- agent 内部说明 hierarchical retrieval：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/agent.py:441`
- forced sequence 先 mental models，再 observations，再 recall：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/agent.py:729`
- evidence-before-done guardrail：没有任何 evidence 不允许提前 done：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/agent.py:988`

Reflect output 是 response + metadata，而不是直接写 fact。LoCoMo reflect generator 将 `result.text` 作为回答，并从 `result.based_on` 展开 retrieved memories：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:274`

### 3.4 derived=true 与 source fact_ids

源码中未发现统一的 `derived=true` 字段。Hindsight 的 derivedness 是通过 `fact_type='observation'` 隐式表达：

- consolidator 注释：observations 存在 `memory_units`，`fact_type='observation'`，包含 `proof_count` 与 `source_memory_ids`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py:8`
- create observation 时插入 `memory_units`，`fact_type='observation'`，`proof_count=1`，写入 `source_memory_ids`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py:2341`
- update observation 时扩展 `source_memory_ids` 并更新 `proof_count`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py:1870`
- LLM consolidation prompt 要求 `source_fact_ids` 必须是 exact UUID：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/consolidation/prompts.py:135`

对当前系统的规范建议：

- 我们可以显式增加 `derived=true`，但必须同时保存 `source_fact_ids`。
- 原始事实保持 ADD-only；derived observation 可以 CREATE/UPDATE/DELETE，但必须有 history 或 version。
- 评测与 explainability 中应展示 source fact ids，而不是只展示 derived text。

### 3.5 reflect 与图遍历的关系

结论：reflect 不直接写图边；observation 也不复制 source facts 的 `memory_links`。检索通过以下方式保持连接：

- observation 自身有 embedding，可走 semantic。
- observation 有 temporal fields，可走 temporal。
- observation 通过 `source_memory_ids` 回到 raw facts，再经 `unit_entities` 参与实体连接。

证据：

- `_create_memory_links` 是 placeholder，不创建 links：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py:1975`
- 注释明确 observations 不复制 memory_links，而是通过 `source_memory_ids -> unit_entities`、own embeddings、temporal fields 检索：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py:1983`

对当前系统的规范建议：

- 第一版不要把 reflect 产物直接塞邻接表，避免伪边污染 graph。
- 将 derived observation 作为普通可检索 fact，保留 `source_fact_ids`，实体边可由 source facts 间接提供。
- 若要图遍历 observations，可在查询时把 observation 的 source facts 作为 expansion seeds。

### 3.6 reflect prompt、温度、max_tokens

Prompt：

- reflect system prompt builder 在 `build_system_prompt_for_tools`，明确 hierarchical retrieval：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/prompts.py:96`
- 关键反幻觉规则：“MUST ONLY use information from retrieved tool results”：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/prompts.py:130`
- 必须搜索后才能说不知道：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/prompts.py:159`

温度：

- reflect 默认温度 0.9：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:185`
- retain 默认 0.1、consolidation 默认 0.0；这说明 Hindsight 区分“抽取/合并要稳定”和“reflect thinking 可更发散”：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:184`

迭代与 token：

- reflect 默认最大 10 轮：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:1056`
- reflect 最大上下文默认 100,000 tokens，wall timeout 300 秒：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:1057`
- `run_reflect_agent` 可传 `max_tokens` 控制最终输出：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/agent.py:426`

## 4. 评测对齐：LoCoMo Benchmark 与 Judge

### 4.1 Hindsight LoCoMo 文件结构

用户指定的 `evaluation.py`、`ontology.py`、`prompts.py` 在本地 Hindsight 路径下不存在。实际文件是：

- `hindsight-dev/benchmarks/locomo/locomo_benchmark.py`
- `hindsight-dev/benchmarks/locomo/datasets/locomo10.json`
- `hindsight-dev/benchmarks/common/benchmark_runner.py`

目录证据：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:1`

### 4.2 采样策略

Hindsight 本地 benchmark 默认使用 `locomo10.json`，包含 10 个 conversation：

```text
conv-26, conv-30, conv-41, conv-42, conv-43, conv-44, conv-47, conv-48, conv-49, conv-50
```

运行逻辑：

- dataset load 只是 JSON 顺序读取；`max_items` 时取前 N 个，不做分层随机采样：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:28`
- dataset path 固定 `datasets/locomo10.json`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:404`
- CLI 支持 `--max-conversations`、`--max-questions`、`--conversation`、`--question-index`，这些是裁剪/过滤，不是采样策略：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:567`
- 每个 conversation 用独立 bank/agent id，允许并行处理 3 个 conversation：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:449`
- QA 评测跳过 category=5 和无 answer 的问题：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/common/benchmark_runner.py:668`
- category mapping：1=Multi-hop、2=Single-hop、3=Temporal、4=Open-domain：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:487`

与我们 500 题分层采样的差异：

- Hindsight `locomo10` 是固定 10 个 conversation 全量/裁剪，不体现你们 500 题分层采样口径。
- Hindsight 的 category=5 直接跳过；如果我们 500 题里包含不可答/无答案类，必须明确是否跳过，否则 J 值不可直接比较。
- Hindsight 可用 reflect 模式或 traditional recall+LLM 模式；两者输出文件不同。`--use-reflect` 时 answer generator 自己调用 reflect，不走外部 recall：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:196`

### 4.3 LoCoMo Answer Generation Prompt

传统 recall+LLM 模式：

- answer model 默认从 `HINDSIGHT_API_ANSWER_LLM_*` 读取，fallback 到 `HINDSIGHT_API_LLM_*`，默认 `gpt-4o-mini`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:117`
- prompt 要求分析所有 memories，重视 timestamps，矛盾信息全说，relative time 转具体日期，必要时逻辑推理：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:165`

Reflect 模式：

- 用 `memory.reflect_async`，`budget=Budget.HIGH`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:267`
- prompt 明确“Search thoroughly across all available memories before answering”：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:251`

### 4.4 Judge prompt 与 frozen-v1 对齐性

Benchmark judge：

- Judge model 配置从 `HINDSIGHT_API_JUDGE_LLM_*` 读取，fallback 到 `HINDSIGHT_API_LLM_*`，默认 `gpt-4o-mini`：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/common/benchmark_runner.py:223`
- LoCoMo 默认 judge prompt 是 generous binary correctness：答案只要 touching same topic 就算 correct；时间格式不同也可算 correct；无法回答类只要说不知道也可算 correct：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/common/benchmark_runner.py:307`
- judge call 使用 structured `JudgeResponse`，temperature=0，max_completion_tokens=4096：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/common/benchmark_runner.py:324`

测试工具 judge：

- `tests/llm_judge.py` 默认 Gemini `gemini-2.5-flash-lite`，用于 hs_llm_core tests，不是 LoCoMo benchmark 主 judge：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/tests/llm_judge.py:30`
- primary verdict temp=0；若判不通过，会用 higher temperature 0.5 做 2 次确认以降低 flaky：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/tests/llm_judge.py:47`
- 测试 judge prompt 是通用 criteria judge，不是 LoCoMo gold/predicted judge：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/tests/llm_judge.py:75`

与我们 frozen-v1 的关系：

- 只确认一个共同点：主判分温度都是 0。
- 不一致点：Hindsight LoCoMo judge 更 generous，尤其是“touches same topic”与 temporal off-format 宽松判定；如果 frozen-v1 更严格，Hindsight J 值不可直接对齐。
- 不一致点：Hindsight benchmark judge 默认模型可随 env 改，源码默认不是 `deepseek-chat`。
- 建议：复现对比时必须冻结 judge prompt、judge model、category skip 规则、reflect/traditional 模式、是否等待 consolidation。

## 5. 不可直接借鉴或需改造点

1. PostgreSQL/pgvector/扩展依赖较重。Hindsight storage 文档明确主存储是 PostgreSQL，向量搜索依赖 pgvector，图查询依赖 recursive CTE：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/storage.md:3`。如果当前系统不是 Postgres，应移植“表结构与算法”，不要照搬 DB 绑定实现。
2. Hindsight 明确不做通用 storage abstraction，工程复杂度转嫁到 Postgres 生态：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/storage.md:27`。我们若已有多后端，应保留自己的抽象。
3. Cross-encoder 默认英文 MS MARCO 模型，对中文/多语 LoCoMo 变体未必最优；中文系统应评估 `bge-reranker`/`jina-reranker`/多语 reranker。
4. `reflect` 默认 temp=0.9，适合开放综合回答，不适合直接写事实。写入型 consolidation 反而默认 temp=0.0：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/config.py:186`
5. Hindsight 没有显式 `derived=true` 字段。若我们需要审计/回滚，建议显式字段 + `source_fact_ids`，不要只靠 `fact_type='observation'`。
6. Graph expansion 中 Oracle fallback 会跳过 temporal multi-hop spread：`file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:596`。说明部分高级图遍历与 DB 能力强绑定。
7. LoCoMo judge 非 frozen-v1。若直接拿 Hindsight prompt，会改变我们已有 J 值口径。

## 6. 对当前系统的落地规范

### 6.1 检索升级 v1：从 2 路到 3 路

目标：`BM25 + Vector + EntityGraph` 三路 RRF。

表结构建议：

```text
facts(id, text, embedding, occurred_start, occurred_end, mentioned_at, ...)
entities(id, canonical_name, type, first_seen, last_seen, mention_count, metadata)
fact_entities(fact_id, entity_id)
entity_cooccurrences(entity_id_1, entity_id_2, count, last_cooccurred)
```

查询流程：

1. Vector arm：现有向量召回 topN。
2. BM25 arm：现有关键词召回 topN。
3. EntityGraph arm：从 vector/BM25 seeds 或 query entity extraction 得到 seed entities，扩展共享实体 facts；score=`tanh(shared_count*0.5)`。
4. RRF：`sum 1/(60+rank)`。
5. 截断 top 300 给 reranker。

验收指标：

- Recall@5 优先观察 entity-heavy 与 multi-hop 问题。
- multi_hop J 应明显高于当前 46%，否则实体解析/查询实体抽取失败。

### 6.2 重排升级 v1：Cross-Encoder + 小幅 boost

建议参数：

```text
reranker_max_candidates = 300
local_batch_size = 32
final_score = ce_norm * recency_boost(±10%) * temporal_boost(±10%) * proof_count_boost(±5%)
```

注意：

- 如果 reranker 模型原始 logits 不在 [0,1]，用 sigmoid 或 min-max/校准函数归一化。
- boost 只能小幅，不要让 recency 覆盖 relevance。
- 对中文任务优先测多语/中文 reranker，不盲用 MS MARCO MiniLM。

### 6.3 Temporal v1：条件臂而非全局 recency

字段映射：

```text
valid_from -> occurred_start
valid_to   -> occurred_end
created_at / uttered_at -> mentioned_at
```

查询：

- 只有 query 被解析出时间窗口时，新增 temporal arm。
- temporal arm 先按窗口 overlap 过滤，再按 semantic relevance 取 pool，再按 8 buckets 做 coverage。
- temporal proximity 只作为最终 boost；无时间 query 时必须 neutral。

### 6.4 Reflect/Observation v1

不要第一版就做完整 agentic reflect 写入。建议先实现 background observation：

1. retain raw facts ADD-only。
2. 每批/每 N 条 facts 后触发 consolidation。
3. consolidation 输入：new facts + 相关 existing observations。
4. LLM 输出：create/update observation，必须带 `source_fact_ids`。
5. observation 写入 facts 表或 derived 表，字段：`derived=true`、`fact_type='observation'`、`source_fact_ids`、`proof_count`、`version/history`。
6. 检索时 observation 可参与 vector/BM25/temporal；图连接通过 source facts 间接参与。

Reflect agent 可放第二阶段：

- 工具顺序：search_mental_models -> search_observations -> recall -> expand。
- Guardrail：无 evidence 不允许 answer/done。
- 温度：回答型可 0.7-0.9；写入型必须 0-0.1。

## 7. 必答问题索引

### 技术 1

1. Hindsight 是几路并行检索？  
   4 路 TEMPR：Semantic、BM25、Graph、Temporal。运行时没有 temporal constraint 时 RRF 只有前三路。实体不是独立第五路，是 Graph 内部信号。

2. RRF 公式、k、归一化？  
   `sum_i 1/(60+rank_i)`；`k=60`；RRF 不归一化 raw score，只用 rank。

3. Cross-encoder 模型、候选数、top-K、时延？  
   默认 local `cross-encoder/ms-marco-MiniLM-L-6-v2`；RRF top 300 进 reranker；最终不是固定 top-K，而是 token budget 裁剪；源码注释 CPU 100 pairs 约 80ms。

4. 实体匹配怎么抽、建索引、打分？  
   retain LLM 抽取 entities + user entities 合并；写 `entities`、`unit_entities`、`entity_cooccurrences`；解析分数 `0.5 name + 0.3 cooccurrence + 0.2 temporal`，阈值 >0.6；检索时共享实体 count，经 `tanh(count*0.5)` 后进入 graph 内部排序。

5. Temporal 是独立一路还是后处理？  
   两者都是：有时间约束时作为独立 RRF 臂；最终重排再用 temporal proximity 小幅 boost。字段不是 `valid_from/valid_to`，而是 `occurred_start/occurred_end/mentioned_at`。

### 技术 3

1. reflect 触发条件？  
   `reflect()` 是手动/API/CLI 查询时触发；observation consolidation 是 retain 后后台触发；mental model refresh 可手动、创建后异步、consolidation 后、cron。

2. reflect 输入输出？  
   输入 query、bank profile/disposition、mental models、observations、raw facts、expand source text；输出 answer/text、structured output、tool traces、citations/based_on，不直接写 fact。

3. 新 fact 如何 `derived=true`、如何溯源？  
   Hindsight 无显式 `derived=true`；通过 `fact_type='observation'` 表示 derived，`source_memory_ids`/`proof_count` 溯源。我们建议显式加 `derived=true`。

4. reflect 与图遍历关系？  
   reflect 产物不直接进入邻接表；observations 不复制 `memory_links`，通过自身 embedding/temporal 与 `source_memory_ids -> unit_entities` 间接连接。

5. reflect prompt、温度、max_tokens？  
   prompt 在 `engine/reflect/prompts.py`，强制只用 retrieved tool results；默认温度 0.9；最大 10 轮；默认上下文 100k tokens；最终输出 token 可传 `max_tokens`。

### 评测对齐

1. Hindsight LoCoMo 采样策略？  
   固定 `locomo10.json` 十个 conversations，默认全量顺序读取，可命令行前 N/指定会话/指定问题裁剪；跳过 category=5。不同于我们的 500 题分层采样。

2. Judge prompt 与 frozen-v1 是否一致？  
   不一致。Hindsight benchmark judge 是 generous LoCoMo binary prompt，temp=0，默认模型随 env/fallback；测试 judge 默认 Gemini 且有二次确认。不能直接与 frozen-v1/deepseek-chat 对齐。

## 8. 参考文件清单

- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/retrieval.md:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/reflect.mdx:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/retain.md:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-docs/docs/developer/storage.md:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/locomo/locomo_benchmark.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-dev/benchmarks/common/benchmark_runner.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/tests/llm_judge.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/fusion.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/retrieval.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/link_expansion_retrieval.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/search/reranking.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/cross_encoder.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/agent.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/prompts.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/retain/entity_processing.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/engine/retain/orchestrator.py:1`
- `file:///C:/Users/27933/Desktop/mem/hindsight-main/hindsight-api-slim/hindsight_api/models.py:1`
