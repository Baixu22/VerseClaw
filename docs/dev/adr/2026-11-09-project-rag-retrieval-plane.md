# ADR-2026-11-09：Project RAG 检索投影与实施裁决

| 字段 | 决定 |
| --- | --- |
| 决策 | **REVISE：接受目标，首版选择 B，按本文缩小并修正实现方案。** |
| 首版 | memory-wiki 的可重建 chunk 投影 + 现有共享 SQLite + FTS5 + exact/BM25 + RRF + owner 准入 + DCS 原子装配 |
| 工作基线 | 2026-11-09，`main`，`5ffcdfe89f6bed36dd6ebc2f366990c1a05d3976`；审查对象包含工作区文件 |
| 实际目录 | 用户路径 `C:\Users\27933\Desktop\clawx\ClawX` 是指向 `D:\ClawX` 的 junction |
| 本次交付 | 源码审查、架构决策、契约、配置、交互、评测与实施工作包；新增产品能力尚未实施 |
| 证据 | [源码复核与本次验证](../evidence/project-rag-decision-20261109/source-review.json) |
| 执行者 | `driven_by: agent`，`actor: codex` |

## 1. 实际决策

**做 B；先补 owner 读取和引用链，再做 chunk 索引。** 首版只索引明确启用的项目 Wiki，不把 Memory、SEKB、Code Graph、Task Ledger 复制进一张“万能知识表”。

1. 原文、版本、权限和生命周期由 memory-wiki 等既有 owner 决定。投影的实现 owner 是已有 `knowledge-retrieval-source`，存储生命周期由 `openclaw-state-db` 管理。chunk 没有独立的知识真相权威。
2. 首版在现有 `state/openclaw.sqlite` 增加可重建投影表。FTS5 初始化必须可选，缺少 FTS5 不能使共享状态数据库或普通 Chat 启动失败。
3. 首版执行结构切块、精确标识符召回、BM25、等权 RRF、确定性去重/来源配额。**不执行 dense、模型 reranker、语义切块或自动 query rewrite，shadow 也不默认执行这些模型调用。**
4. 现有 Chat 默认组合保持 `knowledgeScope=none`、`knowledgeMode=suggest`：普通对话不主动检索；用户选择 Wiki 后才出现 Suggest。新投影总开关初始关闭，Auto-read 继续要求显式选择和独立准入门槛。
5. Preflight 显示片段、来源、位置、匹配原因和可读状态。Auto-read 最多 3 个片段；片段、标题、引用包装合计最多 3200 字符且不超过 1200 个估算 token，并接受 DCS 剩余预算进一步缩减。
6. 新路径必须同时打通普通 Chat 和 Knowledge QA。仅给 SourceSet 增加 chunk 字段，不能解决 Chat 丢版本、重读错位置、DCS 改序和截断引用的问题。
7. 新路径失败时回到**同一 owner 准入下的旧 page-level 检索**；本轮已经拒绝的来源不能被恢复。普通 Chat 在总检索期限内继续发送；strict 知识回答保留“证据不足”，不自动改成 open。
8. SEKB 的既有 Runtime Lessons 接线继续作为明确的可选来源；迁入新检索计划前补齐身份/版本/效果归因。Code Graph 仅在后续显式 Research 的 relationship 查询中进入，首版不启用。
9. dense、模型 reranker、外部向量数据库各有不同的进入门槛，见第 7 节。读取反馈只供离线评测，不能直接改变在线权重、知识内容或默认值。

本决策足以开始 WP1。首版不存在需要再交给“更强模型”回答的架构选择。

## 2. 源码复核：成立的事实与必须修正的结论

以下结论来自当前源码及调用链；原报告提供阅读入口，不作为这些事实的唯一依据。

| 复核对象 | 当前源码事实 | 对决策的影响 |
| --- | --- | --- |
| routeContext 和 confidence | [knowledge-api.ts](../../../electron/services/knowledge-api.ts#L3024) 将大于 1 的 score 除以 100，缺省 score 为 0.7；3052 行的 Auto-read 使用 `confidence >= 0.55`。转换与过滤在 Main，ChatInput 只是调用并显示。 | 不是校准概率。新结果必须拆开排序信号与准入状态，不能延用该门槛。 |
| Runtime Lessons 接线 | [knowledge-api.ts](../../../electron/services/knowledge-api.ts#L3581) 已在显式请求时调用 SEKB，候选固定 `confidence: 0.72`；4916 行的 routeContext 会合并这些候选。 | 修正“SEKB 尚无统一入口”的绝对表述。复用入口，修正身份、分数和准入；不能据候选出现认定发送链已完整。 |
| 普通 Chat 版本钉选 | [Host DTO](../../../shared/host-api/contract.ts#L3657)、[Main 归一化](../../../electron/services/chat-api.ts#L120)、[runtime 归一化](../../../openclaw_runtime/src/context-engine/chat-knowledge-intent.ts#L104) 均没有保留 revision/digest 的完整契约。 | SourceSet Studio 的版本钉选能力不能外推到普通 Chat。WP1 先补整条传输链。 |
| Chat Wiki owner adapter | [chat-knowledge-source-adapters.ts](../../../openclaw_runtime/src/context-engine/chat-knowledge-source-adapters.ts#L37) 用读取内容的 hash 作为 revision，并固定 trust/sensitivity 为 advisory/workspace；68 行只读前 80 行。 | 当前 adapter 没有透传 Wiki 返回的 status/privacyTier/revision 等政策事实，不能作为新 RAG 的充分准入证明。 |
| 读取位置与装配 | [wiki get](../../../openclaw_runtime/extensions/memory-wiki/src/query.ts#L1532) 返回去掉 frontmatter 后的正文行；[packResolvedChatKnowledgeRef](../../../openclaw_runtime/src/context-engine/chat-knowledge-intent.ts#L282) 再截到前 1200 字符。 | 检索到后文不等于模型看到了后文；新 citation 必须明确坐标系和最终保留范围。 |
| SourceSet | [source-set.ts](../../../openclaw_runtime/src/context-engine/source-set.ts#L721) 先准入再 embedding；按 lexical + exactBonus + semantic×4 排序，freshness 仅用于同分。 | 主体判断成立；它是已物化来源的排序/报告模块，不是持久 chunk index，也不是 BM25/RRF 管线。 |
| 长文 SourceSet QA | [knowledge-source-set-answer.ts](../../../electron/services/knowledge-source-set-answer.ts#L68) 已实现每次 80 行、最多 800 行/96000 字符的版本绑定续读，并挑选相关窗口。 | 不能把旧基线简化为“永远只读前 80 行”。评测基线必须是当前完整实现。 |
| Wiki 搜索与 all | [scorePage](../../../openclaw_runtime/extensions/memory-wiki/src/query.ts#L904) 是页面词法/metadata 打分；[corpus merge](../../../openclaw_runtime/extensions/memory-wiki/src/query.ts#L219) 有分库配额，再按原始分数合并。 | “非 chunk FTS/BM25、非统一 RRF”成立；还要保留它已有的分库平衡行为作为对照。 |
| Memory 检索 | [memory-hybrid-retrieval.ts](../../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts#L1) 的 BM25 与默认字符 n-gram vector 是纯 TypeScript；可注入真实 embedding。当前生产源码搜索只找到 `rerankHybridHits` 的注释引用，没有该实现。 | 可复用 tokenization、embedding 契约与 RRF 机制；不能把注释或 `ceScore` 字段当现成 cross-encoder。不能直接搬用 Memory 的候选放行规则和权重。 |
| Code Graph | [hybrid-retriever.ts](../../../openclaw_runtime/src/context-engine/views/retrieval/hybrid-retriever.ts#L34) 已有 exact + chunks_fts + RRF；[graph-reranker.ts](../../../openclaw_runtime/src/context-engine/views/retrieval/graph-reranker.ts#L19) 是基于文件 stem 的一跳 imports/calls 加分。 | 是可复用的局部代码关系信号，不是已经完成的通用 GraphRAG/多跳文档推理。 |
| DCS | [context-candidate.ts](../../../openclaw_runtime/src/context-engine/context-candidate.ts#L333) 在同通道内按 candidateId 排序；430 行预算扣减允许普通候选截断。 | 逐 chunk 创建现有 Candidate 会丢失召回顺序，并可能截坏证据。必须补 DCS 内的稳定组内次序与原子装配。 |
| QA 校验 | [knowledge-evidence-qa.ts](../../../electron/services/knowledge-evidence-qa.ts#L36) 校验 sourceId 与 exact quote 的子串存在性；24 行构造证据 prompt，59 行通过 model-only Gateway 运行。 | 复用输出校验和无工具模型路径。新片段正文需从共享 DCS 入口提供；quote 存在、claim 支持与任务成功分别评测。 |
| 共享数据库与权威 | [state schema](../../../openclaw_runtime/src/state/openclaw-state-schema.sql#L1500) 已有 knowledge governance 表；[authority manifest](../../../shared/component-authority-manifest.ts#L393) 已区分 review authority 与 retrieval source。 | 同库增加派生表符合现有分工；不另设知识 writer、permission authority 或 prompt-plan owner。 |
| 读取契约 | [ContextRef / ContextSourceAdapter](../../../shared/knowledge/governance-contract.ts#L7) 已存在，但 materialize 的 CapabilityGrant 当前围绕 proposal 和 mutation operations 定义。 | 复用 ContextRef 身份字段；读取上下文从既有身份/政策派生，不能为搜索制造 apply grant，也不把这个类型面误认为完整生产读取实现。 |
| Memory 范围 | Wiki `corpus=memory` 经 [active memory manager](../../../openclaw_runtime/extensions/memory-wiki/src/query.ts#L1499) 搜索；Chat 的 `memory-slot` adapter 则读取 Role Memory card。 | native memory、Role Memory、Runtime Memory 不能因 UI 都叫 Memory 就共用标识符或互相导入。首版 B 限 Wiki。 |
| RSI / SEKB 归因 | [knowledge-store.ts](../../../openclaw_runtime/src/knowledge/sekb/knowledge-store.ts#L116) 检查 exposure、版本、同 run 观察到的成功操作；451 行事务化去重，task grade 才能推进 post_adoption_success。 | 复用现有归因 owner；attach、quote、操作完成、独立任务 grade 分开。 |
| 当前默认与配置 | [Chat/index.tsx](../../../src/pages/Chat/index.tsx#L850) 默认为 none/suggest；本次读取本机默认配置文件，memory-wiki 仍未开启。 | 不把“有源码”和本机配置读回写成 live Knowledge 验收；后续使用独立测试实例完成该门槛。 |

SourceSet 当前只在 query/source 双方提供 workspaceId 时比较该字段；类型中的 agentId、roleTags、retention 并不等于已经执行完整政策校验。WP1 必须从可信 session/workspace 身份得到实际读取约束，并补齐本次采用字段的检查。

另外，SEKB 候选使用 `sekb:<principle_id>`，而 Chat adapter 目前还包含按裸 ID/title/content 查找的路径。新 contract 必须改成 owner + canonical ID 精确解析，并覆盖现有候选到真实 materialize 的集成测试。

## 3. 对报告方案逐项裁决

| 方案 | 裁决 | 落实方式 |
| --- | --- | --- |
| Project RAG 是可重建检索投影 | accept | 既有 retrieval source 拥有投影，owner 拥有内容，DCS 拥有入模决定。 |
| openclaw-state + FTS5 | accept，附实现约束 | 同一物理 SQLite；独立投影版本；FTS 可选初始化；短事务和后台构建。 |
| vector disabled + optional dense fallback | revise | 首版新路径没有 dense 调用。dense 后续作为可选召回 lane，失败退回 lexical；它不是 lexical 失败后临时整库 embedding。 |
| 结构切块，semantic chunking shadow | revise | 结构切块进入首版；semantic/late/contextual-LLM chunking 初始 disabled，经过离线消融后才申请 shadow 预算。 |
| RetrievalPlan 覆盖所有 lane | revise | 契约描述选中的 lane，首版只有 exact/BM25；Task Ledger 是范围/任务线索，不是长期检索 lane。 |
| 默认 RRF，weighted-score 实验 | accept | 等权、k=60、按 lane 内 rank 融合；weighted-score 只存在离线候选 profile 中。 |
| KnowledgeChunk → ContextCandidate | revise | 增加源/片段/投影 digest 区分、版本与坐标传输，DCS 保序和原子装配。 |
| chunk Preflight | accept | 扩展现有面板；不新建第二个知识工作台。 |
| Research profile | revise | 正交于读取 mode 的显式、单次检索 profile；先定义，WP8 后开放；不自动切入。 |
| SEKB confirmed principle 作为经验 lane | revise | 从现有 Runtime Lessons owner adapter 接入；限定 active、版本绑定、同域 scope、可观察 exposure；不接 candidate。 |
| Code Graph 仅 relationship/research | accept | 先 shadow，后受控一跳扩展；每个落点重新准入。 |
| 反馈仅离线训参 | accept | 本地弱反馈生成离线评测输入；版本化 profile 经冻结的晋级协议后才替换。 |
| page + section + line + revision + digest 引用 | accept，补齐字节范围 | raw-source 坐标、exact quote、完整 source digest、chunk digest、最终保留范围。 |

## 4. 四条路线比较

| 路线 | 适用条件与成本 | 迁移 / 回滚 | 安全与维护边界 | 评测 / 跨平台风险 | 决定 |
| --- | --- | --- | --- | --- | --- |
| A：增强 page-level SourceSet | 小语料、短页面、明确选源；实现成本最低，但长文仍需反复扫描和截窗。 | 无新投影；回到当前 page search/read。 | 沿用 owner；仍需修正 Chat 钉选和准入。继续扩展评分会让页面排名承担片段定位职责。 | 当前完整 page 路径是主基线；依赖风险最低。测尾部信息、上下文浪费、定位准确率。 | 保留为兼容路径，不作为升级终点。 |
| B：共享 SQLite FTS5 + 可选向量投影 | 本地项目 Wiki、标识符和中英混合文档；成本中等，主要在契约、失效、DCS 和评测。 | 只重建派生表，不搬迁原文；关闭新 reader 回到 A。普通状态 schema 采用 additive 方式。 | owner 政策先筛选、物化时复查；不能直接从 FTS snippet 回答。需要防 shared DB 写锁和旧索引泄露。 | 测 CJK、索引/原文一致性、重启/崩溃、旧版本打开数据库；三平台核对打包 Node 的 FTS5。 | **首版选用。** |
| C：复用 memory-lancedb 作独立 vector projection | 已证明 dense 有用、语料规模需要 ANN 时才有价值；部署与维护成本高于 B。 | 另有 native 包、模型/维度与索引升级；索引可重建，但插件启停可能影响 memory slot。 | [memory-lancedb](../../../openclaw_runtime/extensions/memory-lancedb/openclaw.plugin.json#L10) 是 memory plugin，含 store/forget 和 autoRecall/autoCapture hooks；不能直接当只读 Wiki index。 | 额外验证 native ABI、Windows/macOS/Linux、离线安装、数据删除与模型更换。 | 首版拒绝；后续若选 LanceDB，只用独立派生 adapter，不能启用整个 memory plugin 来承接知识检索。 |
| D：Graph-first / LightRAG | 关系/跨文档全局问题占主体，并有可靠实体抽取与更新语义；成本最高。 | 需要图构建、实体/关系版本及增量失效；关闭图后回 B。 | 关系不能替代原文或绕过授权。当前代码图的 stem 邻域不足以支撑通用文档图。 | 独立多跳语料、边正确率、维护成本和 stale-edge 泄漏；引入图服务会扩大跨平台运维面。 | 首版拒绝；只吸收后续有预算的 graph expansion。 |

B 的收益假设是“更准确地取出已授权页面中的相关证据，并减少入模噪声”。该假设由第 10 节检验，不能由 SQLite 可用或 93 项旧测试通过直接得出。

## 5. 权威边界与实际数据流

~~~mermaid
flowchart TD
  G["Knowledge review / explicit apply"] --> W["memory-wiki：正文、版本、权限、生命周期"]
  W --> A["Owner 读取准入与版本快照"]
  A --> P["knowledge-retrieval-source：可重建 SQLite chunk/FTS 投影"]
  U["Chat scope / mode / 单次 profile"] --> R["RetrievalPlan：召回、融合、候选解释"]
  P --> R
  T["Task Ledger：任务、范围、已知证据引用"] --> R
  M["Memory owner：独立启用、独立准入"] -. "后续 adapter" .-> R
  S["SEKB：confirmed active principle"] -. "显式经验来源" .-> R
  C["FactStore / Code Graph"] -. "Research relationship" .-> R
  R --> V["Owner 复读：当前版本、policy、精确范围"]
  V --> D["DCS：最终准入、组内次序、去重、原子预算、lineage"]
  D --> Q["模型请求 / strict 或 open 回答"]
  Q --> O["既有 receipt / SEKB attribution"]
  O --> E["RSI 评测机制：离线对照与 profile 晋级"]
~~~

- **Knowledge owner**：只有治理链可以修改正式知识。投影构建不会创建 approval、confirm 或 apply。
- **Retrieval source**：只维护检索材料和顺序建议。scope/ACL 是从 owner 得到的约束，不能由用户文本、模型或 renderer 自报而扩大。
- **DCS**：仍是最终上下文权威。检索预算是上限；DCS 可继续缩减或拒绝。新增片段使用 data/message 权限，不因“知识”“规则”标签变成 system instruction。
- **Memory**：保留各域 owner。Runtime Memory 仍按现有诊断/退休政策处理，不进入本方案 active 索引。
- **Task Ledger**：提供当前任务约束和引用，不进知识 chunk 表；任务事实的更新与接受仍归 Ledger。
- **SEKB**：confirmed principle 可提供建议；candidate 留在原评审流程。
- **RSI**：借用版本绑定、实验身份、独立 grader 和配对统计。Project RAG 不增加自改代码或自动改排序的能力。

源码中已有 `ContextRef/v1`、`ProjectionAdapter`、`knowledge-retrieval-source` 和 DCS collection。实现必须扩展这些边界，不能再创建一套 owner registry、permission store 或 prompt assembler。

## 6. 数据契约

以下是新增能力的目标契约，实际实现统一放在一个共享 retrieval contract 中，Host/Gateway/runtime 引用同一语义。既有 page DTO 通过显式 compatibility mapping 继续使用。

### 6.1 RetrievalPlan/v1

~~~ts
type RetrievalPlanV1 = {
  schema: 'RetrievalPlan/v1';
  planId: string;
  requestId: string;
  policyId: string;
  policyDigest: string;
  mode: 'manual' | 'suggest' | 'auto-read';
  profile: 'balanced' | 'research';
  intent: 'lookup' | 'procedure' | 'decision' | 'troubleshooting' | 'relationship' | 'summary';
  scope: {
    workspaceId: string;
    vaultId: string;
    ownerIds: RetrievalOwner[];
    sourceSetId?: string;
    taskLedgerRevision?: string;
  };
  query: { original: string; variants: string[] };
  pinnedRefs: RetrievalRefV1[];
  admissionContextId: string;
  lanes: Array<'exact' | 'bm25' | 'dense' | 'graph' | 'experience'>;
  budget: {
    candidateK: number;
    finalK: number;
    maxPerParent: number;
    maxChars: number;
    maxTokens: number;
    deadlineAtMs: number;
  };
  fusion: { strategy: 'rrf'; k: 60 };
  rerank: { mode: 'none' } | { mode: 'cross-encoder'; providerRef: string; model: string; topN: number };
  fallback: 'admitted-page-level';
};
~~~

`admissionContextId` 在可信 Host/runtime 边界由 session、workspace 和既有读取政策派生，不能引用 mutation grant。计划中的 ownerIds、budget、deadline 均由服务端约束。Off 直接返回 skip，不创建会执行的 RetrievalPlan；用户选择 refs 是读取意图，不是授权证明。

首版 variants 仅含规范化后的原查询，不调用模型改写。计划只在本轮内存中持有；审计保存 ID、输入摘要、策略版本、预算和结果引用，避免持久化原始问题及证据正文。

### 6.2 RetrievalRef、KnowledgeChunk 与 Citation

~~~ts
type RetrievalOwner = 'memory-wiki' | 'memory-slot' | 'sekb';

type RetrievalRefV1 = {
  schema: 'RetrievalRef/v1';
  owner: RetrievalOwner;
  namespaceId: string;
  subjectId: string;
  revision: string;
  sourceDigest: string;
  policyDigest: string;
  chunkId?: string;
  chunkDigest?: string;
  range?: {
    coordinateSpace: 'raw-source-utf8-v1';
    startByte: number;
    endByteExclusive: number;
    startLine: number;
    endLine: number;
  };
};

type KnowledgeChunkV1 = {
  schema: 'KnowledgeChunk/v1';
  ref: RetrievalRefV1 & { chunkId: string; chunkDigest: string; range: NonNullable<RetrievalRefV1['range']> };
  parentRefId: string;
  headingPath: string[];
  kind: 'paragraph' | 'procedure' | 'table' | 'code' | 'section';
  content: string;
  retrievalText: string;
  ownerPolicy: {
    status: 'active' | 'stale' | 'archived' | 'revoked' | 'deleted' | 'denied';
    trust: 'untrusted' | 'advisory' | 'confirmed' | 'high-trust';
    sensitivity: 'public' | 'workspace' | 'sensitive' | 'secret-adjacent' | 'secret';
    aclRead: string[];
    scope: { workspaceId: string; agentId?: string; taskId?: string };
    ownerEpoch: string;
    verifiedAt: string | null;
    expiresAt: string | null;
  };
  provenance: { sourceRefs: string[]; evidenceRefs: string[] };
  projection: { schemaVersion: 1; chunkerVersion: string; generation: string };
};

type CitationV1 = {
  schema: 'Citation/v1';
  citationId: string;
  ref: RetrievalRefV1;
  headingPath: string[];
  quote: string;
  quoteStartByte: number;
  quoteEndByteExclusive: number;
  projectionDigest: string;
};
~~~

约束：

- namespaceId 绑定真实 vault/owner namespace，不能只用文件名或 page title 作全局身份。
- sourceDigest 是 owner 原始文件字节的 SHA-256；chunkDigest 是指定源范围字节的 SHA-256；projectionDigest 是实际提交给 DCS 的片段包装摘要。三者不能互换。
- line 是含 frontmatter 的原始源文件中 1-based 行号；byte 范围从原始 UTF-8 字节 0 起算，end exclusive。旧 body 行号必须由 owner 的 frontmatter offset 映射，不能直接冒充 raw line。
- `content` 必须与原文范围一致，保留可核验字节；`retrievalText` 可以包含标题链和词法归一化，只用于搜索。生成摘要、补写前缀和重复的表头不能伪装成原文 quote。
- chunkId 由 owner/namespace/subject/revision/sourceDigest/span/chunkerVersion 确定；重新分块不能复用已经指向另一段内容的 ID。
- 发送前按 ref 精确复读；revision、sourceDigest、policyDigest、chunkDigest 任一不符则拒绝本引用。显式钉选不静默换成最新版本或同名页面。
- source status、ACL、sensitivity、retention 和 scope 必须先于 snippet 展示、外部 embedding/rerank 和入模生效。后置 citation 检查不能补救已经发生的泄露。
- 缺少 owner 版本的旧数据，只能在 owner 完整读取后绑定全文 digest；不能把当前 80 行窗口摘要当整页版本。未知 freshness 单独展示，不能自动判为 fresh。
- chunk 上的 policy 是 owner 快照；最终政策仍由 owner 复查。它不是可编辑的第二套 ACL。

### 6.3 RankSignals 与 EvidenceStatus

~~~ts
type RankSignalsV1 = {
  lanes: Array<{
    lane: 'exact' | 'bm25' | 'dense' | 'graph' | 'experience';
    rank: number;
    rawScore: number;
    scoreKind: string;
    fusionContribution: number;
  }>;
  fusionScore: number;
  matchReasons: string[];
  rerankScore?: number;
  calibratedRelevance?: { probability: number; calibrationId: string };
};

type EvidenceStatusV1 = {
  read: 'admitted' | 'denied' | 'stale' | 'missing';
  coverage: 'complete' | 'partial' | 'none';
  quote: 'unchecked' | 'exact-match' | 'invalid';
  claimSupport: 'not-evaluated' | 'supported' | 'unsupported' | 'conflicting';
  claimSupportEvidenceRef?: string;
  reasons: string[];
};
~~~

不把 EvidenceStatus 压成一个分数。`calibratedRelevance` 仅表示“片段与查询相关”的校准结果，不是回答置信度。没有校准产物时省略该字段。SourceSet 的旧 `grounded/partial/missing_sources` 显式映射为旧接口读数，不能据此把 `claimSupport` 自动设为 supported。

### 6.4 DCS 适配

在现有 Candidate 契约增加**由 DCS 验证和消费**的知识组内 order 与 atomic packing 提示，限定作用于 knowledge 数据通道。ordinal 不改变跨通道优先级。对普通旧 Candidate 保持现有语义。

~~~ts
type KnowledgeCandidatePackingV1 = {
  schema: 'KnowledgeCandidatePacking/v1';
  planId: string;
  ordinal: number;
  atomicGroupId: string;
  refs: RetrievalRefV1[];
};
// ContextCandidate/v1 增加可选 knowledgePacking 字段；
// 仅接受可信 dcs-knowledge producer 生成、并经 DCS 验证的该结构。
~~~

一个片段是最小可丢弃单元；一个必须共同披露的冲突组是共同装配单元。预算不足时整片/整组丢弃，并记录对应 chunk refs，不能把半段代码、半个 citation 或单侧冲突送入模型。需要更小片段时在 owner-bound chunker 中预先生成，而不在最终文本上裸切。

排序结果先成为 DCS 候选建议；DCS 决定最终次序并记录 retained/dropped。引用索引只覆盖 DCS 真正保留的字节，不能引用只被检索到却没发给模型的片段。候选的 `authority.contentDigest` 继续表示投影文本摘要，不冒充原始 source digest。

复用 SourceSet 的准入/冲突规则时提取最小共享函数；不得在 RRF 后再次调用旧 `retrieveSourceSet` 覆盖排名或触发整页 embedding。旧 `SourceSetRef.contentDigest` 校验的是物化内容，新桥接必须使用对应 chunkDigest，并另外保留 sourceDigest。多片段不能复用同一个 page refId。Code Graph 返回的代码事实继续用既有代码 DCS 路径，关系扩展得到的 Wiki 片段才使用本契约。

## 7. 存储、检索与扩展时机

### 7.1 首版持久化选择

| 数据 | 落点与 owner | 生命周期 |
| --- | --- | --- |
| 正式页面、正式版本/政策 | memory-wiki，原有治理路径 | 不因建立索引而迁移或改写 |
| 来源投影状态 | `knowledge_index_sources`：source key、workspace/vault、owner revision/digest、policy snapshot/epoch、active generation、状态 | 可重建；owner 变化使快照失效 |
| 片段投影 | `knowledge_chunks`：source key/generation、span、heading/kind、内容摘要、原文片段、检索 tokens | 可重建；不暴露原始表读取作为 answer API |
| FTS | `knowledge_chunks_fts`，外部内容表指向 chunk 的 token 列 | 与 chunk 在同事务中更新；query 排序用 BM25 ASC |
| 构建记录 | `knowledge_index_builds`：generation、版本、cursor、状态、数量、错误码 | 构建可重试；失败不发布 active generation |
| 检索审计 | 复用既有 knowledge audit/event 存储；DCS 保留 selected/omitted receipt | 仅 ID、摘要、策略、原因、使用量；默认不留正文 |
| SEKB exposure/adoption/outcome | 既有 `sekb_attribution_events` 与 KnowledgeStore | 既有事务、去重、删除与 version 语义 |
| 计划、候选池、融合中间分、未采纳 query variants | 本轮内存 | deadline/结束即释放 |
| 向量 | 首版无；后续经晋级后可存派生 BLOB/缓存 | 按 provider/model/dimension/policy/content 绑定，可删除重建 |

索引构建使用已选择 vault 的 owner 读取入口，不绕过 owner 扫描整个工作区。外部连接器和 watched directory 产生的 Inbox/Draft 不能直接变成 accepted chunk。已导入但未确认的数据可以保留明确的手动检查路径，不能自动进入 Auto-read。

更新采用 source 级 staged generation：读取 owner 快照，切块并写入 staging，校验 owner revision/policy 未变后短事务切换 active generation。重建期间继续查询仍有效的上一代；旧来源一旦被 owner 撤销，就立即从可查询集合移除，不等待新索引完成。

新建/更新/撤销由 owner 事件驱动，启动时做受限一致性检查；直接编辑 vault 的变化仍由 owner 的现有文件生命周期处理。不能在每次 Chat 请求扫描/哈希整个 corpus。最终少量候选的复读负责校验所使用的实际内容。

### 7.2 分块与词法

- 使用现有 Markdown parser，按标题、段落、列表步骤、代码围栏和表格分块。首版 target 1200 字符、max 2400、min 160、overlap 0；小片段只在同 section 内合并。
- 超大代码块按完整行、超大表格按完整行组切分；保留父段落/表头关系，包装生成的围栏/表头有明确来源标记。不能把整页前缀附到每个可引用片段。
- 先记录 raw offsets，再产生检索 tokens。NFKC、case folding、标识符拆分、CJK bigram 只作用于检索字段，不改引用原文。
- 复用 `memory-tokenization.ts` 的 CJK bigram；中日文短词与英文 identifier 建独立 fixture。不能假设 FTS5 默认 unicode61 会给中文分词。
- 首版固定 title/heading/body 权重 2/2/1。exact 标识符 lane 独立解析；不把 BM25 raw score 当置信度。调参产生新 policy/chunker version，经离线评测后替换。

### 7.3 请求管线

1. 校验 scope/mode/profile、session/workspace 绑定、开关和端到端 deadline。
2. owner 提供当前可查询来源集合；过滤 status、ACL、sensitivity、scope、retention、policy epoch。查询只在这个集合内命中。SQL 参数化、FTS token 转义，授权集合过滤在同一查询内强制执行。允许本地读取不自动授予向任意 embedding/rerank endpoint 外发内容的权限。
3. 显式 ref 单独解析，优先保留，不参与“用高分推翻版本钉选”。
4. 普通查询执行 exact 标识符和 BM25，lane 内最多 40 个候选；融合去重后的候选池也最多 40。
5. 对两个非空 lane 使用 `sum(1 / (60 + rank))`。单 lane 保留其原次序，不额外包装成“混合收益”。禁止随意叠加代码图的 0.3 分数到这一尺度。
6. 合并同 owner/version/span 的重复项，最多 2 个片段来自同一 parent；与问题无内容匹配、仅靠 metadata 加分的条目不能获得 Auto-read 资格。
7. owner 复读候选范围，检查版本/政策/摘要。拒绝进入本轮 sticky deny 集合，后续 fallback 不得恢复它。
8. 提交带组内次序和原子提示的候选，由 DCS 完成最终装配、lineage 和引用索引。
9. QA 复用 model-only Gateway 和 exact quote 校验；普通 Chat 保留现有工具权限。读取任何来源都不会增加写权限。
10. 记录候选、UI 展示、实际入模、quote、adoption、grade 的不同事件。

第一批要覆盖 Chat 普通文本和 media 发送分支、排队发送、retry、scope 切换、SourceSet Studio 与 Knowledge QA；不能只接 Library 的搜索按钮。

### 7.4 SQLite 与回滚

- 普通派生表走现有 additive schema/Kysely 生成流程。首版不提升共享 `user_version`；投影自己的 `schemaVersion/chunkerVersion/tokenizerVersion` 独立管理。
- FTS 虚表在 feature 初始化阶段能力探测后创建，不放入无条件启动 DDL。缺失、损坏或 rebuild 失败时标记新路径 unavailable，保留正常共享状态服务。
- 本机 `node:sqlite` 已实测 FTS5 可用；Windows Electron/Gateway 打包运行时以及 macOS/Linux 仍属于 WP2/WP6 必跑门槛。
- 后台构建使用既有 BackgroundWorkGate；短事务、单 writer、bounded batch；不在 Main/UI 或 Gateway 请求事件循环中同步执行大范围重建。
- 保留当前和一代 staging，构建预算包含两代数据与 WAL；失败/撤销的正文与 FTS token 需清理，日志和 tombstone 只留引用。物理文件空间回收遵循既有 checkpoint/retention，不承诺“删行即擦除磁盘所有旧字节”。
- kill switch 先停止新任务、使旧响应失效，再关闭新 reader；已启用知识的普通请求回到 owner-admitted page 路径。全局 enhancement kill switch 则连旧知识注入一起停止。
- 回滚不恢复旧的完整 SQLite 备份、不下调 PRAGMA 版本、不覆盖期间产生的 governance/SEKB/task 事实。投影坏了只丢弃该投影并重建。
- WP2 必须验证“新表存在时旧兼容二进制仍能打开正常状态数据”。若做不到，必须先交付兼容底座，再推进切换；不能以“可重建”掩盖二进制降级失败。

### 7.5 dense、reranker、向量数据库的具体进入门槛

| 能力 | 什么时候进入 | 选型 | 验证 / 退出 |
| --- | --- | --- | --- |
| dense lane | B 基线冻结后，held-out 中有稳定的同义/跨语言召回缺口；消融 Recall@20 至少 +5pp、配对区间下界 >0，安全和总预算通过 | 复用 `RuntimeEmbeddingProvider`；第一验证对象是现有 SiliconFlow Qwen3 embedding adapter，provider/模型版本必须固定 | 先离线，再显式 shadow，最后可选 active。失败回 exact/BM25；不能发送前整库计算。 |
| 模型 reranker | 候选池 Recall@40 足够，但最终片段 Precision/nDCG 不足；nDCG@5 至少 +0.03、区间下界 >0，并满足 profile 总期限/成本 | **多语言 cross-encoder，优先配置过的远端 rerank endpoint**；不首装本地 ONNX 模型，不用通用 LLM 列表评分。当前没有可直接复用的完整 scorer，需要小而独立的 provider adapter | Research 首先验证 top 30 → top 8；普通 Auto-read 只有独立质量/延迟门槛通过后才能启用。关闭后直接用融合结果。 |
| 持久向量 / ANN 数据库 | 先证明 dense 增益，再证明同库 BLOB + 受限内存精确检索在实际 corpus 下超出延迟/内存预算 | 先沿 B 增加可重建向量；达到规模约 5 万 eligible chunks 时启动 ANN 评测，不自动选库。只有精确 dense p95 >200ms 或额外内存 >256MiB 的实测成立时才打开独立存储 ADR | 按实际维度计算 bytes（如 5 万×4096×4 约 781MiB，尚未计运行开销）。LanceDB 只是候选；必须有三平台安装/升级/删除/回滚证据。 |

现有 embedding adapter 默认声明 4096 维且允许环境选择模型。持久化前必须以实际响应校验维度、一致性和模型绑定；不能把声明的常量当所有模型的真实维度。providerRef 只引用既有凭据管理，不把 key 写进计划、索引、citation 或评测报告。

## 8. 交互与准入

| 用户选择 | 实际行为 | 缺证据 / 失败行为 |
| --- | --- | --- |
| Off | `scope=none`；不做后台搜索、embedding 或自动附加。主动选择一个 ref 是新的明确读取动作，并在 UI 显示所选 scope。 | 普通 Chat 正常。 |
| Manual | 搜索/选择后发送 typed refs；后端精确读取所选版本/范围。 | 失效引用明确标记；不悄悄替换。 |
| Suggest | 有范围、输入达到现有触发长度并经 650ms debounce 后建议；最多 3 个候选卡片。Attach/Inspect/Dismiss 保留。 | 不影响发送；旧请求的晚到结果不得覆盖新 session/scope/query。 |
| Auto-read | 显式 opt-in；只附加通过 owner 和相关性门槛的最多 3 个片段，显示 Used Knowledge 与丢弃原因。 | 总检索最多 800ms，包括 fallback 和复读；期限后普通 Chat 继续，无晚到注入。 |
| Research | 后续显式单次 profile；最多 3 个 query、80 个候选、8 个最终片段、4800 字符/2400 估算 token、8 秒总检索期限 | 允许取消；返回已核验证据与缺口。不能升级 scope、开启写权限或调用外网补证，除非另一项已明确授权。 |

Research 是检索深度，不是新的权限 mode；不新增 `auto-advisory` 作为 `auto-read` 的重复名字。它受 DCS 剩余预算约束，4800 字符不是新增独立上下文额度。

**Preflight 的硬准入**：owner 可读、当前 revision/policy 匹配、范围有效、属于本次 workspace/vault、不是 revoked/deleted/archived/denied、没有超 sensitivity/retention 限制。缺 freshness 可出现在已授权的手动检查/Suggest 中并明确标注，但不能自动附加。不能在准入前展示被拒绝来源的 snippet、标题或敏感路径。

**Auto-read 的相关性准入**：

- 唯一精确 ID/path 命中且包含查询内容证据，或 `calibratedRelevance >= 0.90`；
- calibration 必须绑定当前 policy/corpus/语言组，在 held-out 上达到 precision ≥0.95、95% 区间下界 ≥0.90；
- 没有有效 calibration 时只允许上述唯一精确命中；其余退为建议，不用原来的 0.55 或固定 0.72 代替；
- 即使相关性很高，未确认、冲突、unknown freshness、源版本漂移或政策失败仍不能 Auto-read；
- 校准产物只改变相关性选择策略，不能提升知识 trust 或给来源新增读取权限。

**strict/open** 是当前回答的证据策略，适用于普通 Chat 的知识增强和 Knowledge Chat：

- Knowledge Chat 默认 strict；普通 Chat 保持 open。对现有会话只保存用户明确选择，不全局迁移成新 mode。
- strict 的事实 claim 必须由本次 admitted/retained 证据支持；无证据返回 unknowns，引用失效或结构冲突不能伪装成已回答。
- open 可以使用一般知识，但区分“有来源的事实”和“推断/一般建议”，不给后者伪造 citation。
- 点 citation 重新检查读取政策，定位同一 page/section/raw range；源已更新时提示版本变化，不跳到同名段落并称之为原证据。
- 输出校验保证 quote 绑定；语义支持与回答质量另有评测。不能在 UI 把“引用存在”显示成“答案已验证”。
- 保存回答仍创建现有 Inbox/Draft；确认 apply 继续沿原链。

## 9. 完整配置、默认值与升级路径

下列为**待实现的有效配置导出格式**，不是当前解析器已经支持的配置文件。新增运行时入口统一为 `runtime.knowledge.projectRag`，由该入口的类型、schema/help、metadata 与测试一起落地。算法细项是版本化 policy preset 的只读展开；正常 UI 只暴露启停、来源、模式、profile、strict/open 和已配置 provider，避免几十个互相矛盾的调参开关。

~~~json
{
  "schema": "ProjectRagConfig/v1",
  "enabled": false,
  "killSwitch": false,
  "defaultProfile": "balanced",
  "policyId": "project-rag-lexical-v1",
  "storage": {
    "backend": "openclaw-state-sqlite",
    "projectionSchemaVersion": 1,
    "ftsInitialization": "optional",
    "retainedGenerations": 2,
    "rebuildMode": "owner-events-and-startup-reconcile",
    "maxSourceBytes": 2097152,
    "batchChunks": 128
  },
  "chunking": {
    "strategy": "markdown-structure-v1",
    "targetChars": 1200,
    "maxChars": 2400,
    "minChars": 160,
    "overlapChars": 0,
    "semanticChunking": "disabled",
    "contextualLlmPrefix": "disabled",
    "lateChunking": "disabled"
  },
  "lexical": {
    "backend": "sqlite-fts5",
    "tokenizer": "unicode-words-cjk-bigrams-v1",
    "fieldWeights": { "title": 2, "heading": 2, "body": 1 }
  },
  "vector": {
    "mode": "disabled",
    "providerRef": null,
    "model": null,
    "dimension": null,
    "store": "none"
  },
  "fusion": { "strategy": "rrf", "k": 60 },
  "rerank": {
    "mode": "none",
    "providerRef": null,
    "model": null,
    "topN": 0
  },
  "lanes": {
    "exact": true,
    "bm25": true,
    "experience": false,
    "graph": false,
    "runtimeMemory": false
  },
  "profiles": {
    "balanced": {
      "candidateK": 40,
      "finalK": 3,
      "maxPerParent": 2,
      "maxChars": 3200,
      "maxTokens": 1200,
      "maxQueries": 1,
      "deadlineMs": 800
    },
    "research": {
      "available": false,
      "candidateK": 80,
      "finalK": 8,
      "maxPerParent": 2,
      "maxChars": 4800,
      "maxTokens": 2400,
      "maxQueries": 3,
      "deadlineMs": 8000,
      "graphMaxHops": 1
    }
  },
  "autoRead": {
    "requireExplicitOptIn": true,
    "requireCurrentOwnerVerification": true,
    "requireConfirmedSource": true,
    "allowUniqueExactMatch": true,
    "calibrationId": null,
    "minCalibratedRelevance": 0.9,
    "unknownFreshness": "suggest-only",
    "conflicts": "suggest-only"
  },
  "suggest": {
    "minQueryChars": 18,
    "debounceMs": 650,
    "maxCards": 3,
    "dismissalTtlMs": 600000
  },
  "answer": {
    "ordinaryChat": "open",
    "knowledgeChat": "strict",
    "sourceClaimsRequireCitations": true,
    "maxClaims": 20
  },
  "fallback": {
    "onUnavailable": "admitted-page-level",
    "onDeadline": "continue-chat-without-new-references",
    "onDenied": "keep-denied",
    "reuseRemainingDeadline": true
  },
  "audit": {
    "enabled": true,
    "payload": "refs-digests-status-usage",
    "rawContent": false,
    "retentionDays": 30
  },
  "feedback": { "onlineRankUpdates": false, "automaticWriteback": false }
}
~~~

配置规则：

- 既有 `knowledgeScope/knowledgeMode` 继续保存在原 session/workspace UI 状态，不在新配置里再存一份。
- feature available ≠ user scope enabled ≠ Auto-read allowed。三道门分别检查。
- 修改 chunk/tokenizer/model/dimension 必须产生新的 projection generation，旧向量不得混用。
- `rerank.mode=cross-encoder` 需要有效 provider/model 和预先分配的总 deadline；未配置时不创建“空实现”。
- 实验 preset 只在离线/显式 shadow 使用：dense、cross-encoder、weighted fusion、graph 和 multi-query 逐项消融，禁止一次开启后宣称某单项有效。
- schema v1 升级沿 doctor/现有配置迁移入口，不用静默兼容写入或新增 sidecar。关闭新功能后，原 scope/mode 和 page 接口仍可工作。
- 800ms、40/3、3200 等是本次冻结的初始工程预算。改变这些值需要新 policy 版本及对应验证，不能在失败后原地放宽评测门槛。

## 10. 评测与晋级门槛

### 10.1 三种基线，避免比较错对象

- **A0**：同任务的 Knowledge Off，用于测量总成本与任务效果。
- **A1**：当前 page-level 路径，包含现有中文词法、bounded continuation、owner admission、可配置 semantic 行为；provider/semantic 状态明确固定。
- **B1**：本文首版 chunk lexical 路径。与 A1 保持相同语料快照、任务、问题、provider、工具权限、最大最终上下文预算和停止条件。

主消融用 lexical A1 对 lexical B1；另列当前 opt-in semantic A1 的比较，不能悄悄关闭强基线的能力。检索离线评测还要单独比较“相同 raw source 的 gold spans”，不能拿 page hit 与 chunk hit 直接作同分母。

WP1 的安全修复对 A1/B1 共同启用并分别冻结源码版本；保留本次旧代码快照用于前后行为核对。评测不能把只修在 B1 的权限或版本 bug 算成 chunk 算法收益；DCS 原子装配等共用机制也要在受控消融中保持一致。

### 10.2 数据与方法

| 层次 | 固定输入与执行 | 指标和接受条件 |
| --- | --- | --- |
| 契约 / fixture | 多语言、首/中/尾段、frontmatter、CRLF、多字节字符、表格、围栏、别名、重复、版本/ACL 变化、prompt injection、冲突、缺源、无 FTS、锁/超时 | 引用范围/digest 100% 可解析；拒绝源进入 UI/embedding/prompt 为 0；无匹配无伪 citation；重复/崩溃不发布半成品 |
| 实际仓库语料 | 冻结已授权的真实项目文档快照和 owner metadata；120 个 agent 编写并按原文复核的查询，60 calibration、60 sealed hold-out；覆盖中英日俄、标识符、操作步骤、长文和冲突 | 每题 gold source/span/必要事实与不可答原因先封存；同源或改写问题不得跨 split。测 Recall@20/40、MRR、nDCG@5、Precision@3、最终证据覆盖和入模 tokens |
| 检索晋级 | A1/B1 配对、按 query/source cluster 计算不确定性 | exact ref 解析 100%；Recall@20 不低于 A1；nDCG@5 至少 +0.05 且配对 95% 区间下界 >0；已知冲突/拒绝覆盖 100% |
| live provider QA | 同一获授权 endpoint/model 与冻结输出预算；保存脱敏 raw response、token usage、超时和未完成状态 | quote validity 100%；claim support、answer completeness、拒答精度分别打分；显式记录判断器版本/agent actor，不用答案中的引用数量代替语义支持 |
| Electron E2E | 真实 Host→Gateway→owner→DCS 路径，测试实例独立；mock route 响应只能验证 UI 分支 | Off、Manual、Suggest、Auto-read、scope/session 切换、取消、晚到响应、citation 回源、source edit/revoke、media/queued send、kill switch 与旧路径恢复 |
| 性能与存储 | 1k/10k chunks、冷/热读、同库 governance 写入、两代重建、crash/restart；三个打包平台 | 10k warm 检索 p95 ≤250ms，cold ≤500ms；普通 Auto-read 总等待硬上限 800ms；后台构建不占主事件循环，记录 DB 写锁、RSS、磁盘/WAL峰值 |
| 真实任务 cohort | 40 个独立、可用仓库 oracle 验证的执行任务 ×3 repeats × A0/A1/B1，共 360 slots；题目、oracle、候选、经验与预算在执行前冻结 | 使用既有 paired-ablation 机制；任务成功提升 ≥5pp、95% 区间下界 >0、token 与 tool-call 成本增幅各 ≤10%、安全/anchor 回退为 0，才允许“本 cohort 有任务收益” |

40 cases 是本次初始执行计划，不保证足以检测 5pp。沿用 RSI 的完整 case 配对、k=3、功效和 requiredCasesApprox 计算；区间或成本缺失则 hold。不能把 repeats 当独立任务扩充样本量，不能剔除 timeout/incomplete 后改称全量成功。

历史 RSI NO_GO 和当前 SourceSet 的 synthetic quality report 保持原解释。本方案建立自己的 cohort 和候选版本，不能借它们的任务数或旧结论晋级。

### 10.3 晋级顺序

1. G0：owner/引用/DCS 安全和失败路径全部通过；才可在隔离实例启用 B。
2. G1：真实语料检索增益、资源预算和打包能力通过；才开放手动选择的新 reader 与 Suggest。
3. G2：Auto-read 校准/精确匹配准入和真实 Electron 发送链通过；才允许该新路径 Auto-read opt-in。
4. G3：live QA 与任务 cohort 完成后，分别裁决回答质量和任务收益。
5. 默认启用、跨项目默认共享、公开发布仍是独立产品决定。不能由 G1/G2 自动翻转。

所有测试、评审、query gold 和 task execution 都可由 agent 自动执行并标记 actor，无需等待真人数据。新的 provider 调用先绑定已有授权凭据/endpoint 与整轮预算；没有资源时保留本地工程结果，不能补写 live 成功。

## 11. 按依赖排序的实施工作包

各包由 agent 开发并按既有 Harness/Task Forest 流程执行。一次推进一个 ready 包；下面的 WP 编号是本 ADR 的工作分解，不另建运行时任务权威。

| 包 / 依赖 | owner 与 touched areas | 契约及交付 | 必跑验证 / E2E | 文档 / 回滚 |
| --- | --- | --- | --- | --- |
| WP0 决策与基线（本次） | 架构；本 ADR、authority ADR、Knowledge 文档、保留清单、源码复核证据 | 裁决 B、确认现状、冻结首版边界；实施时创建新 active task spec，引用 gateway-backend-communication | 文档链接/配置语法/保留清单；本次 7 files / 93 tests + 源码探针。没有 UI 变更，不新增 E2E | 本 ADR 为开发入口；回滚本次文档不会改运行行为 |
| WP1 owner 读取与身份 / WP0 | memory-wiki owner + Host/runtime；`shared/knowledge/*`、`shared/host-api/contract.ts`、`chat-api.ts`、Gateway logs-chat schema、`chat-knowledge-intent.ts`、`chat-knowledge-source-adapters.ts`、`knowledge-source-set-answer.ts` | 统一 readonly ref、policy snapshot、全文版本、range；共享准入规则；明确旧 body-line 映射；不能复用 mutation grant 作读权限 | 真实 Wiki adapter 的 status/privacy/revision/ACL/scope cases；pins 全链路；native-memory/role-memory 不串域；扩展 `knowledge-ks04-chat-dcs.spec.ts` 的编辑/撤销/refused case | 更新 SourceSet read rule 与 Knowledge 读取文档；回到已修正的 page-only adapter，不能回滚掉安全修复 |
| WP2 chunk + SQLite 投影 / WP1 | retrieval source + state；`openclaw_runtime/src/knowledge/retrieval/*`、Wiki public runtime API、state schema/generated types、现有 BackgroundWorkGate | 三个普通派生表 + 一个 FTS 表；结构/字节坐标切块、CJK tokens、generation/CAS、失效、短事务与资源上限 | 真实临时 SQLite + vault，fts/no-fts、双进程读写、owner 改动、崩溃恢复、新旧二进制兼容；打包 Win/macOS/Linux capability probe。暂不新增 UI | 存储/重建 runbook；关闭 writer/reader，保留正常 owner 和 page 路径 |
| WP3 计划与召回 / WP2 | runtime retrieval + Main facade；`knowledge/retrieval/*`、`knowledge-api.ts`、`source-set.ts`、host contract/facade | exact/BM25/RRF、去重/来源配额、rank signals、共同 deadline、sticky deny fallback；不复制现有整套 Memory scorer | exact/lexical 消融、真实语料 baseline、权限前滤、同分稳定序、无命中、30s owner 超时注入、总期限；复用既有 Host 集成测试 | 检索 profile/spec；关新 reader 回 owner-admitted A1 |
| WP4 DCS 与 QA / WP3 | DCS + Knowledge QA；`context-candidate.ts`、`turn-injection-budget.ts`、`embedded-agent-runner/extensions.ts`、`knowledge-evidence-qa.ts`、model-only RPC consumer/schema | group order、atomic pack、三种 digest、最终 citation manifest；普通 Chat/QA 共用证据入口，不在 Main 重拼证据正文 | 排名不被 ID 改写；余量不足整片/冲突组 drop；quotes 只指 retained bytes；global kill；`knowledge-ks04-chat-dcs.spec.ts` 与 `knowledge-hub.spec.ts` 真实调用链 | DCS/QA contract 与规则；停止 chunk consumer 回受准入的 page adapter |
| WP5 交互 / WP4 | Renderer + Host；`ChatInput.tsx`、`Chat/index.tsx`、`stores/chat.ts`、Knowledge Chat/Library、四语言 locales | 现有 Preflight 的 chunk inspect/attach/dismiss、回源定位、strict/open、已用证据、过期/拒绝；保持 none/suggest 默认 | 同 PR Electron E2E：普通文本/media/排队、切 session/scope、取消/晚到响应、Auto-read 超时仍发送、strict 缺源与 open 标注 | 同步中英日 README 与 Knowledge 模块；关新 UI profile 回兼容卡片与 page viewer |
| WP6 独立评测与 opt-in 晋级 / WP1–5 | evaluation；`scripts/knowledge-*.ts`、curated fixtures、现有 paired-ablation、独立测试实例 | 冻结 corpus/oracle/policy；G0–G3 分开报告；Auto-read calibration；kill/fallback/downgrade 包 | fixture、真实语料、真实 owner/DCS、live provider、三平台安装、任务 cohort；raw outcome/usage 读回；不靠终端打印判完成 | 验收报告与回滚 runbook；失败留在 A1 或 Suggest，不放宽门槛 |
| WP7 dense / rerank / WP6 的对应缺口 | retrieval provider + evaluation；现有 embedding provider、必要的新 rerank adapter、派生 vector projection | 每项独立开关和模型/维度/费用绑定；按第 7.5 节消融；不装第二 memory plugin | provider count/dimension/order 校验、缓存隔离、evidence egress、超时/取消、重建；仅有 UI 设置时增加相应 E2E | provider 安装/费用/迁移说明；关闭单 lane 回 B lexical |
| WP8 SEKB / Code Graph / Research / WP6 | 各 owner + DCS；现有 Runtime Lessons、SEKB store/retriever、FactStore、Task Ledger snapshot facade、Chat profile | 精确 principle identity、真 exposure、existing attribution；graph 一跳只扩召回；Research 有查询/时间/内容预算 | SEKB candidate/revoked/错版本拒绝、metadata-only 无匹配拒绝、同 run observed operation；graph 同名 stem/跨 workspace/过期边；Research 真实 E2E | 更新经验/关系检索文档；按 lane/profile 单独关闭，不删除正式 principle 或代码事实 |

实施 task spec 应引用当前 active 的 `knowledge-retrieval-and-governance-completion`、`knowledge-source-set-read-governance` 和相关规则作为约束，不把 archived KS-07 再标成“新功能已验证”。WP1 的 tests 必须增加真实 production adapter 路径；当前 fake adapter 测试不能替代它。

每次实现按以下流程收口：`harness context --spec <本包>` → scoped tests/类型/contract → 同 PR Electron E2E（用户可见变更）→ `harness validate` / `harness run --dry-run` → 通信变更执行 comms:replay/compare → 按要求执行 harness:ci → 读取磁盘证据、核验 source hashes → Task Forest proposal/evidence gate/apply/validate/export。任务历史保持本地，durable spec 和精选最终证据进入源码保留清单。

## 12. 文档口径裁决与同步表

**不需要废除原有权威 ADR。** `“不新增独立 RAG stack / DB / 第二 authority”` 限制的是新增并行系统；本方案新增同库检索投影。旧任务里的 no-new-store 是该任务的验收边界，保留其历史含义，不追改历史证据。

| 文档 | 本决策后的准确口径 | 执行 owner / 时点 |
| --- | --- | --- |
| 2026-08-17 Knowledge authority ADR | 加本 ADR 的引用，明确同库可重建检索投影与原文 owner 的区别；单 writer/explicit apply 保持 | 架构 / WP0 |
| `docs/modules/knowledge-base.md` | 当前仍是 page/snippet；新增规划链接，注明 B 待实施 | Knowledge docs / WP0；实现后按包更新行为 |
| `docs/clawx-design-overview.md`、`runtime-control-planes.md` | 将“没有独立 RAG stack”解释为权威边界；实现后补 owner → projection → DCS 与实际 profile 状态 | 架构 / WP1、WP4 |
| `03-retrieval-and-interaction-strategy.md` | Auto-read 不再允许仅有未审阅标签的 raw/draft；不显示未经校准 confidence；重复 dismiss 只抑制本地展示/离线评测，不能改在线全局排序 | Knowledge UX / WP3、WP5 |
| `04-phased-implementation-and-acceptance.md` | Phase 5 按本工作包拆分；Phase 6 的“usage 自动升降 confidence”改成治理建议与离线 profile 晋级 | Knowledge / WP3、WP6 |
| `dcs-first-context-engineering.md`、`context-capability-blueprint.md` | 新实现补原子装配/保序与当前调用锚点；历史状态不当作当前实现；“必须真人”按 owner 政策改为具名 agent 自动等价路径 | DCS / WP4 |
| `sekb-golden-path.md`、RSI 相关 spec/rule | confirm 可由授权 agent 执行并标记；仍禁止自动写回。保持 exposure/citation/adoption/grade 分离 | SEKB / WP8 |
| archived KS-07 / Chat routing specs | 保留历史；由新 task spec 显式说明扩展和继承关系，不改旧测试数/NO_GO | Harness / 每包 |
| README en/zh/ja（及相关 ru） | 本次已核对知识库条目；当前描述仍对应现有行为。用户可见能力落地后才写 chunk/Research 支持，并链接本 ADR | 各实现包 owner |

## 13. 风险与必须避免的实现

| 已定位风险 | 必须采取的处理 | 验证 / 回滚 |
| --- | --- | --- |
| Chat 与 QA 准入不一致 | WP1 合并政策语义并贯通 owner metadata/pins，禁止把默认 workspace 当强授权 | 真实 adapter 负例；保留安全修复，关闭新 reader |
| CJK 在默认 FTS5 上漏召回 | 明确复用 CJK bigram 的索引/查询预处理 | 本次探针 raw=0 / bigram=1；再跑真实语料；退 A1 |
| BM25/RRF/旧 score 量纲混淆 | raw score、rank、fusion、calibration 分字段，禁止统一除 100 | lane 消融/排序 fixture；停用实验 profile |
| DCS 重排/切断引用 | DCS 内保序与原子证据组，绑定最终保留内容 | 小预算与冲突组测试；回 page adapter |
| 撤销后 FTS、缓存或晚到请求泄露 | 当前 owner epoch 前滤，复读复查，sticky deny、请求代次取消、清理派生内容 | edit/revoke/permission-change race；暂停该来源 |
| shared SQLite 锁拖住 Chat | 后台构建、短事务、请求总期限、FTS 可选初始化 | 多进程锁与缺 FTS 测试；禁用投影 |
| “现成 Memory reranker”实际只是注释 | 不以缺失实现排开发承诺；必要时在 WP7 明确实现小 adapter | 搜索定义/调用、provider 实测；关 rerank |
| metadata-only SEKB 误命中 | 要求内容匹配、精确 owner ID 与版本；不能让 pinned/criticality 单独导致 Auto-read | 无词法重合负例、端到端 materialize；关 experience lane |
| 索引与功能回滚混淆 | 派生版本独立；旧兼容 reader 实测；不整库倒回 | 新表 + 旧二进制对照；关 feature，重建投影 |
| 统计或弱反馈越权 | 固定 split/oracle/预算；完整保留失败；attach/dismiss 不改 rank、principle 或知识 | 配对读回、事件去重；回已冻结 policy |

## 14. 本次验证、剩余事实与决策权限

本次重新执行并读取了 JSON 结果：

- Host：`knowledge-source-set-answer` 41、`knowledge-evidence-qa` 8、`knowledge-retrieval` 9，共 **58/58**。
- Runtime：`source-set` 17、`source-set-quality` 2、`chat-knowledge-intent` 7、`context-candidate` 9，共 **35/35**。
- 直接调用当前 runtime 模块的探针确认：Chat intent 会丢 revision/digest，1200 字符装配丢失尾部证据。
- 本机 Node `v24.22.1` / SQLite `3.53.4` 的内存 FTS5 探针：查询“版本”，unicode61 原文匹配 0，现有 CJK bigram 预处理匹配 1。
- 当前 15 个必读源码文件的起止 hash 和当前 diff 状态写入 source-review.json；其他调用链锚点同时登记。
- 本机默认配置文件读回仍未启用 memory-wiki。没有在当前用户实例上开启插件或运行新 RAG。

文档交付检查通过：25 个本地链接、4 组 TypeScript 示例、1 组 JSON 配置和本次 diff 的空白检查。仓库产物保留总门禁仍有改动前的 8 项问题：7 项测试的 Git 跟踪状态与保留策略冲突，1 项既有 ignore 清单漂移。本次两个新增保留项没有新增门禁问题；详情保存在 source-review.json。

因此，当前可以确认实现缺口、复用点和首版路线；**B 的检索收益、live QA、完整 Electron 发送链与三平台升级证据要由 WP1–6 产出。** 本次 93 项是现有路径回归，不是 B 的验收。

首版架构没有未决项。后续只有这些决定需单独升级：改变冻结默认/产品锁、默认跨项目共享、引入有新增费用或数据外发边界的服务、公开发布、破坏性迁移。模块实现、自动化评测、agent 标注、证据读回和常规收口由 agent 完成。

## 15. 外部机制依据

2026-11-09 经 VerseSearch → Exa Contents 读取以下官方材料；本次四项均成功，内容来源为缓存。外部实验数字不作为 ClawX 的收益承诺。

| 一手材料 | 本决策吸收的机制 |
| --- | --- |
| [SQLite FTS5](https://www.sqlite.org/fts5.html) | unicode61 按连续 token 字符切词、不会自动做中文词语切分；bm25 数值越小越好。结合本机探针决定预分词与 ASC 排序。 |
| [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) | 区分 chunk 召回、融合和 rerank；用消融验证 title/context、dense 和重排，而不是将所有模型步骤默认开启。 |
| [Elastic RRF](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion) | 用各检索器的 rank 融合异质量纲；采用 k=60，记录 lane contribution，避免伪 confidence。 |
| [Azure AI Search RAG](https://learn.microsoft.com/en-us/azure/search/retrieval-augmented-generation-overview) | chunk 检索和 query-time access control 配合；权限必须进入检索路径，不能只在回答或 UI 最后过滤。 |

本 ADR 的消费者是后续 Harness task spec、开发者、验收 agent 和发布者；source-review.json 用于核对本次源码/测试事实。二者加入仓库精确保留清单，原始过程日志和一次性探针留在本地临时目录。
