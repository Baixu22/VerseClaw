# 当前知识库适配基线开发记录

后续 claim 出现位置修复、r6 回答对齐和当前验证结果见 [续接记录](CONTINUATION.md)。本文件保留首轮实验及其修正过程。

TF-0946 已实现评分修正、只读来源快照和问题集封存，并完成首轮实际检索与回答诊断。源码候选 `13edb1346827a8f6f13966c1ad404578669ef520`。节点在初轮记录中为 `in_progress / 85`，质量资格为 `hold`。

本轮由所有者明确选择“用当前项目文档建立隔离知识库，并标注为 agent 构建的适配语料”。9 份文档来自 `c2a024545` 的 Git 字节，原文合计 77,116 字节；添加可追溯 owner metadata 后为 79,480 字节。来源标识为 `agent-built-adaptation`。日常知识库配置未改写。

**已实现的行为**

- 查询评分分别报告重叠召回、联合支持范围覆盖和完整事实召回。单字节命中不再得到完整 Recall；后续完整片段可以改善排名，重复片段占据真实名次但不重复奖励。排名使用单片段自身覆盖，联合覆盖只参与召回。版本为 `owner-support-coverage/v3`。
- 查询执行计划、逐项指标及策略报告绑定 evaluator 版本，原始捕获重算同时校验覆盖指标；新旧评分不混用。旧 v4 gold 和首次结果保留。
- `scripts/knowledge-rag-adaptation.ts` 通过 Wiki owner 策略读取来源，不初始化源 vault；记录结构、语言、长度、权限、冲突 metadata、摘要及来源变更。输出目录与 vault 按真实路径隔离，复读中变化的来源退出快照。
- 问题集封存校验原始引用范围、作者/独立复核身份、完整复核覆盖和来源族划分。相同原始来源、重复与高相似内容不能分到不同来源族。
- 真实项目长段落暴露了索引发布校验问题：合法片段在同一来源行内切开时被误判为行不连续。现已依据前一片段是否以换行结束计算下一行坐标，字节连续性与引用校验继续执行。

**验证与审查**

最终候选 95 项节点回归通过；索引路径 22 项回归通过，相关源码在最终候选中未再变化。定向类型、lint、Harness validate、通信 replay/compare 通过。机器读回见 `development-readback.json`，源码摘要见 `source-inputs.json`。

WorkBuddy `deepseek-v4.1-flash` 对 27 个问题逐题给出纯文本 ACCEPT 和理由。独立代码初审提出了排名、复核者身份和真实目录隔离三项问题，均增加回归并修复。后续代码终判调用出现无文本、占位或不完整输出，保留原件，未登记为有效最终独立 verdict。

原始失败包括测试缺失 import、ESM mock 写法、临时 tsconfig 的 rootDir、同一行片段发布、tokenizer 下载被安全检查拒绝、实验驱动 provider 身份及空候选处理。tokenizer 随后从本机既有资产取得，并通过运行时固定 SHA256 校验；没有修改网络安全配置。

**实际语料与观察**

9 份文档包含 90 个标题、147 个表格行、544 个列表项和 12 个代码围栏标记，均含中文及拉丁字符。实际索引发布 871 个片段，正文长度中位数 33 字符。27 个问题按 9 个文档族分成三个各 9 题的 split，包含 18 个可回答问题和 9 个无答案问题。语料画像见 `corpus-profile.json`。

检索使用实际 owner、SQLite、模型、融合和 DCS 模块。向量模型为指定的 `Qwen/Qwen3-VL-Embedding-8B`，实际维度 4096；重排使用 `Qwen/Qwen3-Reranker-0.6B`。五路各记录 27 次，合计 135 个观察。回答采用相同 WorkBuddy 模型及生成设置，使用实际 DCS 保留的消息，gold 不传入生成器；独立回答评测另行读取固定 gold。

| 路径 | 最终证据完整覆盖问题 | 检索 P95 | 检索 partial |
|---|---:|---:|---:|
| page + semantic | 6/18 | 1.56 s | 17/27 |
| BM25 | 11/18 | 1.19 s | 0/27 |
| dense | 13/18 | 1.90 s | 1/27 |
| hybrid | 12/18 | 1.84 s | 1/27 |
| hybrid + rerank | 15/18 | 2.59 s | 4/27 |

上表使用修正驱动后的 r6 实际观察，绑定 afac8fe8b；证据覆盖的分母为 18 个可回答问题。以下回答数据属于保留的 r4/r5 历史诊断，不能与上表组合成同一端到端结果。回答分母为全部 27 次尝试，包含无答案题和缺失结果。135 次回答中 131 项有有效独立判断，4 项缺失或无终态。缺失项在全尝试成功率中按零计，未伪装成已判断的模型推理错误。指标用于描述这组语料，未执行策略晋级。

历史 r5 检索身份绑定 `13edb1346`。回答侧有 38 项按变化后的上下文重新生成；其余 97 项逐字比较问题与 DCS 消息后沿用原捕获，其中包含缺失结果。每项保留原回答候选、真实请求和复用理由。这是明确记录的组件输入复用，不是全新同候选的完整 Electron/Gateway QA 验收。详见 `answer-input-comparison.json` 和 `answer-observations.json`。

首轮实验在规划器之外提前计算 query embedding，期限记账不完整。r5 补记耗时时把小数毫秒传入计时器，导致 26 次重排在驱动边界失败；该轮性能推断已作废。r6 对剩余毫秒向下取整并保持原 2.5 秒 profile 上限，135 次观察全部完成，其中重排有 4 次期限退化。原失败、原始分数和 driver SHA 全部保留，见 retrieval-driver-correction.json。当前记录为并发桌面环境下的模块诊断，正式服务旅程需另行核对。

**真实负例与剩余交付**

由授权文档派生的 6 个明确标注的负例使用实际 owner 读取：撤权、陈旧、过期、其他主体和其他工作区 5 项拒绝符合预期。两来源冲突用例失败：两个包含不同 `chunk-target-tokens` claim 的 owner 页面都已读取，SourceSet 却返回空 conflictSet。`getMemoryWikiPage` 当前未把页面 claims 交给 SourceSet。原始断言失败和后续完整观察均保留，见 `source-safety.json`。

TF-0946 仍需完成：

1. 将结构化冲突信息按实际读取范围安全传递，并补真实路径回归；不得把未保留的 metadata 当作回答证据。
2. 完成符合期限的检索/回答基线，按同一最终候选取得所需的完整旅程证据；已复用的组件输入和模型失败继续单列。
3. 补齐可核验的费用 envelope 和用量结算。当前记录了 provider usage 与耗时，但货币费用为 unknown，因此不做成本门槛通过或策略晋级声明。

原 240 查询、540 任务槽、72 小时与完整工程双角色资格属于后续原节点合同，保持原状态。本目录交付本轮开发和适配诊断证据。

**复算入口**

节点规格：`harness/specs/tasks/project-rag-knowledge-adaptation-baseline.md`。持续回归命令已写入该规格的 requiredTests。

原始目录：`D:/tmp/g2-tf0946-20261125-01a21178`。其中 `kb-r1` 保存来源、owner 快照和索引；`retrieval-plan-r5.json`、`experiment-r5.ts`、`retrieval-r5` 保存最终检索；`evaluation-r2.json` 保存封存问题及 gold；`answers-r1/r2` 与 `answer-judging-r1/r2` 保存模型原件；`grade-retrieval-r2.ts`、`merge-answer-observations.py` 负责复算表格。所有调用、模拟与判断均为 agent 驱动。

**冲突路径后续修复**

候选 `7e9f8f096` 已补齐真实 Wiki → SourceSet 的 claim 传递，仅返回在当前 owner 读取正文中精确出现的 id/text。未读 metadata 不成为证据，撤权后不返回 claims。83 项相关回归与 6 个源文档派生负例通过；原失败保留在 source-safety.json，修复后结果在 source-safety-fixed.json。Electron 原有 DCS/引用旅程已补两来源结构化冲突断言，实际 Electron 执行待新构建及匹配窗口。

本轮最终状态以 followup-readback.json 为准。首轮检索和回答观察继续绑定其真实候选；后续修复未改写历史数据或旧模型回执。
