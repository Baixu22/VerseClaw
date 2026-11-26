# Project RAG 独立评测合同

本合同冻结语料、任务、独立判据与运行预算。运行进度由 canonical Task Forest 保存；模型跑次与晋级结果必须另有完整实测证据。

## 数据与版本

`harness/specs/fixtures/project-rag/` 保存固定版本、release digest 和 evaluator authoring 输入。每版包含 240 个查询，calibration、validation、held-out 各 80；每组四语言各 20。来源族包含同一个原始文件及明确的伴随证据，同族的改写不跨 split。查询由 agent 编写，正文取自绑定的仓库 Git blob；来源原文、Wiki owner revision、完整文件 digest 与引用范围分别记录。

每版另有 64 个安全与无答案负例，覆盖 ACL、scope、撤销、到期、删除、revision、digest、namespace、policy epoch、敏感来源、取消、范围、冲突、空证据、无答案和提示注入。每个 split 都覆盖六种查询意图；安全案例单独计数，晋级前须读回三臂共 192 个观察收据。

版本冻结后修订生成新版本。原 gold、阈值和首次失败记录保留。release digest 位于版本目录之外，读取器先校验 manifest，再逐项读取文件 digest 与原始字节范围。

## 执行任务和判据

完整任务 cohort 为 60 项：20 个真实源码声明修复、20 个诊断文件交付和20 个跨源研究交付。每个 profile 的20 项任务来自20 个不同来源族；三个 repeats 和 Off/page/full 三臂组成540 个初始运行槽。槽位初始状态为 `not-run`，不会通过冻结或 grader 校准取得成功率。

代码任务交付修改后的真实源码与引用证明。独立 oracle 从历史参考声明生成固定探针，保留正常、边界和拒绝输入；代码修复必须通过实际 Node 执行并保留写集外的声明。涉及 workspace/RPC/page I/O 的函数使用明确标记的可重复 owner 输入，其探针记录为 `pinned-function-with-controlled-owner-io`。

诊断任务包含明确的错误行为、因果假设、纠正动作和验证探针，交付原因判断、动作、每项探针的预测结果及缺失的运行观察。研究任务比较三份跨源提案，逐一指出违背的来源合同、冻结默认值或容量条件，交付选择、拒绝理由、证据缺口和停止条件。独立判据在运行前从 pinned source facts 生成；只填字段不能完成这 40 个任务。

所有任务都校验原始引用、owner version、不可修改字段与显式 unknowns。引用只需完整覆盖冻结的支持字节，允许更短的有效单行引用或有界的扩展范围；quote 必须与引用范围的实际 owner bytes 相等。`query_result_match` 单独记录字段匹配；完整 `passed` 同时要求文件、分析及任务合同通过。代码任务用 `behavior_match`。

## 模型输入与 oracle 隔离

materializer 只写入一个任务请求、同 split 的来源文件和该任务的初始程序。请求及来源使用独立匿名 ID 和路径；family、query、split、global registry、gold、探针输入、期望输出、authoring 与 promotion policy 留在 evaluator 目录。研究任务的公开 objective 使用统一的动作比较说明，去掉 evaluator 原题中的来源族标签。映射收据保留在模型工作区之外，grader 将匿名引用映回真实 owner。相同 task/repeat 的三臂通过同一个外部 anonymizationSeed 使用相同映射；种子不写入请求包。

文件白名单读回校验模型 pack 内容。collector 只能向 provider 提交该包，并限制模型工具的工作区；materializer 不授予模型访问 evaluator 文件系统的工具。候选代码在独立受限探针进程运行；其文件、网络、进程、环境和动态代码权限由执行边界及负例测试验证。

held-out materialization 需要绑定 corpus digest、clean candidate 和 calibration receipt 的释放记录。记录中的 actor 为 agent；释放不修改已封存的 gold。

## 共享基线与预算

page 基线复用当前完整的 owner 读取、有界80行窗口、最多800行/96,000字符续读、可用 semantic lane、DCS 预算和 Knowledge QA 校验。缺 semantic provider 时记录 `not-evaluated`，不能将 A1 切成更弱的词法基线。Off、A1/page 和 B1/full 在开始前冻结同一 provider、generation settings、owner safety 与任务 envelope。

| Profile | 检索期限 | evidence tokens / chars | 单任务 token / deadline 上限 | 费用上限 |
| --- | --- | --- | --- | --- |
| local | 900 ms | 1200 / 3200 | 64,000 / 600 s | USD 0.50 |
| quality | 2500 ms | 2200 / 6000 | 64,000 / 600 s | USD 1.00 |
| research | 30 s | 5000 / 15,000 requested | 96,000 / 1200 s | USD 2.00 |

这些上限按三臂共同执行。DCS 仍会将请求收紧到当前全局剩余预算；现有6000字符全局上限不因本评测改变。费用包含 embedding、rerank、规划、生成、工具与未知使用量预留；使用量缺失不能晋级。预算文件只定义限制，冻结过程不调用付费模型。

## 统计与晋级

具体数值沿用 ADR：检索 nDCG@5 增益至少0.05、rerank固定候选池增益至少0.03，配对95%区间下界均须大于0；Recall@20 不低于共用安全基线。local/quality 任务成功增益至少5pp、成本增幅不超过10%；Research至少10pp、不超过25%。零成本基线使用封存的绝对 envelope。

任务统计使用完整 `taskId/repeat` 配对与 `pass^3`，查询变体按 source family 聚合。`paired-ablation.mjs` 提供区间与功效规划，缺配对、未知费用、退化方差和未跑安全案例均保持具体状态。扩样在 held-out 释放前按盲化 calibration 方差决定，每次新增20个不同来源族任务并产生新版本；禁止按 treatment 结果挑选任务或重复查看 held-out 后修改判据。

晋级函数接收 evaluator 外部保存的 experiment、safety 和每个 slot 的 attempt digest，逐项读回磁盘。目录合同为 `experiment.json`、`safety.json` 及 `attempts/<slotId的SHA256十六进制>.json`。实验收据绑定候选、来源安全、provider、generation settings、预算与冻结时间；安全收据绑定三臂的 64 个案例、观察摘要及全部安全指标；每次执行收据绑定独立 grade、原始交付摘要、开始和结束时间、完整费用与实际 tokens/modelCalls/elapsedMs。

无文件的 agent 失败记录 `capture.status=missing` 与原始空交付摘要，保留为失败配对。非法 JSON 在解析前记录实际字节 digest。基础设施失败、缺收据、篡改摘要、预算未知或不完整安全 cohort 返回 `insufficient-evidence`；已测的安全或预算违规否决晋级。

## 复算入口

在指定 Project RAG 工作树执行 `openclaw_runtime/node_modules/.bin/tsx --tsconfig tsconfig.node.json scripts/knowledge-rag-corpus.ts verify`。`release-v4.json` 为当前外部 freeze pin；冻结命令 `freeze-v4` 遇到已有版本会拒绝覆写。v1/v2/v3 保留首次封存字节及对应复核结论。

240查询、540槽、检索与重排增益、平台与容量，以及实际72小时稳定性均由后续完整验收读回。本合同本身是它们的固定输入。

## 当前知识库适配前置（RAG-A1）

RAG-A1 在 Research 完整收口前建立质量基线。现有 v4 继续作为工程契约回归输入；实际知识库语料、问题与 evaluator 使用新的版本身份，旧 gold、原始分数和首次失败保留。

读取当前 workspace 的 owner 只读快照，统计来源类别、语言、文档结构与长度、更新频率、重复、冲突、权限和近重复族。agent 根据实际来源编写并独立复核问题及支持事实；覆盖事实、流程、长文多证据、术语/编号、跨语言、冲突、无答案、过期和撤权。没有确认的活动库时，通过配置与 owner 路由重建真实来源身份，不能把工程夹具登记为当前用户知识库。

评分分别表示字节重叠、完整支持事实覆盖和排名质量。部分命中不能获得完整召回；合法片段联合覆盖与后续完整命中应正确计入，重复不重复奖励。评分规则改变时增加 evaluator 版本，通过明确的重算收据与旧结果比较。

在相同 owner 安全、生成器、DCS、费用和时间预算下，对 page、BM25、dense、hybrid、hybrid+rerank 做配对消融。每项结果同时报告召回候选、最终保留证据、回答正确性、引用支持、无答案/冲突判断、延迟、实际费用和有效降级路径；按语料及问题切片分析错误。样本量和判据在盲测释放前冻结，不能观察 treatment 后挑选样本。

Research 复用该基线比较单次/多轮收益，并以最终 retained units 和语义支持判断问题是否覆盖。实现沿用原预算、指定默认模型、owner 和 DCS；正式晋级继续执行原质量/费用门槛。RAG-19 同时读取原 240 查询、540 任务槽、72 小时观察及新增实际知识库证据。

Wiki metadata 中没有出现位置坐标的 claim，只有其文本的全部出现位置均在当前 owner 读取范围内才进入结构化冲突判断。范围外的相同文本会使部分读取的身份绑定含糊，不能用范围内的偶然匹配替代。

远端 rerank 的原始用量允许位于 `meta.tokens`；`meta.billed_units` 单列计费单位。多 batch 只有全部 input_tokens 为非负安全整数且总和有效时才登记总用量，缺失批次不能用已知批次的部分和替代。历史原始响应可按已封存 SHA256 补读用量，补读记录需引用原回执并保留旧结果。

评分实现版本 `owner-support-coverage/v3` 分开返回 `overlapRecallAt20`（存在非零重叠）、`supportCoverageAt20`（每项事实联合字节覆盖率的均值）和 `recallAt20`（完整支持范围被覆盖的事实比例）。Top-5 排名在事实与名次之间选择最大增益的一对一分配，单条命中的等级只由该片段自身覆盖决定；后续完整命中可替换较早的部分命中，重复片段不再次贡献且保留其占用的真实名次。联合片段只参与完整召回与覆盖率。同一结果包含多个事实时排名只计一次，完整事实召回仍逐项计算。

查询执行计划、逐查询分数和离线报告必须显式绑定上述 evaluatorVersion；原始捕获重算时同时核对版本及三种覆盖指标。旧版本报告保持原件，新版本晋级入口拒绝混用。

`knowledge-rag-adaptation.ts capture <plan.json> <new-directory>` 通过 Wiki owner 的策略与版本读取现有来源，生成只读快照；`freeze <plan.json> <new-file>` 绑定独立复核和原文支持范围。origin 必须为 `existing-owner` 或 `agent-built-adaptation`。来源撤回、变更、路径逃逸和读取预算缺口不能进入完整冻结数据。问题集按来源族划分，重复内容、相同来源和高相似文本须同族；gold 留在 evaluator 目录。所有者已指定本轮可使用当前项目文档构建隔离适配语料，运行记录保留该来源标识。

`owner-support-coverage/v2` 的首次适配实验原件保留。v3 在 Top-5 一对一分配中允许不同来源范围为多个事实分别承接名次，同时拒绝同一 pin/range 的重复奖励；跨版本比较需用相同原始捕获重新评分并保留重算身份。


## 实际知识库资格读回

`knowledge-rag-adaptation-readback.ts <manifest.json> <sha256:digest> <candidate> <policy-digest> <local|quality|research> <baseline-digest> <new-output.json>` 重开 `KnowledgeAdaptationQualification/v1` 封存包。包引用执行前冻结的 RunPlan、owner snapshot、authoring原件、独立复核数据集和每题 page/full 原始捕获。两臂必须绑定同一模型、生成设置、embedding space、chunker、语料和各自策略；逐题从 owner 字节重算各阶段的覆盖，最终 retained 集必须匹配实际 DCS 收据。回答和盲审按输入、输出和数据集 digest 绑定。

读回按 split/语言/有答案、无答案、冲突切片，定位 indexed、parsed、candidates、reranked、retained、answer-support、answer 或 abstention 缺口；未记录的阶段不推断。held-out 按来源族配对，沿用最少20族、正95%区间、5pp/Research10pp和10%/Research25%费用条件。未知用量和不完整运行保持不足；原9文档适配实验继续是描述性结果。

策略包增加 `adaptation` 原件引用；实际知识库资格和原240query/540槽同时通过才可晋级。现有诊断回执记录真实融合、owner复验、重排和最终筛选时间，DCS保留摘要以及规划/支持模型调用的时长和支持计数。默认只存引用、摘要、用量及状态。


## 最终资格清单

最终 manifest 的 nodes 包含 RAG-01～18 与 RAG-A1 共19项能力证据。capacity 必须包含 portable/ann × 768/4096 四格，每格记录 mode、dimensions、报告 path/sha256 与 input manifest 的 path/sha256。报告须来自 google/embeddinggemma-300m 或 Qwen/Qwen3-VL-Embedding-8B 对应维度、完整space和实际provider输出，synthetic仅保留工程探针身份。读回以64KiB缓冲核对向量流和所有原来源/响应pin，不把大向量文件一次装入内存。

adaptation、adaptationProfile 绑定同候选已通过策略包的实际知识库资格，失败时返回具体来源、样本、支持或费用缺口。原240query/540槽/72小时、Windows-only范围和完整Executor/Verifier门保持。开发回归不填补这些尚未执行的原件。


2026-11-26 收尾审查补强：RunPlan直接绑定datasetDigest、authoringDigest、snapshotFileDigest，资格入口核对预期profile和baseline policy，不能以重封装清单替换执行后题集或降低判据。DCS集按双向完整pin集合核对；费用与质量都使用held-out配对族，冲突答案允许正确陈述相互矛盾的来源。容量最终读回复用流式输入验证器，重验完整space、每项原响应/来源和全部pin清单；文档/查询均拒绝同一来源范围或同一响应项的改名重复，延迟与召回汇总从31项原测量复算。
