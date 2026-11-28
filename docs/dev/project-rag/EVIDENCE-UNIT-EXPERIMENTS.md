# 本地证据单元与父文档配额实验

本记录为 TF-0976、TF-0977 提供策略选择依据。2026-11-27 的回放表明，简单追加短邻块没有提高完整事实覆盖；提高单文档片段配额改善了三个问题的证据覆盖。下一步需要在同模型、同预算下生成两组新答案，测量这些证据是否转成正确且受支持的回答。

**输入与评分**

语料是 agent 构建的项目文档适配库：9 份文档、871 个片段、27 道题，其中 18 道有答案。历史检索候选为 `afac8fe8bd6ecdbbec70ea0cd984bc4eed039d61`；重放实现为 `a7a40deadaf8e1e96ca171927d902263d958aaf4`。快照摘要为 `sha256:b6f998e7acae786bd8624e5ab390265c2d89f153d92eec525b33ca4cac303649`。

远端 embedding 的历史记录绑定 `Qwen/Qwen3-VL-Embedding-8B`。回放复用已捕获向量，不发送 provider 请求。评分沿用 `owner-support-coverage/v3`，核对 owner、原文摘要、UTF-8 范围与冻结 gold 支持区间。完整覆盖表示必需支持区间全部进入证据；回答是否正确仍由独立答案评测判断。

**短邻块**

对不超过 192 字节的命中，追加同来源版本、同节的紧邻下一段，最多追加 256 字节。BM25、dense、hybrid、hybrid+rerank 四路在 18 道可回答题上都没有新增完整覆盖。hybrid+rerank 在 27 题累计增加 4,202 字节正文，因此这一策略尚无采用依据。

历史页面检索在最终 DCS 装配时由 8/18 降为 6/18，缺失发生在 QA-01-1、QA-09-1。其余四路的完整覆盖数在选择和装配之间持平。这要求后续归因使用最终保留清单及模型可见正文。

**父文档配额**

固定候选排序、最终最多 6 个片段和 DCS 6,000 字符预算，将每份文档的片段上限从 2 对照到 4。每个对照先要求 cap 2 的选中引用、DCS 引用与消息正文完全复现历史结果。dense/hybrid 的 QA-01-1 未能复现，因此排除并保留其 partial 状态。

| 路径 | 可比较的有答案题 | cap 2 完整覆盖 | cap 4 完整覆盖 |
| --- | ---: | ---: | ---: |
| BM25 | 18 | 11 | 11 |
| dense | 17 | 13 | 15 |
| hybrid | 17 | 12 | 14 |

| 切片与问题 | 改善路径 | 完整事实覆盖变化 | 历史答案 |
| --- | --- | --- | --- |
| calibration / QA-01-2：默认重叠及引用前缀 | hybrid | 1/2 → 2/2 | 答出 `overlap=0`，漏掉“检索前缀不进入引用正文” |
| validation / QA-08-2：磁盘预警阈值 | dense、hybrid | 0/1 → 1/1 | 未取到“低于 1 GiB”证据，两路均拒答 |
| 历史 held-out / QA-09-2：配置能否恢复退休 VToken | dense | 0/1 → 1/1 | 历史答案已正确且受支持，显示 gold 全区间覆盖与答案质量的差别 |

这里有四组 query/arm 改善、三个不同问题，未观察到覆盖退化。79 组可比较上下文有 18 组相同、61 组不同；四组改善的上下文均已改变。它们的旧答案只用于解释 baseline，不能归为 cap 4 的生成结果。逐题引用及输入摘要见 `harness/specs/fixtures/project-rag/optimization-replay-20261127/readback.json`。

生产 policy 的配额仍为 1–2；cap 4 是离线反事实。历史 held-out 已用于这次诊断，后续晋级需要新的、按来源族隔离的未见题集。

**下一次配对评测**

先在 TF-0975 完成实际工作区能力读回，再启动 TF-0976/0977 的实现。提前固定题集、模型、提示、采样参数、请求与来源身份、成本预留、超时与评分。按当前模型约定使用 `ccs-ai/gpt-6.1-sol`；历史生成器不同，因此两臂均生成新回答。保持相同的 6,000 字符证据预算，交错执行两个策略；未知请求不重发。

报告正确且受支持答案、可回答题拒答、无答案题正确拒答、最终证据完整性、P95、实际用量与未知费用，并按来源族和切片给出配对结果。三个发现题进入回归集，新的 held-out 在策略冻结后只评一次。默认晋级沿既有离线合同进行。

**研究依据与本地采用方式**

- *Sufficient Context: A New Lens on Retrieval Augmented Generation Systems*（ICLR 2025）把上下文是否足以作答与模型能否利用上下文分开诊断。这里采用其分层思路，用最终 DCS 内容判断证据，再独立评答案。官方论文：`https://proceedings.iclr.cc/paper_files/paper/2025/hash/33dffa2e3d2ab74a783d1a8c292f66d9-Abstract-Conference.html`；作者仓库读回提交 `801b465eb3be5bf5216fbe3301e61daee85ff99c`。
- *RAGChecker: A Fine-grained Framework for Diagnosing Retrieval-Augmented Generation*（NeurIPS 2024）分别度量检索与生成，并检查 claim recall、上下文利用与支持。这里将失败定位到召回、配额、DCS 和生成阶段，复用现有评分及引用合同。官方仓库：`https://github.com/amazon-science/RAGChecker`，读回提交 `6091f08c00e676e87a970f2aeb4a23a484746348`。

两项来源于 2026-11-27 经 VerseSearch 的 AnySearch 学术检索和原站内容抽取核对。采用诊断方法即可完成当前实验，无需引入新的检索框架。
