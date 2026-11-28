# Project RAG 本地优化执行计划

本计划将 2026-11-26 的源码、配置和质量审查转成六个串行工作包。目标是让已有检索工程能力在实际知识库、记忆和开发任务中产生可验证收益。Task Forest 是进度权威；本文件固定交付、依赖、验证与回滚。

短邻块与父文档配额的历史对照、错误题切片和后续配对要求见[证据单元实验](EVIDENCE-UNIT-EXPERIMENTS.md)。

**来源与既有节点**

- 主线审查基点：`917a71cba7b2dfc8aedbdb3b75b7b693e3900f1e`；G2 修复候选：`a4c8c91df2cd39b4a1699494a65463ad42af5e96`。
- 归属现有项目知识检索目标 `TF-0870`。复用 `TF-0946` 质量基线和 `TF-0893` 至 `TF-0896` 的验收，保留原240查询、540任务槽、72小时与Windows优先合同。
- 原验收按 issue #281 的既有暂缓安排处理；实现和轻量证据可以推进，完整运行需要新候选与匹配执行计划。
- 旧 `TF-0122` 已裁决迁出旧hybrid链。记忆优化沿已接通的RAG-13/14 owner adapter进行，退休pre-reply旁路保持关闭；经验适用性复用 `TF-0965` 合同。

**受保护约束**

- 原文、权限、版本、retention、索引generation由现有owner管理；DCS决定最终上下文。
- 初始scope/mode/profile、384/768/2400切块边界、默认远端模型/4096维空间及其他冻结默认保持。实验使用显式版本化策略，晋级遵守既有离线合同。
- 同一来源族和近重复不能跨calibration/validation/held-out；盲测前冻结判据、样本量、输入契约和成本。
- 真实调用绑定provider、候选、输入、run和费用/资源预算；旧grant、未知身份和原始失败保留。
- 自动化与评审产物均标为agent驱动；交付按磁盘产物验证。

**顺序与原工作对应**

| 工作包 | 交付 | 前置 | 原节点 |
| --- | --- | --- | --- |
| O1 | 将 G2 检索修复接入当前主线 | 当前审查与规划 | TF-0893 |
| O2 | 读回当前工作区真正生效的知识检索能力 | O1 | TF-0894 |
| O3 | 按实际文档结构优化短片段和完整支持事实 | O2 | TF-0946 |
| O4 | 校准融合重排和 DCS 最终证据选择 | O3 | TF-0946 / TF-0894 |
| O5 | 让记忆和经验沿现有 owner 提供准确的检索能力 | O4 | TF-0875 / TF-0965 |
| O6 | 证明按需多轮检索的收益并移交完整验收 | O5 | TF-0893 / TF-0896 |

**O1 · 将 G2 检索修复接入当前主线**

让日常版本获得已经完成的撤权、provider生命周期、语义支持和费用边界修复。

Owner：retrieval planner、memory-wiki provider、Main Research、SourceSet。实施规格：`harness/specs/tasks/project-rag-mainline-integration.md`。规格在本叶启动时建立或收窄，并运行 Harness context。

验收：

1. 逐项记录主线与G2候选的源码差异、依赖和采用范围；在main派生的隔离工作树保留并发源码。
2. 重排失败/撤权、旧provider取消/禁用/替换、Research语义覆盖与费用预留、评分和来源完整性的对应回归在集成候选通过。
3. Host/Gateway合同、相关类型/lint、Harness及通信回放/比较满足触及路径；用户可见变更有对应Electron证据。
4. 干净候选、源码摘要、回滚点和精选证据可读回，合入主线时逐项验证结果；保留issue #281的原完整验收状态。

产物：主线差异及依赖清单；集成候选与回归证据；可回滚主线提交。
回滚：回退本节点的集成提交，保留G2来源分支和既有用户数据。

**O2 · 读回当前工作区真正生效的知识检索能力**

让用户和agent知道当前问题实际使用了哪个库、索引、模型、检索路径及最终证据。

Owner：memory-wiki operations、knowledge host-api、Chat/Knowledge UI、DCS receipts。实施规格：`harness/specs/tasks/project-rag-effective-capabilities.md`。规格在本叶启动时建立或收窄，并运行 Harness context。

验收：

1. 复用已有operations和检索收据，从可信workspace/session owner读取活动库、profile、scope、generation、embedding space/维度、rerank状态。
2. 保存配置、运行有效能力、实际调用与降级原因分开；密钥只报告存在性，能力声明不以环境变量存在代替就绪。
3. query/request身份变化、禁用/换代/未配置、不同知识域及无可读库都有可执行反例；缺库使用标为agent构建的隔离适配库验证。
4. 通过现有设置/知识/聊天入口呈现诊断，并核对DCS最终保留证据；四语、Host合同和Electron旅程与当前候选一致。

产物：实际能力与降级读回；来源及请求身份绑定；用户入口与负例证据。
回滚：恢复原诊断投影，不修改已保存provider选择和来源内容。

**O3 · 按实际文档结构优化短片段和完整支持事实**

让列表、表格和长文里的相关条件能够完整进入检索候选，减少过碎片段造成的缺证。

Owner：source/chunker、owner raw spans、adaptation corpus、DCS atomic packing。实施规格：`harness/specs/tasks/project-rag-evidence-unit-adaptation.md`。规格在本叶启动时建立或收窄，并运行 Harness context。

验收：

1. 基于owner快照报告标题、列表、表格、代码、长度、语言和片段分布；保留agent-built-adaptation与日常库的不同身份。
2. 在现有结构解析器中实现或复用同标题短块合并和有界邻块/父节候选，保留原始UTF-8/CRLF范围、版本与精确引用。
3. 以单因素实验比较既有切块、结构合并及有界扩展；标题前缀不进入原文引用，权限/时效变化立即失效。
4. 用多片段答案、表格标题、否定/数值/单位、长文和中英文样本检验完整支持事实；tokenizer、chunker、题集和预算版本固定，冻结默认保持原值。

产物：来源画像与错误切片；可选择的证据单元策略；分块覆盖及引用回归。
回滚：按版本回到原chunker/index generation，派生索引可重建。

**O4 · 校准融合重排和 DCS 最终证据选择**

用同一知识库证明排序复杂度带来的正确答案、支持引用、延迟和费用收益。

Owner：retrieval policy、rerank、DCS retention、offline promotion。实施规格：`harness/specs/tasks/project-rag-paired-policy-optimization.md`。规格在本叶启动时建立或收窄，并运行 Harness context。

验收：

1. 复用TF-0946的page/BM25/dense/hybrid/hybrid+rerank比较，保持同生成器、owner准入及预算；按来源族隔离calibration/validation/held-out。
2. 分别记录源缺失、解析丢失、召回、融合、parent配额、重排、DCS裁剪、生成和引用支持失败；实际retained manifest为覆盖测量入口。
3. 在盲测释放前冻结样本量、判据、provider/input格式、成本预留和配对统计；报告正确且受支持答案、拒答、P95、partial和未知费用。
4. 只按既有离线晋级合同形成版本化策略与回滚包；真实调用必须绑定新候选和新资源/费用计划，未知请求不重发，原240query/540槽/72小时合同保留。

产物：阶段错误归因；配对质量与成本结果；版本化候选策略与回滚。
回滚：使用上一已验证policy；新报告保留为独立实验版本。

**O5 · 让记忆和经验沿现有 owner 提供准确的检索能力**

让记忆、角色材料和已确认经验在适用范围内可发现、可撤回，并准确反映实际能力。

Owner：native memory/role-memory owner、SEKB confirmed principles、Project RAG adapters、DCS。实施规格：`harness/specs/tasks/project-rag-memory-capability-alignment.md`。规格在本叶启动时建立或收窄，并运行 Harness context。

验收：

1. 对齐TF-0122的旧hybrid迁出裁决和RAG-13/14合同，明确生产文本工具、受控可选语义检索和诊断域的真实能力。
2. 复用现有owner/provider与Project RAG候选契约，逐域传递scope、版本、retention和取消；保留已退休的pre-reply旁路及默认开关状态。
3. 验证跨会话别名、时间更新、来源纠正/删除、provider切换、经验条件与反例；只读候选不能写回canonical memory或SEKB。
4. 展示、DCS保留、引用、同run observed operation和独立任务结果分别记录；复用TF-0965的条件化经验接口，RSI资格沿原节点独立判断。

产物：各记忆域能力映射；受控候选与撤回回归；经验适用性配对切片。
回滚：按owner关闭新增adapter/实验策略，原生存储和既有文本工具继续可用。

**O6 · 证明按需多轮检索的收益并移交完整验收**

仅在单次证据不足且预算允许时补查，并证明补查对本地复杂问题的实际帮助。

Owner：bounded Research、semantic support、Provider Spend、G2 acceptance readback。实施规格：`harness/specs/tasks/project-rag-research-benefit-qualification.md`。规格在本叶启动时建立或收窄，并运行 Harness context。

验收：

1. 复用既有Research控制器、owner、费用与30秒/3轮/8query/2规划调用合同，记录每跳问题、支持事实、检索结果、停止理由和DCS最终保留。
2. 在冻结单次强基线上配对比较单次与按需多轮；简单问题不被强制多轮，答非所问/冲突/无答案/取消/迟到回执有回归。
3. 真实模型、输入、运行候选、费用和未知调用均有可复算收据；有界补查的收益、退化与成本按预登记判据说明。
4. 将优化来源与结果交给TF-0893/0894/0895/0896，匹配新计划后完成原Windows、容量、稳定性及独立复验；本节点的实验结果不改写旧验收。

产物：逐跳诊断与配对收益；候选绑定的验收移交；关闭与回滚演练。
回滚：回到单次已验证profile，保留多轮原始失败与费用记录。

**验证与可恢复执行**

每叶先检查工作树、当前源码、依赖和资源状态；实现文件与独立回归同时进入变更。功能变更复核en/zh/ja README；用户入口补四语和Electron旅程。后端通信按任务规格运行合同、Harness、通信回放/比较。质量实验读回最终DCS保留内容，分别记录完整事实覆盖、正确且受支持答案、拒答、P95、partial和费用。

候选变化后重新冻结所有相关输入。开发回归、真实模型实验与完整系统验收各自绑定实际结果；只有达到所在节点全部条件才关闭。全量实体图、训练式Self-RAG和新向量服务仅在对应问题切片证明需要时另行提出。
