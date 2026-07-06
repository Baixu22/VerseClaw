# Zep / Graphiti LoCoMo 设计规范扒取报告

## 0. 报告元信息

- 研究对象：`C:\Users\27933\Desktop\mem\zep-main`，以及其指向的开源 Graphiti 引擎源码只读副本 `C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740`。
- 输出目标：为当前记忆系统从 `J=50.67%`、`multi_hop J=46%` 提升，提取 Zep/Graphiti 的轻量图遍历、双时态事实与 LoCoMo benchmark 可复用设计。
- 约束确认：未修改 `C:\Users\27933\Desktop\mem\zep-main` 源码；仅写入本报告。
- 模板说明：用户消息中未附上“统一输出格式模板”的正文，本报告按统一设计规范文档结构输出：结论、源码证据、设计规范、必答问题、评测对齐、不可借鉴点、ROI。

## 1. 一页结论

1. `zep-main` 不是 Graphiti 引擎源码，而是 Zep Cloud examples / integrations / benchmarks / legacy CE。项目 README 明确说 “not Zep's product or service”，并指向 Graphiti OSS：`C:\Users\27933\Desktop\mem\zep-main\README.md:17-31`。
2. Zep/Graphiti 的事实字段不是 `valid_from/valid_to/superseded_by`，源码实际是 `created_at`、`valid_at`、`invalid_at`、`expired_at`。`superseded_by` 没有在本地 Zep/Graphiti 源码中作为字段出现。
3. “失效旧 fact”是软失效：旧边保留，只更新 `invalid_at` 和 `expired_at`；新事实作为新边或已解析边进入图，不做硬删除。Graphiti README 也明确为 “invalidated - not deleted”。
4. Graphiti 的 multi-hop 核心不是复杂推理器，而是：BM25 + 向量候选 + BFS 图扩展 + RRF/MMR/cross-encoder 重排 + 时态字段过滤。默认 BFS 最大深度为 3。
5. LoCoMo harness 评测不是 500 题分层采样，而是 locomo10 全量 QA，跳过 category 5；默认 `gpt-4o-mini`、temperature 0，同时评估 answer accuracy 和 context completeness。
6. 我们可以不用 Neo4j 直接照搬全量 Graphiti，但可以实现轻量邻接表/KV 子集：实体链接 seed + fact adjacency BFS(depth<=2/3) + 双时态软失效 + cross-encoder 重排。这个子集最贴近当前 multi_hop 短板，ROI 高。

## 2. 源码证据索引

### 2.1 仓库边界

- `C:\Users\27933\Desktop\mem\zep-main\README.md:17-31`：该仓库是 Zep Cloud examples / integrations / tools，不是产品或服务；Graphiti OSS 是独立项目。
- `C:\Users\27933\Desktop\mem\zep-main\legacy\src\lib\graphiti\service_ce.go:20-35`：legacy CE 通过 HTTP 调用 Graphiti service，仅暴露请求/Fact DTO，不是图引擎。

### 2.2 存储后端

- `C:\Users\27933\Desktop\mem\zep-main\legacy\docker-compose.ce.yaml:41-70`：CE docker compose 启动 `zepai/graphiti:0.3`，通过 `NEO4J_URI=bolt://neo4j:7687` 连接 Neo4j。
- `C:\Users\27933\Desktop\mem\zep-main\legacy\docker-compose.ce.yaml:70-86`：Neo4j 镜像为 `neo4j:5.22.0`。
- `C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\driver\driver.py:59-64`：Graphiti provider 枚举支持 `NEO4J`、`FALKORDB`、`KUZU`、`NEPTUNE`。
- `C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\graphiti.py:137-212`：未传 `graph_driver` 时默认创建 `Neo4jDriver`。

### 2.3 Fact 双时态字段

关键片段：

```python
# C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\edges.py:263-282
class EntityEdge(Edge):
    name: str = Field(description='name of the edge, relation name')
    fact: str = Field(description='fact representing the edge and nodes that it connects')
    fact_embedding: list[float] | None = Field(default=None, description='embedding of the fact')
    episodes: list[str] = Field(default=[], description='list of episode ids that reference these entity edges')
    expired_at: datetime | None = Field(default=None, description='datetime of when the node was invalidated')
    valid_at: datetime | None = Field(default=None, description='datetime of when the fact became true')
    invalid_at: datetime | None = Field(default=None, description='datetime of when the fact stopped being true')
    reference_time: datetime | None = Field(default=None, description='reference timestamp from the episode that produced this edge')
```

Zep 文档对四个时间字段的语义：

- `created_at`：Zep 何时学到该事实。
- `valid_at`：事实何时在现实世界变真。
- `invalid_at`：事实何时在现实世界不再为真。
- `expired_at`：Zep 何时得知它不再有效。
- 证据：`C:\Users\27933\Desktop\mem\zep-main\plugins\building-with-zep\skills\building-with-zep\references\concepts.md:47-61`。

### 2.4 软失效逻辑

关键片段：

```python
# C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\edge_operations.py:563-571
elif (
    edge_valid_at_utc is not None
    and resolved_edge_valid_at_utc is not None
    and edge_valid_at_utc < resolved_edge_valid_at_utc
):
    edge.invalid_at = resolved_edge.valid_at
    edge.expired_at = edge.expired_at if edge.expired_at is not None else utc_now()
    invalidated_edges.append(edge)
```

- 新 fact 若比旧 fact 更新，旧边设置 `invalid_at = new.valid_at`，`expired_at = utc_now()`，保留历史边。
- 新 fact 自己如果已经带 `invalid_at`，也会补 `expired_at`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\edge_operations.py:820-823`。
- 若存在更近的矛盾 candidate，新边也会被立刻失效：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\edge_operations.py:825-839`。
- Graphiti README 明确：“Facts have validity windows. When information changes, old facts are invalidated - not deleted”：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\README.md:125-128`。

### 2.5 Episode 溯源

- Fact edge 存 `episodes: list[str]`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\edges.py:267-270`。
- 抽取边时把 `episode_indices` 映射到 episode UUID：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\edge_operations.py:290-305`。
- episode 存 raw `content`、`valid_at`、`entity_edges`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\nodes.py:318-350`。
- `_process_episode_data` 会把 `ep.entity_edges = [edge.uuid for edge in entity_edges]` 写回 episode：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\graphiti.py:720-733`。
- episode 与 entity 之间还有 `MENTIONS` 边：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\edge_operations.py:52-96`。

### 2.6 写入与抽取流程

Graphiti `add_episode` 核心流水线：

- 取 previous episodes 作为上下文：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\graphiti.py:1086-1096`。
- 创建 episode，`valid_at=reference_time`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\graphiti.py:1098-1111`。
- LLM 抽实体，解析/去重实体：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\graphiti.py:1121-1137`。
- 抽关系/事实，解析矛盾并产生失效边：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\graphiti.py:1139-1156`。
- 仅用 new_edges 更新节点属性/摘要，避免重复旧事实：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\graphiti.py:1158-1167`。
- 保存 episode、MENTIONS、entity nodes、entity edges：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\graphiti.py:1169-1179`。

实体抽取不是 SpaCy，而是 LLM + schema context：

- `extract_nodes` 构建 entity types context、previous episodes、episode attribution：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\node_operations.py:70-149`。
- `_build_entity_types_context` 默认加入 `Entity`，再加入用户定义 Pydantic types：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\node_operations.py:152-180`。
- `_call_extraction_llm` 根据 message/text/json 选择 prompt，调用 LLM 并要求 `ExtractedEntities` response model：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\node_operations.py:244-280`。
- 时间抽取 prompt 明确生成 `valid_at` / `invalid_at`，不幻觉日期：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\prompts\extract_edges.py:242-301`。

### 2.7 图遍历与检索

Graphiti 搜索方法和重排器：

- Edge search methods：`cosine_similarity`、`bm25`、`bfs`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_config.py:32-35`。
- Node search methods：`cosine_similarity`、`bm25`、`bfs`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_config.py:38-41`。
- Reranker：`rrf`、`node_distance`、`episode_mentions`、`mmr`、`cross_encoder`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_config.py:53-66`。
- 默认 `MAX_SEARCH_DEPTH=3`、`DEFAULT_MMR_LAMBDA=0.5`、`DEFAULT_MIN_SCORE=0.6`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_utils.py:64-68`。
- combined cross-encoder recipe 明确把 BM25、cosine、BFS 全部打开：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_config_recipes.py:80-108`。
- edge/node 专项 cross-encoder recipe：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_config_recipes.py:142-153`、`187-198`。

顶层搜索并行执行 edge/node/episode/community：

- `search()` 会按配置并行执行 scopes：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search.py:98-250`。
- edge search 每路候选取 `2 * limit`，再重排并截断：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search.py:253-460`。

BFS 关键片段：

```python
# C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_utils.py:548-562
UNWIND $bfs_origin_node_uuids AS origin_uuid
MATCH path = (origin {uuid: origin_uuid})-[:RELATES_TO|MENTIONS*1..{bfs_max_depth}]->(:Entity)
UNWIND relationships(path) AS rel
MATCH (n:Entity)-[e:RELATES_TO {uuid: rel.uuid}]-(m:Entity)
...
RETURN DISTINCT
...
LIMIT $limit
```

- edge BFS 从 origin entity 或 episodic node 出发，沿 `RELATES_TO|MENTIONS` 走到 Entity，再收集路径上的 `RELATES_TO` fact edge：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_utils.py:448-565`。
- node BFS 返回路径终点 Entity：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_utils.py:790-883`。
- Neo4j 专用实现同样是 `RELATES_TO|MENTIONS*1..max_depth`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\driver\neo4j\operations\search_ops.py:179-228`、`345-395`。

RRF 关键片段：

```python
# C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_utils.py:1780-1795
def rrf(results: list[list[str]], rank_const=1, min_score: float = 0):
    scores: dict[str, float] = defaultdict(float)
    for result in results:
        for i, uuid in enumerate(result):
            scores[uuid] += 1 / (i + rank_const)
```

- Graphiti Python RRF 默认 `rank_const=1`，没有归一化。
- legacy Go RRF 也是 `1.0 / float64(rank+1)`：`C:\Users\27933\Desktop\mem\zep-main\legacy\src\lib\search\rrf.go:13-48`。

MMR 关键片段：

```python
# C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_utils.py:1901-1935
mmr = mmr_lambda * np.dot(query_array, candidate_arrays[uuid]) + (mmr_lambda - 1) * max_sim
```

- Graphiti Python 的 MMR 一次性按 query 相似度和候选间最大相似度打分排序，不是 legacy Go 那种迭代选择 top-k。
- legacy Go MMR 是 LangChain 风格迭代选取：`lambda*queryScore - (1-lambda)*redundantScore`：`C:\Users\27933\Desktop\mem\zep-main\legacy\src\lib\search\mmr.go:39-90`。

Graph-distance / node_distance：

- 开源 fallback 和 Neo4j 专用实现只匹配中心节点的一跳 `RELATES_TO`，命中 score=1，未命中设为 `inf`，最终用 `1/score` 排序：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_utils.py:1798-1857`、`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\driver\neo4j\operations\search_ops.py:531-582`。
- 因此可移植设计中应称为“一跳邻近偏置”，不要误写成完整最短路重排，除非我们自己实现 BFS 距离。

过滤能力：

- `SearchFilters` 支持 `node_labels`、`edge_types`、`valid_at`、`invalid_at`、`created_at`、`expired_at`、`edge_uuids`、`property_filters`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_filters.py:55-67`。
- edge filter builder 支持 edge type、edge uuid、node label、valid_at 等时间过滤：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_filters.py:120-168`。
- Zep API 文档也列出 type/property/datetime filters：`C:\Users\27933\Desktop\mem\zep-main\plugins\building-with-zep\skills\building-with-zep\references\apis.md:99-116`。

### 2.8 Ontology

LoCoMo benchmark 本体：

- entity types：`Person`、`Preference`、`Location`、`Event`、`Object`、`Topic`、`Organization`、`Document`：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\ontology.py:7-95`。
- 其中 `Preference` 有最高优先级说明，`Object` / `Topic` 被要求作为最后兜底：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\ontology.py:11-18`、`44-63`。
- LoCoMo harness 调 `set_ontology(entities=ZEP_NODE_ONTOLOGY_V2, edges={})`，没有自定义 edge types：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\ingestion.py:88-94`。

默认本体：

- 默认节点包括 `User`、`Assistant`、`Preference`、`Location`、`Event`、`Object`、`Topic`、`Organization`、`Document`：`C:\Users\27933\Desktop\mem\zep-main\ontology\default_ontology.py:4-129`。
- 默认 edge types 只有 `LOCATED_AT`、`OCCURRED_AT`，并定义 source/target map：`C:\Users\27933\Desktop\mem\zep-main\ontology\default_ontology.py:103-139`。

### 2.9 Reflect / summary / observation

- Graphiti 开源有 `summarize_saga`，按 `last_summarized_at` 只拉新增 episode，保留 `last_summarized_episode_valid_at` 作为事件时间水位：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\graphiti.py:438-568`。
- Zep 文档说 entity summary 会随新 facts 增量再生成：`C:\Users\27933\Desktop\mem\zep-main\plugins\building-with-zep\skills\building-with-zep\references\concepts.md:32-37`。
- user summary 总是放入 context block，且用户不能直接写，只能通过 instructions 影响：`C:\Users\27933\Desktop\mem\zep-main\plugins\building-with-zep\skills\building-with-zep\references\concepts.md:84-90`。
- thread summaries 自动增量更新：`C:\Users\27933\Desktop\mem\zep-main\plugins\building-with-zep\skills\building-with-zep\references\concepts.md:97-105`。
- observations 是跨实体的证据支持模式，但文档标为 Flex Plus / Enterprise，且只读：`C:\Users\27933\Desktop\mem\zep-main\plugins\building-with-zep\skills\building-with-zep\references\concepts.md:108-119`。

结论：没有找到一个可直接照搬的 “periodic reflect API”。可借鉴的是“周期性派生摘要/观察”的产品形态，而非具体开源 reflect 实现。

## 3. LoCoMo Benchmark 实现对齐

### 3.1 配置与模型

- 默认 graph params：edge limit 20、edge reranker `cross_encoder`、node limit 20、node reranker `rrf`：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\config.py:10-17`。
- 允许 reranker：`cross_encoder`、`rrf`、`mmr`：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\config.py:18-25`。
- 默认 response/grader model 都是 `gpt-4o-mini`，temperature 都是 0：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\config.py:28-34`。
- 实际 YAML 配置是 edge limit 15、node limit 5，edge/node 都用 `cross_encoder`：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\benchmark_config.yaml:9-27`。
- locomo10 数据地址：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\constants.py:18-21`。

### 3.2 数据摄入

- 下载 locomo10 并写 `data/locomo.json`：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\ingestion.py:36-52`。
- 每个 group 创建一个 graph：`graph_id=f"{prefix}_experiment_graph_{group_idx}"`：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\ingestion.py:70-83`。
- 设置 LoCoMo ontology：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\ingestion.py:88-94`。
- 最多摄入 35 个 session：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\ingestion.py:102-107`。
- 每条消息独立 `graph.add(type="message", created_at=iso_date)`，没有本地 batch 抽取控制：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\ingestion.py:119-143`。

### 3.3 检索与上下文

- 评测时并行搜索 nodes 和 edges 两个 scope：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\evaluation.py:126-143`。
- API 调用是 `zep.graph.search(query, graph_id, scope, reranker, limit)`：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\evaluation.py:63-73`。
- context 格式为 facts + entities，facts 写 `edge.fact (event_time: edge.valid_at)`，entities 写 `node.name: node.summary`：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\evaluation.py:198-204`。
- context prompt 强调 timestamp 是事件发生时间，不是被提及时间：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\prompts.py:3-21`。

### 3.4 评测逻辑

- 评测 locomo10 所有 QA，但跳过 category 5，因为没有 gold：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\evaluation.py:82-89`。
- response generation 和 context completeness 并行执行：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\evaluation.py:149-167`。
- response prompt 要求看时间戳、矛盾时优先最新 memory、转换相对时间：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\prompts.py:29-69`。
- judge prompt 是宽松 CORRECT/WRONG，时间格式不同也可以算对：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\prompts.py:77-99`。
- judge 使用 OpenAI structured parse 到 `Grade`，temperature 来自 config：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\evaluation.py:221-241`。
- context completeness 有 `COMPLETE`、`PARTIAL`、`INSUFFICIENT`，并明确历史事实仍算有效上下文：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\evaluation.py:251-337`。
- 汇总指标包括 accuracy、completeness rates、accuracy_with_complete_context、by_category、by_difficulty：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\common.py:93-121`。

### 3.5 与当前 frozen-v1 的差异

- Zep LoCoMo：`gpt-4o-mini`，temperature 0，宽松 judge prompt，structured parse。
- 当前系统：`deepseek-chat`，temperature 0，frozen-v1 judge prompt，约 20% judge_error。
- Zep LoCoMo 没有显式 multi_hop 专项指标，只按 category / difficulty 聚合；multi_hop 需要我们自己基于题目标签或规则分层。
- Zep 增加 context completeness，这是我们当前最值得引入的诊断指标：能区分“检索没召回”与“生成没用上”。

## 4. 必须回答的问题

### 4.1 技术 3：图遍历 + 双时态 + reflect

**Q1：Zep 的图存储用 Neo4j 还是其他？是否可以替换为邻接表/KV？**

- Zep CE docker compose 使用 Graphiti service + Neo4j：`C:\Users\27933\Desktop\mem\zep-main\legacy\docker-compose.ce.yaml:41-86`。
- Graphiti OSS 支持 Neo4j、FalkorDB、Kuzu、Neptune provider：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\driver\driver.py:59-64`。
- 默认 driver 是 Neo4j：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\graphiti.py:207-212`。
- 可以替换为邻接表/KV，但不是“替换 Graphiti 全功能”，而是实现子集：entity/fact/episode 三类记录、`MENTIONS`/`RELATES_TO` 两类邻接、BM25/vector 索引、BFS depth<=3、时态过滤、rerank。完全照搬社区/查询接口/复杂过滤会重新造图数据库。

**Q2：Fact 的双时态字段 `valid_from`、`valid_to`、`superseded_by` 各是什么语义？**

- 源码没有 `valid_from`、`valid_to`、`superseded_by` 字段。实际映射建议：
  - `valid_from` -> `valid_at`：事实开始为真的事件时间。
  - `valid_to` -> `invalid_at`：事实停止为真的事件时间。
  - `superseded_by` -> 源码无字段；可选新增 `superseded_by_edge_id` 便于审计，但 Graphiti 仅通过时间窗口和失效边表达。
  - `expired_at`：系统得知该事实失效的处理时间。
- 证据：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\edges.py:263-282`、`C:\Users\27933\Desktop\mem\zep-main\plugins\building-with-zep\skills\building-with-zep\references\concepts.md:47-61`。

**Q3：新 fact 写入时如何失效旧 fact？软删除还是硬删除？**

- 软失效。旧 edge 保留，更新 `invalid_at` 与 `expired_at`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\edge_operations.py:538-573`。
- Graphiti README 明确 invalidated not deleted：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\README.md:125-128`。

**Q4：图遍历具体实现：BFS/DFS？最大深度？是否带关系类型过滤？**

- 是 BFS 风格路径扩展，Cypher 用 `RELATES_TO|MENTIONS*1..depth`。
- 默认最大深度 `MAX_SEARCH_DEPTH=3`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_utils.py:64-68`。
- 支持 `edge_types` / `node_labels` 等过滤：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_filters.py:55-67`、`120-168`。

**Q5：实体抽取用什么方法？SpaCy？LLM？Schema 约束的实体类型枚举有哪些？**

- 默认是 LLM，不是 SpaCy：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\node_operations.py:244-280`。
- LoCoMo entity types：`Person`、`Preference`、`Location`、`Event`、`Object`、`Topic`、`Organization`、`Document`：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\ontology.py:7-95`。
- 默认 ontology 额外有 `User`、`Assistant`，edge types 有 `LOCATED_AT`、`OCCURRED_AT`：`C:\Users\27933\Desktop\mem\zep-main\ontology\default_ontology.py:4-139`。

**Q6：是否有 reflect 操作？还是只有图遍历没有反思？**

- 开源 Graphiti 没有发现命名为 periodic reflect 的通用接口。
- 有 entity summaries、saga summaries、community summaries 等增量 summarization；Zep Cloud 还有 read-only observations。
- 对我们可借鉴：周期性从高频实体/失败题/多跳路径中生成 evidence-backed reflections 或 observations，但不要依赖 Zep 的云端 observations API。

**Q7：Graphiti 的 episode 溯源机制是什么？fact 如何追溯到源对话？**

- `EntityEdge.episodes` 保存源 episode UUID 列表：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\edges.py:267-270`。
- 抽取时 `episode_indices` 映射为 UUID：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\edge_operations.py:290-305`。
- episode 节点保存 raw content，并有 `entity_edges` 反链：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\nodes.py:318-350`。
- episode 和 entity 之间有 `MENTIONS` 边：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\edge_operations.py:52-96`。

### 4.2 技术 1：多路检索对照

**Q1：Zep 检索是几路？语义 + BM25 + 图遍历 + 时态过滤？**

- Graphiti recipe 层面是 BM25 + cosine vector + BFS，可覆盖 edges/nodes/communities，episodes 只有 BM25：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_config_recipes.py:80-108`。
- Zep API 文档把 `rrf` 描述为 semantic + BM25，另有 graph/BFS：`C:\Users\27933\Desktop\mem\zep-main\plugins\building-with-zep\skills\building-with-zep\references\apis.md:89-98`、`156`。
- LoCoMo harness 只显式搜 `nodes` 和 `edges` 两个 scope；是否使用 BFS 是云端 search 内部/SDK 参数决定，本地 benchmark 没有暴露 BFS depth：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\evaluation.py:126-143`。

**Q2：RRF 实现的 k 值？是否归一化？与 Mem0/Hindsight 有何差异？**

- Graphiti Python `rank_const=1`，分数为 `sum(1/(i+1))`，无归一化：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_utils.py:1780-1795`。
- legacy Go 同样 `1/(rank+1)`：`C:\Users\27933\Desktop\mem\zep-main\legacy\src\lib\search\rrf.go:13-48`。
- 与常见 RRF `k=60` 不同，Zep/Graphiti 这个版本极度偏向各路 top1/top2；迁移时建议先用 `k=60` 做稳健版，再 A/B 对比 `k=1`。

**Q3：MMR 重排怎么用？候选数和 top-K？**

- edge/node search 每路先取 `2*limit` 候选：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search.py:284-310`。
- MMR 分支对候选 embeddings 打分，再截断返回 `limit`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search.py:375-394`、`447-460`。
- 默认 lambda 0.5；recipe 里 combined MMR 有时设 `mmr_lambda=1`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_utils.py:64-68`、`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_config_recipes.py:55-78`。

**Q4：graph-distance 重排如何打分？**

- fallback / Neo4j 实现只判断是否与 center node 一跳相连，命中 score=1，center 自身 score=0.1，未命中 `inf`，返回分数 `1/score`：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search_utils.py:1798-1857`。
- edge node_distance 先 RRF，再按 edge source node 到 center 的距离排序：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\search\search.py:411-446`。
- 建议我们实现真正 BFS shortest-hop score：`score = 1 / (1 + hop)`，并保留 relation type 权重。

### 4.3 评测对齐

**Q1：Zep 的 LoCoMo benchmark 采样策略？与我们 500 题分层有何差异？**

- Zep harness 使用 locomo10 `num_users=10`，最多 35 sessions，评测所有 QA，跳过 category 5：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\config.py:37-44`、`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\evaluation.py:82-89`。
- 与我们的 500 题分层不同；要公平对比，应额外输出按 category/multi_hop 标签的分层指标。

**Q2：Judge prompt 模板是什么？与 frozen-v1 是否一致？**

- Zep judge prompt 是 `CORRECT/WRONG`，且强调 generous grading：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\prompts.py:77-99`。
- 与 frozen-v1 不一致；不能直接比较 judge error。

**Q3：Zep 的评测用什么生成模型？温度？**

- `gpt-4o-mini`，temperature 0；response 和 grader 默认相同：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\config.py:28-34`、`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\benchmark_config.yaml:19-27`。

**Q4：是否有 multi_hop 专项评测指标？**

- 没有在 LoCoMo harness 发现显式 `multi_hop` 指标。只有 by_category、by_difficulty：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\common.py:117-121`、`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\persistence.py:237-288`。

**Q5：ingestion.py 的抽取流程是什么？一次抽几条？**

- LoCoMo harness 本地不执行抽取，只逐条 `graph.add` 给 Zep Cloud 后端：`C:\Users\27933\Desktop\mem\zep-main\benchmarks\locomo\ingestion.py:119-143`。
- 因此“一次抽几条”在 Zep Cloud 后端不可见。Graphiti OSS 的 `extract_nodes` 支持传 episode list 做多 episode 拼接并要求 episode attribution：`C:\Users\27933\AppData\Local\Temp\graphiti-readonly-20260704014740\graphiti_core\utils\maintenance\node_operations.py:70-112`。
- zep-eval-harness 的用户消息摄入有 batch size 30：`C:\Users\27933\Desktop\mem\zep-main\zep-eval-harness\zep_ingest_users.py:274-290`；telemetry graph.add_batch batch size 20：`C:\Users\27933\Desktop\mem\zep-main\zep-eval-harness\zep_ingest_users.py:306-357`。

## 5. 可复用设计规范

### 5.1 最小数据模型

建议新增三类主表/集合：

1. `Episode`
   - `episode_id`
   - `user_id` / `conversation_id`
   - `source_type`: message/text/json
   - `content`
   - `created_at`: 摄入时间
   - `valid_at`: 消息/事件参考时间
   - `entity_ids`
   - `fact_edge_ids`

2. `EntityNode`
   - `entity_id`
   - `user_id`
   - `name`
   - `labels`: `Person|Preference|Location|Event|Object|Topic|Organization|Document|...`
   - `summary`
   - `aliases`
   - `name_embedding`
   - `created_at`
   - `updated_at`
   - `episode_ids`

3. `FactEdge`
   - `edge_id`
   - `user_id`
   - `source_entity_id`
   - `target_entity_id`
   - `relation_type`
   - `fact`
   - `fact_embedding`
   - `episode_ids`
   - `created_at`
   - `valid_at`
   - `invalid_at`
   - `expired_at`
   - 可选：`superseded_by_edge_id`，只用于审计，不作为检索主逻辑依赖。

### 5.2 最小索引

- `entity_name_bm25`: entity name + aliases。
- `entity_summary_bm25`: entity summaries。
- `fact_bm25`: fact 文本。
- `entity_vector`: name/summary embedding。
- `fact_vector`: fact embedding。
- `adjacency_by_entity`: `entity_id -> edge_ids`。
- `mentions_by_episode`: `episode_id -> entity_ids`，`entity_id -> episode_ids`。
- `edge_by_pair_type`: `(source_entity_id, target_entity_id, relation_type) -> edge_ids`，用于矛盾候选。

### 5.3 写入流程

推荐按 batch flush 实现，而不是单消息立刻抽取：

1. Buffer 收集 N 条消息或 T 秒。
2. LLM 以 schema 约束抽实体，输出 `{name, type, episode_indices}`。
3. 实体链接：name/alias BM25 + embedding + 最近上下文候选，cross-encoder 或 LLM resolve。
4. LLM 抽 fact edge，输出 `{source, target, relation_type, fact, valid_at, invalid_at, episode_indices}`。
5. 对每条新 fact 找 contradiction candidates：
   - 同 pair + relation_type。
   - 或同 semantic conflict group。
   - 或 LLM contradiction checker。
6. 若新 fact 更新旧 fact：
   - 旧 fact：设置 `invalid_at = new.valid_at`，`expired_at = now`。
   - 新 fact：正常新增。
7. 更新 entity summary：只输入 new_edges，避免旧事实重复强化。
8. 写 episode/fact/entity 以及 adjacency 索引。

### 5.4 检索流程

当前系统是 BM25 + Vector RRF 两路。建议升级为四路：

1. BM25 facts。
2. Vector facts。
3. Entity link signal：query entity -> linked entity nodes -> adjacent facts。
4. Graph BFS signal：从 top entity seeds 和 top fact endpoints 出发，`depth=2` 默认，`depth=3` 只在 multi_hop 问题或召回不足时打开。

候选融合：

1. 每路取 `2K~5K` 候选。
2. RRF 初排：建议先用 `k=60` 稳健版本；同时保留 Graphiti `k=1` A/B。
3. 时态过滤：
   - 当前状态问题：`valid_at <= ask_time AND (invalid_at IS NULL OR invalid_at > ask_time)`。
   - 历史问题：允许 invalidated facts，但在 context 中显示 date range。
   - 不确定意图：保留两类 facts，并显式标注 `valid_at-invalid_at`。
4. Cross-encoder 重排 top 50 或 top 100。
5. Context 拼接：
   - facts：`fact (Date range: valid_at - invalid_at/present, source: episode_id)`
   - entities：`name: summary`
   - optional：最短路径 evidence，如 `A --fact1--> B --fact2--> C`。

### 5.5 图 BFS 轻量实现

伪规范：

```text
graph_bfs(seeds, max_depth, filters):
  visited_entities = set(seeds)
  frontier = seeds
  candidates = []
  for hop in 1..max_depth:
    next_frontier = []
    for entity in frontier:
      for edge in adjacency_by_entity[entity]:
        if not pass_time_filter(edge): continue
        if not pass_relation_filter(edge): continue
        candidates.append((edge, hop))
        other = edge.other_endpoint(entity)
        if other not in visited_entities:
          visited_entities.add(other)
          next_frontier.append(other)
    frontier = next_frontier
  return candidates
```

排序建议：

- `graph_score = 1 / (1 + hop)`
- 若 edge 连接 query-linked entity，乘 `1.2`
- 若 edge 的 `valid_at` 更接近 ask_time，乘 `recency_weight`
- 若 relation_type 在问题 intent 中命中，乘 `relation_weight`

### 5.6 周期性 reflect / summary 子系统

建议不要等待完整 Graphiti observations，先实现轻量版：

1. Entity summary：每次 flush 对受影响实体增量更新。
2. Path reflection：每天或每 50 条消息，对高频实体和 multi-hop 失败题触发：
   - 找 2-hop/3-hop 高频路径。
   - LLM 生成 `Observation`：`name, summary, supporting_fact_ids, valid_at, invalid_at?`
   - 存为只读派生节点，不参与事实软失效，只作为检索上下文补充。
3. Evaluation-triggered reflect：当 context completeness 为 `INSUFFICIENT` 但相关实体存在时，记录 missing relation，后续 flush 优先抽取该 relation。

## 6. 不可直接借鉴 / 风险

1. Zep Cloud benchmark 调用云端 `AsyncZep`，内部 search/cross-encoder/抽取细节不可见；不要把 LoCoMo harness 当成本地 Graphiti 完整实现。
2. Neo4j/Cypher 深度绑定：Graphiti 开源 fallback 和 provider ops 大量依赖 Cypher/图数据库索引。邻接表/KV 可实现核心子集，但不是 drop-in replacement。
3. `node_distance` 名称容易误导：开源实现主要是一跳邻近偏置，不是任意最短路。
4. Graphiti 的 RRF `rank_const=1` 很激进，直接照搬可能让某一路 top1 过强；建议实验 `k=60` 与 `k=1`。
5. LoCoMo judge prompt 比当前 frozen-v1 更宽松，且模型不同；不能直接把 Zep accuracy/J 与我们 frozen-v1 J 做绝对值比较。
6. Zep observations 属于云端高级能力，文档标注 Flex Plus / Enterprise 且只读；不能作为开源可复制模块。
7. LLM 抽取 + contradiction resolution 成本高；我们的 buffer+flush 必须加 cache、去重、失败重试和人工可审计日志。
8. Graphiti 是软失效，不是严格 ADD-only：会更新旧 edge 的 `invalid_at/expired_at`。若当前方向要求 ADD-only，可以用 append-only event log + materialized current view 折中。

## 7. 与当前系统对照

| 模块 | 当前系统 | Zep/Graphiti 借鉴 | 推荐改造 |
|---|---|---|---|
| 检索 | BM25 + Vector RRF 两路 | BM25 + cosine + BFS + reranker | 加 entity-link signal + graph BFS signal |
| 时态 | 单值 `validAt` | `valid_at` + `invalid_at` + `expired_at` | 增加事实有效窗口和软失效 |
| 图 | 无 | Entity/Fact/Episode context graph | 先做轻量邻接表，不上 Neo4j |
| reflect | 无 | entity/user/thread/saga summaries、observations | 先做 entity summary + path observation |
| multi_hop | J=46% | BFS/adjacency + entity summary | depth 2/3 BFS + cross-encoder |
| 评测 | frozen-v1 + deepseek + 20% judge_error | accuracy + context completeness | 增加 completeness 和 retrieval-only 指标 |

## 8. 迁移优先级

### P0：不改存储大架构的最小闭环

1. 新增 `FactEdge.invalid_at`、`FactEdge.expired_at`。
2. 新增 `EntityNode` 与 `entity_id`，至少支持 person/preference/location/event/topic/object。
3. 写入时做 entity extraction/linking，facts 绑定 source/target entity。
4. 检索时新增 graph BFS 候选路，depth=2，候选进入现有 RRF。
5. 输出 context 时显示 date range。

### P1：提升 multi-hop 的关键增强

1. Query entity linking：把问题中的实体对齐到图节点，作为 BFS seed。
2. Cross-encoder 对 RRF top 50 fact rerank。
3. 对 LoCoMo multi-hop 分层输出 context completeness。
4. 引入 `episode_ids`，失败样本可回放源对话。

### P2：reflect / observation

1. 每日或每 N 条消息做 entity summary refresh。
2. 失败题驱动 path observation。
3. Observation 加 supporting facts，作为只读派生上下文。

## 9. 最高 ROI 可借鉴点

1. **轻量图 BFS 作为第 3/4 路检索信号**：不必先上 Neo4j，只要把 fact 挂到实体 pair 上，就能用 `RELATES_TO|MENTIONS` 的邻接扩展补 multi-hop 召回。
2. **双时态软失效**：用 `valid_at/invalid_at/expired_at` 替代单 `validAt`，旧事实不删除，回答当前状态时过滤，回答历史问题时保留。
3. **LoCoMo 增加 context completeness 指标**：把 multi-hop 失败拆成“上下文没召回”和“生成没答对”，能直接指导图遍历/抽取迭代。

## 10. 建议验收指标

1. LoCoMo frozen-v1 维持当前 judge，新增 Zep-style context completeness。
2. multi_hop 子集：
   - retrieval completeness 提升至少 15pp。
   - answer J 提升至少 8pp。
3. 单跳不回退：
   - single_hop J 不低于当前 40%。
4. 时态：
   - 当前状态问题优先未失效 fact。
   - 历史问题可引用已 invalidated fact，并展示 date range。
5. 可审计：
   - 每个 fact 至少能追溯到一个 episode。
   - 每个 soft invalidation 有 old_edge_id/new_edge_id/原因/时间。
