# 有预算的 Research 检索

在 Chat 的知识来源选择器中选择 **Research**，输入问题并点击搜索。一次请求会拆解问题，按证据缺口补查来源；界面显示轮次、查询数、证据、模型推断、冲突和缺口。点击取消会停止本次请求，保留此前通过 owner 检查的部分结果。查询、会话、工作区、来源范围或 profile 变化会丢弃旧请求的界面结果。

取消或超时只展示最后一次经 Main 复验的部分结果。复验失败会清除此前显示的来源、推断及预览；来源恢复后需重新发起查询。

状态传输失败后，前端请求停止并读取 Main 最后复验的结果。该快照仍在运行时，界面按实际中断原因显示无法继续、超时或取消；超时和传输失败在没有来源时显示研究暂不可用，有来源时显示部分结果。Main 已返回终态时，保留其停止原因。

启动或状态回执返回失败、结果观察回调抛错时，前端向同一 requestId/workspace/session 发送取消并保留原错误；请求结束后移除取消监听。后台规划收到取消后停止，迟到回答继续受原终态约束。

取消或期限可以先于 Main 启动准入。迟到启动回执到达后，前端再次取消同一请求并忽略该回执；启动与状态结果发布前继续检查取消和原期限。已停止的请求按取消或超时交付最后复验的部分结果，owner 改变的终态保留 scope-changed。

最后一次 owner 状态复验仍在等待时，取消监听保持有效；此时点击取消会向同一请求补发停止，并在复验返回后保留 cancelled。复验拒绝继续清除旧结果，scope-changed 终态继续保留；读回成功或失败结算后再移除监听。该读回沿用 1.5 秒上限。

选中的来源仍可显式附加到普通 Chat。切回 Local 或 Quality 后恢复单次来源检索，知识交互模式与来源范围保持独立。自动推荐使用既有检索入口；多轮控制器由显式搜索启动。

## 请求合同与上限

`knowledge.researchStart` 接受 requestId、query、corpus，以及既有 workspace/session 选择；`knowledge.researchStatus` 和 `knowledge.researchCancel` 使用同一 requestId 与选择。Main 从当前 owner 绑定派生身份，并在每次检索、规划和结果交付时复验。请求不能提供权限、readIdentity、外网范围或预算覆盖。

`ResearchPlan/v1` 在第一次检索前冻结问题、owner 身份和以下上限。所有子查询共用该计划的期限和预算。

问题拆解先去重，最多保留八个独立子问题。超过八个时，以完整原问题作为单一覆盖目标；分隔后没有有效子问题时也使用完整原问题。请求中的后续条件继续参与证据覆盖与缺口判断，检索和规划预算保持以下上限。

| 项目 | 单次请求上限 |
| --- | --- |
| 总期限 | 从开始准备 owner 身份起 30 秒 |
| 检索 | 3 轮、8 个不同 query，每轮最多 3 个 query |
| 规划模型 | 规划与独立支持判断合计最多 2 次，每次独立预留且最多 1 次物理 provider 调用 |
| 规划 token 预留 | 合计 16,000，每次最多 8,000；每次输出最多 1,024 |
| 规划费用预留 | 合计 USD 0.05；全局、项目或会话 owner 限额可继续收紧 |
| 检索证据 | 12 个来源片段、估算 5,000 tokens、15,000 字符 |
| 来源链接 | 2 跳、32 个落点、128 条边，每个来源最多解析 512 个链接候选 |

规划调用复用模型专用 Gateway 路径与 Provider Spend owner。输入使用保守的 UTF-8 token 上界，输出上限传到 provider。预算在发送前预留；物理重试重新准入，同一规划会话的调用数上限拒绝第二次发送。费用按冻结模型费率和终态用量计算，缺少用量的预留继续占用；缺少费率时不发送规划请求。

规划等待连接出错或超时时，Main 对尚未确认完成的内部 run 发出 owner 取消请求，再移除本地监听；迟到的接受回执仍保留取消补偿。

规划回执中的 token 或费用为无效数值，或超出该次调用的预留时，Research 结束本次请求并保留已准入来源。原预留继续占用，实际用量标为未知，已排队链接也不再发起下一次规划调用。缺少实际用量的正常回执仍按已冻结的预留预算处理。

规划调用等待期间，进度中的 `usage.actualPlanningTokens` 和 `usage.actualCostUsd` 为 `null`。有效回执结算后恢复累计数值；存在未知用量时，累计值继续为 `null`。等待期间发生取消、超时或 owner 改变时，终态保留原预留和未知用量，迟到回执不会改写该结果。尚未发起规划时用量为零；已完成结算后的检索取消保留已确认的累计用量。

规划等待回执携带实际用量时，先校验该次预留，再处理运行状态、DCS 回执和回答内容。即使回答为空、JSON 或引文无效，或运行失败，已知的无效/超额用量仍会结束 Research，阻止后续检索与规划。

一次性内部模型会话使用执行 owner 提供的 workspace、会话 key 和实际 generation 建立预算记录；这类会话没有持久 transcript 行。普通会话仍通过持久 session owner 复读身份。

Research 读取已选择的本地或远端 embedding/rerank。远端路径为同一请求预分配最多 4,000 tokens 和 USD 0.0125，规划与支持判断使用剩余的 12,000 tokens 和 USD 0.0375，总上限保持不变。每个实际发送批次通过 Provider Spend 的原 SQLite 事务检查 host/project/session 和请求累计预留；缓存命中不预留。费率取当前模型配置中的正数 input 价格且 output 为零，缺失或默认零价格返回 `remote-retrieval-cost-unquoted`；embedding adapter 还须声明单次发送和输入用量回读能力。指定的 Qwen3-VL 默认模型保持不变。

远端用量来自 provider 回执，缺失时保留未知负债，并拒绝同请求继续新增付费调用。失败响应和超额用量保留原始消费；发送前 owner 变化取消未发送预留。取消沿 `wiki.retrieval.cancel` 传到同 owner 的检索控制器，保留五分钟取消标记以拒绝迟到启动。Main 尚未收到检索费用回执时显示 inFlight 和未知费用。

上下文增强关闭时，DCS 内部 Context Ladder 同时停止读取 BlockStore；配置开关与环境变量开关均执行这一约束。

## 证据与停止

后续 query 来自尚缺少的证据、规划器建议与 owner 文档中的相对链接。链接只作为新的来源检索线索，每个落点重新经过相同 owner 读取；外部 URL、逃逸路径与重复 query 不创建额外访问。已有编码关系工具保留其 FactStore owner，Research 来源检索读取 Wiki、选中 Memory owner 等既有来源。

规划器再次建议已排队的来源链接时，沿用其原路径、来源绑定和深度；大小写、空白或字符规范化后的重复查询也保留这些信息。后续链接扩展继续使用同一两跳预算。

`ResearchStep/v1` 保存每轮查询、新增证据数和来源引用。重复、没有新增证据、引用覆盖充分、查询或轮次用尽、证据上限、期限与取消均有明确停止原因。旧版本、撤权或 scope 改变时清除依赖旧证据的引用、推断与关系线索。

证据保存当前 SourceRef、原文字节、source/chunk digest 和读取范围。规划器的覆盖项与冲突项必须引用实际 DCS 保留的来源，并包含当前 owner 字节中的精确引文；覆盖项另外提供直接回答，并通过独立模型调用核对对应子问题、数值、单位、时间和否定。规划器自行输出的支持标签会被剥离；支持判断缺失、uncertain/unsupported 或缺少来源 freshness 时保留缺口。模型推断单列。DCS 的 complete chunk/conflict-group 次序和预算仍决定送入模型的内容。

规划和支持判断共享原两次模型预算；两次耗尽后，后续 query 仍可补充证据，未取得支持判断的新问题保留 `semantic-review-budget-exhausted` 缺口。取消支持调用时保留其预留和未知用量，迟到结果不能恢复覆盖。

`recomputeResearchCoverage` 按最终 `RetainedEvidenceManifest/v1` 重新计算覆盖。被预算丢弃的引用形成缺口；冲突组按整体保留，依赖丢弃证据的推断清除。缺少来源、检索路径、freshness、费用用量或完整引用组时，结果带相应缺口并返回 partial/unavailable。

## 验证入口

- `tests/unit/project-rag-research-controller.test.ts`：预算冻结、多轮补查、停止、owner 撤权、链接上限和 DCS 复算，以及 Main 的请求准入。
- `tests/unit/autonomy-provider-spend.test.ts`：真实 Provider Spend 事务、请求限额和发送前拒绝。
- `tests/unit/knowledge-evidence-qa.test.ts`：模型预算传递与迟到 acceptance 的取消。
- `tests/e2e/project-rag-research.spec.ts`：保留代码关系旅程，新增真实 Electron/Gateway 的多轮 Research、DCS 预算丢弃、取消、冲突、版本复验和 Local 回滚。

自动化结果标记 `actor: knowledge-research`、`driven_by: agent`、`realHumanEvidence: false`。

身份复验通过同一 session owner 的 `sessions.describe(identityOnly=true)` 重新读取会话 key、generation 和状态，省略完整会话列表所需的模型与转录元数据解析。状态查询仍受5秒上限约束，证据读取前后和交付前继续复验。

状态复验耗尽5秒等待时，只返回当前请求的计划、阶段和用量元数据，证据、引用、关系与推断全部置空；同一请求在原30秒期限内继续等待下一次复验。复验恢复后交付当前 owner 验证过的结果。权限、会话代际或来源版本改变仍终止该请求并清空结果。

Plugin SDK 的 `knowledge-retrieval` 公开 `createRetrievalSpend`、请求预算/用量与批次回调类型；插件沿该 seam 复用 Provider Spend。OpenAI-compatible embedding 的 `requestAccounting` 与 `onUsage` 由 adapter 声明并回传，不从向量数量或 tokenizer 估算实际用量。
