# Graphiti Extraction

证据源：`C:\Users\27933\Desktop\verseshell\graphiti-main\graphiti_core\graphiti.py`、`graphiti_core\nodes.py`、`graphiti_core\edges.py`、`graphiti_core\search\search.py`、`graphiti_core\search\search_filters.py`、`graphiti_core\utils\maintenance\edge_operations.py`、`node_operations.py`、`graph_data_operations.py`。

## 1. Runtime Contract

Graphiti 的核心输入是 episode 或 triplet，输出是图节点/边更新结果。`EpisodeType` 包括 message、json、text、fact_triple。结果模型包括 `AddEpisodeResults`、`AddBulkEpisodeResults`、`AddTripletResults`。

## 2. Context Assembly

Graphiti 的上下文 assembly 是图搜索：fulltext、vector similarity、BFS、rerank，覆盖 edge/node/episode/community。搜索结果携带 temporal fields，可作为 agent 的长期记忆/行为证据上下文。

## 3. Tool Invocation

Graphiti 不是 agent tool protocol，但可以包装为工具：

- `add_episode`: 将事件或文本写入图。
- `search`: 从图中查相关实体、事实、episode。
- `add_triplet`: 写入确定事实。

工具结果应返回 nodes、edges、episodes、时间有效性和去重/失效 evidence。

## 4. State Machine

`add_episode` 的隐含状态：

`create episodic node -> extract nodes/edges -> resolve/dedupe nodes -> resolve/dedupe edges -> invalidate contradicted edges -> save -> update communities/sagas`

`add_episode_bulk` 也体现批量抽取、批量去重、批量边处理。

## 5. Checkpoint / Resume

Graphiti 的持久化图本身是 checkpoint。ClawX 如果使用类似模型，应保存 episode uuid、group id、source、reference_time、extracted entity/edge ids。resume 时不要重复写入同一 episode；需要 episode id 幂等。

## 6. Verifier / Evidence

Evidence 来自 `EntityEdge` 的 fact、episodes、valid_at、invalid_at、expired_at、reference_time、embedding，以及去重/失效过程。时序事实不能只存“现在的结论”，还要保留何时有效、由哪个 episode 支撑。

## 7. Tests / Fixtures

本地 tests 包括 `test_graphiti_mock.py`、`test_graphiti_int.py`、`test_edge_int.py`、`test_node_int.py`、`test_add_triplet.py`、maintenance/search/tracing/security/evals。ClawX 应优先移植 mock 级别的 episode -> graph fixture，再考虑真实图数据库集成。
