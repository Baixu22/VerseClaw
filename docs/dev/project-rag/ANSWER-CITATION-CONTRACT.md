# 来源问答与引用回源

知识助手默认使用 strict 模式，依据 owner 准入且由 DCS 实际保留的来源回答。open 模式还可返回一般知识和推断，并为这两类内容保留空引用列表。缺失或冲突的 strict 证据返回 unknown；模型或支持核验失败时保留已读取来源及具体原因。

AnswerClaim/v1 区分来源陈述、一般知识和推断。来源陈述先通过准确引句与 source pin 校验，再由独立的 model-only 调用核验语义支持和问题的可回答性。该调用使用同一 owner/DCS 读取边界，记录 actor=knowledge-claim-support、driven_by=agent 和实际 runId。unsupported 或 uncertain 陈述退出答案并进入 unknowns。

EvidenceStatus/v2 分别记录 exactQuote、sourcePin 和 semanticSupport。引句及版本范围通过后，semanticSupport 先为 unverified；独立核验完成后才可变为 supported。核验过程保持无工具、无知识写入权限，两次模型调用使用一个 60 秒预算。

Citation/v2 保存原文 SourceRef/v2、整份原文 digest、已读取 chunk digest 与引句 digest。引句位置根据 UTF-8 字节计算，使用 raw-source-utf8-v1 的字节和行坐标。拆开的代理对或不匹配的原文范围会被拒绝。

引用点击经 Host knowledge.get 重新检查 owner 权限和版本，并显示对应原文范围。读取失效时清空原文正文并显示拒绝原因。治理动作保留原 chunk pin；答案的引句范围单独保存在 answerCitation，供回源使用。

保存答案和错误经验继续创建 agent 驱动的 Draft 或 Inbox 候选，经 Proposal/apply 流程审核。前端模板摘录不根据检索排序分数生成回答 confidence。
