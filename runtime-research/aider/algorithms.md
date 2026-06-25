# Aider Algorithms

证据源：`C:\Users\27933\Desktop\verseshell\aider-main\aider\repomap.py`。

## Tag Extraction

`Tag = namedtuple("Tag", "rel_fname fname line name kind")` 是 RepoMap 的基础数据模型。`get_tags_raw` 使用 tree-sitter query 捕获 `name.definition.*` 和 `name.reference.*`；当语言 query 只产出 definition 而没有 reference 时，使用 Pygments `Token.Name` 补 reference。

这说明 AgentMap 的第一层不需要完整 AST，只需要“符号定义/引用/位置”的稳定抽象。ClawX 可把 Serena/LSP 的 symbol API 作为更强的数据源，Aider 的 tree-sitter tags 作为 fallback。

## Ranking

`get_ranked_tags` 构建从 reference 指向 definition 的图，并用 PageRank 排序。重要权重信号包括：

- chat files 对 personalization 有强影响。
- mentioned files、路径组件、mentioned identifiers 参与排序。
- 从 chat files 发出的 reference 权重大。
- 被很多文件定义的名称降权，避免泛名污染。
- 较长的 snake/kebab/camel 标识符提升权重。

ClawX 应把这些信号拆成可审计的 scoring reasons，例如 `fromActiveFileReference`、`mentionedByUser`、`pathComponentMatch`、`uniqueDefinition`。

## Budget Fit

`get_ranked_tags_map_uncached` 先得到 ranked tags，再二分搜索要渲染多少 tag，目标是贴近 `max_map_tokens`。它不是先按 token 切字符串，而是调整“符号数量”再重新渲染树，这一点值得保留。

ClawX 的 AgentMap 可采用两阶段预算：

1. 粗排：按 symbol/file score 选择候选。
2. 精排：根据渲染后的 token estimate 二分或逐步收缩。

## Rendering

`render_tree` 使用 `grep_ast.TreeContext` 展示关键行及周边上下文。核心思想是“符号行带邻近语义”，不是只给函数名列表。ClawX 的 prompt 渲染可以保留同样结构，但内部 evidence 应保留原始 symbol ranges，便于跳转和 verifier 对照。
