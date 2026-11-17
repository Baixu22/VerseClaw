# ADR-2026-11-09 v2：Project RAG 长期目标架构

| 字段 | 决策 |
| --- | --- |
| 状态 | **accepted：长期架构与完整实现范围已确定；分阶段开发，不以早期阶段代替最终完成。** |
| 目标 | 可维护、可验证、按需使用的项目知识检索系统，覆盖持久混合检索、重排、多来源、Research、交互、生命周期与任务效果 |
| 架构选择 | B 为主平面：SQLite 元数据/FTS/可移植向量；LanceDB Embedded 为规模化 ANN 实现；所有投影仍依赖 owner 和 DCS |
| 开发基线 | 已整合本地 `main@806855309fb9d0ab4ffcf9f897f42fb0117e4f40`；研究起点为 `5ffcdfe89`，首轮裁决保存于 `c5896951e` |
| 范围 | 本次 Project RAG 修改与本地已提交主线；开发执行位置与节点绑定保存在本地 Task Forest |
| 实施合同 | [长期工作包](../project-rag/WORK-PACKAGES.md) · [机器可读工作包](../project-rag/program.v2.json) |
| 外部依据 | [资料探索与取舍](../project-rag/RESEARCH-20261109.zh-CN.md) |
| 历史依据 | [首轮源码审查](../evidence/project-rag-decision-20261109/source-review.json)；其中 93 项为当时既有路径测试 |
| 本次性质 | 架构、规格、研究、Task Forest 和工作树整合；新增产品能力由 RAG-01 至 RAG-19 实施 |

## 1. 最终决定与长期完成标准

**长期目标是完整的 owner-bound Hybrid RAG，不是停在“切块 + FTS”。** exact/BM25 是永久基础能力；dense、cross-encoder、持久向量投影、跨来源接入、Research、完整运维和效果验收均进入必交付工作包。

最终产品必须同时满足：

1. 用户可以选择项目/来源集合、交互模式和检索 profile；普通 Chat 保持可独立使用。
2. 来源有稳定身份、可核验版本、权限和生命周期，引用能回源或明确说明失效。
3. 持久 exact/BM25/dense 召回与 RRF 融合完整；quality/research profile 具备真实 cross-encoder 重排。
4. 本地模型、已配置远端模型、可移植向量和 ANN 的安装、运行、换代与退出均可管理。
5. Wiki、原生记忆、Role Memory、已确认 SEKB、Code Graph 和 Task Ledger 按各自 owner 接入。
6. Research 能拆解查询、补齐证据、使用关系线索，并受可取消的总预算和停止条件约束。
7. DCS 保留最终准入、次序、原子装配、去重、预算与 lineage；检索系统不能直接改 prompt。
8. 维护覆盖索引增量更新、撤销、删除、断电/崩溃、重启、模型迁移、空间回收和版本回滚。
9. 固定语料、真实 provider、Electron、实际平台、容量、72 小时稳定性及真实任务 cohort 完成独立验收。
10. RAG-01 至 RAG-19 全部完成各自合同，才关闭长期目标。RAG-04 的 FTS 可用只完成一个阶段。

这次修订对上一版做三项实质变更：

- 把 dense、rerank、ANN、多域和 Research 从未排期的后续机会变成明确的开发节点。
- 固定长期存储策略、provider 接入和模型参考方案；后续模型升级通过版本化评测，不重新讨论是否需要完整 RAG。
- 为每项能力定义可读回的产物、失败路径、测试、回滚和执行工作树绑定。

产品发布、全局冻结默认值和 ClawX 整体 GA 是发布者的独立决定，不作为日常开发节点等待真人的前置条件。

## 2. 源码与外部资料怎样改变了决策

本次对首轮 33 个文件在新工作树中做了内容比较。30 个文件的文本一致；ChatInput、Chat/index 和 chat store 的本地并发改动未带入，新工作树重新核对了其知识调用、默认值与发送分支。另读了 native embedding public API、默认本地模型、LanceDB package 与实际打包平台。

| 当前事实 | 长期实现决定 |
| --- | --- |
| [Main routeContext](../../../electron/services/knowledge-api.ts#L3024) 用 score/100 和固定阈值，Runtime Lessons 固定 0.72 | 移除伪 confidence，分开 raw score、rank、fusion、校准相关性与 evidence status。 |
| [Chat ref](../../../openclaw_runtime/src/context-engine/chat-knowledge-intent.ts#L104) 未完整保留 pins；[Wiki adapter](../../../openclaw_runtime/src/context-engine/chat-knowledge-source-adapters.ts#L37) 固定 trust/sensitivity 并只读前 80 行 | 先统一 owner read context、全文版本与 locator，再接新索引。 |
| [SourceSet](../../../openclaw_runtime/src/context-engine/source-set.ts#L721) 是已物化来源的报告/排序，不是持久索引；scope/retention 类型不代表所有字段都已执行校验 | 复用准入与冲突规则，补齐采用字段的真实检查；RRF 后不再二次调用旧排序覆盖次序。 |
| [DCS](../../../openclaw_runtime/src/context-engine/context-candidate.ts#L333) 按 candidateId 排同通道候选，预算允许截断 | DCS 增加经验证的组内 ordinal 和 atomic group，绑定最终 retained bytes。 |
| [Memory hybrid](../../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts#L1) 是 TS BM25/n-gram 加可选 embedding；cross-encoder 仅见注释和 score 字段 | 不把未存在的 scorer 当复用件；明确实现独立 rerank provider adapter。 |
| [memory-core/runtime-api](../../../openclaw_runtime/extensions/memory-core/runtime-api.ts#L1) 已公开 createEmbeddingProvider；其实现接通 generic registry、query/document inputType 和 dimensions | 长期复用该公开能力边界，不为 RAG 再建一套 provider/secret registry，也不切换 memory slot。 |
| [本地默认模型](../../../openclaw_runtime/src/memory-host-sdk/host/embedding-defaults.ts#L1) 已是 EmbeddingGemma QAT Q8_0 | 本地 profile 优先沿既有 GGUF/runtime 能力；模型安装与内存管理复用现有 owner。 |
| [memory-lancedb package](../../../openclaw_runtime/extensions/memory-lancedb/package.json) 声明 LanceDB 0.30.0；npm 原生包清单没有 darwin-x64，而 [产品打包](../../../electron-builder.yml#L107) 包含 Intel Mac | 必须交付可移植精确向量路径；ANN 按实际 native capability 使用，不能宣称依赖存在即跨平台通过。 |
| LanceDB Embedded 的新行可参与 flat 检索，optimize/cleanup 由应用管理；旧版本不会随一次逻辑删除立即全部消失 | 把维护、滞后、旧版本回收和删除传播纳入运行时合同。 |
| Azure 权限检索使用已同步 ACL，源权限变化需要再次同步 | 索引过滤之外，保留 owner 当前 epoch/版本复查，关闭旧授权窗口。 |
| Qwen3 的 embedding 与 reranker 是不同模型/结构；EmbeddingGemma 有明确 query/document 前缀和维度 | EmbeddingSpace 绑定输入格式、模型、维度和 normalization；cross-encoder 独立配置和计量。 |
| 语义切块研究没有稳定的普遍增益，GraphRAG 的维护与查询涉及额外生成步骤 | 结构切块是长期默认；关系检索复用现有图，不建立全量 LLM 实体图/社区摘要基础设施。 |

外部检索覆盖 8 个主题、32 条发现结果，并对 12 项一手材料进行了当日 fresh crawl；另读取 npm 0.30.0 精确版本元数据。这里只采纳其机制与约束，外部 benchmark 分数不成为本项目验收结果。

## 3. 架构与权威

~~~mermaid
flowchart TD
  W["Wiki / 原生记忆 / Role Memory / SEKB owner"] --> A["Owner read context 与版本快照"]
  A --> I["可重建投影：SQLite FTS / vector；LanceDB ANN"]
  U["Scope + Mode + Profile"] --> P["RetrievalPlan"]
  I --> P
  G["Code Graph / Task Ledger / Wiki links"] --> P
  P --> F["exact + lexical + dense → RRF → cross-encoder"]
  F --> R["Owner 当前权限、版本与范围复查"]
  R --> D["DCS：保序、原子装配、预算、lineage"]
  D --> M["普通 Chat / strict 或 open QA / Research"]
  M --> E["实际引用与采用、成本、任务结果"]
  E --> V["离线评测与受控 profile 晋级"]
~~~

| 对象 | 唯一职责 |
| --- | --- |
| source owner | 正文、正式版本、读取政策、保留和撤销；正式知识变化继续走 Inbox/Draft/Steward/Proposal/explicit apply |
| knowledge-retrieval-source | 可重建索引、查询计划、召回和次序建议；不能创造确认状态或扩大权限 |
| DCS | 最终上下文准入、冲突/重复处理、次序、token/字符预算、实际入模证据 |
| Memory owners | 各自保存并审核自己的数据；RAG 只拿有版本的只读候选 |
| SEKB | 提供 active confirmed principle 与现有 attribution；未确认候选不进入 active retrieval |
| Code Graph | 提供版本化符号/边/代码事实；关系不是事实支持的替代物 |
| Task Ledger | 任务事实与 revision；仅提供查询线索/独立上下文，不进长期 chunk store |
| RSI/evaluation | 实验身份、独立 grader、配对统计与离线策略评估；不会因反馈自动改变在线排序 |
| UI/Host | 选择、解释和传输；renderer 不直接访问存储、文件或模型服务 |

这是现有 owner → retrieval source → DCS 的扩展。LanceDB 存储向量和定位 metadata，不提供正式知识写入 API，也不提供可直接拼入答案的正文。

## 4. 最终存储选择

### 4.1 两个向量执行后端，一个投影合同

**SQLite portable exact 与 LanceDB Embedded ANN 都是长期交付项。** 它们服务不同容量/平台，不是两个知识权威。

- SQLite：继续承载治理 metadata；新增 source projection、chunks、FTS、index jobs/generations、portable vector BLOB 和必要的诊断引用。
- LanceDB：为已验证平台提供 ANN，只存 chunk/version/space IDs、向量、filter metadata。
- 每个 namespace + EmbeddingSpace 只有一个 active vector backend；迁移期间允许明确标记的 staging，不长期双写。
- SourceSet 是结果/报告；不会变成索引或版本 owner。
- 当前 page direct read 长期保留，服务显式 refs、索引缺失和故障退化；旧分数/权限/装配实现最终收敛到统一合同。

默认自动选择策略在 setup/rebuild 阶段执行，不在发送时临时换库：

1. portable tier：目标不超过 20k eligible chunks，优先 SQLite exact；参考维度 768/1024。
2. scale tier：目标 100k chunks，使用通过 native probe 与 recall gate 的 LanceDB ANN。
3. 行数之外同时检查向量维度、预计 RAM/disk、索引构建成本和平台支持。20k×768×4 约 58.6 MiB，不能把相同行数的 4096 维当成相同资源成本。
4. backend 转换从已有合格向量导出，或从 owner 重新构建；发布 generation 前验证，不能拿一半 SQLite/一半 LanceDB 未声明地混合。
5. 缺少 ANN native 包时使用 portable/lexical，准确报告容量和 effective backend。不能用漏掉未索引新行的 fast-search 优化冒充完整召回。
6. ANN 晋级先与同一 eligible 集合的 exact vector 对照：Recall@20 ≥0.98，并满足该平台 profile 预算。

LanceDB 初始兼容目标为仓库已声明的 `0.30.0`，新增依赖必须属于实际 retrieval runtime owner，不通过整个 `memory-lancedb` plugin 装入，也不新增全局 dependency override。源构建的 native 包与官方预编译包都必须有版本、校验、平台和安装证据。

### 4.2 表与数据生命周期

| 数据 | 保存位置 | 规则 |
| --- | --- | --- |
| owner 正文/正式版本 | 原 owner | 索引不能代替 owner 回复已删除内容；需要历史引用时由 owner 版本保留策略决定 |
| source projection | SQLite `knowledge_index_sources` | namespace、subject、source revision/digest、policy epoch、active generation、状态 |
| chunks 与 FTS | SQLite `knowledge_chunks / knowledge_chunks_fts` | raw span、heading/kind、正文片段、检索 tokens；FTS 与 chunk 事务一致 |
| vector projection | SQLite portable 或 LanceDB active generation | EmbeddingSpace + chunkDigest 绑定；向量受与源相同的读取/删除政策 |
| jobs / generations | SQLite `knowledge_index_jobs / knowledge_index_builds` | cursor、lease/fencing、幂等键、错误、取消、重试和发布状态 |
| plan/candidate pool | 本轮内存 | 到 deadline/结束释放；审计只保留必要引用和摘要 |
| retrieval receipt | 既有 audit/receipt owner | 记录阶段、policy/model/index 版本、实际使用量、过滤和降级原因 |
| SEKB attribution | 既有 `sekb_attribution_events` | 保持原事务、去重、版本和删除传播，不重复计数 |
| 实验语料/原始跑次 | 固定 fixtures 与私有 run artifact | 与运行时知识分开；runtime 不读取评测结论当策略 |

FTS 虚表初始化必须是可选 feature 初始化；不能因 SQLite 缺 FTS 扩展而使整个共享状态库无法打开。普通派生表沿既有 additive/Kysely schema 流程，投影版本独立管理，不通过降低全局 PRAGMA 版本实现回滚。

### 4.3 长期维护必须实施

owner event → invalidation → bounded index job → staged generation → 当前版本/政策复查 → 原子发布。

- 撤销/删除先取消资格，再清理 chunk、vector、缓存、旧 generation 和可删除的衍生收据。
- 同步失败、部分扫描或 provider 错误不能推断源删除。
- 后台队列复用 BackgroundWorkGate，单 writer/短事务；拥有取消、停止、重启和异常恢复。
- LanceDB optimize 的 compaction、index update、cleanup 分别计量；清理不得删除活跃 reader/writer 所需的版本或未确认事务文件。
- 清理完成有可回读状态；逻辑不可读、派生内容删除、物理空间回收是不同事件。
- 模型、维度、tokenizer、输入前缀或 chunker 改变均产生新 generation。旧模型空间不得被当作新模型结果。
- 不在每次 Chat 扫描全库。只复读最终小候选集；索引当前性由 owner 事件与有界启动对账维护。

## 5. 模型、切块与完整检索管线

### 5.1 模型方案

| Profile | embedding | rerank |
| --- | --- | --- |
| local | 既有 EmbeddingGemma 300M QAT Q8_0 GGUF runtime，768 维；明确 query/document 输入格式 | 不依赖模型 reranker，提供完整本地 hybrid 语义路径 |
| quality | 已配置 generic embedding provider；参考 Qwen3-Embedding-8B，目标输出 1024 维仅在 endpoint 明确支持时使用 | 参考 Qwen3-Reranker-0.6B cross-encoder；配置的本地服务或远端 endpoint |
| research | 使用已通过该语言/任务评测的 embedding space，不能跨空间比较 | 使用 quality scorer，并增加有预算的 query decomposition / relationship expansion |

模型名称是可验证的初始参考，不是硬编码的供应商路由。复用 provider/secret registry 与 public SDK；能力快照声明支持的 inputType、模型版本、维度、token limit、batch limit、deadline、安装状态与 egress scope。

quality 不会因为“有任意聊天模型”就被标为 ready。只有实际 embedding/rerank 能力准备好才可选择；运行中失败时明确 effectiveProfile 和退化原因。

首次模型安装、checksum、license/分发材料、warmup、RAM、磁盘、重试、取消、卸载/回收全部在 RAG-05/RAG-18。local profile 离线验收不依赖外部 API。

### 5.2 切块

结构优先，按标题、段落、步骤、表格和代码边界切块；目标约 384 tokens、上限 768 tokens，并保留 2400 字符防护上限。实际 tokenizer/版本属于 chunker profile；进入 embedding 前还要验证该模型的真实输入上限和前缀预算。

超限单元在结构内生成新的、带 raw span 的小片段，不静默剪尾并保留原 chunkId。标题链用于 retrieval text；原文 quote 不包含模型生成前缀。默认 overlap=0，邻接/父块展开走有界显式机制。

中文/日文复用 CJK bigram，英文保留完整 identifier 与拆分词。NFKC/case folding 只作用于检索字段，不修改引用字节。semantic chunking、late chunking、LLM context augmentation 是受控实验开关；是否采用由固定消融决定，不是长期版本完成所必需的新技术栈。

### 5.3 检索流程

1. 冻结 session/workspace/owner scope、policy epoch、模型/索引 generation 和总预算。
2. 读取资格在返回 metadata/snippet、embedding、rerank 前检查；renderer 输入不是授权。
3. 显式 refs 精确解析。普通查询召回 exact、BM25 和 dense，分别保留 lane rank。
4. RRF 用 `sum(1 / (60 + rank))`。多 query 先做 query-family/lane 去重，避免重复改写给同一结果多次投票。
5. quality/research 调用 cross-encoder，校验返回 ID、数量、顺序与 finite scores。raw logit/sigmoid 不等于校准概率。
6. 控制同一 parent 的数量、近重复、邻接展开和冲突组。Graph 得到的目标继续做 owner 准入。
7. owner 精确复读所选版本/范围，验证 sourceDigest/chunkDigest/policyEpoch；本轮拒绝进入 sticky deny。
8. 交给 DCS 保序、原子装配；DCS 可以减少预算或拒绝，不能给 retriever 自立一份 prompt 配额。
9. 从实际 retained bytes 生成 citation manifest。QA 复用现有无工具 model-only 运行和输出校验。
10. 记录候选、UI 展示、入模、quote、adoption、operational outcome 和 task grade 的不同事件。

Task Ledger 只提供查询上下文/独立任务事实；不会成为持久检索 lane。Runtime Memory 的诊断/退休边界不会被 `scope=all` 绕开。

## 6. 关键数据契约

下列是长期目标合同。运行时落地时从共享定义派生 Host/Gateway/renderer 类型，旧接口通过薄适配迁移。

~~~ts
type SourceDomain = 'wiki' | 'native-memory' | 'role-memory' | 'experience' | 'code' | 'task';

type SourceRefV2 = {
  schema: 'SourceRef/v2';
  domain: SourceDomain;
  authorityId: string;
  namespaceId: string;
  subjectId: string;
  revision: string;
  sourceDigest: string;
  policyEpoch: string;
  locator?: {
    coordinateSpace: 'raw-source-utf8-v1';
    startByte: number;
    endByteExclusive: number;
    startLine: number;
    endLine: number;
  };
};

type ReadAdmissionContextV1 = {
  schema: 'ReadAdmissionContext/v1';
  contextId: string;
  principalId: string;
  sessionId: string;
  workspaceId: string;
  ownerNamespaces: string[];
  policyDigest: string;
  purpose: 'knowledge-read';
  egressProviderRefs: string[];
  expiresAt: string;
};

type EmbeddingSpaceV1 = {
  schema: 'EmbeddingSpace/v1';
  spaceId: string;
  providerInstanceId: string;
  modelRevision: string;
  artifactDigest: string;
  dimensions: number;
  tokenizerVersion: string;
  inputFormatVersion: string;
  normalization: 'unit' | 'provider-defined';
};

type KnowledgeChunkV2 = {
  schema: 'KnowledgeChunk/v2';
  chunkId: string;
  source: SourceRefV2;
  chunkDigest: string;
  headingPath: string[];
  kind: 'paragraph' | 'procedure' | 'table' | 'code' | 'section';
  content: string;
  retrievalText: string;
  ownerPolicy: {
    status: 'active' | 'stale' | 'archived' | 'revoked' | 'deleted' | 'denied';
    trust: 'untrusted' | 'advisory' | 'confirmed' | 'high-trust';
    sensitivity: 'public' | 'workspace' | 'sensitive' | 'secret-adjacent' | 'secret';
    aclRead: string[];
    verifiedAt: string | null;
    expiresAt: string | null;
  };
  projection: { generation: string; chunkerVersion: string; embeddingSpaceId?: string };
};

type RetrievalPlanV2 = {
  schema: 'RetrievalPlan/v2';
  requestId: string;
  planId: string;
  admissionContextId: string;
  policyId: string;
  mode: 'manual' | 'suggest' | 'auto-read';
  profile: 'local' | 'quality' | 'research';
  intent: 'lookup' | 'procedure' | 'decision' | 'troubleshooting' | 'relationship' | 'summary';
  pinnedRefs: SourceRefV2[];
  lanes: Array<'exact' | 'bm25' | 'dense' | 'experience' | 'graph'>;
  query: { original: string; variants: string[] };
  budget: { candidateK: number; rerankK: number; finalK: number; maxPerParent: number;
    maxTokens: number; maxChars: number; deadlineAtMs: number; maxQueries: number; maxModelCalls: number };
  generations: Array<{ namespaceId: string; generation: string; spaceId?: string }>;
};

type RankSignalsV2 = {
  lanes: Array<{ lane: string; rank: number; rawScore: number; scoreKind: string; contribution: number }>;
  fusionScore: number;
  rerankScore?: number;
  reasons: string[];
  calibratedRelevance?: { probability: number; calibrationId: string };
};

type CitationV2 = {
  schema: 'Citation/v2';
  citationId: string;
  source: SourceRefV2;
  chunkId: string;
  chunkDigest: string;
  quote: string;
  quoteStartByte: number;
  quoteEndByteExclusive: number;
  projectionDigest: string;
};

type EvidenceStatusV2 = {
  read: 'admitted' | 'denied' | 'stale' | 'missing';
  coverage: 'complete' | 'partial' | 'none';
  quote: 'unchecked' | 'exact-match' | 'invalid';
  claimSupport: 'not-evaluated' | 'supported' | 'unsupported' | 'conflicting';
  claimSupportEvidenceRef?: string;
  reasons: string[];
};
~~~

约束：

- ReadAdmissionContext 由现有身份/权限 owner 派生，不是 renderer 可造的 grant；不能复用 proposal/apply grant 作读权限。
- sourceDigest 是 owner 原始字节，chunkDigest 是源范围字节，projectionDigest 是实际 DCS 包装；不能互换。
- raw line 含 frontmatter、从 1 计数，UTF-8 byte 从 0 计数且 end exclusive。旧 body-line 必须映射。
- quoted bytes 必须在当前许可的 owner 版本、chunk 和 DCS retained manifest 中成立。
- SourceSetRef 现有 contentDigest 校验物化内容，桥接时用 chunkDigest，另外保留父 sourceDigest；多片段不能复用一个 page refId。
- ownerPolicy 是约束快照，不是可独立编辑的 ACL。旧权限、旧 vector metadata 或高排名不能放行新请求。
- Code/Task 的 structured candidate 使用各自 DCS 路径；统一引用合同不等于把它们都写进 Wiki chunk 表。
- DCS 的 knowledgePacking 包含 planId、ordinal、atomicGroupId 和 refs；只接受可信 producer 生成的字段。冲突组要共同保留或共同丢弃。
- calibration 只估计相关性，不能提升 knowledge trust、claim support 或工具权限。

## 7. 交互：按需使用，不以知识聊天替代普通 Chat

**Mode 决定何时读取；Profile 决定怎样检索；Scope 决定哪些 owner 有资格被询问。**

| Mode | 行为 |
| --- | --- |
| Off / scope=none | 无后台检索和自动附加；普通 Chat 正常。用户主动选择 ref 是新的可见读取动作。 |
| Manual | 用户搜索/选择 ref，按 owner + namespace + version 精确读取；失效不悄悄换页。 |
| Suggest | 保留现有 debounce、Preflight、inspect/attach/dismiss；候选不自动进 prompt。 |
| Auto-read | 显式 opt-in；本次最多 3 个片段，显示实际 Used Knowledge、丢弃和退化。 |

| Profile | 召回/重排 | 初始预算 |
| --- | --- | --- |
| local | exact + BM25 + local dense，RRF | 40 candidates，4 final，1200 evidence tokens，3200 chars，900ms |
| quality | hybrid + cross-encoder | 80 candidates，30 rerank，6 final，2200 tokens，6000 chars，2500ms |
| research | quality + bounded query decomposition + owner links/Code Graph | 120 candidates，60 rerank，12 final，5000 tokens，15000 chars，30s；3轮/8query/2次规划模型调用 |

这些是向 DCS 请求的上限；DCS 的当前全局剩余预算、约束优先级和模型窗口仍会收紧它。旧 6000 字符保护在迁移期继续生效，retriever 不自行扩容。模型安装/cold warmup 是准备阶段，不算作可以无限延长的前台 query。

Auto-read 仍满足：active/confirmed、当前权限、有效版本、已知 freshness、无未解决冲突，并且唯一精确命中且有内容证据，或有有效校准 `relevance >=0.90`。校准绑定 policy/corpus/语言组，held-out precision≥0.95 且95%区间下界≥0.90；无校准不使用旧0.55/0.72。

strict/open：

- Knowledge Chat 默认 strict；普通 Chat 保持 open。
- strict 缺证据返回 unknown/partial，保持引用和冲突；不能以 general knowledge 自动补成已回答。
- open 可以给出一般知识和推断，但不能为其伪造引用。
- citation 点击先检查当前权限，再定位同一版本/范围。owner 已清理旧版本时明确失效。
- 被拒绝来源的标题、路径、snippet 也不能先显示再过滤。
- 回答保存进入原 Inbox/Draft，不自动 apply。

Research 只在用户显式选择时进入。它根据证据缺口继续，遇到覆盖充分、无新增证据、重复查询、预算/时间用尽或取消就停止。所有子查询继承同一个 scope；没有外网/跨项目/工具权限的隐式升级。

## 8. 长期有效配置

这是 RAG-12 要实现的目标配置，不是当前解析器已经支持的新键。新入口统一为 `runtime.knowledge.projectRag`；下面是展开后的有效配置，正常 UI 只暴露用户能作出有意义选择的项，算法细节随 policy version 管理。

~~~json
{
  "schema": "ProjectRagConfig/v2",
  "enabled": false,
  "killSwitch": false,
  "policyId": "project-rag-long-term-v1",
  "defaultProfile": "local",
  "sources": {
    "wiki": true,
    "nativeMemory": false,
    "roleMemory": false,
    "confirmedExperience": false,
    "codeRelationships": false,
    "taskContextHints": true,
    "crossWorkspace": false
  },
  "index": {
    "metadata": "openclaw-state-sqlite",
    "lexical": "sqlite-fts5",
    "portableVector": "sqlite-flat",
    "annVector": "lancedb-embedded",
    "annSdkReferenceVersion": "0.30.0",
    "backendSelection": "capability-size-resource-policy",
    "portableReferenceMaxChunks": 20000,
    "annReferenceMaxChunks": 100000,
    "oneActiveBackendPerSpace": true,
    "generationRetention": 2,
    "jobConcurrency": 1,
    "batchChunks": 128,
    "maxSourceBytes": 2097152,
    "startupReconcile": true,
    "ownerEventDriven": true,
    "requireCurrentOwnerAdmission": true
  },
  "chunker": {
    "profile": "markdown-structure-v2",
    "targetTokens": 384,
    "maxTokens": 768,
    "maxChars": 2400,
    "overlap": 0,
    "tokenizerStrategy": "model-tokenizer-v1",
    "effectiveTokenizerDigest": null,
    "cjk": "bigrams",
    "semanticChunking": "disabled",
    "lateChunking": "disabled",
    "llmContextPrefix": "disabled"
  },
  "embedding": {
    "localReferenceModel": "embeddinggemma-300m-qat-Q8_0.gguf",
    "localDimensions": 768,
    "qualityProviderRef": null,
    "qualityReferenceModel": "Qwen/Qwen3-Embedding-8B",
    "qualityRequestedDimensions": 1024,
    "queryDocumentInputTypes": true,
    "strictSpaceBinding": true,
    "requireEgressAdmission": true,
    "foregroundCorpusEmbedding": false
  },
  "rerank": {
    "providerRef": null,
    "referenceModel": "Qwen/Qwen3-Reranker-0.6B",
    "kind": "cross-encoder",
    "requireCapabilityProbe": true,
    "scoresAreCalibratedProbabilities": false
  },
  "fusion": {
    "strategy": "rrf",
    "k": 60,
    "queryFamilyDeduplication": true,
    "maxPerParent": 2
  },
  "profiles": {
    "local": { "candidateK": 40, "rerankK": 0, "finalK": 4, "maxTokens": 1200, "maxChars": 3200, "deadlineMs": 900 },
    "quality": { "candidateK": 80, "rerankK": 30, "finalK": 6, "maxTokens": 2200, "maxChars": 6000, "deadlineMs": 2500 },
    "research": { "candidateK": 120, "rerankK": 60, "finalK": 12, "maxTokens": 5000, "maxChars": 15000, "deadlineMs": 30000, "maxRounds": 3, "maxQueries": 8, "maxPlanningModelCalls": 2, "graphDefaultHops": 1, "graphMaxHops": 2, "graphMaxNodes": 40 }
  },
  "interaction": {
    "suggestMinChars": 18,
    "suggestDebounceMs": 650,
    "dismissalTtlMs": 600000,
    "autoReadMaxChunks": 3,
    "autoReadRequireConfirmed": true,
    "autoReadUnknownFreshness": "suggest-only",
    "calibrationId": null,
    "minCalibratedRelevance": 0.9,
    "ordinaryAnswerPolicy": "open",
    "knowledgeAnswerPolicy": "strict"
  },
  "fallback": {
    "order": ["same-scope-local", "same-scope-lexical", "admitted-page-read"],
    "reuseRemainingDeadline": true,
    "stickyDeny": true,
    "lateResponseInjection": false,
    "continueOrdinaryChat": true
  },
  "audit": {
    "defaultPayload": "refs-digests-status-usage",
    "rawContent": false,
    "retentionDays": 30,
    "recordEffectiveProfile": true,
    "recordIncompleteAndUnknown": true
  },
  "feedback": {
    "onlineRankUpdates": false,
    "automaticKnowledgeWriteback": false,
    "promotion": "offline-versioned-policy"
  }
}
~~~

现有 `knowledgeScope/knowledgeMode` 不另存第二份，初始仍为 none/suggest。用户在来源/设置中明确启用本项目 RAG，才建立 namespace 和索引任务。完整版本的功能必须通过正常 UI/Host API 可启用，不能只停在隐藏开发 flag 下。

quality/research 的 providerRef 必须引用已有凭据系统；未配置时显示 unavailable。更换凭据不把 key 写入 embedding space 或日志；认证隔离与模型空间分别处理。更新模型、输入格式、维度、backend、chunker 或 policy 均有版本化迁移和回滚。

## 9. SEKB、Memory、Code Graph、Task Ledger 与 RSI 接线

- **SEKB**：复用 Runtime Lessons，修正 qualified ID/裸 ID 的边界；只接 active confirmed。建议、context exposure、citation、observed adoption、operational result、independent grade 各自记录。当前 `KnowledgeStore.record_adoption` 的事务/去重/版本检查继续是归因 owner。
- **Memory**：native memory provider/file 和 Role Memory card 用独立 adapter 与 namespace，遵守现有 read/use gates。不能因为 UI 的 memory/all 标签相同而互换 id。Runtime Memory 诊断域不进入 active。
- **Code Graph**：使用 FactStore 符号/边和源码版本；修正文件 stem 歧义。一跳默认、两跳上限；只支持 relationship/research 中的有界扩展。代码片段沿代码 DCS 路径，不复制为 Wiki 真相。
- **Task Ledger**：提供当前 task revision、约束和 evidence refs；不由 RAG 创建 root、接受任务事实、写入长期知识或决定运行状态。

代码关系通过正常编码会话的 `context_understand`（显式 `relationship`／`research`）和 `context_impact` 消费 FactStore；相对模块和真实调用绑定都经过当前源码复验，最多两跳、32 个文件落点。`taskLedger.contextHint` 从 Main 当前 owner 身份读取既有任务绑定，并固定 task revision、约束与证据引用。入口、降级原因、源码范围与回滚方式见[代码关系与任务线索](../project-rag/CODE-TASK-CONTEXT-CONTRACT.md)。
- **RSI**：只复用实验身份和配对评测纪律；本程序有独立的 `ProjectRagPromotionPolicy/v1`。原 RSI NO_GO 不重签，retrieval feedback 不自动改排序或确认经验。
- **反馈**：attach/dismiss 是弱交互信号；实际入模来自 DCS receipt；adoption 需要同 run observed operation。重复信号幂等，来源被删时执行既有保留/删除规则。

## 10. 评测与晋级是完整实现的一部分

### 10.1 数据先于调参

RAG-02 在检索实现前固定：

- 240 个查询：80 calibration、80 validation、80 sealed held-out；按 source family 划分，覆盖四语言、六种意图。
- 单独的权限、撤销、过期、缺源、冲突、提示注入和空结果负例。
- 60 个可通过仓库 oracle 判断的执行任务，3 repeats，Off/page/full 三臂，共 540 planned slots。
- 当前完整 page/semantic 基线、owner/policy、provider、最终预算、停止条件、oracle 与成本 envelope。

所有 gold 和执行可由 agent 产生并复核，标记 actor；真实项目语料与 agent 编写查询、自然用户数据各自准确命名。评测 raw 输出留在私有运行产物，发布精选结果和校验摘要。

### 10.2 具体门槛

| 层 | 门槛 |
| --- | --- |
| 身份/安全/引用 | 错权限、撤销内容进入 snippet/provider/prompt 为 0；exact refs/locator/quote 绑定 100%；不恢复拒绝源 |
| 片段与检索 | exact ref 100%；Recall@20 不低于共用安全基线；nDCG@5 +0.05 且配对95%区间下界>0；分语言与意图报告 |
| ANN | 对同 eligible 集合的 exact vector，Recall@20≥0.98；记录未索引覆盖、过滤选择性和 latency |
| rerank | 固定候选池消融 nDCG@5 +0.03、区间下界>0，并满足相应 profile 的成本/期限 |
| QA | exact quote 100%；claim support、completeness、拒答精度分别测量；不得只用答案关键词或引用数量替代 |
| Auto-read | relevance校准条件符合第7节，no-context/denied/conflict负例不自动附加；UI/Electron真实发送链通过 |
| 工程性能 | 20k portable、100k ANN分别测冷热 query、重建、RAM/disk/WAL和同库写入；目标warm local≤900ms，quality≤2500ms，Research总deadline30s |
| 可运营性 | 实际平台安装/升级/离线/回滚通过；72小时agent驱动soak，丢job/重复发布/撤销泄露为0，故障后Chat可继续 |
| 任务收益 | local/quality 任务成功≥5pp且CI下界>0、全流程已测成本增幅≤10%；Research困难任务cohort≥10pp且CI下界>0、增幅≤25%，在执行前单独冻结 |

成本包含 embedding、rerank、规划、生成、工具和未知使用量的预留；零基线成本用显式绝对 envelope，不做除零比较。缺费用、缺完整 case、退化区间或未跑安全案例不能晋级。60 cases 是初始计划，不代表已具有检测上述效应的功效；用现有 paired-ablation 计算 required cases，必要时按已冻结的扩样协议继续。

### 10.3 交付顺序与最终收口

P0 决策/规格/绑定 → P1 owner/语料/chunk/索引 → P2 embedding/vector/hybrid/rerank → P3 DCS/QA/交互/运维 → P4多域/Research → P5可观测、平台、完整验收。

允许前几阶段在隔离实例受控使用。长期目标的状态始终由全部工作包的真实产物决定，不能因某阶段有绿色测试或开关可点就宣告完成。

RAG-19 收敛临时实现：移除旧伪 confidence、重复排序和旁路装配；保留统一合同下有用的 page direct read/fallback。没有统一的 owner、模型/索引版本、DCS 与回滚链，就不属于长期版本完成。

## 11. 工作包、节点和工作树

[program.v2.json](../project-rag/program.v2.json) 固定 20 个工作包的依赖、owner、contracts、touched areas、新增测试、E2E 和回滚。每包对应一个 Harness task spec；[WORK-PACKAGES.md](../project-rag/WORK-PACKAGES.md) 给出开发入口。

Task Forest：

- 新建独立长期 global_task，关联已经完成的 TF-0792（知识库基础）、TF-0038（owner slot）与 TF-0499（经验治理），不重新打开历史结论。
- 一个阶段 milestone 下保存其实际工作包；只有真正开始执行的节点设 in_progress。
- 当前只完成规划节点。首个实现节点 RAG-01 设 ready，后续按依赖等待。
- 每节点有 `TaskForestWorktreeBinding/v1`，记录 repo root、执行工作树、branch、起点、task spec 与串行执行策略。
- canonical Task Forest 仍在主检出的本地目录；新工作树用目录连接访问同一份图，不复制出第二进度来源。
- 实际 TF IDs、工作树绝对路径和当前 HEAD 由本地绑定记录提供；源码工作包只保存稳定的 RAG key 和合同。

每叶开始时复核 HEAD/工作区、刷新其 diffBase，运行 harness context；新增测试必须从 plannedTests 加入 requiredTests。用户可见变化同步四语言和 Electron E2E；通信变化执行 comms replay/compare。完成后读取磁盘证据，提交 source/spec/curated evidence，再按仓库 auto-close 规则应用提案、validate/export。

## 12. 回滚与风险处理

| 条件 | 确定的处理 |
| --- | --- |
| 无 FTS / 向量库损坏 / 模型不可用 | 新路径 unavailable，沿同 scope 的合格后端或 page read；普通 Chat 在期限内继续 |
| 权限/版本改变 | 本轮拒绝该 ref，丢弃晚到响应；不能退回更宽 scope 或 cached 内容 |
| 半次 rebuild / 双进程写入 / 崩溃 | staging不可见，fencing/CAS验证后发布；游标和job恢复不靠目录存在猜完成 |
| 删除与旧向量版本 | 先取消读取资格，再按generation/reference生命周期回收；物理cleanup有独立完成证据 |
| native依赖或模型升级 | 固定artifact/model digest、平台probe与新generation；有前一合格版本可回切 |
| SQLite schema变化 | additive与兼容binary验证；不整库回滚、不降低PRAGMA覆盖期间的任务/知识事实 |
| 指标回退 | 保留失败证据，退回前一policy；新版本重新测，不修改旧gold/threshold |
| 反馈偏差 | 弱信号不自动调权；按语言、任务、来源检查calibration drift |
| Graph复杂度 | 使用现有code/wiki关系、有界扩展；不引入全量GraphRAG社区索引 |
| 过量配置 | 用户选scope/mode/profile/provider；细参由policy profile统一版本化，不让组件各自存默认值 |

## 13. 资料口径与当前状态

旧“不得新增独立 RAG stack”解释为不得新增第二知识/上下文/权限/写入权威。本决策允许具有明确 owner、可重建、可退出的检索投影和 native ANN；这项选择在 ADR、spec 与节点中公开登记。

需要同步的资料：

- Knowledge 模块、设计总览/控制平面：当前能力与长期目标分开；注明 projection 与 owner。
- 旧检索/分期策略：dense/rerank/多域/Research 为计划内必交付；删去 usage 自动改 rank/confidence 的口径。
- DCS 文档：新的保序/原子装配只在 RAG-09 实现验收后写成当前行为。
- SEKB/RSI：继续使用已确认经验、具名 agent、observed adoption 和独立任务 grade。
- README en/zh/ja：增加长期规划入口，实际功能逐节点验收后再更新能力声明。

目前已完成的是此长期决策、研究、实施规格、节点规划与 Git 工作树整合。RAG runtime 尚待逐叶实现；初始 source review 的93项结果保持历史绑定。具体新提交、Task Forest proposal/readback、源代码复核和本次文档/Harness检查记录在长期决策证据中。
