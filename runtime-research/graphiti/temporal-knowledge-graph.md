# Graphiti Temporal Knowledge Graph

## Nodes

证据源：`C:\Users\27933\Desktop\verseshell\graphiti-main\graphiti_core\nodes.py`。

基础 node 字段包括 uuid、name、group_id、labels、created_at。特化 node 包括 EpisodicNode、EntityNode、CommunityNode、SagaNode。对 ClawX 来说：

- EpisodicNode 可对应一次任务事件、用户指令、工具结果、测试输出。
- EntityNode 可对应文件、符号、接口、用户需求、运行时服务。
- SagaNode 可对应长期目标或跨 episode 汇总。

## Edges

证据源：`graphiti_core\edges.py`、`utils\maintenance\edge_operations.py`。

基础 edge 字段包括 uuid、group_id、source/target uuid、created_at。`EntityEdge` 还包含 fact、episodes、expired_at、valid_at、invalid_at、reference_time、embedding。

时序字段的价值：

- `valid_at`: fact 开始有效时间。
- `invalid_at`: fact 失效时间。
- `expired_at`: 被系统判定过期/替代。
- `reference_time`: episode 参考时间。

这比“存聊天记录”更适合 ClawX，因为 agent 需要知道某个接口/行为在什么时候成立，以及它来自哪次 evidence。

## Dedup and Invalidation

`resolve_extracted_edges` 会查相似边、去重、解析冲突，并设置 invalidation。Graphiti 还会为 edge fact 创建 embedding。ClawX 可将这套思想用于：

- 用户需求变更：旧 requirement edge 失效，新 edge 有 valid_at。
- API 行为变更：旧 host-api contract 失效。
- bug evidence：失败 trace 在修复后 invalid_at。

## Search

证据源：`graphiti_core\search\search.py`、`search_utils.py`、`search_filters.py`。

搜索组合 fulltext、similarity、BFS、rerank，并支持 valid_at/invalid_at filters。ClawX 的 `RuntimeMemoryProvider` 应支持：

- 当前有效事实。
- 指定时间点有效事实。
- 与当前文件/符号相邻的事实。
- 由具体 evidence episode 支撑的事实。
