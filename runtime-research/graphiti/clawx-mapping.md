# Graphiti -> ClawX Mapping

Source Concept: episode -> entity/edge extraction  
ClawX Target: runtime memory / evidence graph  
Reuse Level: copy idea  
Dependencies: graph store or lightweight embedded graph、entity extractor、episode idempotency  
Risks: LLM 抽取会产生错误事实；必须保留 source episode 和 verifier。  
First Implementation Slice: 将 task events、tool results、test outputs 写成 EpisodicNode，不先做复杂 entity extraction。  
Tests Needed: episode idempotency、source evidence 查询、重复 episode 去重。

Source Concept: valid_at / invalid_at temporal facts  
ClawX Target: time-aware project memory  
Reuse Level: adapt code  
Dependencies: event time、fact schema、query filters  
Risks: 未处理失效会让 agent 读取过期需求。  
First Implementation Slice: 对用户需求和 runtime contract 存 temporal fact edge。  
Tests Needed: 当前有效查询、历史时间查询、需求变更 invalidation。

Source Concept: hybrid search over nodes/edges/episodes  
ClawX Target: `RuntimeMemoryContextProvider`  
Reuse Level: rewrite  
Dependencies: fulltext/vector/BFS search、reranker  
Risks: 召回过多会污染上下文；需要 budget 和 evidence ranking。  
First Implementation Slice: 先用 fulltext + graph adjacency；后续再接 embedding/rerank。  
Tests Needed: group filter、date filter、evidence ranking、budget cap。
