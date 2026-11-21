# 有预算的 Research 检索

在 Chat 的知识来源选择器中选择 **Research**，输入问题并点击搜索。一次请求会拆解问题，按证据缺口补查来源；界面显示轮次、查询数、证据、模型推断、冲突和缺口。点击取消会停止本次请求，保留此前通过 owner 检查的部分结果。查询、会话、工作区、来源范围或 profile 变化会丢弃旧请求的界面结果。

取消或超时只展示最后一次经 Main 复验的部分结果。复验失败会清除此前显示的来源、推断及预览；来源恢复后需重新发起查询。

选中的来源仍可显式附加到普通 Chat。切回 Local 或 Quality 后恢复单次来源检索，知识交互模式与来源范围保持独立。自动推荐使用既有检索入口；多轮控制器由显式搜索启动。

## 请求合同与上限

`knowledge.researchStart` 接受 requestId、query、corpus，以及既有 workspace/session 选择；`knowledge.researchStatus` 和 `knowledge.researchCancel` 使用同一 requestId 与选择。Main 从当前 owner 绑定派生身份，并在每次检索、规划和结果交付时复验。请求不能提供权限、readIdentity、外网范围或预算覆盖。

`ResearchPlan/v1` 在第一次检索前冻结问题、owner 身份和以下上限。所有子查询共用该计划的期限和预算。

| 项目 | 单次请求上限 |
| --- | --- |
| 总期限 | 从开始准备 owner 身份起 30 秒 |
| 检索 | 3 轮、8 个不同 query，每轮最多 3 个 query |
| 规划模型 | 最多 2 次，每次独立预留且最多 1 次物理 provider 调用 |
| 规划 token 预留 | 合计 16,000，每次最多 8,000；每次输出最多 1,024 |
| 规划费用预留 | 合计 USD 0.05；全局、项目或会话 owner 限额可继续收紧 |
| 检索证据 | 12 个来源片段、估算 5,000 tokens、15,000 字符 |
| 来源链接 | 2 跳、32 个落点、128 条边，每个来源最多解析 512 个链接候选 |

规划调用复用模型专用 Gateway 路径与 Provider Spend owner。输入使用保守的 UTF-8 token 上界，输出上限传到 provider。预算在发送前预留；物理重试重新准入，同一规划会话的调用数上限拒绝第二次发送。费用按冻结模型费率和终态用量计算，缺少用量的预留继续占用；缺少费率时不发送规划请求。

规划等待连接出错或超时时，Main 对尚未确认完成的内部 run 发出 owner 取消请求，再移除本地监听；迟到的接受回执仍保留取消补偿。

规划回执中的 token 或费用为无效数值，或超出该次调用的预留时，Research 结束本次请求并保留已准入来源。原预留继续占用，实际用量标为未知，已排队链接也不再发起下一次规划调用。缺少实际用量的正常回执仍按已冻结的预留预算处理。

一次性内部模型会话使用执行 owner 提供的 workspace、会话 key 和实际 generation 建立预算记录；这类会话没有持久 transcript 行。普通会话仍通过持久 session owner 复读身份。

Research 的来源检索允许本地 embedding、向量和重排路径。当前远端 embedding/rerank 没有可供本次请求预留的费用合同，因此本控制器收紧其 egress，使用可用的本地路径并返回检索退化状态。普通 Local/Quality/Research 单次检索继续遵循既有 provider 选择。

上下文增强关闭时，DCS 内部 Context Ladder 同时停止读取 BlockStore；配置开关与环境变量开关均执行这一约束。

## 证据与停止

后续 query 来自尚缺少的证据、规划器建议与 owner 文档中的相对链接。链接只作为新的来源检索线索，每个落点重新经过相同 owner 读取；外部 URL、逃逸路径与重复 query 不创建额外访问。已有编码关系工具保留其 FactStore owner，Research 来源检索读取 Wiki、选中 Memory owner 等既有来源。

规划器再次建议已排队的来源链接时，沿用其原路径、来源绑定和深度；大小写、空白或字符规范化后的重复查询也保留这些信息。后续链接扩展继续使用同一两跳预算。

`ResearchStep/v1` 保存每轮查询、新增证据数和来源引用。重复、没有新增证据、引用覆盖充分、查询或轮次用尽、证据上限、期限与取消均有明确停止原因。旧版本、撤权或 scope 改变时清除依赖旧证据的引用、推断与关系线索。

证据保存当前 SourceRef、原文字节、source/chunk digest 和读取范围。规划器的覆盖项与冲突项必须引用实际 DCS 保留的来源，并包含当前 owner 字节中的精确引文；模型推断单列。DCS 的 complete chunk/conflict-group 次序和预算仍决定送入模型的内容。

`recomputeResearchCoverage` 按最终 `RetainedEvidenceManifest/v1` 重新计算覆盖。被预算丢弃的引用形成缺口；冲突组按整体保留，依赖丢弃证据的推断清除。缺少来源、检索路径、freshness、费用用量或完整引用组时，结果带相应缺口并返回 partial/unavailable。

## 验证入口

- `tests/unit/project-rag-research-controller.test.ts`：预算冻结、多轮补查、停止、owner 撤权、链接上限和 DCS 复算，以及 Main 的请求准入。
- `tests/unit/autonomy-provider-spend.test.ts`：真实 Provider Spend 事务、请求限额和发送前拒绝。
- `tests/unit/knowledge-evidence-qa.test.ts`：模型预算传递与迟到 acceptance 的取消。
- `tests/e2e/project-rag-research.spec.ts`：保留代码关系旅程，新增真实 Electron/Gateway 的多轮 Research、DCS 预算丢弃、取消、冲突、版本复验和 Local 回滚。

自动化结果标记 `actor: knowledge-research`、`driven_by: agent`、`realHumanEvidence: false`。

身份复验通过同一 session owner 的 `sessions.describe(identityOnly=true)` 重新读取会话 key、generation 和状态，省略完整会话列表所需的模型与转录元数据解析。状态查询仍受5秒上限约束，证据读取前后和交付前继续复验。
