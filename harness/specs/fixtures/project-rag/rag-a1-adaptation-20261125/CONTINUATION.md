# 知识库适配基线续接记录

后续 Windows 回归恢复、52份重排用量补读及短文档去重修复见 [恢复记录](RECOVERY.md)。下文保留本轮当时的观察和失败。

2026-11-25，TF-0946 继续完成 r6 回答对齐、费用记录和 owner claim 范围修复。语料保持 9 份项目文档、27 个问题，来源为 `agent-built-adaptation`；执行和评审均为 agent 驱动。

## 变更

Wiki claim 没有正文出现位置坐标时，读取代码现在检查其文本在正文中的首个和最后一个出现位置。只有全部出现位置均在当前连续读取范围内，才向 SourceSet 传递 claim 身份。该约束避免把范围内的普通词语匹配绑定到未读位置的 claim；完整读取仍能形成结构化冲突。

新增真实 owner/SourceSet 回归覆盖重复文本、完整读取和 UTF-8/CRLF 坐标。Electron 旅程增加 `knowledge.get` 的部分及完整读取断言。规格、评测合同和三种语言 README 已同步。

独立 WorkBuddy 修复复核发现了这个问题。新增回归在修复前实际失败，修复后 owner/SourceSet 定向 85 项通过。另一条“快照输出父目录必须存在”的审查意见，经 `git show f834e4150:scripts/knowledge-rag-adaptation.ts` 复核属于原有 `mkdir(output, { recursive: false })` 前置条件，保留真实路径隔离。

## r6 回答观察

135 项输入逐项核对问题、DCS 实际保留消息、生成配置、provider 终态和独立评分摘要。其中 109 项与历史完整回答输入一致，21 项上下文变化、1 项已有明确 incomplete 终态重新生成，共 22 项新回答和逐项独立评分完成。原有 4 项未结算调用保留且未重试。

| 路径 | 有效判断 | 回答正确 | 回答正确且引用受支持 | 未结算 |
|---|---:|---:|---:|---:|
| page + semantic | 25/27 | 13/27 | 13/27 | 2 |
| BM25 | 26/27 | 19/27 | 17/27 | 1 |
| dense | 27/27 | 23/27 | 20/27 | 0 |
| hybrid | 27/27 | 21/27 | 16/27 | 0 |
| hybrid + rerank | 26/27 | 23/27 | 20/27 | 1 |

检索捕获绑定 `afac8fe8bd6ecdbbec70ea0cd984bc4eed039d61`，22 项新回答执行绑定 `6d3bf2e970ecc927850cbc82dc20f15cac08749e`。每项复用都保留历史候选与回执；结果用于组件输入对照，完整 Electron/Gateway 当前候选验收仍待执行。正确性和引用支持分别计量，联合成功要求两者同时通过。

## 费用与用量

本地 CC Switch 的 `deepseek-v4.1-flash` 配置费率为每百万 token：输入 USD 0.30、输出 USD 1.20、缓存读取 USD 0.006，倍率 1。22 项新回答在发送前冻结了最多 USD 0.5846016 的配置费率预留，返回用量对应估算 USD 0.024069780。九次新评分的对应估算为 USD 0.037156968。

全部 131 项有效回答的配置费率估算合计 USD 0.151033428；4 项未结算调用单列 USD 0.1062912 的同口径预留。代理请求 ID 无法与这些 provider response ID 精确关联，因此实际账单仍为 unknown。r6 的 43 次 embedding 回执均有用量，52 次 rerank 回执没有 tokens/usage 字段。总任务费用资格保持未通过，未晋级排序策略。

## 验证状态

本轮完整节点回归 180 项中 178 项通过，2 项 Windows 子进程终止/清理用例失败，单独复跑仍失败。独立受控探针对本轮创建的 Node 运行系统 `taskkill /T /F`，8 秒后超时且子进程仍存活；随后原生终止成功。两个失败用例的临时目录未发现遗留 Node 进程。失败、超时和原始日志均保留。

类型检查首次临时配置缺少 `DOM.AsyncIterable`，补齐 Node/Electron 流类型库后完成严格定向检查。6 项真实来源安全探针、定向 lint、Harness validate/dry-run、通信 replay/compare 均通过。结果见 `continuation-validation.json`，其源文件 SHA256 绑定本次实现。

两次整体代码终判返回 reasoning-only、零正文；最后一次修复复核的进程消失，流中没有 provider terminal。三次均未登记为有效最终 verdict。有效的定向审查、发现处置和未结算原件见 `continuation-code-review.json`。

TF-0946 保持 `in_progress`。下一步完成匹配新候选的 Runtime/Electron 构建及旅程，复验 Windows 进程终止故障，补齐完整用量/费用资格。原工程门和后续节点合同保持现有要求。

原始证据目录：`D:/tmp/g2-tf0946-20261125-01a21178`。`answer-r6-input-reconciliation.json`、`answer-r6-evidence-readback.json`、`answers-r3`、`answer-judging-r3` 保存输入和调用链；`continuation-final-checks` 至 `continuation-final-checks-r4` 保存检查及首次失败。旧 `REPORT.md` 与首轮数据保留其历史解释。
