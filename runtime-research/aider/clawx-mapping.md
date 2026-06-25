# Aider -> ClawX Mapping

Source Concept: RepoMap tag extraction and PageRank ranking  
ClawX Target: `AgentMap`  
Reuse Level: adapt code  
Dependencies: tree-sitter or Serena/LSP symbol provider, token estimator, file index  
Risks: PageRank 权重如果不可解释，会让 AgentMap 难以调试；多语言 query 覆盖不足会导致上下文偏差。  
First Implementation Slice: 先为 TypeScript/TSX 实现 `SymbolTagProvider`，输入 active files 和 candidate files，输出 ranked symbol map。  
Tests Needed: active-file 引用提升、mentioned identifier 提升、预算收缩、已在 prompt 中的文件去重、sample fixture 快照。

Source Concept: Binary-search token budget fit  
ClawX Target: Runtime Context Provider budget controller  
Reuse Level: copy idea  
Dependencies: 统一 token estimator  
Risks: token estimator 与真实模型差异会导致过长或过短。  
First Implementation Slice: 对 AgentMap 渲染结果做 token estimate，并调整 symbol 数量而不是截断文本。  
Tests Needed: 不同预算下输出单调变化；最长输出不超过预算容忍区间。

Source Concept: Rendered tree around symbols  
ClawX Target: AgentMap prompt renderer  
Reuse Level: rewrite  
Dependencies: symbol ranges、source line reader  
Risks: 过多邻近行会吞预算；过少邻近行会丢语义。  
First Implementation Slice: 文件分组 + 行号 + symbol signature + 2 到 5 行上下文。  
Tests Needed: 输出包含行号、文件相对路径、去重后的 symbol block。
