# Aider Extraction

证据源：`C:\Users\27933\Desktop\verseshell\aider-main\aider\repomap.py`、`C:\Users\27933\Desktop\verseshell\aider-main\tests\basic\test_repomap.py`、`C:\Users\27933\Desktop\verseshell\aider-main\tests\fixtures\sample-code-base-repo-map.txt`。

## 1. Runtime Contract

Aider RepoMap 的核心入口是 `RepoMap.get_repo_map(chat_files, other_files, mentioned_fnames, mentioned_idents, force_refresh)`。输入是当前聊天已包含文件、仓库其它文件、用户显式提到的文件名/标识符和刷新策略；输出是给模型看的 repo map 字符串，无法构建或预算为 0 时返回 `None`。

错误表达偏“降级而不是中断”：tag cache 使用 diskcache，遇到 SQLite/cache 异常可回退到内存字典；树解析缺失时可使用 Pygments token 作为 reference fallback。RepoMap 本身不负责流式事件、取消、权限或审计。

## 2. Context Assembly

RepoMap 将仓库压缩成“文件 + 关键符号行 + 少量上下文”。流程是：为文件提取 definition/reference tag，构建引用到定义的 NetworkX 图，用 PageRank 排序，再用 `grep_ast.TreeContext` 渲染局部代码树。

上下文选择的核心信号：

- 当前聊天文件、显式提到的文件名和路径组件用于 PageRank personalization。
- 显式提到的 identifier 权重提升。
- 来自 chat files 的 reference 权重更高。
- 定义数量过多的 identifier 降权。
- 长 snake/kebab/camel 名称更像领域标识，权重提升。

token budget 由 `max_map_tokens` 控制。`get_ranked_tags_map_uncached` 用二分搜索调整 tag 数量，使渲染结果尽量贴近预算，并允许约 15% 误差。没有 chat files 且模型上下文窗口可用时，RepoMap 会用 `map_mul_no_files` 放大预算。

## 3. Tool Invocation

RepoMap 不是通用工具协议。可借鉴的是“上下文工具”的函数 contract：输入必须显式包含工作集、候选集、用户提及信号和预算；输出必须是可直接进入 prompt 的结构化文本，并带可测试的 token 上限。

## 4. State Machine

源码没有独立状态机，但 RepoMap 的隐含状态为：

`idle -> collect_tags/cache_lookup -> rank_graph -> render_tree -> budget_fit -> return_map`

刷新策略影响状态转移：`refresh="files"` 偏向复用文件级结果，`refresh="auto"` 在计算慢时会缓存结果，`force_refresh=True` 触发重新计算。

## 5. Checkpoint / Resume

checkpoint 是 tag cache：`repomap.py` 中 tag 按文件和 mtime/cache key 缓存到 `.aider.tags.cache.v*`。崩溃后可从 cache 恢复 tag 提取结果，但 PageRank、tree render 和最终 repo map 字符串会重新计算。

## 6. Verifier / Evidence

RepoMap 的完成证据是“生成的 repo map 是否包含期望符号/文件，并符合快照”。`test_repomap.py` 覆盖基础生成、刷新策略、identifier 影响、all files、排除已加入 chat 的文件、多语言和 sample-code-base 快照。

## 7. Tests / Fixtures

最有价值的 fixture 是 `tests\fixtures\sample-code-base` 与 `sample-code-base-repo-map.txt`，因为它验证了跨文件、跨语言、真实小仓库场景下的 repo map 形状。ClawX 应复刻这种快照式 fixture，而不是只测单个函数。
