# Project RAG 长期实现工作包

本计划的终点是完整长期版本。RAG-01 至 RAG-19 为必交付；实际进度由本地 Task Forest 与每叶精选证据记录。阶段交付按各自规格验收，长期目标在全部实现与验收节点完成后收口。

依据：[最终 ADR](../adr/2026-11-09-project-rag-retrieval-plane.md) · [外部资料](RESEARCH-20261109.zh-CN.md) · [结构化合同](program.v2.json)。运行进度与实际 TF ID 由本地 Task Forest 管理；工作树的 WORKTREE.md 提供当前绑定。

## 长期目标

交付可维护、可验证的项目知识检索系统，具备持久混合检索、重排、多来源、Research、完整交互、生命周期和效果评测。

交付能力包括：owner读取/版本/权限、结构切块、多语言FTS、持久dense、portable/ANN、RRF、cross-encoder、DCS原子装配、strict/open引用问答、完整UI/配置、Memory/SEKB/代码图/任务线索、Research、索引运维、离线策略晋级及独立验收。

语料、540 槽三臂协议、模型输入隔离、任务判据和费用收据见[独立评测合同](EVALUATION-CONTRACT.md)。

来源原始字节、结构切块、tokenizer 绑定和精确引用复读见[来源与切块合同](SOURCE-CHUNK-CONTRACT.md)。

共享 SQLite 投影、显式启用、后台构建、撤销和崩溃恢复见[索引生命周期合同](INDEX-LIFECYCLE-CONTRACT.md)。

## 阶段与依赖

| 工作包 | 交付 | 前置 | 实现 owner |
| --- | --- | --- | --- |
| RAG-00 | [冻结长期决策、研究依据与工作树规划](../../../harness/specs/tasks/project-rag-long-term-program.md) | — | architecture / harness |
| RAG-01 | [统一来源读取的身份、权限与版本](../../../harness/specs/tasks/project-rag-owner-read-contract.md) | RAG-00 | knowledge owners / Host / Gateway |
| RAG-02 | [冻结真实语料、独立判据和对照协议](../../../harness/specs/tasks/project-rag-frozen-evaluation-corpus.md) | RAG-01 | evaluation |
| RAG-03 | [实现来源标准化、结构切块与精确定位](../../../harness/specs/tasks/project-rag-structure-chunk-citation.md) | RAG-01、RAG-02 | knowledge retrieval source / Wiki owner |
| RAG-04 | [实现增量索引、撤销传播与崩溃恢复](../../../harness/specs/tasks/project-rag-index-lifecycle.md) | RAG-03 | retrieval projection / shared state / background work |
| RAG-05 | [接通本地与远端 embedding 的完整生命周期](../../../harness/specs/tasks/project-rag-embedding-provider-lifecycle.md) | RAG-04 | embedding provider registry / retrieval source |
| RAG-06 | [交付可移植向量检索与规模化 ANN](../../../harness/specs/tasks/project-rag-vector-projection-backends.md) | RAG-05 | vector projection |
| RAG-07 | [实现按策略检索、融合和候选解释](../../../harness/specs/tasks/project-rag-retrieval-plan-fusion.md) | RAG-06 | retrieval planner |
| RAG-08 | [实现多语言 cross-encoder 重排服务](../../../harness/specs/tasks/project-rag-cross-encoder-rerank.md) | RAG-07 | rerank provider / retrieval planner |
| RAG-09 | [让 DCS 保序装配完整证据并记录实际引用](../../../harness/specs/tasks/project-rag-dcs-evidence-packing.md) · [装配合同](./DCS-EVIDENCE-PACKING-CONTRACT.md) | RAG-07 | DCS |
| RAG-10 | [完成 strict/open 问答、冲突披露与引用回源](../../../harness/specs/tasks/project-rag-grounded-answer-citation.md) | RAG-08、RAG-09 | Knowledge QA / citation viewer |
| RAG-11 | [完成按需知识交互和安全 Auto-read](../../../harness/specs/tasks/project-rag-chat-interactions.md) | RAG-10 | Chat UI / Host |
| RAG-12 | [交付完整配置、索引运维和能力状态界面](../../../harness/specs/tasks/project-rag-config-and-operations.md) | RAG-11 | Settings / runtime config / retrieval operations |
| RAG-13 | [接通原生记忆与角色记忆的独立读取](../../../harness/specs/tasks/project-rag-memory-source-adapters.md) | RAG-09、RAG-12 | native memory / Role Memory / retrieval adapters |
| RAG-14 | [接通已确认经验和可观察的采用归因](../../../harness/specs/tasks/project-rag-sekb-experience-lane.md) | RAG-09、RAG-12 | SEKB / attribution / retrieval |
| RAG-15 | [接通代码关系和任务事实的受控检索线索](../../../harness/specs/tasks/project-rag-code-graph-task-context.md) | RAG-09、RAG-12 | FactStore / Task Ledger / retrieval |
| RAG-16 | [实现有预算、能停止的 Research 检索](../../../harness/specs/tasks/project-rag-bounded-research.md) | RAG-08、RAG-10、RAG-13、RAG-14、RAG-15 | research retrieval planner / DCS / UI |
| RAG-17 | [完成检索可观测性和离线策略晋级](../../../harness/specs/tasks/project-rag-observability-offline-promotion.md) | RAG-12、RAG-14、RAG-16 | observability / evaluation / policy release |
| RAG-18 | [完成跨平台安装、离线运行与升级回滚](../../../harness/specs/tasks/project-rag-packaging-portability.md) | RAG-06、RAG-08、RAG-12 | packaging / provider lifecycle / platform validation |
| RAG-19 | [验收长期版本的完整能力、稳定性与任务收益](../../../harness/specs/tasks/project-rag-long-term-acceptance.md) | RAG-02、RAG-17、RAG-18 | independent evaluation / integration |

所有实现与验收默认在绑定的同一个专用工作树串行推进，避免多叶同时改写共享契约。分支已整合本地 main@806855309（研究起点为5ffcdfe89）；远端分叉不纳入本次整合范围。

## 每叶执行流程

1. 通过 Task Forest CLI 读取节点，核对 execution_binding、当前 HEAD 和前置证据。
2. 刷新该叶 spec 的 diffBase，运行 harness context。plannedTests 是要实现的测试合同；新增测试必须加入 requiredTests，并通过实际执行验证，不能用旧测试代替。
3. 落实现有 owner/public SDK 边界，补正向、拒绝、过期、超时、取消、恢复和回滚路径。
4. 功能/交互变化同步说明和四语言；UI 同一提交补 Electron E2E，通信变化执行 replay/compare。
5. 提交 clean candidate，读取磁盘上的结果、计数、hash、原始失败与续行证据。
6. 按仓库 auto-close 应用提案、validate/export；未达标节点继续保持开放并记录具体缺口。所有 actor 标为 agent。

## P0 冻结长期架构与开发基线

### RAG-00 冻结长期决策、研究依据与工作树规划

把完整目标、实现顺序、验证和工作树归属变成可执行合同。

- Owner：architecture / harness。
- 契约：ProjectRagProgram/v2、TaskForestWorktreeBinding/v1。
- 落点：`docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md`、`docs/dev/project-rag/**`、`harness/specs/tasks/project-rag-*.md`、`harness/specs/rules/project-rag-long-term-boundary.md`、`docs/dev/evidence/project-rag-longterm-20261109/**`、`.gitignore`、`scripts/repository-artifacts.json`、`README*.md`、`docs/modules/knowledge-base.md`、`docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md`、`shared/dcs/prod-flags-catalog.ts`、`docs/generated/catalogs/prod-flags.md`。
- 新测试：文档/Harness/图结构与绑定读回检查。
- Electron：由后续真实 Host/DCS/产品旅程集成包覆盖；本叶无新 UI。
- 回滚：回到规划前提交；不修改运行时默认与用户资料。

验收：

1. 长期目标覆盖 RAG-01 至 RAG-19，所有功能包有 owner、前置依赖、验证与回滚。
2. 一手资料、源码锚点和依赖平台元数据可回读；最终选择不依赖未定义的后续架构决定。
3. 本次改动已提交至 main 派生的专用工作树，任务提案通过预校验，节点绑定同一执行工作树。

## P1 建立可验证的来源、语料与索引基础

### RAG-01 统一来源读取的身份、权限与版本

读取语义与回源坐标见 [Owner 读取合同](OWNER-READ-CONTRACT.md)。

确保检索、预览、模型调用和引用使用同一份 owner 读取约束。

- Owner：knowledge owners / Host / Gateway。
- 契约：ReadAdmissionContext/v1、SourceRef/v2、OwnerReadSnapshot/v1。
- 落点：`shared/knowledge/**`、`shared/host-api/contract.ts`、`electron/services/knowledge*.ts`、`electron/services/chat-api.ts`、`openclaw_runtime/src/context-engine/chat-knowledge*.ts`、`openclaw_runtime/extensions/memory-wiki/runtime-api.ts`、`openclaw_runtime/extensions/memory-wiki/src/**`、`openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts`。
- 新测试：`tests/unit/project-rag-owner-read.test.ts`、`openclaw_runtime/src/context-engine/project-rag-owner-adapters.test.ts`。
- Electron：`tests/e2e/project-rag-owner-read.spec.ts`。
- 回滚：保留安全修复并禁用新 reader，回到同样准入的 page 读取。

验收：

1. 可信 session/workspace 身份派生 read context；renderer 的 scope、ACL 和 score 不能扩大权限。
2. source revision、完整内容 digest、policy epoch、namespace 与 range 经 Host/Gateway/runtime 往返保持；显式 pin 漂移拒绝。
3. 真实 Wiki adapter 保留 status/privacy/ACL/retention，拒绝源在 UI、embedding、rerank 和 prompt 中出现次数为零。
4. 所引用的 owner 版本按既有 owner 保留策略读取或明确失效；索引不能复活已删除或撤销的内容。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-02 冻结真实语料、独立判据和对照协议

在调参前固定怎样证明完整检索系统有效。

- Owner：evaluation。
- 契约：ProjectRagCorpus/v1、ProjectRagPromotionPolicy/v1、SourceSpanGold/v1。
- 落点：`scripts/knowledge-*.ts`、`scripts/lib/paired-ablation.mjs`、`harness/specs/fixtures/project-rag/**`。
- 新测试：`tests/unit/project-rag-corpus-integrity.test.ts`。
- Electron：由后续真实 Host/DCS/产品旅程集成包覆盖；本叶无新 UI。
- 回滚：保留原协议和旧 verdict；修订数据产生新版本，不原地改 gold 或阈值。

验收：

1. 240 个查询按来源族分为 calibration/validation/held-out 各 80；同源改写不跨 split，覆盖中英日俄及六种任务意图。
2. 安全/无答案/权限/版本负例独立封存；gold 引用真实 owner 版本和字节范围，标明 agent 编写与复核。
3. 60 个执行任务、3 repeats、Off/page/full 三臂与各 profile 成本预算在运行前冻结；oracle 对被测模型隐藏。
4. A1/B1 共享安全修复和预算条件，保留当前强 page/semantic 基线，不用弱化基线制造收益。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-03 实现来源标准化、结构切块与精确定位

让相关信息可被召回，并能回到准确原文位置。

- Owner：knowledge retrieval source / Wiki owner。
- 契约：KnowledgeChunk/v2、CitationLocator/v2、ChunkerProfile/v1、NormalizedSourceDocument/v1。
- 落点：`openclaw_runtime/src/knowledge/retrieval/**`、`openclaw_runtime/src/runtime-core/memory-tokenization.ts`、`openclaw_runtime/extensions/memory-wiki/runtime-api.ts`、`shared/knowledge/**`。
- 新测试：`openclaw_runtime/src/knowledge/retrieval/chunker.test.ts`、`tests/unit/project-rag-citation-locator.test.ts`。
- Electron：由后续真实 Host/DCS/产品旅程集成包覆盖；本叶无新 UI。
- 回滚：切换到已验证 chunker generation 或 owner page read，旧来源不迁移。

验收：

1. 标题、列表、步骤、代码围栏和表格有结构边界；raw UTF-8 offset、frontmatter、CRLF 和多字节字符可往返校验。
2. 检索文本与可引用正文分离，CJK bigram 和标识符保留通过中英日俄 fixture；生成前缀不能成为原文引文。
3. chunkId 绑定 source/version/span/chunker；同输入可重建相同片段，父文档/section/read range 始终可追踪。
4. 既有文件、目录与GitHub来源经owner标准化，记录parser/编码/来源版本与归一化映射；解析失败明确报错，不能当空文档；新材料仍经过既有确认链。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-04 实现增量索引、撤销传播与崩溃恢复

让长期索引跟随真实来源变化，而非逐渐过期的缓存。

- Owner：retrieval projection / shared state / background work。
- 契约：ProjectionGeneration/v1、IndexJob/v1、SourceInvalidation/v1。
- 落点：`openclaw_runtime/src/knowledge/retrieval/**`、`openclaw_runtime/src/state/openclaw-state-*`、`openclaw_runtime/src/resources/background-work-gate.ts`、`openclaw_runtime/extensions/memory-wiki/runtime-api.ts`、`electron/services/knowledge-source-sync.ts`。
- 新测试：`openclaw_runtime/src/knowledge/retrieval/projection-store.test.ts`、`tests/unit/project-rag-index-recovery.test.ts`。
- Electron：`tests/e2e/project-rag-index-lifecycle.spec.ts`。
- 回滚：停止新 jobs、切回有效 generation 或 page 路径，只清理派生索引。

验收：

1. SQLite FTS5 和 chunk 投影以 source generation/CAS 发布；未完成构建不会成为 active。
2. create/update/revoke/delete/权限变更、停止期间变化及重启均可恢复；撤销立即取消可读资格，后台清理不能恢复授权。
3. owner 事件、启动对账和既有 watcher 复用同一入口；失败与重试有游标、幂等键、总预算与退出清理。
4. FTS 缺失/索引损坏不影响共享状态和普通 Chat 启动；后台构建不阻塞主线程。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

## P2 完成持久混合检索与模型重排

### RAG-05 接通本地与远端 embedding 的完整生命周期

使语义召回可离线工作，并能安全切换获授权的模型服务。

- Owner：embedding provider registry / retrieval source。
- 契约：EmbeddingSpace/v1、EmbeddingJob/v1、ProviderCapabilitySnapshot/v1。
- 落点：`openclaw_runtime/src/plugin-sdk/embedding-providers.ts`、`openclaw_runtime/src/embeddings/**`、`openclaw_runtime/extensions/memory-core/runtime-api.ts`、`openclaw_runtime/src/knowledge/retrieval/**`、`electron/services/knowledge-embedding-provider.ts`。
- 新测试：`tests/unit/project-rag-embedding-lifecycle.test.ts`。
- Electron：`tests/e2e/project-rag-provider-settings.spec.ts`。
- 回滚：停止 embedding jobs，使用已有合格 space 或 lexical；已生成向量不作为知识真相源。

验收：

1. 复用现有 provider registry/public API，区分 query/document 输入；不启用或替换 memory slot。
2. 本地 EmbeddingGemma 768 维与配置的 Qwen3/兼容服务形成实际向量；维度、模型 revision、tokenizer、prompt format、normalization 不符拒绝混用。
3. 首次模型安装、校验、warmup、取消、重试、离线重启、磁盘/RAM 预算与凭据轮换完整；前台发送不触发整库 embedding。
4. 外部 embedding 需 owner egress 准入，缓存隔离不泄露凭据或跨项目内容。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-06 交付可移植向量检索与规模化 ANN

用统一契约覆盖普通项目与大语料，并明确平台能力。

- Owner：vector projection。
- 契约：VectorProjection/v1、VectorGeneration/v1、IndexBackendCapabilities/v1。
- 落点：`openclaw_runtime/src/knowledge/retrieval/**`、`openclaw_runtime/src/state/openclaw-state-*`、`openclaw_runtime/package.json`、`pnpm-lock.yaml`、`scripts/bundle-openclaw-runtime.mjs`、`openclaw_runtime/extensions/memory-wiki/package.json`、`openclaw_runtime/extensions/memory-wiki/runtime-api.ts`、`openclaw_runtime/extensions/memory-wiki/src/retrieval/**`。
- 新测试：`tests/unit/project-rag-vector-backends.test.ts`、`tests/unit/project-rag-vector-generation.test.ts`。
- Electron：由后续真实 Host/DCS/产品旅程集成包覆盖；本叶无新 UI。
- 回滚：按已发布 generation 回切；LanceDB 不可用时使用合格 portable backend 或 lexical，禁止整库状态倒回。

验收：

1. SQLite 精确向量路径与 LanceDB Embedded ANN 均实现同一 id/filter/space/generation 契约；每 namespace 仅一条 active backend。
2. LanceDB 使用库级只读检索 adapter，不加载 memory-lancedb 的 recall/capture/store hooks；向量行不承载可直接回答的正文。
3. 有条件前滤、未索引新行、删除、模型替换、后台 optimize、旧版本 cleanup、切换中断和重启均验证，旧授权不能复活。
4. 20k portable tier 和 100k ANN tier 分别测 Recall/latency/RSS/disk；缺 native 包明确展示 capability，fallback 保持普通 Chat 可用。
5. 向量库依赖归实际owner-side检索适配实现，core只消费public SDK/owner seam；ANN是本ADR登记的派生索引例外，SQLite继续拥有系统状态。
6. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-07 实现按策略检索、融合和候选解释

统一精确、词法、语义候选，避免分数和权限混为一谈。

- Owner：retrieval planner。
- 契约：RetrievalPlan/v2、RankSignals/v2、RetrievalResult/v2。
- 落点：`openclaw_runtime/src/knowledge/retrieval/**`、`openclaw_runtime/src/context-engine/source-set.ts`、`electron/services/knowledge-api.ts`、`shared/host-api/contract.ts`、`src/lib/host-api/knowledge/**`。
- 新测试：`tests/unit/project-rag-plan-fusion.test.ts`、`tests/unit/project-rag-plan-owner.test.ts`。
- Electron：`tests/e2e/project-rag-plan-fusion.spec.ts` 覆盖实际 local hybrid、撤回、旧 pin 和 Preflight 的候选展示。
- 接口与预算：[检索计划合同](RETRIEVAL-PLAN-CONTRACT.md)。
- 回滚：关闭新 plan reader，沿相同 owner 准入回到 page 检索。

验收：

1. 按 mode/profile/owner scope 分配 lanes 和一个总 deadline；provider 失败沿剩余预算退化。
2. 显式 refs 精确解析；普通结果按 lane rank 做 RRF、去重与 parent 配额，多 query 不重复放大同一信号。
3. 不沿用 score/100、0.55 或固定 0.72；提供 scoreKind、lane rank、贡献、过滤与fallback原因。
4. SourceSet 不二次覆盖 RRF 排名，不恢复 sticky-denied 来源；query tokens 参数化转义。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-08 实现多语言 cross-encoder 重排服务

在召回覆盖后提高实际送入模型的证据精度。

- Owner：rerank provider / retrieval planner。
- 契约：RerankProvider/v1、RerankResult/v1。
- 落点：`openclaw_runtime/src/knowledge/retrieval/**`、`openclaw_runtime/src/plugin-sdk/**`、`electron/services/knowledge-api.ts`、`shared/host-api/contract.ts`。
- 新测试：`tests/unit/project-rag-rerank-provider.test.ts`。
- Electron：`tests/e2e/project-rag-provider-settings.spec.ts`。
- 回滚：关单一 scorer，保留 RRF 次序与同一准入集。

验收：

1. Qwen3-Reranker-0.6B 为参考 cross-encoder；实现具备模型清单的本地/远端 endpoint adapter 与取消、超时、批次预算。
2. 输入仅包含已准入候选；结果 id/order/count/finite score 校验，raw logit 或 sigmoid 不作为校准概率。
3. quality/research profile 实际调用重排；local profile 不依赖该服务；失败有 effectiveProfile 与降级原因。
4. 与固定候选池做模型/无重排消融，输出 nDCG/precision 与端到端成本，不把 provider 可达性当收益。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

## P3 完成证据装配、问答和用户交互

### RAG-09 让 DCS 保序装配完整证据并记录实际引用

保证检索到的证据以可追踪、预算内且完整的形式进入模型。

- Owner：DCS。
- 契约：KnowledgeCandidatePacking/v2、RetainedEvidenceManifest/v1。
- 落点：`openclaw_runtime/src/context-engine/context-candidate.ts`、`openclaw_runtime/src/context-engine/turn-injection-budget.ts`、`openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts`、`openclaw_runtime/src/context-engine/chat-knowledge-intent.ts`。
- 新测试：`openclaw_runtime/src/context-engine/project-rag-packing.test.ts`。
- Electron：`tests/e2e/project-rag-dcs-citation.spec.ts`。
- 回滚：停用 chunk producer，使用同样受 DCS 控制的 page adapter。

验收：

1. 同通道知识候选保留经 DCS 接受的 ordinal，不由 candidateId 意外改序；跨通道优先级仍由 DCS 决定。
2. 以 chunk/冲突组为原子装配单元，token/字符估算与最终用量可回读，余量不足整片丢弃。
3. source/chunk/projection 三种 digest 分开；citation manifest 仅覆盖实际 retained bytes。
4. 普通 Chat、media、queue、retry、model-only QA 共享准入与知识装配路径；kill switch 和重复模型调用不会晚到或重复注入。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-10 完成 strict/open 问答、冲突披露与引用回源

让用户能区分有证据的事实、推断和未解决的问题。

- Owner：Knowledge QA / citation viewer。
- 契约：Citation/v2、EvidenceStatus/v2、AnswerClaim/v1。
- 落点：`electron/services/knowledge-evidence-qa.ts`、`electron/services/knowledge-source-set-answer.ts`、`src/lib/knowledge-librarian.ts`、`src/pages/Chat/KnowledgeChat.tsx`、`src/pages/Knowledge/**`、`shared/host-api/contract.ts`。
- 新测试：`tests/unit/project-rag-answer-contract.test.ts`。
- Electron：`tests/e2e/project-rag-dcs-citation.spec.ts`。
- 回滚：关闭综合或新 citation viewer，保留已准入摘录及原有治理动作。

验收：

1. exact quote、source/版本/范围校验和 semantic claim support 分开记录；不把 quote 存在宣称为语义支持。
2. strict 缺源/冲突返回unknown，open 的一般知识/推断不伪造引用；provider错误保留partial与原因。
3. citation 点击先重验权限，定位正确 raw range；旧版本按 owner 保留策略显示或明确失效。
4. 创建产物继续走 Inbox/Draft/Proposal/apply；回答不获得工具或写入权限。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-11 完成按需知识交互和安全 Auto-read

让知识检索可选择、可解释、可取消，并且不拖住普通聊天。

- Owner：Chat UI / Host。
- 契约：KnowledgeInteractionPolicy/v2、AutoReadAdmission/v1。
- 落点：`src/pages/Chat/ChatInput.tsx`、`src/pages/Chat/index.tsx`、`src/stores/chat.ts`、`src/pages/Knowledge/**`、`shared/i18n/locales/*/chat.json`、`shared/i18n/locales/*/knowledge.json`。
- 新测试：`tests/unit/project-rag-chat-policy.test.tsx`。
- Electron：`tests/e2e/project-rag-chat-modes.spec.ts`。
- 回滚：恢复兼容 Preflight/page 控件，保留原 scope/mode 和未发送草稿。

验收：

1. Off/Manual/Suggest/Auto-read 与 retrieval profile 正交；保持 none/suggest 的现有默认组合。
2. Preflight 的 inspect/attach/dismiss/当前版本/预算与 Used Knowledge 反映真实结果；无未授权 snippet。
3. Auto-read 显式选择；来源确认、新鲜度、唯一精确命中及内容证据或有效相关性校准共同准入，最多3个片段。
4. session/scope/query切换、取消、晚到响应、media/queued send、provider超时和missing-index的Electron路径通过；普通发送不被检索无限等待。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-12 交付完整配置、索引运维和能力状态界面

配置、状态语义和回滚步骤见[配置与运维合同](CONFIG-OPERATIONS-CONTRACT.md)。

让长期运行中的来源、模型、索引、预算和失败都可管理。

- Owner：Settings / runtime config / retrieval operations。
- 契约：ProjectRagConfig/v2、RetrievalCapabilitySnapshot/v1、IndexStatus/v1。
- 落点：`openclaw_runtime/extensions/memory-wiki/**` 的 owner 配置与索引服务、`openclaw_runtime/src/knowledge/retrieval/index-controller.ts`、`shared/knowledge/operations.ts`、`shared/host-api/contract.ts`、`electron/services/knowledge-api.ts`、`src/components/settings/**`、`src/pages/Models/index.tsx`、`shared/i18n/locales/*/settings.json`。
- 新测试：`tests/unit/project-rag-config-parity.test.ts`。
- Electron：`tests/e2e/project-rag-settings-operations.spec.ts`。
- 回滚：doctor迁移与profile关闭恢复旧有效配置，保留owner数据和有效generation。

验收：

1. config type/schema/help/defaults/catalog/doctor一致；scope/mode不双存，未知配置不能静默放行。
2. 界面能选择owner/source set/profile/provider与回答策略，并展示enabled/ready/degraded/disabled及原因。
3. 重建、暂停、恢复、模型/维度换代、空间预算、索引滞后、逻辑删除与物理cleanup状态可回读。
4. 所有用户文案四语言与设计token覆盖；操作复用Host API，不由renderer直接访问DB、FS或provider。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

## P4 接通记忆、经验和研究检索

### RAG-13 接通原生记忆与角色记忆的独立读取

综合可用记忆，同时保持各存储域和作用域的边界。

- Owner：native memory / Role Memory / retrieval adapters。
- 契约：RetrievalOwnerDescriptor/v1、MemorySourceRef/v1。
- 落点：`openclaw_runtime/src/memory/**`、`openclaw_runtime/extensions/memory-core/runtime-api.ts`、`openclaw_runtime/src/context-engine/chat-knowledge-source-adapters.ts`、`openclaw_runtime/src/knowledge/retrieval/**`、`shared/knowledge/**`。
- 新测试：`tests/unit/project-rag-memory-domains.test.ts`。
- Electron：`tests/e2e/project-rag-source-domains.spec.ts`。
- 回滚：按owner单独关闭adapter，保留原生记忆服务与资料。

验收：

1. 原生文件/active memory provider与Role Memory card各自精确解析namespace与ID，不按一个memory标签混用。
2. 原有read/use gates、session/workspace/sensitivity/retention生效；Runtime Memory诊断域不自动转成active lane。
3. 不复制canonical memory到Wiki或新chunk authority，统一的是只读候选与DCS证据。
4. correction/delete/slot切换、禁用和缓存失效真实传播，不访问前一个owner的内容。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-14 接通已确认经验和可观察的采用归因

让历史经验帮助实际执行，并知道是否被采用及是否有效。

- Owner：SEKB / attribution / retrieval。
- 契约：ExperienceRef/v1、RsiExperienceAttribution/v1。
- 落点：`electron/services/knowledge-api.ts`、`openclaw_runtime/src/knowledge/sekb/**`、`openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.ts`、`openclaw_runtime/src/knowledge/retrieval/**`。
- 新测试：`tests/unit/project-rag-sekb-attribution.test.ts`。
- Electron：`tests/e2e/project-rag-source-domains.spec.ts`。
- 回滚：关闭experience lane，不撤销已确认principle或历史归因收据。

验收：

1. 复用 Runtime Lessons 接口，只召回 active confirmed principle；sekb前缀、canonical ID和内容版本精确绑定。
2. candidate、revoked、错版本、metadata-only无相关内容的经验不得Auto-read；取消固定0.72。
3. UI exposure、context exposure、citation、adoption、operational outcome和independent task grade分别记录。
4. adoption必须有同run observed operation，现有事务/去重/删除传播完整；检索和反馈不直接改principle或排序。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-15 接通代码关系和任务事实的受控检索线索

支持跨文件关系与任务相关证据发现，避免创建通用图权威。

- Owner：FactStore / Task Ledger / retrieval。
- 契约：RelationshipExpansion/v1、TaskContextHint/v1。
- 落点：`openclaw_runtime/src/context-engine/views/retrieval/**`、`openclaw_runtime/src/context-engine/factstore/**`、`electron/services/task-ledger-api.ts`、`openclaw_runtime/src/knowledge/retrieval/**`。
- 新测试：`tests/unit/project-rag-graph-task-context.test.ts`。
- Electron：`tests/e2e/project-rag-research.spec.ts`。
- 回滚：关闭关系扩展和任务hint，代码/任务canonical stores保持工作。

验收：

1. 代码图复用FactStore，先修复/约束文件stem歧义，边绑定repo/revision与实际符号路径。
2. graph仅为relationship/research扩展召回，一跳默认、两跳硬上限、节点数有界；每个落点重新owner准入。
3. Task Ledger只提供任务revision、约束与证据refs，不进入长期chunk表，不创造或改写任务事实。
4. cross-workspace、stale edge、同名文件、缺Ledger与无关系请求均有负例和明确降级。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-16 实现有预算、能停止的 Research 检索

完成跨来源研究、证据缺口追查与关系分析。

- Owner：research retrieval planner / DCS / UI。
- 契约：ResearchPlan/v1、ResearchStep/v1、EvidenceGap/v1。
- 落点：`openclaw_runtime/src/knowledge/retrieval/**`、`electron/services/knowledge-api.ts`、`src/pages/Chat/**`、`shared/host-api/contract.ts`、`shared/i18n/locales/*/knowledge.json`。
- 新测试：`tests/unit/project-rag-research-controller.test.ts`。
- Electron：`tests/e2e/project-rag-research.spec.ts`。
- 回滚：停止research controller，已选scope保留，恢复单query local/quality路径。

验收：

1. 显式单次调用，最多3轮/8检索query/2次规划模型调用；deadline、token、费用和graph预算在开始前冻结。
2. 查询拆解和证据缺口决定后续检索；重复、无新证据、足够覆盖、超时和取消都能停止。
3. 所有子查询继承同一scope与owner权限；Research不自动扩外网、跨项目或工具/写权限。
4. 返回真实证据、推断、冲突与缺口，DCS预算截取后仍可复算；Electron展示进度、取消与partial结果。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

## P5 完成运营维护和长期版本验收

### RAG-17 完成检索可观测性和离线策略晋级

持续发现质量与成本回退，同时防止反馈形成未审核的自学习。

- Owner：observability / evaluation / policy release。
- 契约：RetrievalReceipt/v1、RetrievalSlo/v1、OfflinePolicyPromotion/v1。
- 落点：`openclaw_runtime/src/knowledge/retrieval/**`、`electron/services/observability*.ts`、`scripts/knowledge-*.ts`、`harness/specs/fixtures/project-rag/**`、`src/pages/Knowledge/**`。
- 新测试：`tests/unit/project-rag-receipts-promotion.test.ts`。
- Electron：`tests/e2e/project-rag-settings-operations.spec.ts`。
- 回滚：回到上一冻结policy并停止新增诊断采集；保留必要审计。

验收：

1. request/plan/source/model/generation/DCS lineage可关联，阶段延迟、token/费用、fallback、索引滞后、删除积压和calibration漂移可查询。
2. 默认日志只存refs/digests/status/usage；raw evidence需要明确的测试/诊断保留政策，删除传播覆盖反馈与缓存。
3. attach/dismiss仅记弱反馈，新的排序参数经离线封存评测与版本化晋级；旧RSI verdict保持原含义。
4. 回滚能恢复前一policy，不改变owner确认权限、scope和产品锁。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-18 完成跨平台安装、离线运行与升级回滚

让目标系统在实际发布平台可安装、可恢复、可持续维护。

- Owner：packaging / provider lifecycle / platform validation。
- 契约：RetrievalPlatformMatrix/v1、RetrievalArtifactManifest/v1、RetrievalUpgradeReceipt/v1。
- 落点：`electron-builder.yml`、`openclaw_runtime/package.json`、`scripts/bundle-openclaw*.mjs`、`scripts/build-openclaw-runtime.mjs`、`scripts/release-*.mjs`、`harness/specs/fixtures/project-rag/**`。
- 新测试：`tests/unit/project-rag-package-manifest.test.ts`。
- Electron：`tests/e2e/project-rag-packaged-smoke.spec.ts`。
- 回滚：停用不兼容feature pack，回portable/lexical；保留canonical owner和正常Chat启动。

验收：

1. 按实际release target矩阵运行原生SDK/模型/FTS/SQLite probe；npm包清单不当作加载成功。
2. Intel Mac等缺ANN预编译包的平台具备完整portable语义路径与容量边界；ANN tier仅在实测通过的目标声明。
3. 有网首次安装、签名/校验、离线重启、低空间、半安装、模型更换、旧binary读取和增量schema回滚通过。
4. 正式升级不整库覆盖、不丢governance/SEKB/Task Ledger资料；所有临时输出遵守D盘策略。
5. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

### RAG-19 验收长期版本的完整能力、稳定性与任务收益

证明长期目标已经交付，并结束临时并行实现。

- Owner：independent evaluation / integration。
- 契约：ProjectRagAcceptance/v1、ProjectRagPromotionPolicy/v1。
- 落点：`scripts/knowledge-*.ts`、`harness/specs/fixtures/project-rag/**`、`docs/dev/project-rag/**`、`README*.md`、`docs/modules/knowledge-base.md`、`openclaw_runtime/src/knowledge/retrieval/**`。
- 新测试：`tests/unit/project-rag-acceptance-readback.test.ts`。
- Electron：`tests/e2e/project-rag-chat-modes.spec.ts`、`tests/e2e/project-rag-research.spec.ts`、`tests/e2e/project-rag-packaged-smoke.spec.ts`。
- 回滚：保持前一已验证profile与所有者服务，记录未达标项，修复后新版本重测。

验收：

1. RAG-01至RAG-18每项能力都有当前候选真实接线与失败路径证据；仅完成FTS阶段不得关闭长期目标。
2. 固定240query评测、完整Electron旅程、实际provider、20k/100k容量和72小时agent驱动soak完成，失败/partial/unknown保留。
3. 60任务×3repeats×3arms结果封存；按profile冻结门槛判定质量、成本与任务收益，区间/费用缺失不能晋级。
4. 临时score/confidence路径和重复装配收敛，page direct read成为永久显式ref/故障兼容入口，不保留第二排序或上下文权威。
5. 源码/规格/证据同候选可复算、clean工作树、回滚可演练；RAG范围验收与产品发布授权分别记录。
6. 本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。

## 资源与完成口径

模型、native包、平台runner和运行预算在对应节点启动时从现有授权资源解析；一次请求必要的endpoint后由agent自动执行。任何缺失执行、未知使用量或未运行平台都保留具体状态，不能补成成功。

最终采用240-query与60-task协议。RAG-19只有在所有必交付能力、失败路径、跨平台容量、72小时稳定性和配对任务效果证据满足ADR门槛后完成。发布权限由仓库所有者单独处理，常规开发、证据和节点收口无需等待真人操作。
