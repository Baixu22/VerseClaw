# 检索计划与候选解释

Chat Preflight 通过 `knowledge.retrieve` / `wiki.retrieve` 使用统一检索计划。Main 从当前 workspace 和物理会话捕获读取身份；memory-wiki 提供原文复读与索引候选，`openclaw/plugin-sdk/knowledge-retrieval` 提供通用计划和融合函数。

`shared/knowledge/retrieval.ts` 是纯类型合同。Host、renderer 和 runtime 使用同一份数据定义，renderer 不加载索引、数据库或 provider 实现。

`RetrievalPlan/v2` 绑定本轮 policy、profile、owner namespace、query family、显式 SourceRef 和预算。显式 refs 只走 exact lane，普通问题并行召回 exact path、FTS5 和当前向量 generation。Off 和没有显式 refs 的 Manual 不启动召回。

计划同时保存 requestId、admissionContextId 和当前词法 / 向量 generation、embedding space 与凭据代次。返回前再次比较 owner 身份和这些索引快照；运行中换代的结果返回 `snapshotStatus=changed` 和明确原因，随后请求重新使用当前 generation。

| Profile | 候选 | 重排池 | 最终候选 | 证据 tokens / chars | 总期限 |
| --- | ---: | ---: | ---: | ---: | ---: |
| local | 40 | 0 | 4 | 1200 / 3200 | 900 ms |
| quality | 80 | 30 | 6 | 2200 / 6000 | 2500 ms |
| research | 120 | 60 | 12 | 5000 / 15000 | 30 s |

期限从 Main 开始本轮读取时计算，运行时接受同一个绝对 deadline。Lane 最多使用剩余时间的 70%，余下时间用于 owner 复读；provider 失败和 page fallback 都继续使用原期限。local 不调用远端 embedding。证据装配的 token / char 上限交由 DCS 执行。

普通候选使用 `sum(1 / (60 + rank))` 融合。相同 owner、lane、query family 对同一候选最多贡献一次，重复行先去重；每个 parent 最多保留两个候选。SourceRef 的 authority、namespace、版本、digest、policy epoch 和 raw range 不一致时，该 parent 退出本轮候选。FTS query 继续通过已有参数化、逐 token 引号转义入口执行。

`RankSignals/v2` 返回各 lane 的名次、原始分数、`scoreKind` 和贡献。BM25、cosine distance、RRF 分数分别保留其含义。Preflight 显示候选与来源，排序分数不再换算成百分比 confidence。

Source owner 在返回 quote 前复验当前 pin、权限、workspace 和物理会话。任一 lane 或最后复读拒绝的 parent 在本轮保持拒绝，其他 lane 或 fallback 不能恢复它。SourceSet 继续执行准入与冲突检查，并保留可信 producer 提供的顺序。

`RetrievalResult/v2` 包含计划、有效路径、lane 收据、过滤与退化原因。未启用索引时，已有 owner page reader 提供有界兼容召回并记录 `page-lexical-fallback`。现有原生 memory 搜索保留 owner 的只读入口；独立的多来源 planner adapter 按 RAG-13 接入。

quality / research 的完整能力还需要重排和 Research controller。当前 hybrid 候选明确返回 `partial` 与 `rerank-unavailable`。自动附加要求 owner 确认、已知 freshness、无披露冲突且唯一 exact 命中；普通 RRF 候选等待有效相关性校准。

源码回归入口：`tests/unit/project-rag-plan-fusion.test.ts`、`tests/unit/project-rag-plan-owner.test.ts`。真实本地模型、FTS / dense 融合、撤回、旧 pin 拒绝和 Preflight 的 Electron 入口为 `tests/e2e/project-rag-plan-fusion.spec.ts`，运行前设置已有模型资产目录 `PROJECT_RAG_E2E_ASSETS_DIR`。验证产物标记 `driven_by: agent`。
